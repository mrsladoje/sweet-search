#!/usr/bin/env python3
"""c03 mechanism verification: re-derive the worktree-scope numbers from the
pre-classified call corpus (native-capability-gaps agent, read-only) and the raw
events file, for the claude-code tab run, sweet arm, subagent (side) calls.

Prints only counts, command shapes and repo-relative path stems; never tool
output bodies (grading logs / hidden tests are out of scope here anyway).
"""
import gzip, json, re, sys, collections

RUN = "fp-claudecode-tab-20260826"
CC = "/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
EV = "/tmp/wf-slatec/native-capability-gaps/events-claude-code.jsonl.gz"
PRICE_TOK = 0.301 / 1e6      # $/ingested token, brief factor for claude sweet
PRICE_REQ = 0.000702         # $/request, claude sweet
CELL = 0.020727              # $/rollout, claude-code sweet TAB cell (brief)
N_ROLL = 66

RET_CAPS = {"read.range", "read.whole", "grep.literal", "grep.regex", "glob", "list"}

# transcript map from events
tmap = {}
with gzip.open(EV, "rt") as f:
    for line in f:
        r = json.loads(line)
        if r["run"] != RUN or r["arm"] != "sweet":
            continue
        tmap[(r["task"], int(r["rep"]), r["side"] in (True, "True"), int(r["i"]))] = r["transcript"]

calls = []
with gzip.open(CC, "rt") as f:
    for line in f:
        r = json.loads(line)
        if r.get("run") != RUN or r.get("arm") != "sweet" or r.get("h") != "claude-code":
            continue
        if not r.get("canon", True):
            continue
        r["transcript"] = tmap.get((r["task"], int(r["rep"]), bool(r["side"]), int(r["i"])), "?")
        calls.append(r)

print(f"sweet claude tab calls loaded: {len(calls)}  side={sum(1 for c in calls if c['side'])}  main={sum(1 for c in calls if not c['side'])}")

def is_ss(c):
    return c.get("via") == "ss" or (c["tool"] == "Bash" and re.search(r"\bss-(grep|find|search|read|semantic|trace)\b", c.get("cmd") or ""))

def ss_tool(c):
    m = re.search(r"\bss-(grep|find|search|read|semantic|trace)\b", c.get("cmd") or "")
    return ("ss-" + m.group(1)) if m else None

WT = re.compile(r"\.claude/worktrees/agent-[0-9a-f]+")

def wt_scoped(c):
    cmd = c.get("cmd") or ""
    return bool(WT.search(cmd))

def wt_scope_is_root(c):
    """True if every worktree path in the command is the worktree root itself (no subpath)."""
    cmd = c.get("cmd") or ""
    paths = re.findall(r"(/root/\.ss-eval/runs/r\d+-\d+/\.claude/worktrees/agent-[0-9a-f]+)(/[^\s'\"]*)?", cmd)
    if not paths:
        return None
    return all((sub or "") in ("", "/") for _, sub in paths)

def outcome(c):
    out = (c.get("out") or "")
    head = out.lstrip()[:400]
    if "no Sweet Search index" in out:
        return "no-index"
    if re.search(r"^\[ss\]|unrecognised option|not consumed|requires a value|looks like a flag|Usage: ss-", head, re.M) and not re.search(r"\d+ total match", head):
        return "usage"
    if re.search(r"\b0 total match", out) or "(no matches)" in out:
        return "zero"
    if re.search(r"\b[1-9]\d* total match", out) or re.search(r"^\S+:\d+", head, re.M):
        return "hit"
    if c.get("err"):
        return "error"
    return "other"

def pattern_of(c):
    ops = c.get("ops") or []
    for o in ops:
        if o.get("via") == "ss" and o.get("pattern"):
            return o["pattern"]
    # fallback: first quoted token after ss-grep/ss-find
    m = re.search(r"ss-(?:grep|find)\s+(?:-\w+\s+)*(?:'([^']*)'|\"([^\"]*)\"|(\S+))", c.get("cmd") or "")
    if m:
        return next(g for g in m.groups() if g is not None)
    return None

# ---- group by subagent transcript
by_tx = collections.defaultdict(list)
for c in calls:
    if c["side"]:
        by_tx[(c["task"], c["rep"], c["transcript"])].append(c)
for k in by_tx:
    by_tx[k].sort(key=lambda c: int(c["i"]))

print("\n=== (1) worktree-scoped ss-* calls in sweet subagents, tab run ===")
tot = collections.Counter(); per_roll = collections.defaultdict(collections.Counter); per_tool = collections.Counter()
root_only = collections.Counter()
for key, seq in by_tx.items():
    for c in seq:
        if is_ss(c) and wt_scoped(c):
            o = outcome(c)
            tot[o] += 1
            per_roll[(key[0], key[1])][o] += 1
            per_tool[(ss_tool(c), o)] += 1
            root_only[wt_scope_is_root(c)] += 1
