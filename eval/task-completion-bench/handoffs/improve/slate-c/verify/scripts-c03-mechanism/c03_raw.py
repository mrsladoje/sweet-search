#!/usr/bin/env python3
"""c03: parse the 11 sweet subagent transcripts of fp-claudecode-tab-20260826 directly.
Per subagent: ordered tool calls, worktree-scoped ss-* calls and outcomes, native
retrieval before/after the first worktree zero, same-pattern unscoped reruns,
and a replay list of the zero patterns. Prints counts, command shapes, first
header line of ss outputs, and repo-relative path stems only.
"""
import glob, json, re, collections, os

R = "/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/agent-state"
OUT = "/tmp/wf-slatec/c03-mechanism"
WT = re.compile(r"(/root/\.ss-eval/runs/r\d+-\d+)/\.claude/worktrees/(agent-[0-9a-f]+)(/[^\s'\"]*)?")
SS = re.compile(r"\bss-(grep|find|search|read|semantic|trace)\b")
CHARS_PER_TOK = 4.0  # approximation; calibrated below against the corpus total

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""

def load_calls(path):
    uses = {}
    order = []
    results = {}
    for line in open(path, errors="replace"):
        try:
            rec = json.loads(line)
        except Exception:
            continue
        m = rec.get("message") or {}
        c = m.get("content")
        if not isinstance(c, list):
            continue
        for b in c:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use" and b.get("id") not in uses:
                uses[b["id"]] = {"id": b["id"], "name": b.get("name"), "input": b.get("input") or {}}
                order.append(b["id"])
            elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses and b.get("tool_use_id") not in results:
                results[b["tool_use_id"]] = {"text": text_of(b.get("content")), "is_error": bool(b.get("is_error"))}
    calls = []
    for k in order:
        u = uses[k]
        r = results.get(k, {"text": "", "is_error": False})
        u["out"] = r["text"]; u["is_error"] = r["is_error"]
        calls.append(u)
    return calls

def ss_tool(cmd):
    m = SS.search(cmd or "")
    return "ss-" + m.group(1) if m else None

def outcome(tool, out):
    head = out.lstrip()[:600]
    if "no Sweet Search index" in out:
        return "no-index"
    if re.search(r"^\[ss\]|unrecognised option|not consumed|requires a value|looks like a flag|^Usage: ss-", head, re.M) and not re.search(r"\b[1-9]\d* total match", head):
        return "usage"
    if re.search(r"\b0 total match", out) or "(no matches)" in out or re.search(r"\b0 (result|candidate|match)", head):
        return "zero"
    if re.search(r"\b[1-9]\d* total match", out) or re.search(r"^[^\s#][^\s:]*:\d+", head, re.M) or re.search(r"\b[1-9]\d* (result|candidate)", head):
        return "hit"
    return "other"

def pattern_of(cmd):
    # strip the binary path, then take the first non-flag token after the tool name
    m = SS.search(cmd)
    rest = cmd[m.end():] if m else cmd
    toks = re.findall(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"|(\S+)", rest)
    skip_next = False
    for q1, q2, bare in toks:
        tok = q1 if q1 != "" or "''" in rest else (q2 if q2 != "" else bare)
        if skip_next:
            skip_next = False
            continue
        if bare and bare.startswith("-"):
            if bare in ("--in", "-k", "--regex", "--top", "--file", "--query", "--hint", "--depth", "--budget", "--max-tokens", "--mode"):
                skip_next = True
            continue
        if bare in ("2>&1", "|", "||", "&&", ";"):
            break
        return tok
    return None

def flags_of(cmd):
    return {
        "fixed": bool(re.search(r"(^|\s)-\w*F\w*(\s|$)|--fixed-strings", cmd)),
        "icase": bool(re.search(r"(^|\s)-\w*i\w*(\s|$)|--ignore-case", cmd)),
        "word": bool(re.search(r"(^|\s)-\w*w\w*(\s|$)|--word-regexp", cmd)),
        "regex": (lambda m: next((g for g in m.groups() if g), None) if m else None)(re.search(r"--regex\s+(?:'([^']*)'|\"([^\"]*)\"|(\S+))", cmd)),
    }

def native_kind(call):
    n = call["name"]
    if n == "Read":
        return "read"
    if n == "Grep":
        return "grep"
    if n == "Glob":
        return "glob"
    if n == "Bash":
        cmd = call["input"].get("command", "") or ""
        if SS.search(cmd):
            return None
        stmts = re.split(r"\s*(?:&&|\|\||;|\n)\s*", cmd)
        kinds = []
        for s in stmts:
            s = s.strip()
            if re.match(r"(rg|grep|egrep|fgrep|git grep)\b", s) or re.search(r"\|\s*(rg|grep)\b", s):
                kinds.append("grep")
            elif re.match(r"find\b", s) or re.match(r"ls\b", s) or re.match(r"tree\b", s):
                kinds.append("glob" if "-name" in s or "-iname" in s else "list")
            elif re.match(r"(cat|sed -n|head|tail|nl|awk)\b", s):
                kinds.append("read")
        if kinds:
            return kinds[0]
    return None

files = sorted(glob.glob(f"{R}/*-sweet/claude-home/projects/*/*/subagents/agent-*.jsonl"))
print("sweet subagent transcripts:", len(files))

