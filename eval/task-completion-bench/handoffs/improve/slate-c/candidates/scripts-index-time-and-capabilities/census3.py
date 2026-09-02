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
out = {}
# ---- A. per-extension symbol-extraction coverage across the 22 goldens ----
ext_files = collections.Counter(); ext_with_ent = collections.Counter(); per_task_lang = {}
for task in task_meta:
    g = golden_dir(task)
    idx = set(x for x in subprocess.run(["sqlite3", f"{g}/.sweet-search/codebase.db", "SELECT DISTINCT file_path FROM vectors WHERE epoch_retired IS NULL;"], capture_output=True, text=True).stdout.split("\n") if x)
    ent = set(x for x in subprocess.run(["sqlite3", f"{g}/.sweet-search/code-graph.db", "SELECT DISTINCT file_path FROM entities WHERE stale_since IS NULL AND type IN ('function','class','method','interface','struct','enum','trait','impl','module','type','rule','macro');"], capture_output=True, text=True).stdout.split("\n") if x)
    ent_any = set(x for x in subprocess.run(["sqlite3", f"{g}/.sweet-search/code-graph.db", "SELECT DISTINCT file_path FROM entities WHERE stale_since IS NULL;"], capture_output=True, text=True).stdout.split("\n") if x)
    types = subprocess.run(["sqlite3", f"{g}/.sweet-search/code-graph.db", "SELECT type, count(*) FROM entities WHERE stale_since IS NULL GROUP BY type ORDER BY 2 DESC LIMIT 8;"], capture_output=True, text=True).stdout.replace("\n", " ")
    lang = task_meta[task]["language"]
    src = [f for f in idx if re.search(r"\.(py|js|jsx|ts|tsx|mjs|cjs|go|cs|java|rb|ex|exs|jam|sol|php|kt|rs|swift|c|cc|cpp|h)$", f)]
    per_task_lang[task] = dict(language=lang, indexed_files=len(idx), source_files=len(src), source_with_code_entity=sum(1 for f in src if f in ent), source_with_any_entity=sum(1 for f in src if f in ent_any), entity_types=types.strip())
    for f in src:
        e = os.path.splitext(f)[1]; ext_files[e] += 1
        if f in ent: ext_with_ent[e] += 1
out["symbol_coverage_by_ext"] = {e: dict(indexed_source_files=ext_files[e], with_code_entity=ext_with_ent[e], pct=round(100.0*ext_with_ent[e]/ext_files[e],1)) for e in sorted(ext_files, key=lambda e: -ext_files[e])}
out["symbol_coverage_by_task"] = per_task_lang
print("A", json.dumps(out["symbol_coverage_by_ext"]))
for t, v in per_task_lang.items(): print("   ", t, json.dumps(v))
# ---- B. missing source breakdown: tracked but not indexed .go/.py/.md/.json ----
miss_class = collections.Counter(); miss_ex = collections.defaultdict(list)
for task in task_meta:
    g = golden_dir(task)
    tracked = set(x for x in subprocess.run(["git", "-C", g, "ls-files"], capture_output=True, text=True).stdout.split("\n") if x)
    idx = set(x for x in subprocess.run(["sqlite3", f"{g}/.sweet-search/codebase.db", "SELECT DISTINCT file_path FROM vectors WHERE epoch_retired IS NULL;"], capture_output=True, text=True).stdout.split("\n") if x)
    for f in tracked - idx:
        if not re.search(r"\.(go|py|js|ts|md|json|cs|java|ex|exs|jam)$", f): continue
        try: size = os.path.getsize(os.path.join(g, f))
        except OSError: size = -1
        if size == 0: cls = "empty-file"
        elif re.search(r"(^|/)(generated|gen|vendor|third_party|node_modules|dist|build|\.github|docs?|doc|examples?|testdata|fixtures?)(/|$)", f): cls = "excluded-dir:" + re.search(r"(^|/)(generated|gen|vendor|third_party|node_modules|dist|build|\.github|docs?|doc|examples?|testdata|fixtures?)(/|$)", f).group(2)
        elif size > 1024*1024: cls = ">1MB"
        else: cls = "other"
        miss_class[(os.path.splitext(f)[1], cls)] += 1
        if len(miss_ex[(os.path.splitext(f)[1], cls)]) < 3: miss_ex[(os.path.splitext(f)[1], cls)].append(f"{task}:{f}:{size}")
