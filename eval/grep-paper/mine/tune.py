"""E1 pilot / Gate A and the ranking tuning round (GREP_PAPER_PLAN.md E1, §5.4; TUNING.md part 1).

Reads frozen dev replay records only (no repository, no API, no held-out record).

  python tune.py --records records-cut.jsonl.gz --out DIR [--pilot 500]

Writes DIR/gate_a.json, DIR/tuning.json and Markdown tables on stdout.
"""

import argparse
import collections
import gzip
import hashlib
import json
import math
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ranker import DECL, GENERATED, TEST, reveal_order  # noqa: E402

LEVELS = ("D", "F", "L")
CONTEXT = {"-A", "-B", "-C", "-NUM", "--context", "--after-context", "--before-context"}
DEF_SHAPED = re.compile(r"\b(def|class|func|fn|function|interface|struct|type|trait|impl|enum|module)\s")
CONFIG_EXT = re.compile(r"\.(json|ya?ml|toml|cfg|ini|xml|conf|properties|env|lock)\b")
SHIPPED = {"k": 2.0, "test": 0.5, "gen": 0.25, "decl": "always", "test_intent": False, "path_boost": 1.0,
           "depth_g": 0.0, "lr": None}


# ---------------------------------------------------------------- call preparation

def terms_of(patterns):
    out = []
    for p in patterns or []:
        for part in re.split(r"\\\||\|", p):
            t = re.sub(r"[\\^$.*+?()\[\]{}]", " ", part).strip().lower()
            for w in t.split():
                if len(w) >= 3:
                    out.append(w)
    return out


def operands(call):
    argv, ops, skip = call["grep_argv"][1:], [], False
    vals = {"-e", "-f", "-m", "-A", "-B", "-C", "--include", "--exclude", "--exclude-dir"}
    for a in argv:
        if skip:
            skip = False
            continue
        if a.startswith("-"):
            skip = a in vals
            continue
        ops.append(a)
    has_e = any(a == "-e" or a.startswith("--regexp") for a in argv)
    return ops if has_e else ops[1:]


def includes(call):
    out = []
    argv = call["grep_argv"]
    for i, a in enumerate(argv):
        if a.startswith("--include="):
            out.append(a.split("=", 1)[1])
        elif a == "--include" and i + 1 < len(argv):
            out.append(argv[i + 1])
    return out


def intent(call, terms):
    pats = call.get("patterns") or []
    if any(DEF_SHAPED.search(p + " ") for p in pats):
        return "definition"
    paths = operands(call) + includes(call)
    if any("test" in t or "spec" in t for t in terms) or any(TEST.search(p) or re.search(r"test|spec", p)
                                                              for p in paths):
        return "test"
    if any(CONFIG_EXT.search(p) for p in paths):
        return "configuration"
    if any(re.search(r"\\\.\w+\\?\(|\w\($|\w\\\($|->", p) or p.rstrip().endswith("(") for p in pats):
        return "call site"
    return "other"


def text_of(r):
    o = r.get("o") or ""
    if r["l"] is not None:
        for sep in (f":{r['l']}:", f"-{r['l']}-"):
            i = o.find(sep)
            if i >= 0:
                return o[i + len(sep):]
    return o.split(":", 1)[-1]


def prepare(rec):
    """Items, budgets and labels of one record; None if the call is not usable."""
    recs = rec["records"]
    flags = set(rec.get("flags") or [])
    ctx = bool(flags & CONTEXT)
    file_level = any(r["t"] == "f" for r in recs)
    for r in recs:  # definition level for file records uses the file label
        if r["t"] == "f":
            r["D"] = r["F"]
            r["L"] = False
    items = []
    if ctx and not file_level:
        cur = None
        for i, r in enumerate(recs):
            if cur and r["p"] == recs[cur[-1]]["p"] and r["l"] is not None and recs[cur[-1]]["l"] is not None \
                    and r["l"] == recs[cur[-1]]["l"] + 1:
                cur.append(i)
            else:
                cur = [i]
                items.append(cur)
    else:
        items = [[i] for i in range(len(recs))]
    terms = terms_of(rec.get("patterns"))
    n = rec["head"] if rec.get("head_cut") and rec.get("head") else len(rec["visible"])
    files = collections.OrderedDict()
    for j, it in enumerate(items):
        files.setdefault(recs[it[0]]["p"], []).append(j)
    decl = [any(recs[i]["t"] in ("m", "f") and DECL.match(text_of(recs[i])) for i in it) for it in items]
    hits = {f: sum(1 for j in js for i in items[j] if recs[i]["t"] in ("m", "f")) or len(js)
            for f, js in files.items()}
    for f in hits:
        if file_level:
            cnt = [recs[items[j][0]].get("n") for j in files[f]]
            hits[f] = cnt[0] if cnt and cnt[0] else 1
    ev = {lvl: any(r.get(lvl) for r in recs) for lvl in LEVELS}
    return {"rec": rec, "recs": recs, "items": items, "ctx": ctx and not file_level, "files": files, "decl": decl,
            "hits": hits, "n": n, "terms": terms, "intent": intent(rec, terms), "ev": ev,
            "test_target": any("test" in t or "spec" in t for t in terms)
            or any(TEST.search(p) or re.search(r"test|spec", p) for p in operands(rec) + includes(rec))}


