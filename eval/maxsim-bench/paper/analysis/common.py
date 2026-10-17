# Post-freeze analysis code (not frozen): shared helpers for the paper tables.
# Reads the caches of load.py; prints and writes aggregates only.
import json, math, os, pickle, re, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, BENCH)
import results_lib as rl  # noqa: E402

CACHE = os.path.expanduser('~/.ss-eval/maxsim-analysis/cache')
OUT = os.path.join(HERE, 'tables')
PLATFORMS = ['intel', 'amd', 'arm', 'm3max', 'epyc']
LABEL = {'intel': 'Xeon 6 (Granite Rapids)', 'amd': 'EPYC 9R45 (Zen 5)', 'arm': 'Graviton4',
         'm3max': 'Apple M3 Max', 'epyc': 'EPYC Milan (Zen 3)'}
SHORT = {'intel': 'Intel', 'amd': 'AMD', 'arm': 'Graviton4', 'm3max': 'M3 Max', 'epyc': 'EPYC'}
LIB_ORDER = ['numpy', 'numpy+blis', 'numpy+mkl', 'torch', 'maxsim_cpu', 'nextplaid', 'numkong']
LIB_NAME = {'numpy': 'NumPy', 'numpy+blis': 'NumPy (BLIS)', 'numpy+mkl': 'NumPy (MKL)', 'torch': 'PyTorch',
            'maxsim_cpu': 'maxsim-cpu', 'nextplaid': 'NextPlaid', 'numkong': 'NumKong (approx.)'}
FAMILY_SETS = {'agent': ['agent-ho'], 'gcsn': ['gcsn-ho']}


def available(platform, tag='ho-warm'):
    return os.path.exists(os.path.join(CACHE, f'{platform}-{tag}.pkl'))


_cache = {}


def cache(platform, tag='ho-warm'):
    k = (platform, tag)
    if k not in _cache:
        p = os.path.join(CACHE, f'{platform}-{tag}.pkl')
        _cache[k] = pickle.load(open(p, 'rb')) if os.path.exists(p) else {}
    return _cache[k]


def shortlist(platform):
    return json.load(open(os.path.join(BENCH, f'shortlist-{platform}.json')))


def frozen(platform, fam, lib, itype, single=False):
    """Result-file arm name of the frozen configuration, or None."""
    spec = rl.shortlist_pick(shortlist(platform), fam, lib, itype, single)
    return rl.spec_to_file(spec) if spec else None


def frozen_rivals(platform, fam, single=False):
    """[(lib, itype, [arms])] of the frozen shortlist for a workload family: the primary and the
    'also' configurations (two fastest on development data), or the one-thread configuration."""
    out = []
    fams = shortlist(platform)['families'].get(fam, {})
    for lib in sorted(fams, key=lambda x: LIB_ORDER.index(x) if x in LIB_ORDER else 99):
        for it, cfg in fams[lib].items():
            specs = [cfg.get('single')] if single else [cfg.get('primary')] + list(cfg.get('also') or [])
            arms = [rl.spec_to_file(x) for x in specs if x]
            if arms:
                out.append((lib, it, arms))
    return out


def family(s):
    return rl.family(s)


def beir_sets(c):
    return sorted(s for s in c if s.startswith('beir-'))


def sweep_sets(c):
    return sorted(s for s in c if family(s) == 'sweep')


def pooled(c, sets, arm, base='ours'):
    """Aligned per-call arrays over several sets: (o, b, clusters, proc_o, proc_b) or None if the arm misses a set."""
    o, b, cl, po, pb = [], [], [], {}, {}
    for s in sets:
        e = c.get(s)
        if not e or arm not in e['arms'] or base not in e['arms']:
            return None
        A, B = e['arms'][arm], e['arms'][base]
        o.append(A['ms']); b.append(B['ms'])
        cl += [(s.split('-')[1] if s.startswith('beir-') else '', x) for x in e['clusters']]
        for p in set(A['proc_ms']) & set(B['proc_ms']):
            po.setdefault(p, []).append(A['proc_ms'][p]); pb.setdefault(p, []).append(B['proc_ms'][p])
    return (np.concatenate(o), np.concatenate(b), cl,
            {p: np.concatenate(v) for p, v in po.items() if len(v) == len(sets)},
            {p: np.concatenate(v) for p, v in pb.items() if len(v) == len(sets)})


