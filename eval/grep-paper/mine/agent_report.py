"""Agent pilot summary (GREP_PAPER_PLAN.md E5d): cost, turns, stop reasons and fix-file hits per design and arm.

A harness and cost check, not evidence. Usage: python agent_report.py --out DIR (the agent_run.py --out)
"""

import argparse
import collections
import json
import os
import statistics


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    print("| Design | Arm | Runs | Aborted | $ / run (mean) | $ / run (max) | Turns / run | Stop reasons "
          "| Fix file at start | New fix file by grep (strict) | Turn of it (median) | Edit in a fix file "
          "| Turns to edit (median) |")
    print("|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|")
    total = 0.0
    errors = collections.Counter()
    for design in ("resume", "fresh"):
        path = os.path.join(a.out, f"runs-{design}.jsonl")
        if not os.path.exists(path):
            continue
        by = collections.defaultdict(list)
        for line in open(path):
            r = json.loads(line)
            by[r["arm"]].append(r)
            total += r["usd"]
            if r["stop"] == "aborted":
                errors[r.get("stop_detail", "?")[:120]] += 1
            for t in r["turns"]:
                for c in t["calls"]:
                    if c["name"] not in ("execute_bash", "str_replace_editor", "think", "finish"):
                        errors[f"unknown tool {c['name']}"] += 1
        for arm in sorted(by):
            rs = [r for r in by[arm] if r["stop"] != "aborted"]
            ab = len(by[arm]) - len(rs)
            if not rs:
                print(f"| {design} | {arm} | 0 | {ab} | – | – | – | – | – | – | – | – | – |")
                continue
            usd = [r["usd"] for r in rs]
            stops = collections.Counter(r["stop"] for r in rs)
            start = sum(bool(r.get("gold_at_start")) for r in rs)
            new = [r["first_new_gold_grep_turn"] for r in rs if r.get("first_new_gold_grep_turn") is not None]
            edits = [r for r in rs if r["stop"] == "edit"]
            et = [r["edit_turn"] for r in edits if r.get("edit_turn") is not None]
            med = lambda xs: f"{statistics.median(xs):.0f}" if xs else "–"
            print(f"| {design} | {arm} | {len(rs)} | {ab} | {statistics.mean(usd):.4f} | {max(usd):.4f} "
                  f"| {statistics.mean(len(r['turns']) for r in rs):.1f} "
                  f"| {', '.join(f'{k} {v}' for k, v in stops.most_common())} | {start}/{len(rs)} "
                  f"| {len(new)}/{len(rs)} | {med(new)} | {sum(r['edit_in_gold'] for r in edits)}/{len(edits)} "
                  f"| {med(et)} |")
    ledger = os.path.join(a.out, "ledger.jsonl")
    spent = sum(json.loads(x)["usd"] for x in open(ledger)) if os.path.exists(ledger) else 0.0
    print(f"\nLedger total: ${spent:.4f} (runs ${total:.4f}).")
    print("Harness errors and aborts: " + (", ".join(f"{k}: {v}" for k, v in errors.items()) or "none"))


if __name__ == "__main__":
    main()
