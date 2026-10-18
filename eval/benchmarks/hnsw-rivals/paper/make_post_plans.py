# Post-freeze plans (after the held-out run; reported apart from the pre-registered results). Two experiments
# the reviews asked for, on the held-out split, with the frozen builds and the frozen operating points:
#  PA  comparison (A) with stage clocks (query conversion | generator | screen + rescoring), C 400 / H 100, one
#      model per set kind; every declared effort of every (A) generator (the frozen shortlist's A list), plus the
#      graph families at the M 64 / efC 800 build (our graph's build), plus our walk with fixed ef, no early
#      termination and no huge pages (SS_FIX_HNSW_ADAPTIVE=0, SS_FIX_HNSW_HUGE=0); 5 rounds.
#  PB  comparison (B) on Quora and csn1m, every model, f = 0.99: our frozen point, the rival fastest on dev
#      (paperlib.headline rule, frozen point), our shipped default (S1 = EF = 400) and our frozen point with
#      native-only clocks (kind native); R rounds of the CPU type; page faults are in every record (memory).
#   python make_post_plans.py --type intel [--rounds-a 5] [--out plans/p-intel]
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from paperlib import dev_latency  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--type', required=True); ap.add_argument('--rounds-a', type=int, default=5); ap.add_argument('--out')
a = ap.parse_args()
sl = json.load(open(os.path.join(HERE, 'shortlists', f'shortlist-{a.type}.json')))
R = sl['meta']['R']
out = a.out or os.path.join(HERE, 'plans', f'p-{a.type}'); os.makedirs(os.path.join(out, 'heldout'), exist_ok=True)
SETS = ['gcsn', 'd20k', 'advtest', 'fiqa', 'dall', 'quora', 'csn1m']
GRAPH64 = ('faiss_bin_hnsw', 'usearch_b1_rescore', 'hnswlib_f32', 'faiss_hnsw_flat')
FIXED = {'SS_FIX_HNSW_ADAPTIVE': '0', 'SS_FIX_HNSW_HUGE': '0'}
files = {}


def add(name, j):
    files.setdefault(name, []).append(j)


njobs = 0
for s in SETS:
    m = 'bge-base-en-v1.5' if s in ('quora', 'fiqa') else 'CodeRankEmbed'
    if m not in sl.get(s, {}):
        continue
    base = dict(set=s, model=m, split='ho', build_seed=42, kind='timing', pagecache='warm', comparison='A')
    pts = [p for p in sl[s][m]['A'] if p.get('C') == 400 and p.get('H') == 100]
    extra = []
    for p in pts:
        if p['system'] in GRAPH64:
            extra.append(dict(p, build_params={'M': 64, 'efC': 800}))
        if p['system'] == 'ours_walk':
            extra.append(dict(p, options={'stages': 1, 'env': FIXED}))
    for r in range(a.rounds_a):
        for p in pts + extra:
            if p['system'] == 'ours_scan' and s in ('quora', 'csn1m'):
                continue  # above 150k vectors our scan is the walk
            opts = dict(p.get('options') or {}); opts['stages'] = 1
            add(f'A--{s}--r{r}', dict(base, **{k: v for k, v in p.items() if k != 'options'}, round=r, options=opts))
    # PB: large sets, every model
for s in ('quora', 'csn1m'):
    for m, e in sl.get(s, {}).items():
        sel = e['selection']
        base = dict(set=s, model=m, split='ho', build_seed=42, pagecache='warm', comparison='B', kv=e['k_v'])
        o = (sel.get('ours_cascade') or {}).get('0.99')
        riv = sorted((dev_latency(a.type, s, m, k, 0.99), k) for k, v in sel.items()
                     if not k.startswith('ours') and k != 'faiss_exact' and (v or {}).get('0.99'))
        riv = [x for x in riv if x[0] is not None]
        for r in range(R):
            if o:
                add(f'B--{s}--{m}--r{r}', dict(base, kind='timing', round=r, **o['point']))
                add(f'B--{s}--{m}--r{r}', dict(base, kind='native', round=r, **o['point']))
            add(f'B--{s}--{m}--r{r}', dict(base, kind='timing', round=r, system='ours_cascade', S1=400, EF=400))
            if riv:
                add(f'B--{s}--{m}--r{r}', dict(base, kind='timing', round=r, **sel[riv[0][1]]['0.99']['point']))
for name, js in files.items():
    json.dump(dict(step=f'post-{a.type}-{name}', builds=[], jobs=js), open(os.path.join(out, 'heldout', name + '.json'), 'w'), indent=0)
    njobs += len(js)
print(f'{a.type}: {len(files)} plan files, {njobs} jobs -> {out}', file=sys.stderr)
