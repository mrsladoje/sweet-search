#!/usr/bin/env python3
"""report_gaps.py -- capability census, sweet-arm native-fallback ranking, and the
same-pattern / same-file re-check census over calls-classified.jsonl.gz.

  venv/bin/python report_gaps.py calls-classified.jsonl.gz OUTDIR

Writes OUTDIR/gaps-summary.json, OUTDIR/same-pattern-cases.jsonl, OUTDIR/same-file-cases.jsonl,
OUTDIR/gap-examples.jsonl and prints Markdown tables.

Token attribution: a call's (tokIn + tokOut) is split evenly over its substantive ops
(ops whose cap is not misc); a call with only misc ops gives its tokens to those ops.
Pricing [I]: per ingested token = (0.10 + 0.01 * resend_factor) / 1e6 USD, resend factors from
BRIEF.md section 1.1 (codex sweet 15.9, opencode sweet 15.0, claude sweet 20.1; native 14.3 /
12.4 / 21.4). Per request = sum(costRealizedUsd)/sum(idealTurns) of the cell's rollouts that
carry both numbers.
"""
import sys, os, re, json, gzip, collections

IN, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
RESEND = {("codex", "sweet"): 15.9, ("codex", "native"): 14.3, ("opencode", "sweet"): 15.0, ("opencode", "native"): 12.4,
          ("claude-code", "sweet"): 20.1, ("claude-code", "native"): 21.4}
def tok_price(h, arm):
    return (0.10 + 0.01 * RESEND[(h, arm)]) / 1e6

GAP_CAPS = ["grep.literal", "grep.regex", "read.range", "read.whole", "glob", "list", "deps", "symbol", "git.history", "git.state", "git.other", "runtime", "misc"]
RETRIEVAL_CAPS = {"grep.literal", "grep.regex", "read.range", "read.whole", "glob", "list", "deps", "symbol", "search.semantic"}
ABSENT_FEATURES = {
    "grep.literal": ["ctx", "files-only", "count", "invert", "type-filter", "dep-path", "build-path", "only-matching", "max-count", "multiline", "over-glob", "piped-from-read"],
    "grep.regex": ["ctx", "files-only", "count", "invert", "type-filter", "dep-path", "build-path", "only-matching", "max-count", "multiline", "over-glob", "piped-from-read", "pcre"],
    "read.range": ["open-ended", "suffix", "by-pattern", "dep-path", "build-path", "numbered", "awk"],
    "read.whole": ["multi-file", "glob-arg", "dep-path", "build-path", "manifest"],
    "glob": ["*"], "list": ["*"], "deps": ["*"], "git.history": ["*"], "git.state": ["*"], "git.other": ["*"], "runtime": ["*"], "symbol": ["*"],
    "misc": ["count", "line-count", "probe-tool", "fs-probe", "diff"],
}
BAD_SS = re.compile(r"\[ss-\*\] crash|regex parse error|\[ss\] |Usage: ss-|not consumed|unrecognised option|stat failed: ENOENT|\(not indexed|0 total match\(es\)|\(no matches\)|No indexed symbol|\[ss-read\] error|\[ss-\w+\] error|file not indexed")

def load():
    rows = []
    for line in gzip.open(IN, "rt", encoding="utf8"):
        r = json.loads(line)
        if r["canon"]:
            rows.append(r)
    return rows

def rid(r):
    return f"{r['h']}/{r['task']}/{r['arm']}/rep{r['rep']}"

def callkey(r):
    return f"{rid(r)}/call{r['i']}" + ("s" if r["side"] else "")

def substantive(ops):
    s = [o for o in ops if o["cap"] != "misc"]
    return s if s else ops

