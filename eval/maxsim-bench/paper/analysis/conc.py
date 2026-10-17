# venv/bin/python -I paper/analysis/conc.py
#
# Post-freeze analysis code (not frozen). Parallel callers across machines (W6): reads the
# concurrency result files (ho-conc-agent-ho, ho-conc-gcsn-ho) and keeps only the aggregate
# fields of each run (throughput, p50, p99, n); the per-request latencies (lat_ns) are not
# read into the output. Writes tables/conc.json and tables/conc.md.
#
# Correction (found in this analysis): in closed-loop runs of the procs executor,
# concurrency.py:run_procs sets start = now + 50 ms and writes it to the start file, but
# _proc_worker begins its closed loop as soon as it reads the file (it does not wait until
# start), so wall_ns = end - start misses the time between the file write and start. The
# callers poll the file every 1 ms, so they begin 48.8 to 50 ms before start. Throughput is
# therefore recomputed with wall + 48.8 ms (lower bound of the time) and wall + 50 ms (upper
# bound); the per-request latencies are timed per call and need no correction. Open-loop
# runs (the callers busy-wait until start + arrival) and the threads executor are correct.
import glob, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PLATFORMS, SHORT, OUT, dump  # noqa: E402

CLOUD = os.path.expanduser('~/.ss-eval/maxsim-cloud/s8')
LOCAL = os.path.expanduser('~/.ss-eval/maxsim-local')
KEEP = ('type', 'executor', 'callers', 'rate', 'thread_budget', 'n', 'wall_ns', 'throughput', 'p50_ms', 'p99_ms')


def files(platform, fam):
    pats = ([os.path.join(CLOUD, f'{platform}-[0-9]*', f'ho-conc-{fam}-ho', '*', '*.conc.json')] if platform in ('intel', 'amd', 'arm')
            else [os.path.join(LOCAL, platform, f'ho-conc-{fam}-ho', '*', '*.conc.json')])
    return sorted(f for p in pats for f in glob.glob(p))


def main():
    res = {}
    for p in PLATFORMS:
        for fam in ('agent', 'gcsn'):
            for f in files(p, fam):
                d = json.load(open(f))
                if not d.get('complete'):
                    continue
                runs = [{k: r.get(k) for k in KEEP} for r in d['runs']]
                for r in runs:
                    if r['type'] == 'closed' and r['executor'] == 'procs':
                        r['throughput_reported'] = r['throughput']
                        hi = r['n'] / ((r['wall_ns'] + 48.8e6) / 1e9)
                        lo = r['n'] / ((r['wall_ns'] + 50.0e6) / 1e9)
                        r['throughput'] = lo
                        r['throughput_bounds'] = [lo, hi]
                        r['corrected'] = True
                res.setdefault(p, {}).setdefault(fam, {})[d['arm']] = dict(cores=d.get('cores'), runs=runs)
    dump('conc.json', res)
    L = ['# Parallel callers (held-out agent-ho / gcsn-ho, previously examined)', '',
         'Closed-loop saturation: N callers replay their share back to back; throughput in calls/s; per-request p50 / p99 ms. '
         'Open-loop: Poisson arrivals at the frozen common rates (25/50/75 % of the slowest shortlisted arm\'s dev saturation), '
         'latency includes queueing. Executor: threads = one process, N threads; procs = one process per caller.', '']
    for p, fams in res.items():
        for fam, arms in fams.items():
            L += [f'## {SHORT[p]} — {fam}-ho', '', '| arm | mode | executor | callers | rate /s | throughput /s | p50 ms | p99 ms |',
                  '|---|---|---|--:|--:|--:|--:|--:|']
            for arm in sorted(arms, key=lambda a: (a != 'ours', a)):
                for r in arms[arm]['runs']:
                    L.append(f"| `{arm}` | {r['type']} | {r['executor']} | {r['callers']} | {'' if r['rate'] is None else f'{r[chr(114)+chr(97)+chr(116)+chr(101)]:.0f}'} | "
                             f"{r['throughput']:.0f} | {r['p50_ms']:.3f} | {r['p99_ms']:.3f} |")
            L.append('')
    open(os.path.join(OUT, 'conc.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
