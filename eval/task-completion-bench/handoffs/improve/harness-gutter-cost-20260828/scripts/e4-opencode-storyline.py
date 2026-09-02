#!/usr/bin/env python3
"""E4 - tool-call storyline for one task: every call, truncated result, and edit."""
import sys, json, os, re
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse, ss_tools

task = sys.argv[1]
only = sys.argv[2] if len(sys.argv) > 2 else None      # e.g. "tab:0"
RES = int(sys.argv[3]) if len(sys.argv) > 3 else 300
for t, arm, rep, row, run, rd in sorted(rollouts(), key=lambda x: (x[1], x[2])):
    if t != task: continue
    if only and only != "%s:%d" % (arm, rep): continue
    print("\n########## %s rep%d resolved=%s f2p=%s calls=%s (%s)" % (arm, rep, row.get("resolved"), row.get("f2pFrac"), row.get("calls"), run))
    ev = parse(ndjson_path(row, rd))
    n = 0
    for e in ev:
        if e["k"] == "text":
            tx = (e.get("text") or "").strip()
            if tx: print("  [say] " + tx.replace("\n", " ")[:RES])
            continue
        if e["k"] != "tool": continue
        n += 1
        tool = e["tool"]
        if tool == "bash":
            lbl = (e.get("cmd") or "").replace("\n", " ")[:260]
        elif tool == "apply_patch":
            inp = e.get("input") or {}
            lbl = (inp.get("patchText") or json.dumps(inp))[:600].replace("\n", "\\n")
        elif tool == "todowrite":
            continue
        else:
            lbl = json.dumps(e.get("input"))[:200]
        out = (e.get("output") or "").replace("\n", " ")
        st = e["status"]
        ex = (e.get("meta") or {}).get("exit")
        print("  %2d. <%s%s%s> %s" % (n, tool, "" if st == "completed" else "!" + str(st), "" if str(ex) in ("0", "None") else " exit=" + str(ex), lbl))
        if RES: print("      -> %s" % out[:RES])
