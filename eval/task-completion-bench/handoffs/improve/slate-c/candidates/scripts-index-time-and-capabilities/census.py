#!/usr/bin/env python3
"""Slate C / index-time-and-capabilities census over calls-classified.jsonl.gz.
Sections:
 A run_tests scoping (pattern argument use, output tokens)
 B outline falsifier: same-file follow-up reads (probe-then-jump) in both arms
 C filename-discovery demand (glob/list ops) both arms
 D test-locating probes and definition-shaped greps, both arms
 E post-edit lexical probes for the agent's own new code (stale-index exposure), sweet arm
Reads only; writes JSON + text under /tmp/wf-slatec/index-time-caps/.
"""
import gzip, json, re, sys, os, collections, statistics, itertools, glob as globmod
CORPUS = "/tmp/wf-slatec/native-capability-gaps/calls-classified.jsonl.gz"
OUT = "/tmp/wf-slatec/index-time-caps"
os.makedirs(OUT, exist_ok=True)
RES = "/root/sweet-search-private/eval/task-completion-bench/results"

rows = []
with gzip.open(CORPUS, "rt") as f:
    for line in f:
        d = json.loads(line)
        if not d.get("canon"):
            continue
        rows.append(d)
print("canonical calls:", len(rows))

by_roll = collections.defaultdict(list)
for d in rows:
    by_roll[(d["h"], d["arm"], d["task"], d["rep"])].append(d)
for k in by_roll:
    by_roll[k].sort(key=lambda d: d["i"])
print("rollouts:", len(by_roll), collections.Counter((k[0], k[1]) for k in by_roll))

def pct(a, b):
    return (100.0 * a / b) if b else float("nan")

def quant(xs, q):
    if not xs: return float("nan")
    xs = sorted(xs); i = min(len(xs) - 1, int(round(q * (len(xs) - 1))))
    return xs[i]

report = {}
txt = []

# ---------------- A. run_tests -------------------------------------------------
secA = {}
for (h, arm), grp in itertools.groupby(sorted(by_roll.items(), key=lambda kv: (kv[0][0], kv[0][1])), key=lambda kv: (kv[0][0], kv[0][1])):
    grp = list(grp)
    n_roll = len(grp)
    calls = 0; with_args = 0; args_ex = collections.Counter(); ignored = 0; applied_note = 0
    outs = []; tot_tool_out = 0; rt_out = 0
    per_roll_calls = []
    for key, lst in grp:
        c = 0
        for d in lst:
            tot_tool_out += d.get("tokOut") or 0
            for op in d["ops"]:
                if op["prog"] == "run_tests" and op["cap"] == "test":
                    calls += 1; c += 1
                    t = op["text"].strip()
                    m = re.match(r"run_tests\s+(.+)$", t)
                    if m and not m.group(1).startswith(("2>", "|", ">", "&", ";")):
                        with_args += 1; args_ex[m.group(1)[:60]] += 1
                    o = d.get("out") or ""
                    rt_out += d.get("tokOut") or 0
                    outs.append(d.get("tokOut") or 0)
                    if "ignored (" in o and "targeted pattern" in o: ignored += 1
                    if "targeted" in o and "applied" in o: applied_note += 1
        per_roll_calls.append(c)
    secA[f"{h}/{arm}"] = dict(rollouts=n_roll, run_tests_calls=calls, per_rollout=round(calls / n_roll, 2),
                            with_pattern_arg=with_args, pattern_examples=args_ex.most_common(8),
                            shim_said_pattern_ignored=ignored, tokOut_median=quant(outs, .5), tokOut_p90=quant(outs, .9),
                            tokOut_mean=round(statistics.mean(outs), 1) if outs else None, tokOut_sum=rt_out,
                            share_of_all_tool_out=round(pct(rt_out, tot_tool_out), 1))
report["A_run_tests"] = secA
txt.append("== A. run_tests scoping ==")
for k, v in secA.items(): txt.append(f"{k}: {json.dumps(v)}")

