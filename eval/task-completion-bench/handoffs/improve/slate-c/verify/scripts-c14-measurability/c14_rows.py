import json, sys, statistics
p='/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/rows.json'
rows=json.load(open(p))
print("n rows", len(rows))
if rows: print("keys:", sorted(rows[0].keys()))
def agg(field, pred=lambda r: True):
    out={}
    for arm in ('native','sweet'):
        vals=[r.get(field) for r in rows if r.get('arm')==arm and pred(r) and isinstance(r.get(field),(int,float))]
        out[arm]=(len(vals), sum(vals), sum(vals)/len(vals) if vals else None)
    return out
for f in ('costRealizedUsd','costRealizedMainOnlyUsd','costSidechainUsd','idealCostUsd','breakPricedCostUsd','realFromTurnsUsd'):
    a=agg(f)
    n_ = {k:v[0] for k,v in a.items()}
    if a['native'][2] is None or a['sweet'][2] is None:
        print(f, n_, a); continue
    d=(a['sweet'][2]-a['native'][2])/a['native'][2]*100
    print(f"{f}: n={n_} nativeMean={a['native'][2]:.6f} sweetMean={a['sweet'][2]:.6f} delta={d:+.2f}%")
# resolved counts
for arm in ('native','sweet'):
    rs=[r for r in rows if r.get('arm')==arm]
    print(arm,'rows',len(rs),'resolved',sum(1 for r in rs if r.get('resolved')))
# sidechain completeness
from collections import Counter
print('sidechainAccountingComplete', Counter((r.get('arm'), r.get('sidechainAccountingComplete')) for r in rows))
print('sidechainCount>0', Counter((r.get('arm'), (r.get('sidechainCount') or 0)>0) for r in rows))