def ss_grep_outcome(out, pat):
    """Classify what an ss-grep / ss-find call returned for pattern `pat`."""
    o = out or ""
    res = {"banner": None, "n": None, "kind": None, "truncated": ("Warning: truncated output" in o[:800]) or ("tokens truncated" in o)}
    if re.search(r"\[ss-\*\] crash|regex parse error", o):
        res["kind"] = "crash"
    elif re.search(r"\[ss\] .*(?:not consumed|unrecognised option)|Usage: ss-grep|Usage: ss-find", o):
        res["kind"] = "usage-error"
    best = None
    for m in re.finditer(r"^# ss-grep: (\d+) total match\(es\) for /(.*?)/(.*)$", o, re.M):
        n, bpat, rest = int(m.group(1)), m.group(2), m.group(3)
        if pat is None or bpat == pat or pat in bpat or bpat in pat or re.sub(r"\\", "", bpat) == re.sub(r"\\", "", pat or ""):
            best = (n, bpat, rest, m.end())
            break
        if best is None:
            best = (n, bpat, rest, m.end())
    if best is None:
        for m in re.finditer(r"^# ss-find: ColGrep (\d+) for \"(.*?)\"", o, re.M):
            best = (int(m.group(1)), m.group(2), "", m.end())
            break
    if best:
        n, bpat, rest, end = best
        res["banner"] = bpat
        res["n"] = n
        tail = o[end:end + 400]
        if n == 0:
            res["kind"] = "not-indexed" if "(not indexed" in tail else "zero"
        elif res["kind"] is None:
            res["kind"] = "hits"
        if "scope:" in rest:
            res["scoped"] = True
    if res["kind"] is None:
        res["kind"] = "no-banner"
    return res

def ss_read_outcome(out, f):
    o = out or ""
    if re.search(r"stat failed: ENOENT", o): return "enoent"
    if re.search(r"\[unchanged reread omitted", o): return "unchanged-omitted"
    if re.search(rf"^# ss-read {re.escape(f or '')}", o, re.M): return "ok" if o.strip() else "empty"
    if not o.strip(): return "empty"
    if "Warning: truncated output" in o[:800]: return "truncated"
    return "ok" if "# ss-read" in o else "no-banner"

def norm_pat(p):
    if p is None: return ""
    p = p.strip().strip("\"'")
    p = p.replace("\\|", "|")
    p = re.sub(r"\(\?i\)", "", p)
    p = p.replace("[[:space:]]", " ").replace("\\s", " ").replace("\\b", "").replace("\\B", "")
    p = re.sub(r"\\([().\[\]{}+*?^$|/<>\-\"'])", r"\1", p)
    p = re.sub(r"^\^|\$$", "", p)
    p = re.sub(r"\s+", " ", p).strip()
    return p