def jackknife(c, sets, arm, base='ours'):
    """Execution spread with the point estimator itself: leave one process repetition out, take
    per call the median of the remaining runs of each arm, then the geometric-mean ratio."""
    # runs aligned by (round, process) key over the sets; a run missing in a set is NaN there
    o_keys = sorted({k for s in sets for k in c[s]['arms'][arm]['run_keys']})
    b_keys = sorted({k for s in sets for k in c[s]['arms'][base]['run_keys']})

    def aligned(x, keys):
        out = np.full((x['runs'].shape[0], len(keys)), np.nan)
        for j, k in enumerate(x['run_keys']):
            out[:, keys.index(k)] = x['runs'][:, j]
        return out
    O = np.concatenate([aligned(c[s]['arms'][arm], o_keys) for s in sets])
    Bm = np.concatenate([aligned(c[s]['arms'][base], b_keys) for s in sets])
    procs = sorted({p for _, p in o_keys} & {p for _, p in b_keys})
    out = []
    for p in procs:
        oi = [i for i, (_, pp) in enumerate(o_keys) if pp != p]
        bi = [i for i, (_, pp) in enumerate(b_keys) if pp != p]
        out.append(rl.geomean_ratio(np.nanmedian(O[:, oi], axis=1), np.nanmedian(Bm[:, bi], axis=1)))
    return out


def ratio(c, sets, arm, base='ours'):
    """Geometric-mean ratio arm / base with the workload interval, the execution spread
    (leave-one-process-out, same estimator), the total-time ratio, and for agent sets the
    per-repository range."""
    r = pooled(c, sets, arm, base)
    if r is None:
        return None
    o, b, cl, po, pb = r
    g, lo, hi, k = rl.cluster_bootstrap(o, b, cl)
    jk = jackknife(c, sets, arm, base)
    pp = [rl.geomean_ratio(po[p], pb[p]) for p in sorted(po)]
    out = dict(ratio=g, lo=lo, hi=hi, clusters=k, calls=int(len(o)), spread=(min(jk), max(jk)) if jk else None, R=len(jk),
               spread_frozen=(min(pp), max(pp)) if pp else None, total_ratio=float(o.sum() / b.sum()),
               faster_share=float(np.mean(b < o)), p50_arm=float(np.median(o)), p50_base=float(np.median(b)))
    if sets == ['agent-ho']:
        reps = {}
        for x, ob, bb in zip(cl, o, b):
            reps.setdefault(x[1], []).append((ob, bb))
        per = [rl.geomean_ratio([u for u, _ in v], [w for _, w in v]) for v in reps.values()]
        out['repo_range'] = (min(per), max(per))
        out['repo_loo'] = (min(rl.geomean_ratio([u for kk, v in reps.items() if kk != drop for u, _ in v],
                                                [w for kk, v in reps.items() if kk != drop for _, w in v]) for drop in reps),
                           max(rl.geomean_ratio([u for kk, v in reps.items() if kk != drop for u, _ in v],
                                                [w for kk, v in reps.items() if kk != drop for _, w in v]) for drop in reps))
    # "faster" needs the workload interval and both execution views (leave-one-process-out and
    # the frozen per-process estimates) on one side of 1
    out['rival_faster'] = bool(hi < 1 and jk and max(jk) < 1 and (not pp or max(pp) < 1))
    out['sweet_faster'] = bool(lo > 1 and jk and min(jk) > 1 and (not pp or min(pp) > 1))
    out['outside_frozen_spread'] = bool(pp and not (min(pp) <= g <= max(pp)))
    return out


def arm_stats(c, sets, arm):
    rows = [c[s]['arms'][arm] for s in sets if arm in c.get(s, {}).get('arms', {})]
    if len(rows) != len(sets):
        return None
    w = np.array([len(r['ms']) for r in rows], float)
    return dict(err=max(r['err'] for r in rows), err_input=max(r['err_input'] for r in rows),
                top1_S=float(np.average([r['top1_S'] for r in rows], weights=w)),
                top10_S=float(np.average([r['top10_S'] for r in rows], weights=w)),
                top1=float(np.average([r['top1'] for r in rows], weights=w)),
                contract=rows[0]['contract'], clamp=rows[0]['clamp'], precision=rows[0]['precision'])


def fmt_ratio(d, digits=2):
    if not d:
        return '—'
    s = f"{d['ratio']:.{digits}f} [{d['lo']:.{digits}f}, {d['hi']:.{digits}f}]"
    if d.get('spread'):
        s += f" ({d['spread'][0]:.{digits}f}–{d['spread'][1]:.{digits}f})"
    return s


def dump(name, obj):
    os.makedirs(OUT, exist_ok=True)
    json.dump(obj, open(os.path.join(OUT, name), 'w'), indent=1, default=lambda x: float(x) if isinstance(x, np.floating) else str(x))


def parse_cell(s):
    q, d, ln = re.match(r'q(\d+)-d(\d+)-len(\w+)', s).groups()
    return int(q), int(d), ln
