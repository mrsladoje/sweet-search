# Replication plans (../REPLICATION_PLAN.md).
#   python make_rep_plans.py --mode build|dev|heldout --type intel|amd|arm --data DATA [--out plans/rep-<type>]
# build    one build per rival family (the rule of section 2) + our index, for both sets
# dev      comparison (B) dev sweep, 3 rounds; one plan file per (set, round), all systems, seeded order
# heldout  the frozen points of shortlists/shortlist-rep-<type>.json: ours, the dev rival, every other frozen rival
#          point, our shipped default, our native clocks; R rounds; one plan file per (set, round), seeded order
import argparse, json, math, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from grid import EF_SWEEP as EF0, REFINE, nprobes  # noqa: E402

S1_GRID = [50, 100, 150, 200, 300, 400, 600, 1000, 1500, 2000, 3000]
EF_SWEEP = S1_GRID  # replication: every effort-type family gets the same 11 values as our S1 grid (equal density, up to 3000)

ap = argparse.ArgumentParser()
ap.add_argument('--mode', required=True); ap.add_argument('--type', required=True); ap.add_argument('--data', required=True)
ap.add_argument('--out'); ap.add_argument('--dev-rounds', type=int, default=3)
a = ap.parse_args()
SETS = ['cqadup', 'msmarco1m']
MODEL = 'bge-base-en-v1.5'
N_INST = 6  # held-out: 6 instances per CPU type, each runs 2 paired blocks (rounds 2i and 2i+1) of both sets
out = a.out or os.path.join(HERE, 'plans', f'rep-{a.type}'); mode_dir = os.path.join(out, a.mode); os.makedirs(mode_dir, exist_ok=True)
OPTS = {'faultcheck': 1}


def n_of(s):
    return json.load(open(os.path.join(a.data, 'sets', s, 'set.json')))['n_vectors']


def kv_of(s):
    st = json.load(open(os.path.join(a.data, 'sets', s, 'set.json'))); kv = st.get('k_v')
    kv = kv.get(MODEL) if isinstance(kv, dict) else kv
    if not kv:
        sys.exit(f'{s}: no k_v in set.json (run kv.py on dev first)')
    return int(kv)


def builds(s):
    n = n_of(s); sq = int(round(math.sqrt(n)))
    b = {'diskann_vamana': {'L': 200, 'R': 96, 'alpha': 1.2}, 'faiss_bin_hnsw': {'M': 64, 'efC': 800},
         'faiss_hnsw_flat': {'M': 64, 'efC': 800}, 'faiss_hnsw_sq8': {'M': 64, 'efC': 800},
         'faiss_rabitq_hnsw': {'M': 64, 'efC': 200}, 'hnswlib_f32': {'M': 64, 'efC': 200},
         'usearch_b1_rescore': {'M': 32, 'efC': 800}, 'usearch_f16': {'M': 64, 'efC': 800}, 'usearch_i8': {'M': 32, 'efC': 800},
         'scann': {'leaves': sq, 'mode': 'tree_ah', 'soar': 1}, 'faiss_ivfpq_fs': {'nlist': sq}, 'faiss_rabitq_ivf': {'nlist': sq},
         'faiss_bin_flat': {}, 'faiss_rabitq_flat': {}}  # exact search: no rival, no timing needed (Q_exact from gt.py)
    if a.type == 'intel':
        b.update({'svs_vamana_lvq': {'degree': 64}, 'svs_vamana_leanvec': {'degree': 64}})
    if a.type == 'arm':
        b.pop('diskann_vamana')
    return b


