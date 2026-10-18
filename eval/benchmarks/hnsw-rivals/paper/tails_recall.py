# Post-held-out reporting (no selection): for every headline pair at f = 0.99 (ours and the rival fastest on dev,
# paperlib.headline), the tail latencies (median over rounds of each round's p95 and p99) and recall@10 of the
# retained vectors against the exact top-10 vectors (round 0 lists, held-out queries).
#   python tails_recall.py --data DATA --results RESULTS --json results-paper.json --out tails.json
import argparse, collections, glob, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402
from paperlib import headline  # noqa: E402

FIELDS = ('family', 'build_params', 'search', 'gen', 'C', 'H', 'ef', 'S1', 'EF')
ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True); ap.add_argument('--results', required=True); ap.add_argument('--json', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()


def mtype(name):
    if name.startswith(('ho-', 'hr-')):
        return name.split('-')[1]
    return {'box': 'box', 'mac': 'mac'}.get(name)


def pkey(system, d):
    return json.dumps({'system': system, **{f: d[f] for f in FIELDS if f in d and d[f] is not None}}, sort_keys=True)


J = json.load(open(a.json))
B = collections.defaultdict(dict)
for r in J['B']:
    B[(r['type'], r['set'], r['model'], r['f'])][r['system']] = r
want = {}
for (t, s, m, f), d in B.items():
    if f != 0.99:
        continue
    h = headline(d, t, s, m, f)
    if h:
        for role, row in (('ours', h[0]), ('rival', h[2])):
            want[(t, s, m, pkey(row['point']['system'], row['point']))] = (role, h[1])
recs = collections.defaultdict(list)
for md in glob.glob(os.path.join(a.results, '*')):
    t = mtype(os.path.basename(md))
    if not t:
        continue
    for fn in glob.glob(os.path.join(md, '*', '*', '*.json')):
        if fn.endswith('.key.json'):
            continue
        try:
            r = json.load(open(fn))
        except Exception:
            continue
        if not r.get('complete') or r.get('split') != 'ho' or r.get('comparison') != 'B' or r['key'].get('kind') != 'timing':
            continue
        d = dict(r.get('params') or {}); d.update(r['key'])
        k = (t, r['set'], r['model'], pkey(r['system'], d))
        if k in want:
            ts = np.asarray(r['timings_ns'], float) / 1e3
            recs[k].append((r['round'], fn, np.percentile(ts, 50), np.percentile(ts, 95), np.percentile(ts, 99)))
out = []
gt_cache = {}
for k, rs in recs.items():
    t, s, m, pk = k; role, rival = want[k]
    rs.sort()
    S = Q.load_set(a.data, s); qidx = Q.split_index(S, 'ho')
    if (s, m) not in gt_cache:
        gt_cache[(s, m)] = Q.read_gt(a.data, m, s, 'ho')['vecs'][:, :10]
    gt = gt_cache[(s, m)]
    _, vids, _ = Q.read_record(rs[0][1])
    rec10 = float(np.mean([len(set(vids[i][:10][vids[i][:10] >= 0].tolist()) & set(gt[i].tolist())) / 10 for i in range(len(qidx))]))
    out.append(dict(type=t, set=s, model=m, role=role, rival=rival, system=json.loads(pk)['system'], rounds=len(rs),
                    p50=float(np.median([x[2] for x in rs])), p95=float(np.median([x[3] for x in rs])), p99=float(np.median([x[4] for x in rs])),
                    recall10=rec10))
json.dump(out, open(a.out, 'w'), indent=0)
print(f'{len(out)} points -> {a.out}', file=sys.stderr)
