#!/usr/bin/env python3
"""Second pass: jump direction, targeted-run output size, own-code zero probes in detail,
index path coverage per pool golden, dependency inspection counts, outline payload sizing."""
import gzip, json, re, os, collections, statistics, subprocess, itertools
CORPUS = "/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
OUT = "/tmp/wf-slatec/index-time-caps"; RES = "/root/sweet-search-private/eval/task-completion-bench/results"
GOLD = "/root/.ss-eval/golden"
rows = [json.loads(l) for l in gzip.open(CORPUS, "rt")]
rows = [d for d in rows if d.get("canon")]
by_roll = collections.defaultdict(list)
for d in rows: by_roll[(d["h"], d["arm"], d["task"], d["rep"])].append(d)
for k in by_roll: by_roll[k].sort(key=lambda d: d["i"])
RUN = {"codex": "fp-codex-tab-20260826", "opencode": "fp-opencode-tab-20260826", "claude-code": "fp-claudecode-tab-20260826"}

# task -> golden dir via tasks.json (repo + base_commit)
task_meta = {}
for it in json.load(open(f"{RES}/fp-codex-tab-20260826/sweet/tasks.json")):
    task_meta[it["instance_id"]] = it
def golden_dir(task):
    m = task_meta[task]; d = f"{GOLD}/{m['repo'].replace('/', '__')}@{m['base_commit']}"
    return d if os.path.isdir(d) else None
missing = [t for t in task_meta if not golden_dir(t)]
print("tasks:", len(task_meta), "goldens missing:", missing)

def norm_file(f):
    f = re.sub(r"^/root/\.ss-eval/runs/r\d+-\d+/", "", f); f = re.sub(r"^\.claude/worktrees/agent-[0-9a-f]+/", "", f); return f.lstrip("./")
def parse_read(op, d):
    p = op["prog"]; t = op["text"]
    if p == "ss-read":
        m = re.match(r"(?:\S*/)?ss-read\s+(?:--\S+\s+)*['\"]?([^\s'\"]+)['\"]?(?:\s+(\d+))?(?:\s+(\d+))?", t)
        if not m or m.group(1).startswith("-"): return None
        f, s, e = m.group(1), m.group(2), m.group(3)
        if s and e:
            s, e = int(s), int(e); e = e if e >= s else s + e
            return (f, s, e, "ss")
        return (f, 1, None, "ss")
    if p == "sed" and op["cap"] == "read.range":
        m = re.search(r"sed\s+-n\s+['\"]?(\d+),(\d+)p['\"]?\s+(\S+)", t)
        return (m.group(3), int(m.group(1)), int(m.group(2)), "native") if m else None
    if p in ("read", "Read") and op["cap"] == "read.range":
        i = d.get("in") or {}; f = i.get("filePath") or i.get("file_path") or (op["paths"][0] if op["paths"] else None)
        off = i.get("offset"); lim = i.get("limit")
        if f is None: return None
        return (f, off, off + lim - 1, "native") if isinstance(off, int) and isinstance(lim, int) else (f, 1, None, "native")
    return None

out = {}
# ---- 1. jump direction + outline payload sizing (sweet ss-read) ----
jd = {}
ent_cache = {}
def entity_count(task, f):
    g = golden_dir(task)
    if not g: return None
    key = (g, f)
    if key in ent_cache: return ent_cache[key]
    try:
        r = subprocess.run(["sqlite3", f"{g}/.sweet-search/code-graph.db", f"SELECT count(*), coalesce(sum(length(name)+length(coalesce(signature,''))),0) FROM entities WHERE file_path='{f}' AND stale_since IS NULL AND type IN ('function','class','method','interface','struct','enum','trait','impl','module','type');"], capture_output=True, text=True, timeout=30)
        parts = r.stdout.strip().split("|"); v = (int(parts[0]), int(parts[1])) if len(parts) == 2 and parts[0] else None
    except Exception: v = None
    ent_cache[key] = v; return v
