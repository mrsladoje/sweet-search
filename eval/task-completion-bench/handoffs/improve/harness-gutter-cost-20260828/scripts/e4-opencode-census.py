#!/usr/bin/env python3
"""E4 item 3 - tool census over every opencode rollout."""
import sys, json, collections, os
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse, ss_tools, native_tools

tools = collections.Counter()
byarm = collections.defaultdict(collections.Counter)
missing = []
cmdtools = collections.Counter()
for t, arm, rep, row, run, rd in rollouts():
    p = ndjson_path(row, rd)
    if not p or not os.path.exists(p):
        missing.append((run, t, arm, rep, p)); continue
    ev = parse(p)
    ntool = 0
    for e in ev:
        if e["k"] != "tool": continue
        ntool += 1
        tools[e["tool"]] += 1
        byarm[arm][e["tool"]] += 1
        if e["tool"] == "bash":
            c = (e.get("cmd") or "").strip()
            head = c.split()[0] if c.split() else "?"
            cmdtools[head] += 1
    byarm[arm]["_rollouts"] += 1
    byarm[arm]["_toolcalls"] += ntool

print("MISSING transcripts:", missing)
print("\nTOOL NAMES overall:", dict(tools))
print("\nPER ARM:")
for a in ["native", "tab", "none", "pipe"]:
    print(" ", a, dict(byarm[a]))
print("\nBASH command heads (top 40):")
for k, v in cmdtools.most_common(40): print("  %6d  %s" % (v, k))
