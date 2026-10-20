"""Dev replay tables (GREP_PAPER_PLAN.md S2, E0 replay parts, E1 output 1), Markdown on stdout.

Reads frozen dev records only. Usage:
  python replay_report.py --cut records-cut.jsonl.gz [--uncut records-uncut.jsonl.gz]
"""

import argparse
import collections
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tune import read_lines  # noqa: E402


def pct(a, b):
    return f"{100 * a / b:.1f}%" if b else "–"


def q(xs, p):
    if not xs:
        return "–"
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))]


def size_bucket(n):
    for lim in (10, 30, 100, 300, 1000):
        if n <= lim:
            return f"≤{lim}"
    return ">1000"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cut", required=True)
    ap.add_argument("--uncut")
    a = ap.parse_args()

    tiers = collections.defaultdict(collections.Counter)
    reasons = collections.Counter()
    ov = []
    for line in read_lines(a.cut):
        r = json.loads(line)
        tiers[r.get("harness") or "?"][r["tier"]] += 1
        if r["tier"] == "X":
            why = r.get("reason") or "?"
            reasons[why.split(":")[0][:50] if not why[0].isdigit() else "visible lines not in replay"] += 1
        elif r.get("overflow"):
            ov.append(r)
    print("## Replay of eligible cut calls (SWE-rebench-V2, dev)\n")
    print("| Harness | Calls | O+ | O | X | Agree (O+ and O) |")
    print("|---|---:|---:|---:|---:|---:|")
    tot = collections.Counter()
    for h in sorted(tiers):
        c = tiers[h]
        tot.update(c)
        n = sum(c.values())
        print(f"| {h} | {n:,} | {c['O+']:,} | {c['O']:,} | {c['X']:,} | {pct(c['O+'] + c['O'], n)} |")
    n = sum(tot.values())
    print(f"| **All** | {n:,} | {tot['O+']:,} | {tot['O']:,} | {tot['X']:,} | {pct(tot['O+'] + tot['O'], n)} |")
    print("\nTier X reasons:\n")
    for k, v in reasons.most_common(10):
        print(f"- {k}: {v:,}")

    agree = tot["O+"] + tot["O"]
    print(f"\n## Overflowing calls (tiers O+ and O, full output longer than the budget)\n")
    print(f"- {len(ov):,} of {agree:,} agreeing cut calls overflow ({pct(len(ov), agree)}); "
          f"{len({r['instance_id'] for r in ov}):,} tasks, {len({r['repo'] for r in ov}):,} repositories.")
    full = [r["full_lines"] for r in ov]
    files = [r["n_files"] for r in ov]
    ratio = [r["full_lines"] / max(1, len(r["visible"])) for r in ov]
    print(f"- Full output lines: median {statistics.median(full):.0f}, 90th percentile {q(full, 0.9)}, "
          f"maximum {max(full):,}.")
    print(f"- Files in the full output: median {statistics.median(files):.0f}, 90th percentile {q(files, 0.9)}.")
    print(f"- Full / visible lines: median {statistics.median(ratio):.1f}.")
    # The travelling figure: share of matching files that survive the cut (as seen).
    surv = []
    for r in ov:
        allf = {x["p"] for x in r["records"]}
        seen = {r["records"][i]["p"] for i in r["shown"]}
        surv.append(len(seen) / max(1, len(allf)))
    print(f"- **Share of matching files that the agent saw** (as seen): mean {100 * statistics.mean(surv):.1f}%, "
          f"median {100 * statistics.median(surv):.1f}%.\n")
    by_n = collections.defaultdict(list)
    for r, s in zip(ov, surv):
        by_n[r.get("head") if r.get("head_cut") else "harness"].append(s)
    print("| Agent's limit N | Calls | Mean share of matching files seen |")
    print("|---|---:|---:|")
    for k in sorted(by_n, key=lambda x: (isinstance(x, str), x if not isinstance(x, str) else 0)):
        if len(by_n[k]) >= 30:
            print(f"| {k} | {len(by_n[k]):,} | {100 * statistics.mean(by_n[k]):.1f}% |")
    print("\n## L1 evidence in the full output (overflowing calls)\n")
    print("| Level | Evidence-bearing calls | Share | Tasks | Repositories |")
    print("|---|---:|---:|---:|---:|")
    for lvl, name in (("D", "definition (primary)"), ("F", "file"), ("L", "line (strict)")):
        e = [r for r in ov if r.get(f"ev_{lvl}") or (lvl == "D" and any(x["t"] == "f" and x["F"]
                                                                          for x in r["records"]))]
        print(f"| {name} | {len(e):,} | {pct(len(e), len(ov))} | {len({r['instance_id'] for r in e}):,} "
              f"| {len({r['repo'] for r in e}):,} |")

    if a.uncut and os.path.exists(a.uncut):
        by = collections.defaultdict(collections.Counter)
        ureasons = collections.Counter()
        for line in read_lines(a.uncut):
            r = json.loads(line)
            b = size_bucket(r.get("n_lines") or 0)
            by[b][r["tier"]] += 1
            if r["tier"] == "X":
                ureasons[(r.get("reason") or "?")[:40]] += 1
        print("\n## Replay agreement on uncut calls (seed-42 sample, a diagnostic)\n")
        print("| Visible lines | Calls | F (agree) | X | Agreement |")
        print("|---|---:|---:|---:|---:|")
        t = collections.Counter()
        for b in ("≤10", "≤30", "≤100", "≤300", "≤1000", ">1000"):
            if by[b]:
                c = by[b]
                t.update(c)
                m = sum(c.values())
                print(f"| {b} | {m:,} | {c['F']:,} | {c['X']:,} | {pct(c['F'], m)} |")
        m = sum(t.values())
        print(f"| **All** | {m:,} | {t['F']:,} | {t['X']:,} | {pct(t['F'], m)} |")
        print("\nTier X reasons (uncut):", ", ".join(f"{k}: {v}" for k, v in ureasons.most_common(6)))


if __name__ == "__main__":
    main()
