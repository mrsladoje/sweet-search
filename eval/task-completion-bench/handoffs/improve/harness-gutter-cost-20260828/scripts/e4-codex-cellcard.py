#!/usr/bin/env python3
"""E4 step 2 -- compact per-cell card: model patch (diff, .map files elided) plus
the failing-test lines from that cell's grader log.

usage: cellcard.py <task-substring> [ARM ...]      ARM in native|TAB|NONE|PIPE
"""
import json, os, re, sys

BASE = "/root/sweet-search-private/eval/task-completion-bench/results"
TASKS = "/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_heldout.json"
RUNS = {"TAB": "fp-codex-tab-20260826", "NONE": "fp-codex-none-20260826", "PIPE": "fp-codex-pipe-20260826"}

FAILPAT = re.compile(
    r"^(?:FAIL |not ok |✕|✗|●|\s+\d+\) |E\s|FAILED |--- FAIL|\s*\* test .*\[L#|"
    r"There (?:was|were) \d+ failure|Failures:|AssertionError|Error: |"
    r"\s*\d+\)\s|assert |Expected|Received|expected:|but was:|"
    r"Tests?:|Test Suites:|OK \(|FAILURES!|ok \d|# fail|failures=|passed,|failed,)", re.M)


def spec(sub):
    ts = json.load(open(TASKS))
    for t in ts:
        if t["instance_id"] == sub:
            return t
    hits = [t for t in ts if sub in t["instance_id"]]
    if len(hits) > 1:
        raise SystemExit("ambiguous task substring %r -> %s" % (sub, [h["instance_id"] for h in hits]))
    return hits[0] if hits else None


def patch_of(run, armdir, rep, task):
    p = os.path.join(BASE, run, armdir, "patches.json") if rep == 0 else \
        os.path.join(BASE, run, armdir, f"rep-{rep}", "patches.json")
    if not os.path.exists(p):
        return None
    for r in json.load(open(p)):
        if r.get("instance_id") == task:
            return r.get("patch")


def elide_maps(p, maxlen=6000):
    out, skip = [], False
    for line in (p or "").splitlines():
        if line.startswith("diff --git"):
            skip = line.endswith(".map") or ".d.ts.map" in line or line.endswith(".lock")
            if skip:
                out.append(line + "   <<elided>>")
                continue
        if not skip:
            out.append(line)
    s = "\n".join(out)
    return s[:maxlen] + ("\n...<truncated>" if len(s) > maxlen else "")


def logfails(run, armdir, rep, task, keep=28):
    d = os.path.join(BASE, run, armdir, "logs") if rep == 0 else \
        os.path.join(BASE, run, armdir, f"rep-{rep}", "logs")
    lp = os.path.join(d, f"{task}_log.txt")
    if not os.path.exists(lp):
        return "(no log)"
    txt = open(lp, errors="replace").read()
    lines = [l for l in txt.splitlines() if FAILPAT.match(l)]
    return "\n".join(lines[-keep:]) if lines else "\n".join(txt.splitlines()[-keep:])


def main():
    sub = sys.argv[1]
    arms = sys.argv[2:] or ["native", "TAB", "NONE", "PIPE"]
    t = spec(sub)
    tid = t["instance_id"]
    for label in arms:
        run = RUNS["TAB"] if label == "native" else RUNS[label]
        armdir = "native" if label == "native" else "sweet"
        for rep in (0, 1, 2):
            p = patch_of(run, armdir, rep, tid)
            print("#" * 96)
            print(f"### {tid}  {label} rep{rep}   patch={len(p) if p else 0}B")
            print(elide_maps(p))
            print("--- grader failing lines:")
            print(logfails(run, armdir, rep, tid))


if __name__ == "__main__":
    main()
