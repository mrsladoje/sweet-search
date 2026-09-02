#!/usr/bin/env python3
"""E4 -- silent hunk misplacement census.

Every codex apply_patch hunk in this run uses a bare `@@` header, so the tool
places it by forward-seek from the current index. When the anchor text occurs
more than once the hunk lands at the first occurrence, with no error.

Detector: the agent's final message usually names `path:LINE` for the change it
believes it made. Compare that line with the hunk ranges in the rollout's own
model_patch for the same file. Outside every hunk by more than SLACK lines =
the agent's belief and the applied position disagree.
"""
import json, os, re, sys, collections

IN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/all.jsonl"
BASE = "/root/sweet-search-private/eval/task-completion-bench/results"
RUNS = {"TAB": "fp-codex-tab-20260826", "NONE": "fp-codex-none-20260826", "PIPE": "fp-codex-pipe-20260826"}
SLACK = 40

RE_CITE = re.compile(r"`?([\w][\w./-]*\.[A-Za-z0-9_]{1,6}):(\d+)`?")
RE_HDR = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", re.M)


def patch_of(run, armdir, rep, task):
    p = os.path.join(BASE, run, armdir, "patches.json") if rep == 0 else \
        os.path.join(BASE, run, armdir, f"rep-{rep}", "patches.json")
    if not os.path.exists(p):
        return None
    for r in json.load(open(p)):
        if r.get("instance_id") == task:
            return r.get("patch")


def file_hunks(patch):
    out = collections.defaultdict(list)
    cur = None
    for line in (patch or "").splitlines():
        m = re.match(r"^diff --git a/(\S+) b/(\S+)", line)
        if m:
            cur = m.group(2)
            continue
        m = RE_HDR.match(line)
        if m and cur:
            start = int(m.group(3)); ln = int(m.group(4) or 1)
            out[cur].append((start, start + ln))
    return out


def main():
    stats = collections.defaultdict(collections.Counter)
    cases = []
    for line in open(IN):
        rec = json.loads(line)
        tr = rec.get("trace")
        if not tr:
            continue
        msgs = tr.get("messages") or []
        if not msgs:
            continue
        arm = rec["arm"]
        tag = f"{rec['task']}/{arm}/rep{rec['rep']}"
        run = RUNS[rec["form"]]
        armdir = "native" if arm == "native" else "sweet"
        fh = file_hunks(patch_of(run, armdir, rec["rep"], rec["task"]))
        if not fh:
            continue
        cites = RE_CITE.findall(msgs[-1])
        for path, ln in cites:
            ln = int(ln)
            match = [f for f in fh if f.endswith(path) or path.endswith(f.split("/")[-1])]
            if not match:
                continue
            f = match[0]
            stats[arm]["cited"] += 1
            near = any(a - SLACK <= ln <= b + SLACK for a, b in fh[f])
            if near:
                stats[arm]["consistent"] += 1
            else:
                stats[arm]["inconsistent"] += 1
                cases.append({"rollout": tag, "arm": arm, "resolved": rec["resolved"],
                              "file": f, "citedLine": ln, "hunks": fh[f]})
    for a in ("native", "TAB", "NONE", "PIPE"):
        s = stats[a]
        tot = s["cited"]
        print(f"{a:8s} cited {tot:4d}  consistent {s['consistent']:4d}  inconsistent {s['inconsistent']:4d}"
              f"  ({(100.0*s['inconsistent']/tot if tot else 0):.1f}%)")
    print()
    print("inconsistent cases (agent's stated line vs the hunk it actually produced):")
    for c in cases:
        print(f"  {c['rollout']:52s} resolved={c['resolved']}  {c['file']}:{c['citedLine']} "
              f"vs hunks {c['hunks']}")
    json.dump({"stats": {a: dict(stats[a]) for a in stats}, "cases": cases},
              open("/tmp/fp-inv/e4-codex/misplace.json", "w"), indent=1)


if __name__ == "__main__":
    main()