print("total worktree-scoped ss calls:", sum(tot.values()), dict(tot))
print("by tool x outcome:", dict(per_tool))
print("scope is the worktree root itself (True) vs a subpath (False):", dict(root_only))
for k in sorted(per_roll):
    print("  ", k, dict(per_roll[k]))

print("\n=== (1b) ANY absolute --in / positional path NOT under a worktree, in sweet arm (main+side): outcome ===")
abs_other = collections.Counter(); ex = []
for c in calls:
    if not is_ss(c):
        continue
    cmd = c.get("cmd") or ""
    if wt_scoped(c):
        continue
    if re.search(r"--in\s+/root/", cmd) or re.search(r"ss-(grep|find)\s.*\s/root/\.ss-eval/runs/\S+", cmd):
        o = outcome(c)
        abs_other[o] += 1
        if len(ex) < 6:
            ex.append((c["task"], c["rep"], "side" if c["side"] else "main", o, re.sub(r"/root/\.ss-eval/runs/r\d+-\d+", "<root>", cmd)[:160]))
print(dict(abs_other))
for e in ex:
    print("  ", e)

print("\n=== (1c) 'no Sweet Search index' anywhere in sweet-arm outputs ===")
print(sum(1 for c in calls if "no Sweet Search index" in (c.get("out") or "")))

print("\n=== (2) native retrieval ops in sweet subagents: total vs downstream of worktree zeros ===")
def is_native_ret(c):
    return c.get("via") == "native" and c.get("cap") in RET_CAPS

grand = dict(ops=0, tok=0, reqs=set())
after_first_wz = dict(ops=0, tok=0, reqs=set())
within3 = dict(ops=0, tok=0, reqs=set())
in_wz_tx = dict(ops=0, tok=0, reqs=set())
before_any_wz_in_wz_tx = dict(ops=0, tok=0, reqs=set())
per_tx_rows = []
for key, seq in by_tx.items():
    wz_idx = [j for j, c in enumerate(seq) if is_ss(c) and wt_scoped(c) and outcome(c) in ("zero", "usage")]
    first = wz_idx[0] if wz_idx else None
    n_ops = n_tok = 0; n_after = t_after = 0; n_w3 = t_w3 = 0
    for j, c in enumerate(seq):
        if not is_native_ret(c):
            continue
        tok = int(c.get("tokIn") or 0) + int(c.get("tokOut") or 0)
        reqid = (key, c.get("req"))
        grand["ops"] += 1; grand["tok"] += tok; grand["reqs"].add(reqid)
        n_ops += 1; n_tok += tok
        if wz_idx:
            in_wz_tx["ops"] += 1; in_wz_tx["tok"] += tok; in_wz_tx["reqs"].add(reqid)
            if first is not None and j > first:
                after_first_wz["ops"] += 1; after_first_wz["tok"] += tok; after_first_wz["reqs"].add(reqid)
                n_after += 1; t_after += tok
            else:
                before_any_wz_in_wz_tx["ops"] += 1; before_any_wz_in_wz_tx["tok"] += tok; before_any_wz_in_wz_tx["reqs"].add(reqid)
            if any(0 < j - w <= 3 for w in wz_idx):
                within3["ops"] += 1; within3["tok"] += tok; within3["reqs"].add(reqid)
                n_w3 += 1; t_w3 += tok
    per_tx_rows.append((key[0], key[1], key[2].split("/")[-1][:24], len(seq), len(wz_idx), n_ops, n_tok, n_after, t_after, n_w3, t_w3))

def price(d):
    return d["tok"] * PRICE_TOK + len(d["reqs"]) * PRICE_REQ

print(f"all subagent native retrieval: ops={grand['ops']} tok={grand['tok']:,} reqs={len(grand['reqs'])} -> ${price(grand):.4f} total = ${price(grand)/N_ROLL:.6f}/rollout = {100*price(grand)/N_ROLL/CELL:.2f}% of cell")
print(f"in subagents that had >=1 worktree zero/usage: ops={in_wz_tx['ops']} tok={in_wz_tx['tok']:,} reqs={len(in_wz_tx['reqs'])} -> {100*price(in_wz_tx)/N_ROLL/CELL:.2f}% of cell")
print(f"  of which BEFORE the first worktree zero: ops={before_any_wz_in_wz_tx['ops']} tok={before_any_wz_in_wz_tx['tok']:,}")
print(f"after the first worktree zero (same subagent): ops={after_first_wz['ops']} tok={after_first_wz['tok']:,} reqs={len(after_first_wz['reqs'])} -> ${price(after_first_wz)/N_ROLL:.6f}/rollout = {100*price(after_first_wz)/N_ROLL/CELL:.2f}% of cell")
print(f"within 3 calls after a worktree zero: ops={within3['ops']} tok={within3['tok']:,} reqs={len(within3['reqs'])} -> ${price(within3)/N_ROLL:.6f}/rollout = {100*price(within3)/N_ROLL/CELL:.2f}% of cell")
print("\nper subagent: task rep agent calls wtZeroOrUsage natOps natTok natOpsAfter natTokAfter natOpsW3 natTokW3")
for r in sorted(per_tx_rows):
    print("  ", *r)

