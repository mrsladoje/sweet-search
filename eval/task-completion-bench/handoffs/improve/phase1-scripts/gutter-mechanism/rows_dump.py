import json
RUNS=["rb-codex-20260825","gab-pipe-20260825","gab-none-20260825","rb-opencode-20260824","gx-oc-pipe-20260825","gx-oc-none-20260825","rb-claudecode-20260824","gx-cc-pipe-20260825","gx-cc-none-20260825"]
SIX=["jashkenas__underscore-2757","pytask-dev__pytask-210","rstudio-education__gradethis-161","teleporthq__teleport-code-generators-291"]
R="/root/sweet-search-private/eval/task-completion-bench/results"
for run in RUNS:
    rows=json.load(open(f"{R}/{run}/rows.json"))
    models=sorted(set(str(r.get("model")) for r in rows))
    print(f"\n== {run}  model={models}")
    for r in sorted(rows,key=lambda r:(r["taskId"],r["arm"],r.get("rep",0))):
        if r["taskId"] not in SIX or (r["arm"]!="sweet" and not run.startswith("rb-")): continue
        tc=r.get("toolCounts") or {}
        print(f"  {r['taskId'][:22]:22s} {r['arm']:6s} rep{r.get('rep')} res={int(bool(r.get('resolved')))} f2p={r.get('f2pFrac')} exit={str(r.get('exitReason'))[:16]:16s} calls={r.get('calls')} edit={tc.get('edit')} ss={tc.get('ss')} test={tc.get('test')} patchF={r.get('patchFiles')} hunks={r.get('patchHunks')} ranTests={r.get('ranTests')} noTestEv={r.get('noTestEvidence')} rtV={str(r.get('rtVerdicts'))[:36]} cost={r.get('realFromTurnsUsd')}")