# ---------------- helpers for reads ----------------------------------------------
def parse_read(op, d):
    """Return (file, start, end, kind) for any windowed/whole read op, or None."""
    p = op["prog"]; t = op["text"]
    if p == "ss-read":
        m = re.match(r"(?:\S*/)?ss-read\s+(?:--\S+\s+)*['\"]?([^\s'\"]+)['\"]?(?:\s+(\d+))?(?:\s+(\d+))?", t)
        if not m: return None
        f, s, e = m.group(1), m.group(2), m.group(3)
        if f.startswith("-"): return None
        if s and e:
            s, e = int(s), int(e)
            if e < s: e = s + e  # count form
            return (f, s, e, "ss")
        return (f, 1, None, "ss")
    if p == "sed" and op["cap"] == "read.range":
        m = re.search(r"sed\s+-n\s+['\"]?(\d+),(\d+)p['\"]?\s+(\S+)", t)
        if m: return (m.group(3), int(m.group(1)), int(m.group(2)), "native")
        return None
    if p in ("read", "Read") and op["cap"] == "read.range":
        i = d.get("in") or {}
        f = i.get("filePath") or i.get("file_path") or (op["paths"][0] if op["paths"] else None)
        off = i.get("offset"); lim = i.get("limit")
        if f is None: return None
        if isinstance(off, int) and isinstance(lim, int):
            return (f, off, off + lim - 1, "native")
        return (f, 1, None, "native")
    if p in ("cat", "nl") and op["cap"] in ("read.whole", "read.range"):
        if op["paths"]:
            return (op["paths"][0], 1, None, "native")
    return None

def norm_file(f):
    f = re.sub(r"^/root/\.ss-eval/runs/r\d+-\d+/", "", f)
    f = re.sub(r"^\.claude/worktrees/agent-[0-9a-f]+/", "", f)
    return f.lstrip("./")

# ---------------- B. outline falsifier ------------------------------------------
secB = {}
examples_B = []
for (h, arm), grp in itertools.groupby(sorted(by_roll.items(), key=lambda kv: (kv[0][0], kv[0][1])), key=lambda kv: (kv[0][0], kv[0][1])):
    grp = list(grp); n_roll = len(grp)
    reads = 0; ranged = 0; whole = 0
    followup_same_file = 0; jump = 0; contig = 0; overlap = 0; jump_within_trailer = 0; jump_named_by_trailer = 0
    trailer_present = 0
    distinct_files_multi_read = 0; files_read_total = 0
    reads_per_file_hist = collections.Counter()
    whole_out_tokens = []
    for key, lst in grp:
        seq = []  # (call_index, file, s, e, out, tokOut, kind)
        for d in lst:
            if d.get("side"): continue  # main thread only for read sequences
            for op in d["ops"]:
                r = parse_read(op, d)
                if not r: continue
                f, s, e, kind = r
                if kind == "ss" and arm != "sweet": continue
                if kind == "native" and arm != "native": continue
                seq.append((d["i"], norm_file(f), s, e, d.get("out") or "", d.get("tokOut") or 0))
        per_file = collections.Counter(x[1] for x in seq)
        files_read_total += len(per_file)
        distinct_files_multi_read += sum(1 for v in per_file.values() if v >= 2)
        for v in per_file.values(): reads_per_file_hist[min(v, 6)] += 1
        for idx, (ci, f, s, e, out, tok) in enumerate(seq):
            reads += 1
            if e is None:
                whole += 1; whole_out_tokens.append(tok); continue
            ranged += 1
            # look ahead: next 3 reads
            nxt = [x for x in seq[idx + 1: idx + 4] if x[1] == f]
            if not nxt: continue
            followup_same_file += 1
            f2 = nxt[0]; s2, e2 = f2[2], f2[3]
            if e2 is None:
                continue
            if s2 <= e and e2 >= s:
                overlap += 1
            elif abs(s2 - (e + 1)) <= 5 or abs(s - (e2 + 1)) <= 5:
                contig += 1
            else:
                jump += 1
                m = re.search(r"# unread below \((\d+)-(\d+)\)(?::\s*([^\n]*?))?\s*(?:—|-)\s*continue", out)
                if m:
                    trailer_present += 1
                    a, b = int(m.group(1)), int(m.group(2))
                    if a <= s2 <= b: jump_within_trailer += 1
                    names = (m.group(3) or "")
                    if names.strip(): jump_named_by_trailer += 1
                if len(examples_B) < 12:
                    examples_B.append(dict(h=h, arm=arm, task=key[2], rep=key[3], call=ci, file=f, first=(s, e), then=(s2, e2), trailer=bool(m)))
    secB[f"{h}/{arm}"] = dict(rollouts=n_roll, reads=reads, ranged=ranged, whole=whole, reads_per_rollout=round(reads / n_roll, 2),
                            followup_same_file_within3=followup_same_file, overlap=overlap, contiguous=contig, jump=jump,
                            jump_share_of_ranged_pct=round(pct(jump, ranged), 1), jump_per_rollout=round(jump / n_roll, 2),
                            jump_first_read_had_unread_trailer=trailer_present, jump_target_inside_trailer_span=jump_within_trailer,
                            files_read=files_read_total, files_read_twice_or_more=distinct_files_multi_read,
                            reads_per_file_hist=dict(sorted(reads_per_file_hist.items())),
                            whole_read_tokOut_median=quant(whole_out_tokens, .5), whole_read_tokOut_p90=quant(whole_out_tokens, .9))