for h in ("codex", "opencode", "claude-code"):
    up = down_out = down_in = 0; sizes = []; ent_counts = []; ent_chars = []; zero_ent = 0; files_seen = set()
    for key, lst in by_roll.items():
        if key[0] != h or key[1] != "sweet": continue
        seq = []
        for d in lst:
            if d.get("side"): continue
            for op in d["ops"]:
                r = parse_read(op, d)
                if r and r[3] == "ss": seq.append((d["i"], norm_file(r[0]), r[1], r[2], d.get("out") or ""))
        for idx, (ci, f, s, e, o) in enumerate(seq):
            if (key[2], f) not in files_seen and re.search(r"\.(py|js|ts|tsx|jsx|go|cs|java|rb|ex|exs|jam|sol|mjs|cjs)$", f):
                files_seen.add((key[2], f)); ec = entity_count(key[2], f)
                if ec is not None:
                    ent_counts.append(ec[0]); ent_chars.append(ec[1])
                    if ec[0] == 0: zero_ent += 1
            if e is None: continue
            nxt = [x for x in seq[idx + 1: idx + 4] if x[1] == f and x[3] is not None]
            if not nxt: continue
            s2, e2 = nxt[0][2], nxt[0][3]
            if s2 <= e and e2 >= s: continue
            if abs(s2 - (e + 1)) <= 5 or abs(s - (e2 + 1)) <= 5: continue
            if e2 < s: up += 1
            else:
                m = re.search(r"# unread below \((\d+)-(\d+)\)", o)
                if m and int(m.group(1)) <= s2 <= int(m.group(2)): down_in += 1
                else: down_out += 1
            sizes.append(e - s + 1)
    jd[h] = dict(jump_up=up, jump_down_inside_trailer_span=down_in, jump_down_outside=down_out, first_window_lines_median=statistics.median(sizes) if sizes else None,
                 files_with_entity_count=len(ent_counts), entities_per_read_file_median=statistics.median(ent_counts) if ent_counts else None, entities_p90=sorted(ent_counts)[int(0.9*(len(ent_counts)-1))] if ent_counts else None,
                 outline_chars_median=statistics.median(ent_chars) if ent_chars else None, outline_chars_p90=sorted(ent_chars)[int(0.9*(len(ent_chars)-1))] if ent_chars else None, files_with_zero_entities=zero_ent)
out["jump_direction_and_outline_size"] = jd
print("1", json.dumps(jd))

# ---- 2. run_tests targeted vs full output tokens ----
rt = {}
for h in ("codex", "opencode", "claude-code"):
    for arm in ("native", "sweet"):
        tgt = []; full = []; ign = 0; tgt_ok = 0
        for key, lst in by_roll.items():
            if key[0] != h or key[1] != arm: continue
            for d in lst:
                for op in d["ops"]:
                    if op["prog"] == "run_tests" and op["cap"] == "test":
                        m = re.match(r"run_tests\s+(\S.*)$", op["text"].strip()); o = d.get("out") or ""
                        if m and not m.group(1).startswith(("2>", "|", ">", "&", ";")):
                            tgt.append(d.get("tokOut") or 0)
                            if "ignored (" in o: ign += 1
                            else: tgt_ok += 1
                        else: full.append(d.get("tokOut") or 0)
        rt[f"{h}/{arm}"] = dict(targeted_calls=len(tgt), targeted_ignored_by_shim=ign, targeted_median_tokOut=statistics.median(tgt) if tgt else None, full_calls=len(full), full_median_tokOut=statistics.median(full) if full else None, full_mean_tokOut=round(statistics.mean(full),1) if full else None, targeted_mean_tokOut=round(statistics.mean(tgt),1) if tgt else None)
out["run_tests_targeted_vs_full"] = rt
print("2", json.dumps(rt))

# ---- 3. own-code zero probes in detail ----
def load_patch(h, task, rep):
    cands = []
    if h == "opencode": cands.append(f"{RES}/rp-oc-tab-20260827/sweet/" + ("patches.json" if rep == 0 else f"rep-{rep}/patches.json"))
    cands.append(f"{RES}/{RUN[h]}/sweet/" + ("patches.json" if rep == 0 else f"rep-{rep}/patches.json"))
    for c in cands:
        if os.path.exists(c):
            for it in json.load(open(c)):
                if it.get("instance_id") == task and it.get("patch"): return it["patch"]
    return None
