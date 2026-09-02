import json, math, statistics as st
from collections import defaultdict
P="/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/rows.json"
rows=json.load(open(P))
if isinstance(rows,dict): rows=rows.get("rows",rows)
print("rows:",len(rows))
k=rows[0]
print("fields:",sorted(k.keys()))
by=defaultdict(list)
for r in rows:
    by[r["arm"]].append(r)
for arm,rs in by.items():
    c=[r.get("costRealizedUsd") for r in rs if r.get("costRealizedUsd") is not None]
    solved=sum(1 for r in rs if r.get("resolved"))
    print(f"{arm}: n={len(rs)} cost n={len(c)} mean={sum(c)/len(c):.6f} sd={st.pstdev(c):.6f} min={min(c):.6f} max={max(c):.6f} solved={solved}")
# paired by task: mean per task per arm across reps
tasks=sorted(set(r["taskId"] for r in rows))
print("tasks:",len(tasks))
d=[]
for t in tasks:
    s=[r["costRealizedUsd"] for r in rows if r["taskId"]==t and r["arm"]=="sweet" and r.get("costRealizedUsd") is not None]
    n=[r["costRealizedUsd"] for r in rows if r["taskId"]==t and r["arm"]=="native" and r.get("costRealizedUsd") is not None]
    if s and n: d.append((t,sum(s)/len(s),sum(n)/len(n)))
diff=[a-b for _,a,b in d]
print(f"paired tasks={len(d)} mean sweet={sum(a for _,a,_ in d)/len(d):.6f} mean native={sum(b for _,_,b in d)/len(d):.6f}")
print(f"paired diff mean={st.mean(diff):+.6f} sd={st.stdev(diff):.6f} se={st.stdev(diff)/math.sqrt(len(diff)):.6f}")
sweetmean=sum(a for _,a,_ in d)/len(d)
se=st.stdev(diff)/math.sqrt(len(diff))
mde=2.8*se   # 80% power, alpha .05, two-sided
print(f"MDE(80% power, paired t, n={len(d)} tasks) = {mde:.6f} USD/rollout = {100*mde/sweetmean:.2f}% of the sweet cell")
# single-arm (unpaired) view on rollouts
sc=[r["costRealizedUsd"] for r in rows if r["arm"]=="sweet" and r.get("costRealizedUsd") is not None]
se2=st.stdev(sc)/math.sqrt(len(sc))
print(f"sweet-arm cell mean se (66 rollouts, unpaired) = {se2:.6f} -> +/-1.96se = {100*1.96*se2/st.mean(sc):.2f}% of the cell")
# per-rollout requests
rq=[r.get("calls") for r in rows if r["arm"]=="sweet" and r.get("calls") is not None]
print("sweet calls/rollout mean",st.mean(rq),"sd",st.pstdev(rq))
