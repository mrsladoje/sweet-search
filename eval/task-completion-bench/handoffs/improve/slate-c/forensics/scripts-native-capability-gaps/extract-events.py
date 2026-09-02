#!/usr/bin/env python3
"""extract-events.py -- normalise every tool call of the production-form fresh-pool runs
into one JSONL record per call (read-only on the evidence box).

  python3 extract-events.py codex|opencode|claude-code  OUT.jsonl.gz

Alignment rules reused from the 08-28 parsers (e4-codex-parse.py, e4-opencode-lib.py,
e4-claude-code-parse.mjs, /root/dump-trace.mjs):
  codex      row.rolloutFile names the transcript; function_call / function_call_output pairs;
             request index = running count of event_msg/token_count records.
  opencode   row.openCodeRawAttempts[0].stdout names the transcript; tool_use parts are
             deduped by callID keeping the LAST state; request index = step_finish count.
             Canonical 66+66: native from fp-opencode-tab; sweet from fp-opencode-tab for
             non-repair tasks and from rp-oc-tab-20260827 for the 11 repair tasks.
  claude     main transcript under claude-home/projects/-root--ss-eval-runs-r<rep>-N/;
             when a rep has two mains, pick by request count == row.idealTurns, else by
             tool-call count closest to row.calls; blocks deduped by tool_use.id /
             tool_result.tool_use_id; subagents/*.jsonl are included with side=true.
"""
import sys, os, re, json, gzip, collections

BASE = "/root/sweet-search-private/eval/task-completion-bench"
RES = os.path.join(BASE, "results")
RUNS = {
    "codex": ["fp-codex-tab-20260826"],
    "opencode": ["fp-opencode-tab-20260826", "rp-oc-tab-20260827"],
    "claude-code": ["fp-claudecode-tab-20260826"],
}
REPAIR = set(l.strip() for l in open("/root/fresh-run/repair-tasks.txt") if l.strip())
POOL = set(l.strip() for l in open("/root/fresh-run/pool.txt") if l.strip())

