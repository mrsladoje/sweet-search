import json, statistics as st
from collections import defaultdict
d=json.load(open("/tmp/wf-slatec/verify-tail/tail-census.json"))
P=d["price"]; print("price", P)
R=d["rollouts"]
cells=defaultdict(list)
for r in R: cells[(r["harness"],r["arm"])].append(r)
print("cell sizes", {k:len(v) for k,v in cells.items()})

def cost(rq, harness):
    return rq["usd"]

rows=[]
for (h,a),rs in sorted(cells.items()):
    n=len(rs)
    plan_req=0; plan_attr=0.0; plan_cf=0.0
    txt_nonfinal=0; txt_nonfinal_usd=0.0
    tot_usd=0.0; per_roll=[]
    plan_per_roll=[]; txt_per_roll=[]
    for r in rs:
        rq=r["requests"]; nr=len(rq)
        c=0; pu=0.0; cf=0.0; t=0; tu=0.0
        for i,q in enumerate(rq):
            if q["cls"]=="plan":
                c+=1; pu+=q["usd"]
                # counterfactual: output + re-sent (cached) portion only; new ingest migrates
                cf+= 0.60e-6*q["out"] + 0.01e-6*q.get("cached",0)
            if q["cls"]=="text" and i < nr-1:
                t+=1; tu+=q["usd"]
        plan_req+=c; plan_attr+=pu; plan_cf+=cf
        txt_nonfinal+=t; txt_nonfinal_usd+=tu
        u=sum(q["usd"] for q in rq); tot_usd+=u; per_roll.append(u)
        plan_per_roll.append(c); txt_per_roll.append(t)
    rows.append(dict(cell=f"{h}/{a}", n=n,
        plan_per_rollout=plan_req/n,
        plan_attr_share=plan_attr/tot_usd,
        plan_cf_usd_per_roll=plan_cf/n,
        plan_cf_per_req=plan_cf/max(plan_req,1),
        plan_cf_share=plan_cf/tot_usd,
        mean_usd=tot_usd/n, sd_usd=st.pstdev(per_roll), max_usd=max(per_roll),
        txt_nonfinal_per_roll=txt_nonfinal/n, txt_nonfinal_usd_per_roll=txt_nonfinal_usd/n,
        rollouts_with_txt=sum(1 for x in txt_per_roll if x>0)))
for r in rows:
    print(f'{r["cell"]:>22} n={r["n"]:3d} plan/roll={r["plan_per_rollout"]:.2f} attr={r["plan_attr_share"]*100:5.1f}% cf$/roll={r["plan_cf_usd_per_roll"]:.6f} cf$/req={r["plan_cf_per_req"]:.6f} cf_share={r["plan_cf_share"]*100:5.1f}% mean$={r["mean_usd"]:.6f} sd={r["sd_usd"]:.6f} max={r["max_usd"]:.6f} txtNonFinal/roll={r["txt_nonfinal_per_roll"]:.3f} (rollouts w/ >=1: {r["rollouts_with_txt"]}) txt$={r["txt_nonfinal_usd_per_roll"]:.6f}')
