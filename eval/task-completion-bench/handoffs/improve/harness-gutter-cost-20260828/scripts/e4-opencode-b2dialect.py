#!/usr/bin/env python3
"""E4 - b2 dual-implementation test: what extension do retrieval results name?"""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse, ss_tools

PATHRX = re.compile(r"\b((?:src|test|tools)/[\w./-]*\.(jam|py|cpp|h))\b")
for task in ["bfgroup__b2-113", "bfgroup__b2-259"]:
    print("\n##########", task)
    for t, arm, rep, row, run, rd in sorted(rollouts(), key=lambda x: (x[1], x[2])):
        if t != task: continue
        ev = parse(ndjson_path(row, rd))
        ext_first = collections.Counter()   # ext named by the FIRST retrieval call
        ext_all = collections.Counter()
        firstcall = None
        for e in ev:
            if e["k"] != "tool": continue
            out = e.get("output") or ""
            cmd = e.get("cmd") or ""
            isret = (e["tool"] in ("grep", "glob")) or bool(ss_tools(cmd))
            if not isret: continue
            hits = collections.Counter(m[1] for m in PATHRX.findall(out))
            if firstcall is None and hits:
                firstcall = (cmd or json.dumps(e.get("input"))[:80], dict(hits))
            ext_all.update(hits)
        print("  %-6s rep%d resolved=%-5s allResults=%s" % (arm, rep, row.get("resolved"), dict(ext_all)))
        if firstcall: print("        first retrieval that named a path: %s -> %s" % (firstcall[0][:110], firstcall[1]))
