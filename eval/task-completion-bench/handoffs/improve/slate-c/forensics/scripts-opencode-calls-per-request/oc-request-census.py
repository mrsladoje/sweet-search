#!/usr/bin/env python3
"""oc-request-census.py -- classify every opencode REQUEST (one assistant message = one LLM call)
by the tool calls it carries. Fresh-pool opencode cells, canonical 66 + 66 rollouts
(same selection as the 08-28 e4-opencode-lib):
  native    = fp-opencode-tab-20260826 arm=native (22 tasks x 3 reps)
  sweet TAB = fp-opencode-tab-20260826 arm=sweet for the 11 non-repair tasks
            + rp-oc-tab-20260827 arm=sweet for the 11 repair tasks
Transcript per row = rows.json openCodeRawAttempts[-1].stdout (the graded attempt).
Requests are grouped by part.messageID (every step_start in these files has a distinct
messageID; tool parts carry the same messageID); tokens come from the step_finish part
with the same messageID. READ-ONLY on results/. Writes to OUT_DIR.
Usage: python3 oc-request-census.py [OUT_DIR]
"""
import json, os, re, sys, collections, math

BASE = "/root/sweet-search-private/eval/task-completion-bench/results"
BENCH = os.path.dirname(BASE)
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/wf-slatec/opencode-calls-per-request"
os.makedirs(OUT, exist_ok=True)
POOL = [l.strip() for l in open("/root/fresh-run/pool.txt") if l.strip()]
REPAIR = set(l.strip() for l in open("/root/fresh-run/repair-tasks.txt") if l.strip())
PRICE = {"in": 0.10, "cache": 0.01, "out": 0.60}  # registered luna price, $/M
RUNDIR_RE = re.compile(r"^/root/\.ss-eval/runs/[^/]+/")

def rollouts():
    out = []
    for r in json.load(open(os.path.join(BASE, "fp-opencode-tab-20260826", "rows.json"))):
        t = r["taskId"]
        if t not in POOL: continue
        if r["arm"] == "native": out.append((t, "native", r["rep"], r, "fp-opencode-tab-20260826"))
        elif t not in REPAIR: out.append((t, "sweet", r["rep"], r, "fp-opencode-tab-20260826"))
    for r in json.load(open(os.path.join(BASE, "rp-oc-tab-20260827", "rows.json"))):
        t = r["taskId"]
        if t in REPAIR and r["arm"] == "sweet": out.append((t, "sweet", r["rep"], r, "rp-oc-tab-20260827"))
    return out

def transcript(row):
    att = [a.get("stdout") for a in (row.get("openCodeRawAttempts") or []) if a.get("stdout")]
    if not att: return None, 0
    p = att[-1]
    return (p if p.startswith("/") else os.path.join(BENCH, p)), len(att)

SS_NAMES = ("read", "search", "grep", "find", "semantic", "trace", "batch", "files", "edit")
SS_OP = re.compile(r"(?:^|\s|\()(?:\S*/)?ss-(read|search|grep|find|semantic|trace|batch|files|edit)\b")
QUOTE_RE = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"")
HEREDOC_RE = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?")
TEST_RE = re.compile(r"\brun_tests\b|\bpytest\b|\bnpm (?:run )?test\b|\byarn test\b|\bgo test\b|\bdotnet test\b|\bmix test\b|\bcargo test\b|\bmvn\b.*\btest\b|\bgradle\w*\b.*\btest\b|\bphpunit\b|\brspec\b|\bjest\b|\bvitest\b|\bmocha\b|\btox\b")
READ_BASH = re.compile(r"^(?:cat|head|tail|nl|less|more|wc)\b|^sed\s+-n\b|^awk\b")
SEARCH_BASH = re.compile(r"^(?:rg|grep|egrep|fgrep|find|fd|ls|tree|git\s+(?:grep|log|show|status|diff|ls-files|blame))\b")
EDIT_BASH = re.compile(r"^sed\s+-i\b|^perl\s+-p?i\b|^apply_patch\b|^python3?\s+-\s*<<|^python3?\s+-c\b.*(?:write|open\(|replace)|^cat\s*>|^tee\b|^printf\b.*>|^echo\b.*>>?|^patch\b|^git\s+apply\b|^mv\b|^cp\b|^rm\b|^touch\b|^mkdir\b")
NOISE_RE = re.compile(r"^(?:cd|export|set|source|true|echo|pwd|which|type|command|env|timeout|time|chmod|sleep)\b")

