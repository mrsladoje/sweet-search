#!/usr/bin/env python3
"""E4 shared library: index every opencode rollout in the fresh pool and normalise its trace."""
import json, os, re, collections

BASE = "/root/sweet-search-private/eval/task-completion-bench/results"
FP = {"tab": "fp-opencode-tab-20260826", "none": "fp-opencode-none-20260826", "pipe": "fp-opencode-pipe-20260826"}
RP = {"tab": "rp-oc-tab-20260827", "none": "rp-oc-none-20260827", "pipe": "rp-oc-pipe-20260827"}
POOL = [l.strip() for l in open("/root/fresh-run/pool.txt") if l.strip()]
REPAIR = set(l.strip() for l in open("/root/fresh-run/repair-tasks.txt") if l.strip())
ARMS = ["native", "tab", "none", "pipe"]

def rollouts():
    """yield (task, armKey, rep, row, runId, runDir) for the 264 canonical rollouts."""
    out = []
    for form, run in FP.items():
        for r in json.load(open(os.path.join(BASE, run, "rows.json"))):
            t = r["taskId"]
            if t not in POOL: continue
            if r["arm"] == "native":
                if form != "tab": continue
                key = "native"
            else:
                key = form
                if t in REPAIR: continue
            out.append((t, key, r["rep"], r, run, os.path.join(BASE, run)))
    for form, run in RP.items():
        for r in json.load(open(os.path.join(BASE, run, "rows.json"))):
            t = r["taskId"]
            if t not in REPAIR or r["arm"] != "sweet": continue
            out.append((t, form, r["rep"], r, run, os.path.join(BASE, run)))
    return out

def ndjson_path(row, runDir):
    a = (row.get("openCodeRawAttempts") or [])
    if not a: return None
    p = a[0].get("stdout")
    if not p: return None
    # paths in rows are relative to the results root's parent ("results/<run>/...")
    return os.path.join(os.path.dirname(BASE), p) if not p.startswith("/") else p

def parse(path):
    """normalise one opencode transcript -> list of events."""
    ev = []
    if not path or not os.path.exists(path): return ev
    for line in open(path, errors="replace"):
        line = line.strip()
        if not line: continue
        try: o = json.loads(line)
        except Exception: continue
        ty = o.get("type")
        if ty == "tool_use":
            p = o.get("part", {}); st = p.get("state", {}) or {}
            inp = st.get("input") or {}
            ev.append({
                "k": "tool", "tool": p.get("tool"), "callID": p.get("callID"),
                "status": st.get("status"), "input": inp, "output": st.get("output"),
                "title": st.get("title"), "time": st.get("time") or {},
                "meta": st.get("metadata") or {},
                "cmd": inp.get("command") if isinstance(inp, dict) else None,
            })
        elif ty == "text":
            p = o.get("part", {})
            ev.append({"k": "text", "text": p.get("text") or o.get("text")})
        elif ty == "step_finish":
            p = o.get("part", {})
            ev.append({"k": "turn", "tokens": p.get("tokens")})
    return ev

SS_RE = re.compile(r"(?:^|[;&|(]\s*|\bxargs\s+)\s*(ss-(?:search|find|grep|semantic|trace|read|edit))\b")
def ss_tools(cmd):
    if not cmd: return []
    return SS_RE.findall(cmd)

NATIVE_RE = re.compile(r"(?:^|[;&|(]\s*)\s*(grep|rg|find|cat|sed|head|tail|awk|nl|ls)\b")
def native_tools(cmd):
    if not cmd: return []
    return NATIVE_RE.findall(cmd)
