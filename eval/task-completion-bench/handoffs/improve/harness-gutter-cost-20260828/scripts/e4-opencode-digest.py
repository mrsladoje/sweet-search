#!/usr/bin/env python3
"""E4 item 2 - compact per-task forensic digest: gold, F2P, per-cell patch + grader tail."""
import sys, json, os, re
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse
from bundle import spec, patch_for, grader_log, armdir

task = sys.argv[1]
GOLDN = int(sys.argv[2]) if len(sys.argv) > 2 else 2500
PN = int(sys.argv[3]) if len(sys.argv) > 3 else 1400
s = spec(task)
print("##### TASK", task, "|", s["repo"], "|", s["language"])
print("##### FAIL_TO_PASS:", json.dumps(s["FAIL_TO_PASS"])[:900])
print("##### PROBLEM (first 1200):\n" + (s["problem_statement"] or "")[:1200])
print("\n##### GOLD PATCH (src only, %d chars):" % GOLDN)
src = "".join(c for c in re.split(r"(?=^diff --git )", s["patch"], flags=re.M) if not re.search(r"a/(test|tests|spec)[s]?/", c[:200]))
print((src or s["patch"])[:GOLDN])
print("\n##### PER-CELL")
for t, arm, rep, row, run, rd in sorted(rollouts(), key=lambda x: (x[1], x[2])):
    if t != task: continue
    p, _ = patch_for(rd, armdir(arm), rep, task)
    gl = grader_log(rd, armdir(arm), rep, task)
    tail = ""
    if gl:
        txt = open(gl, errors="replace").read()
        for pat in [r"(?s)(FAIL_TO_PASS.*)$", r"(?s)(=+ (?:short test summary|FAILURES).*)$"]:
            m = re.search(pat, txt)
            if m: tail = m.group(1)[:900]; break
        if not tail: tail = txt[-900:]
    print("\n===== %s rep%d resolved=%s f2p=%s hunks=%s files=%s calls=%s" % (arm, rep, row.get("resolved"), row.get("f2pFrac"), row.get("patchHunks"), row.get("patchFiles"), row.get("calls")))
    print("--- final say: " + (row.get("finalAssistantText") or "")[:400].replace("\n", " "))
    print("--- patch:\n" + (p or "<EMPTY>")[:PN])
    if tail: print("--- grader tail:\n" + tail)