def strip_heredoc(cmd):
    """drop a heredoc BODY so its lines are not counted as shell operations"""
    m = HEREDOC_RE.search(cmd)
    if not m: return cmd
    nl = cmd.find("\n", m.end())
    if nl < 0: return cmd
    head, rest, term = cmd[:nl], cmd[nl:], m.group(1)
    tm = re.search(r"\n" + re.escape(term) + r"\s*(?:\n|$)", rest)
    return head + ("\n" + rest[tm.end():] if tm else "")

def segments(cmd, split_pipes=False, respect_quotes=True):
    """split one shell command into operations. Default: && || ; newline (a pipeline is ONE op), quotes masked,
    heredoc bodies dropped. split_pipes=True adds | (08-28 p3 definition); respect_quotes=False = the naive 08-28 split."""
    cmd = strip_heredoc(cmd) if respect_quotes else cmd
    masked = QUOTE_RE.sub(lambda mm: "Q" * len(mm.group(0)), cmd) if respect_quotes else cmd
    pat = r"&&|\|\||;|\n" + (r"|\|" if split_pipes else "")
    segs, pos = [], 0
    for mm in re.finditer(pat, masked):
        segs.append((cmd[pos:mm.start()], masked[pos:mm.start()])); pos = mm.end()
    segs.append((cmd[pos:], masked[pos:]))
    return [(a.strip(), b.strip()) for a, b in segs if a.strip()]

def classify_bash(cmd):
    """return dict(ops, ops_p3, ops_raw, kinds, ss_ops, chained, joiners, is_test) for one bash command"""
    cmd = (cmd or "").strip()
    if not cmd: return dict(ops=0, ops_p3=0, ops_raw=0, kinds=[], ss_ops=[], chained=False, joiners=[], is_test=False)
    segs = segments(cmd)
    ss_ops, kinds = [], []
    is_test = bool(TEST_RE.search(cmd))
    for raw, masked in segs:
        m = SS_OP.search(" " + masked)
        if m:
            name = m.group(1); ss_ops.append(name)
            kinds.append("R" if name == "read" else ("E" if name == "edit" else "S"))
        elif TEST_RE.search(masked): kinds.append("T")
        elif EDIT_BASH.search(masked): kinds.append("E")
        elif READ_BASH.search(masked): kinds.append("R")
        elif SEARCH_BASH.search(masked): kinds.append("S")
        elif NOISE_RE.search(masked): kinds.append("N")
        else: kinds.append("O")
    # chain = two or more ss-* ops inside ONE bash call; which joiners sit between them
    joiners = []
    if len(ss_ops) >= 2:
        masked_all = strip_heredoc(cmd); masked_all = QUOTE_RE.sub(lambda mm: "Q" * len(mm.group(0)), masked_all)
        idx = [mm.start() for mm in re.finditer(r"(?:^|\s|\()(?:\S*/)?ss-(?:read|search|grep|find|semantic|trace|batch|files|edit)\b", masked_all)]
        for a, b in zip(idx, idx[1:]):
            between = masked_all[a:b]
            joiners.append("&&" if "&&" in between else (";" if ";" in between else ("\\n" if "\n" in between else ("|" if "|" in between else "?"))))
    ops = len([k for k in kinds if k != "N"]) or 1
    return dict(ops=ops, ops_p3=len(segments(cmd, split_pipes=True)), ops_raw=len(segments(cmd, split_pipes=True, respect_quotes=False)),
                kinds=kinds, ss_ops=ss_ops, chained=len(ss_ops) >= 2, joiners=joiners, is_test=is_test)

STRUCT_READ = {"read", "grep", "glob", "list"}
STRUCT_EDIT = {"edit", "apply_patch", "write", "patch", "multiedit"}
TODO = {"todowrite", "todoread"}

def ss_read_path(cmd):
    """repo-relative path of a single-op `ss-read <path> ...` command, else None"""
    m = re.search(r"(?:^|\s)(?:\S*/)?ss-read\s+(?:--\S+\s+)*([^\s\"']+|\"[^\"]+\"|'[^']+')", cmd or "")
    if not m: return None
    p = m.group(1).strip("\"'")
    p = re.sub(r":\d+(?:[-:,]\d+)?$", "", p)
    p = RUNDIR_RE.sub("", p)
    return p.lstrip("./") or None

