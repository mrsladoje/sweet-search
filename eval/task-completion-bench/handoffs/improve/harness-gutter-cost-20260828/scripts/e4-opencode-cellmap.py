#!/usr/bin/env python3
"""E4 - per-cell compact map: f2pFrac, files touched, hunks, ss-tool mix, edit failures."""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse, ss_tools
from bundle import spec, patch_for, armdir

TASKS = sys.argv[1].split(",") if len(sys.argv) > 1 else None
out = {}
for t, arm, rep, row, run, rd in sorted(rollouts(), key=lambda x: (x[0], x[1], x[2])):
    if TASKS and t not in TASKS: continue
    p, _ = patch_for(rd, armdir(arm), rep, t)
    files = re.findall(r"(?m)^\+\+\+ b/(\S+)", p or "")
    adds = len(re.findall(r"(?m)^\+(?!\+\+)", p or ""))
    dels = len(re.findall(r"(?m)^-(?!--)", p or ""))
    ev = parse(ndjson_path(row, rd))
    ssc = collections.Counter(); nat = collections.Counter(); editfail = 0; edits = 0; rt = 0
    for e in ev:
        if e["k"] != "tool": continue
        if e["tool"] == "apply_patch":
            edits += 1
            o = e.get("output") or ""
            if e["status"] != "completed" or "Success" not in o: editfail += 1
        elif e["tool"] == "bash":
            c = e.get("cmd") or ""
            for s in set(ss_tools(c)): ssc[s] += 1
            if "run_tests" in c: rt += 1
            for n in ["grep ", "rg ", "sed ", "cat ", "find ", "nl ", "head ", "tail "]:
                if re.search(r"(?:^|[;&|]\s*)" + n.strip() + r"\b", c): nat[n.strip()] += 1
        elif e["tool"] in ("read", "grep", "glob"):
            nat["hz:" + e["tool"]] += 1
    out.setdefault(t, {})["%s/%d" % (arm, rep)] = {
        "resolved": row.get("resolved"), "f2p": row.get("f2pFrac"), "files": files,
        "adds": adds, "dels": dels, "calls": row.get("calls"), "edits": edits,
        "editFail": editfail, "runTests": rt, "ss": dict(ssc), "native": dict(nat),
        "exit": row.get("exitReason"),
    }
for t in out:
    print("\n##### " + t)
    print("  %-10s %-6s %-5s %-3s %-4s %-4s %-3s %-3s %-3s %s" % ("cell", "res", "f2p", "cal", "add", "del", "ed", "ef", "rt", "files | ss"))
    for c in sorted(out[t]):
        r = out[t][c]
        print("  %-10s %-6s %-5s %-3s %-4s %-4s %-3s %-3s %-3s %s | %s | nat=%s" % (
            c, r["resolved"], r["f2p"], r["calls"], r["adds"], r["dels"], r["edits"], r["editFail"],
            r["runTests"], ",".join(x.split("/")[-1] for x in r["files"])[:60], r["ss"], r["native"]))
json.dump(out, open("/tmp/fp-inv/e4-opencode/cellmap.json", "w"), indent=1)
