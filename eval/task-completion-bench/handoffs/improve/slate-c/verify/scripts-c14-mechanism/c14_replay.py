#!/usr/bin/env python3
"""c14 mechanism verify: replay fp-claudecode-tab-20260826 per-request usage from raw
Claude transcripts, row-matched, and re-price under several vectors.
READ-ONLY on results/. Writes only under /tmp/wf-slatec/c14-mechanism/.
"""
import json, os, glob, re, sys, collections
RUN = "/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826"
OUT = "/tmp/wf-slatec/c14-mechanism"
os.makedirs(OUT, exist_ok=True)
rows = json.load(open(os.path.join(RUN, "rows.json")))

LUNA = dict(inp=0.10, cr=0.01, out=0.60)

def parse_file(path, allow_sidechain=False):
    """Return dict: requests (ordered list of usage-bearing requests), tool_uses, failures."""
    by_id = collections.OrderedDict()
    tool_use_owner = {}     # tool_use_id -> (msg_id, name, input)
    failed_pages = set()    # tool_use_ids whose result says Invalid pages parameter
    is_error_ids = set()
    agent_links = {}        # tool_use_id -> toolUseResult (for Agent calls)
    side_inline = 0
    ttl5 = ttl1 = 0
    for line in open(path, errors="replace"):
        try:
            rec = json.loads(line)
        except Exception:
            continue
        m = rec.get("message") or {}
        if rec.get("isSidechain") and not allow_sidechain:
            side_inline += 1
            continue
        c = m.get("content")
        if m.get("role") == "assistant" and m.get("id"):
            g = by_id.get(m["id"])
            if g is None:
                g = dict(id=m["id"], usage=None, best=-1, tool_uses=[], model=m.get("model"), ts=rec.get("timestamp"))
                by_id[m["id"]] = g
            if isinstance(c, list):
                for b in c:
                    if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("id"):
                        if b["id"] not in tool_use_owner:
                            tool_use_owner[b["id"]] = (m["id"], b.get("name"), b.get("input") or {})
                            g["tool_uses"].append(b["id"])
            u = m.get("usage")
            if u:
                cr = u.get("cache_read_input_tokens") or 0
                cw = u.get("cache_creation_input_tokens") or 0
                inp = u.get("input_tokens") or 0
                out = u.get("output_tokens") or 0
                tot = inp + cr + cw + out
                cc = u.get("cache_creation") or {}
                if tot > g["best"]:
                    g["best"] = tot
                    g["usage"] = dict(inp=inp, cr=cr, cw=cw, out=out,
                                      ttl5=cc.get("ephemeral_5m_input_tokens") or 0,
                                      ttl1=cc.get("ephemeral_1h_input_tokens") or 0)
        if m.get("role") == "user" and isinstance(c, list):
            for b in c:
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    txt = b.get("content")
                    s = json.dumps(txt) if not isinstance(txt, str) else txt
                    if "Invalid pages parameter" in s:
                        failed_pages.add(b.get("tool_use_id"))
                    if b.get("is_error"):
                        is_error_ids.add(b.get("tool_use_id"))
                    tur = rec.get("toolUseResult")
                    if isinstance(tur, dict) and ("agentId" in tur or "agentType" in tur):
                        agent_links[b.get("tool_use_id")] = dict(agentId=tur.get("agentId"), agentType=tur.get("agentType"),
                                                                 resolvedModel=tur.get("resolvedModel"), status=tur.get("status"))
    reqs = [g for g in by_id.values()]
    return dict(requests=reqs, tool_use_owner=tool_use_owner, failed_pages=failed_pages,
                is_error_ids=is_error_ids, agent_links=agent_links, side_inline=side_inline)

def cost(u, inp, cr, w, out):
    """u: usage dict; prices per MTok; w = write price."""
    return (u["inp"] * inp + u["cw"] * w + u["cr"] * cr + u["out"] * out) / 1e6

VECTORS = {
    # name: (in, cache_read, write, out)  -- absolute $/MTok
    "luna_w1.25 (ledger)": (0.10, 0.01, 0.125, 0.60),
    "luna_w1.00 (no write surcharge)": (0.10, 0.01, 0.10, 0.60),
    "opus5_5m": (5.0, 0.5, 6.25, 25.0),
    "opus5_1h": (5.0, 0.5, 10.0, 25.0),
    "sonnet5_5m": (2.0, 0.2, 2.5, 10.0),
    "fable51_5m": (10.0, 0.25, 12.5, 50.0),
}

