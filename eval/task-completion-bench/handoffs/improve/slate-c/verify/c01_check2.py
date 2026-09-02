import json, statistics as st, math
from collections import defaultdict
d=json.load(open("/tmp/wf-slatec/verify-tail/tail-census.json"))
R=d["rollouts"]
cells=defaultdict(list)
for r in R: cells[(r["harness"],r["arm"])].append(r)

print("=== A. text_only non-final requests (the missing kill-condition baseline) ===")
for (h,a),rs in sorted(cells.items()):
    n=len(rs); tot=0; withn=0; usd=0.0
    for r in rs:
        rq=r["requests"]; nr=len(rq)
        c=sum(1 for i,q in enumerate(rq) if q["cls"]=="text_only" and i<nr-1)
        u=sum(q["usd"] for i,q in enumerate(rq) if q["cls"]=="text_only" and i<nr-1)
        tot+=c; usd+=u
        if c>0: withn+=1
    print(f"{h}/{a}: text_only non-final per rollout = {tot/n:.3f} (total {tot}, rollouts with >=1: {withn}/{n}), $ per rollout = {usd/n:.6f}")

print()
print("=== B. paired-by-task cost, and the effect of the plan-request removal ===")
def cf(r):
    return sum(0.60e-6*q["out"] + 0.01e-6*q.get("cached",0) for q in r["requests"] if q["cls"]=="plan")
def tot(r): return sum(q["usd"] for q in r["requests"])
for h in ["codex","opencode","claude-code"]:
    byt=defaultdict(dict)
    for a in ["native","sweet"]:
        agg=defaultdict(list)
        for r in cells[(h,a)]: agg[r["task"]].append(r)
        for t,rs in agg.items():
            byt[t][a]=(sum(tot(r) for r in rs)/len(rs), sum(cf(r) for r in rs)/len(rs), len(rs))
    tasks=[t for t in byt if len(byt[t])==2]
    dn=[byt[t]["sweet"][0]-byt[t]["native"][0] for t in tasks]
    dsw=[(byt[t]["sweet"][0]-byt[t]["sweet"][1])-byt[t]["native"][0] for t in tasks]     # sweet-only removal
    dbo=[(byt[t]["sweet"][0]-byt[t]["sweet"][1])-(byt[t]["native"][0]-byt[t]["native"][1]) for t in tasks]  # both arms
    N=sum(byt[t]["native"][0] for t in tasks)/len(tasks); S=sum(byt[t]["sweet"][0] for t in tasks)/len(tasks)
    Scf=sum(byt[t]["sweet"][1] for t in tasks)/len(tasks); Ncf=sum(byt[t]["native"][1] for t in tasks)/len(tasks)
    sd=st.pstdev(dn); sem=sd/math.sqrt(len(tasks))
    print(f"{h}: tasks={len(tasks)} native={N:.6f} sweet={S:.6f} baseline delta={100*(S/N-1):+.2f}%")
    print(f"   sweet-only removal -> sweet={S-Scf:.6f} delta={100*((S-Scf)/N-1):+.2f}%   both-arms -> delta={100*((S-Scf)/(N-Ncf)-1):+.2f}%")
    print(f"   paired per-task diff (sweet-native): mean={st.mean(dn):+.6f} sd={sd:.6f} sem={sem:.6f}  |effect/sem| for sweet-only removal = {Scf/sem:.2f}")
