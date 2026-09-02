#!/usr/bin/env python3
"""E4 - did any tool output in a task's rollouts ever contain a given needle?"""
import sys, json, os, re
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse

task = sys.argv[1]; needle = sys.argv[2]
rx = re.compile(needle)
for t, arm, rep, row, run, rd in sorted(rollouts(), key=lambda x: (x[1], x[2])):
    if t != task: continue
    ev = parse(ndjson_path(row, rd))
    hits = []
    for e in ev:
        if e["k"] != "tool": continue
        out = e.get("output") or ""
        if rx.search(out):
            cmd = e.get("cmd") or json.dumps(e.get("input"))[:120]
            m = rx.search(out)
            hits.append((e["tool"], cmd[:110], out[max(0, m.start()-90):m.start()+110].replace("\n", " ")))
    print("%-6s rep%d resolved=%-5s hits=%d" % (arm, rep, row.get("resolved"), len(hits)))
    for h in hits[:3]: print("    <%s> %s\n       ...%s..." % h)
