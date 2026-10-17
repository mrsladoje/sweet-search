# venv/bin/python -I rerun/floor.py --set <agent-dev set> --machine NAME --arms a,b,c [--results DIR] [--procs 3]
#
# Post-freeze measurement (owner approval 2026-10-17, after the external reviews; plan in
# paper/analysis/rerun-plan.md). The fixed cost of one call per arm: the time of the
# smallest possible call (one query token, one candidate of one token), beside the time of
# the median call of the development agent set (median by query tokens x candidate tokens).
# The share floor / median says how much of a typical call is fixed cost (dispatch, thread
# wake-up, layout handling) rather than arithmetic. Development data only; the token values
# do not matter for the time.
# Per arm and process repetition: a fresh process (as bench.py), the arm's untimed input
# preparation (bench.py build), 200 untimed warm-up calls, then 5 rounds of timed calls
# (1,000 floor calls and 200 median calls per round); the per-round median is kept.
# Output: <results>/<machine>/floor/floor.json.
import argparse, json, os, subprocess, sys, time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, BENCH)
import jobs  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--set', required=True)
p.add_argument('--machine', default='')
p.add_argument('--arms', default='')
p.add_argument('--results', default=os.path.join(BENCH, 'results'))
p.add_argument('--procs', type=int, default=3)
p.add_argument('--one', default='', help='internal: time one arm in this process, print one JSON line')
ROUNDS, WARM, N_FLOOR, N_MED = 5, 200, 1000, 200


def shapes(root):
    from replay_py import load_set
    calls = load_set(root)
    work = np.array([c['nq'] * sum(x['nt'] for x in c['cands']) for c in calls])
    med = calls[int(np.argsort(work)[len(work) // 2])]
    c0 = calls[0]
    x = c0['cands'][0]
    row = x['raw'].size // x['nt']
    one = dict(c0, q=np.ascontiguousarray(c0['q'][:1]), nq=1, ref=c0['ref'][:1],
               cands=[dict(x, raw=x['raw'][:row].copy(), nt=1, mn=x['mn'][:1].copy(), sc=x['sc'][:1].copy(), nr=x['nr'][:1].copy())])
    return dict(floor=one, median=med), dict(nq=med['nq'], pool=len(med['cands']), tokens=int(sum(x['nt'] for x in med['cands'])))


def one(arm, root):
    ps = jobs.parse_spec(arm)
    if ps['arm'] == 'ours' and ps['threads']:
        os.environ['SS_MAXSIM_THREADS'] = str(ps['threads'])
    import bench
    bench.args.threads = ps['threads'] or 0
    build = bench.ARMS[ps['arm']][0]
    sh, _ = shapes(root)
    out = {}
    for name, call in sh.items():
        run = build(call)
        for _ in range(WARM):
            run()
        n = N_FLOOR if name == 'floor' else N_MED
        meds = []
        for _ in range(ROUNDS):
            ts = np.empty(n)
            for i in range(n):
                t = time.perf_counter_ns(); run(); ts[i] = time.perf_counter_ns() - t
            meds.append(float(np.median(ts)) / 1e3)
        out[name] = meds
    print(json.dumps(out))


def main(a):
    import bench  # noqa: F401  (only to list the registered arms)
    arms = [x for x in a.arms.split(',') if x and '%' not in x and jobs.parse_spec(x)['arm'] in bench.ARMS]
    _, med_shape = shapes(a.set)
    res = dict(machine=a.machine, set=os.path.basename(a.set.rstrip('/')), median_shape=med_shape, rounds=ROUNDS, procs=a.procs,
               script=jobs.sha_file(os.path.abspath(__file__)), arms={})
    for rep in range(a.procs):                       # arms in rotated order per repetition
        order = arms[rep % len(arms):] + arms[:rep % len(arms)]
        for arm in order:
            r = subprocess.run([sys.executable, '-I', os.path.abspath(__file__), '--one', arm, '--set', a.set], capture_output=True, text=True, timeout=600)
            d = res['arms'].setdefault(arm, dict(floor=[], median=[], errors=[]))
            if r.returncode != 0 or not r.stdout.strip():
                d['errors'].append(r.stderr.strip().splitlines()[-1] if r.stderr.strip() else f'exit {r.returncode}')
                print(f'{arm} rep {rep}: FAILED {d["errors"][-1]}', flush=True)
                continue
            x = json.loads(r.stdout.strip().splitlines()[-1])
            d['floor'].append(x['floor']); d['median'].append(x['median'])
            print(f"{arm} rep {rep}: floor {np.median(x['floor']):.2f} us, median call {np.median(x['median']):.2f} us", flush=True)
    for arm, d in res['arms'].items():
        if d['floor']:
            f = [float(np.median(x)) for x in d['floor']]; m = [float(np.median(x)) for x in d['median']]
            d.update(floor_us=float(np.median(f)), floor_range=[min(f), max(f)], median_us=float(np.median(m)), median_range=[min(m), max(m)],
                     share=float(np.median(f) / np.median(m)))
    out = os.path.join(a.results, a.machine, 'floor')
    os.makedirs(out, exist_ok=True)
    json.dump(res, open(os.path.join(out, 'floor.json.tmp'), 'w'), indent=1)
    os.replace(os.path.join(out, 'floor.json.tmp'), os.path.join(out, 'floor.json'))
    print(f'floor complete: {len(arms)} arms in {out}')


if __name__ == '__main__':
    a = p.parse_args()
    if a.one:
        one(a.one, a.set)
    else:
        main(a)
