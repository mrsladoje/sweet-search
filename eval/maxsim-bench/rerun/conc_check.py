# venv/bin/python -I rerun/conc_check.py --group-json '<frozen ho-conc group line>' --machine NAME --out FILE.json
#        [--callers 1,16] [--executors threads,procs] [--limit N] [--arms a,b,...]
#
# Post-freeze check (not frozen). The parallel-caller runs time the arms but do not check their
# scores. This script checks them: with N callers in each executor of rerun/concurrency2.py
# (threads: N threads in one process, the library pool shared; procs: one process per caller,
# thread budget max(1, cores // N), a fixed count in the arm spec capped at it), every caller
# computes the scores of its share of the set while the other callers run, and every returned
# score array is compared with
#   (a) the same arm's own scores for the same call, computed one call at a time in the same
#       process before the concurrent pass, and
#   (b) the float64 reference of the arm's own contract (contracts.py cache, as bench.py checks
#       single calls).
# A case passes when the concurrent scores equal the one-at-a-time scores within the precision
# bound of fixtures_contracts.bound, the same calls are non-finite, and the largest error
# against (b) does not grow. The error against (b) is reported for both passes: it is not
# judged against the bound alone, because NumKong approximates the maximum and maxsim-cpu's
# AArch64 build has a known padding defect (issue #5); both show the error one call at a time.
# Every score array is copied out at once, so a reused output buffer or a race between
# callers shows up. All callers start together and replay their share once. No timing.
# Each (arm, executor, N) runs in fresh processes, so no thread setting carries over.
# Output: one JSON with aggregates per (arm, executor, N) and a verdict; no per-call rows.
import argparse, json, multiprocessing as mp, os, queue, sys, threading, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, BENCH)
sys.path.insert(0, HERE)

p = argparse.ArgumentParser()
p.add_argument('--group-json', required=True)
p.add_argument('--machine', required=True)
p.add_argument('--out', required=True)
p.add_argument('--callers', default='1,16')
p.add_argument('--executors', default='threads,procs')
p.add_argument('--limit', type=int, default=0)
p.add_argument('--arms', default='', help='comma-separated subset of the group arms (default: all)')
CORES = os.cpu_count()
BOUND = {'int4': 2e-6, 'f32': 2e-6, 'f16': 4e-3, 'bf16': 3e-2}   # fixtures_contracts.bound


def _scores(run):
    return np.array(run(), np.float64, copy=True)


def _proc(arm, threads, force, root, limit, share, n_threads, startf, parent, q):
    """One process: build the calls of `share` and compute them one by one (the baseline);
    report ready; from the common start time compute them again with n_threads caller
    threads; send {index: (baseline, concurrent)}."""
    try:
        import concurrency as C
        from concurrency2 import builder, wait_file
        build, eff = builder(arm, threads, force)
        calls = C.load(root, limit, share)
        idx = list(range(share[0], share[0] + share[1] * len(calls), share[1]))
        runs = [build(c) for c in calls]
        base = [_scores(r) for r in runs]
        conc = [None] * len(runs)
        barrier = threading.Barrier(n_threads)

        def worker(w):
            barrier.wait()
            for j in range(w, len(runs), n_threads):
                conc[j] = _scores(runs[j])

        q.put(('ready', eff))
        start = wait_file(startf, parent)
        while time.perf_counter_ns() < start:
            pass
        th = [threading.Thread(target=worker, args=(w,)) for w in range(n_threads)]
        for t in th:
            t.start()
        for t in th:
            t.join()
        q.put(('done', {i: (b.tolist(), c.tolist()) for i, b, c in zip(idx, base, conc)}))
    except Exception as e:  # noqa: BLE001  (reported to the parent)
        q.put(('err', repr(e)))


def _get(q, pr, what):
    while True:
        try:
            kind, val = q.get(timeout=5)
        except queue.Empty:
            if not pr.is_alive():
                raise RuntimeError(f'{what}: a process died (exit {pr.exitcode})')
            continue
        if kind == 'err':
            raise RuntimeError(f'{what}: {val}')
        return kind, val


