#!/usr/bin/env python3
"""E4 step 2 -- render a compact storyline per rollout for forensic reading.

usage: storyline.py <task-substring> [arm] [rep]
Prints, per rollout: ordered calls (program + short args), every edit attempt with
its apply_patch verdict, run_tests verdicts, the final agent message, and the
model_patch summary.
"""
import json, os, re, sys, textwrap

IN = "/tmp/fp-inv/e4-codex/all.jsonl"
BASE = "/root/sweet-search-private/eval/task-completion-bench/results"
RUNS = {"TAB": "fp-codex-tab-20260826", "NONE": "fp-codex-none-20260826", "PIPE": "fp-codex-pipe-20260826"}

APPLY_OK = re.compile(r"Success\. Updated the following files|^Done!|applied", re.M)
APPLY_FAIL = re.compile(r"Failed to find (?:context|expected lines)|apply_patch verification failed|"
                        r"Unexpected line found|error: |invalid patch|\*\*\* (?:Update|Add) File", re.M)
RE_VERDICT = re.compile(r"\[run_tests verdict\][^\n]*")


def patch_for(run, arm, rep, task):
    sub = "sweet" if arm != "native" else "native"
    p = os.path.join(BASE, run, sub, "patches.json") if rep == 0 else \
        os.path.join(BASE, run, sub, f"rep-{rep}", "patches.json")
    if not os.path.exists(p):
        return None
    for r in json.load(open(p)):
        if r.get("instance_id") == task:
            return r.get("patch")
    return None


def short(cmd, n=150):
    c = re.sub(r"<<-?\s*'?\"?(\w+)'?\"?\n.*?\n\1", " <<PATCH>> ", cmd, flags=re.S)
    c = " ".join(c.split())
    return c[:n]


def main():
    want = sys.argv[1]
    warm = sys.argv[2] if len(sys.argv) > 2 else None
    wrep = int(sys.argv[3]) if len(sys.argv) > 3 else None
    for line in open(IN):
        rec = json.loads(line)
        if want not in rec["task"]:
            continue
        if warm and rec["arm"] != warm:
            continue
        if wrep is not None and rec["rep"] != wrep:
            continue
        tr = rec.get("trace") or {"calls": [], "messages": []}
        print("=" * 100)
        print(f"{rec['task']}  arm={rec['arm']}  rep={rec['rep']}  resolved={rec['resolved']} "
              f"f2p={rec['f2pFrac']} calls={rec['calls']} hunks={rec['patchHunks']} files={rec['patchFiles']} "
              f"exit={rec['exitReason']} $={rec['idealCostUsd']}")
        print(f"  rtVerdicts={rec.get('rtVerdicts')} rtNoVerdict={rec.get('rtNoVerdict')} "
              f"rtEndedUnverified={rec.get('rtEndedUnverified')} codexErrors={rec.get('codexErrors')}")
        for i, c in enumerate(tr["calls"]):
            if c.get("name") != "exec_command":
                if c.get("name") == "update_plan":
                    continue
                print(f"  [{i:3d}] {c.get('name')}: {json.dumps(c.get('args'))[:120]}")
                continue
            out = c.get("out") or {}
            body = out.get("body") or ""
            flag = ""
            if c.get("isEdit"):
                ok = bool(APPLY_OK.search(body))
                bad = bool(re.search(r"Failed to find (context|expected lines)|verification failed|"
                                     r"Unexpected line found|patch failed|error", body))
                flag = "  <<EDIT " + ("OK" if ok and not bad else "FAIL") + ">>"
            v = RE_VERDICT.findall(body)
            trunc = "TRUNC " if "Warning: truncated output" in body else ""
            print(f"  [{i:3d}] exit={out.get('exit')} {trunc}{short(c.get('cmd',''))}{flag}")
            if flag.endswith("FAIL>>"):
                em = re.search(r"(Failed to find [^\n]*|Unexpected line[^\n]*|[^\n]*verification failed[^\n]*|"
                               r"[^\n]*error[^\n]*)", body)
                print(f"          ! {em.group(1)[:220] if em else body[:220]!r}")
            for vv in v[:3]:
                print(f"          v {vv[:200]}")
            if not c.get("isEdit") and out.get("exit") not in (0, None):
                print(f"          x exit={out.get('exit')} body0={body[:160]!r}")
        msgs = tr.get("messages") or []
        if msgs:
            print("  FINAL MESSAGE:")
            print(textwrap.indent(textwrap.fill(" ".join(msgs[-1].split())[:1400], 110), "    "))
        p = patch_for(RUNS[rec["form"]], rec["arm"], rec["rep"], rec["task"])
        if p:
            files = re.findall(r"^diff --git a/(\S+)", p, re.M)
            print(f"  PATCH: {len(p)} bytes, files={files}")
        else:
            print("  PATCH: (none)")


if __name__ == "__main__":
    main()
