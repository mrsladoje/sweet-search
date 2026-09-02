import json, statistics as st, math
from collections import defaultdict
d=json.load(open("/tmp/wf-slatec/verify-tail/tail-census.json"))
R=d["rollouts"]
cells=defaultdict(list)
for r in R: cells[(r["harness"],r["arm"])].append(r)
def tot(r): return sum(q["usd"] for q in r["requests"])
def cf(r): return sum(0.60e-6*q["out"]+0.01e-6*q.get("cached",0) for q in r["requests"] if q["cls"]=="plan")

print("=== C. same-arm A/B detectability: sd of per-task 3-rep mean, sweet cell only ===")
for h in ["codex","opencode","claude-code"]:
    rs=cells[(h,"sweet")]
    byt=defaultdict(list)
    for r in rs: byt[r["task"]].append(tot(r))
    within=[]   # pooled within-task sd across reps
    for t,v in byt.items():
        if len(v)>=2: within.append(st.stdev(v))
    sw=math.sqrt(sum(s*s for s in within)/len(within))
    # paired treated-vs-control, 22 tasks x 3 reps each: sd of per-task diff = sqrt(2)*sw/sqrt(3)
    sd_diff=math.sqrt(2)*sw/math.sqrt(3)
    sem=sd_diff/math.sqrt(len(byt))
    eff=sum(cf(r) for r in rs)/len(rs)
    print(f"{h}/sweet: pooled within-task rep sd = ${sw:.6f}; per-task paired diff sd = ${sd_diff:.6f}; SEM over {len(byt)} tasks = ${sem:.6f}; effect ${eff:.6f} = {eff/sem:.2f} SEM")

print()
print("=== D. plan-request count is the cheap, high-power metric ===")
for h in ["codex","opencode","claude-code"]:
    for a in ["native","sweet"]:
        rs=cells[(h,a)]
        c=[sum(1 for q in r["requests"] if q["cls"]=="plan") for r in rs]
        print(f"{h}/{a}: plan requests/rollout mean={st.mean(c):.2f} sd={st.pstdev(c):.2f} zero-plan rollouts={sum(1 for x in c if x==0)}/{len(c)}")

print()
print("=== E. solve vs plan-request count, within arm (confounded, direction only) ===")
for h in ["codex","opencode","claude-code"]:
    for a in ["native","sweet"]:
        rs=cells[(h,a)]
        lo=[r for r in rs if sum(1 for q in r["requests"] if q["cls"]=="plan")<=st.median([sum(1 for q in x["requests"] if q["cls"]=="plan") for x in rs])]
        hi=[r for r in rs if r not in lo]
        f=lambda v: (sum(1 for r in v if r["resolved"]),len(v))
        print(f"{h}/{a}: low-plan solved {f(lo)}  high-plan solved {f(hi)}")
