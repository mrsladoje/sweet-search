#!/usr/bin/env python3
"""Pull the three quoted exhibits with bytes: a gap re-read, a proceed-without, and an
ss-search pack cut."""
import json, os, re, sys, collections
sys.path.insert(0, '/tmp/fp-inv/e1')
sys.path.insert(0, '/tmp/fp-inv/trunc')
from e1_common import R, pool, transcripts, events_codex
from t1_shim import CELLS
import importlib.util
spec = importlib.util.spec_from_file_location('t1c', '/tmp/fp-inv/trunc/t1-census.py')
t1c = importlib.util.module_from_spec(spec); spec.loader.exec_module(t1c)

D = json.load(open('/tmp/fp-inv/trunc/census.json'))
want = {'a': None, 'd': None, 'pack': None}
for c in D['cases']:
    m0 = c['markers'][0] if c['markers'] else None
    if not m0:
        continue
    f1 = c['followups'][0]['cls'] if c['followups'] else ''
    if (want['a'] is None and f1 == 'a-reread-gap' and m0.get('how') == 'gutter'
            and str(m0.get('class', '')).startswith('ss-read')
            and 20 <= (m0['hi'] - m0['lo'] + 1) <= 90):
        want['a'] = c
    if (want['d'] is None and all(f['cls'] == 'd-unrelated' for f in c['followups'])
            and m0.get('how') == 'gutter' and str(m0.get('class', '')).startswith('ss-read')
            and 30 <= (m0['hi'] - m0['lo'] + 1) <= 200):
        want['d'] = c
    if (want['pack'] is None and c.get('pack')
            and str(m0.get('class', '')).startswith('ss-search')
            and c['pack']['ranks_head'] and c['pack']['ranks_tail']):
        want['pack'] = c

def find_output(case):
    arm, form = ('native', '-') if case['cell'].endswith('native|-') else ('sweet', case['cell'].split('|')[-1])
    run = dict(((a, f), r) for a, f, r in CELLS)[(arm, form)]
    for p, _ in transcripts(run, 'codex', f"{case['task']}-{arm}"):
        ev, turns = events_codex(p)
        results = [e for e in ev if e['kind'] == 'result']
        if case['call_index'] < len(results):
            e = results[case['call_index']]
            out = e.get('output') or ''
            if t1c.TRUNC_WARN.search(out) and str((e.get('input') or {}).get('cmd', ''))[:120] == case['cmd'][:120]:
                return p, out, results
    return None, None, None

ex = {}
for tag, c in want.items():
    if not c:
        print('MISSING', tag); continue
    p, out, results = find_output(c)
    if out is None:
        print('NOT RE-FOUND', tag); continue
    m = list(t1c.MARK.finditer(out))[0]
    ex[tag] = {
        'cell': c['cell'], 'task': c['task'], 'rep': c['rep'], 'resolved': c['resolved'],
        'transcript': p, 'cmd': c['cmd'], 'orig_tokens': c['orig_tokens'],
        'deleted_tokens': c['deleted_tokens'], 'markers': c['markers'],
        'pack': c.get('pack'), 'followups': c['followups'],
        'head': out[:230], 'cut': out[max(0, m.start() - 300):m.end() + 300],
        'tail': out[-260:],
    }
    print('=' * 90)
    print('%s  %s  %s rep%s resolved=%s' % (tag.upper(), c['cell'], c['task'], c['rep'], c['resolved']))
    print('transcript:', p)
    print('cmd:', c['cmd'][:220])
    print('orig=%d deleted=%d  marker: %s' % (c['orig_tokens'], c['deleted_tokens'],
          {k: v for k, v in c['markers'][0].items() if k in ('file', 'lo', 'hi', 'how', 'class', 'shape')}))
    if c.get('pack'):
        print('pack:', c['pack'])
    print('--- head ---'); print(repr(out[:230]))
    print('--- cut ---'); print(repr(out[max(0, m.start() - 300):m.end() + 300]))
    print('--- tail ---'); print(repr(out[-260:]))
    print('--- next 3 calls ---')
    for f in c['followups']:
        print('  k=%d %-24s %s' % (f['k'], f['cls'], (f.get('cmd') or '')[:150]))
json.dump(ex, open('/tmp/fp-inv/trunc/exhibits.json', 'w'), indent=1)
