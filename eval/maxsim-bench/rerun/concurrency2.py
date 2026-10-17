# venv/bin/python -I rerun/concurrency2.py --group-json '<frozen ho-conc group line>' --machine NAME
#        [--results DIR] [--min-seconds 3] [--reps 3] [--limit N] [--callers 1,4,16] [--executors threads,procs]
#
# Post-freeze rerun of the parallel-caller measurement (owner approval 2026-10-17; plan in
# paper/analysis/rerun-plan.md). A copy of the frozen concurrency.py with the four defects
# that the analysis found fixed; everything else (arms, sets, rates, executors, the Poisson
# trace, seed 42) is unchanged. The frozen file is not modified.
#   1. Start time. The frozen procs executor let callers start as soon as they read the start
#      file, up to 50 ms before the recorded start. Here every caller (closed and open loop)
#      busy-waits until the common start time, records when it really started, and the wall
#      time runs from the earliest real start to the last finish.
#   2. Thread budget. The frozen procs executor let a fixed thread count in the arm spec
#      (numpy_packed@8) override the budget max(1, cores // N), which oversubscribed the CPU.
#      Here the procs executor caps the arm's count at the budget (no count: the budget); the
#      threads executor keeps the arm's own setting (one process, one pool, as configured).
#      The effective count is recorded.
#   3. Environment. The frozen harness ignored the environment part of an arm spec (%blis),
#      so those runs used the default NumPy. Arms with an environment are left out here.
#   4. Duration and repetition. The frozen runs replayed each caller's share once (20 to
#      500 ms) and ran each configuration once. Here each closed-loop caller replays its
#      share in a loop until --min-seconds have passed (whole calls only), an open-loop trace
#      has at least --min-seconds of arrivals, every configuration runs --reps times, and
#      both executors warm up every call once (the frozen procs callers warmed only one).
# Output per arm: <results>/<machine>/<tag>-rerun/<set>/<arm>.conc2.json with, per run and
# repetition, throughput, achieved arrival rate, p50 / p99, and every latency.
import argparse, hashlib, json, multiprocessing as mp, os, queue, sys, threading, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, BENCH)
import jobs  # noqa: E402
import concurrency as C  # noqa: E402  (frozen: load, trim, trace are reused unchanged)

p = argparse.ArgumentParser()
p.add_argument('--group-json', required=True)
p.add_argument('--machine', required=True)
p.add_argument('--results', default=os.path.join(BENCH, 'results'))
p.add_argument('--min-seconds', type=float, default=3.0)
p.add_argument('--reps', type=int, default=3)
p.add_argument('--limit', type=int, default=0)
p.add_argument('--callers', default='1,4,16')
p.add_argument('--executors', default='threads,procs')
CORES = os.cpu_count()


def builder(arm, threads, force):
    """run() factory. force=True: the arm's thread count is capped at the given budget."""
    ps = jobs.parse_spec(arm)
    t = (min(ps['threads'], threads) if ps['threads'] else threads) if force else (ps['threads'] or threads)
    if ps['arm'] == 'ours':
        if t:
            os.environ['SS_MAXSIM_THREADS'] = str(t)
        else:
            os.environ.pop('SS_MAXSIM_THREADS', None)
    import bench
    bench.args.threads = t
    return bench.ARMS[ps['arm']][0], t


def _proc_worker(arm, threads, root, limit, share, schedule, min_ns, startf, q):
    parent = os.getppid()
    build, eff = builder(arm, threads, True)
    calls = C.load(root, limit, share)
    runs = [build(c) for c in calls]
    for r in runs:                       # warm every call once, as the threads executor does
        r()
    q.put(('ready', eff))
    start = wait_file(startf, parent)
    while time.perf_counter_ns() < start:
        pass
    real = time.perf_counter_ns()
    lat = []
    if schedule is None:
        while True:
            for r in runs:
                t = time.perf_counter_ns(); r(); lat.append(time.perf_counter_ns() - t)
            if time.perf_counter_ns() - start >= min_ns or not runs:
                break
    else:
        for when, idx in schedule:
            while time.perf_counter_ns() < start + when:
                pass
            runs[idx]()
            lat.append(time.perf_counter_ns() - (start + when))
    q.put(('done', (lat, real, time.perf_counter_ns())))


def wait_file(path, parent):
    while True:
        if os.getppid() != parent:
            os._exit(1)
        if os.path.exists(path):
            try:
                return int(open(path).read())
            except ValueError:
                pass
        time.sleep(0.001)


