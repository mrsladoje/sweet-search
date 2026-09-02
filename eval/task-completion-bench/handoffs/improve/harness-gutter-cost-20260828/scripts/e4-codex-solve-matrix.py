#!/usr/bin/env python3
"""E4 codex resolution forensics -- step 1: solve matrix task x arm.

Arms: native (from fp-codex-tab), sweet TAB, sweet NONE, sweet PIPE.
Asserts resolved != null everywhere, prints completeness, classifies tasks.
"""
import json, os, sys, collections

BASE = "/root/sweet-search-private/eval/task-completion-bench/results"
RUNS = {
    "TAB":  "fp-codex-tab-20260826",
    "NONE": "fp-codex-none-20260826",
    "PIPE": "fp-codex-pipe-20260826",
}
NATIVE_RUN = "fp-codex-tab-20260826"

def load(run):
    with open(os.path.join(BASE, run, "rows.json")) as f:
        return json.load(f)

cells = collections.defaultdict(dict)   # task -> arm -> {rep: row}
tasks = set()
problems = []

for form, run in RUNS.items():
    rows = load(run)
    for r in rows:
        arm = r["arm"]
        if arm == "native":
            key = "native"
            if run != NATIVE_RUN:
                problems.append(f"native rows in unexpected run {run}")
                continue
        else:
            key = form
        t = r["taskId"]
        tasks.add(t)
        if r.get("resolved") is None:
            problems.append(f"NULL resolved: {run} {t} {arm} rep{r['rep']}")
        cells[t].setdefault(key, {})[r["rep"]] = r

ARMS = ["native", "TAB", "NONE", "PIPE"]
tasks = sorted(tasks)

print(f"tasks={len(tasks)}")
print(f"null-resolved rows: {len(problems)}")
for p in problems[:20]:
    print("  ", p)

# completeness
for t in tasks:
    for a in ARMS:
        reps = cells[t].get(a, {})
        if sorted(reps.keys()) != [0, 1, 2]:
            print(f"INCOMPLETE {t} {a}: reps {sorted(reps.keys())}")

def solved(t, a):
    return sum(1 for rep, r in cells[t].get(a, {}).items() if r.get("resolved") is True)

print()
hdr = f"{'task':46s} " + " ".join(f"{a:>7s}" for a in ARMS)
print(hdr)
classes = {}
for t in tasks:
    s = {a: solved(t, a) for a in ARMS}
    print(f"{t:46s} " + " ".join(f"{s[a]:>7d}" for a in ARMS))
    vals = list(s.values())
    if all(v == 3 for v in vals):
        classes[t] = "solved-everywhere"
    elif all(v == 0 for v in vals):
        classes[t] = "dead-everywhere"
    else:
        # majority per arm
        maj = {a: (1 if s[a] >= 2 else 0) for a in ARMS}
        if len(set(maj.values())) > 1:
            classes[t] = "discordant-majority"
        else:
            classes[t] = "partial-concordant"

print()
totals = {a: sum(solved(t, a) for t in tasks) for a in ARMS}
print("cell totals:", {a: f"{totals[a]}/{len(tasks)*3}" for a in ARMS})

print()
for c in ["solved-everywhere", "dead-everywhere", "discordant-majority", "partial-concordant"]:
    ts = [t for t in tasks if classes[t] == c]
    print(f"{c}: {len(ts)}")
    for t in ts:
        s = {a: solved(t, a) for a in ARMS}
        sweetmaj = sum(1 for a in ["TAB", "NONE", "PIPE"] if s[a] >= 2)
        print(f"   {t:46s} native={s['native']} TAB={s['TAB']} NONE={s['NONE']} PIPE={s['PIPE']}"
              f"  sweetFormsWithMajority={sweetmaj}/3 nativeMajority={1 if s['native']>=2 else 0}")

out = {
    "tasks": tasks,
    "arms": ARMS,
    "solved": {t: {a: solved(t, a) for a in ARMS} for t in tasks},
    "classes": classes,
    "totals": totals,
    "nullResolved": problems,
    "rowsIndex": {t: {a: {str(rep): {
        "run": r["runId"], "rep": rep, "resolved": r.get("resolved"),
        "f2pFrac": r.get("f2pFrac"), "gradeable": r.get("gradeable"),
        "resolveStatus": r.get("resolveStatus"),
        "calls": r.get("calls"), "ss": r.get("ss"), "toolCounts": r.get("toolCounts"),
        "patchHunks": r.get("patchHunks"), "patchFiles": r.get("patchFiles"),
        "stepsToFirstEdit": r.get("stepsToFirstEdit"),
        "exitReason": r.get("exitReason"), "rolloutFile": r.get("rolloutFile"),
        "idealCostUsd": r.get("idealCostUsd"),
        "noTestEvidence": r.get("noTestEvidence"),
        "rtVerdicts": r.get("rtVerdicts"), "rtNoVerdict": r.get("rtNoVerdict"),
        "rtEndedUnverified": r.get("rtEndedUnverified"),
        "codexErrors": r.get("codexErrors"),
        "goldSimilarity": r.get("goldSimilarity"),
        "finalAssistantText": (r.get("finalAssistantText") or "")[:600],
    } for rep, r in cells[t].get(a, {}).items()} for a in ARMS} for t in tasks},
}
with open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/solve-matrix.json", "w") as f:
    json.dump(out, f, indent=1)
print("\nwrote json")
