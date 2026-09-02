#!/usr/bin/env python3
import gzip, json, re, os, collections, statistics, subprocess
CORPUS = "/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
OUT = "/tmp/wf-slatec/index-time-caps"; RES = "/root/sweet-search-private/eval/task-completion-bench/results"; GOLD = "/root/.ss-eval/golden"
rows = [json.loads(l) for l in gzip.open(CORPUS, "rt")]; rows = [d for d in rows if d.get("canon")]
by_roll = collections.defaultdict(list)
for d in rows: by_roll[(d["h"], d["arm"], d["task"], d["rep"])].append(d)
for k in by_roll: by_roll[k].sort(key=lambda d: d["i"])
task_meta = {it["instance_id"]: it for it in json.load(open(f"{RES}/fp-codex-tab-20260826/sweet/tasks.json"))}
def golden_dir(task):
    m = task_meta[task]; return f"{GOLD}/{m['repo'].replace('/', '__')}@{m['base_commit']}"
DATA_TYPES = "('topKey','keyVal','element','section','id','target','input','query','message','rpc','selector','let','member','enum_constant','field','property','variable')"
CODE_TYPES = "('function','method','class','interface','struct','enum','trait','impl','module','macro','arrowFunction','component','namespace','typeAlias','type','decorator','rule','private')"
def norm(f): return re.sub(r"^\.claude/worktrees/agent-[0-9a-f]+/", "", re.sub(r"^/root/\.ss-eval/runs/r\d+-\d+/", "", f)).lstrip("./")
ent_files = {}
def ent_set(task):
    if task in ent_files: return ent_files[task]
    g = golden_dir(task)
    s = set(x for x in subprocess.run(["sqlite3", f"{g}/.sweet-search/code-graph.db", f"SELECT DISTINCT file_path FROM entities WHERE stale_since IS NULL AND type IN {CODE_TYPES};"], capture_output=True, text=True).stdout.split("\n") if x)
    idx = set(x for x in subprocess.run(["sqlite3", f"{g}/.sweet-search/codebase.db", "SELECT DISTINCT file_path FROM vectors WHERE epoch_retired IS NULL;"], capture_output=True, text=True).stdout.split("\n") if x)
    ent_files[task] = (s, idx); return ent_files[task]
def parse_ssread(op):
    m = re.match(r"(?:\S*/)?ss-read\s+(?:--\S+\s+)*['\"]?([^\s'\"]+)['\"]?(?:\s+(\d+))?(?:\s+(\d+))?", op["text"])
    if not m or m.group(1).startswith("-"): return None
    f, s, e = m.group(1), m.group(2), m.group(3)
    if s and e:
        s, e = int(s), int(e); e = e if e >= s else s + e; return (norm(f), s, e)
    return (norm(f), 1, None)
out = {}
# ---- 1. jump rate by entity presence (sweet) ----
res = {}
for h in ("codex", "opencode", "claude-code"):
    c = collections.Counter()
    for key, lst in by_roll.items():
        if key[0] != h or key[1] != "sweet": continue
        ents, idx = ent_set(key[2])
        seq = []
        for d in lst:
            if d.get("side"): continue
            for op in d["ops"]:
                if op["prog"] == "ss-read":
                    r = parse_ssread(op)
                    if r: seq.append((d["i"],) + r)
        for i, (ci, f, s, e) in enumerate(seq):
            if e is None or not re.search(r"\.(py|js|jsx|ts|tsx|mjs|cjs|go|cs|java|rb|ex|exs|jam|sol|php)$", f): continue
            grp = "has-symbols" if f in ents else ("indexed-no-symbols" if f in idx else "not-indexed")
            c[(grp, "ranged")] += 1
            nxt = [x for x in seq[i + 1: i + 4] if x[1] == f and x[3] is not None]
            if not nxt: continue
            s2, e2 = nxt[0][2], nxt[0][3]
            if s2 <= e and e2 >= s: c[(grp, "overlap")] += 1
            elif abs(s2 - (e + 1)) <= 5 or abs(s - (e2 + 1)) <= 5: c[(grp, "contig")] += 1
            else: c[(grp, "jump")] += 1
    res[h] = {g: dict(ranged=c[(g, "ranged")], jump=c[(g, "jump")], overlap=c[(g, "overlap")], jump_pct=round(100.0 * c[(g, "jump")] / c[(g, "ranged")], 1) if c[(g, "ranged")] else None, overlap_pct=round(100.0 * c[(g, "overlap")] / c[(g, "ranged")], 1) if c[(g, "ranged")] else None) for g in ("has-symbols", "indexed-no-symbols", "not-indexed")}
out["jump_by_symbol_presence"] = res
print("1", json.dumps(res))
# ---- 2. symbol coverage by extension, any code type, + zero-entity samples ----
ext_files = collections.Counter(); ext_ent = collections.Counter(); samples = collections.defaultdict(list); testy = collections.Counter()
for task in task_meta:
    ents, idx = ent_set(task)
    for f in idx:
        e = os.path.splitext(f)[1]
        if e not in (".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".go", ".cs", ".java", ".rb", ".ex", ".exs", ".jam", ".sol", ".php", ".cpp", ".h", ".c"): continue
        ext_files[e] += 1
        if f in ents: ext_ent[e] += 1
        else:
            if len(samples[e]) < 6: samples[e].append(f"{task}:{f}")
            if re.search(r"(^|/)(tests?|__tests__|spec|fixtures?)(/|$)|\.test\.|_test\.", f): testy[e] += 1
out["symbol_coverage_any_code_type"] = {e: dict(files=ext_files[e], with_symbol=ext_ent[e], pct=round(100.0 * ext_ent[e] / ext_files[e], 1), zero_symbol_files_in_test_or_fixture_dirs=testy[e], samples=samples[e]) for e in sorted(ext_files, key=lambda e: -ext_files[e])}
print("2", json.dumps(out["symbol_coverage_any_code_type"]))
# ---- 3. run_tests 'ignored (reason)' reasons ----
reasons = collections.Counter()
for d in rows:
    o = d.get("out") or ""
    for m in re.finditer(r"targeted pattern '[^']*' ignored \(([^)]*)\)", o): reasons[m.group(1)[:80]] += 1
out["pattern_ignored_reasons"] = reasons.most_common(10)
print("3", json.dumps(out["pattern_ignored_reasons"]))
# ---- 4. ss-read output shape: first lines of a few outputs ----
shapes = collections.Counter(); ex = []
for d in rows:
    if d["arm"] != "sweet": continue
    for op in d["ops"]:
        if op["prog"] == "ss-read" and op["cap"] == "read.range":
            o = d.get("out") or ""
            first = o.split("\n")[0][:80] if d["h"] != "codex" else (o.split("Output:\n", 1)[1].split("\n")[0][:80] if "Output:\n" in o else o[:80])
            shapes[re.sub(r"\d+", "N", first)[:60]] += 1
            if len(ex) < 3: ex.append(o[:400])
            break
out["ss_read_first_line_shapes"] = shapes.most_common(8)
print("4", json.dumps(out["ss_read_first_line_shapes"]))
print(json.dumps(ex, indent=0)[:1500])
json.dump(out, open(f"{OUT}/census4.json", "w"), indent=1)
