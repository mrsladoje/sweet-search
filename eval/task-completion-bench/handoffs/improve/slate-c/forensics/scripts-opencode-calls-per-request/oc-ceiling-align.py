#!/usr/bin/env python3
"""oc-ceiling-align.py -- from requests.json (oc-request-census.py output):
 1. request ceilings if sweet's ss-* work were emitted at native's structured rate
    (envelope level, operation level, kind-specific dependency-respecting, observed single-ss-read runs),
    priced with the removed requests' OWN token records;
 2. search->read transition fan-out, sweet vs native;
 3. per-task alignment: sweet runs of consecutive single `ss-read` requests vs native multi-read requests
    on the same task, matched by repo-relative file path.
READ-ONLY. Usage: python3 oc-ceiling-align.py [OUT_DIR]
"""
import json, os, sys, math, collections
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/wf-slatec/opencode-calls-per-request"
rolls = json.load(open(os.path.join(OUT, "requests.json")))
native = [x for x in rolls if x["arm"] == "native"]; sweet = [x for x in rolls if x["arm"] == "sweet"]
P_CACHE, P_OUT, P_IN = 0.01 / 1e6, 0.60 / 1e6, 0.10 / 1e6
lines = []
def P(s=""): lines.append(s); print(s)

def marginal(q):  # what vanishes when this request is merged into its predecessor: its prefix re-send + its own output
    return q["tok_cache_read"] * P_CACHE + (q["tok_out"] + q["tok_reasoning"]) * P_OUT
def prefix_only(q): return q["tok_cache_read"] * P_CACHE

def rates(rs):
    A = collections.defaultdict(float)
    for x in rs:
        A["req"] += x["n_req"]; A["cost"] += x["replay_cost"]
        for q in x["reqs"]:
            A["calls"] += q["n"]; A["ops"] += q["ops"]
            if q["n"]: A["tool_req"] += 1
            A["k_" + q["kind"]] += 1; A["k_" + q["kind"] + "_ops"] += q["ops"]
            if q["kind"] in ("R", "S", "RS"): A["explore_req"] += 1; A["explore_ops"] += q["ops"]
    return A
N, S = rates(native), rates(sweet)
n = len(sweet)
P("=== rates (native | sweet) ===")
P(" requests/rollout %.2f | %.2f ; tool-bearing %.2f | %.2f ; calls %.2f | %.2f ; ops %.2f | %.2f ; cost $%.6f | $%.6f" % (
    N["req"] / 66, S["req"] / n, N["tool_req"] / 66, S["tool_req"] / n, N["calls"] / 66, S["calls"] / n, N["ops"] / 66, S["ops"] / n, N["cost"] / 66, S["cost"] / n))
wR, wS, wRS = N["k_R_ops"] / N["k_R"], N["k_S_ops"] / N["k_S"], N["explore_ops"] / N["explore_req"]
P(" native ops per request by kind: R %.3f (n=%d) S %.3f (n=%d) exploration pooled (R,S,RS) %.3f (n=%d); sweet: R %.3f S %.3f pooled %.3f" % (
    wR, N["k_R"], wS, N["k_S"], wRS, N["explore_req"], S["k_R_ops"] / S["k_R"], S["k_S_ops"] / S["k_S"], S["explore_ops"] / S["explore_req"]))

# ---- price of a sweet request, by kind (measured from its own tokens)
byk = collections.defaultdict(list)
for x in sweet:
    for q in x["reqs"]: byk[q["kind"]].append(q)
P("\n=== sweet request price by kind (mean of the request's own tokens; registered luna price) ===")
P(" kind  n   mean cache-read tok  mean uncached-in tok  mean out+reason tok  full cost  marginal(prefix+out)  prefix-only")
for k in ("R", "S", "RS", "E", "T", "O", "N", "X"):
    qs = byk[k]
    if not qs: continue
    P(" %-4s %4d  %9.0f  %9.0f  %7.0f  $%.6f  $%.6f  $%.6f" % (k, len(qs), sum(q["tok_cache_read"] for q in qs) / len(qs), sum(q["tok_in"] for q in qs) / len(qs),
        sum(q["tok_out"] + q["tok_reasoning"] for q in qs) / len(qs), sum(q["cost"] for q in qs) / len(qs), sum(marginal(q) for q in qs) / len(qs), sum(prefix_only(q) for q in qs) / len(qs)))
