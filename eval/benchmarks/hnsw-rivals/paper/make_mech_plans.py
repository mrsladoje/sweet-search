# Post hoc mechanism check (after the held-out runs; descriptive): what makes our binary generators fast?
# Comparison (A) with stage clocks, C 400 / H 100, held-out, one model per set kind, on ONE machine (the Mac):
#   walk:  our walk at fixed ef = 400 (no adaptive rule, no early stop, no huge pages) with bucket queues (default)
#          and with binary heaps (SS_FIX_HNSW_BUCKET=0); the same two with the production adaptive rule; FAISS
#          binary HNSW at our graph's build (M 64, efC 800) at ef = 400, on the same 512-bit codes
#   scan:  our exact scan (histogram top-C) against FAISS binary flat with its binary heap (default) and with its
#          counting top-k (use_heap = 0), sets up to 150k vectors
# Every job of a round is in one plan file, seeded random order; 5 rounds.
#   python make_mech_plans.py [--rounds 5] [--out plans/mech-mac]
import argparse, json, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(); ap.add_argument('--rounds', type=int, default=5); ap.add_argument('--out')
a = ap.parse_args()
out = os.path.join(a.out or os.path.join(HERE, 'plans', 'mech-mac'), 'heldout'); os.makedirs(out, exist_ok=True)
SETS = ['gcsn', 'd20k', 'advtest', 'fiqa', 'dall', 'quora', 'csn1m']
FIXED = {'SS_FIX_HNSW_ADAPTIVE': '0', 'SS_FIX_HNSW_HUGE': '0'}
HEAP = {'SS_FIX_HNSW_BUCKET': '0'}
builds = []
n = 0
for r in range(a.rounds):
    js = []
    for s in SETS:
        m = 'bge-base-en-v1.5' if s in ('quora', 'fiqa') else 'CodeRankEmbed'
        base = dict(set=s, model=m, split='ho', build_seed=42, kind='timing', pagecache='warm', comparison='A', C=400, H=100, round=r)
        for env in ({}, HEAP, FIXED, {**FIXED, **HEAP}):
            o = {'stages': 1}
            if env:
                o['env'] = env
            js.append(dict(base, ef=400, gen='walk', system='ours_walk', options=o))
        bh = dict(family='faiss_bin_hnsw', build_params={'M': 64, 'efC': 800})
        js.append(dict(base, **bh, ef='400', search={'ef': 400}, system='faiss_bin_hnsw', options={'stages': 1}))
        if r == 0:
            builds.append(dict(set=s, model=m, build_seed=42, **bh))
        if s not in ('quora', 'csn1m'):  # above 150k vectors our scan is the walk
            js.append(dict(base, ef=400, gen='scan', system='ours_scan', options={'stages': 1}))
            for uh in (1, 0):
                js.append(dict(base, family='faiss_bin_flat', build_params={}, search={} if uh else {'use_heap': 0},
                               system='faiss_bin_flat', options={'stages': 1}))
    random.Random(3000 + r).shuffle(js)
    json.dump(dict(step=f'mech-mac-r{r}', builds=[], jobs=js), open(os.path.join(out, f'mech--r{r}.json'), 'w'), indent=0)
    n += len(js)
json.dump(builds, open(os.path.join(os.path.dirname(out), 'builds-ho.json'), 'w'), indent=0)
print(f'{n} jobs, {len(builds)} builds -> {out}')