grand = collections.Counter()
tot_chars_side = 0
replay = []
summary_rows = []
agg_native = dict(total=collections.Counter(), after=collections.Counter(), w3=collections.Counter(), before=collections.Counter())
for f in files:
    task = f.split("/agent-state/")[1].split("/")[0].replace("-sweet", "")
    rep = re.search(r"-runs-r(\d+)-", f).group(1)
    agent = re.search(r"(agent-[0-9a-f]+)\.jsonl", f).group(1)
    calls = load_calls(f)
    for c in calls:
        tot_chars_side += len(c["out"]) + len(json.dumps(c["input"]))
    n_ss = 0; wt = collections.Counter(); wt_tools = collections.Counter(); wz_idx = []; subpath = collections.Counter()
    zero_pats = {}
    other_heads = []
    for j, c in enumerate(calls):
        if c["name"] != "Bash":
            continue
        cmd = c["input"].get("command", "") or ""
        t = ss_tool(cmd)
        if not t:
            continue
        n_ss += 1
        m = WT.search(cmd)
        if not m:
            continue
        o = outcome(t, c["out"])
        wt[o] += 1; wt_tools[(t, o)] += 1
        subpath["root" if not (m.group(3) or "").strip("/") else "subpath"] += 1
        if o in ("zero", "usage"):
            wz_idx.append(j)
        if o == "zero":
            p = pattern_of(cmd)
            fl = flags_of(cmd)
            rx = fl["regex"]
            zero_pats.setdefault(p, j)
            replay.append({"task": task, "rep": rep, "agent": agent, "j": j, "tool": t, "pattern": p, "regex": rx,
                           "fixed": fl["fixed"], "icase": fl["icase"], "word": fl["word"],
                           "subpath": (m.group(3) or "").strip("/")})
        if o == "other":
            other_heads.append((t, c["out"].lstrip().splitlines()[0][:100] if c["out"].strip() else "<empty>"))
    # native retrieval before/after
    first = wz_idx[0] if wz_idx else None
    nat = collections.Counter(); nat_after = collections.Counter(); nat_w3 = collections.Counter(); nat_before = collections.Counter()
    tok = collections.Counter()
    read_files_after = set()
    for j, c in enumerate(calls):
        k = native_kind(c)
        if not k:
            continue
        ch = len(c["out"]) + len(json.dumps(c["input"]))
        nat[k] += 1; tok["all"] += ch
        agg_native["total"][k] += 1; agg_native["total"]["chars"] += ch
        if first is not None:
            if j > first:
                nat_after[k] += 1; tok["after"] += ch
                agg_native["after"][k] += 1; agg_native["after"]["chars"] += ch
                if c["name"] == "Read":
                    fp = c["input"].get("file_path", "")
                    mm = WT.search(fp)
                    read_files_after.add((mm.group(3) or "").strip("/") if mm else fp)
            else:
                nat_before[k] += 1; tok["before"] += ch
                agg_native["before"][k] += 1; agg_native["before"]["chars"] += ch
            if any(0 < j - w <= 3 for w in wz_idx):
                nat_w3[k] += 1; tok["w3"] += ch
                agg_native["w3"][k] += 1; agg_native["w3"]["chars"] += ch
    # reruns
    rerun = collections.Counter()
    for p, j0 in zero_pats.items():
        later = [c for j, c in enumerate(calls) if j > j0 and c["name"] == "Bash" and ss_tool(c["input"].get("command", "") or "")
                 and not WT.search(c["input"].get("command", "") or "") and pattern_of(c["input"].get("command", "") or "") == p]
        if later:
            outs = {outcome(ss_tool(c["input"]["command"]), c["out"]) for c in later}
            rerun["hit" if "hit" in outs else ("zero" if "zero" in outs else "other")] += 1
        else:
            rerun["not-rerun"] += 1
    for r in replay:
        if r["agent"] == agent:
            r["read_after"] = sorted(read_files_after)[:40]
    grand.update(wt)
    summary_rows.append((task, rep, agent, len(calls), n_ss, dict(wt), dict(subpath), dict(nat), tok["all"], dict(nat_after), tok["after"], dict(nat_w3), tok["w3"], dict(rerun), len(zero_pats)))
    print(f"\n--- {task} rep{rep} {agent}: calls={len(calls)} ss={n_ss} worktree-scoped={sum(wt.values())} {dict(wt)} scope={dict(subpath)}")
    print(f"    tools x outcome: {dict(wt_tools)}")
    print(f"    native retrieval: all={dict(nat)} chars={tok['all']:,} | before-first-wz={dict(nat_before)} chars={tok['before']:,} | after-first-wz={dict(nat_after)} chars={tok['after']:,} | within3={dict(nat_w3)} chars={tok['w3']:,}")
    print(f"    unique zero patterns={len(zero_pats)} unscoped rerun outcomes={dict(rerun)}")
    if other_heads:
        print(f"    'other' outcome heads (tool, first line): {other_heads[:6]}")

print("\n=== totals over the 11 subagents ===")
print("worktree-scoped ss calls by outcome:", dict(grand), "sum=", sum(grand.values()))
print("native retrieval ops all:", dict(agg_native["total"]))
print("native retrieval ops after first worktree zero (5 subagents):", dict(agg_native["after"]))
print("native retrieval ops before first worktree zero (5 subagents):", dict(agg_native["before"]))
print("native retrieval ops within 3 calls after a worktree zero:", dict(agg_native["w3"]))
print(f"total side chars (inputs+outputs): {tot_chars_side:,}  -> at 4 chars/tok = {tot_chars_side/4:,.0f} tok (corpus said 743,399 side tokens)")
json.dump(replay, open(f"{OUT}/replay.json", "w"), indent=1)
print("replay entries (zero calls):", len(replay))
