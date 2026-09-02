#!/usr/bin/env python3
"""analysis_extras.py -- follow-up queries over calls-classified.jsonl.gz.

  venv/bin/python analysis_extras.py calls-classified.jsonl.gz

Sections (each independent):
  A  sweet-arm native retrieval ops: main thread vs subagent, per harness; tokens; requests
  B  same, per task (is it the two b2 tasks whose gold lived under the then-excluded src/build/?)
  C  claude subagents: how were ss-* tools invoked (bare / absolute path / not found)?
  D  validation: codex native rg 'multi-pattern' tag -- sample and count patterns containing |
  E  repeated identical native Read calls in the sweet arm (degenerate re-reads) and their errors
  F  read-before-edit habit: native Read / ss-read followed by an Edit of the same file within 3 calls
  G  native-arm feature shares that ss-grep / ss-read do not offer (type filter, alternation, head cap,
     context lines, files-only, count, invert; open-ended / suffix / numbered / whole-file reads)
  H  turn-1 orientation: what is the FIRST tool call of each rollout, per harness and arm?
"""
import sys, gzip, json, collections, re, random

IN = sys.argv[1]
RET = {"grep.literal", "grep.regex", "read.range", "read.whole", "glob", "list"}
rows = [json.loads(l) for l in gzip.open(IN, "rt", encoding="utf8")]
rows = [r for r in rows if r["canon"]]
rows.sort(key=lambda r: (r["h"], r["task"], r["arm"], r["rep"], r["side"], r["i"]))
def rid(r): return f"{r['h']}/{r['task']}/{r['arm']}/rep{r['rep']}"
def subst(ops):
    s = [o for o in ops if o["cap"] != "misc"]
    return s if s else ops

print("=== A. sweet-arm native retrieval ops: main vs subagent [M]")
A = collections.defaultdict(lambda: {"ops": 0, "tok": 0.0, "rolls": set(), "reqs": set()})
for r in rows:
    if r["arm"] != "sweet": continue
    s = subst(r["ops"]); share = 1 / len(s)
    for o in r["ops"]:
        if o["via"] == "ss" or o["cap"] not in RET: continue
        k = (r["h"], "side" if r["side"] else "main", o["cap"])
        A[k]["ops"] += 1; A[k]["rolls"].add(rid(r)); A[k]["reqs"].add((rid(r), r["side"], r["req"]))
        if o in s: A[k]["tok"] += (r["tokIn"] + r["tokOut"]) * share
for k in sorted(A):
    v = A[k]; print(f"  {k}: ops={v['ops']} tokens={v['tok']:,.0f} rollouts={len(v['rolls'])} requests={len(v['reqs'])}")
tot = collections.defaultdict(lambda: [0, 0.0])
for (h, side, cap), v in A.items():
    tot[(h, side)][0] += v["ops"]; tot[(h, side)][1] += v["tok"]
print("  totals:", {f"{h}/{side}": (n, round(t)) for (h, side), (n, t) in sorted(tot.items())})
# sidechain share of sweet arm's total tool tokens and calls
sc = collections.defaultdict(lambda: [0, 0, 0, 0])
for r in rows:
    if r["arm"] != "sweet": continue
    sc[r["h"]][0 if not r["side"] else 1] += 1
    sc[r["h"]][2 if not r["side"] else 3] += r["tokIn"] + r["tokOut"]
print("  sweet arm calls main/side and tokens main/side:", dict(sc))
n_side_rolls = collections.Counter()
for r in rows:
    if r["arm"] == "sweet" and r["side"]: n_side_rolls[r["h"]] += 0
side_rolls = collections.defaultdict(set)
for r in rows:
    if r["side"]: side_rolls[(r["h"], r["arm"])].add(rid(r))
print("  rollouts with any subagent activity:", {f"{h}/{a}": len(v) for (h, a), v in sorted(side_rolls.items())})

print("\n=== B. sweet-arm native retrieval ops per task [M]")
B = collections.defaultdict(lambda: [0, 0.0])
for r in rows:
    if r["arm"] != "sweet": continue
    s = subst(r["ops"]); share = 1 / len(s)
    for o in r["ops"]:
        if o["via"] == "ss" or o["cap"] not in RET: continue
        B[(r["h"], r["task"])][0] += 1
        if o in s: B[(r["h"], r["task"])][1] += (r["tokIn"] + r["tokOut"]) * share
