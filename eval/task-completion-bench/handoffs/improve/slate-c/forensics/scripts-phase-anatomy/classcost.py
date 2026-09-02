#!/usr/bin/env python3
"""classcost.py -- cost and tokens of requests by CLASS per arm per harness (solved-everywhere rollouts).
Cost model per request: 0.10*newIn + 0.01*resent + 0.60*out per million tokens (the brief's formula)."""
import json, os, sys, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from aggregate import mean, CLASSES
d = json.load(open(os.path.join(HERE, 'data', 'anatomy.json')))
for h, H in d['harnesses'].items():
    rolls = H['rollouts']
    byarm = {a: [r for r in rolls if r['arm'] == a] for a in ('native', 'sweet')}
    print(f"\n# {h} -- per rollout, by request class (native / sweet): requests, newIn, resent, out, cost, share of arm cost")
    print("| class | req N/S | newIn N/S | resent N/S | out N/S | cost N/S | share N/S |")
    print("|---|---|---|---|---|---|---|")
    totc = {a: mean([r['tot_cost'] for r in rs]) for a, rs in byarm.items()}
    for c in CLASSES:
        v = {}
        for a, rs in byarm.items():
            qs = [[q for q in r['requests'] if q['class'] == c] for r in rs]
            v[a] = dict(req=mean([len(x) for x in qs]), newIn=mean([sum(q['newIn'] for q in x) for x in qs]),
                        resent=mean([sum(q['resent'] for q in x) for x in qs]), out=mean([sum(q['out'] for q in x) for x in qs]),
                        cost=mean([sum(q['cost'] for q in x) for x in qs]))
        if v['native']['req'] or v['sweet']['req']:
            print(f"| {c} | {v['native']['req']:.2f}/{v['sweet']['req']:.2f} | {v['native']['newIn']:,.0f}/{v['sweet']['newIn']:,.0f} | {v['native']['resent']:,.0f}/{v['sweet']['resent']:,.0f} | {v['native']['out']:,.0f}/{v['sweet']['out']:,.0f} | {v['native']['cost']:.6f}/{v['sweet']['cost']:.6f} | {100*v['native']['cost']/totc['native']:.1f}%/{100*v['sweet']['cost']/totc['sweet']:.1f}% |")
    print(f"| TOTAL | {mean([r['n_req'] for r in byarm['native']]):.2f}/{mean([r['n_req'] for r in byarm['sweet']]):.2f} | | | | {totc['native']:.6f}/{totc['sweet']:.6f} | |")
    # marginal cost of a plan request: resent*0.01 + newIn*0.10 + out*0.60 -- already in cost. Also the tokens a plan call ADDS to context (its own input+output), approximated by newIn of the NEXT request minus that request's tool output? skip.
    # position of plan requests: share before first edit vs after
    for a, rs in byarm.items():
        pre = mean([sum(1 for q in r['requests'] if q['class'] == 'plan' and (r['marks']['first_edit'] is None or q['i'] < r['marks']['first_edit'])) for r in rs])
        post = mean([sum(1 for q in r['requests'] if q['class'] == 'plan' and r['marks']['first_edit'] is not None and q['i'] >= r['marks']['first_edit']) for r in rs])
        first = mean([1 if r['requests'] and r['requests'][0]['class'] == 'plan' else 0 for r in rs])
        print(f"  {a}: plan requests before first edit {pre:.2f}, after {post:.2f}; rollouts whose FIRST request is a plan call {first:.2f}")