allq = [q for x in sweet for q in x["reqs"]]
mean_marg = sum(marginal(q) for q in allq) / len(allq); mean_full = sum(q["cost"] for q in allq) / len(allq)
expl = [q for k in ("R", "S", "RS") for q in byk[k]]
mean_marg_expl = sum(marginal(q) for q in expl) / len(expl); mean_pref_expl = sum(prefix_only(q) for q in expl) / len(expl)
P(" all sweet requests: mean full cost $%.6f, mean marginal $%.6f; exploration requests: mean marginal $%.6f, prefix-only $%.6f" % (mean_full, mean_marg, mean_marg_expl, mean_pref_expl))
sweet_cost = S["cost"] / n

def report(label, saved_req, dollars, note=""):
    P(" %-58s saved %.2f req/rollout (%.1f%% of %.2f) = -$%.6f/rollout (-%.1f%% of $%.6f) %s" % (
        label, saved_req, 100 * saved_req / (S["req"] / n), S["req"] / n, dollars, 100 * dollars / sweet_cost, sweet_cost, note))

P("\n=== A. global-rate ceilings (08-28 style: every sweet request compressible at native's mean rate) ===")
# envelope level, all-request denominators (08-28's -20%)
for label, s_num, n_rate, s_den in (
    ("envelope / all requests (08-28 -20% form)", S["calls"] / n, N["calls"] / N["req"], S["req"] / n),
    ("envelope / tool-bearing requests only", S["calls"] / n, N["calls"] / N["tool_req"], S["tool_req"] / n),
    ("operation / all requests (08-28 -9.5% form)", S["ops"] / n, N["ops"] / N["req"], S["req"] / n),
    ("operation / tool-bearing requests only", S["ops"] / n, N["ops"] / N["tool_req"], S["tool_req"] / n)):
    saved = s_den - s_num / n_rate
    report(label, saved, saved * mean_marg_expl, "[priced at mean exploration marginal $%.6f]" % mean_marg_expl)
    P("   same, priced at the 08-28 $0.000341/request: -$%.6f (-%.1f%%); at mean full request cost $%.6f: -$%.6f (-%.1f%%)" % (
        saved * 0.000341, 100 * saved * 0.000341 / sweet_cost, mean_full, saved * mean_full, 100 * saved * mean_full / sweet_cost))

P("\n=== B. kind-specific, dependency-respecting ceilings (only consecutive same-kind exploration requests merge) ===")
def runs(x, accept):
    """maximal runs of consecutive requests satisfying accept(q); text/todo requests break a run"""
    out, cur = [], []
    for q in x["reqs"]:
        if accept(q): cur.append(q)
        else:
            if cur: out.append(cur); cur = []
    if cur: out.append(cur)
    return out
def compress(rs, accept, width, min_len=1):
    saved = 0.0; dollars = 0.0; dollars_pref = 0.0; nruns = 0; nreq = 0
    for x in rs:
        for run in runs(x, accept):
            if len(run) < min_len: continue
            nruns += 1; nreq += len(run)
            ops = sum(q["ops"] for q in run)
            m = max(1, math.ceil(ops / width))
            k = max(0, len(run) - m)
            saved += k
            # the removed requests are the LATER ones of the run (the first stays and carries the merged calls)
            for q in run[len(run) - k:]: dollars += marginal(q); dollars_pref += prefix_only(q)
    return saved / len(rs), dollars / len(rs), dollars_pref / len(rs), nruns, nreq
for label, acc, w in (
    ("R runs at native R width %.3f" % wR, lambda q: q["kind"] == "R", wR),
    ("S runs at native S width %.3f" % wS, lambda q: q["kind"] == "S", wS),
    ("exploration runs (R,S,RS mixed) at native pooled width %.3f" % wRS, lambda q: q["kind"] in ("R", "S", "RS"), wRS)):
    s, d, dp, nr, nq = compress(sweet, acc, w)
    report(label, s, d, "[prefix-only -$%.6f = -%.1f%%; %d runs, %d requests]" % (dp, 100 * dp / sweet_cost, nr, nq))
# same for native (how far native itself is from its own mean width -> shows the metric's self-consistency)
s, d, dp, nr, nq = compress(native, lambda q: q["kind"] in ("R", "S", "RS"), wRS)
P("   [control] native compressed at its own pooled width: saved %.2f req/rollout (%d runs) -- residual packing slack in native itself" % (s, nr))

