# Post hoc mechanism check (make_mech_plans.py), one machine: generator time (median over rounds of the per-round
# median of the generator stage clock, us) per set and configuration, and the ratios that isolate one mechanism:
#   heap / bucket      our walk with binary heaps over our walk with bucket queues (fixed ef 400; and adaptive)
#   faiss / bucket     FAISS binary HNSW (M 64, ef 400) over our fixed walk with buckets; and over our walk with heaps
#   heap / counting    FAISS binary flat with its binary heap over its counting top-k; ours scan for reference
#   python mech_analyze.py RESULTS/mac-mech [--out mech.json]
import argparse, collections, glob, json, math, os, sys
import numpy as np

ap = argparse.ArgumentParser(); ap.add_argument('results'); ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mech.json'))
a = ap.parse_args()
G = collections.defaultdict(list)
for fn in glob.glob(os.path.join(a.results, '*', '*', '*.json')):
    if fn.endswith('.key.json'):
        continue
    try:
        r = json.load(open(fn))
    except Exception:
        continue
    if not isinstance(r, dict) or not r.get('complete'):
        continue
    k = r['key']; env = (k.get('options') or {}).get('env') or {}
    if r['system'] == 'ours_walk':
        name = ('fixed' if env.get('SS_FIX_HNSW_ADAPTIVE') == '0' else 'adaptive') + '-' + ('heap' if env.get('SS_FIX_HNSW_BUCKET') == '0' else 'bucket')
    elif r['system'] == 'faiss_bin_flat':
        name = 'flat-' + ('counting' if (k.get('search') or {}).get('use_heap') == 0 else 'heap')
    else:
        name = r['system']
    sg = r.get('stage_ns') or {}
    G[(r['set'], name)].append((r['round'], float(np.median(sg['gen'])) / 1e3 if 'gen' in sg else float('nan'),
                                float(np.median(r['timings_ns'])) / 1e3, int(r['memory']['after'].get('majflt', 0)) if r.get('memory') else 0))
gen = {k: float(np.median([x[1] for x in v])) for k, v in G.items()}
rounds = {k: len(v) for k, v in G.items()}
SETS = ['gcsn', 'd20k', 'advtest', 'fiqa', 'dall', 'quora', 'csn1m']
R = lambda num, den: [(s, gen[(s, num)] / gen[(s, den)]) for s in SETS if (s, num) in gen and (s, den) in gen]
ratios = {'heap/bucket fixed': R('fixed-heap', 'fixed-bucket'), 'heap/bucket adaptive': R('adaptive-heap', 'adaptive-bucket'),
          'faiss/bucket fixed': R('faiss_bin_hnsw', 'fixed-bucket'), 'faiss/heap fixed': R('faiss_bin_hnsw', 'fixed-heap'),
          'flat heap/counting': R('flat-heap', 'flat-counting'), 'flat heap/ours scan': R('flat-heap', 'ours_scan'),
          'flat counting/ours scan': R('flat-counting', 'ours_scan')}
gm = lambda v: math.exp(sum(math.log(x) for _, x in v) / len(v)) if v else float('nan')
for k, v in ratios.items():
    print(f"{k:24s} gm {gm(v):.2f}  " + ' '.join(f'{s}:{x:.2f}' for s, x in v), file=sys.stderr)
for s in SETS:
    print(s, ' '.join(f"{n}={gen[(s, n)]:.0f}({rounds[(s, n)]})" for (s_, n) in sorted(gen) if s_ == s), file=sys.stderr)
json.dump(dict(gen={f'{s}|{n}': v for (s, n), v in gen.items()}, rounds={f'{s}|{n}': v for (s, n), v in rounds.items()},
               ratios={k: dict(v) for k, v in ratios.items()}, gm={k: gm(v) for k, v in ratios.items()}), open(a.out, 'w'), indent=1)
