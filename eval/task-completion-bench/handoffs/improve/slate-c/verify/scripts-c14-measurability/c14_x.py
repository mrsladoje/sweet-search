import json, os, glob, re
base='/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826'
rows=json.load(open(base+'/rows.json'))
# 1) ephemeral TTL split ever non-zero?
e1=e5=0; miss=0
for r in rows:
    u=r.get('usage') or {}; cc=u.get('cache_creation') or {}
    e1+=cc.get('ephemeral_1h_input_tokens') or 0; e5+=cc.get('ephemeral_5m_input_tokens') or 0
    if not cc: miss+=1
print("ephemeral_1h total:",e1," ephemeral_5m total:",e5," rows w/o cache_creation:",miss)
# 2) per-row luna-from-usage vs costRealizedMainOnlyUsd
def luna(u):
    return ((u.get('input_tokens') or 0)*0.10 + (u.get('cache_creation_input_tokens') or 0)*0.125
            + (u.get('cache_read_input_tokens') or 0)*0.01 + (u.get('output_tokens') or 0)*0.60)/1e6
tot={'native':[0,0],'sweet':[0,0]}
diffs=0
for r in rows:
    a=r['arm']; u=r.get('usage') or {}
    x=luna(u); y=r.get('costRealizedMainOnlyUsd')
    tot[a][0]+=x
    if isinstance(y,(int,float)): tot[a][1]+=y
    if isinstance(y,(int,float)) and abs(x-y)>1e-6: diffs+=1
for a in tot:
    print(f"{a}: sum(luna-from-usage)=${tot[a][0]:.6f} sum(costRealizedMainOnlyUsd)=${tot[a][1]:.6f} perRollout {tot[a][0]/66:.6f} vs {tot[a][1]/66:.6f}")
print("rows where they differ >1e-6:", diffs, "of", len(rows))
d1=(tot['sweet'][0]-tot['native'][0])/tot['native'][0]*100
d2=(tot['sweet'][1]-tot['native'][1])/tot['native'][1]*100
print(f"delta from usage: {d1:+.2f}% ; delta from costRealizedMainOnlyUsd: {d2:+.2f}%")
