#!/usr/bin/env python3
"""synth-oc-wasted.py — price the step that follows a wasted ss-* call on opencode.
Wasted = crash (engine banner + stack trace), usage rejection, ss-read ENOENT, empty body with
status=error, scoped (no matches) on a path already read via ss-read. The step after the call
ingests its result; that step's ideal price is charged to the call. Read-only, 198 sweet rollouts."""
import sys, json, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
import lib

PR = dict(inp=0.10, cache=0.01, out=0.60)
def price(tok):
    if not tok: return 0.0
    c = tok.get("cache") or {}
    new = (tok.get("input") or 0) + (c.get("write") or 0)
    return (new * PR["inp"] + (c.get("read") or 0) * PR["cache"] + ((tok.get("output") or 0) + (tok.get("reasoning") or 0)) * PR["out"]) / 1e6

CRASH = re.compile(r"\[ss-\*\] crash:")
USAGE = re.compile(r"(\[ss\] unrecognised option|\[ss\] \d+ argument\(s\) not consumed|^Usage: ss-|command not found)", re.M)
ENOENT = re.compile(r"\[ss-read\] error: stat failed: ENOENT")
NOMATCH = re.compile(r"^\(no matches\)$", re.M)
SSREAD = re.compile(r"ss-read\s+(?:--force\s+)?([^\s;&|'\"`-][^\s;&|'\"`]*)")
SCOPE = re.compile(r"--in\s+([^\s;&|'\"`]+)")

out = {}
for (task, arm, rep, row, run, runDir) in lib.rollouts():
    if arm == "native": continue
    ev = lib.parse(lib.ndjson_path(row, runDir))
    S = out.setdefault(arm, dict(rollouts=0, steps=0, cellUsd=0.0, wasted=collections.Counter(), wastedUsd=collections.Counter(), rolloutsWithWaste=0))
    S["rollouts"] += 1
    # assign each tool event the index of the step that closes after it; steps carry tokens
    steps = []; cur = []
    for e in ev:
        if e["k"] == "tool": cur.append(e)
        elif e["k"] == "turn": steps.append((cur, e.get("tokens"))); cur = []
    if cur: steps.append((cur, None))
    S["steps"] += len(steps)
    S["cellUsd"] += sum(price(t) for _, t in steps)
    readSoFar = set(); any_ = False
    for i, (tools, tok) in enumerate(steps):
        for e in tools:
            if e["tool"] != "bash": continue
            cmd = e.get("cmd") or ""; res = (e.get("output") or "") + "\n" + str((e.get("meta") or {}).get("error") or "")
            st = e.get("status")
            cls = None
            if CRASH.search(res): cls = "crash"
            elif USAGE.search(res): cls = "usage"
            elif ENOENT.search(res): cls = "enoent"
            elif lib.ss_tools(cmd) and st == "error" and not (e.get("output") or "").strip(): cls = "emptyBody"
            elif NOMATCH.search(res):
                sc = SCOPE.search(cmd)
                if sc and any(p == sc.group(1) or p.endswith("/" + sc.group(1)) or sc.group(1).endswith("/" + p) for p in readSoFar): cls = "scopedNoMatch"
            for p in SSREAD.findall(cmd):
                if not ENOENT.search(res): readSoFar.add(p)
            if not cls: continue
            any_ = True; S["wasted"][cls] += 1
            nxt = steps[i + 1][1] if i + 1 < len(steps) else None
            S["wastedUsd"][cls] += price(nxt)
    if any_: S["rolloutsWithWaste"] += 1

for arm, S in out.items():
    r = S["rollouts"]; w = sum(S["wastedUsd"].values())
    S["meanStepUsd"] = round(S["cellUsd"] / max(1, S["steps"]), 6)
    S["cellUsdPerRollout"] = round(S["cellUsd"] / r, 6)
    S["wastedCallsPerRollout"] = round(sum(S["wasted"].values()) / r, 2)
    S["wastedUsdPerRollout"] = round(w / r, 6)
    S["wastedShareOfCell"] = round(w / max(1e-9, S["cellUsd"]), 4)
    S["wasted"] = dict(S["wasted"]); S["wastedUsd"] = {k: round(v, 5) for k, v in S["wastedUsd"].items()}
    S["cellUsd"] = round(S["cellUsd"], 5)
print(json.dumps(out, indent=1))
