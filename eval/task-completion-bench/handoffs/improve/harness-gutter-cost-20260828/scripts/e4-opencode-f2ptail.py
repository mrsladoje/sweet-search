#!/usr/bin/env python3
"""E4 - pull the FAIL_TO_PASS test outcome lines out of each grader log."""
import sys, json, os, re
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts
from bundle import spec, grader_log, armdir

task = sys.argv[1]
CTX = int(sys.argv[2]) if len(sys.argv) > 2 else 6
s = spec(task)
f2p = s["FAIL_TO_PASS"]
if isinstance(f2p, str): f2p = json.loads(f2p)
print("F2P:", f2p)
for t, arm, rep, row, run, rd in sorted(rollouts(), key=lambda x: (x[1], x[2])):
    if t != task: continue
    gl = grader_log(rd, armdir(arm), rep, task)
    print("\n===== %s rep%d resolved=%s f2p=%s :: %s" % (arm, rep, row.get("resolved"), row.get("f2pFrac"), gl))
    if not gl: continue
    lines = open(gl, errors="replace").read().split("\n")
    hits = []
    for name in f2p:
        key = name.split(">")[-1].strip()
        key = re.sub(r"^(test_|it |Should )", "", key)[:48]
        for i, l in enumerate(lines):
            if key and key.lower() in l.lower():
                hits.append(i)
    shown = set()
    for i in sorted(set(hits))[:4]:
        for j in range(max(0, i - 1), min(len(lines), i + CTX)):
            if j in shown: continue
            shown.add(j); print("   |", lines[j][:200])
        print("   |---")
