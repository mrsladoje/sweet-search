#!/usr/bin/env python3
"""E4 item 3b - classify every ss-* call failure into a product-defect bucket."""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse, ss_tools

buckets = collections.Counter()
brollouts = collections.defaultdict(set)
bex = collections.defaultdict(list)
allbad = []
status_ct = collections.Counter()
ss_total = 0

def classify(tool, cmd, out, exitc, status):
    o = out or ""
    if status != "completed":
        return "harness-aborted(status=%s)" % status
    if o.strip() == "":
        return "silent-empty-output"
    if "unrecognised option" in o:
        return "cli-unknown-flag"
    if "argument(s) not consumed" in o:
        return "cli-positional-path-rejected"
    if "command not found" in o:
        return "guide-placeholder-pasted"
    if "error: stat failed: ENOENT" in o:
        return "ss-read-ENOENT"
    if "error: not a regular file" in o:
        return "ss-read-not-a-file"
    if "No indexed symbol found" in o:
        return "ss-trace-symbol-not-indexed"
    if "BinaryHNSW: Loaded" in o or "LateInteraction: Loading" in o:
        return "engine-banner-leak"
    if str(exitc) not in ("0", "None"):
        return "other-nonzero(exit=%s)" % exitc
    return None

for t, arm, rep, row, run, rd in rollouts():
    if arm == "native": continue
    ev = parse(ndjson_path(row, rd))
    for e in ev:
        if e["k"] != "tool" or e["tool"] != "bash": continue
        cmd = e.get("cmd") or ""
        tl = ss_tools(cmd)
        if not tl: continue
        ss_total += 1
        m = e.get("meta") or {}
        exitc = m.get("exit"); out = e.get("output") or ""; st = e["status"]
        status_ct[st] += 1
        b = classify(tl[0], cmd, out, exitc, st)
        if b:
            key = (b, tl[0])
            buckets[key] += 1
            brollouts[key].add((t, arm, rep))
            allbad.append({"bucket": b, "tool": tl[0], "task": t, "arm": arm, "rep": rep,
                           "cmd": cmd, "exit": exitc, "status": st, "out": out[:1500]})
            if len(bex[key]) < 4: bex[key].append(allbad[-1])

print("ss-* bash calls total:", ss_total, " statuses:", dict(status_ct))
print("\n%-38s %-14s %6s %8s" % ("BUCKET", "TOOL", "CALLS", "ROLLOUTS"))
for (b, tool), n in sorted(buckets.items(), key=lambda kv: -kv[1]):
    print("%-38s %-14s %6d %8d" % (b, tool, n, len(brollouts[(b, tool)])))
json.dump({"buckets": {"%s|%s" % k: {"calls": v, "rollouts": len(brollouts[k])} for k, v in buckets.items()},
           "all": allbad}, open("/tmp/fp-inv/e4-opencode/defects.json", "w"), indent=1)
