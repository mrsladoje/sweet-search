# Post hoc (descriptive): the CQADupStack dev sweep below the shared effort floor (make_floor_plans.py).
# Same rule as rep_select.py (latency = median of 3 dev rounds; qualifies when the one-sided 97.5% cluster-bootstrap
# bound of mean(Q - 0.99 Q_exact) >= 0). Per CPU type: every configuration of the run, the fastest qualifying effort of
# each family against its effort-50 point in the same run, and ours (frozen S1 = 200) in the same run.
#   python floor_analyze.py --data DATA --results RESULTS [--out floor.json]
import argparse, collections, glob, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402
import stats  # noqa: E402

ap = argparse.ArgumentParser(); ap.add_argument('--data', required=True); ap.add_argument('--results', required=True)
ap.add_argument('--out', default=os.path.join(HERE, 'floor.json'))
a = ap.parse_args()
S = Q.load_set(a.data, 'cqadup'); qidx = Q.split_index(S, 'dev'); qx = Q.exact_quality(S, a.data, 'bge-base-en-v1.5', 'dev')
boot = stats.ClusterBoot([S.clusters[i] for i in qidx])
out = {}
for t in ('intel', 'amd', 'arm'):
    recs = collections.defaultdict(list)
    for fn in glob.glob(os.path.join(a.results, f'hf-{t}', '*', '*', '*.json')):
        if fn.endswith('.key.json'):
            continue
        try:
            r = json.load(open(fn))
        except Exception:
            continue
        if not isinstance(r, dict) or not r.get('complete') or r.get('split') != 'dev':
            continue
        k = r['key']; pt = {'system': r['system'], **{f: k[f] for f in ('search', 'S1') if k.get(f) is not None}}
        recs[json.dumps(pt, sort_keys=True)].append((r['round'], fn, float(np.median(r['timings_ns'])) / 1e3))
    rows = []
    for pk, rs in recs.items():
        rs.sort(); pt = json.loads(pk)
        q = Q.eval_lists_fast(S, qidx, *Q.read_record(rs[0][1])[1:])['q']
        sel = stats.selection(boot, q, qx, 0.99)
        eff = (pt.get('search') or {}); e = eff.get('ef', eff.get('window', pt.get('S1')))
        rows.append(dict(point=pt, effort=e, rounds=len(rs), latency_us=float(np.median([x[2] for x in rs])),
                         share=float(q.mean() / qx.mean()), qualifies=bool(sel['qualifies'])))
    fam = collections.defaultdict(list)
    for r in rows:
        fam[r['point']['system']].append(r)
    summ = {}
    for f, v in sorted(fam.items()):
        ok = sorted((r for r in v if r['qualifies'] and r['rounds'] == 3), key=lambda r: r['latency_us'])
        at50 = [r for r in v if r['effort'] == 50 and r['qualifies']]
        b50 = min(at50, key=lambda r: r['latency_us']) if at50 else None
        summ[f] = dict(best=ok[0] if ok else None, at50=b50, gain=(b50['latency_us'] / ok[0]['latency_us']) if ok and b50 else None)
        print(t, f, 'best', ok[0]['point'].get('search') or ok[0]['point'].get('S1') if ok else None, f"{ok[0]['latency_us']:.0f}" if ok else '',
              'at50', f"{b50['latency_us']:.0f}" if b50 else '', f"gain {summ[f]['gain']:.2f}" if summ[f]['gain'] else '', file=sys.stderr)
    out[t] = dict(rows=rows, summary=summ)
json.dump(out, open(a.out, 'w'), indent=1)
