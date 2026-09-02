#!/usr/bin/env python3
"""extras.py -- (a) claude native failed-Read request cost; (b) claude sidechain requests by phase; (c) solved-everywhere vs
other-task subset comparison; (d) edit-before-read share. Reads data/anatomy.json and data/anatomy-alltasks.json."""
import json, os, sys, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from aggregate import mean, PHASES, rephase
SE = json.load(open(os.path.join(HERE, 'data', 'anatomy.json')))
ALL = json.load(open(os.path.join(HERE, 'data', 'anatomy-alltasks.json')))

print("## (a) failed-READ requests (every call in the request is an error-bearing read-class call), per rollout")
for label, D in (('solved-everywhere', SE), ('all 22 tasks', ALL)):
    for h, H in D['harnesses'].items():
        for arm in ('native', 'sweet'):
            rs = [r for r in H['rollouts'] if r['arm'] == arm]
            fr = [[q for q in r['requests'] if q['class'] == 'read' and q['n_calls'] > 0 and all(q['call_err'])] for r in rs]
            n = mean([len(x) for x in fr]); c = mean([sum(q['cost'] for q in x) for x in fr]); tot = mean([r['tot_cost'] for r in rs])
            resent = mean([sum(q['resent'] for q in x) for x in fr]); out = mean([sum(q['out'] for q in x) for x in fr])
            print(f"  {label:18s} {h:12s} {arm:6s}: {n:.2f} failed-read requests/rollout, cost {c:.6f} = {100*c/tot:.1f}% of {tot:.6f}; resent {resent:,.0f} out {out:.0f}")

print("\n## (b) claude-code sidechain (subagent) requests attributed to the parent's phase, per rollout (solved-everywhere)")
H = SE['harnesses']['claude-code']
for arm in ('native', 'sweet'):
    rs = [r for r in H['rollouts'] if r['arm'] == arm]
    row = {p: mean([r['side'][p]['req'] for r in rs]) for p in PHASES}
    cost = {p: mean([r['side'][p]['cost'] for r in rs]) for p in PHASES}
    files = sum(r['side_files'] for r in rs)
    rollouts_with = sum(1 for r in rs if r['side_files'])
    print(f"  {arm}: subagent files {files} in {rollouts_with}/{len(rs)} rollouts; requests by phase " + ", ".join(f"{p} {row[p]:.2f}" for p in PHASES) + f"; cost by phase " + ", ".join(f"{p} {cost[p]:.6f}" for p in PHASES))

print("\n## (c) subset comparison (all-task JSON): per-task paired means (sweet - native) per rollout, solved-everywhere vs other tasks")
for h, H in ALL['harnesses'].items():
    se = set(H['solved_everywhere'])
    by = collections.defaultdict(lambda: {'native': [], 'sweet': []})
    for r in H['rollouts']:
        by[r['task']][r['arm']].append(r)
    for label, sel in (('solved-everywhere', [t for t in by if t in se]), ('other tasks', [t for t in by if t not in se])):
        dc = [mean([r['tot_cost'] for r in by[t]['sweet']]) - mean([r['tot_cost'] for r in by[t]['native']]) for t in sel if by[t]['native'] and by[t]['sweet']]
        dr = [mean([r['n_req'] for r in by[t]['sweet']]) - mean([r['n_req'] for r in by[t]['native']]) for t in sel if by[t]['native'] and by[t]['sweet']]
        nc = mean([mean([r['tot_cost'] for r in by[t]['native']]) for t in sel])
        sc = mean([mean([r['tot_cost'] for r in by[t]['sweet']]) for t in sel])
        nr = mean([mean([r['n_req'] for r in by[t]['native']]) for t in sel])
        sr = mean([mean([r['n_req'] for r in by[t]['sweet']]) for t in sel])
        print(f"  {h:12s} {label:18s} tasks={len(sel):2d}: requests N {nr:.2f} S {sr:.2f} (Δ {mean(dr):+.2f}); cost N {nc:.6f} S {sc:.6f} (Δ {mean(dc):+.6f} = {100*mean(dc)/nc:+.1f}%)")
    # pool-wide (22 tasks) check against the brief
    allt = list(by)
    nc = mean([mean([r['tot_cost'] for r in by[t]['native']]) for t in allt]); sc = mean([mean([r['tot_cost'] for r in by[t]['sweet']]) for t in allt])
    print(f"  {h:12s} {'all 22 tasks':18s}: cost N {nc:.6f} S {sc:.6f} ({100*(sc-nc)/nc:+.1f}%)  [main thread, ideal price; brief: codex +0.3%, opencode +3.3%, claude -3.9% incl. sidechain]")

print("\n## (d) edit before any READ-tool read of the edited file (the agent edited from search output), share of rollouts")
for label, D in (('solved-everywhere', SE), ('all 22 tasks', ALL)):
    for h, H in D['harnesses'].items():
        for arm in ('native', 'sweet'):
            rs = [r for r in H['rollouts'] if r['arm'] == arm and r['marks']['first_edit'] is not None]
            k = sum(1 for r in rs if r['marks']['first_read'] is None or r['marks']['first_read'] > r['marks']['first_edit'])
            gap = mean([r['marks']['first_read'] - r['marks']['first_sight'] for r in rs if r['marks']['first_read'] is not None and r['marks']['first_sight'] is not None])
            print(f"  {label:18s} {h:12s} {arm:6s}: {k}/{len(rs)} rollouts edited before reading the edited file with a read tool; mean requests between first sight and first read {gap:.2f}")

print("\n## (e) error-bearing requests per rollout by class (solved-everywhere)")
for h, H in SE['harnesses'].items():
    for arm in ('native', 'sweet'):
        rs = [r for r in H['rollouts'] if r['arm'] == arm]
        c = collections.Counter()
        for r in rs:
            for q in r['requests']:
                if q['err']:
                    c[q['class']] += 1
        print(f"  {h:12s} {arm:6s}: " + ", ".join(f"{k} {v/len(rs):.2f}" for k, v in c.most_common()))
