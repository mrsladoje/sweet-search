#!/usr/bin/env python3
"""c03: (A) replay the 45 worktree-zero patterns against the golden checkouts with
plain grep on the filesystem (no index, no daemon); (B) ordering in b2-113 rep2;
(C) ss-read vs Read inside the five affected subagents. Prints counts only."""
import json, re, subprocess, collections, glob, os

OUT = "/tmp/wf-slatec/c03-mechanism"
G = "/root/.ss-eval/golden"
GOLDEN = {
    "asynkron__protoactor-dotnet-1909": f"{G}/asynkron__protoactor-dotnet@3a998bc9fa8549829c53282f31dfe95685efc1b8",
    "bfgroup__b2-113": f"{G}/bfgroup__b2@371b47af9dc837624d7af50906653074f8ea1475",
    "bfgroup__b2-259": f"{G}/bfgroup__b2@7cf7bdabb3d3d8e3c41a411a5932626cee690b18",
    "final-form__final-form-64": f"{G}/final-form__final-form@449955e7ef3090c13d7921aa8a71acb95f5ba443",
}
replay = json.load(open(f"{OUT}/replay.json"))
print("=== (A) golden replay of worktree-zero patterns (filesystem grep, prefix stripped) ===")
res = collections.Counter(); per_task = collections.defaultdict(collections.Counter)
details = []
for e in replay:
    gd = GOLDEN[e["task"]]
    pat = e["regex"] if (e["tool"] == "ss-find" and e["regex"]) else e["pattern"]
    if e["tool"] == "ss-find" and not e["regex"]:
        res["semantic-unreplayable"] += 1; per_task[e["task"]]["semantic-unreplayable"] += 1
        continue
    if pat is None:
        res["no-pattern-parsed"] += 1; per_task[e["task"]]["no-pattern-parsed"] += 1
        continue
    icase = e["icase"]
    if pat.startswith("(?i)"):
        pat = pat[4:]; icase = True
    scope = os.path.join(gd, e["subpath"]) if e["subpath"] else gd
    scope_exists = os.path.exists(scope)
    if not scope_exists:
        scope = gd
    args = ["grep", "-rIl", "--exclude-dir=.git", "--exclude-dir=.sweet-search", "--exclude-dir=node_modules", "--exclude-dir=dist"]
    args += ["-F"] if e["fixed"] else ["-E"]
    if icase: args.append("-i")
    if e["word"]: args.append("-w")
    args += ["-e", pat, scope]
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=120)
        files = [l for l in p.stdout.splitlines() if l.strip()]
        ok = p.returncode in (0, 1)
    except Exception as ex:
        files = []; ok = False
    rel = [os.path.relpath(f, gd) for f in files]
    jam_or_build = sum(1 for f in rel if f.endswith(".jam") or f.startswith("src/build/"))
    read_after = set(e.get("read_after") or [])
    in_read_after = any(f in read_after for f in rel)
    key = "hit" if files else ("zero" if ok else "grep-error")
    res[key] += 1; per_task[e["task"]][key] += 1
    if files: res["hit-in-a-file-the-subagent-later-Read"] += int(in_read_after)
    if files and jam_or_build == len(files): res["hit-only-in-jam-or-src-build (pre-E1 blind)"] += 1
    details.append({"task": e["task"], "rep": e["rep"], "agent": e["agent"], "tool": e["tool"], "fixed": e["fixed"],
                    "subpath": e["subpath"], "subpath_exists_in_golden": scope_exists, "n_files": len(files),
                    "n_jam_or_build": jam_or_build, "hit_in_read_after": in_read_after})
print("replay entries:", len(replay), dict(res))
for t, c in per_task.items(): print("  ", t, dict(c))
print("scoped subpath present in golden:", collections.Counter(d["subpath_exists_in_golden"] for d in details if d["subpath"]))
json.dump(details, open(f"{OUT}/replay-details.json", "w"), indent=1)