def parse(path):
    """-> list of requests in order: dict(msg, tools, calls, tokens, reason, ...)"""
    reqs = collections.OrderedDict()
    for line in open(path, errors="replace"):
        line = line.strip()
        if not line: continue
        try: o = json.loads(line)
        except Exception: continue
        ty = o.get("type"); p = o.get("part") or {}
        mid = p.get("messageID") or "?"
        r = reqs.setdefault(mid, {"msg": mid, "calls": [], "text": 0, "tokens": None, "reason": None, "t0": o.get("timestamp")})
        if ty == "tool_use":
            st = p.get("state") or {}
            r["calls"].append({"tool": p.get("tool"), "callID": p.get("callID"), "input": st.get("input") or {},
                               "status": st.get("status"), "time": st.get("time") or {},
                               "out_len": len(st.get("output") or "") if isinstance(st.get("output"), str) else 0})
        elif ty == "text": r["text"] += 1
        elif ty == "step_finish":
            r["tokens"] = p.get("tokens"); r["reason"] = p.get("reason"); r["oc_cost"] = p.get("cost")
    return list(reqs.values())

def cost_of(tok):
    if not tok: return 0.0
    c = tok.get("cache") or {}
    return (tok.get("input", 0) + c.get("write", 0)) * PRICE["in"] / 1e6 + c.get("read", 0) * PRICE["cache"] / 1e6 \
        + (tok.get("output", 0) + tok.get("reasoning", 0)) * PRICE["out"] / 1e6

def classify_request(r):
    names = [c["tool"] for c in r["calls"]]
    n = len(names)
    n_sr = sum(1 for t in names if t in STRUCT_READ)
    n_se = sum(1 for t in names if t in STRUCT_EDIT)
    n_bash = sum(1 for t in names if t == "bash")
    n_todo = sum(1 for t in names if t in TODO)
    n_other = n - n_sr - n_se - n_bash - n_todo
    ops = 0; ops_p3 = 0; ops_raw = 0; kinds = []; ss_ops = []; ss_env = 0; chained = 0; is_test = False; bash_cmds = []; paths = []; joiners = []
    for c in r["calls"]:
        t = c["tool"]; inp = c["input"] if isinstance(c["input"], dict) else {}
        if t == "bash":
            cmd = str(inp.get("command") or ""); bash_cmds.append(cmd)
            cb = classify_bash(cmd)
            o, k, s, ch, te = cb["ops"], cb["kinds"], cb["ss_ops"], cb["chained"], cb["is_test"]
            ops += o; ops_p3 += cb["ops_p3"]; ops_raw += cb["ops_raw"]; kinds += k; ss_ops += s; is_test = is_test or te
            joiners += cb["joiners"]
            if s: ss_env += 1
            if ch: chained += 1
            if len(s) == 1 and s[0] == "read":
                pth = ss_read_path(cmd)
                if pth: paths.append(pth)
        elif t == "read":
            ops += 1; ops_p3 += 1; ops_raw += 1; kinds.append("R")
            fp = str(inp.get("filePath") or ""); paths.append(RUNDIR_RE.sub("", fp).lstrip("./"))
        elif t in ("grep", "glob", "list"): ops += 1; ops_p3 += 1; ops_raw += 1; kinds.append("S")
        elif t in STRUCT_EDIT: ops += 1; ops_p3 += 1; ops_raw += 1; kinds.append("E")
        elif t in TODO: ops += 1; ops_p3 += 1; ops_raw += 1; kinds.append("N")
        else: ops += 1; ops_p3 += 1; ops_raw += 1; kinds.append("O")
    ks = set(k for k in kinds if k != "N")
    if n == 0: kind = "X"
    elif not ks: kind = "N"
    elif "T" in ks: kind = "T"
    elif "E" in ks: kind = "E"
    elif ks == {"R"}: kind = "R"
    elif ks == {"S"}: kind = "S"
    elif ks <= {"R", "S"}: kind = "RS"
    else: kind = "O"
    # request class by tool family
    if n == 0: cls = "text-only"
    elif n_todo == n: cls = "todo-only"
    elif n_bash == 0 and (n_sr + n_se) == n - n_todo: cls = "struct-only"
    elif n_bash == n - n_todo: cls = "bash-ss" if ss_env else "bash-other"
    else: cls = "mixed"
    tok = r["tokens"] or {}
    cache = tok.get("cache") or {}
    return {"msg": r["msg"], "n": n, "tools": names, "n_struct_read": n_sr, "n_struct_edit": n_se, "n_bash": n_bash,
            "n_todo": n_todo, "n_other": n_other, "ops": ops, "ops_p3": ops_p3, "ops_raw": ops_raw, "joiners": joiners, "ss_ops": ss_ops, "ss_env": ss_env, "ss_chained_envelopes": chained,
            "is_test": is_test, "kind": kind, "cls": cls, "paths": paths, "bash_cmds": bash_cmds,
            "tok_in": tok.get("input", 0), "tok_cache_read": cache.get("read", 0), "tok_cache_write": cache.get("write", 0),
            "tok_out": tok.get("output", 0), "tok_reasoning": tok.get("reasoning", 0), "cost": cost_of(tok), "reason": r["reason"]}

