#!/usr/bin/env python3
"""E4 step 2 -- task card: spec, gold patch, F2P, and every arm's model_patch.

usage: taskcard.py <task-substring> [--patches] [--gold] [--log ARM REP]
"""
import json, os, re, sys

BASE = "/root/sweet-search-private/eval/task-completion-bench/results"
TASKS = "/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_heldout.json"
RUNS = {"TAB": "fp-codex-tab-20260826", "NONE": "fp-codex-none-20260826", "PIPE": "fp-codex-pipe-20260826"}


def spec(sub):
    ts = json.load(open(TASKS))
    for t in ts:
        if t["instance_id"] == sub:
            return t
    hits = [t for t in ts if sub in t["instance_id"]]
    if len(hits) > 1:
        raise SystemExit("ambiguous task substring %r -> %s" % (sub, [h["instance_id"] for h in hits]))
    return hits[0] if hits else None
    return None


def patch_of(run, armdir, rep, task):
    p = os.path.join(BASE, run, armdir, "patches.json") if rep == 0 else \
        os.path.join(BASE, run, armdir, f"rep-{rep}", "patches.json")
    if not os.path.exists(p):
        return None
    for r in json.load(open(p)):
        if r.get("instance_id") == task:
            return r.get("patch")
    return None


def logpath(run, armdir, rep, task):
    d = os.path.join(BASE, run, armdir, "logs") if rep == 0 else \
        os.path.join(BASE, run, armdir, f"rep-{rep}", "logs")
    return os.path.join(d, f"{task}_log.txt")


def main():
    sub = sys.argv[1]
    t = spec(sub)
    if not t:
        print("no task"); return
    print("=" * 100)
    print("TASK", t["instance_id"], "lang=", t.get("language"), "repo=", t.get("repo"))
    print("-- problem statement (first 2500 chars)")
    print((t.get("problem_statement") or "")[:2500])
    f2p = t.get("FAIL_TO_PASS")
    if isinstance(f2p, str):
        try: f2p = json.loads(f2p)
        except Exception: pass
    print("-- FAIL_TO_PASS:", json.dumps(f2p)[:1500])
    p2p = t.get("PASS_TO_PASS")
    if isinstance(p2p, str):
        try: p2p = json.loads(p2p)
        except Exception: pass
    print("-- PASS_TO_PASS count:", len(p2p) if isinstance(p2p, list) else "?")
    print("-- GOLD PATCH")
    print(t.get("patch"))
    if "--testpatch" in sys.argv:
        print("-- TEST PATCH")
        print(t.get("test_patch"))
    if "--patches" in sys.argv:
        for form, run in RUNS.items():
            for armdir, label in (("sweet", form), ("native", "native")):
                if armdir == "native" and form != "TAB":
                    continue
                for rep in (0, 1, 2):
                    p = patch_of(run, armdir, rep, t["instance_id"])
                    print("#" * 90)
                    print(f"### {label} rep{rep}  ({len(p) if p else 0} bytes)")
                    print(p if p else "(empty)")
    if "--log" in sys.argv:
        i = sys.argv.index("--log")
        label, rep = sys.argv[i + 1], int(sys.argv[i + 2])
        n = int(sys.argv[i + 3]) if len(sys.argv) > i + 3 and sys.argv[i + 3].isdigit() else 120
        run = RUNS["TAB"] if label == "native" else RUNS[label]
        armdir = "native" if label == "native" else "sweet"
        lp = logpath(run, armdir, rep, t["instance_id"])
        print("### LOG", lp)
        if os.path.exists(lp):
            txt = open(lp, errors="replace").read()
            print(f"(log {len(txt)} bytes; tail {n} lines)")
            print("\n".join(txt.splitlines()[-n:]))
        else:
            print("(missing)")


if __name__ == "__main__":
    main()