report["B_outline"] = dict(cells=secB, examples=examples_B)
txt.append("\n== B. same-file follow-up reads (main thread) ==")
for k, v in secB.items(): txt.append(f"{k}: {json.dumps(v)}")

# ---------------- C. filename discovery -----------------------------------------
secC = {}; glob_ops = []
for (h, arm), grp in itertools.groupby(sorted(by_roll.items(), key=lambda kv: (kv[0][0], kv[0][1])), key=lambda kv: (kv[0][0], kv[0][1])):
    grp = list(grp); n_roll = len(grp)
    n_glob = 0; n_list = 0; rolls_with = 0; first_call_glob = 0; toks = 0; sole = 0
    for key, lst in grp:
        had = False
        for d in lst:
            caps = [op["cap"] for op in d["ops"]]
            gl = [op for op in d["ops"] if op["cap"] in ("glob", "list")]
            if gl:
                had = True
                toks += d.get("tokOut") or 0
                if all(c in ("glob", "list", "misc") for c in caps): sole += 1
                for op in gl:
                    if op["cap"] == "glob": n_glob += 1
                    else: n_list += 1
                    glob_ops.append(dict(h=h, arm=arm, task=key[2], rep=key[3], call=d["i"], req=d["req"], side=d.get("side"), cap=op["cap"], prog=op["prog"], text=op["text"], pattern=op["pattern"], paths=op["paths"], inp=d.get("in"), tokOut=d.get("tokOut")))
        if had: rolls_with += 1
        subst = [d for d in lst if any(op["cap"] not in ("plan", "misc") for op in d["ops"])]
        if subst and any(op["cap"] in ("glob", "list") for op in subst[0]["ops"]): first_call_glob += 1
    secC[f"{h}/{arm}"] = dict(rollouts=n_roll, glob_ops=n_glob, list_ops=n_list, per_rollout=round((n_glob + n_list) / n_roll, 2),
                            rollouts_with_any=rolls_with, first_substantive_call_is_glob_or_list=first_call_glob, tokOut_sum=toks, sole_glob_requests=sole)
report["C_glob"] = secC
with open(f"{OUT}/glob-ops.jsonl", "w") as f:
    for g in glob_ops: f.write(json.dumps(g) + "\n")
txt.append("\n== C. filename discovery / listing ops ==")
for k, v in secC.items(): txt.append(f"{k}: {json.dumps(v)}")

# ---------------- D. test-locating probes & definition-shaped greps ---------------
TESTPATH = re.compile(r"(^|/)(tests?|spec|specs|__tests__|test_[^/]*|[^/]*_test\.[a-z]+|[^/]*\.test\.[a-z]+|[^/]*\.spec\.[a-z]+|[^/]*Tests?\.[a-z]+)(/|$)", re.I)
def is_testy(path):
    return bool(TESTPATH.search(norm_file(path)))
secD = {}
for (h, arm), grp in itertools.groupby(sorted(by_roll.items(), key=lambda kv: (kv[0][0], kv[0][1])), key=lambda kv: (kv[0][0], kv[0][1])):
    grp = list(grp); n_roll = len(grp)
    test_reads_pre = 0; test_reads_post = 0; test_scoped_greps = 0; defn_greps = 0; greps = 0
    rolls_test_read_pre = 0; test_hit_greps = 0
    for key, lst in grp:
        first_edit = next((d["i"] for d in lst if any(op["cap"] == "edit" for op in d["ops"])), None)
        had_pre = False
        for d in lst:
            if d.get("side"): continue
            for op in d["ops"]:
                if op["cap"] in ("read.range", "read.whole"):
                    r = parse_read(op, d)
                    if r and is_testy(r[0]):
                        if first_edit is None or d["i"] < first_edit: test_reads_pre += 1; had_pre = True
                        else: test_reads_post += 1
                if op["cap"] in ("grep.literal", "grep.regex", "search.semantic"):
                    greps += 1
                    if "defn" in op["tags"]: defn_greps += 1
                    if "test-path" in op["tags"] or any(is_testy(p) for p in op["paths"]): test_scoped_greps += 1
                    o = d.get("out") or ""
                    hits = re.findall(r"(?m)^([^\s:]+\.[A-Za-z0-9]+):\d+", o)
                    if hits and any(is_testy(x) for x in hits): test_hit_greps += 1
        if had_pre: rolls_test_read_pre += 1
    secD[f"{h}/{arm}"] = dict(rollouts=n_roll, test_file_reads_before_first_edit=test_reads_pre, per_rollout=round(test_reads_pre / n_roll, 2),
                            rollouts_reading_a_test_before_edit=rolls_test_read_pre, test_file_reads_after_first_edit=test_reads_post,
                            greps=greps, test_scoped_greps=test_scoped_greps, greps_returning_test_paths=test_hit_greps, definition_shaped_greps=defn_greps)
