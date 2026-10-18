# venv/bin/python -I paper/analysis/post_checks.py
#
# Post-freeze analysis code (not frozen). Collects the checks of 2026-10-18, all aggregates only:
#   rerun/int4_300.py     int4 at 180 and 300 tokens, ColBERTv2, M3 Max (K - F and C-b - F)
#   rerun/conc_check.py   scores of concurrent calls against one-at-a-time calls, M3 Max and EPYC
#   rerun/pipeline.mjs    stage shares of the production search path, held-out agent calls, M3 Max
#   rerun/concurrency2.py the M3 Max parallel-caller recheck, closed-loop throughput per pass
#   rerun/nk_harness.py   EPYC: NumKong and the kernel per warm-up count (development agent calls)
#   rerun/nk_harness2.py  EPYC: every arm under five call protocols (development agent calls)
# Writes tables/post_checks.json.
import glob, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dump  # noqa: E402

LOCAL = os.path.expanduser('~/.ss-eval/maxsim-local/rerun2')
CONC = {'m3max': 'conc-check-m3max-{}.json', 'epyc': 'epyc/conc-check-{}.json'}


def rel(f):
    return os.path.relpath(f, os.path.expanduser('~'))


def main():
    res = {}
    f = os.path.join(LOCAL, 'int4_300.json')
    if os.path.exists(f):
        d = json.load(open(f))
        res['int4_300'] = dict(source=rel(f), **{k: d[k] for k in ('model', 'revision', 'k', 'delta', 'seed', 'bootstrap_resamples')}, results=d['results'])
        for k, v in d['results'].items():
            print('int4_300', k, 'K-F', round(v['K_vs_F']['mean_diff'], 4), [round(x, 4) for x in v['K_vs_F']['ci95']])
    cc = {}
    for m, pat in CONC.items():
        for s in ('agent-ho', 'gcsn-ho'):
            f = os.path.join(LOCAL, pat.format(s))
            if not os.path.exists(f):
                continue
            d = json.load(open(f))
            R = d['results']
            cc[f'{m}|{s}'] = dict(source=rel(f), calls=d['calls'], callers=d['callers'], executors=d['executors'], rows=len(R), ok=d['ok'],
                                  arms=sorted({r['arm'] for r in R}),
                                  max_diff_vs_sequential=max(r['max_diff_vs_sequential'] for r in R),
                                  calls_differing=sum(r['calls_differing_from_sequential'] for r in R),
                                  nonfinite_concurrent=sum(r['nonfinite_calls_concurrent'] for r in R),
                                  max_err_ref={r['arm']: max(x['max_err_ref_concurrent'] for x in R if x['arm'] == r['arm']) for r in R},
                                  bound={r['arm']: r['bound'] for r in R})
            print('conc_check', m, s, 'ok', d['ok'], 'max diff', cc[f'{m}|{s}']['max_diff_vs_sequential'])
    if cc:
        res['conc_check'] = cc
    f = os.path.join(LOCAL, 'pipeline-ho.json')
    if os.path.exists(f):
        d = json.load(open(f))
        res['pipeline'] = dict(source=rel(f), **{k: d[k] for k in ('split', 'passes', 'encoder', 'note', 'codes', 'calls_with_maxsim', 'all_calls', 'by_tool') if k in d})
        st = d['calls_with_maxsim']['stages']
        print('pipeline', {k: round(v['share_median'], 4) for k, v in st.items()})
    # M3 Max parallel-caller recheck: closed-loop throughput per pass (conc2.py pools the passes)
    m3 = {}
    for f in sorted(glob.glob(os.path.join(LOCAL, 'm3conc', 'pass*', 'm3max', '*', '*', '*.conc2.json'))):
        d = json.load(open(f))
        ps = f.split(os.sep + 'm3conc' + os.sep)[1].split(os.sep)[0]
        for r in d['runs']:
            if r['type'] == 'closed':
                m3.setdefault(f"{d['set']}|{d['arm']}|{r['executor']}|{r['callers']}", {})[ps] = r['throughput']
    if m3:
        log = open(os.path.join(LOCAL, 'run-m3conc.log')).read()
        busy = [float(x) for x in re.findall(r'last sample ([0-9.]+)% busy', log)]
        res['m3conc'] = dict(source=rel(os.path.join(LOCAL, 'm3conc')), passes=3, closed=m3, quiet_busy_pct=[min(busy), max(busy)],
                             thermal_warnings=len(re.findall(r'therm: \S', log)))
        print('m3conc', len(m3), 'cells; busy', min(busy), max(busy))
    # EPYC: NumKong and the kernel per warm-up count (rerun/nk_harness.py, development agent calls)
    f = os.path.join(LOCAL, 'epyc-nkgap', 'warm-sweep.json')
    if os.path.exists(f):
        d = json.load(open(f))
        calls = len(json.load(open(os.path.join(LOCAL, 'epyc-nkgap', 'warm-1-ours.json')))['ts_us'])
        res['epyc_warmup'] = dict(source=rel(f), set=d['set'], reps=d['reps'], protocol=d['protocol'], p50_by_warmup=d['p50_by_warmup'], calls=calls)
        print('epyc warm-up', d['p50_by_warmup'])
    # EPYC: every arm under five call protocols (rerun/nk_harness2.py, development agent calls)
    f = os.path.join(LOCAL, 'epyc-nkgap2', 'nk_harness2.json')
    if os.path.exists(f):
        d = json.load(open(f))
        res['epyc_protocols'] = dict(source=rel(f), set=d['set'], summary=d['summary'],
                                     protocols={'main': 'prepare, 1 warm-up, 5 timed (bench.py)', 'A': 'all prepared first, each call timed once, back to back',
                                                'Arev': 'A in reversed call order', 'Aw': 'A after one untimed pass over all calls', 'B': 'prepare, then time once'})
        print('epyc protocols', {a: {p: round(sum(v) / len(v), 1) for p, v in x.items()} for a, x in d['summary'].items()})
    dump('post_checks.json', res)


if __name__ == '__main__':
    main()