# (B) ordering in b2-113 rep2 and (C) ss-read vs Read in affected subagents
R = "/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826/agent-state"
WT = re.compile(r"\.claude/worktrees/agent-[0-9a-f]+")
SS = re.compile(r"\bss-(grep|find|search|read|semantic|trace)\b")
import importlib.util
spec = importlib.util.spec_from_file_location("raw", f"{OUT}/c03_raw.py")
# reuse loaders without executing the module body: copy minimal functions
def text_of(content):
    if isinstance(content, str): return content
    if isinstance(content, list): return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""
def load_calls(path):
    uses = {}; order = []; results = {}
    for line in open(path, errors="replace"):
        try: rec = json.loads(line)
        except Exception: continue
        c = (rec.get("message") or {}).get("content")
        if not isinstance(c, list): continue
        for b in c:
            if not isinstance(b, dict): continue
            if b.get("type") == "tool_use" and b.get("id") not in uses:
                uses[b["id"]] = {"id": b["id"], "name": b.get("name"), "input": b.get("input") or {}}; order.append(b["id"])
            elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses and b.get("tool_use_id") not in results:
                results[b["tool_use_id"]] = text_of(b.get("content"))
    return [dict(uses[k], out=results.get(k, "")) for k in order]
def outcome(out):
    head = out.lstrip()[:600]
    if re.search(r"^\[ss\]|unrecognised option|not consumed|requires a value|looks like a flag|^Usage: ss-", head, re.M) and not re.search(r"\b[1-9]\d* total match", head): return "usage"
    if re.search(r"\b0 total match", out) or "(no matches)" in out: return "zero"
    if re.search(r"\b[1-9]\d* total match", out) or re.search(r"^[^\s#][^\s:]*:\d+", head, re.M) or re.search(r"ColGrep [1-9]", head): return "hit"
    return "other"

AFFECTED = {"agent-a3d311866bfc0b7cb", "agent-abd536db90e42b25d", "agent-a41e46d3e2671aa14", "agent-a04ad28e63dd30186", "agent-a38e681945774a613"}
print("\n=== (B)/(C) per affected subagent: sequence letters and ss-read vs Read ===")
print("legend: Z=worktree-scoped zero/usage, S=other ss-* hit, s=other ss-* zero/usage, R=native Read, G=native grep, F=find/ls, .=other")
for f in sorted(glob.glob(f"{R}/*-sweet/claude-home/projects/*/*/subagents/agent-*.jsonl")):
    agent = re.search(r"(agent-[0-9a-f]+)\.jsonl", f).group(1)
    if agent not in AFFECTED: continue
    task = f.split("/agent-state/")[1].split("/")[0].replace("-sweet", "")
    calls = load_calls(f)
    seq = []; n_ssread = 0; n_read = 0; unscoped_hits_after_zero = 0; reads_after_first_unscoped_hit = 0; first_zero = None; first_hit_after_zero = None
    for j, c in enumerate(calls):
        cmd = c["input"].get("command", "") if c["name"] == "Bash" else ""
        if c["name"] == "Read":
            seq.append("R"); n_read += 1
            if first_hit_after_zero is not None and j > first_hit_after_zero: reads_after_first_unscoped_hit += 1
        elif c["name"] == "Bash" and SS.search(cmd):
            if SS.search(cmd).group(1) == "read": n_ssread += 1
            o = outcome(c["out"])
            if WT.search(cmd) and o in ("zero", "usage"):
                seq.append("Z"); first_zero = j if first_zero is None else first_zero
            elif o == "hit":
                seq.append("S")
                if first_zero is not None and j > first_zero:
                    unscoped_hits_after_zero += 1
                    if first_hit_after_zero is None: first_hit_after_zero = j
            else:
                seq.append("s")
        elif c["name"] == "Bash" and re.search(r"\b(rg|grep)\b", cmd):
            seq.append("G")
        elif c["name"] == "Bash" and re.search(r"^\s*(find|ls)\b", cmd):
            seq.append("F")
        else:
            seq.append(".")
    print(f"  {task} {agent}: ss-read={n_ssread} Read={n_read} unscoped-ss-hits-after-first-zero={unscoped_hits_after_zero} Reads-after-first-such-hit={reads_after_first_unscoped_hit}")
    print("   ", "".join(seq))
