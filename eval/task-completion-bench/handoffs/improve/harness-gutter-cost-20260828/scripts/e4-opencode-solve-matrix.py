#!/usr/bin/env python3
"""E4 item 1 - opencode solve matrix over the fresh pool, repair rows substituted."""
import json, os, sys, collections

BASE = "/root/sweet-search-private/eval/task-completion-bench/results"
FP = {"tab": "fp-opencode-tab-20260826", "none": "fp-opencode-none-20260826", "pipe": "fp-opencode-pipe-20260826"}
RP = {"tab": "rp-oc-tab-20260827", "none": "rp-oc-none-20260827", "pipe": "rp-oc-pipe-20260827"}
POOL = [l.strip() for l in open("/root/fresh-run/pool.txt") if l.strip()]
REPAIR = set(l.strip() for l in open("/root/fresh-run/repair-tasks.txt") if l.strip())

def load(run):
    p = os.path.join(BASE, run, "rows.json")
    return json.load(open(p))

# arm keys: native, tab, none, pipe
cells = collections.defaultdict(dict)   # (task, armkey) -> {rep: row}
ungraded = []
dupes = collections.Counter()

for form, run in FP.items():
    rows = load(run)
    for r in rows:
        t = r["taskId"]
        if t not in POOL: continue
        if r["arm"] == "native":
            if form != "tab":   # native only exists in the tab runs
                continue
            key = "native"
        else:
            key = form
            if t in REPAIR:     # replaced by the repair pass
                continue
        if r.get("resolved") is None: ungraded.append((run, t, r["arm"], r["rep"]))
        prev = cells[(t, key)].get(r["rep"])
        if prev is not None: dupes[(run, t, key, r["rep"])] += 1
        cells[(t, key)][r["rep"]] = r

for form, run in RP.items():
    rows = load(run)
    for r in rows:
        t = r["taskId"]
        if t not in REPAIR: continue
        if r["arm"] != "sweet": continue
        if r.get("resolved") is None: ungraded.append((run, t, r["arm"], r["rep"]))
        prev = cells[(t, form)].get(r["rep"])
        if prev is not None: dupes[(run, t, form, r["rep"])] += 1
        cells[(t, form)][r["rep"]] = r

ARMS = ["native", "tab", "none", "pipe"]
out = {"pool": POOL, "repairTasks": sorted(REPAIR), "ungraded": ungraded, "dupes": {str(k): v for k, v in dupes.items()}, "tasks": {}}
missing = []
for t in POOL:
    rec = {}
    for a in ARMS:
        reps = cells.get((t, a), {})
        for rp in (0, 1, 2):
            if rp not in reps: missing.append((t, a, rp))
        solved = sum(1 for rp, r in reps.items() if r.get("resolved") is True)
        rec[a] = {
            "n": len(reps),
            "solved": solved,
            "reps": {str(rp): {"resolved": r.get("resolved"), "f2pFrac": r.get("f2pFrac"),
                               "gradeable": r.get("gradeable"), "resolveStatus": r.get("resolveStatus"),
                               "runId": r.get("runId"), "calls": r.get("calls"),
                               "patchHunks": r.get("patchHunks"), "patchFiles": r.get("patchFiles"),
                               "exitReason": r.get("exitReason"), "cost": r.get("costRealizedUsd"),
                               "noTestEvidence": r.get("noTestEvidence"),
                               "toolCounts": r.get("toolCounts"),
                               "stepsToFirstEdit": r.get("stepsToFirstEdit")}
                     for rp, r in sorted(reps.items())},
        }
    out["tasks"][t] = rec
out["missing"] = missing

# classification
def maj(x): return 1 if x >= 2 else 0
cls = {}
for t in POOL:
    rec = out["tasks"][t]
    sv = [rec[a]["solved"] for a in ARMS]
    if all(s == 3 for s in sv): c = "solved-everywhere"
    elif all(s == 0 for s in sv): c = "dead-everywhere"
    else:
        mj = [maj(s) for s in sv]
        c = "discordant" if len(set(mj)) > 1 else ("stable-majority-" + ("solve" if mj[0] else "dead"))
    cls[t] = c
out["class"] = cls

print(json.dumps(out))