repair = set(open("/root/fresh-run/repair-tasks.txt").read().split())
details = []; summary = collections.Counter()
for key, lst in by_roll.items():
    h, arm, task, rep = key
    if arm != "sweet": continue
    first_edit = next((d["i"] for d in lst if any(op["cap"] == "edit" for op in d["ops"])), None)
    if first_edit is None: continue
    patch = load_patch(h, task, rep)
    if not patch: continue
    added = "\n".join(ln[1:].strip() for ln in patch.splitlines() if ln.startswith("+") and not ln.startswith("+++"))
    edited_files = re.findall(r"^\+\+\+ b/(\S+)", patch, re.M)
    g = golden_dir(task)
    for idx, d in enumerate(lst):
        if d["i"] <= first_edit or d.get("side"): continue
        for op in d["ops"]:
            if op["prog"] in ("ss-grep", "ss-find") and op["cap"] in ("grep.literal", "grep.regex"):
                pat = op["pattern"] or ""; lit = re.sub(r"\\b|\\s\*|\\\(|\\\)", "", pat)
                toks = [t.strip() for t in re.split(r"\||\\\|", lit) if len(t.strip()) >= 4]
                own = [t for t in toks if t in added]
                if not own: continue
                o = d.get("out") or ""
                zero = bool(re.search(r"0 total match|\(no matches\)", o))
                if not zero: summary[(h, "own-code-probe-hit")] += 1; continue
                # base tree presence of the literal(s)
                in_base = None
                if g:
                    in_base = False
                    for t in own:
                        r = subprocess.run(["git", "-C", g, "grep", "-q", "-F", "-e", t, "HEAD", "--", "."], capture_output=True)
                        if r.returncode == 0: in_base = True; break
                scope = "--in" in op["text"]
                nxt = []
                for d2 in lst[idx + 1: idx + 4]:
                    kinds = [f"{op2['prog']}:{op2['cap']}" for op2 in d2["ops"] if op2["cap"] not in ("plan", "misc")]
                    if kinds: nxt.append(kinds)
                    if any(op2["cap"] in ("edit", "test") for op2 in d2["ops"]): break
                n_until_edit_or_test = 0
                for d2 in lst[idx + 1:]:
                    if any(op2["cap"] in ("edit", "test") for op2 in d2["ops"]) or d2["i"] == lst[-1]["i"]: break
                    n_until_edit_or_test += 1
                cls = "excluded-scope" if (scope and re.search(r"dist/|build/|\.jam|README|CHANGELOG|\.md", op["text"])) else ("pattern-in-base" if in_base else "new-code-not-in-base")
                summary[(h, cls)] += 1
                details.append(dict(h=h, task=task, rep=rep, call=d["i"], req=d["req"], text=op["text"][:160], own_literals=own[:3], in_base_tree=in_base, scoped=scope, cls=cls, next_calls=nxt, requests_until_edit_or_test=n_until_edit_or_test))
out["own_code_zero_probes"] = dict(summary={f"{k[0]}/{k[1]}": v for k, v in summary.items()}, details=details)
print("3", json.dumps(out["own_code_zero_probes"]["summary"]))
for x in details: print("   ", json.dumps(x))

# ---- 4. index path coverage per pool golden ----
cov = {}
ext_missing = collections.Counter(); dot_missing = collections.Counter()
for task, m in task_meta.items():
    g = golden_dir(task)
    if not g: continue
    tracked = subprocess.run(["git", "-C", g, "ls-files"], capture_output=True, text=True).stdout.split("\n")
    tracked = set(t for t in tracked if t)
    try:
        idx = subprocess.run(["sqlite3", f"{g}/.sweet-search/codebase.db", "SELECT DISTINCT file_path FROM vectors WHERE epoch_retired IS NULL;"], capture_output=True, text=True, timeout=60).stdout.split("\n")
    except Exception as e: idx = []
    idx = set(i for i in idx if i)
    miss = tracked - idx
    for f in miss:
        b = os.path.basename(f)
        if b.startswith("."): dot_missing[b] += 1
        ext = os.path.splitext(b)[1] or ("(dotfile)" if b.startswith(".") else "(noext)")
        ext_missing[ext] += 1
    cov[task] = dict(golden=os.path.basename(g), tracked=len(tracked), indexed=len(idx), indexed_not_tracked=len(idx - tracked), coverage_pct=round(100.0 * len(tracked & idx) / len(tracked), 1) if tracked else None,
                     missing_examples=sorted(list(miss))[:6])
out["index_path_coverage"] = dict(per_task=cov, missing_by_ext=ext_missing.most_common(25), missing_dotfiles=dot_missing.most_common(25))
print("4", json.dumps(out["index_path_coverage"]))

# ---- 5. dependency inspection ops both arms ----
deps = collections.Counter(); dep_ex = []
for d in rows:
    for op in d["ops"]:
        if op["cap"] == "deps":
            deps[(d["h"], d["arm"])] += 1
            if len(dep_ex) < 10: dep_ex.append(dict(h=d["h"], arm=d["arm"], task=d["task"], text=op["text"][:120]))
        elif any(p for p in op["paths"] if re.search(r"node_modules/|site-packages/|/vendor/|\.cargo/registry|/deps/|_build/", p)):
            deps[(d["h"], d["arm"], "dep-path-touch")] += 1
out["deps"] = dict(counts={"/".join(k): v for k, v in deps.items()}, examples=dep_ex)
print("5", json.dumps(out["deps"]))
json.dump(out, open(f"{OUT}/census2.json", "w"), indent=1)
