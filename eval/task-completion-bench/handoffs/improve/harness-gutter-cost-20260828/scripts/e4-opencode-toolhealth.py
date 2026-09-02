#!/usr/bin/env python3
"""E4 item 3 - ss-* tool-health scan over all 198 opencode sweet rollouts."""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse, ss_tools

SS = ["ss-search", "ss-find", "ss-grep", "ss-semantic", "ss-trace", "ss-read", "ss-edit"]
calls = collections.Counter()
nonzero = collections.Counter()
empty = collections.Counter()
trunc = collections.Counter()
latms = collections.defaultdict(list)
examples = collections.defaultdict(list)
rollouts_with = collections.defaultdict(set)
apply_stat = collections.Counter()
apply_fail_ex = []
bash_nonzero_head = collections.Counter()
per_rollout_ss = {}
outputs_index = []          # for fallback detection

EMPTY_PATTERNS = [
    (re.compile(r"results=0\b"), "results=0"),
    (re.compile(r"^\s*(no matches|no results|No matches found|No results)", re.I | re.M), "no-match-line"),
    (re.compile(r"\bmatches=0\b"), "matches=0"),
    (re.compile(r"\bhits=0\b"), "hits=0"),
]

def empty_kind(tool, out, exitc):
    o = out or ""
    if o.strip() == "": return "blank-output"
    for rx, name in EMPTY_PATTERNS:
        if rx.search(o): return name
    return None

for t, arm, rep, row, run, rd in rollouts():
    if arm == "native": continue
    ev = parse(ndjson_path(row, rd))
    key = (t, arm, rep)
    seen = collections.Counter()
    prev_ss = None   # last ss-* call: (tool, cmd, output, idx)
    seq = []
    for i, e in enumerate(ev):
        if e["k"] != "tool": continue
        if e["tool"] != "bash":
            seq.append({"i": i, "tool": e["tool"], "cmd": None, "out": e.get("output") or "",
                        "exit": None, "status": e["status"], "input": e.get("input")})
            continue
        cmd = e.get("cmd") or ""
        m = e.get("meta") or {}
        exitc = m.get("exit")
        tools = ss_tools(cmd)
        out = e.get("output") or ""
        tm = e.get("time") or {}
        dur = (tm.get("end", 0) - tm.get("start", 0)) if tm.get("end") and tm.get("start") else None
        seq.append({"i": i, "tool": "bash", "cmd": cmd, "out": out, "exit": exitc,
                    "status": e["status"], "sstools": tools, "dur": dur, "trunc": m.get("truncated")})
        if tools:
            for tool in set(tools):
                calls[tool] += 1
                seen[tool] += 1
                rollouts_with[tool].add(key)
                if dur is not None: latms[tool].append(dur)
                if str(exitc) not in ("0", "None"):
                    nonzero[tool] += 1
                    if len(examples["nonzero:" + tool]) < 6:
                        examples["nonzero:" + tool].append({"task": t, "arm": arm, "rep": rep, "cmd": cmd[:300],
                                                            "exit": exitc, "out": out[:400]})
                ek = empty_kind(tool, out, exitc)
                if ek:
                    empty[tool + "/" + ek] += 1
                    if len(examples["empty:" + tool]) < 8:
                        examples["empty:" + tool].append({"task": t, "arm": arm, "rep": rep, "cmd": cmd[:300],
                                                          "kind": ek, "exit": exitc, "out": out[:500]})
                if m.get("truncated"): trunc[tool] += 1
        else:
            if str(exitc) not in ("0", "None"):
                head = cmd.strip().split()[0] if cmd.strip() else "?"
                bash_nonzero_head[head] += 1
    for e in ev:
        if e["k"] == "tool" and e["tool"] == "apply_patch":
            apply_stat[e["status"]] += 1
            o = e.get("output") or ""
            if e["status"] != "completed" or "failed" in o.lower() or "error" in o.lower():
                apply_stat["FAILISH"] += 1
                if len(apply_fail_ex) < 40:
                    apply_fail_ex.append({"task": t, "arm": arm, "rep": rep, "status": e["status"],
                                          "out": o[:400]})
    per_rollout_ss[str(key)] = dict(seen)
    outputs_index.append({"key": key, "seq": seq})

res = {
    "calls": dict(calls), "nonzero": dict(nonzero), "empty": dict(empty), "trunc": dict(trunc),
    "rolloutsWith": {k: len(v) for k, v in rollouts_with.items()},
    "latencyMs": {k: {"n": len(v), "p50": sorted(v)[len(v)//2] if v else None,
                      "p90": sorted(v)[int(len(v)*0.9)] if v else None, "max": max(v) if v else None,
                      "mean": round(sum(v)/len(v), 1) if v else None} for k, v in latms.items()},
    "applyPatch": dict(apply_stat),
    "bashNonZeroNonSs": dict(bash_nonzero_head),
    "examples": {k: v for k, v in examples.items()},
    "applyFailExamples": apply_fail_ex,
}
json.dump(res, open("/tmp/fp-inv/e4-opencode/toolhealth.json", "w"), indent=1)
json.dump(outputs_index, open("/tmp/fp-inv/e4-opencode/seq.json", "w"))
print(json.dumps({k: res[k] for k in ["calls", "nonzero", "empty", "trunc", "rolloutsWith", "latencyMs", "applyPatch", "bashNonZeroNonSs"]}, indent=1))