def total(reqs, vec):
    inp, cr, w, out = vec
    return sum(cost(g["usage"], inp, cr, w, out) for g in reqs if g["usage"])

results = []
unmatched = []
for r in rows:
    task, arm, rep = r["taskId"], r["arm"], r["rep"]
    target = r.get("costRealizedMainOnlyUsd")
    pat = os.path.join(RUN, "agent-state", f"{task}-{arm}", "claude-home", "projects", f"*-r{rep}-*", "*.jsonl")
    cands = sorted(glob.glob(pat))
    best = None
    for f in cands:
        P = parse_file(f)
        real = total(P["requests"], VECTORS["luna_w1.25 (ledger)"])
        d = abs(real - (target or 0))
        if best is None or d < best[0]:
            best = (d, f, P, real)
    if best is None:
        unmatched.append((task, arm, rep, "no transcript"))
        continue
    d, f, P, real = best
    matched = d < 2e-6
    if not matched:
        unmatched.append((task, arm, rep, f"nearest {real:.6f} vs row {target}"))
    # sidechain files for this session
    sess = f[:-len(".jsonl")]
    side_files = sorted(glob.glob(os.path.join(sess, "subagents", "agent-*.jsonl")))
    sides = []
    for sf in side_files:
        S = parse_file(sf, allow_sidechain=True)
        aid = re.search(r"agent-([0-9a-f]+)\.jsonl$", sf).group(1)
        # link to parent Agent call
        req_model = agent_type = None
        for tu_id, link in P["agent_links"].items():
            if link.get("agentId") == aid:
                owner = P["tool_use_owner"].get(tu_id)
                if owner:
                    req_model = (owner[2] or {}).get("model")
                    agent_type = (owner[2] or {}).get("subagent_type") or link.get("agentType")
        n_req = len(S["requests"]); n_use = sum(1 for g in S["requests"] if g["usage"] and (g["usage"]["inp"]+g["usage"]["cr"]+g["usage"]["cw"]+g["usage"]["out"])>0)
        sides.append(dict(file=sf, agentId=aid, requestedModel=req_model, agentType=agent_type,
                          requests=n_req, usageRequests=n_use, impute=(n_req / n_use if n_use else 1.0),
                          costs={k: total(S["requests"], v) for k, v in VECTORS.items()},
                          ttl5=sum(g["usage"]["ttl5"] for g in S["requests"] if g["usage"]),
                          ttl1=sum(g["usage"]["ttl1"] for g in S["requests"] if g["usage"])))
    # pages: wholly-wasted requests on the main thread
    wasted = []
    n_failed_calls = len(P["failed_pages"])
    n_read_calls = sum(1 for v in P["tool_use_owner"].values() if v[1] == "Read")
    for g in P["requests"]:
        if g["tool_uses"] and all(t in P["failed_pages"] for t in g["tool_uses"]):
            wasted.append(g)
    wasted_cost = {k: total(wasted, v) for k, v in VECTORS.items()}
    # tokens the failures add to context (approx: ingest of the request AFTER a wasted request = cw+inp of next)
    main_tok = dict(inp=sum(g["usage"]["inp"] for g in P["requests"] if g["usage"]),
                    cw=sum(g["usage"]["cw"] for g in P["requests"] if g["usage"]),
                    cr=sum(g["usage"]["cr"] for g in P["requests"] if g["usage"]),
                    out=sum(g["usage"]["out"] for g in P["requests"] if g["usage"]),
                    ttl5=sum(g["usage"]["ttl5"] for g in P["requests"] if g["usage"]),
                    ttl1=sum(g["usage"]["ttl1"] for g in P["requests"] if g["usage"]))
    results.append(dict(task=task, arm=arm, rep=rep, file=f, matched=matched, row_main=target,
                        replay_main=real, resolved=r.get("resolved"),
                        n_requests=len(P["requests"]), n_usage=sum(1 for g in P["requests"] if g["usage"] and (g["usage"]["inp"]+g["usage"]["cr"]+g["usage"]["cw"]+g["usage"]["out"])>0),
                        side_inline=P["side_inline"], main_tok=main_tok,
                        main_costs={k: total(P["requests"], v) for k, v in VECTORS.items()},
                        sides=sides, n_read_calls=n_read_calls, n_failed_pages_calls=n_failed_calls,
                        n_wasted_requests=len(wasted), wasted_cost=wasted_cost,
                        wasted_tok=dict(cr=sum(g["usage"]["cr"] for g in wasted if g["usage"]),
                                        cw=sum(g["usage"]["cw"] for g in wasted if g["usage"]),
                                        inp=sum(g["usage"]["inp"] for g in wasted if g["usage"]),
                                        out=sum(g["usage"]["out"] for g in wasted if g["usage"]))))

