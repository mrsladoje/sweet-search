#!/usr/bin/env python3
"""showreq.py <harness> <task> [--phase P] [--width N] -- print the request table of every rollout (both arms, all reps)."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from aggregate import rephase
h, task = sys.argv[1], sys.argv[2]
W = int(sys.argv[sys.argv.index('--width') + 1]) if '--width' in sys.argv else 120
d = json.load(open(os.path.join(HERE, 'data', 'anatomy.json')))
for r in sorted(d['harnesses'][h]['rollouts'], key=lambda r: (r['arm'], r['rep'])):
    if r['task'] != task:
        continue
    ph = rephase(r, 'sight')
    print(f"\n#### {r['rid']}  n_req={r['n_req']} calls={r['n_calls']} cost={r['tot_cost']:.6f} edited={r['edited']} marks={r['marks']}\n     {r['transcript'].split('/results/')[-1]}")
    for q, p in zip(r['requests'], ph):
        s = ' || '.join(x[:W] for x in q['summ'])
        if q['class'] == 'text':
            s = 'TEXT: ' + q['text'][:W].replace('\n', ' ')
        print(f"  {q['i']:>2} {p:<10} {q['class']:<8} c={q['n_calls']} new={q['newIn']:>5} out={q['out']:>4} {'ERR ' if q['err'] else '    '}| {s}")
