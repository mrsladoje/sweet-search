# v4 scorer: every system and sweep point in one set, with uncertainty.
#   - MRR@10 (document level) and recall@10 against exact 768-d inner product, each with a 95% bootstrap CI
#     over queries (2,000 resamples, seed 42).
#   - Latency p50 / p95 / p99 per round; across rounds the median of the round p50s and its min-max spread.
#   - Time to quality: for every rival config, the fastest sweep point whose MRR reaches our production MRR,
#     plus the paired bootstrap 95% CI of (rival MRR - our MRR) and of the p50 latency ratio (rival / ours)
#     at that point (resampling queries jointly, so per-query pairing is kept).
#   - Pareto frontier (latency p50 vs MRR, and vs recall) per system.
# Inputs: <set>/meta.json, gt.bin, ours*.json (one per round / knob setting), runs/<round>/*.jsonl + the
# .ids / .lat files they point to (rivals.cpp RES=<round>). Held-out sets: aggregate output only.
# usage: python score4.py <setDir> [--ours-prod ours-r1.json,ours-r2.json,...] -> <setDir>/scored4.json
import sys, json, glob, os, re, numpy as np
s = sys.argv[1]
args = dict(a.split('=', 1) for a in sys.argv[2:] if '=' in a)
meta = json.load(open(f'{s}/meta.json')); nq = len(meta['queries'])
GT = np.fromfile(f'{s}/gt.bin', dtype=np.int32).reshape(-1, 10)[:nq]
cd = meta['chunkDoc']; gold = [set(q['gold'] or []) for q in meta['queries']]
labelled = any(gold)
rng = np.random.default_rng(42); B = 2000
BOOT = rng.integers(0, nq, size=(B, nq))

def per_query(res):
    rr, rec = np.zeros(nq), np.zeros(nq)
    for i, r in enumerate(res[:nq]):
        ids = [int(c) for c in r if c >= 0]
        rec[i] = len(set(ids) & set(GT[i].tolist())) / 10
        if labelled:
            docs = list(dict.fromkeys((cd[c] if cd[c] is not None else ('__d', c)) for c in ids))
            rr[i] = next((1 / (j + 1) for j, x in enumerate(docs) if x in gold[i]), 0.0)
    return rr, rec

def ci(x):
    m = x[BOOT].mean(1); return [round(float(np.percentile(m, 2.5)), 4), round(float(np.percentile(m, 97.5)), 4)]

def pct(lat, q): return round(float(np.percentile(lat, q)), 1)

points = {}  # key -> {system, config, param, rounds: [lat arrays], res}
def add(key, system, config, param, res, lat, extra):
    p = points.setdefault(key, dict(system=system, config=config, param=param, lats=[], res=res, allres=[], **extra))
    p['lats'].append(np.asarray(lat, dtype=np.float64)[:nq]); p['allres'].append(res)

for f in sorted(glob.glob(f'{s}/ours*.json')):
    o = json.load(open(f)); k = o.get('knobs', {})
    tag = os.path.basename(f)
    knob = '' if not k else f"S1={k.get('S1')},EF={k.get('EF')},POOL={k.get('POOL')},W={k.get('WEIGHT')},SCAN={int(bool(k.get('SCAN', True)))}"
    key = ('sweet', knob or tag)
    add(key, 'sweet', 'sweet-ANN cascade', knob or tag, o['res'], o['total_us'], dict(files=[], rss_mb=o.get('rss_mb')))
    points[key]['files'].append(tag)

for f in sorted(glob.glob(f'{s}/runs/*/*.jsonl')) + sorted(glob.glob(f'{s}/runs/*.jsonl')):
    for line in open(f):
        if not line.startswith('{'): continue
        r = json.loads(line); resdir = r.get('res', 'res')
        ids = np.fromfile(f"{s}/{resdir}/{r['tag']}.ids", dtype=np.int64).reshape(-1, 10)
        lat = np.fromfile(f"{s}/{resdir}/{r['tag']}.lat", dtype=np.float64)
        sysname = r['config'].split('_')[0]
        factory = r['config'].startswith('faiss_') and r['M'] == 0 and r.get('param')  # sweep point = param string
        pdesc = r['param'] if factory else 'ef' + str(r['ef']) + (' ' + r['param'] if r.get('param') else '')
        key = (r['config'], r['M'], r['efC'], pdesc)
        add(key, sysname, r['config'], f"M{r['M']} efC{r['efC']} {pdesc}", ids.tolist(), lat,
            dict(build_s=r['build_s'], index_mb=r['index_mb'], M=r['M'], efC=r['efC']))

