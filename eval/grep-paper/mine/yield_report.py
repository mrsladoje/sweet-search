"""Aggregate the yield check: the funnel from trajectories to candidate overflowing calls.

Usage: python yield_report.py DIR   (DIR holds trajectories.jsonl from yield_check.py,
                                     and replay.jsonl from replay_sample.py if it exists)
"""

import collections
import json
import os
import sys

STEPS = [
    ("grep-family calls", lambda c: True),
    ("search files (not a stdin filter)", lambda c: c["searches_files"]),
    ("before the first edit", lambda c: c["searches_files"] and c["pre_edit"]),
    ("multi-file (-r, xargs, or 2+ paths)", lambda c: c["searches_files"] and c["pre_edit"] and c["multi"]),
    ("single grep in the command", lambda c: c["searches_files"] and c["pre_edit"] and c["multi"]
     and not c["multi_grep_command"]),
    ("visible output was cut", lambda c: c["searches_files"] and c["pre_edit"] and c["multi"]
     and not c["multi_grep_command"] and (c["head_cut"] or c["harness_cut"])),
]


def main():
    d = sys.argv[1]
    by = collections.defaultdict(lambda: collections.Counter())
    trajs = collections.Counter()
    cut_kinds = collections.Counter()
    for line in open(os.path.join(d, "trajectories.jsonl")):
        t = json.loads(line)
        h = t["stratum"].split("/")[0]
        trajs[h] += 1
        trajs["all"] += 1
        for c in t["calls"]:
            c["multi"] = c["recursive"] or c["via_xargs"] or c["n_operands"] > 1
            for name, f in STEPS:
                if f(c):
                    by[h][name] += 1
                    by["all"][name] += 1
            if STEPS[-1][1](c):
                cut_kinds[("head" if c["head_cut"] else "harness", h)] += 1
                by[h]["cut, gold file visible"] += c["gold_shown"]
                by["all"]["cut, gold file visible"] += c["gold_shown"]
    cols = sorted(k for k in trajs if k != "all") + ["all"]
    print("| step | " + " | ".join(cols) + " |")
    print("|---|" + "---:|" * len(cols))
    print("| trajectories | " + " | ".join(str(trajs[k]) for k in cols) + " |")
    for name in [n for n, _ in STEPS] + ["cut, gold file visible"]:
        print(f"| {name} | " + " | ".join(str(by[k][name]) for k in cols) + " |")
    n = trajs["all"]
    cut = by["all"][STEPS[-1][0]]
    print(f"\ncut candidate calls per trajectory: {cut / n:.3f}  -> per 5,000 trajectories: {cut / n * 5000:.0f}")
    print("cut kinds:", dict(cut_kinds))

    rp = os.path.join(d, "replay.jsonl")
    if os.path.exists(rp):
        recs = [json.loads(x) for x in open(rp)]
        for kind in ("cut", "uncut"):
            rs = [r for r in recs if r["kind"] == kind]
            ok = [r for r in rs if "skip" not in r]
            skips = collections.Counter(r["skip"].split(":")[0] for r in rs if "skip" in r)
            agree = [r for r in ok if r["visible_missing"] == 0]
            print(f"\nreplay {kind}: sampled {len(rs)}, replayed {len(ok)}, skipped {dict(skips)}")
            print(f"  every visible line found in replay: {len(agree)}/{len(ok)}")
            if kind == "cut":
                over = [r for r in agree if r["full_lines"] > r["visible_lines"]]
                ev = [r for r in over if r["full_has_gold"]]
                miss = [r for r in ev if not r["gold_shown"]]
                print(f"  agreeing and overflowing (full > visible): {len(over)}")
                print(f"  of those, gold file in full output (evidence-bearing, L1 file level): {len(ev)}")
                print(f"  of those, gold file NOT visible (truncation miss, file level): {len(miss)}")


if __name__ == "__main__":
    main()
