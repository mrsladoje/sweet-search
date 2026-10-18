# venv/bin/python -I rerun/nk_harness.py --set <agent-dev set> --arms ours,numkong_native_f32 --out FILE.json [--reps 200] [--passes 2]
#
# Post-freeze check (owner approval 2026-10-18, after the external reviews): why NumKong took
# about twice as long per call in the main warm run (bench.py) as in the fixed-cost run
# (rerun/floor.py) on the EPYC, while the kernel did not. The two harnesses time different
# calls and repeat them differently:
#   bench.py   per call: build, 1 untimed warm-up call, 5 timed calls (median)
#   floor.py   one call (median by work): build, 200 untimed warm-up calls, 200 timed calls per round
# This script times every call of one development set with one protocol that contains both:
# per call, build, 1 untimed warm-up call, then --reps timed calls back to back, keeping each
# repetition's time. Repetitions 1-5 are the bench.py protocol; the late repetitions are the
# floor.py protocol. It also times floor.py's own median call with floor.py's exact protocol.
# One fresh process per arm and pass (as bench.py), arms in reversed order on the second pass.
# Development data only; per-call times stay in the output file, the printout is aggregates.
import argparse, json, os, subprocess, sys, time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, BENCH)
sys.path.insert(0, HERE)

p = argparse.ArgumentParser()
p.add_argument('--set', required=True)
p.add_argument('--arms', default='ours,numkong_native_f32')
p.add_argument('--out', required=True)
p.add_argument('--reps', type=int, default=200)
p.add_argument('--passes', type=int, default=2)
p.add_argument('--warm', type=int, default=1, help='untimed warm-up calls per call (bench.py: 1)')
p.add_argument('--one', default='', help='internal: time one arm in this process, print one JSON line')
p.add_argument('--variant', default='', help='bench.py steps to add between calls: env (env_info at start), refs (reference reads and\n'
               'agreement after each call), pop (free the prepared rival inputs after each call); comma-separated')
MARKS = (1, 2, 3, 4, 5, 10, 20, 50, 100, 200)


def one(arm, root, reps, variant=(), warm=1):
    import bench
    import contracts
    import floor  # floor.shapes: the same median call and floor call as rerun/floor.py
    from replay_py import load_set
    bench.args.threads = 0
    bench.args.arm = arm
    build, contract, clamp, precision = bench.ARMS[arm]
    if 'env' in variant:
        bench.env_info()
    refs = contracts.Refs(root) if 'refs' in variant else None
    calls = load_set(root)
    ts = np.empty((len(calls), reps))
    for i, call in enumerate(calls):
        run = build(call)
        for _ in range(warm):                    # bench.py: one untimed warm-up call
            run()
        for r in range(reps):
            t = time.perf_counter_ns(); run(); ts[i, r] = time.perf_counter_ns() - t
        if refs is not None:
            got = np.asarray(run(), np.float64).copy()
            for v in ('a', 'b'):
                bench.agree(refs.get(call, contracts.variant(contract, clamp, precision, v)), got)
            bench.agree(refs.get(call, 'S-clamp'), got)
        if 'pop' in variant:
            for k in [k for k in call if k.startswith('in_')]:
                call.pop(k)
    if variant:
        print(json.dumps(dict(ts_us=(ts / 1e3).round(2).tolist(), floor_median_call_us=[0.0], floor_call_index=[])))
        return
    sh, _ = floor.shapes(root)                   # floor.py protocol on its median call
    run = build(sh['median'])
    for _ in range(floor.WARM):
        run()
    fl = []
    for _ in range(floor.ROUNDS):
        x = np.empty(floor.N_MED)
        for i in range(floor.N_MED):
            t = time.perf_counter_ns(); run(); x[i] = time.perf_counter_ns() - t
        fl.append(float(np.median(x)) / 1e3)
    med = sh['median']
    idx = [i for i, c in enumerate(calls) if c['nq'] == med['nq'] and len(c['cands']) == len(med['cands'])
           and sum(x['nt'] for x in c['cands']) == sum(x['nt'] for x in med['cands'])]
    print(json.dumps(dict(ts_us=(ts / 1e3).round(2).tolist(), floor_median_call_us=fl, floor_call_index=idx)))


def summary(ts, idx):
    ts = np.asarray(ts)
    per_call = lambda a, b: np.median(ts[:, a:b], axis=1)       # median over repetitions a..b-1 per call
    s = dict(p50_bench_protocol=float(np.median(per_call(0, 5))),         # reps 1-5, as bench.py
             p50_late=float(np.median(per_call(ts.shape[1] - 100, ts.shape[1]))),  # last 100 reps
             rep_median={str(m): float(np.median(ts[:, m - 1])) for m in MARKS if m <= ts.shape[1]})
    if idx:
        c = ts[idx[0]]
        s['floor_call_bench_protocol'] = float(np.median(c[:5]))
        s['floor_call_late'] = float(np.median(c[-100:]))
    return s


def main(a):
    arms = [x for x in a.arms.split(',') if x]
    res = dict(set=os.path.basename(a.set.rstrip('/')), reps=a.reps, passes=a.passes, script='rerun/nk_harness.py', runs=[])
    for ps in range(a.passes):
        for arm in (arms if ps % 2 == 0 else arms[::-1]):
            t0 = time.time()
            r = subprocess.run([sys.executable, '-I', os.path.abspath(__file__), '--one', arm, '--set', a.set, '--out', '-',
                                '--reps', str(a.reps)], capture_output=True, text=True, timeout=3600)
            if r.returncode != 0:
                print(arm, 'FAILED', r.stderr.strip().splitlines()[-1:], flush=True)
                continue
            x = json.loads(r.stdout.strip().splitlines()[-1])
            s = summary(x['ts_us'], x['floor_call_index'])
            s['floor_protocol_median_call'] = float(np.median(x['floor_median_call_us']))
            res['runs'].append(dict(arm=arm, passno=ps, seconds=round(time.time() - t0, 1), calls=len(x['ts_us']), summary=s, ts_us=x['ts_us']))
            print(arm, 'pass', ps, json.dumps({k: (round(v, 1) if isinstance(v, float) else {kk: round(vv, 1) for kk, vv in v.items()})
                                               for k, v in s.items()}), flush=True)
    json.dump(res, open(a.out, 'w'))


if __name__ == '__main__':
    a = p.parse_args()
    if a.one:
        one(a.one, a.set, a.reps, tuple(x for x in a.variant.split(',') if x), a.warm)
    else:
        main(a)
