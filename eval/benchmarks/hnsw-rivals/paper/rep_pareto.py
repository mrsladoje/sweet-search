# Replication: every dev configuration as (dev latency, dev retained share) for the quality-latency figure.
# Same records and rules as rep_select.py (median over exactly 3 dev rounds; share = mean Q / mean Q_exact on dev);
# written after the held-out run, descriptive only, chooses nothing.
#   python rep_pareto.py --data DATA --results RESULTS [--out rep-pareto.json]
import argparse, collections, fnmatch, glob, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402

MODEL = 'bge-base-en-v1.5'
FIELDS = ('family', 'build_params', 'search', 'S1', 'EF')
ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True); ap.add_argument('--results', required=True)
ap.add_argument('--out', default=os.path.join(HERE, 'rep-pareto.json'))
a = ap.parse_args()
out = []
for t in ('intel', 'amd', 'arm'):
    recs = collections.defaultdict(list)
    for md in glob.glob(os.path.join(a.results, '*')):
        if not fnmatch.fnmatch(os.path.basename(md), f'hd-{t}-*'):
            continue
        for fn in glob.glob(os.path.join(md, '*', '*', '*.json')):
            if fn.endswith('.key.json'):
                continue
            try:
                r = json.load(open(fn))
            except Exception:
                continue
            if not r.get('complete') or r.get('split') != 'dev' or r['key'].get('kind') != 'timing':
                continue
            k = r['key']; pt = {'system': r['system'], **{f: k[f] for f in FIELDS if k.get(f) is not None}}
            recs[(r['set'], json.dumps(pt, sort_keys=True))].append((r['round'], fn, float(np.median(r['timings_ns'])) / 1e3))
    for s in sorted({k[0] for k in recs}):
        S = Q.load_set(a.data, s); qidx = Q.split_index(S, 'dev'); qx = Q.exact_quality(S, a.data, MODEL, 'dev')
        for (s_, pk), rs in recs.items():
            if s_ != s or sorted(x[0] for x in rs) != [0, 1, 2]:
                continue
            rs.sort(); _, v, sc = Q.read_record(rs[0][1])
            q = Q.eval_lists_fast(S, qidx, v, sc)['q']
            out.append(dict(type=t, set=s, point=json.loads(pk), latency_us=float(np.median([x[2] for x in rs])), share=float(q.mean() / qx.mean())))
    print(t, len(out), file=sys.stderr)
json.dump(out, open(a.out, 'w'), indent=1)
