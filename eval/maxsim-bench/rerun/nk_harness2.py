# venv/bin/python -I rerun/nk_harness2.py --set <agent-dev set> --arms a,b,... --out FILE.json
#
# Post-freeze check (owner approval 2026-10-18, follow-up to rerun/nk_harness.py). NumKong took
# about 145 us per development agent call on the EPYC under the bench.py protocol and about 70 us
# after many back-to-back calls. Two explanations: (1) ramp-up of the arm's worker threads or the
# CPU clock (the pool goes idle while a call's inputs are prepared), or (2) warmth from repeating
# the same call's data (caches, TLB, allocator). Protocols, each in a fresh process per arm:
#   main   bench.py rhythm: per call, prepare, 1 untimed warm-up call, 5 timed calls (median)
#   A      prepare ALL calls first (untimed), then time each call ONCE, back to back, no repeats
#   Aw     as A, after one untimed pass over all calls (each prepared object has run once)
#   B      per call, prepare (untimed), then time the call ONCE (main rhythm without repeats)
# A near the main median => data reuse (2); A near the steady value => ramp-up (1).
# Development data only; per-call times stay in the output, the printout is aggregates.
import argparse, json, os, subprocess, sys, time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, BENCH)

p = argparse.ArgumentParser()
p.add_argument('--set', required=True)
p.add_argument('--arms', default='ours,numkong_native_f32')
p.add_argument('--out', required=True)
p.add_argument('--plan', default='main,main,A,A,Arev,Aw,B,B', help='protocol runs per arm, in this order (Arev: A in reversed call order)')
p.add_argument('--one', default='', help='internal: ARM:PROTOCOL, time in this process, print one JSON line')


def tick(run):
    t = time.perf_counter_ns(); run(); return (time.perf_counter_ns() - t) / 1e3


def one(spec, root):
    import bench
    from replay_py import load_set
    arm, proto = spec.split(':')
    bench.args.threads = 0
    bench.args.arm = arm
    build = bench.ARMS[arm][0]
    calls = load_set(root)

    def drop(call):                                   # as bench.py: free the prepared rival inputs after a call
        for k in [k for k in call if k.startswith('in_')]:
            call.pop(k)

    ts = []
    if proto == 'main':
        for call in calls:
            run = build(call); run()
            ts.append(float(np.median([tick(run) for _ in range(5)])))
            drop(call)
    elif proto in ('A', 'Arev', 'Aw'):
        order = list(range(len(calls)))[::-1] if proto == 'Arev' else list(range(len(calls)))
        runs = [build(c) for c in calls]
        if proto == 'Aw':
            for i in order:
                runs[i]()
        t = [0.0] * len(calls)
        for i in order:
            t[i] = tick(runs[i])
        ts = t
    elif proto == 'B':
        for call in calls:
            run = build(call)
            ts.append(tick(run))
            drop(call)
    print(json.dumps(dict(ts_us=[round(x, 2) for x in ts])))


def main(a):
    arms = [x for x in a.arms.split(',') if x]
    plan = [x for x in a.plan.split(',') if x]
    res = dict(set=os.path.basename(a.set.rstrip('/')), plan=plan, script='rerun/nk_harness2.py', runs=[])
    for k, proto in enumerate(plan):
        for arm in (arms if k % 2 == 0 else arms[::-1]):
            t0 = time.time()
            r = subprocess.run([sys.executable, '-I', os.path.abspath(__file__), '--one', f'{arm}:{proto}', '--set', a.set, '--out', '-'],
                               capture_output=True, text=True, timeout=3600)
            if r.returncode != 0:
                print(arm, proto, 'FAILED', r.stderr.strip().splitlines()[-1:], flush=True)
                continue
            ts = json.loads(r.stdout.strip().splitlines()[-1])['ts_us']
            res['runs'].append(dict(arm=arm, protocol=proto, run=k, seconds=round(time.time() - t0, 1), median_us=float(np.median(ts)), ts_us=ts))
            print(f'{arm} {proto} run {k}: median {np.median(ts):.1f} us over {len(ts)} calls', flush=True)
            json.dump(res, open(a.out + '.tmp', 'w'))
    summ = {}
    for r in res['runs']:
        summ.setdefault(r['arm'], {}).setdefault(r['protocol'], []).append(round(r['median_us'], 1))
    res['summary'] = summ
    json.dump(res, open(a.out, 'w'))
    if os.path.exists(a.out + '.tmp'):
        os.remove(a.out + '.tmp')
    print(json.dumps(summ))


if __name__ == '__main__':
    a = p.parse_args()
    if a.one:
        one(a.one, a.set)
    else:
        main(a)
