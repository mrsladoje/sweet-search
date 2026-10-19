"""Edit-detector check (GREP_PAPER_PLAN.md §3.2 rule 1, step S1): draw 50 dev trajectories and render
their tool calls for a blind hand check. The detector's answer is written to a separate key file.

Usage: python edit_check_sample.py --edits first-edits-dev.jsonl --out DIR [--n 50] [--seed 42]
    [--exclude key.jsonl]   (a second, fresh sample: seed 43, excluding the first sample)
"""

import argparse
import collections
import json
import os
import random

import pyarrow.parquet as pq

from traces import _loads


def render(row):
    msgs = _loads(row["messages"])
    out, step = [], 0
    for m in msgs:
        if m["role"] != "assistant":
            continue
        for tc in m.get("tool_calls") or []:
            step += 1
            fn = tc.get("function", {}).get("name")
            try:
                args = _loads(tc["function"].get("arguments") or "{}") or {}
            except ValueError:
                args = {}
            if fn in ("bash", "execute_bash"):
                body = (args.get("command") or "")[:1500]
            elif fn == "str_replace_editor":
                body = f"{args.get('command')} {args.get('path')}"
            else:
                body = json.dumps(args)[:200]
            out.append(f"[step {step}] {fn}: {body}")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--edits", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--exclude")
    a = ap.parse_args()
    skip = {json.loads(x)["trajectory_id"] for x in open(a.exclude)} if a.exclude else set()
    by_h = collections.defaultdict(list)
    for line in open(a.edits):
        r = json.loads(line)
        if r["trajectory_id"] in skip:
            continue
        by_h[r["stratum"].split("/")[0]].append(r)
    rng = random.Random(a.seed)
    hs = sorted(by_h)
    sample = []
    for i, h in enumerate(hs):
        k = a.n // len(hs) + (1 if i < a.n % len(hs) else 0)
        sample += rng.sample(by_h[h], k)
    rng.shuffle(sample)
    os.makedirs(a.out, exist_ok=True)
    key = open(os.path.join(a.out, "key.jsonl"), "w")
    for part in range(2):
        with open(os.path.join(a.out, f"blind-{part + 1}.txt"), "w") as f:
            for j, r in enumerate(sample[part::2]):
                row = pq.read_table(r["shard"], columns=["messages"]).slice(r["row"], 1).to_pylist()[0]
                f.write(f"===== TRAJECTORY {r['trajectory_id']} =====\n{render(row)}\n\n")
    for r in sample:
        key.write(json.dumps(r) + "\n")


if __name__ == "__main__":
    main()