json.dump(dict(results=results, unmatched=unmatched), open(os.path.join(OUT, "replay.json"), "w"), indent=1)

print(f"rows {len(rows)}  matched {sum(1 for x in results if x['matched'])}  unmatched {len(unmatched)}")
for u in unmatched[:20]:
    print("  UNMATCHED", u)

def fmt(x): return f"{x:.6f}"
arms = ["native", "sweet"]
print("\n=== A. MAIN-ONLY per rollout (66 rows/arm, row-matched transcripts) ===")
print(f"{'vector':36s} {'native':>12s} {'sweet':>12s} {'sweet-native':>13s}")
for k in VECTORS:
    t = {a: sum(x["main_costs"][k] for x in results if x["arm"] == a) / 66 for a in arms}
    print(f"{k:36s} {fmt(t['native']):>12s} {fmt(t['sweet']):>12s} {100*(t['sweet']/t['native']-1):+12.2f}%")

print("\n=== A2. token totals per rollout (main) ===")
for a in arms:
    xs = [x for x in results if x["arm"] == a]
    tk = {f: sum(x["main_tok"][f] for x in xs) / 66 for f in ["inp", "cw", "cr", "out", "ttl5", "ttl1"]}
    nreq = sum(x["n_requests"] for x in xs) / 66
    nuse = sum(x["n_usage"] for x in xs) / 66
    print(f"  {a:7s} requests {nreq:6.2f} usage-bearing {nuse:6.2f} | uncached-in {tk['inp']:9.0f} cache-write {tk['cw']:9.0f} cache-read {tk['cr']:10.0f} out {tk['out']:7.0f} | ttl5m {tk['ttl5']:.0f} ttl1h {tk['ttl1']:.0f} | inline-sidechain-records {sum(x['side_inline'] for x in xs)}")

print("\n=== B. SIDECHAIN (recorded usage only = lower bound) per rollout ===")
for a in arms:
    xs = [x for x in results if x["arm"] == a]
    n_sub = sum(len(x["sides"]) for x in xs)
    n_req = sum(s["requests"] for x in xs for s in x["sides"])
    n_use = sum(s["usageRequests"] for x in xs for s in x["sides"])
    ttl5 = sum(s["ttl5"] for x in xs for s in x["sides"]); ttl1 = sum(s["ttl1"] for x in xs for s in x["sides"])
    print(f"  {a:7s} subagents {n_sub}  requests {n_req}  usage-bearing {n_use}  zero-usage {n_req-n_use}  ttl5m {ttl5} ttl1h {ttl1}")
    models = collections.Counter((s["agentType"], s["requestedModel"]) for x in xs for s in x["sides"])
    print("          requested (type, model):", dict(models))
    for k in VECTORS:
        tot_side = sum(s["costs"][k] for x in xs for s in x["sides"]) / 66
        print(f"          {k:36s} sidechain/rollout {fmt(tot_side)}")

print("\n=== C. INCLUSIVE (main + recorded sidechain, LOWER BOUND) per rollout ===")
print(f"{'vector':36s} {'native':>12s} {'sweet':>12s} {'sweet-native':>13s}")
for k in VECTORS:
    t = {}
    for a in arms:
        xs = [x for x in results if x["arm"] == a]
        t[a] = (sum(x["main_costs"][k] for x in xs) + sum(s["costs"][k] for x in xs for s in x["sides"])) / 66
    print(f"{k:36s} {fmt(t['native']):>12s} {fmt(t['sweet']):>12s} {100*(t['sweet']/t['native']-1):+12.2f}%")

print("\n=== C2. subscription mix: main at opus5_1h, subagents at opus5_5m (candidate's item 1) ===")
t = {}
for a in arms:
    xs = [x for x in results if x["arm"] == a]
    t[a] = (sum(x["main_costs"]["opus5_1h"] for x in xs) + sum(s["costs"]["opus5_5m"] for x in xs for s in x["sides"])) / 66
print(f"  inclusive-LB native {fmt(t['native'])} sweet {fmt(t['sweet'])}  sweet-native {100*(t['sweet']/t['native']-1):+.2f}%")

