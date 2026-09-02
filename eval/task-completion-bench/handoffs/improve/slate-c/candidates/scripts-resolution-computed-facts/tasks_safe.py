import json, os
t=json.load(open("/root/sweet-search-private/eval/task-completion-bench/results/fp-codex-tab-20260826/sweet/tasks.json"))
out=[]
for r in t:
    repo=r["repo"].replace("/","__")
    g="/root/.ss-eval/golden/%s@%s" % (repo, r["base_commit"])
    out.append((r["instance_id"], r["language"], r["repo"], r["base_commit"][:10], os.path.isdir(g), r.get("workdir","")))
with open("/tmp/wf-slatec/resolution-computed-facts/tasks-safe.tsv","w") as f:
    for o in out: f.write("\t".join(map(str,o))+"\n")
for o in out: print("\t".join(map(str,o)))
