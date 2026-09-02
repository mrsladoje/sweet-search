#!/usr/bin/env python3
"""Compact per-cell view of census.json."""
import json, collections, sys
d = json.load(open('/tmp/fp-inv/trunc/census.json'))
per = d['per_cell']
ORDER = ['codex|native|-', 'codex|sweet|tab', 'codex|sweet|none', 'codex|sweet|pipe']
PUB = {'codex|native|-': 0.8110, 'codex|sweet|tab': 0.8138,
       'codex|sweet|none': 0.8131, 'codex|sweet|pipe': 0.8418}
for k in ORDER:
    S = per.get(k)
    if not S:
        print(k, 'MISSING'); continue
    print('=' * 78)
    print(k)
    print(' rollouts=%d transcripts=%d cells_over_3=%d cost=$%.4f (published $%.4f)'
          % (S['rollouts'], S['transcripts_seen'], S['cells_over_3'], S['cost'], PUB[k]))
    print(' trunc_calls=%d rollouts_with_trunc=%d markers=%d' %
          (S['trunc_calls'], S['rollouts_with_trunc'], S['markers']))
    print(' orig_tokens=%d deleted=%d delivered=%d  mean_delivered=%.0f' %
          (S['orig_tokens'], S['deleted_tokens'], S['delivered_tokens'],
           S['delivered_tokens'] / max(1, S['trunc_calls'])))
    print(' by_class:', dict(sorted(S['by_class'].items(), key=lambda x: -x[1])))
    print(' span_how:', S['span_how'])
    print(' followups:', dict(sorted(S['fu'].items())))
    print(' fu_rollouts:', dict(sorted(S['fu_rollouts'].items())))
    print(' reread $%.5f (%d requests)  gapsearch $%.5f (%d requests)  cf_extra $%.5f' %
          (S['reread_cost'], S['reread_turns'], S['gapsearch_cost'], S['gapsearch_turns'],
           S['cf_extra']))
    print(' n_by_bucket:', S['n_by_bucket'], ' solved:', S['solved_by_bucket'])
    print(' edit_in_gap=%d rollouts=%d' % (S['edit_in_gap'], S['blind_edit_rollouts']))
print()
print('cases:', len(d['cases']))
hows = collections.Counter(m['how'] for c in d['cases'] for m in c['markers'])
print('marker how overall:', dict(hows))