report["D_tests"] = secD
txt.append("\n== D. test-locating probes ==")
for k, v in secD.items(): txt.append(f"{k}: {json.dumps(v)}")

# ---------------- E. post-edit own-code lexical probes (sweet) --------------------
def load_patch(h, task, rep, arm):
    run = {"codex": "fp-codex-tab-20260826", "opencode": "fp-opencode-tab-20260826", "claude-code": "fp-claudecode-tab-20260826"}[h]
    cands = [os.path.join(RES, run, arm, "patches.json" if rep == 0 else f"rep-{rep}/patches.json")]
    if h == "opencode" and arm == "sweet":
        cands.insert(0, os.path.join(RES, "rp-oc-tab-20260827", arm, "patches.json" if rep == 0 else f"rep-{rep}/patches.json"))
    for c in cands:
        if os.path.exists(c):
            try:
                for it in json.load(open(c)):
                    if it.get("instance_id") == task and it.get("patch"):
                        return it["patch"], c
            except Exception as e:
                pass
    return None, None

repair = set(open("/root/fresh-run/repair-tasks.txt").read().split())
secE = {}; exE = []
for h in ("codex", "opencode", "claude-code"):
    n_roll = 0; post_lex = 0; own_code = 0; own_zero = 0; own_hits = 0; own_unknown = 0; no_patch = 0
    for key, lst in by_roll.items():
        if key[0] != h or key[1] != "sweet": continue
        n_roll += 1
        first_edit = next((d["i"] for d in lst if any(op["cap"] == "edit" for op in d["ops"])), None)
        if first_edit is None: continue
        patch, src = load_patch(h, key[2], key[3], "sweet")
        if h == "opencode" and key[2] in repair:
            # sweet repair rows come from rp run
            pass
        added = set()
        if patch:
            for ln in patch.splitlines():
                if ln.startswith("+") and not ln.startswith("+++"):
                    added.add(ln[1:].strip())
        else:
            no_patch += 1
        added_text = "\n".join(added)
        for d in lst:
            if d["i"] <= first_edit or d.get("side"): continue
            for op in d["ops"]:
                if op["prog"] in ("ss-grep", "ss-find") and op["cap"] in ("grep.literal", "grep.regex"):
                    post_lex += 1
                    pat = op["pattern"] or ""
                    lit = re.sub(r"\\b|\\s\*|\\\(|\\\)", "", pat)
                    if not pat or not added_text: continue
                    toks = [t for t in re.split(r"\||\\\|", lit) if len(t.strip()) >= 4]
                    if any(t.strip() in added_text for t in toks):
                        own_code += 1
                        o = d.get("out") or ""
                        if re.search(r"0 total match|\(no matches\)|no matches", o): own_zero += 1
                        elif re.search(r"\d+ total match", o): own_hits += 1
                        else: own_unknown += 1
                        if len(exE) < 15: exE.append(dict(h=h, task=key[2], rep=key[3], call=d["i"], text=op["text"][:140], result=("zero" if re.search(r"0 total match|no matches", o) else "hits/other")))
    secE[h] = dict(sweet_rollouts=n_roll, post_edit_lexical_ss_calls=post_lex, pattern_in_own_added_lines=own_code, of_which_zero=own_zero, of_which_hits=own_hits, unknown=own_unknown, rollouts_without_patch_file=no_patch)
report["E_stale"] = dict(cells=secE, examples=exE)
txt.append("\n== E. post-edit ss-grep/ss-find whose pattern is in the agent's own added lines ==")
for k, v in secE.items(): txt.append(f"{k}: {json.dumps(v)}")
txt.append("examples: " + json.dumps(exE)[:3000])

json.dump(report, open(f"{OUT}/census.json", "w"), indent=1)
open(f"{OUT}/census.txt", "w").write("\n".join(txt))
print("\n".join(txt))
