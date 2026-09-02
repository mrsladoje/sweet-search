#!/usr/bin/env python3
"""probe.py -- print the tool calls and (truncated) tool OUTPUTS of chosen requests of one rollout.

Runs on the box next to phase-anatomy.py (imports its parsers).
  python3 probe.py <harness> <task> <arm> <rep> <req_idx[,req_idx...]|all> [--max N] [--grep REGEX]
Rollout location follows phase-anatomy.py (codex rows.rolloutFile; opencode openCodeRawAttempts, with the
rp-oc-tab repair run for the 11 repair tasks; claude r<rep>- project dir)."""
import sys, os, json, re, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("pa", os.path.join(HERE, "phase-anatomy.py"))
pa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pa)

harness, task, arm, rep = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
want = sys.argv[5] if len(sys.argv) > 5 else "all"
MAX = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 700
GREP = sys.argv[sys.argv.index("--grep") + 1] if "--grep" in sys.argv else None

rows, _ = pa.load_rows(harness)
row = [r for r in rows if r["taskId"] == task and r["arm"] == arm and r["rep"] == rep][0]
run = row["_run"]
patch = pa.load_patch(run, arm, rep, task)
edited = pa.patch_files(patch) if patch else []
if harness == "codex":
    f = pa.codex_file(row)
    reqs = pa.parse_codex(f, edited)
    src = f
elif harness == "opencode":
    fl = pa.opencode_files(row)
    reqs = pa.parse_opencode(fl, edited)
    src = fl[0]
else:
    cell = pa.claude_cell(run, row)
    reqs = pa.parse_claude(cell["main"], edited)
    src = cell["main"]
print("rollout", harness, task, arm, rep, "run", run, "\n  transcript", src, "\n  edited", edited, "n_req", len(reqs))

# Re-read raw outputs (parsers keep only hits/bytes); rebuild call_id -> output text
outs = {}
if harness == "codex":
    pend = []
    for d in pa.jl(src):
        p = d.get("payload") or {}
        t = p.get("type")
        if t == "function_call":
            pend.append(p.get("call_id"))
        elif t == "function_call_output":
            o = p.get("output")
            outs[p.get("call_id")] = o if isinstance(o, str) else json.dumps(o)
    # map by order: rebuild the same call order as parse_codex
    order = [c for c in pend]
    k = 0
    for r in reqs:
        for c in r["calls"]:
            c["_out"] = outs.get(order[k], "") if k < len(order) else ""
            k += 1
elif harness == "opencode":
    k = 0
    seq = []
    for fpath in fl:
        for d in pa.jl(fpath):
            if d.get("type") == "tool_use":
                st = (d.get("part") or {}).get("state") or {}
                seq.append(pa.text_of(st.get("output")) if st.get("status") != "error" else pa.text_of(st.get("error") or st.get("output")))
    for r in reqs:
        for c in r["calls"]:
            c["_out"] = seq[k] if k < len(seq) else ""
            k += 1
else:
    res = {}
    for d in pa.jl(src):
        m = d.get("message") or {}
        if m.get("role") != "user":
            continue
        for b in (m.get("content") if isinstance(m.get("content"), list) else []):
            if b.get("type") == "tool_result":
                res[b.get("tool_use_id")] = pa.text_of(b.get("content"))
    for r in reqs:
        for c in r["calls"]:
            c["_out"] = res.get(c.get("tool_use_id"), "")

idxs = list(range(len(reqs))) if want == "all" else [int(x) for x in want.split(",")]
for i in idxs:
    r = reqs[i]
    u = r.get("usage") or {}
    print("\n=== request %d  in=%s out=%s  text=%s" % (i, u.get("in"), u.get("out"), (r.get("text") or "")[:120].replace("\n", " ")))
    for c in r["calls"]:
        o = c.get("_out", "")
        if GREP and not re.search(GREP, c["summary"] + o):
            continue
        print("  >> [%s] %s" % (c["tool"], c["summary"][:300]))
        o2 = o.replace("\\n", "\n") if harness == "codex" else o
        print("  << (%d bytes) %s" % (len(o), o2[:MAX].replace("\n", "\n     ")))
