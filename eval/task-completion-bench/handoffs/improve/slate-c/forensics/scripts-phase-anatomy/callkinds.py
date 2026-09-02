#!/usr/bin/env python3
"""callkinds.py -- per-CALL kind census by phase and arm (operations, not requests), from data/anatomy.json.
A request may carry several calls (opencode/claude parallel emission). Kind priority per call:
edit > test > exec > delegate > read > search > git > poll > plan > other."""
import json, os, sys, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from aggregate import rephase, mean, PHASES
KINDS = ['edit', 'test', 'exec', 'delegate', 'read', 'search', 'git', 'poll', 'plan', 'other']
BOUNDARY = sys.argv[sys.argv.index('--boundary') + 1] if '--boundary' in sys.argv else 'sight'
d = json.load(open(os.path.join(HERE, 'data', 'anatomy.json')))
def kind_of(ks):
    for k in KINDS:
        if k in ks:
            return k
    return 'other'
for h, H in d['harnesses'].items():
    rolls = H['rollouts']
    byarm = {a: [r for r in rolls if r['arm'] == a] for a in ('native', 'sweet')}
    print(f"\n# {h} -- tool CALLS per rollout by phase and kind (native / sweet), boundary={BOUNDARY}, rollouts {len(byarm['native'])}/{len(byarm['sweet'])}")
    print("| phase | " + " | ".join(KINDS) + " | all |")
    print("|---|" + "---|" * (len(KINDS) + 1))
    tot = {a: collections.Counter() for a in byarm}
    for p in PHASES:
        cells = []
        rowtot = {}
        for k in KINDS + ['all']:
            v = {}
            for a, rs in byarm.items():
                cnt = []
                for r in rs:
                    ph = rephase(r, BOUNDARY)
                    c = 0
                    for q, pp in zip(r['requests'], ph):
                        if pp != p:
                            continue
                        for ks in q['call_kinds']:
                            if k == 'all' or kind_of(ks) == k:
                                c += 1
                    cnt.append(c)
                v[a] = mean(cnt)
                if k != 'all':
                    tot[a][k] += v[a]
            cells.append(f"{v['native']:.2f}/{v['sweet']:.2f}" if (v['native'] or v['sweet']) else "·")
        print(f"| {p} | " + " | ".join(cells) + " |")
    print("| TOTAL | " + " | ".join(f"{tot['native'][k]:.2f}/{tot['sweet'][k]:.2f}" for k in KINDS) + f" | {sum(tot['native'].values()):.2f}/{sum(tot['sweet'].values()):.2f} |")
    # error-bearing calls by kind and arm
    print("\nerror-bearing CALLS per rollout by kind (native / sweet):")
    for k in KINDS:
        v = {}
        for a, rs in byarm.items():
            v[a] = mean([sum(1 for q in r['requests'] for ks, e in zip(q['call_kinds'], q['call_err']) if e and kind_of(ks) == k) for r in rs])
        if v['native'] or v['sweet']:
            print(f"  {k}: {v['native']:.2f} / {v['sweet']:.2f}")
    # bytes by kind
    print("tool-result BYTES per rollout by kind (native / sweet):")
    for k in KINDS:
        v = {}
        for a, rs in byarm.items():
            v[a] = mean([sum(b for ks, b in zip(q['call_kinds'], q['call_bytes']) if kind_of(ks) == k) for r in rs for q in r['requests']]) * (len(rs and [1]) and 1)
            v[a] = sum(sum(b for ks, b in zip(q['call_kinds'], q['call_bytes']) if kind_of(ks) == k) for r in rs for q in r['requests']) / len(rs)
        if v['native'] or v['sweet']:
            print(f"  {k}: {v['native']:,.0f} / {v['sweet']:,.0f}")