def jl(path):
    with open(path, errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except Exception:
                continue

def text_of(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join((x.get("text") or "") if isinstance(x, dict) else str(x) for x in c)
    if c is None:
        return ""
    return json.dumps(c)

def row_head(h, run, r, canon):
    return {"h": h, "run": run, "task": r["taskId"], "arm": r["arm"], "rep": r["rep"],
            "canon": canon, "resolved": r.get("resolved"), "cost": r.get("costRealizedUsd"),
            "reqs": r.get("idealTurns"), "rowCalls": r.get("calls"),
            "rowNativeGrep": r.get("nativeGrep"), "rowToolCounts": r.get("toolCounts")}

# ------------------------------------------------------------------ codex
def codex(run, r, canon):
    f = r.get("rolloutFile")
    if not f or not os.path.exists(f):
        return None, "missing rolloutFile"
    head = row_head("codex", run, r, canon)
    calls = {}
    order = []
    req = 0
    for o in jl(f):
        p = o.get("payload") or {}
        t = p.get("type")
        if o.get("type") == "event_msg" and t == "token_count":
            req += 1
            continue
        if t == "function_call":
            try:
                args = json.loads(p.get("arguments") or "{}")
            except Exception:
                args = {"_raw": p.get("arguments")}
            cid = p.get("call_id")
            rec = dict(head)
            rec.update({"i": len(order), "req": req, "side": False, "tool": p.get("name"), "in": args,
                        "out": "", "err": None, "exit": None, "meta": {}})
            if p.get("name") == "exec_command":
                cmd = args.get("cmd")
                rec["cmd"] = " ".join(str(c) for c in cmd) if isinstance(cmd, list) else (cmd if isinstance(cmd, str) else json.dumps(cmd))
            calls[cid] = rec
            order.append(cid)
        elif t == "function_call_output":
            cid = p.get("call_id")
            out = p.get("output")
            s = out if isinstance(out, str) else text_of(out)
            m = re.match(r"^Chunk ID: \S+\nWall time: ([\d.]+) seconds\nProcess exited with code (-?\d+)\n(?:Original token count: (\d+)\n)?(?:Output:\n)?", s)
            if cid in calls:
                calls[cid]["out"] = s
                if m:
                    calls[cid]["exit"] = int(m.group(2))
                    calls[cid]["meta"] = {"wall": float(m.group(1)), "origTok": int(m.group(3)) if m.group(3) else None,
                                          "truncated": "Warning: truncated output" in s[:600]}
    recs = [calls[c] for c in order if c in calls]
    return recs, None

# ------------------------------------------------------------------ opencode
def opencode(run, r, canon):
    a = r.get("openCodeRawAttempts") or []
    p = a[0].get("stdout") if a else None
    if not p:
        return None, "no openCodeRawAttempts"
    p = os.path.join(BASE, p) if not p.startswith("/") else p
    if not os.path.exists(p):
        return None, "missing transcript " + p
    head = row_head("opencode", run, r, canon)
    parts = {}
    order = []
    req = 0
    first_req = {}
    for o in jl(p):
        ty = o.get("type")
        if ty == "step_finish":
            req += 1
            continue
        if ty != "tool_use":
            continue
        part = o.get("part") or {}
        st = part.get("state") or {}
        cid = part.get("callID") or part.get("id")
        if cid not in parts:
            order.append(cid)
            first_req[cid] = req
        inp = st.get("input") or {}
        meta = st.get("metadata") or {}
        rec = dict(head)
        rec.update({"i": None, "req": first_req[cid], "side": False, "tool": part.get("tool"), "in": inp,
                    "out": text_of(st.get("output")) if st.get("status") != "error" else text_of(st.get("error") or st.get("output")),
                    "err": st.get("status") == "error", "exit": meta.get("exit"),
                    "meta": {k: meta.get(k) for k in ("exit", "truncated", "count", "matches") if k in meta},
                    "status": st.get("status")})
        if part.get("tool") == "bash" and isinstance(inp, dict):
            rec["cmd"] = inp.get("command") or ""
        parts[cid] = rec  # keep LAST state
    recs = []
    for k, cid in enumerate(order):
        rec = parts[cid]
        rec["i"] = k
        recs.append(rec)
    return recs, None

# ------------------------------------------------------------------ claude-code
def parse_claude_file(path, head, side, i0):
    seen = set()
    req_ids = []
    req_index = {}
    calls = {}
    order = []
    for d in jl(path):
        m = d.get("message")
        if not m:
            continue
        rid = m.get("id") or d.get("requestId")
        blocks = m.get("content") if isinstance(m.get("content"), list) else []
        if m.get("role") == "assistant" and rid and rid not in req_index:
            req_index[rid] = len(req_ids)
            req_ids.append(rid)
        for b in blocks:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use":
                if b["id"] in seen:
                    continue
                seen.add(b["id"])
                rec = dict(head)
                rec.update({"i": i0 + len(order), "req": req_index.get(rid), "side": side, "tool": b.get("name"),
                            "in": b.get("input") or {}, "out": "", "err": False, "exit": None, "meta": {}})
                if b.get("name") == "Bash":
                    rec["cmd"] = (b.get("input") or {}).get("command") or ""
                calls[b["id"]] = rec
                order.append(b["id"])
            elif b.get("type") == "tool_result":
                key = "tr:" + str(b.get("tool_use_id"))
                if key in seen:
                    continue
                seen.add(key)
                cid = b.get("tool_use_id")
                if cid in calls:
                    calls[cid]["out"] = text_of(b.get("content"))
                    calls[cid]["err"] = bool(b.get("is_error"))
    return [calls[c] for c in order], len(req_ids)

def claude(run, r, canon):
    cell = os.path.join(RES, run, "agent-state", f"{r['taskId']}-{r['arm']}")
    mains = []
    for root, dirs, files in os.walk(os.path.join(cell, "claude-home", "projects")):
        for f in files:
            p = os.path.join(root, f)
            if f.endswith(".jsonl") and "/subagents/" not in p and re.search(rf"-root--ss-eval-runs-r{r['rep']}-\d+/", p):
                mains.append(p)
    if not mains:
        return None, "no main transcript"
    head = row_head("claude-code", run, r, canon)
    cands = []
    for p in mains:
        recs, nreq = parse_claude_file(p, head, False, 0)
        cands.append((p, recs, nreq))
    if len(cands) > 1:
        want = r.get("idealTurns")
        if want is not None:
            cands.sort(key=lambda c: abs(c[2] - want))
        else:
            cands.sort(key=lambda c: abs(len(c[1]) - (r.get("calls") or 0)))
    p, recs, nreq = cands[0]
    note = None if len(cands) == 1 else f"picked {os.path.basename(p)} of {len(cands)} (reqs={nreq}, idealTurns={r.get('idealTurns')})"
    sid = os.path.basename(p)[:-6]
    subdir = os.path.join(os.path.dirname(p), sid, "subagents")
    if os.path.isdir(subdir):
        for f in sorted(os.listdir(subdir)):
            if f.endswith(".jsonl"):
                srecs, _ = parse_claude_file(os.path.join(subdir, f), head, True, len(recs))
                for s in srecs:
                    s["subfile"] = f
                recs.extend(srecs)
    for rec in recs:
        rec["transcript"] = p.replace(RES + "/", "")
    return recs, note

def main():
    h, outp = sys.argv[1], sys.argv[2]
    fn = {"codex": codex, "opencode": opencode, "claude-code": claude}[h]
    n_rows = n_ok = 0
    notes = []
    sanity = []
    with gzip.open(outp, "wt", encoding="utf8") as fo:
        for run in RUNS[h]:
            rows = json.load(open(os.path.join(RES, run, "rows.json")))
            for r in rows:
                if r["taskId"] not in POOL:
                    continue
                if h == "opencode":
                    if run.startswith("rp-"):
                        canon = r["arm"] == "sweet" and r["taskId"] in REPAIR
                    else:
                        canon = r["arm"] == "native" or r["taskId"] not in REPAIR
                else:
                    canon = True
                n_rows += 1
                recs, note = fn(run, r, canon)
                if note:
                    notes.append(f"{run} {r['taskId']} {r['arm']} rep{r['rep']}: {note}")
                if recs is None:
                    continue
                n_ok += 1
                main_calls = sum(1 for x in recs if not x.get("side"))
                sanity.append((run, r["taskId"], r["arm"], r["rep"], r.get("calls"), main_calls, canon))
                for rec in recs:
                    fo.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"{h}: rows {n_rows} parsed {n_ok}")
    for n in notes:
        print("  NOTE", n)
    bad = [s for s in sanity if s[4] is not None and abs(s[4] - s[5]) > max(3, 0.15 * s[4])]
    print(f"  rollouts where main tool-call count differs from rows.calls by >15%: {len(bad)} of {len(sanity)}")
    for s in bad[:12]:
        print("   ", s)
    canon_n = collections.Counter((s[2], s[6]) for s in sanity)
    print("  canonical rows:", dict(canon_n))

if __name__ == "__main__":
    main()