def run_procs(arm, root, limit, n, min_ns, schedule_for=None):
    ctx = mp.get_context('spawn')
    startf = os.path.join(os.environ.get('TMPDIR', '/tmp'), f'conc2-start-{os.getpid()}-{time.time_ns()}')
    budget = max(1, CORES // n)
    C.trim()
    qs, ps, eff = [], [], set()
    for w in range(n):
        q = ctx.Queue()
        sched = schedule_for(w) if schedule_for else None
        pr = ctx.Process(target=_proc_worker, args=(arm, budget, root, limit, (w, n), sched, min_ns, startf, q))
        pr.start(); qs.append(q); ps.append(pr)
        while True:
            try:
                kind, e = q.get(timeout=5)
                assert kind == 'ready'; eff.add(e); break
            except queue.Empty:
                if not pr.is_alive():
                    for x in ps:
                        x.kill()
                    raise RuntimeError(f'{arm}: caller {w} died before it was ready (exit {pr.exitcode})')
    start = time.perf_counter_ns() + 100_000_000
    open(startf + '.tmp', 'w').write(str(start)); os.replace(startf + '.tmp', startf)
    lat, first, end = [], None, 0
    for q in qs:
        kind, (l, real, e) = q.get()
        lat += l; end = max(end, e); first = real if first is None else min(first, real)
    for pr in ps:
        pr.join()
    os.remove(startf)
    if any(pr.exitcode != 0 for pr in ps):
        raise RuntimeError(f'{arm}: a caller process failed')
    return lat, end - first, sorted(eff), (first - start)


def run_threads(arm, calls, n, min_ns, schedule=None):
    build, eff = builder(arm, 0, False)
    runs = [build(c) for c in calls]
    for r in runs:
        r()
    lat = [[] for _ in range(n)]
    barrier = threading.Barrier(n + 1)
    box = {}
    if schedule is None:
        def worker(w):
            mine = runs[w::n]
            barrier.wait()
            while True:
                for r in mine:
                    t = time.perf_counter_ns(); r(); lat[w].append(time.perf_counter_ns() - t)
                if time.perf_counter_ns() - box['t'] >= min_ns or not mine:
                    break
    else:
        jobsq = queue.Queue()
        def worker(w):
            barrier.wait()
            while True:
                item = jobsq.get()
                if item is None:
                    return
                when, idx = item
                runs[idx]()
                lat[w].append(time.perf_counter_ns() - (box['t'] + when))
    th = [threading.Thread(target=worker, args=(w,)) for w in range(n)]
    for t in th:
        t.start()
    box['t'] = time.perf_counter_ns()
    barrier.wait()
    if schedule is not None:
        for when, idx in schedule:
            while time.perf_counter_ns() < box['t'] + when:
                pass
            jobsq.put((when, idx))
        for _ in th:
            jobsq.put(None)
    for t in th:
        t.join()
    return [x for l in lat for x in l], time.perf_counter_ns() - box['t'], [eff], 0


def main(a, group):
    root, rates = group['set'], group.get('rates') or []
    arms = [x for x in group['arms'] if '%' not in x]          # fix 3: no environment-specific arms
    callers = [int(x) for x in a.callers.split(',')]
    execs = a.executors.split(',')
    min_ns = int(a.min_seconds * 1e9)
    out_dir = os.path.join(a.results, a.machine, group['name'] + '-rerun', os.path.basename(root.rstrip('/')))
    os.makedirs(out_dir, exist_ok=True)
    from set_manifest import set_hash
    sh = set_hash(root)
    calls = C.load(root, a.limit)
    for arm in arms:
        dest = os.path.join(out_dir, jobs.file_name(arm) + '.conc2.json')
        spec = [('closed', e, n, None) for e in execs for n in callers] + [('open', e, 16, r) for e in execs for r in rates]
        blob = dict(set=[os.path.basename(root), sh], arm=arm, binaries=jobs.binaries(arm), runs=[list(x) for x in spec], reps=a.reps,
                    min_seconds=a.min_seconds, limit=a.limit, script=jobs.sha_file(os.path.abspath(__file__)))
        key = hashlib.sha256(json.dumps(blob, sort_keys=True).encode()).hexdigest()
        if os.path.exists(dest):
            try:
                old = json.load(open(dest))
                if old.get('job_key') == key and old.get('complete'):
                    print(f'reuse {dest}'); continue
            except Exception:
                pass
        res = dict(arm=arm, set=os.path.basename(root), job_key=key, identity=blob, complete=False, cores=CORES, runs=[])
        for rep in range(a.reps):
            for kind, ex, n, rate in spec:
                tr = None
                if kind == 'open':
                    n_req = max(2 * len(calls), int(rate * a.min_seconds))
                    tr = C.trace(rate, n_req, len(calls))
                if ex == 'threads':
                    lat, wall, eff, skew = run_threads(arm, calls, n, min_ns, tr)
                else:
                    per = None if tr is None else (lambda w, tr=tr, n=n: [(t, i // n) for t, i in tr if i % n == w])
                    lat, wall, eff, skew = run_procs(arm, root, a.limit, n, min_ns, per)
                la = np.asarray(lat, float)
                last_arrival = tr[-1][0] if tr else None
                res['runs'].append(dict(rep=rep, type=kind, executor=ex, callers=n, rate=rate, effective_threads=eff, n=len(lat), wall_ns=wall,
                                        start_skew_ns=skew, throughput=len(lat) / (wall / 1e9),
                                        offered_span_ns=last_arrival, achieved_rate=(len(lat) / (wall / 1e9)) if tr else None,
                                        p50_ms=float(np.percentile(la, 50)) / 1e6, p99_ms=float(np.percentile(la, 99)) / 1e6,
                                        lat_ns=[int(x) for x in lat]))
                print(f'{arm} rep {rep} {kind} {ex} n={n} rate={rate}: {len(lat)} requests in {wall / 1e9:.2f} s', flush=True)
                for c in calls:
                    for k in [k for k in c if k.startswith('in_')]:
                        del c[k]
                C.trim()
        res['complete'] = True
        json.dump(res, open(dest + '.tmp', 'w')); os.replace(dest + '.tmp', dest)
    print(f'rerun complete: {len(arms)} arms in {out_dir}')


if __name__ == '__main__':
    a = p.parse_args()
    main(a, json.loads(a.group_json))
