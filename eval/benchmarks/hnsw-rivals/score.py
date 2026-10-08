# Score sweet (ours.json) and every native rival run in <setDir>/res. Each distractor chunk counts as its
# own document (the old script folded all distractors into one None document). Aggregate output only.
# usage: python score.py <setDir> -> <setDir>/scored.json
import sys, json, glob, os, numpy as np
s = sys.argv[1]
meta = json.load(open(f'{s}/meta.json')); GT = np.fromfile(f'{s}/gt.bin', dtype=np.int32).reshape(-1, 10)
cd = meta['chunkDoc']; gold = [set(q['gold']) for q in meta['queries']]; nq = len(gold)
doc = lambda c: cd[c] if cd[c] is not None else ('__distractor', c)
def mrr(res):
    out = []
    for i, r in enumerate(res):
        docs = list(dict.fromkeys(doc(int(c)) for c in r if c >= 0))
        out.append(next((1 / (j + 1) for j, x in enumerate(docs) if x in gold[i]), 0.0))
    return float(np.mean(out))
def row(res, lat, **kw):
    lat = np.asarray(lat, dtype=np.float64)
    rec = np.mean([len(set(int(x) for x in r if x >= 0) & set(GT[i].tolist())) / 10 for i, r in enumerate(res)])
    return dict(**kw, p50_us=round(float(np.percentile(lat, 50)), 1), p99_us=round(float(np.percentile(lat, 99)), 1), recall10_vs_exact=round(float(rec), 4), mrr10=round(mrr(res), 4))
rows = []
if os.path.exists(f'{s}/ours.json'):
    o = json.load(open(f'{s}/ours.json')); rows.append(row(o['res'], o['total_us'], system='sweet', config='prod cascade', M=64, efC=800, ef='adaptive'))
rows.append(row(GT, [0] * nq, system='exact', config='exact 768-d cosine', M=0, efC=0, ef='-'))
runs = [json.loads(l) for f in sorted(glob.glob(f'{s}/runs/*.jsonl')) for l in open(f) if l.startswith('{')]
for r in runs:
    ids = np.fromfile(f"{s}/res/{r['tag']}.ids", dtype=np.int64).reshape(-1, 10); lat = np.fromfile(f"{s}/res/{r['tag']}.lat", dtype=np.float64)
    rows.append(row(ids, lat, system=r['config'].split('_')[0], config=r['config'], M=r['M'], efC=r['efC'], ef=r['ef'], build_s=r['build_s'], index_mb=r['index_mb']))
json.dump(rows, open(f'{s}/scored.json', 'w'), indent=1)
sw = rows[0] if rows[0]['system'] == 'sweet' else None; ex = [r for r in rows if r['system'] == 'exact'][0]
print(f"== {s}: n={len(cd)} nq={nq} exact MRR {ex['mrr10']:.4f}" + (f" | sweet p50 {sw['p50_us']} us p99 {sw['p99_us']} MRR {sw['mrr10']:.4f} R@10 {sw['recall10_vs_exact']}" if sw else ''))
cfgs = {}
for r in rows:
    if r['system'] in ('sweet', 'exact'): continue
    cfgs.setdefault((r['config'], r['M'], r['efC']), []).append(r)
for (c, M, efC), rs in cfgs.items():
    at = [r for r in rs if sw and r['mrr10'] >= sw['mrr10']]
    within = [r for r in rs if sw and r['p50_us'] <= sw['p50_us']]
    best = max(rs, key=lambda r: r['mrr10'])
    a = f"{at[0]['p50_us']:.0f} us (ef {at[0]['ef']})" if at else f"never (max {best['mrr10']:.4f} at {best['p50_us']:.0f} us, ef {best['ef']})"
    w = f"{max(within, key=lambda r: r['mrr10'])['mrr10']:.4f}" if within else '-'
    print(f"  {c:20} M{M:<3} efC{efC:<4} build {rs[0]['build_s']:>6}s {rs[0]['index_mb']:>7} MB | at sweet MRR: {a:40} | best MRR within sweet p50: {w} | max {best['mrr10']:.4f}")
