#!/usr/bin/env python3
"""E4 item 2 - build a forensic bundle for one task: gold, F2P, per-arm patches, grader tails."""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse, ss_tools, BASE

TASKS = "/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_heldout.json"
_spec = None
def spec(tid):
    global _spec
    if _spec is None:
        _spec = {t["instance_id"]: t for t in json.load(open(TASKS))}
    return _spec.get(tid)

def patch_for(runDir, arm, rep, task):
    for cand in [os.path.join(runDir, arm, "rep-%d" % rep, "patches.json"),
                 os.path.join(runDir, arm, "patches.json")]:
        if os.path.exists(cand):
            try: d = json.load(open(cand))
            except Exception: continue
            if isinstance(d, dict):
                v = d.get(task)
                if isinstance(v, dict): v = v.get("model_patch")
                if v is not None: return v, cand
            if isinstance(d, list):
                for r in d:
                    if r.get("instance_id") == task or r.get("taskId") == task:
                        return r.get("model_patch") or r.get("patch"), cand
    return None, None

def grader_log(runDir, arm, rep, task):
    for cand in [os.path.join(runDir, arm, "rep-%d" % rep, "logs", task + "_log.txt"),
                 os.path.join(runDir, arm, "logs", task + "_log.txt")]:
        if os.path.exists(cand): return cand
    return None

def armdir(arm):
    return "native" if arm == "native" else "sweet"

if __name__ == "__main__":
    task = sys.argv[1]
    what = sys.argv[2] if len(sys.argv) > 2 else "all"
    s = spec(task)
    if what in ("all", "spec"):
        print("### TASK", task, "repo", s["repo"], "lang", s["language"])
        print("### FAIL_TO_PASS:", json.dumps(s["FAIL_TO_PASS"])[:1500])
        print("### GOLD PATCH:\n" + s["patch"][:6000])
        print("### PROBLEM STATEMENT:\n" + (s["problem_statement"] or "")[:3000])
    if what in ("all", "patches"):
        for t, arm, rep, row, run, rd in sorted(rollouts(), key=lambda x: (x[1], x[2])):
            if t != task: continue
            p, src = patch_for(rd, armdir(arm), rep, task)
            print("\n===== %s rep%d resolved=%s f2p=%s (%s)" % (arm, rep, row.get("resolved"), row.get("f2pFrac"), run))
            print("--- patch (%s):\n%s" % (src, (p or "<EMPTY>")[:4000]))