def kind(path):
    if GENERATED.search(path):
        return "generated"
    if TEST.search(path):
        return "test"
    return "source"


# ---------------------------------------------------------------- policies (orders of item indices)

def file_features(c, f):
    h = c["hits"][f]
    total = sum(c["hits"].values()) or 1
    k = kind(f)
    low = f.lower()
    return [math.log1p(h), h / (h + 2), h / total, float(k == "test"), float(k == "generated"),
            float(any(c["decl"][j] for j in c["files"][f])), float(any(t in low for t in c["terms"])),
            float(f.count("/")), float(c["test_target"] and k == "test")]


def selector(c, P):
    """Reveal order of the parametrized selector (phase 1, Sainte-Laguë phase 2, declarations first)."""
    weight = {}
    for f in c["files"]:
        if P["lr"] is not None:
            w = P["lr"](file_features(c, f))
        else:
            h = c["hits"][f]
            k = kind(f)
            prior = {"source": 1.0, "test": P["test"], "generated": P["gen"]}[k]
            if P["test_intent"] and k == "test" and c["test_target"]:
                prior = 1.0
            w = h / (h + P["k"]) * prior
            if P["path_boost"] != 1.0 and any(t in f.lower() for t in c["terms"]):
                w *= P["path_boost"]
            if P["depth_g"]:
                w /= 1 + P["depth_g"] * f.count("/")
        weight[f] = w
    admitted = sorted(c["files"], key=lambda f: (-weight[f], f))
    use_decl = P["decl"] == "always" or (P["decl"] == "defpattern" and c["intent"] == "definition")
    queues = {}
    for f in admitted:
        js = c["files"][f]
        queues[f] = ([j for j in js if c["decl"][j]] + [j for j in js if not c["decl"][j]]) if use_decl else list(js)
    out = [queues[f].pop(0) for f in admitted]
    phase1 = len(out)
    taken = {f: 1 for f in admitted}
    while True:
        best = None
        for f in admitted:
            if queues[f]:
                q = weight[f] / (2 * taken[f] + 1)
                if best is None or q > best[0]:
                    best = (q, f)
        if best is None:
            break
        f = best[1]
        out.append(queues[f].pop(0))
        taken[f] += 1
    return out, phase1


def native(c):
    return list(range(len(c["items"])))


def path_sorted(c):
    return sorted(range(len(c["items"])), key=lambda j: (c["recs"][c["items"][j][0]]["p"],
                                                         c["recs"][c["items"][j][0]]["l"] or 0))


def round_robin(c):
    files = sorted(c["files"])
    queues = {f: sorted(c["files"][f], key=lambda j: c["recs"][c["items"][j][0]]["l"] or 0) for f in files}
    out = []
    while any(queues.values()):
        for f in files:
            if queues[f]:
                out.append(queues[f].pop(0))
    return out


def frequency(c):
    files = sorted(c["files"], key=lambda f: (-c["hits"][f], f))
    return [j for f in files for j in sorted(c["files"][f], key=lambda j: c["recs"][c["items"][j][0]]["l"] or 0)]


def oracle(c):
    ev = [any(c["recs"][i].get("D") for i in it) for it in c["items"]]
    return sorted(range(len(c["items"])), key=lambda j: (not ev[j], j))


def shown_by(c, order, budget):
    """Record indices in the first `budget` printed lines of the items in `order`."""
    shown, used = set(), 0
    for n_item, j in enumerate(order):
        if c["ctx"] and n_item > 0:
            used += 1  # grep's `--` between groups
        for i in c["items"][j]:
            if used >= budget:
                return shown
            shown.add(i)
            used += 1
        if used >= budget:
            break
    return shown


def reaches_phase2(c, budget):
    """True if the shipped selector's first `budget` lines start an item beyond phase 1."""
    order, phase1 = selector(c, SHIPPED)
    used = 0
    for n_item, j in enumerate(order):
        if used >= budget:
            return False
        if n_item >= phase1:
            return True
        used += len(c["items"][j]) + (1 if c["ctx"] and n_item > 0 else 0)
    return False


