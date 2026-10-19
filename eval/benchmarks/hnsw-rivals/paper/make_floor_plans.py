# Replication, post hoc (after the held-out run, descriptive): CQADupStack dev sweep BELOW the shared effort grid for
# the rival families frozen at its floor (effort 50), to see whether a lower effort keeps f = 0.99 and is faster.
# Same builds, harness, warm cache and fault rule as the replication dev runs; efforts 10..50 (50 again as the
# in-run reference) and our two lowest stage-1 sizes as a second reference. 3 rounds, one plan file per round.
#   python make_floor_plans.py --type intel|amd|arm [--out plans/repf-<type>]
import argparse, json, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(); ap.add_argument('--type', required=True); ap.add_argument('--out'); ap.add_argument('--rounds', type=int, default=3)
a = ap.parse_args()
S, MODEL, KV = 'cqadup', 'bge-base-en-v1.5', 10
EFF = [10, 15, 20, 25, 30, 40, 50]
FAM = {'faiss_hnsw_flat': {'M': 64, 'efC': 800}, 'faiss_hnsw_sq8': {'M': 64, 'efC': 800}, 'usearch_f16': {'M': 64, 'efC': 800}}
if a.type == 'intel':
    FAM['svs_vamana_lvq'] = {'degree': 64}
out = os.path.join(a.out or os.path.join(HERE, 'plans', f'repf-{a.type}'), 'dev'); os.makedirs(out, exist_ok=True)


def job(system, rnd, **kw):
    j = dict(set=S, model=MODEL, split='dev', comparison='B', system=system, round=rnd, kind='timing', build_seed=42,
             pagecache='warm', kv=KV, options={'faultcheck': 1})
    j.update(kw)
    return j


n = 0
for r in range(a.rounds):
    js = []
    for f, bp in FAM.items():
        for e in EFF:
            sps = [dict(ef=e, refine=x) for x in (2, 10)] if f == 'faiss_hnsw_sq8' else [{'window': e}] if f.startswith('svs_') else [dict(ef=e)]
            js += [job(f, r, family=f, build_params=bp, search=sp) for sp in sps]
    js += [job('ours_cascade', r, S1=s1, EF=s1) for s1 in (150, 200)]
    random.Random(2000 + r).shuffle(js)
    json.dump(dict(step=f'repf-dev-{a.type}-{S}-r{r}', builds=[], jobs=js), open(os.path.join(out, f'{S}--r{r}.json'), 'w'), indent=0)
    n += len(js)
print(f'{a.type}: {n} jobs -> {out}')
