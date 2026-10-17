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
    """[(lib, itype, arm)] of the frozen shortlist for a workload family."""
    out = []
    fams = shortlist(platform)['families'].get(fam, {})
    for lib in sorted(fams, key=lambda x: LIB_ORDER.index(x) if x in LIB_ORDER else 99):
        for it in fams[lib]:
            a = frozen(platform, fam, lib, it, single)
            if a:
                out.append((lib, it, a))
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


def ratio(c, sets, arm, base='ours'):
    """Geometric-mean ratio arm / base with the workload interval and the execution spread."""
    r = pooled(c, sets, arm, base)
    if r is None:
        return None
    o, b, cl, po, pb = r
    g, lo, hi, k = rl.cluster_bootstrap(o, b, cl)
    pp = [rl.geomean_ratio(po[p], pb[p]) for p in sorted(po)]
    return dict(ratio=g, lo=lo, hi=hi, clusters=k, calls=int(len(o)), spread=(min(pp), max(pp)) if pp else None, R=len(pp),
                faster_share=float(np.mean(b < o)), p50_arm=float(np.median(o)), p50_base=float(np.median(b)))


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