out["missing_source_breakdown"] = {f"{k[0]} {k[1]}": dict(n=v, ex=miss_ex[k]) for k, v in miss_class.most_common()}
print("B", json.dumps(out["missing_source_breakdown"]))
# ---- C. grep->read pair census ----
def norm(f): return re.sub(r"^\.claude/worktrees/agent-[0-9a-f]+/", "", re.sub(r"^/root/\.ss-eval/runs/r\d+-\d+/", "", f)).lstrip("./")
pairs = {}
for h in ("codex", "opencode", "claude-code"):
    for arm in ("sweet", "native"):
        defn = 0; defn_then_read_hit = 0; any_grep = 0; grep_then_read_hit = 0; n_roll = 0; read_after_grep_spans = []
        for key, lst in by_roll.items():
            if key[0] != h or key[1] != arm: continue
            n_roll += 1
            main = [d for d in lst if not d.get("side")]
            for idx, d in enumerate(main):
                gops = [op for op in d["ops"] if op["cap"] in ("grep.literal", "grep.regex") and ((arm == "sweet" and op["prog"] in ("ss-grep", "ss-find")) or (arm == "native" and op["prog"] in ("rg", "grep")))]
                if not gops: continue
                o = d.get("out") or ""
                hits = set(norm(x) for x in re.findall(r"(?m)^\s*(?:\d+\s+)?([^\s:#]+\.[A-Za-z0-9]+):\d+", o))
                if not hits: continue
                any_grep += 1; is_defn = any("defn" in op["tags"] for op in gops)
                if is_defn: defn += 1
                found = False
                for d2 in main[idx + 1: idx + 3]:
                    for op2 in d2["ops"]:
                        if op2["cap"] in ("read.range", "read.whole") and ((arm == "sweet" and op2["prog"] == "ss-read") or (arm == "native" and op2["prog"] in ("sed", "Read", "read", "cat", "nl"))):
                            fp = None
                            m = re.match(r"(?:\S*/)?ss-read\s+['\"]?([^\s'\"]+)", op2["text"]) if op2["prog"] == "ss-read" else None
                            if m: fp = m.group(1)
                            elif op2["paths"]: fp = op2["paths"][0]
                            if fp and norm(fp) in hits: found = True
                    if found: break
                if found:
                    grep_then_read_hit += 1
                    if is_defn: defn_then_read_hit += 1
        pairs[f"{h}/{arm}"] = dict(rollouts=n_roll, greps_with_hits=any_grep, grep_then_read_of_hit_file_within2=grep_then_read_hit, per_rollout=round(grep_then_read_hit/n_roll,2), definition_shaped_greps_with_hits=defn, defn_then_read_hit=defn_then_read_hit)
out["grep_then_read"] = pairs
print("C", json.dumps(pairs))
# ---- D. awslabs: test-file read before first edit by outcome ----
aws = {}
for key, lst in by_roll.items():
    if key[2] != "awslabs__aws-embedded-metrics-node-21": continue
    first_edit = next((d["i"] for d in lst if any(op["cap"] == "edit" for op in d["ops"])), None)
    read_ctx_test = False; read_any_test = False
    for d in lst:
        if first_edit is not None and d["i"] >= first_edit: break
        blob = json.dumps(d.get("in")) + " " + (d.get("cmd") or "") + " " + " ".join(op["text"] for op in d["ops"])
        if "MetricsContext.test" in blob: read_ctx_test = True
        if re.search(r"__tests__|\.test\.ts", blob): read_any_test = True
    aws[f"{key[0]}/{key[1]}/rep{key[3]}"] = dict(resolved=lst[0]["resolved"], read_context_test_before_edit=read_ctx_test, read_any_test_before_edit=read_any_test)
out["awslabs_test_read_by_outcome"] = aws
print("D", json.dumps(aws))
# ---- E. ss-read outputs carrying a symbols: header ----
sym_hdr = collections.Counter()
for d in rows:
    if d["arm"] != "sweet": continue
    for op in d["ops"]:
        if op["prog"] == "ss-read":
            o = d.get("out") or ""
            sym_hdr[(d["h"], "with symbols header" if re.search(r"(?m)^symbols: ", o) else "no symbols header")] += 1
out["ss_read_symbols_header"] = {"/".join(k): v for k, v in sym_hdr.items()}
print("E", json.dumps(out["ss_read_symbols_header"]))
json.dump(out, open(f"{OUT}/census3.json", "w"), indent=1)
