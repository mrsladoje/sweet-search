# Loading and statistics shared by summarize.py, make_shortlist.py and analyze_final.py.
#
# Per arm and call: each (round, process repetition) run gives the median of its timed
# repetitions; the call's latency is the median over those runs. All individual timings
# are kept too, for per-request percentiles (the only tail latencies).
#
# Two uncertainty numbers, reported apart (PAPER_PLAN.md section 5 item 8):
#   workload  cluster bootstrap of the geometric-mean ratio: 10,000 resamples, seed 42,
#             clusters = repositories (agent sets), queries (GCSN, BEIR), calls (sweeps)
#   execution the ratio computed per process repetition (median over rounds within it):
#             min / max over the R repetitions and their coefficient of variation
import collections, glob, json, math, os, re
import numpy as np

LIBRARIES = [('numkong_native', 'numkong'), ('numkong', 'numkong'), ('maxsim_cpu', 'maxsim_cpu'), ('numpy', 'numpy'),
             ('torch', 'torch'), ('nextplaid', 'nextplaid')]
LIB_LABEL = {'numpy': 'NumPy', 'numpy+mkl': 'NumPy (MKL)', 'numpy+blis': 'NumPy (BLIS)', 'torch': 'PyTorch',
             'maxsim_cpu': 'maxsim-cpu', 'nextplaid': 'NextPlaid', 'numkong': 'NumKong (approx.)'}
FIXED = {'ours': 'sweet kernel', 'node-production': 'sweet, production path (Node)', 'node-legacy': 'previous production path',
         'node-prewarm': 'sweet, production path + prewarm', 'node-wasm': 'WASM tier', 'node-js': 'plain-JS tier'}


def family(set_name):
    if set_name.startswith('agent'):
        return 'agent'
    if set_name.startswith('gcsn'):
        return 'gcsn'
    if set_name.startswith('beir'):
        return 'beir'
    if re.match(r'q\d+-d\d+-len', set_name):
        return 'sweep'
    return 'other'


def arm_base(arm):
    """'numpy_packed@t1+mkl' -> ('numpy_packed', 1, 'mkl')."""
    env = None
    if '+' in arm:
        arm, env = arm.split('+', 1)
    base, _, t = arm.partition('@t')
    return base, int(t) if t else 0, env


def library(arm):
    base, _, env = arm_base(arm)
    for prefix, lib in LIBRARIES:
        if base.startswith(prefix):
            return f'{lib}+{env}' if env else lib
    return None


def input_type(arm, precision):
    return 'int4-self' if arm_base(arm)[0].endswith('_int4') else precision


def cluster_of(rec):
    fam = family(rec['set'])
    if fam == 'agent':
        return rec['repo']
    if fam in ('gcsn', 'beir'):
        return rec.get('query_id') or rec['file']
    return rec['file']


def load_group(gdir):
    """{arm: dict(meta, rows={(set, repo, file): rec})} for one set group directory."""
    runs = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(gdir, '*.r*.p*.json'))):
        m = re.match(r'(.+)\.r(\d+)\.p(\d+)\.json$', os.path.basename(f))
        runs[m.group(1)].append((int(m.group(2)), int(m.group(3)), json.load(open(f))))
    arms = {}
    for arm, rs in runs.items():
        rows = {}
        for rd, proc, d in rs:
            for c in d['calls']:
                k = (c['set'], c['repo'], c['file'])
                r = rows.setdefault(k, dict({x: c[x] for x in c if x not in ('ms', 'ts_ns', 'scores')}, runs={}, ts=[], scores=c.get('scores')))
                r['runs'][(rd, proc)] = c['ms']
                r['ts'] += c['ts_ns']
                r['err'] = max(r['err'], c['err'])
                r['top1'] = r['top1'] and c['top1']; r['top1_S'] = r['top1_S'] and c['top1_S']
        for r in rows.values():
            r['ms'] = float(np.median(list(r['runs'].values())))
        d0 = rs[0][2]
        arms[arm] = dict(rows=rows, env=d0['env'], contract=d0.get('contract'), clamp=d0.get('clamp'), precision=d0.get('precision'),
                         procs=sorted({p for _, p, _ in rs}), rounds=sorted({r for r, _, _ in rs}))
    return arms


def load_tag(tdir):
    """Every set group of one tag merged: {arm: ...} (a call key holds its set name)."""
    out = {}
    for g in sorted(glob.glob(os.path.join(tdir, '*', 'jobs.json'))):
        for arm, d in load_group(os.path.dirname(g)).items():
            if arm in out:
                out[arm]['rows'].update(d['rows'])
            else:
                out[arm] = d
    return out


_rng = np.random.default_rng(42)


def geomean_ratio(o, b):
    return math.exp(np.mean(np.log(np.asarray(o) / np.asarray(b))))


def cluster_bootstrap(o, b, clusters, n=10000, seed=42):
    """Geometric-mean ratio of o / b with a 95% interval, resampling clusters."""
    rng = np.random.default_rng(seed)
    lr = np.log(np.asarray(o) / np.asarray(b))
    ids = {c: i for i, c in enumerate(dict.fromkeys(clusters))}
    cid = np.array([ids[c] for c in clusters])
    k = len(ids)
    sums = np.bincount(cid, weights=lr, minlength=k); cnts = np.bincount(cid, minlength=k).astype(float)
    pick = rng.integers(0, k, size=(n, k))
    bs = np.exp(sums[pick].sum(1) / cnts[pick].sum(1))
    return math.exp(lr.mean()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5)), k


def per_proc_ratios(arm_d, base_d, keys):
    """Geometric-mean ratio per process repetition (each: median over its rounds)."""
    out = []
    procs = sorted(set(arm_d['procs']) & set(base_d['procs']))
    for p in procs:
        o = [np.median([v for (rd, pp), v in arm_d['rows'][k]['runs'].items() if pp == p]) for k in keys]
        b = [np.median([v for (rd, pp), v in base_d['rows'][k]['runs'].items() if pp == p]) for k in keys]
        out.append(geomean_ratio(o, b))
    return out


def per_request(rows):
    ts = np.concatenate([np.asarray(r['ts'], float) for r in rows]) / 1e6
    return np.percentile(ts, 50), np.percentile(ts, 95), np.percentile(ts, 99)


def load_shortlist(path):
    return json.load(open(path)) if path and os.path.exists(path) else None


def shortlist_pick(sl, fam, lib, itype, single=False):
    """The frozen configuration of one library and input type for a workload family."""
    if not sl:
        return None
    cfg = sl['families'].get(fam, {}).get(lib, {}).get(itype)
    if not cfg:
        return None
    return cfg.get('single') if single else cfg['primary']


def spec_to_file(spec):
    return spec.replace(':', '-').replace('@', '@t').replace('%', '+')
