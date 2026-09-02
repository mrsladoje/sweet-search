import json
from collections import Counter
p='/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/rows.json'
rows=json.load(open(p))
def m(field, arm, pred=lambda r: True):
    vals=[r.get(field) for r in rows if r.get('arm')==arm and pred(r) and isinstance(r.get(field),(int,float))]
    return len(vals), (sum(vals)/len(vals) if vals else None)
for f in ('costRealizedMainOnlyUsd','costSidechainUsd','idealCostUsd','idealCostMainOnlyUsd','breakPricedCostUsd','breakPricedCostMainOnlyUsd','realFromTurnsUsd','costNaiveUsd','costContentUsd'):
    n_n,mn=m(f,'native'); n_s,ms=m(f,'sweet')
    d = ((ms-mn)/mn*100) if (mn and ms is not None and mn!=0) else None
    print(f"{f}: nNat={n_n} nSw={n_s} nat={mn} sw={ms} delta={('%.2f%%'%d) if d is not None else 'NA'}")
# inclusive = main-only + sidechain (treat missing sidechain as 0)
def incl(arm):
    tot=0.0; n=0
    for r in rows:
        if r.get('arm')!=arm: continue
        mo=r.get('costRealizedMainOnlyUsd'); sc=r.get('costSidechainUsd') or 0.0
        if not isinstance(mo,(int,float)): continue
        tot+=mo+sc; n+=1
    return n, tot/n
nn,na=incl('native'); ns,sa=incl('sweet')
print(f"INCLUSIVE(main+sidechain): nat n={nn} mean={na:.6f} ; sweet n={ns} mean={sa:.6f} ; delta={(sa-na)/na*100:+.2f}%")
# only rows with complete sidechain accounting
def incl2(arm):
    tot=0.0;n=0
    for r in rows:
        if r.get('arm')!=arm: continue
        if r.get('sidechainAccountingComplete') is False: continue
        mo=r.get('costRealizedMainOnlyUsd'); sc=r.get('costSidechainUsd') or 0.0
        if not isinstance(mo,(int,float)): continue
        tot+=mo+sc; n+=1
    return n, tot/n if n else None
nn,na2=incl2('native'); ns,sa2=incl2('sweet')
print(f"INCLUSIVE complete-only: nat n={nn} mean={na2} ; sweet n={ns} mean={sa2}")
print('sidechainAccountingComplete', Counter((r.get('arm'), r.get('sidechainAccountingComplete')) for r in rows))
print('rows with sidechainCount>0', Counter((r.get('arm'), (r.get('sidechainCount') or 0)>0) for r in rows))
print('sum sidechainCount', {a: sum((r.get('sidechainCount') or 0) for r in rows if r.get('arm')==a) for a in ('native','sweet')})
print('resolved', {a: sum(1 for r in rows if r.get('arm')==a and r.get('resolved')) for a in ('native','sweet')})
print('model', Counter(r.get('model') for r in rows))
print('readPagesNormalization', Counter((r.get('arm'), json.dumps(r.get('readPagesNormalization'))[:120]) for r in rows).most_common(6))