print("\n=== C3. requested-model repricing of subagents (haiku at 0.2x of opus5 rate; sonnet at 0.4x) ===")
def sub_price(s, base_vec, haiku_mult=0.2, sonnet_mult=0.4):
    m = (s["requestedModel"] or "").lower()
    mult = haiku_mult if "haiku" in m else (sonnet_mult if "sonnet" in m else 1.0)
    return s["costs"][base_vec] * mult
for base in ["opus5_5m", "luna_w1.25 (ledger)"]:
    for hm, sm, label in [(0.2, 0.4, "haiku0.2/sonnet0.4"), (0.2, 1.0, "haiku0.2 only"), (0.33, 1.0, "haiku0.33 only")]:
        t = {}
        for a in arms:
            xs = [x for x in results if x["arm"] == a]
            t[a] = (sum(x["main_costs"][base] for x in xs) + sum(sub_price(s, base, hm, sm) for x in xs for s in x["sides"])) / 66
        print(f"  base {base:22s} {label:20s} native {fmt(t['native'])} sweet {fmt(t['sweet'])}  sweet-native {100*(t['sweet']/t['native']-1):+.2f}%")
# haiku share of recorded sidechain spend
for a in arms:
    xs = [x for x in results if x["arm"] == a]
    tot = sum(s["costs"]["luna_w1.25 (ledger)"] for x in xs for s in x["sides"])
    hk = sum(s["costs"]["luna_w1.25 (ledger)"] for x in xs for s in x["sides"] if "haiku" in (s["requestedModel"] or "").lower())
    nh = sum(1 for x in xs for s in x["sides"] if "haiku" in (s["requestedModel"] or "").lower())
    print(f"  {a:7s} haiku-requested subagents {nh}/{sum(len(x['sides']) for x in xs)}  haiku share of RECORDED sidechain $ {100*hk/tot if tot else 0:.1f}%")

print("\n=== D. PAGES: wholly-wasted main-thread requests ===")
for a in arms:
    xs = [x for x in results if x["arm"] == a]
    nw = sum(x["n_wasted_requests"] for x in xs)
    nf = sum(x["n_failed_pages_calls"] for x in xs)
    nr = sum(x["n_read_calls"] for x in xs)
    hit = sum(1 for x in xs if x["n_failed_pages_calls"])
    wc = sum(x["wasted_cost"]["luna_w1.25 (ledger)"] for x in xs)
    wt = {f: sum(x["wasted_tok"][f] for x in xs) for f in ["cr", "cw", "inp", "out"]}
    main = sum(x["main_costs"]["luna_w1.25 (ledger)"] for x in xs)
    print(f"  {a:7s} Read calls {nr}  failed-on-pages calls {nf}  rollouts hit {hit}/66  wholly-wasted requests {nw} ({nw/66:.2f}/rollout)")
    print(f"          wasted requests' own luna cost ${wc:.6f} total = ${wc/66:.6f}/rollout = {100*wc/main:.2f}% of main-only; per wasted request ${wc/nw if nw else 0:.6f}; tokens cr {wt['cr']} cw {wt['cw']} in {wt['inp']} out {wt['out']}")
# main-only after removing wasted requests' own cost
for k in ["luna_w1.25 (ledger)", "opus5_5m"]:
    t = {}
    for a in arms:
        xs = [x for x in results if x["arm"] == a]
        t[a] = (sum(x["main_costs"][k] for x in xs) - sum(x["wasted_cost"][k] for x in xs)) / 66
    print(f"  main-only minus wasted requests, {k:22s}: native {fmt(t['native'])} sweet {fmt(t['sweet'])} sweet-native {100*(t['sweet']/t['native']-1):+.2f}%")

print("\n=== E. no-delegation subset (rollouts with 0 subagents in BOTH arms of the same task-rep) ===")
byk = {(x["task"], x["rep"], x["arm"]): x for x in results}
pairs = [(byk[(t, r, "native")], byk[(t, r, "sweet")]) for (t, r, a) in byk if a == "native" and (t, r, "sweet") in byk]
nod = [(n, s) for n, s in pairs if not n["sides"] and not s["sides"]]
print(f"  rep-matched pairs {len(pairs)}; neither delegated {len(nod)}")
for k in ["luna_w1.25 (ledger)", "opus5_5m", "opus5_1h"]:
    tn = sum(n["main_costs"][k] for n, s in nod); ts = sum(s["main_costs"][k] for n, s in nod)
    print(f"  {k:36s} native {fmt(tn/len(nod))} sweet {fmt(ts/len(nod))} sweet-native {100*(ts/tn-1):+.2f}%")
