#!/usr/bin/env python3
"""Batching micro-smoke read-out: one line per run dir (= one variant), then per task.
Solves first (no-harm check), then cost, then model turns. Batching signals:
  calls/turn  — tool calls per model request (parallel calls raise it)
  chained     — shell calls that join several commands (&&, ;, newline, ||) / all shell calls
Usage: compare_batch.py results/bsmoke-<h>-<stamp>-L1 results/...-L2 ..."""
import json, os, re, sys

CHAIN = re.compile(r'&&|\|\||;\s*\S|\n\s*\S')


def trim_label(rows):
    return sorted({str(r.get('harnessTrim')) for r in rows})


def chained(d, task):
    f = os.path.join(d, 'trajectories', f'{task}-sweet-r0.json')
    if not os.path.exists(f):
        return 0, 0
    tr = json.load(open(f)).get('trajectory') or []
    shell = [c for c in tr if c.get('kind') in ('bash', 'ss', 'test') or c.get('name') in ('bash', 'Bash')]
    n = sum(1 for c in shell if CHAIN.search(str(c.get('input', ''))))
    return n, len(shell)


def main(dirs):
    per_task = {}
    print(f"{'run':38} {'variant':42} {'n':>2} {'solved':>6} {'real$':>7} {'ideal$':>7} {'turns':>5} {'calls':>5} {'c/turn':>6} {'chained':>9} flags")
    for d in dirs:
        p = os.path.join(d, 'rows.json')
        if not os.path.exists(p):
            print(f'{os.path.basename(d):38} (no rows.json yet)')
            continue
        rows = [r for r in json.load(open(p)) if r.get('arm') == 'sweet']
        solved = sum(1 for r in rows if r.get('resolved') is True)
        real = sum(float(r.get('costRealizedUsd') or 0) for r in rows)
        ideal = sum(float(r.get('idealCostUsd') or 0) for r in rows)
        turns = sum(int(r.get('idealTurns') or 0) for r in rows)
        calls = sum(int(r.get('calls') or 0) for r in rows)
        ch = [chained(d, r['taskId']) for r in rows]
        chn, shn = sum(a for a, _ in ch), sum(b for _, b in ch)
        flags = []
        for r in rows:
            for k in ('shimTampered', 'degenReran', 'rtInfra', 'escape', 'leak'):
                if r.get(k):
                    flags.append(f"{r['taskId'][:10]}:{k}")
            if r.get('resolved') is None:
                flags.append(f"{r['taskId'][:10]}:ungraded")
        label = ','.join(trim_label(rows))
        print(f'{os.path.basename(d):38} {label[:42]:42} {len(rows):>2} {solved:>6} {real:7.3f} {ideal:7.3f} {turns:5d} {calls:5d} {calls / max(turns, 1):6.2f} {chn:>4}/{shn:<4} {" ".join(flags)}')
        for r in rows:
            per_task.setdefault(r['taskId'], []).append((label.split('+batch-')[-1] if '+batch-' in label else label.split(':')[0], r))
    print('\nper task: variant solved real$ turns calls')
    for t, lst in sorted(per_task.items()):
        print(t)
        for lab, r in lst:
            print(f"   {lab[:28]:28} {str(r.get('resolved')):5} {float(r.get('costRealizedUsd') or 0):7.4f} {int(r.get('idealTurns') or 0):4d} {int(r.get('calls') or 0):4d}")


if __name__ == '__main__':
    main(sys.argv[1:])
