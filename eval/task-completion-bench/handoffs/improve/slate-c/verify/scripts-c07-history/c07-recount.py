#!/usr/bin/env python3
"""c07-history recount over the forensics JSON (no box access needed).
Reads slate-c/forensics/scripts-codex-cap-x-ss/codex-cap-x-ss.json."""
import json, os, statistics
from collections import Counter
HERE = os.path.dirname(os.path.abspath(__file__))
J = os.path.normpath(os.path.join(HERE, '..', '..', 'forensics', 'scripts-codex-cap-x-ss', 'codex-cap-x-ss.json'))
d = json.load(open(J))
sw = [c for c in d['cases'] if c['cell'] != 'native']
def cls(c):
    for m in c['markers']:
        if m.get('class'): return m['class']
    return None
print('sweet truncated outputs:', len(sw), Counter(cls(c) for c in sw))
srch = [c for c in sw if cls(c) == 'ss-search' and c.get('pack')]
print('truncated ss-search packs:', len(srch), ' single-command:', sum(1 for c in srch if c['subcmds'] == 1))
lost = sum(len(c['pack']['lost_ranks'] or []) for c in srch)
surv = sum(len(c['pack']['ranks_head']) + len(c['pack']['ranks_tail']) for c in srch)
print('rank headers lost %d, surviving %d  (loss %.1f%%)' % (lost, surv, 100*lost/(lost+surv)))
s1 = [c for c in srch if c['subcmds'] == 1]
print('  on the 17 single-command packs, lost:', sum(len(c['pack']['lost_ranks'] or []) for c in s1))
print('mean rank headers in the tail: %.2f' % (sum(len(c['pack']['ranks_tail']) for c in srch)/len(srch)))
print('sufficient= anywhere: %d/%d   route= in tail: %d   shown-full: %d'
      % (sum(1 for c in srch if c['pack']['sufficient_anywhere']), len(srch),
         sum(1 for c in srch if c['pack']['route_survived']),
         sum(1 for c in srch if c['pack']['shown_full_survived'])))
print('cut inside rank N:', dict(Counter(c['pack']['cut_in_rank'] for c in srch)))
print('graph-edge lines in tails: %d   tail rank rows: %d'
      % (sum(c['pack']['graph_edges_in_tail'] or 0 for c in srch), sum(c['pack']['tail_symbols_n'] or 0 for c in srch)))
def agg(sel, lbl):
    a = sum(1 for c in sel if c['any_a_req3']); cc = sum(1 for c in sel if c['any_c_req3'])
    usd = sum((c['a_usd_req3'] or 0) + (c['c_usd_req3'] or 0) for c in sel)
    req = sum((c['a_req_req3'] or 0) + (c['c_req_req3'] or 0) for c in sel)
    print('%-30s n=%3d  (a)=%2d (c)=%2d  request-counts=%2d  $%.5f = %.2f%% of the $0.8138 cell'
          % (lbl, len(sel), a, cc, req, usd, 100*usd/0.8138))
agg(sw, 'all sweet cuts')
agg([c for c in sw if c['subcmds'] == 1], 'single-command (addressable)')
agg([c for c in sw if c['subcmds'] > 1], '&& bundles (not addressable)')