P("\n=== C. observed floor: runs of consecutive single-`ss-read` requests (1 bash call, exactly one ss-read op, no chain) ===")
def single_ssread(q): return q["n"] == 1 and q["n_bash"] == 1 and q["ss_ops"] == ["read"] and q["ss_chained_envelopes"] == 0
lens = collections.Counter(); same_file = 0; total_in_runs = 0; runs_ge2 = 0
for x in sweet:
    for run in runs(x, single_ssread):
        lens[len(run)] += 1
        if len(run) >= 2:
            runs_ge2 += 1; total_in_runs += len(run)
            for a, b in zip(run, run[1:]):
                if a["paths"] and b["paths"] and a["paths"][0] == b["paths"][0]: same_file += 1
P(" run-length distribution: %s" % dict(sorted(lens.items())))
P(" runs of length>=2: %d, requests in them %d (%.2f/rollout); consecutive pairs reading the SAME file: %d" % (runs_ge2, total_in_runs, total_in_runs / n, same_file))
s, d, dp, nr, nq = compress(sweet, single_ssread, wR, min_len=2)
report("single-ss-read runs (len>=2) packed at native R width %.3f" % wR, s, d, "[prefix-only -$%.6f]" % dp)
s, d, dp, nr, nq = compress(sweet, single_ssread, 1e9, min_len=2)
report("single-ss-read runs (len>=2) fully packed to ONE request", s, d, "[prefix-only -$%.6f]" % dp)
# how many single-ss-read requests exist at all
n_single = sum(1 for q in allq if single_ssread(q)); n_ssread_req = sum(1 for q in allq if "read" in q["ss_ops"])
P(" single-ss-read requests: %d of %d ss-read-bearing requests (%.1f%%); %.2f per rollout" % (n_single, n_ssread_req, 100 * n_single / max(1, n_ssread_req), n_single / n))

P("\n=== D. search -> next request fan-out (what follows a search-only request) ===")
def trans(rs):
    nxt = collections.Counter(); readops = []
    for x in rs:
        qs = [q for q in x["reqs"] if q["n"] > 0 and q["kind"] != "N"]
        for a, b in zip(qs, qs[1:]):
            if a["kind"] == "S":
                nxt[b["kind"]] += 1
                if b["kind"] == "R": readops.append(b["ops"])
    return nxt, readops
for label, rs in (("native", native), ("sweet", sweet)):
    nxt, ro = trans(rs)
    tot = sum(nxt.values())
    P(" %s: after %d search-only requests the next request is: %s; when it is a read request it carries %.2f read ops on average (n=%d); share of those with >=2 reads %.1f%%" % (
        label, tot, {k: "%d (%.0f%%)" % (v, 100 * v / tot) for k, v in nxt.most_common()}, sum(ro) / max(1, len(ro)), len(ro), 100 * sum(1 for r in ro if r >= 2) / max(1, len(ro))))

P("\n=== E. per-task alignment: sweet consecutive single-ss-read runs vs native multi-read requests, same task ===")
def ident(x): return "%s/agent-state/%s-%s rep%d (%s)" % (x["run"], x["task"], x["arm"], x["rep"], x["session"])
matches = []
by_task = collections.defaultdict(lambda: {"native": [], "sweet": []})
for x in rolls: by_task[x["task"]][x["arm"]].append(x)
total_native_multi = 0
for task, d in sorted(by_task.items()):
    nat_multi = []
    for x in d["native"]:
        for i, q in enumerate(x["reqs"]):
            reads = [p for p, t in zip(q["paths"], [c for c in q["tools"] if c == "read"]) if p] if q["n_struct_read"] else []
            rp = [p for p in q["paths"] if p] if q["tools"].count("read") >= 2 else []
            if len(rp) >= 2:
                nat_multi.append((x, i, q, rp)); total_native_multi += 1
    for x in d["sweet"]:
        for run in runs(x, single_ssread):
            if len(run) < 2: continue
            sp = [q["paths"][0] for q in run if q["paths"]]
            for (nx, i, nq, rp) in nat_multi:
                inter = set(sp) & set(rp)
                if len(inter) >= 2:
                    matches.append({"task": task, "sweet": ident(x), "sweet_req_idx": [x["reqs"].index(q) for q in run], "sweet_msgs": [q["msg"] for q in run],
                                    "sweet_paths": sp, "sweet_cmds": [q["bash_cmds"][0] for q in run], "native": ident(nx), "native_req_idx": i, "native_msg": nq["msg"],
                                    "native_paths": rp, "shared": sorted(inter), "sweet_marginal_saved_if_one_request": sum(marginal(q) for q in run[1:])})