print("\n=== (2b) native retrieval ops in wz-subagents by cap, before vs after first worktree zero ===")
cap_ba = collections.Counter()
for key, seq in by_tx.items():
    wz_idx = [j for j, c in enumerate(seq) if is_ss(c) and wt_scoped(c) and outcome(c) in ("zero", "usage")]
    if not wz_idx: continue
    first = wz_idx[0]
    for j, c in enumerate(seq):
        if is_native_ret(c):
            cap_ba[(c["cap"], "after" if j > first else "before")] += 1
for k in sorted(cap_ba): print("  ", k, cap_ba[k])

print("\n=== (3) same-pattern unscoped re-run after a worktree zero, per subagent ===")
rerun_tot = collections.Counter()
for key, seq in by_tx.items():
    wz = [(j, c) for j, c in enumerate(seq) if is_ss(c) and wt_scoped(c) and outcome(c) == "zero"]
    if not wz: continue
    pats = {}
    for j, c in wz:
        p = pattern_of(c)
        if p is None: continue
        pats.setdefault(p, j)
    found = collections.Counter()
    for p, j0 in pats.items():
        later = [c for j, c in enumerate(seq) if j > j0 and is_ss(c) and not wt_scoped(c) and pattern_of(c) == p]
        if later:
            outs = {outcome(c) for c in later}
            found["hit" if "hit" in outs else ("zero" if "zero" in outs else "other")] += 1
        else:
            found["not-rerun"] += 1
    rerun_tot.update(found)
    print("  ", key[0], "rep", key[1], key[2].split("/")[-1][:24], "unique zero patterns:", len(pats), dict(found))
print("total:", dict(rerun_tot))

print("\n=== (3b) unique worktree-zero patterns per task (for the golden replay; pattern text shown as agent typed it) ===")
pat_by_task = collections.defaultdict(dict)
for key, seq in by_tx.items():
    for c in seq:
        if is_ss(c) and wt_scoped(c) and outcome(c) == "zero":
            p = pattern_of(c)
            if p is None: continue
            fixed = bool(re.search(r"(^|\s)-F(\s|$)|--fixed-strings", c.get("cmd") or "")) or ("ss-find" in (c.get("cmd") or "") and "--regex" not in (c.get("cmd") or ""))
            icase = bool(re.search(r"(^|\s)-i(\s|$)|--ignore-case|-iw|-wi", c.get("cmd") or ""))
            pat_by_task[key[0]].setdefault(p, {"fixed": fixed, "icase": icase, "tool": ss_tool(c), "n": 0})
            pat_by_task[key[0]][p]["n"] += 1
json.dump({t: pats for t, pats in pat_by_task.items()}, open("/tmp/wf-slatec/c03-mechanism/wt-zero-patterns.json", "w"), indent=1)
for t, pats in pat_by_task.items():
    print("  ", t, len(pats), "unique patterns;", sum(v["n"] for v in pats.values()), "zero calls")

print("\n=== (4) hit path form: first path stem of a successful unscoped ss-grep in a subagent ===")
for key, seq in by_tx.items():
    for c in seq:
        if is_ss(c) and not wt_scoped(c) and outcome(c) == "hit" and ss_tool(c) == "ss-grep":
            m = re.search(r"^([^\s:]+):\d+", (c.get("out") or ""), re.M)
            if m:
                print("  ", key[0], "rep", key[1], "path form:", ("absolute" if m.group(1).startswith("/") else "relative"), "e.g.", m.group(1).split("/")[0] + "/...")
                break
    else:
        continue
    break

print("\n=== (5) the 9 delegating rollouts: which had worktree zeros ===")
roll_wz = collections.defaultdict(int)
for key, seq in by_tx.items():
    roll_wz[(key[0], key[1])] += sum(1 for c in seq if is_ss(c) and wt_scoped(c) and outcome(c) in ("zero", "usage"))
for k in sorted(roll_wz): print("  ", k, "worktree zero+usage:", roll_wz[k])