for h in ("codex", "opencode", "claude-code"):
    items = sorted(((t, v) for (hh, t), v in B.items() if hh == h), key=lambda x: -x[1][1])
    T = sum(v[1] for _, v in items) or 1
    print(f"  {h}: " + "; ".join(f"{t}: {v[0]} ops / {v[1]:,.0f} tok ({100*v[1]/T:.0f}%)" for t, v in items[:8]))
    b2 = sum(v[1] for t, v in items if t.startswith("bfgroup__b2"))
    print(f"     b2 share of fallback tokens: {100*b2/T:.0f}%  (b2-113 + b2-259)")

print("\n=== C. claude-code sweet subagents: how ss-* was invoked [M]")
C = collections.Counter(); notfound = collections.Counter(); ex = []
for r in rows:
    if r["h"] != "claude-code" or r["arm"] != "sweet" or not r.get("cmd"): continue
    cmd = r["cmd"]
    side = "side" if r["side"] else "main"
    if re.search(r"(^|[\s;&|(])ss-(?:grep|read|search|find|semantic|trace)\b", cmd): C[(side, "bare")] += 1
    if re.search(r"/bin/ss-(?:grep|read|search|find|semantic|trace)\b", cmd): C[(side, "absolute-path")] += 1
    if re.search(r"ss-\w+: command not found|ss-\w+: not found", r["out"] or ""):
        notfound[side] += 1
        if len(ex) < 6: ex.append((rid(r), r["i"], cmd[:100], (r["out"] or "")[:120]))
print("  invocations:", dict(C)); print("  'command not found' results:", dict(notfound))
for e in ex: print("   ", e)
# did the subagent prompt carry the guide? count Agent prompts mentioning ss-
ag = collections.Counter()
for r in rows:
    if r["h"] == "claude-code" and r["arm"] == "sweet" and r["tool"] == "Agent":
        p = json.dumps(r.get("in") or {})
        ag["mentions ss-" if "ss-" in p else "no ss- mention"] += 1
print("  sweet Agent() delegation prompts:", dict(ag))
# native-tool retrieval ops inside claude sweet subagents by whether that subagent EVER called ss-*
sub_used = collections.defaultdict(lambda: [False, 0, 0.0])
for r in rows:
    if r["h"] != "claude-code" or r["arm"] != "sweet" or not r["side"]: continue
    k = (rid(r),)
    if any(o["via"] == "ss" for o in r["ops"]): sub_used[k][0] = True
    s = subst(r["ops"]); share = 1 / len(s)
    for o in r["ops"]:
        if o["via"] != "ss" and o["cap"] in RET:
            sub_used[k][1] += 1
            if o in s: sub_used[k][2] += (r["tokIn"] + r["tokOut"]) * share
print("  claude sweet rollouts with subagents: ss-used? -> native retrieval ops / tokens")
for k, v in sorted(sub_used.items()): print(f"    {k[0]}: ss_used={v[0]} native_ret_ops={v[1]} tok={v[2]:,.0f}")

print("\n=== D. validation of multi-pattern tag on codex native rg [M]")
random.seed(3)
cx = [(r, o) for r in rows if r["h"] == "codex" and r["arm"] == "native" for o in r["ops"] if o["cap"].startswith("grep") and o["via"] == "native"]
mp = sum(1 for r, o in cx if "multi-pattern" in o["tags"])
pipe = sum(1 for r, o in cx if o.get("pattern") and re.search(r"(?<!\\)\|", o["pattern"]))
print(f"  codex native grep ops {len(cx)}; tagged multi-pattern {mp}; pattern contains unescaped | : {pipe}")
for r, o in random.sample(cx, 10): print("   ", o["tags"], "|", o["text"][:120])

print("\n=== E. repeated identical native reads in the sweet arm [M]")
E = collections.Counter(); Eex = []
for k, grp in collections.OrderedDict((k, [r for r in rows if rid(r) == k]) for k in sorted(set(rid(r) for r in rows if r["arm"] == "sweet"))).items():
    prev = None
    for r in grp:
        for o in r["ops"]:
            if o["via"] != "ss" and o["cap"].startswith("read"):
                key = o["text"]
                if key == prev:
                    E[r["h"]] += 1
                    if len(Eex) < 8: Eex.append((k, r["i"], r["err"], (r["out"] or "")[:160].replace("\n", " ")))
                prev = key
print("  identical consecutive native reads:", dict(E))
for e in Eex: print("   ", e)