P(" native multi-read requests with >=2 distinct-or-repeated file paths: %d; sweet single-ss-read runs (len>=2): %d; path-matched pairs (>=2 shared files): %d across %d tasks" % (
    total_native_multi, runs_ge2, len(matches), len(set(m["task"] for m in matches))))
seen = set()
for m in sorted(matches, key=lambda m: (-len(m["shared"]), m["task"])):
    key = (m["sweet"], tuple(m["sweet_req_idx"]))
    if key in seen: continue
    seen.add(key)
    P("\n TASK %s" % m["task"])
    P("  sweet  %s requests #%s msgs %s" % (m["sweet"], m["sweet_req_idx"], m["sweet_msgs"]))
    for c in m["sweet_cmds"]: P("     $ %s" % c[:140].replace("\n", "\\n"))
    P("  native %s request #%d msg %s read %d files in ONE request: %s" % (m["native"], m["native_req_idx"], m["native_msg"], len(m["native_paths"]), m["native_paths"]))
    P("  shared files: %s ; marginal saving if the sweet run were one request: $%.6f" % (m["shared"], m["sweet_marginal_saved_if_one_request"]))
    if len(seen) >= 12: break
json.dump(matches, open(os.path.join(OUT, "alignment.json"), "w"), indent=1)

# ---- exhibit strings: compact per-request tool sequence for every rollout
with open(os.path.join(OUT, "sequences.txt"), "w") as fh:
    for x in sorted(rolls, key=lambda x: (x["task"], x["arm"], x["rep"])):
        seq = []
        for q in x["reqs"]:
            if q["n"] == 0: seq.append("[text]"); continue
            items = []
            for c, cmd in zip([t for t in q["tools"]], [None] * len(q["tools"])): pass
            bi = 0
            for t in q["tools"]:
                if t == "bash":
                    cmd = q["bash_cmds"][bi]; bi += 1
                    ss = [s for s in q["ss_ops"]]
                    head = cmd.strip().split()[0] if cmd.strip() else "?"
                    if "ss-" in cmd:
                        import re
                        items.append("+".join(re.findall(r"ss-(?:read|search|grep|find|semantic|trace)", cmd)) or head)
                    elif "run_tests" in cmd: items.append("run_tests")
                    else: items.append("bash:" + head[:12])
                else: items.append(t)
            seq.append("[" + ",".join(items) + "]")
        fh.write("%s resolved=%s req=%d calls=%d\n  %s\n" % (ident(x), x["resolved"], x["n_req"], sum(q["n"] for q in x["reqs"]), " ".join(seq)))

P("\n=== F. the +requests gap by request kind (sweet minus native, per rollout) ===")
cnt = {a: collections.Counter() for a in ("native", "sweet")}; mc = {a: collections.Counter() for a in ("native", "sweet")}; full = {a: collections.Counter() for a in ("native", "sweet")}
for x in rolls:
    for q in x["reqs"]:
        cnt[x["arm"]][q["kind"]] += 1; mc[x["arm"]][q["kind"]] += marginal(q); full[x["arm"]][q["kind"]] += q["cost"]
P(" kind | native req/rollout | sweet req/rollout | gap | native marginal $/rollout | sweet marginal $/rollout | sweet full $/rollout (share)")
for k in ("R", "S", "RS", "E", "T", "O", "N", "X"):
    P("  %-3s %6.2f %6.2f %+6.2f  $%.6f  $%.6f  $%.6f (%.1f%%)" % (k, cnt["native"][k] / 66, cnt["sweet"][k] / n, (cnt["sweet"][k] / n - cnt["native"][k] / 66),
        mc["native"][k] / 66, mc["sweet"][k] / n, full["sweet"][k] / n, 100 * full["sweet"][k] / n / sweet_cost))
P("  total gap %+.2f requests/rollout" % (S["req"] / n - N["req"] / 66))

P("\n=== G. shared sinks: todo-only requests (opencode's built-in todowrite tool), both arms ===")
for arm, rs, d in (("native", native, 66), ("sweet", sweet, n)):
    qs = [q for x in rs for q in x["reqs"] if q["kind"] == "N"]
    pos = collections.Counter()
    for x in rs:
        for i, q in enumerate(x["reqs"]):
            if q["kind"] == "N": pos["first-3" if i < 3 else ("last-3" if i >= len(x["reqs"]) - 3 else "middle")] += 1
    P(" %s: %d todo-only requests (%.2f/rollout, %.1f%% of requests); marginal $%.6f/rollout (%.1f%% of the arm), full $%.6f/rollout; mean out+reasoning %.0f tok; position %s" % (
        arm, len(qs), len(qs) / d, 100 * len(qs) / (N["req"] if arm == "native" else S["req"]), sum(marginal(q) for q in qs) / d,
        100 * (sum(marginal(q) for q in qs) / d) / ((N["cost"] / 66) if arm == "native" else sweet_cost), sum(q["cost"] for q in qs) / d, sum(q["tok_out"] + q["tok_reasoning"] for q in qs) / max(1, len(qs)), dict(pos)))

