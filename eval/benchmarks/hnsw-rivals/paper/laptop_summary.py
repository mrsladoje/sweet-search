# Summary of the laptop example: per system, median latency over rounds (us per query) and dev retained share.
#   python laptop_summary.py DATA RESULTS/laptop
import glob, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import quality as Q  # noqa: E402

D, R = sys.argv[1:3]
S = Q.load_set(D, 'gcsn'); qidx = Q.split_index(S, 'dev'); qx = Q.exact_quality(S, D, 'CodeRankEmbed', 'dev')
rows = {}
for f in glob.glob(f'{R}/*/*/*.json'):
    if f.endswith('.key.json'):
        continue
    r = json.load(open(f))
    if not isinstance(r, dict):
        continue
    if not r.get('complete'):
        continue
    k = r['key']; name = r['system'] + (f" S1={k['S1']}" if k.get('S1') else '') + (f" {k['search']}" if k.get('search') else '')
    e = rows.setdefault(name, {'us': [], 'share': None})
    e['us'].append(float(np.median(r['timings_ns'])) / 1e3)
    if e['share'] is None:
        q = Q.eval_lists_fast(S, qidx, *Q.read_record(f)[1:])['q']; e['share'] = float(q.mean() / qx.mean())
print(f"{'system':40s} {'rounds':>6s} {'us/query':>9s} {'retained':>9s}")
for n, e in sorted(rows.items(), key=lambda kv: np.median(kv[1]['us'])):
    print(f"{n:40s} {len(e['us']):6d} {np.median(e['us']):9.1f} {e['share']:9.4f}")
