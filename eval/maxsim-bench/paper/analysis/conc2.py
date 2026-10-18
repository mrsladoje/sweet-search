# venv/bin/python -I paper/analysis/conc2.py
#
# Post-freeze analysis code (not frozen). Parallel callers, post-freeze rerun with the fixed
# harness (rerun/concurrency2.py; plan in rerun-plan.md). Reads the .conc2.json files and
# keeps only aggregates per configuration (type, executor, callers, rate): over the
# repetitions, the median and the range of throughput, the median p50 / p99, the median
# achieved arrival rate (open loop) and the effective thread counts. The per-request
# latencies (lat_ns) are not copied. Writes tables/conc2.json in the layout of conc.json, so
# that mktex.py reads both the same way.
import glob, json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PLATFORMS, dump  # noqa: E402

CLOUD = os.path.expanduser('~/.ss-eval/maxsim-cloud/r2')       # <type>-r2a (agent-ho), <type>-r2b (gcsn-ho)
LOCAL = os.path.expanduser('~/.ss-eval/maxsim-local/rerun')    # <m3max|epyc>/
# The threads executor runs all arms of a set one after another in one parent process, so a
# thread setting that one arm makes stays for the next arm of the same library (review round
# 3): torch.set_num_threads persists, and the rivals-rs rayon pool is built once, on first use.
# Two configurations inherited a setting: on the M3 Max, torch_segment_reduce runs after
# torch_pad_bmm@1 (so it ran with one thread, not the default); on the EPYC, nextplaid@4 runs
# after nextplaid (so it used the pool of all cores, not four). Their threads-executor runs are
# left out. The procs executor starts fresh processes and is not affected; a @1 arm runs on the
# calling thread and does not build the pool. No other arm order has the problem.
LEAKED = {('m3max', 'torch_segment_reduce'), ('epyc', 'nextplaid@4')}
# M3 Max recheck (owner approval 2026-10-18; ~/.ss-eval/maxsim-local/rerun2/run-m3conc.sh): the kernel, the
# best exact rivals and NumKong, each arm in its own process, three passes in different arm orders with a
# cooldown and a quiet wait before every arm; closed loop at 1, 4, 16 callers and the open loop at the top
# rate. When it exists it replaces the M3 Max rerun above; the runs of the three passes are pooled per arm.
M3CHECK = os.path.expanduser('~/.ss-eval/maxsim-local/rerun2/m3conc')


def files(platform, fam):
    if platform == 'm3max' and os.path.isdir(M3CHECK):
        return sorted(glob.glob(os.path.join(M3CHECK, 'pass*', 'm3max', f'ho-conc-{fam}-ho-rerun', '*', '*.conc2.json')))
    root = (os.path.join(CLOUD, f'{platform}-r2*') if platform in ('intel', 'amd', 'arm') else os.path.join(LOCAL, platform))
    return sorted(glob.glob(os.path.join(root, f'ho-conc-{fam}-ho-rerun', '*', '*.conc2.json')))


def aggregate(runs):
    out = {}
    for r in runs:
        out.setdefault((r['type'], r['executor'], r['callers'], r['rate']), []).append(r)
    rows = []
    for (kind, ex, n, rate), rs in sorted(out.items(), key=lambda x: (x[0][0], x[0][1], x[0][2], x[0][3] or 0)):
        tp = [r['throughput'] for r in rs]
        rows.append(dict(type=kind, executor=ex, callers=n, rate=rate, reps=len(rs),
                         effective_threads=sorted({t for r in rs for t in r['effective_threads'] if t is not None}),
                         n=int(np.median([r['n'] for r in rs])), wall_ns=float(np.median([r['wall_ns'] for r in rs])),
                         throughput=float(np.median(tp)), throughput_range=[float(min(tp)), float(max(tp))],
                         p50_ms=float(np.median([r['p50_ms'] for r in rs])), p99_ms=float(np.median([r['p99_ms'] for r in rs])),
                         p99_range=[float(min(r['p99_ms'] for r in rs)), float(max(r['p99_ms'] for r in rs))],
                         achieved_rate=None if rate is None else float(np.median([r['achieved_rate'] for r in rs])),
                         start_skew_ms_max=float(max(abs(r['start_skew_ns']) for r in rs)) / 1e6))
    return rows


def main():
    res = {}
    for p in PLATFORMS:
        for fam in ('agent', 'gcsn'):
            pooled = {}
            for f in files(p, fam):
                d = json.load(open(f))
                for r in d['runs']:
                    r['src'] = f
                if not d.get('complete'):
                    continue
                own_process = p == 'm3max' and os.path.isdir(M3CHECK)        # the recheck runs each arm in its own process
                runs = [r for r in d['runs'] if own_process or not ((p, d['arm']) in LEAKED and r['executor'] == 'threads')]
                pooled.setdefault((p, fam, d['arm']), dict(cores=d.get('cores'), min_seconds=d['identity']['min_seconds'], runs=[]))['runs'] += runs
            for (_, _, arm), v in pooled.items():
                res.setdefault(p, {}).setdefault(fam, {})[arm] = dict(cores=v['cores'], reps=len({(r['src'], r['rep']) for r in v['runs']}),
                                                                      min_seconds=v['min_seconds'], runs=aggregate(v['runs']))
            if fam in res.get(p, {}):
                print(p, fam, len(res[p][fam]), 'arms')
    dump('conc2.json', res)


if __name__ == '__main__':
    main()