def main():
    rolls = rollouts()
    per_roll = []
    for (task, arm, rep, row, run) in rolls:
        path, natt = transcript(row)
        if not path or not os.path.exists(path):
            print("MISSING", run, task, arm, rep, path); continue
        reqs = [classify_request(r) for r in parse(path)]
        cost = sum(q["cost"] for q in reqs)
        per_roll.append({"run": run, "task": task, "arm": arm, "rep": rep, "attempts": natt,
                         "session": os.path.basename(os.path.dirname(path)), "path": path.replace(BASE + "/", ""),
                         "resolved": row.get("resolved"), "row_cost": row.get("costRealizedUsd"), "replay_cost": cost,
                         "row_calls": row.get("calls"), "n_req": len(reqs), "reqs": reqs})
    json.dump(per_roll, open(os.path.join(OUT, "requests.json"), "w"))
    # ---- verification: replayed cost vs row cost
    dev = [(abs(x["replay_cost"] - (x["row_cost"] or 0)) / max(1e-9, (x["row_cost"] or 0)), x) for x in per_roll]
    dev.sort(key=lambda d: -d[0])
    print("rollouts:", collections.Counter(x["arm"] for x in per_roll), " attempts>1:", sum(1 for x in per_roll if x["attempts"] > 1))
    print("cost replay vs row: max rel dev %.4f (%s %s r%d replay=%.6f row=%.6f); median %.4f" % (
        dev[0][0], dev[0][1]["task"], dev[0][1]["arm"], dev[0][1]["rep"], dev[0][1]["replay_cost"], dev[0][1]["row_cost"] or 0, dev[len(dev)//2][0]))
    # ---- per-arm aggregates
    agg = {}
    for x in per_roll:
        A = agg.setdefault(x["arm"], collections.defaultdict(float))
        A["rollouts"] += 1; A["requests"] += x["n_req"]; A["cost"] += x["replay_cost"]
        for q in x["reqs"]:
            A["calls"] += q["n"]; A["ops"] += q["ops"]; A["ops_p3"] += q["ops_p3"]; A["ops_raw"] += q["ops_raw"]
            for j in q["joiners"]: A["join_" + j] += 1
            if q["n"] > 0: A["tool_req"] += 1
            if q["n"] >= 2: A["multi_req"] += 1; A["calls_in_multi"] += q["n"]
            A["cls_" + q["cls"]] += 1; A["cls_" + q["cls"] + "_calls"] += q["n"]; A["cls_" + q["cls"] + "_ops"] += q["ops"]
            A["cls_" + q["cls"] + "_cost"] += q["cost"]; A["cls_" + q["cls"] + "_cache_read"] += q["tok_cache_read"]
            A["cls_" + q["cls"] + "_out"] += q["tok_out"] + q["tok_reasoning"]
            if q["n"] >= 2: A["cls_" + q["cls"] + "_multi"] += 1
            A["kind_" + q["kind"]] += 1; A["kind_" + q["kind"] + "_ops"] += q["ops"]; A["kind_" + q["kind"] + "_calls"] += q["n"]
            A["bash_calls"] += q["n_bash"]; A["struct_read_calls"] += q["n_struct_read"]; A["struct_edit_calls"] += q["n_struct_edit"]
            A["ss_envelopes"] += q["ss_env"]; A["ss_ops"] += len(q["ss_ops"]); A["ss_chained_envelopes"] += q["ss_chained_envelopes"]
            if q["ss_env"]: A["ss_req"] += 1
            if q["ss_env"] >= 2: A["ss_req_parallel_bash"] += 1  # two or more ss-bearing bash envelopes in ONE request
            if q["ss_chained_envelopes"]: A["ss_req_chained"] += 1
            if q["n_struct_read"]:
                A["sr_req"] += 1
                if q["n_struct_read"] >= 2: A["sr_req_multi"] += 1
                A["sr_req_calls"] += q["n_struct_read"]
            if q["n_bash"]:
                A["bash_req"] += 1
                if q["n_bash"] >= 2: A["bash_req_multi"] += 1
            for s in q["ss_ops"]: A["ssop_" + s] += 1
    lines = []
    def P(s=""): lines.append(s); print(s)
    for arm in ("native", "sweet"):
        A = agg[arm]; n = A["rollouts"]
        P("\n=== %s: %d rollouts ===" % (arm, n))
        P(" requests/rollout %.2f | tool-bearing requests/rollout %.2f | calls/rollout %.2f | ops/rollout %.2f | cost/rollout $%.6f" % (
            A["requests"] / n, A["tool_req"] / n, A["calls"] / n, A["ops"] / n, A["cost"] / n))
        P(" calls/request (all) %.3f | calls/tool-bearing request %.3f | ops/request (all) %.3f | ops/tool-bearing request %.3f" % (
            A["calls"] / A["requests"], A["calls"] / A["tool_req"], A["ops"] / A["requests"], A["ops"] / A["tool_req"]))
        P(" ops/rollout under three definitions: pipeline=1 op, quotes masked %.2f | pipes split, quotes masked (08-28 p3 intent) %.2f | naive split incl. inside quotes (08-28 p3 as run) %.2f" % (
            A["ops"] / n, A["ops_p3"] / n, A["ops_raw"] / n))
        P(" joiners between chained ss ops: " + ", ".join("%s=%d" % (k[5:], v) for k, v in sorted(A.items()) if k.startswith("join_")))
        P(" multi-call requests %d (%.1f%% of all, %.1f%% of tool-bearing); calls in them %.1f%%" % (
            A["multi_req"], 100 * A["multi_req"] / A["requests"], 100 * A["multi_req"] / A["tool_req"], 100 * A["calls_in_multi"] / A["calls"]))
        P(" bash calls/rollout %.2f | structured read-like calls/rollout %.2f | structured edit calls/rollout %.2f" % (
            A["bash_calls"] / n, A["struct_read_calls"] / n, A["struct_edit_calls"] / n))
        P(" ss envelopes/rollout %.2f | ss ops/rollout %.2f | ss-bearing requests/rollout %.2f | chained (>=2 ss ops in one bash) envelopes %d/%d (%.1f%%)" % (
            A["ss_envelopes"] / n, A["ss_ops"] / n, A["ss_req"] / n, A["ss_chained_envelopes"], A["ss_envelopes"], 100 * A["ss_chained_envelopes"] / max(1, A["ss_envelopes"])))
        P(" ss-bearing requests with >=2 ss envelopes (parallel bash emission) %d/%d (%.1f%%); with a chained envelope %d (%.1f%%)" % (
            A["ss_req_parallel_bash"], A["ss_req"], 100 * A["ss_req_parallel_bash"] / max(1, A["ss_req"]), A["ss_req_chained"], 100 * A["ss_req_chained"] / max(1, A["ss_req"])))
        P(" requests with structured read-like calls %d; of which >=2 such calls %d (%.1f%%); calls per such request %.2f" % (
            A["sr_req"], A["sr_req_multi"], 100 * A["sr_req_multi"] / max(1, A["sr_req"]), A["sr_req_calls"] / max(1, A["sr_req"])))
        P(" requests with bash calls %d; of which >=2 bash calls %d (%.1f%%)" % (A["bash_req"], A["bash_req_multi"], 100 * A["bash_req_multi"] / max(1, A["bash_req"])))
        P(" ss ops by tool: " + ", ".join("%s=%d" % (k[5:], v) for k, v in sorted(A.items()) if k.startswith("ssop_")))
        P(" request classes (count | share | calls/req | ops/req | multi-call share | mean cost | mean cache-read tok | mean out+reasoning tok):")
        for cls in ("struct-only", "bash-ss", "bash-other", "mixed", "todo-only", "text-only"):
            c = A["cls_" + cls]
            if not c: continue
            P("   %-11s %5d | %5.1f%% | %.3f | %.3f | %5.1f%% | $%.6f | %8.0f | %6.0f" % (
                cls, c, 100 * c / A["requests"], A["cls_" + cls + "_calls"] / c, A["cls_" + cls + "_ops"] / c,
                100 * A["cls_" + cls + "_multi"] / c, A["cls_" + cls + "_cost"] / c, A["cls_" + cls + "_cache_read"] / c, A["cls_" + cls + "_out"] / c))
        P(" request kinds (R read-only, S search-only, RS mixed exploration, E edit, T test, O other, N todo-only, X text-only): count | ops/req | calls/req")
        for k in ("R", "S", "RS", "E", "T", "O", "N", "X"):
            c = A["kind_" + k]
            if c: P("   %-2s %5d | %.3f | %.3f" % (k, c, A["kind_" + k + "_ops"] / c, A["kind_" + k + "_calls"] / c))
    json.dump({a: dict(v) for a, v in agg.items()}, open(os.path.join(OUT, "agg.json"), "w"), indent=1)
    open(os.path.join(OUT, "census.txt"), "w").write("\n".join(lines) + "\n")

if __name__ == "__main__":
    main()
