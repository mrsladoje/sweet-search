import json, collections
R="/root/sweet-search-private/eval/task-completion-bench/results"
for run in ["fp-codex-tab-20260826","fp-opencode-tab-20260826","rp-oc-tab-20260827","fp-claudecode-tab-20260826"]:
    rows=json.load(open(f"{R}/{run}/rows.json"))
    rows = rows if isinstance(rows,list) else rows.get("rows",rows)
    by=collections.Counter(r["arm"] for r in rows)
    print(run, "rows", len(rows), dict(by))
    acc=[r for r in rows if str(r.get("taskId","")).startswith("accenture")]
    for r in sorted(acc,key=lambda r:(r["arm"],int(r.get("rep",0)))):
        print("   ", r["arm"], "rep", r.get("rep"), "resolved=%s"%r.get("resolved"), "f2p=%s"%r.get("f2pFrac"), "hunks=%s"%r.get("patchHunks"), "calls=%s"%r.get("calls"), "cost=%s"%r.get("costRealizedUsd"), "gradeable=%s"%r.get("gradeable"))
    # solved totals
    for arm in ("native","sweet"):
        rs=[r for r in rows if r["arm"]==arm]
        print("   total", arm, sum(1 for r in rs if r.get("resolved")), "/", len(rs))