rows = []
for key, p in points.items():
    rr, rec = per_query(p['res'])  # quality CIs from the first round; rebuilt graphs can differ per round
    qs_r = [per_query(x)[0 if labelled else 1].mean() for x in p['allres']]
    p50s = [float(np.percentile(l, 50)) for l in p['lats']]
    allat = np.concatenate(p['lats'])
    row = dict(system=p['system'], config=p['config'], param=p['param'], rounds=len(p['lats']),
               p50_us=round(float(np.median(p50s)), 1), p50_min=round(min(p50s), 1), p50_max=round(max(p50s), 1),
               p95_us=pct(allat, 95), p99_us=pct(allat, 99),
               recall10=round(float(rec.mean()), 4), recall10_ci=ci(rec),
               quality_round_range=[round(float(min(qs_r)), 4), round(float(max(qs_r)), 4)])
    if labelled: row.update(mrr10=round(float(rr.mean()), 4), mrr10_ci=ci(rr))
    for k in ('build_s', 'index_mb', 'rss_mb', 'M', 'efC'):
        if p.get(k) is not None: row[k] = p[k]
    row['_rr'], row['_rec'], row['_lat'] = rr, rec, np.median(np.stack(p['lats']), 0)
    rows.append(row)

exact_rr, _ = per_query(GT.tolist())
q = 'mrr10' if labelled else 'recall10'
prod_files = args.get('--ours-prod', '').split(',') if args.get('--ours-prod') else None
sweet = [r for r in rows if r['system'] == 'sweet']
prod = None
if sweet:
    prod = next((r for r in sweet if prod_files and set(prod_files) & set(points[('sweet', r['param'])]['files'])), None) \
        or next((r for r in sweet if r['param'].startswith('S1=1000,EF=400,POOL=1,W=0.8,SCAN=1')), None) or sweet[0]

def pareto(rs, metric):
    out, best = [], -1
    for r in sorted(rs, key=lambda r: r['p50_us']):
        if r[metric] > best: out.append(r); best = r[metric]
    return out

summary = dict(set=os.path.basename(s.rstrip('/')), n_vectors=len(cd), n_queries=nq, labelled=labelled,
               exact_mrr10=round(float(exact_rr.mean()), 4) if labelled else None, exact_mrr10_ci=ci(exact_rr) if labelled else None)
ttq = []
if prod:
    summary['sweet_prod'] = {k: v for k, v in prod.items() if not k.startswith('_')}
    for cfg in sorted({(r['config'], r.get('M'), r.get('efC')) for r in rows if r['system'] != 'sweet'}, key=str):
        rs = sorted([r for r in rows if (r['config'], r.get('M'), r.get('efC')) == cfg], key=lambda r: r['p50_us'])
        hit = next((r for r in rs if r[q] >= prod[q]), None)
        best = max(rs, key=lambda r: r[q])
        within = [r for r in rs if r['p50_us'] <= prod['p50_us']]
        e = dict(config=cfg[0], M=cfg[1], efC=cfg[2], best_quality=best[q], best_quality_p50=best['p50_us'],
                 best_quality_within_our_p50=max((r[q] for r in within), default=None))
        if hit:
            d = (hit['_rr'] - prod['_rr']) if labelled else (hit['_rec'] - prod['_rec'])
            dm = d[BOOT].mean(1)
            lr = np.array([np.median(hit['_lat'][b]) / np.median(prod['_lat'][b]) for b in BOOT[:1000]])
            e.update(at_our_quality=dict(param=hit['param'], p50_us=hit['p50_us'], p99_us=hit['p99_us'], quality=hit[q],
                                         quality_diff_ci=[round(float(np.percentile(dm, 2.5)), 4), round(float(np.percentile(dm, 97.5)), 4)],
                                         p50_ratio=round(float(np.median(hit['_lat']) / np.median(prod['_lat'])), 2),
                                         p50_ratio_ci=[round(float(np.percentile(lr, 2.5)), 2), round(float(np.percentile(lr, 97.5)), 2)]))
        ttq.append(e)
summary['time_to_our_quality'] = ttq
summary['pareto'] = {sysn: [dict(param=r['param'], config=r['config'], p50_us=r['p50_us'], **{q: r[q]}) for r in pareto([x for x in rows if x['system'] == sysn], q)]
                     for sysn in sorted({r['system'] for r in rows})}
summary['rows'] = [{k: v for k, v in r.items() if not k.startswith('_')} for r in sorted(rows, key=lambda r: (r['system'], r['config'], r['p50_us']))]
json.dump(summary, open(f'{s}/scored4.json', 'w'), indent=1)

print(f"== {summary['set']}: n={summary['n_vectors']} nq={nq}" + (f" exact MRR {summary['exact_mrr10']} {summary['exact_mrr10_ci']}" if labelled else ''))
if prod:
    print(f"   sweet prod: p50 {prod['p50_us']} us [{prod['p50_min']}-{prod['p50_max']} over {prod['rounds']} rounds] p99 {prod['p99_us']} | {q} {prod[q]} {prod[q + '_ci']} | R@10 {prod['recall10']}")
for e in ttq:
    a = e.get('at_our_quality')
    txt = (f"{a['p50_us']:>8.0f} us x{a['p50_ratio']} {a['p50_ratio_ci']} dQ {a['quality_diff_ci']} ({a['param']})" if a
           else f"   never (best {e['best_quality']} at {e['best_quality_p50']:.0f} us)")
    print(f"   {e['config'][:34]:34} M{e['M']} efC{e['efC']}: {txt}")