def run_case(arm, root, limit, ex, n):
    """All scores of the set for one (arm, executor, N): {index: (baseline, concurrent)}."""
    ctx = mp.get_context('spawn')
    if ex == 'threads':                  # one fresh process, n caller threads, the arm's own setting
        procs = [(0, (0, 1), n, False)]
    else:                                # n processes, one caller each, budget capped
        procs = [(max(1, CORES // n), (w, n), 1, True) for w in range(n)]
    startf = os.path.join(os.environ.get('TMPDIR', '/tmp'), f'conc-check-start-{os.getpid()}-{time.time_ns()}')
    what = f'{arm} {ex} n={n}'
    qs, ps, eff = [], [], set()
    try:
        for threads, share, nthr, force in procs:
            q = ctx.Queue()
            pr = ctx.Process(target=_proc, args=(arm, threads, force, root, limit, share, nthr, startf, os.getpid(), q))
            pr.start(); qs.append(q); ps.append(pr)
        for q, pr in zip(qs, ps):        # every caller has computed its baseline
            kind, e = _get(q, pr, what); assert kind == 'ready'; eff.add(e)
        start = time.perf_counter_ns() + 100_000_000
        open(startf + '.tmp', 'w').write(str(start)); os.replace(startf + '.tmp', startf)
        out = {}
        for q, pr in zip(qs, ps):
            kind, res = _get(q, pr, what); assert kind == 'done'
            out.update({int(i): (np.asarray(b), np.asarray(c)) for i, (b, c) in res.items()})
        for pr in ps:
            pr.join()
    finally:
        for pr in ps:
            if pr.is_alive():
                pr.kill()
        if os.path.exists(startf):
            os.remove(startf)
    return out, sorted(x for x in eff if x is not None)


def main(a, group):
    import bench, contracts, concurrency as C
    root = group['set']
    arms = [x for x in group['arms'] if '%' not in x]
    if a.arms:
        want = a.arms.split(',')
        arms = [x for x in arms if x in want] + [x for x in want if x not in arms]
    calls = C.load(root, a.limit)
    refs = contracts.Refs(root)
    import jobs
    res = dict(machine=a.machine, set=os.path.basename(root.rstrip('/')), calls=len(calls), cores=CORES,
               callers=a.callers, executors=a.executors, limit=a.limit, results=[])
    ok_all = True
    for arm in arms:
        _, contract, clamp, precision = bench.ARMS[jobs.parse_spec(arm)['arm']]
        ref_name = contracts.variant(contract, clamp, precision, 'a')
        bound = BOUND[precision]
        for ex in a.executors.split(','):
            for n in [int(x) for x in a.callers.split(',')]:
                t0 = time.time()
                got, eff = run_case(arm, root, a.limit, ex, n)
                assert sorted(got) == list(range(len(calls))), f'{arm} {ex} n={n}: {len(got)} of {len(calls)} calls'
                st = dict(err_seq=0.0, err_conc=0.0, nonfin_seq=0, nonfin_conc=0, diff=0.0, ndiff=0)
                for i, call in enumerate(calls):
                    b, c = got[i]
                    ref = refs.get(call, ref_name)
                    for k, v in (('seq', b), ('conc', c)):
                        st['nonfin_' + k] += int(not np.all(np.isfinite(v)))
                        fin = np.isfinite(v) & np.isfinite(ref)
                        if fin.any():
                            st['err_' + k] = max(st['err_' + k], float(np.abs(v[fin] - ref[fin]).max()))
                    both = np.isfinite(b) & np.isfinite(c)
                    d = float(np.abs(c[both] - b[both]).max()) if both.any() else 0.0
                    if d > 0 or not np.array_equal(np.isfinite(b), np.isfinite(c)):
                        st['ndiff'] += 1
                        st['diff'] = max(st['diff'], d if np.array_equal(np.isfinite(b), np.isfinite(c)) else float('inf'))
                # the concurrent pass must give what the same arm gives one call at a time: equal
                # scores within the precision bound, the same non-finite calls, no larger error
                ok = st['diff'] <= bound and st['nonfin_conc'] == st['nonfin_seq'] and st['err_conc'] <= st['err_seq'] + bound
                ok_all &= ok
                row = dict(arm=arm, contract=contract, precision=precision, executor=ex, callers=n, effective_threads=eff,
                           calls=len(calls), bound=bound,
                           max_err_ref_sequential=st['err_seq'], max_err_ref_concurrent=st['err_conc'],
                           nonfinite_calls_sequential=st['nonfin_seq'], nonfinite_calls_concurrent=st['nonfin_conc'],
                           max_diff_vs_sequential=st['diff'], calls_differing_from_sequential=st['ndiff'],
                           ok=ok, seconds=round(time.time() - t0, 1))
                res['results'].append(row)
                print(f"{arm} {ex} n={n}: vs sequential {st['diff']:.2e} on {st['ndiff']} calls; err vs ref {st['err_conc']:.2e} "
                      f"(sequential {st['err_seq']:.2e}); non-finite {st['nonfin_conc']} (sequential {st['nonfin_seq']}) "
                      f"-> {'ok' if ok else 'FAIL'} ({row['seconds']} s)", flush=True)
                C.trim()
    res['ok'] = ok_all
    json.dump(res, open(a.out + '.tmp', 'w'), indent=1); os.replace(a.out + '.tmp', a.out)
    print('conc_check', 'PASS' if ok_all else 'FAIL', a.out)


if __name__ == '__main__':
    a = p.parse_args()
    main(a, json.loads(a.group_json))