tasks_nod = sorted({n["task"] for n, s in nod})
print("  tasks with any no-delegation pair:", len(tasks_nod))

print("\n=== F. SIDECHAIN detail: recorded vs ratio-imputed (recorded x requests/usage-bearing) per rollout, luna ledger ===")
for a in arms:
    xs = [x for x in results if x["arm"] == a]
    rec = sum(s["costs"]["luna_w1.25 (ledger)"] for x in xs for s in x["sides"])
    imp = sum(s["costs"]["luna_w1.25 (ledger)"] * s["impute"] for x in xs for s in x["sides"])
    hk_rec = sum(s["costs"]["luna_w1.25 (ledger)"] for x in xs for s in x["sides"] if "haiku" in (s["requestedModel"] or "").lower())
    hk_imp = sum(s["costs"]["luna_w1.25 (ledger)"] * s["impute"] for x in xs for s in x["sides"] if "haiku" in (s["requestedModel"] or "").lower())
    print(f"  {a:7s} recorded ${rec:.4f} total (${rec/66:.6f}/rollout), haiku share {100*hk_rec/rec if rec else 0:.1f}% | ratio-imputed ${imp:.4f} (${imp/66:.6f}/rollout), haiku share {100*hk_imp/imp if imp else 0:.1f}%")

def scen(label, main_vec, sub_vec, haiku_mult, sonnet_mult, drop_wasted, impute):
    t = {}
    for a in arms:
        xs = [x for x in results if x["arm"] == a]
        main = sum(x["main_costs"][main_vec] for x in xs)
        if drop_wasted:
            main -= sum(x["wasted_cost"][main_vec] for x in xs)
        side = 0.0
        for x in xs:
            for s in x["sides"]:
                m = (s["requestedModel"] or "").lower()
                mult = haiku_mult if "haiku" in m else (sonnet_mult if "sonnet" in m else 1.0)
                side += s["costs"][sub_vec] * mult * (s["impute"] if impute else 1.0)
        t[a] = (main + side) / 66
    print(f"  {label:78s} native {t['native']:.6f} sweet {t['sweet']:.6f} sweet-native {100*(t['sweet']/t['native']-1):+.2f}%")

print("\n=== G. INCLUSIVE scenarios (main + sidechain), per rollout ===")
for impute in (False, True):
    tag = "IMPUTED" if impute else "RECORDED-ONLY (lower bound)"
    print(f"--- sidechain {tag} ---")
    scen("ledger: luna w1.25 everywhere", "luna_w1.25 (ledger)", "luna_w1.25 (ledger)", 1, 1, False, impute)
    scen("ledger + haiku subagents at 0.2x", "luna_w1.25 (ledger)", "luna_w1.25 (ledger)", 0.2, 1, False, impute)
    scen("ledger + haiku subagents at 0.33x", "luna_w1.25 (ledger)", "luna_w1.25 (ledger)", 0.33, 1, False, impute)
    scen("ledger + pages wasted requests removed (both arms)", "luna_w1.25 (ledger)", "luna_w1.25 (ledger)", 1, 1, True, impute)
    scen("ledger + haiku 0.2x + pages removed", "luna_w1.25 (ledger)", "luna_w1.25 (ledger)", 0.2, 1, True, impute)
    scen("API-key path: opus5 5m main+sub, subagents at requested model (haiku 0.2x, sonnet 0.4x)", "opus5_5m", "opus5_5m", 0.2, 0.4, False, impute)
    scen("API-key path + pages removed", "opus5_5m", "opus5_5m", 0.2, 0.4, True, impute)
    scen("subscription path: opus5 1h main, 5m subs at requested model (0.2/0.4)", "opus5_1h", "opus5_5m", 0.2, 0.4, False, impute)
    scen("subscription path + pages removed", "opus5_1h", "opus5_5m", 0.2, 0.4, True, impute)
    scen("candidate item(1) literal: opus5 1h main, opus5 5m subs (no model repricing)", "opus5_1h", "opus5_5m", 1, 1, False, impute)
    scen("sonnet5 5m main, subs at requested (haiku 0.5x of sonnet, sonnet 1x)", "sonnet5_5m", "sonnet5_5m", 0.5, 1.0, False, impute)

