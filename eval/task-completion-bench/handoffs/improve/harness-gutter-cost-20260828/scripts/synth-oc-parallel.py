#!/usr/bin/env python3
"""synth-oc-parallel.py — opencode: how many tool calls share one request (step)?
Tests the mechanism behind sweet's +3.4 turns: native tools are issued several per step,
shell (ss-*) calls one per step. Read-only over the 264 canonical opencode rollouts."""
import sys, json, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
import lib

agg = {}
for (task, arm, rep, row, run, runDir) in lib.rollouts():
    ev = lib.parse(lib.ndjson_path(row, runDir))
    A = agg.setdefault(arm, dict(rollouts=0, turns=0, calls=0, multiSteps=0, callsInMultiSteps=0,
                                 combos=collections.Counter(), toolsInMulti=collections.Counter(),
                                 bashInMulti=0, ssBashInMulti=0, ssCalls=0, bashCalls=0, nativeToolCalls=0,
                                 stepsWithOnlyBash=0, stepsWithOnlyNative=0))
    A["rollouts"] += 1
    step = []
    def close():
        if not step: return
        A["calls"] += len(step)
        names = [s["tool"] for s in step]
        if len(step) >= 2:
            A["multiSteps"] += 1; A["callsInMultiSteps"] += len(step)
            A["combos"][",".join(sorted(names))] += 1
            for n in names: A["toolsInMulti"][n] += 1
            for s in step:
                if s["tool"] == "bash":
                    A["bashInMulti"] += 1
                    if lib.ss_tools(s.get("cmd") or ""): A["ssBashInMulti"] += 1
        if all(n == "bash" for n in names): A["stepsWithOnlyBash"] += 1
        if all(n in ("read", "glob", "grep", "list") for n in names): A["stepsWithOnlyNative"] += 1
    for e in ev:
        if e["k"] == "tool":
            step.append(e)
            t = e["tool"]
            if t == "bash":
                A["bashCalls"] += 1
                if lib.ss_tools(e.get("cmd") or ""): A["ssCalls"] += 1
            elif t in ("read", "glob", "grep", "list"): A["nativeToolCalls"] += 1
        elif e["k"] == "turn":
            A["turns"] += 1
            close(); step = []
    close()

out = {}
for arm, A in agg.items():
    r = A["rollouts"]
    out[arm] = {
        "rollouts": r,
        "turns_per_rollout": round(A["turns"] / r, 2),
        "calls_per_rollout": round(A["calls"] / r, 2),
        "calls_per_turn": round(A["calls"] / max(1, A["turns"]), 3),
        "steps_with_2plus_calls": A["multiSteps"],
        "share_steps_with_2plus_calls": round(A["multiSteps"] / max(1, A["turns"]), 3),
        "share_calls_in_multi_steps": round(A["callsInMultiSteps"] / max(1, A["calls"]), 3),
        "bash_calls_per_rollout": round(A["bashCalls"] / r, 2),
        "ss_bash_calls_per_rollout": round(A["ssCalls"] / r, 2),
        "native_tool_calls_per_rollout": round(A["nativeToolCalls"] / r, 2),
        "bash_calls_in_multi_steps": A["bashInMulti"],
        "ss_bash_calls_in_multi_steps": A["ssBashInMulti"],
        "top_combos": A["combos"].most_common(8),
        "tools_in_multi": A["toolsInMulti"].most_common(8),
    }
print(json.dumps(out, indent=1))