def b_points(fam, bp, kv):  # the main study's declared search grids (plan.py b_points)
    if fam == 'faiss_exact':
        return [{}]
    if fam == 'faiss_bin_flat':
        return [dict(refine=kv * r) for r in REFINE]
    if fam == 'faiss_rabitq_flat':
        return [dict(refine=r) for r in REFINE]
    if fam in ('faiss_rabitq_ivf', 'faiss_ivfpq_fs'):
        probes = sorted(set(nprobes(bp['nlist'])) | {bp['nlist'] // 2, bp['nlist']})
        return [dict(nprobe=p, refine=r) for p in probes for r in (5, 20)]
    if fam == 'faiss_bin_hnsw':
        return [dict(ef=e, refine=kv * r) for e in EF_SWEEP for r in (5, 20)]
    if fam in ('faiss_hnsw_sq8', 'faiss_rabitq_hnsw'):
        return [dict(ef=e, refine=r) for e in EF_SWEEP for r in (2, 10)]
    if fam == 'usearch_b1_rescore':
        return [dict(ef=e, rescore=kv * r) for e in EF_SWEEP for r in (5, 20)]
    if fam == 'diskann_vamana':
        return [{'L': e} for e in EF_SWEEP if e >= kv]
    if fam.startswith('svs_'):
        return [{'window': e} for e in EF_SWEEP if e >= kv]
    if fam == 'scann':
        return [dict(leaves_to_search=max(1, int(bp['leaves'] * f)), reorder=kv * r) for f in (0.01, 0.03, 0.1, 0.3, 0.5, 1.0) for r in (10, 50)]
    return [dict(ef=e) for e in EF_SWEEP if e >= kv]


def job(s, split, system, rnd, kv, kind='timing', **kw):
    j = dict(set=s, model=MODEL, split=split, comparison='B', system=system, round=rnd, kind=kind, build_seed=42,
             pagecache='warm', kv=kv, options=dict(OPTS))
    j.update(kw)
    return j


def write(name, step, bl, js, seed):
    random.Random(seed).shuffle(js)  # paired block, seeded random order (section 3.2)
    json.dump(dict(step=step, builds=bl, jobs=js), open(os.path.join(mode_dir, name + '.json'), 'w'), indent=0)


nj = 0
for s in SETS:
    if a.mode == 'build':
        bl = [dict(set=s, model=MODEL, family='ours', build_seed=42)] + \
             [dict(set=s, model=MODEL, family=f, build_params=bp, build_seed=42) for f, bp in builds(s).items()]
        json.dump(dict(step=f'rep-build-{s}', builds=bl, jobs=[]), open(os.path.join(mode_dir, f'{s}.json'), 'w'), indent=0)
        nj += len(bl); continue
    kv = kv_of(s)
    if a.mode == 'dev':
        for r in range(a.dev_rounds):
            js = []
            for f, bp in builds(s).items():
                for sp in b_points(f, bp, kv):
                    js.append(job(s, 'dev', f, r, kv, family=f, build_params=bp, search=sp))
            floor = min(400, 1.5 * max(40, 10 * kv))  # the product's own stage-1 floor for k = k_v: no bench override
            for S1 in S1_GRID:
                if S1 >= floor:
                    js.append(job(s, 'dev', 'ours_cascade', r, kv, S1=S1, EF=max(S1, 50)))
            write(f'{s}--r{r}', f'rep-dev-{a.type}-{s}-r{r}', [], js, 1000 + r); nj += len(js)
    elif a.mode == 'heldout':
        sl = json.load(open(os.path.join(HERE, 'shortlists', f'shortlist-rep-{a.type}.json')))[s]
        for r in range(2 * N_INST):
            js = []
            for p in sl['points']:
                js.append(job(s, 'ho', p['system'], r, kv, **{k: v for k, v in p.items() if k != 'system'}))
            o = next(p for p in sl['points'] if p['system'] == 'ours_cascade')
            if o.get('S1') != 400:
                js.append(job(s, 'ho', 'ours_cascade', r, kv, S1=400, EF=400))  # shipped default (descriptive)
            js.append(job(s, 'ho', 'ours_cascade', r, kv, kind='native', **{k: v for k, v in o.items() if k != 'system'}))
            inst_dir = os.path.join(out + f'-i{r // 2}', 'heldout'); os.makedirs(inst_dir, exist_ok=True)  # instance r // 2
            random.Random(1000 + r).shuffle(js)
            json.dump(dict(step=f'rep-heldout-{a.type}-{s}-r{r}', builds=[], jobs=js), open(os.path.join(inst_dir, f'{s}--r{r}.json'), 'w'), indent=0)
            nj += len(js)
print(f'{a.mode} {a.type}: {nj} jobs/builds -> {mode_dir}', file=sys.stderr)