P("\n=== H. per-task table and concentration of parallel ss-* emission (sweet) ===")
by = collections.defaultdict(lambda: collections.defaultdict(float))
for x in rolls:
    t = by[x["task"]]; a = x["arm"]
    t[a + "_n"] += 1; t[a + "_req"] += x["n_req"]; t[a + "_calls"] += sum(q["n"] for q in x["reqs"]); t[a + "_cost"] += x["replay_cost"]; t[a + "_solved"] += 1 if x["resolved"] else 0
    for q in x["reqs"]:
        if a == "sweet":
            if q["ss_env"]: t["ss_req"] += 1
            if q["ss_env"] >= 2: t["ss_par"] += 1
            if q["ss_chained_envelopes"]: t["ss_chain"] += 1
        if a == "native" and q["n_struct_read"] >= 2: t["nat_multi_read"] += 1
P(" task | native req | sweet req | native calls/req | sweet calls/req | native multi-read req/rollout | sweet ss-req/rollout | sweet parallel-ss req (3 reps) | sweet chained req (3 reps) | solved native/sweet | $ native/sweet")
for task, t in sorted(by.items()):
    P("  %-44s %5.1f %5.1f %5.2f %5.2f %5.2f %5.1f %3d %3d %d/%d $%.5f/$%.5f" % (task, t["native_req"] / 3, t["sweet_req"] / 3, t["native_calls"] / t["native_req"], t["sweet_calls"] / t["sweet_req"],
        t["nat_multi_read"] / 3, t["ss_req"] / 3, t["ss_par"], t["ss_chain"], t["native_solved"], t["sweet_solved"], t["native_cost"] / 3, t["sweet_cost"] / 3))
par = [sum(1 for q in x["reqs"] if q["ss_env"] >= 2) for x in sweet]
P(" sweet rollouts with >=1 parallel-ss request: %d/%d; distribution: %s" % (sum(1 for p in par if p), n, dict(sorted(collections.Counter(par).items()))))
P(" parallel-ss request widths (ss envelopes per request): %s" % dict(sorted(collections.Counter(q["ss_env"] for x in sweet for q in x["reqs"] if q["ss_env"] >= 2).items())))
P(" top parallel-ss compositions: %s" % collections.Counter(",".join(sorted(q["ss_ops"])) for x in sweet for q in x["reqs"] if q["ss_env"] >= 2).most_common(10))
P(" native multi-call requests containing bash: %d, compositions %s" % (sum(1 for x in native for q in x["reqs"] if q["n"] >= 2 and q["n_bash"] >= 1),
    collections.Counter(",".join(sorted(q["tools"])) for x in native for q in x["reqs"] if q["n"] >= 2 and q["n_bash"] >= 1).most_common(8)))

P("\n=== I. operation-count reconciliation with 08-28 p3-ops-per-envelope (three segmenter definitions) ===")
for arm, rs, d in (("native", native, 66), ("sweet", sweet, n)):
    ops = sum(q["ops"] for x in rs for q in x["reqs"]); p3 = sum(q["ops_p3"] for x in rs for q in x["reqs"]); raw = sum(q["ops_raw"] for x in rs for q in x["reqs"])
    env = sum(len(q["bash_cmds"]) for x in rs for q in x["reqs"])
    multi_raw = 0; multi_fix = 0
    for x in rs:
        for q in x["reqs"]:
            for cmd in q["bash_cmds"]:
                import re as _re
                segs_raw = [s for s in _re.split(r"&&|\|\||;|\n|\|", cmd) if s.strip()]
                if len(segs_raw) > 1: multi_raw += 1
    P(" %s: ops/rollout pipeline=1&quotes-masked %.2f | pipes-split&quotes-masked %.2f | naive (08-28 as run) %.2f ; bash envelopes %d, with >1 naive segment %d (%.1f%%)" % (
        arm, ops / d, p3 / d, raw / d, env, multi_raw, 100 * multi_raw / max(1, env)))

open(os.path.join(OUT, "ceiling-align.txt"), "w").write("\n".join(lines) + "\n")