print("\n=== F. read-before-edit: is a read followed by an Edit of the same file within 3 calls? (claude-code) [M]")
for arm in ("native", "sweet"):
    F = collections.Counter()
    for k in sorted(set(rid(r) for r in rows if r["h"] == "claude-code" and r["arm"] == arm)):
        seq = [r for r in rows if rid(r) == k and not r["side"]]
        for idx, r in enumerate(seq):
            for o in r["ops"]:
                if not o["cap"].startswith("read") or not o["paths"]: continue
                f = o["paths"][0].rsplit("/", 1)[-1]
                via = "ss-read" if o["via"] == "ss" else "native-Read"
                hit = any(any(oo["cap"] == "edit" and oo["paths"] and oo["paths"][0].rsplit("/", 1)[-1] == f for oo in seq[j]["ops"]) for j in range(idx + 1, min(idx + 4, len(seq))))
                F[(via, "edit-follows" if hit else "no-edit")] += 1
    print(f"  {arm}: {dict(F)}")
# Edits with NO prior native Read of that file at all (sweet arm): how many were preceded only by ss-read?
G = collections.Counter()
for k in sorted(set(rid(r) for r in rows if r["h"] == "claude-code" and r["arm"] == "sweet")):
    seq = [r for r in rows if rid(r) == k and not r["side"]]
    seen_native, seen_ss = set(), set()
    for r in seq:
        for o in r["ops"]:
            if o["cap"].startswith("read") and o["paths"]:
                (seen_ss if o["via"] == "ss" else seen_native).add(o["paths"][0].rsplit("/", 1)[-1])
            if o["cap"] == "edit" and o["paths"]:
                f = o["paths"][0].rsplit("/", 1)[-1]
                G["native Read before" if f in seen_native else ("ss-read only" if f in seen_ss else "no read at all")] += 1
print("  sweet claude-code Edits by what preceded them:", dict(G))

print("\n=== G. native-arm feature shares [M]")
for h in ("codex", "opencode", "claude-code"):
    g = [o for r in rows if r["h"] == h and r["arm"] == "native" for o in r["ops"] if o["cap"].startswith("grep")]
    rd = [o for r in rows if r["h"] == h and r["arm"] == "native" for o in r["ops"] if o["cap"].startswith("read")]
    def share(ops, tag): return f"{sum(1 for o in ops if tag in o['tags'])}/{len(ops)}"
    print(f"  {h} grep ops {len(g)}: multi-pattern {share(g,'multi-pattern')}, type-filter {share(g,'type-filter')}, head-limited {share(g,'head-limited')}, ctx {share(g,'ctx')}, files-only {share(g,'files-only')}, count {share(g,'count')}, invert {share(g,'invert')}, icase {share(g,'icase')}, word {share(g,'word')}, defn {share(g,'defn')}, scoped {share(g,'scoped')}, unscoped(repo-wide) {sum(1 for o in g if 'scoped' not in o['tags'])}")
    print(f"  {h} read ops {len(rd)}: whole-file {sum(1 for o in rd if o['cap']=='read.whole')}, range {sum(1 for o in rd if o['cap']=='read.range')}, open-ended {share(rd,'open-ended')}, suffix {share(rd,'suffix')}, prefix {share(rd,'prefix')}, numbered {share(rd,'numbered')}, by-pattern {share(rd,'by-pattern')}, manifest {share(rd,'manifest')}, dep-path {share(rd,'dep-path')}, build-path {share(rd,'build-path')}")
    # opencode/claude read tool window sizes
    if h in ("opencode", "claude-code"):
        lims = []
        for r in rows:
            if r["h"] == h and r["arm"] == "native" and r["tool"] in ("read", "Read"):
                inp = r["in"] or {}
                if "limit" in inp:
                    try: lims.append(int(inp["limit"]))
                    except Exception: pass
        lims.sort()
        if lims: print(f"  {h} native read-tool limit: n={len(lims)} p50={lims[len(lims)//2]} p90={lims[int(len(lims)*.9)]} max={lims[-1]}")
    if h == "codex":
        spans = []
        for r in rows:
            if r["h"] == h and r["arm"] == "native":
                for o in r["ops"]:
                    if o["sub"] == "sed-n":
                        m = re.search(r"(\d+),(\d+)p", o["text"])
                        if m: spans.append(int(m.group(2)) - int(m.group(1)) + 1)
        spans.sort()
        if spans: print(f"  codex native sed -n span lines: n={len(spans)} p50={spans[len(spans)//2]} p90={spans[int(len(spans)*.9)]} max={spans[-1]}")

print("\n=== H. first tool call of each rollout (main thread) [M]")
H = collections.defaultdict(collections.Counter)
for k in sorted(set(rid(r) for r in rows)):
    seq = [r for r in rows if rid(r) == k and not r["side"]]
    if not seq: continue
    r = seq[0]
    o = subst(r["ops"])[0]
    H[(r["h"], r["arm"])][f"{o['cap']}/{o['sub']}"] += 1
for k, c in sorted(H.items()): print(f"  {k}: {dict(c.most_common(6))}")
