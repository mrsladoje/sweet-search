#!/usr/bin/env python3
"""E4 - find rollouts scored resolved=false that were never actually graded."""
import sys, json, os
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts
from bundle import grader_log, armdir

bad = []
for t, arm, rep, row, run, rd in sorted(rollouts(), key=lambda x: (x[0], x[1], x[2])):
    gl = grader_log(rd, armdir(arm), rep, t)
    nolog = gl is None
    nullres = row.get("f2pFrac") is None or row.get("testResults") is None or row.get("resolveStatus") is None
    if nolog or nullres:
        bad.append({"task": t, "arm": arm, "rep": rep, "run": run, "resolved": row.get("resolved"),
                    "f2p": row.get("f2pFrac"), "status": row.get("resolveStatus"),
                    "testResults": row.get("testResults"), "gradeable": row.get("gradeable"),
                    "noTestEvidence": row.get("noTestEvidence"), "graderLog": gl})
print("rollouts with a null grade field or no grader log:", len(bad), "of 264")
for b in bad: print(" ", json.dumps(b))
