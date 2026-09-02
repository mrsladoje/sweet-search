import json
base='/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826'
rows=json.load(open(base+'/rows.json'))
def luna(u):
    return ((u.get('input_tokens') or 0)*0.10 + (u.get('cache_creation_input_tokens') or 0)*0.125
            + (u.get('cache_read_input_tokens') or 0)*0.01 + (u.get('output_tokens') or 0)*0.60)/1e6
out=[]
for r in rows:
    u=r.get('usage') or {}; x=luna(u); y=r.get('costRealizedMainOnlyUsd')
    if isinstance(y,(int,float)) and abs(x-y)>1e-6:
        out.append((r['taskId'],r['arm'],r['rep'],round(x,6),round(y,6),round(y-x,6),r.get('degenerate'),r.get('degenReran'),r.get('exitReason'),r.get('resolved'),r.get('sidechainCount')))
for o in sorted(out,key=lambda t:-abs(t[5])): print(o)
tot=sum(o[5] for o in out); print("sum(costRealizedMainOnly - lunaFromUsage) over differing rows = $%.6f"%tot)
# recompute delta excluding those 4 rows entirely (both arms)
bad={(o[0],o[1],o[2]) for o in out}
for label,f in (('usage',luna),):
    n=s=0.0
    for r in rows:
        if (r['taskId'],r['arm'],r['rep']) in bad: continue
        v=f(r.get('usage') or {})
        if r['arm']=='native': n+=v
        else: s+=v
    print("excluding differing rows, usage-based delta:", f"{(s-n)/n*100:+.2f}%")
n=s=0.0
for r in rows:
    if (r['taskId'],r['arm'],r['rep']) in bad: continue
    v=r.get('costRealizedMainOnlyUsd')
    if r['arm']=='native': n+=v
    else: s+=v
print("excluding differing rows, ledger-based delta:", f"{(s-n)/n*100:+.2f}%")
