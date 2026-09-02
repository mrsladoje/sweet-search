"""Operative fire rate of the candidate's DESCRIBED trigger (possibly-empty OR fallback OR filtered OR caller-divergent
literal) given an EDITED function, over the 390 census cells. Re-runs call_sites for each distinct edited function."""
import json, os, re, sys, collections
sys.path.insert(0, "/tmp/wf-slatec/resolution-computed-facts")
import census_edited_functions as C
LIT = re.compile(r"^(['\"`]).*\1$")
cells=json.load(open("/tmp/wf-slatec/resolution-computed-facts/census.json"))
tasks=json.load(open("/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/sweet/tasks.json"))
tmeta={t["instance_id"]:(t["repo"],t["base_commit"]) for t in tasks}
cache={}
def divergent(task, f):
    key=(task,f["file"],f["name"],f["defLine"])
    if key in cache: return cache[key]
    repo,sha=tmeta[task]; root=f"{C.GOLD}/{repo.replace('/','__')}@{sha}"
    p=os.path.join(root,f["file"]); files=C.repo_files(root)
    nt,te,defs=C.call_sites(root, files, f["name"], p, f["defLine"]-1, f["lang"])
    d=False
    if len(nt)>=2:
        maxpos=max(len(x["args"]) for x in nt)
        for i in range(maxpos):
            lits=set(x["args"][i] for x in nt if i<len(x["args"]) and LIT.match(x["args"][i]))
            if len(lits)>=2: d=True; break
    cache[key]=(d,len(nt)); return cache[key]
tot=collections.Counter(); fire_narrow=collections.Counter(); fire_super=collections.Counter(); by_task=collections.Counter(); by_task_tot=collections.Counter()
examples=collections.Counter()
for c in cells:
    k=(c["harness"],c["arm"],"solved" if c["resolved"] else "lost"); tot[k]+=1; by_task_tot[c["task"]]+=1
    narrow=False; sup=False
    for f in c["functions"]:
        if "name" not in f or f["ambiguous"] or f["nCallSites"]<2: continue
        if f["nFlaggedCallSites"]>=1: narrow=True; sup=True
        d,n=divergent(c["task"],f)
        if d: sup=True; examples[(c["task"][:30],f["name"])]+=1
    if narrow: fire_narrow[k]+=1
    if sup: fire_super[k]+=1; by_task[c["task"]]+=1
print("cells",len(cells))
for k in sorted(tot): print("%-10s %-7s %-6s n=%3d narrow(possiblyEmpty)=%3d  described(+divergent literal)=%3d"%(k[0],k[1],k[2],tot[k],fire_narrow[k],fire_super[k]))
print("TOTAL narrow", sum(fire_narrow.values()), "described", sum(fire_super.values()), "of", len(cells))
print("described-trigger firing by task (cells firing / cells):")
for t in sorted(by_task_tot): print("  %-42s %2d / %2d"%(t, by_task[t], by_task_tot[t]))
print("functions that fire on the divergent-literal rule (task, function): cells")
for (t,n),v in examples.most_common(20): print("  ",t,n,v)