def as_seen(c):
    return set(c["rec"]["shown"])


def miss(c, shown, lvl):
    return c["ev"][lvl] and not any(c["recs"][i].get(lvl) for i in shown)


# ---------------------------------------------------------------- statistics

def wilson(k, n, z=1.96):
    if not n:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    m = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (m - h, m + h)


def cluster_ci(values, repos, reps=2000, seed=42):
    """Cluster bootstrap by repository for a mean of per-call values."""
    by = collections.defaultdict(list)
    for v, r in zip(values, repos):
        by[r].append(v)
    keys = sorted(by)
    rng = random.Random(seed)
    stats = []
    for _ in range(reps):
        tot, n = 0.0, 0
        for _ in keys:
            vs = by[keys[rng.randrange(len(keys))]]
            tot += sum(vs)
            n += len(vs)
        stats.append(tot / n if n else 0.0)
    stats.sort()
    return stats[int(0.025 * reps)], stats[int(0.975 * reps) - 1]


def fmt_rate(k, n):
    lo, hi = wilson(k, n)
    return f"{k}/{n} ({100 * k / n:.1f}%; Wilson {100 * lo:.1f}–{100 * hi:.1f}%)" if n else "–"


# ---------------------------------------------------------------- learned ranker

def train_lr(calls, epochs=300, l2=1.0, lr=0.1):
    X, y = [], []
    for c in calls:
        for f in c["files"]:
            X.append(file_features(c, f))
            y.append(float(any(c["recs"][i].get("D") for j in c["files"][f] for i in c["items"][j])))
    d = len(X[0])
    mu = [sum(x[i] for x in X) / len(X) for i in range(d)]
    sd = [max(1e-9, math.sqrt(sum((x[i] - mu[i]) ** 2 for x in X) / len(X))) for i in range(d)]
    Z = [[(x[i] - mu[i]) / sd[i] for i in range(d)] for x in X]
    w, b, n = [0.0] * d, 0.0, len(Z)
    for _ in range(epochs):
        gw, gb = [0.0] * d, 0.0
        for z, t in zip(Z, y):
            s = b + sum(wi * zi for wi, zi in zip(w, z))
            p = 1 / (1 + math.exp(-max(-30, min(30, s))))
            e = p - t
            gb += e
            for i in range(d):
                gw[i] += e * z[i]
        w = [wi - lr * (g / n + l2 * wi / n) for wi, g in zip(w, gw)]
        b -= lr * gb / n

    def score(x):
        s = b + sum(wi * (xi - m) / s_ for wi, xi, m, s_ in zip(w, x, mu, sd))
        return 1 / (1 + math.exp(-max(-30, min(30, s))))
    return score, {"w": w, "b": b}


# ---------------------------------------------------------------- main

def families():
    fam = collections.OrderedDict()
    fam["1 k"] = [dict(SHIPPED, k=v) for v in (2.0, 1.0, 4.0, 8.0)]
    fam["2 priors"] = [dict(SHIPPED, test=t, gen=g) for t, g in [(0.5, 0.25)] +
                       [(t, g) for t in (0.25, 0.5, 1.0) for g in (0.1, 0.25, 0.5) if (t, g) != (0.5, 0.25)]]
    fam["3 declarations"] = [dict(SHIPPED, decl=v) for v in ("always", "never", "defpattern")]
    fam["4 test intent"] = [dict(SHIPPED, test_intent=v) for v in (False, True)]
    fam["5a path term"] = [dict(SHIPPED, path_boost=v) for v in (1.0, 1.5, 2.0)]
    fam["5b depth"] = [dict(SHIPPED, depth_g=v) for v in (0.0, 0.1, 0.3)]
    return fam


def label(P):
    diff = {k: v for k, v in P.items() if SHIPPED.get(k) != v and k != "lr"}
    return ", ".join(f"{k}={v}" for k, v in diff.items()) or "shipped"