print("\n\n######## DEAREST-3 CONVENTION (published cells): all session files per task x arm, keep 3 dearest by ledger inclusive-LB ########")
def build_entry(task, arm, rep, f):
    P = parse_file(f)
    sess = f[:-len(".jsonl")]
    sides = []
    for sf in sorted(glob.glob(os.path.join(sess, "subagents", "agent-*.jsonl"))):
        S = parse_file(sf, allow_sidechain=True)
        aid = re.search(r"agent-([0-9a-f]+)\.jsonl$", sf).group(1)
        req_model = None
        for tu_id, link in P["agent_links"].items():
            if link.get("agentId") == aid:
                owner = P["tool_use_owner"].get(tu_id)
                if owner: req_model = (owner[2] or {}).get("model")
        n_req = len(S["requests"]); n_use = sum(1 for g in S["requests"] if g["usage"] and sum(g["usage"][k] for k in ("inp","cr","cw","out"))>0)
        sides.append(dict(requestedModel=req_model, requests=n_req, usageRequests=n_use, impute=(n_req/n_use if n_use else 1.0),
                          costs={k: total(S["requests"], v) for k, v in VECTORS.items()}))
    wasted = [g for g in P["requests"] if g["tool_uses"] and all(t in P["failed_pages"] for t in g["tool_uses"])]
    return dict(task=task, arm=arm, rep=rep, file=f, sides=sides,
                main_costs={k: total(P["requests"], v) for k, v in VECTORS.items()},
                wasted_cost={k: total(wasted, v) for k, v in VECTORS.items()}, n_wasted=len(wasted),
                n_failed=len(P["failed_pages"]))
allx = []
tasks = sorted({r["taskId"] for r in rows})
for task in tasks:
    for arm in arms:
        for f in sorted(glob.glob(os.path.join(RUN, "agent-state", f"{task}-{arm}", "claude-home", "projects", "*", "*.jsonl"))):
            m = re.search(r"-r(\d+)-\d+/[^/]+\.jsonl$", f)
            allx.append(build_entry(task, arm, int(m.group(1)) if m else -1, f))
print("session files parsed:", collections.Counter(x["arm"] for x in allx))
sel = []
for task in tasks:
    for arm in arms:
        xs = [x for x in allx if x["task"] == task and x["arm"] == arm]
        xs.sort(key=lambda x: -(x["main_costs"]["luna_w1.25 (ledger)"] + sum(s["costs"]["luna_w1.25 (ledger)"] for s in x["sides"])))
        sel.extend(xs[:3])
print("selected:", collections.Counter(x["arm"] for x in sel))
results_saved = results
results = sel
print("\n=== D3. main-only, dearest-3 ===")
for k in VECTORS:
    t = {a: sum(x["main_costs"][k] for x in results if x["arm"] == a) / 66 for a in arms}
    print(f"{k:36s} native {t['native']:.6f} sweet {t['sweet']:.6f} sweet-native {100*(t['sweet']/t['native']-1):+.2f}%")
for a in arms:
    xs=[x for x in results if x["arm"]==a]
    print(f"  {a} wholly-wasted pages requests {sum(x['n_wasted'] for x in xs)} failed calls {sum(x['n_failed'] for x in xs)}")
print("\n=== G3. INCLUSIVE scenarios, dearest-3 ===")
for impute in (False, True):
    print(f"--- sidechain {'IMPUTED' if impute else 'RECORDED-ONLY (lower bound)'} ---")
    scen("ledger: luna w1.25 everywhere", "luna_w1.25 (ledger)", "luna_w1.25 (ledger)", 1, 1, False, impute)
    scen("ledger + haiku subagents at 0.2x", "luna_w1.25 (ledger)", "luna_w1.25 (ledger)", 0.2, 1, False, impute)
    scen("ledger + haiku subagents at 0.33x", "luna_w1.25 (ledger)", "luna_w1.25 (ledger)", 0.33, 1, False, impute)
    scen("ledger + pages wasted requests removed (both arms)", "luna_w1.25 (ledger)", "luna_w1.25 (ledger)", 1, 1, True, impute)
    scen("API-key path: opus5 5m main+sub, subagents at requested model (haiku 0.2x, sonnet 0.4x)", "opus5_5m", "opus5_5m", 0.2, 0.4, False, impute)
    scen("API-key path + pages removed", "opus5_5m", "opus5_5m", 0.2, 0.4, True, impute)
    scen("subscription path: opus5 1h main, 5m subs at requested model (0.2/0.4)", "opus5_1h", "opus5_5m", 0.2, 0.4, False, impute)
    scen("subscription path + pages removed", "opus5_1h", "opus5_5m", 0.2, 0.4, True, impute)
    scen("candidate item(1) literal: opus5 1h main, opus5 5m subs (no model repricing)", "opus5_1h", "opus5_5m", 1, 1, False, impute)
