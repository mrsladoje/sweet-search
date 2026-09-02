#!/usr/bin/env python3
"""E4 - dump every apply_patch call for a task (or all), with the @@ locator lines."""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse

task = sys.argv[1] if len(sys.argv) > 1 else None
FULL = len(sys.argv) > 2 and sys.argv[2] == "full"
stats = collections.Counter()
rows = []
for t, arm, rep, row, run, rd in sorted(rollouts(), key=lambda x: (x[0], x[1], x[2])):
    if task and t != task: continue
    ev = parse(ndjson_path(row, rd))
    for e in ev:
        if e["k"] != "tool" or e["tool"] != "apply_patch": continue
        pt = (e.get("input") or {}).get("patchText") or ""
        out = e.get("output") or ""
        ok = e["status"] == "completed" and "Success" in out
        # hunk analysis
        hunks = re.findall(r"(?m)^@@(.*)$", pt)
        bare = sum(1 for h in hunks if h.strip() == "")
        stats["hunks"] += len(hunks); stats["bareAt"] += bare
        stats["calls"] += 1; stats["ok" if ok else "fail"] += 1
        rows.append({"task": t, "arm": arm, "rep": rep, "resolved": row.get("resolved"),
                     "hunks": len(hunks), "bareAt": bare, "ok": ok,
                     "locators": [h.strip()[:70] for h in hunks],
                     "pt": pt if FULL else pt[:1200], "out": out[:300]})
if task:
    for r in rows:
        print("\n=== %s rep%d resolved=%s ok=%s hunks=%d bare@@=%d" % (r["arm"], r["rep"], r["resolved"], r["ok"], r["hunks"], r["bareAt"]))
        print("locators:", r["locators"])
        print(r["pt"])
        print("OUT:", r["out"])
else:
    print(json.dumps(dict(stats), indent=1))
    json.dump(rows, open("/tmp/fp-inv/e4-opencode/editanchors.json", "w"))
