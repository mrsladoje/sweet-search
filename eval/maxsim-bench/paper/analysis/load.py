# venv/bin/python -I paper/analysis/load.py <platform> [...]     (intel amd arm m3max epyc, <type>-replica, <type>-r2)
#
# Post-freeze analysis code (not frozen). Builds one cache per platform and tag from the
# held-out result tree, with the loading rules of results_lib.py / summarize.py (per call:
# median over the (round, process) runs; shards of one type merged, each set lives on one
# shard). The cache holds per-call arrays so that the table scripts can compute aggregates
# without parsing 19 GB of JSON again. It lives OUTSIDE the repository
# (~/.ss-eval/maxsim-analysis/cache/) and is never printed: held-out rows are read only as
# inputs to aggregates (CLAUDE.md, Benchmark Methodology).
import glob, json, os, pickle, re, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, BENCH)
import results_lib as rl  # noqa: E402

HOME = os.path.expanduser('~')
CLOUD = os.path.join(HOME, '.ss-eval/maxsim-cloud/s8')
LOCAL = os.path.join(HOME, '.ss-eval/maxsim-local')
R2 = os.path.join(HOME, '.ss-eval/maxsim-cloud/r2')
CACHE = os.path.join(HOME, '.ss-eval/maxsim-analysis/cache')
TAGS = ('ho-warm', 'ho-parked', 'ho-tiers')


def roots(platform):
    if platform in ('intel', 'amd', 'arm'):
        return sorted(glob.glob(os.path.join(CLOUD, f'{platform}-[0-9]*')), key=lambda x: int(x.rsplit('-', 1)[1]))
    if platform.endswith('-replica'):
        return [os.path.join(CLOUD, platform)]
    if platform.endswith('-r2'):            # post-freeze BEIR rerun: <type>-r2a (k = 100 sets), <type>-r2b (k = 25 sets)
        return sorted(glob.glob(os.path.join(R2, f'{platform}[ab]')))
    return [os.path.join(LOCAL, platform)]


def merged_tag(rts, tag):
    out = {}
    for r in rts:
        if not os.path.isdir(os.path.join(r, tag)):
            continue
        for arm, d in rl.load_tag(os.path.join(r, tag)).items():
            if arm in out:
                out[arm]['rows'].update(d['rows'])
                out[arm]['procs'] = sorted(set(out[arm]['procs']) | set(d['procs']))
                out[arm]['rounds'] = sorted(set(out[arm]['rounds']) | set(d['rounds']))
            else:
                out[arm] = d
    return out


def compact(arms):
    """{set: {'keys', 'clusters', 'shape', 'arms': {arm: stats}}} with arrays aligned to the set's keys."""
    sets = {}
    for arm, d in arms.items():
        for k in d['rows']:
            sets.setdefault(k[0], set()).add(k)
    out = {}
    for s, keyset in sets.items():
        keys = sorted(keyset)
        ref = [next(d['rows'][k] for d in arms.values() if k in d['rows']) for k in keys]
        entry = dict(keys=keys, clusters=[rl.cluster_of(r) for r in ref],
                     shape=dict(nq=np.array([r.get('nq', 0) for r in ref]), pool=np.array([r.get('pool', 0) for r in ref]),
                                tokens=np.array([r.get('tokens', 0) for r in ref])), arms={})
        for arm, d in arms.items():
            if not all(k in d['rows'] for k in keys):
                continue
            rs = [d['rows'][k] for k in keys]
            procs = sorted(d['procs'])
            proc_ms = {p: np.array([np.median([v for (rd, pp), v in r['runs'].items() if pp == p] or [np.nan]) for r in rs]) for p in procs}
            # every run per call, columns in (round, process) order, for estimators that need them (jackknife over processes)
            run_keys = sorted({k for r in rs for k in r['runs']})
            runs = np.array([[r['runs'].get(k, np.nan) for k in run_keys] for r in rs])
            ts = np.concatenate([np.asarray(r['ts'], float) for r in rs]) / 1e6
            entry['arms'][arm] = dict(
                ms=np.array([r['ms'] for r in rs]), proc_ms=proc_ms, runs=runs, run_keys=run_keys,
                req=(float(np.percentile(ts, 50)), float(np.percentile(ts, 95)), float(np.percentile(ts, 99))), n_timed=int(ts.size),
                err=float(max(r['err'] for r in rs)), err_input=float(max(r.get('err_input', 0) for r in rs)),
                top1=float(np.mean([r['top1'] for r in rs])), top1_S=float(np.mean([r['top1_S'] for r in rs])),
                top10_S=float(np.mean([r.get('top10_S', np.nan) for r in rs])),
                contract=d['contract'], clamp=d['clamp'], precision=d['precision'], rounds=d['rounds'], procs=procs,
                env={x: v for x, v in d['env'].items() if x not in ('sets',)})
        out[s] = entry
    return out


def build(platform):
    rts = roots(platform)
    if not rts or not all(os.path.isdir(r) for r in rts):
        sys.exit(f'{platform}: no result roots')
    os.makedirs(CACHE, exist_ok=True)
    for tag in TAGS:
        arms = merged_tag(rts, tag)
        if not arms:
            continue
        c = compact(arms)
        pickle.dump(c, open(os.path.join(CACHE, f'{platform}-{tag}.pkl'), 'wb'), protocol=pickle.HIGHEST_PROTOCOL)
        print(f'{platform} {tag}: {len(c)} sets, {len(arms)} arms')


if __name__ == '__main__':
    for p in sys.argv[1:]:
        build(p)