def read_lines(path):
    """Lines of a gzip JSONL file; stops cleanly at a member that is still being written."""
    f = gzip.open(path, "rt")
    while True:
        try:
            line = f.readline()
        except (EOFError, OSError):
            return
        if not line:
            return
        if line.endswith("\n"):
            yield line


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--records", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pilot", type=int, default=500)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    tiers, all_cut, calls_ov = collections.Counter(), [], []
    for line in read_lines(a.records):
        rec = json.loads(line)
        tiers[rec["tier"]] += 1
        if rec["tier"] not in ("O", "O+") or not rec.get("zip_ok") or not rec.get("records"):
            continue
        c = prepare(rec)
        all_cut.append(c)
        if len(c["recs"]) > c["n"] and rec.get("overflow"):
            calls_ov.append(c)

    # Check: the parametrized selector reproduces ranker.py on no-context, -n calls.
    checked = bad = 0
    for c in calls_ov[:400]:
        if c["ctx"] or any(r["t"] == "f" for r in c["recs"]) or not all(r.get("o") for r in c["recs"]):
            continue
        lines = [r["o"] for r in c["recs"]]
        if len(set(lines)) != len(lines):
            continue
        numbered = all(r["l"] is not None for r in c["recs"]) and "-n" in (c["rec"].get("flags") or [])
        if not numbered or len(c["files"]) < 2:  # one file: grep prints no path, ranker.py cannot parse it
            continue
        ref, _ = reveal_order(lines, True)
        ours, _ = selector(c, SHIPPED)
        checked += 1
        bad += [c["recs"][c["items"][j][0]]["o"] for j in ours] != ref
    print(f"selector check against ranker.py: {checked - bad}/{checked} identical orders", file=sys.stderr)

    # ---------------- Gate A (E1 pilot)
    evb = {lvl: [c for c in calls_ov if c["ev"][lvl]] for lvl in LEVELS}
    rng = random.Random(42)
    pilot = rng.sample(evb["D"], min(a.pilot, len(evb["D"])))
    pilot_ids = {id(c) for c in pilot}
    gate = {"tiers": dict(tiers), "cut_usable": len(all_cut), "overflowing": len(calls_ov),
            "evidence_bearing_overflowing": {lvl: len(evb[lvl]) for lvl in LEVELS},
            "selector_check": [checked - bad, checked]}
    policies = {"as seen": lambda c, B: as_seen(c),
                "native order (APFS replay)": lambda c, B: shown_by(c, native(c), B),
                "sorted path order": lambda c, B: shown_by(c, path_sorted(c), B),
                "round robin": lambda c, B: shown_by(c, round_robin(c), B),
                "frequency order": lambda c, B: shown_by(c, frequency(c), B),
                "shipped selector": lambda c, B: shown_by(c, selector(c, SHIPPED)[0], B),
                "shipped selector + header": lambda c, B: shown_by(c, selector(c, SHIPPED)[0], max(B - 1, 0)),
                "oracle": lambda c, B: shown_by(c, oracle(c), B)}
    rows = {}
    for scope, pool in (("pilot 500 (D-evidence-bearing)", pilot), ("all dev", None)):
        for lvl in LEVELS:
            base = pool if pool is not None else evb[lvl]
            for name, fn in policies.items():
                ms = [miss(c, fn(c, c["n"]), lvl) for c in base]
                lo, hi = cluster_ci([float(m) for m in ms], [c["rec"]["repo"] for c in base], reps=1000)
                rows[(scope, lvl, name)] = {"miss": sum(ms), "n": len(base), "rate": sum(ms) / max(1, len(base)),
                                            "cluster_ci": [lo, hi],
                                            "tasks": len({c["rec"]["instance_id"] for c, m in zip(base, ms) if m}),
                                            "repos": len({c["rec"]["repo"] for c, m in zip(base, ms) if m})}
    gate["rows"] = [{"scope": k[0], "level": k[1], "policy": k[2], **v} for k, v in rows.items()]
    gate["pilot_units"] = {"calls": len(pilot), "tasks": len({c["rec"]["instance_id"] for c in pilot}),
                           "repos": len({c["rec"]["repo"] for c in pilot}),
                           "trajectories": len({c["rec"]["trajectory_id"] for c in pilot})}
    # Bases 2 and 3 for the as-seen definition-level misses (pilot rate scaled to the full dev pool).
    m_all = sum(miss(c, as_seen(c), "D") for c in evb["D"])
    gate["bases_as_seen_D"] = {"evidence_bearing_overflowing": [m_all, len(evb["D"])],
                               "eligible_overflowing": [m_all, len(calls_ov)],
                               "eligible_cut_usable": [m_all, len(all_cut)]}
    # Paired outcomes, shipped selector vs as seen / round robin, pilot, definition level.
    pairs = {}
    for ref in ("as seen", "round robin"):
        for cand in ("shipped selector", "shipped selector + header"):
            rec_ = lost = 0
            for c in pilot:
                mr = miss(c, policies[ref](c, c["n"]), "D")
                mc = miss(c, policies[cand](c, c["n"]), "D")
                rec_ += mr and not mc
                lost += mc and not mr
            pairs[f"{cand} vs {ref}"] = {"recovered": rec_, "newly_lost": lost, "net": rec_ - lost, "n": len(pilot)}
    gate["paired_pilot_D"] = pairs
    gate["phase2_share_pilot"] = [sum(reaches_phase2(c, c["n"]) for c in pilot), len(pilot)]
    # Sensitivity: each hidden record missing with probability r (reconstruction error), as seen, D level.
    sens = {}
    for r_ in (0.05, 0.10, 0.20):
        rng2 = random.Random(42)
        k = n = 0
        for c in calls_ov:
            shown = as_seen(c)
            kept = [i for i in range(len(c["recs"])) if i in shown or rng2.random() >= r_]
            ev = any(c["recs"][i].get("D") for i in kept)
            if not ev:
                continue
            n += 1
            k += not any(c["recs"][i].get("D") for i in shown)
        sens[str(r_)] = [k, n]
    gate["sensitivity_as_seen_D"] = sens
    json.dump(gate, open(os.path.join(a.out, "gate_a.json"), "w"), indent=1)

    # ---------------- tuning round (§5.4), definition level, no header
    data = evb["D"]
    repos = sorted({c["rec"]["repo"] for c in data})
    random.Random(42).shuffle(repos)
    fold_of = {r: i % 5 for i, r in enumerate(repos)}
    folds = [[c for c in data if fold_of[c["rec"]["repo"]] == f] for f in range(5)]

    def miss_vec(P, cs):
        return [miss(c, shown_by(c, selector(c, P)[0], c["n"]), "D") for c in cs]

    shipped_vec = {id(c): m for c, m in zip(data, miss_vec(SHIPPED, data))}
    results = []
    fixed_scores = {}
    for name, grid in families().items():
        oof, chosen = {}, []
        cache = {i: miss_vec(P, data) for i, P in enumerate(grid)}
        for i in cache:
            fixed_scores[(name, label(grid[i]))] = sum(cache[i]) / len(data)
        idx = {id(c): n for n, c in enumerate(data)}
        for f in range(5):
            train = [idx[id(c)] for g in range(5) if g != f for c in folds[g]]
            best = min(range(len(grid)), key=lambda i: (sum(cache[i][t] for t in train), i))
            chosen.append(label(grid[best]))
            for c in folds[f]:
                oof[id(c)] = cache[best][idx[id(c)]]
        results.append((name, oof, chosen))
    # Learned ranker
    oof, chosen = {}, []
    for f in range(5):
        train = [c for g in range(5) if g != f for c in folds[g]]
        score, model = train_lr(train)
        P = dict(SHIPPED, lr=score)
        for c, m in zip(folds[f], miss_vec(P, folds[f])):
            oof[id(c)] = m
        chosen.append("lr " + " ".join(f"{w:+.2f}" for w in model["w"]))
    results.append(("6 learned ranker", oof, chosen))

    n = len(data)
    base_rate = sum(shipped_vec.values()) / n
    strata = collections.Counter(c["intent"] for c in data)
    table = []
    for name, oof, chosen in results:
        rate = sum(oof.values()) / n
        lost = sum(1 for c in data if not shipped_vec[id(c)] and oof[id(c)]) / n
        recov = sum(1 for c in data if shipped_vec[id(c)] and not oof[id(c)]) / n
        guard = {}
        for s, cnt in strata.items():
            cs = [c for c in data if c["intent"] == s]
            d = (sum(oof[id(c)] for c in cs) - sum(shipped_vec[id(c)] for c in cs)) / len(cs)
            guard[s] = {"n": cnt, "delta": d}
        guard_ok = all(g["delta"] <= 0.03 for g in guard.values() if g["n"] >= 50)
        passes = (base_rate - rate) >= 0.02 and lost <= 0.01 and guard_ok
        table.append({"family": name, "oof_miss": rate, "delta_pp": 100 * (rate - base_rate),
                      "newly_lost": lost, "recovered": recov, "guard": guard, "guard_ok": guard_ok,
                      "passes": passes, "chosen_per_fold": chosen})
    json.dump({"n": n, "repos": len(repos), "tasks": len({c["rec"]["instance_id"] for c in data}),
               "shipped_miss": base_rate, "strata": dict(strata), "families": table,
               "fixed_settings": [{"family": k[0], "setting": k[1], "miss": v} for k, v in fixed_scores.items()]},
              open(os.path.join(a.out, "tuning.json"), "w"), indent=1)
    print(json.dumps({"gate": {k: gate[k] for k in ("tiers", "evidence_bearing_overflowing", "pilot_units",
                                                     "paired_pilot_D", "phase2_share_pilot")},
                      "tuning_shipped": base_rate, "n": n}, indent=1))


if __name__ == "__main__":
    main()