def main():
    rows = load()
    rows.sort(key=lambda r: (r["h"], r["task"], r["arm"], r["rep"], r["side"], r["i"]))
    by_roll = collections.defaultdict(list)
    for r in rows:
        by_roll[(r["h"], r["task"], r["arm"], r["rep"])].append(r)
    # ---------------- cell economics
    cell = collections.defaultdict(lambda: {"cost": 0.0, "reqs": 0, "n": 0, "n_all": 0})
    for k, rs in by_roll.items():
        h, task, arm, rep = k
        c = cell[(h, arm)]
        c["n_all"] += 1
        r0 = rs[0]
        if r0["cost"] is not None and r0["reqs"]:
            c["cost"] += r0["cost"]; c["reqs"] += r0["reqs"]; c["n"] += 1
    req_price = {k: (v["cost"] / v["reqs"] if v["reqs"] else None) for k, v in cell.items()}
    # ---------------- census
    census = collections.defaultdict(lambda: collections.defaultdict(lambda: {"ops": 0, "calls": 0, "tok": 0.0, "tokIn": 0.0, "tokOut": 0.0, "rollouts": set(), "subs": collections.Counter(), "tags": collections.Counter()}))
    arm_tok = collections.Counter()
    for r in rows:
        subs = substantive(r["ops"])
        share = 1.0 / len(subs)
        arm_tok[(r["h"], r["arm"])] += r["tokIn"] + r["tokOut"]
        for o in r["ops"]:
            via = "ss" if o["via"] == "ss" else "native"
            c = census[(r["h"], r["arm"])][(o["cap"], via)]
            c["ops"] += 1
            c["rollouts"].add(rid(r))
            c["subs"][o["sub"]] += 1
            for t in o["tags"]: c["tags"][t] += 1
            if o in subs:
                c["tok"] += (r["tokIn"] + r["tokOut"]) * share
                c["tokIn"] += r["tokIn"] * share
                c["tokOut"] += r["tokOut"] * share
        p = subs[0]
        census[(r["h"], r["arm"])][(p["cap"], "ss" if p["via"] == "ss" else "native")]["calls"] += 1
    # ---------------- sweet-arm gap attribution
    gaps = collections.defaultdict(lambda: collections.defaultdict(lambda: {"ops": 0, "tok": 0.0, "rollouts": set(), "attr": collections.Counter(), "feat": collections.Counter(), "reqs": set(), "sole_reqs": set(), "examples": [], "progs": collections.Counter()}))
    same_pat, same_file = [], []
    req_ops = collections.defaultdict(list)  # (rollout, side, req) -> ops via
    for k, rs in by_roll.items():
        h, task, arm, rep = k
        for r in rs:
            for o in r["ops"]:
                req_ops[(k, r["side"], r["req"])].append(("ss" if o["via"] == "ss" else "native", o["cap"]))
    sole_native_reqs = collections.Counter()
    for (k, side, req), lst in req_ops.items():
        h, task, arm, rep = k
        subst = [x for x in lst if x[1] != "misc"] or lst
        if arm == "sweet" and all(v == "native" and c in RETRIEVAL_CAPS for v, c in subst):
            sole_native_reqs[h] += 1
    for k, rs in by_roll.items():
        h, task, arm, rep = k
        if arm != "sweet":
            continue
        # per side sequences
        for side in (False, True):
            seq = [r for r in rs if r["side"] == side]
            ss_greps, ss_reads = [], []  # (idx, op, outcome)
            for idx, r in enumerate(seq):
                subs = substantive(r["ops"])
                share = 1.0 / len(subs)
                # record ss ops first? no -- a native op in the same envelope as an ss op is later in text order only if it appears later; keep envelope order: ss ops of THIS envelope are visible to later envelopes only.
                for o in r["ops"]:
                    if o["via"] == "ss":
                        continue
                    if o["cap"] not in GAP_CAPS:
                        continue
                    g = gaps[h][o["cap"]]
                    g["ops"] += 1
                    g["rollouts"].add(rid(r))
                    g["progs"][o["prog"] or o["sub"]] += 1
                    if o in subs:
                        g["tok"] += (r["tokIn"] + r["tokOut"]) * share
                    g["reqs"].add((rid(r), side, r["req"]))
                    if all((x["via"] != "ss") for x in subs):
                        g["sole_reqs"].add((rid(r), side, r["req"]))
                    # attribution
                    prior_fail = None
                    for back in range(1, 3):
                        if idx - back < 0: break
                        pr = seq[idx - back]
                        if any(x["via"] == "ss" for x in pr["ops"]) and (pr["err"] or (pr["exit"] not in (None, 0)) or BAD_SS.search(pr["out"] or "") or not (pr["out"] or "").strip()):
                            m = BAD_SS.search(pr["out"] or "")
                            prior_fail = (m.group(0) if m else ("exit" if pr["exit"] not in (None, 0) else ("error" if pr["err"] else "empty"))).strip()
                            break
                    feats = [t for t in o["tags"] if t in ABSENT_FEATURES.get(o["cap"], [])]
                    if ABSENT_FEATURES.get(o["cap"]) == ["*"]:
                        feats = [o["cap"]]
                    if prior_fail:
                        attr = "after-ss-failure"
                        g["feat"][prior_fail[:40]] += 1
                    elif feats:
                        attr = "feature-absent"
                        for f in feats: g["feat"][f] += 1
                    else:
                        attr = "plain-fallback"
                    g["attr"][attr] += 1
                    if len(g["examples"]) < 40:
                        g["examples"].append({"key": callkey(r), "attr": attr, "feats": feats, "prior": prior_fail, "text": o["text"][:200], "tok": round((r["tokIn"] + r["tokOut"]) * share), "resolved": r["resolved"]})
                    # same-pattern census for content greps
                    if o["cap"].startswith("grep") and o.get("pattern"):
                        np_ = norm_pat(o["pattern"])
                        best = None
                        for (jdx, so, soc) in ss_greps:
                            sp = norm_pat(so.get("pattern"))
                            if not sp or not np_:
                                continue
                            if sp == np_ or so.get("pattern") == o["pattern"]:
                                kind = "exact"
                            elif sp.lower() == np_.lower():
                                kind = "case"
                            elif (len(sp) >= 4 and len(np_) >= 4) and (sp.lower() in np_.lower() or np_.lower() in sp.lower()):
                                kind = "loose"
                            else:
                                continue
                            if best is None or (kind == "exact" and best["kind"] != "exact") or (best["kind"] == "loose" and kind != "loose"):
                                best = {"kind": kind, "ss_key": callkey(seq[jdx]), "ss_text": so["text"][:200], "ss_outcome": soc, "dist": idx - jdx, "ss_scopes": so["paths"]}
                        if best:
                            delta = sorted(set(o["tags"]) & {"ctx", "files-only", "count", "invert", "type-filter", "dep-path", "build-path", "only-matching", "max-count", "over-glob", "icase", "word", "scoped"})
                            same_pat.append({"h": h, "key": callkey(r), "resolved": r["resolved"], "raw_text": o["text"][:200], "raw_pattern": o["pattern"], "raw_paths": o["paths"][:3], "raw_delta": delta, **best})
                        else:
                            same_pat.append({"h": h, "key": callkey(r), "resolved": r["resolved"], "raw_text": o["text"][:200], "raw_pattern": o["pattern"], "raw_paths": o["paths"][:3], "kind": "none", "prior_ss_greps": len(ss_greps)})
                    if o["cap"].startswith("read") and o.get("paths"):
                        f = o["paths"][0]
                        base = f.rsplit("/", 1)[-1]
                        hit = None
                        for (jdx, so, soc) in ss_reads:
                            sf = (so["paths"] or [""])[0]
                            if sf and (sf == f or sf.endswith("/" + base) or f.endswith("/" + sf.rsplit("/", 1)[-1]) and sf.rsplit("/", 1)[-1] == base):
                                hit = {"ss_key": callkey(seq[jdx]), "ss_text": so["text"][:160], "ss_outcome": soc, "dist": idx - jdx}
                        if hit:
                            same_file.append({"h": h, "key": callkey(r), "resolved": r["resolved"], "raw_text": o["text"][:160], "cap": o["cap"], "tags": o["tags"], **hit})
                # after processing native ops of this envelope, register its ss ops for later envelopes
                for o in r["ops"]:
                    if o["via"] != "ss":
                        continue
                    if o["cap"].startswith("grep"):
                        ss_greps.append((idx, o, ss_grep_outcome(r["out"], o.get("pattern"))))
                    elif o["cap"].startswith("read"):
                        ss_reads.append((idx, o, ss_read_outcome(r["out"], (o["paths"] or [""])[0])))
    # ---------------- emit
    summary = {"cells": {f"{h}|{arm}": {"rollouts": v["n_all"], "priced_rollouts": v["n"], "usd_per_request": req_price[(h, arm)], "tool_tokens": arm_tok[(h, arm)]} for (h, arm), v in cell.items()},
               "census": {}, "gaps": {}, "sole_native_requests": dict(sole_native_reqs)}
    print("## Cell economics [M rows.json via extract-events]")
    print("| cell | rollouts | priced rollouts | $/request | tool tokens (in+out, o200k) |")
    print("|---|---:|---:|---:|---:|")
    for (h, arm), v in sorted(cell.items()):
        print(f"| {h} {arm} | {v['n_all']} | {v['n']} | {req_price[(h, arm)]:.6f} | {arm_tok[(h, arm)]:,} |")
    for (h, arm), caps in sorted(census.items()):
        n_roll = cell[(h, arm)]["n_all"]
        tot_tok = arm_tok[(h, arm)] or 1
        summary["census"][f"{h}|{arm}"] = {}
        print(f"\n## Capability census: {h} / {arm} (n={n_roll} rollouts) [M]")
        print("| capability | via | ops | ops/rollout | rollouts with | tokens (attributed) | share of arm tool tokens | top sub / tags |")
        print("|---|---|---:|---:|---:|---:|---:|---|")
        for (cap, via), c in sorted(caps.items(), key=lambda x: -x[1]["tok"]):
            tags = ", ".join(f"{t}:{n}" for t, n in c["tags"].most_common(6))
            subs = ", ".join(f"{s}:{n}" for s, n in c["subs"].most_common(4))
            print(f"| {cap} | {via} | {c['ops']} | {c['ops']/n_roll:.2f} | {len(c['rollouts'])} | {c['tok']:,.0f} | {100*c['tok']/tot_tok:.1f}% | {subs} — {tags} |")
            summary["census"][f"{h}|{arm}"][f"{cap}|{via}"] = {"ops": c["ops"], "calls_primary": c["calls"], "rollouts": len(c["rollouts"]), "tok": round(c["tok"]), "tokIn": round(c["tokIn"]), "tokOut": round(c["tokOut"]), "subs": dict(c["subs"].most_common(12)), "tags": dict(c["tags"].most_common(20))}
    print("\n## Sweet-arm capabilities still performed with raw shell / harness tools, ranked by attributed tokens [M] (prices [I])")
    ex_out = open(os.path.join(OUT, "gap-examples.jsonl"), "w")
    for h in ("codex", "opencode", "claude-code"):
        n_roll = cell[(h, "sweet")]["n_all"]
        rp = req_price[(h, "sweet")]
        tp = tok_price(h, "sweet")
        print(f"\n### {h} sweet (n={n_roll}; $/request {rp:.6f}; $/ingested token {tp*1e6:.3f}/M)")
        print("| capability | ops | rollouts | tokens | est. token $ / rollout | requests touched | sole-native requests | est. request $ / rollout | attribution | absent features / failure kinds | programs |")
        print("|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|")
        summary["gaps"][h] = {}
        for cap, g in sorted(gaps[h].items(), key=lambda x: -x[1]["tok"]):
            attr = ", ".join(f"{a}:{n}" for a, n in g["attr"].most_common())
            feat = ", ".join(f"{a}:{n}" for a, n in g["feat"].most_common(6))
            progs = ", ".join(f"{a}:{n}" for a, n in g["progs"].most_common(5))
            tok_usd = g["tok"] * tp / n_roll
            req_usd = len(g["sole_reqs"]) * rp / n_roll
            print(f"| {cap} | {g['ops']} | {len(g['rollouts'])} | {g['tok']:,.0f} | {tok_usd:.6f} | {len(g['reqs'])} | {len(g['sole_reqs'])} | {req_usd:.6f} | {attr} | {feat} | {progs} |")
            summary["gaps"][h][cap] = {"ops": g["ops"], "rollouts": len(g["rollouts"]), "tok": round(g["tok"]), "tok_usd_per_rollout": tok_usd, "requests": len(g["reqs"]), "sole_native_requests": len(g["sole_reqs"]), "req_usd_per_rollout": req_usd, "attr": dict(g["attr"]), "feat": dict(g["feat"].most_common(20)), "progs": dict(g["progs"].most_common(10))}
            for e in g["examples"]:
                ex_out.write(json.dumps({"h": h, "cap": cap, **e}, ensure_ascii=False) + "\n")
    ex_out.close()
    print("\n## Retrieval-fallback totals per harness (grep/read/glob/list performed by raw shell or harness tools in the sweet arm) [M tokens; I prices]")
    print("| harness | thread | ops | tokens | token $ / rollout | sole-native requests | request $ / rollout | sum $ / rollout | mean sweet $ / rollout | share |")
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    RET = {"grep.literal", "grep.regex", "read.range", "read.whole", "glob", "list"}
    for h in ("codex", "opencode", "claude-code"):
        n_roll = cell[(h, "sweet")]["n_all"]
        mean_cost = cell[(h, "sweet")]["cost"] / max(1, cell[(h, "sweet")]["n"])
        rp = req_price[(h, "sweet")]; tp = tok_price(h, "sweet")
        acc = {"main": {"ops": 0, "tok": 0.0, "sole": set()}, "side": {"ops": 0, "tok": 0.0, "sole": set()}}
        for k, rs in by_roll.items():
            if k[0] != h or k[2] != "sweet": continue
            for r in rs:
                subs = substantive(r["ops"]); share = 1.0 / len(subs)
                th = "side" if r["side"] else "main"
                for o in r["ops"]:
                    if o["via"] == "ss" or o["cap"] not in RET: continue
                    acc[th]["ops"] += 1
                    if o in subs: acc[th]["tok"] += (r["tokIn"] + r["tokOut"]) * share
                    if all(x["via"] != "ss" and x["cap"] in RET for x in subs): acc[th]["sole"].add((rid(r), r["side"], r["req"]))
        for th in ("main", "side"):
            a = acc[th]
            tu = a["tok"] * tp / n_roll; ru = len(a["sole"]) * rp / n_roll
            print(f"| {h} | {th} | {a['ops']} | {a['tok']:,.0f} | {tu:.6f} | {len(a['sole'])} | {ru:.6f} | {tu+ru:.6f} | {mean_cost:.6f} | {100*(tu+ru)/mean_cost:.1f}% |")
            summary.setdefault("fallback_totals", {})[f"{h}|{th}"] = {"ops": a["ops"], "tok": round(a["tok"]), "tok_usd_per_rollout": tu, "sole_requests": len(a["sole"]), "req_usd_per_rollout": ru, "sum_usd_per_rollout": tu + ru, "mean_sweet_cost": mean_cost, "share": (tu + ru) / mean_cost}
    # ---------------- same pattern census
    print("\n## Same-pattern re-grep census (sweet arm: raw grep/rg/harness grep whose pattern an earlier ss-grep/ss-find had already run) [M]")
    with open(os.path.join(OUT, "same-pattern-cases.jsonl"), "w") as fo:
        for c in same_pat:
            fo.write(json.dumps(c, ensure_ascii=False) + "\n")
    with open(os.path.join(OUT, "same-file-cases.jsonl"), "w") as fo:
        for c in same_file:
            fo.write(json.dumps(c, ensure_ascii=False) + "\n")
    for h in ("codex", "opencode", "claude-code"):
        cs = [c for c in same_pat if c["h"] == h]
        kinds = collections.Counter(c["kind"] for c in cs)
        matched = [c for c in cs if c["kind"] != "none"]
        outc = collections.Counter(c["ss_outcome"]["kind"] + ("+trunc" if c["ss_outcome"].get("truncated") else "") for c in matched)
        deltas = collections.Counter(tuple(c["raw_delta"]) for c in matched)
        rolls = len(set(c["key"].rsplit("/call", 1)[0] for c in matched))
        print(f"\n### {h}: raw content greps in sweet arm = {len(cs)}; pattern already run through ss-grep/ss-find: {kinds.get('exact',0)} exact + {kinds.get('case',0)} case-only + {kinds.get('loose',0)} substring = {len(matched)} in {rolls} rollouts; no prior ss pattern: {kinds.get('none',0)}")
        print(f"  ss result when it happened: {dict(outc)}")
        print(f"  raw grep feature delta: {dict(deltas)}")
        summary.setdefault("same_pattern", {})[h] = {"raw_greps": len(cs), "kinds": dict(kinds), "ss_outcomes": dict(outc), "deltas": {'+'.join(k) or '(none)': v for k, v in deltas.items()}, "rollouts": rolls}
        sf = [c for c in same_file if c["h"] == h]
        sfo = collections.Counter(c["ss_outcome"] for c in sf)
        print(f"  same-file re-read (native read of a file an earlier ss-read had shown): {len(sf)} in {len(set(c['key'].rsplit('/call',1)[0] for c in sf))} rollouts; ss-read outcome then: {dict(sfo)}")
        summary.setdefault("same_file", {})[h] = {"cases": len(sf), "outcomes": dict(sfo)}
    json.dump(summary, open(os.path.join(OUT, "gaps-summary.json"), "w"), indent=1, default=list)
    print("\nwrote", OUT)

if __name__ == "__main__":
    main()
