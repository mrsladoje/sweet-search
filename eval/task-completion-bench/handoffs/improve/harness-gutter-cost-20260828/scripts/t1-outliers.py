#!/usr/bin/env python3
"""Audit the largest ss-read deleted spans: is the gutter span real or a block-crossing?"""
import json, collections
D = json.load(open('/tmp/fp-inv/trunc/census.json'))
rows = []
for c in D['cases']:
    for m in c['markers']:
        if not str(m.get('class', '')).startswith('ss-read'):
            continue
        if m.get('lo') is None or m.get('hi') is None:
            continue
        rows.append((m['hi'] - m['lo'] + 1, c['cell'], c['task'], m['file'], m['lo'], m['hi'],
                     m['deleted_tokens'], m['how'], m.get('before_n'), m.get('after_n'),
                     c['cmd'][:150], c['requested']))
rows.sort(reverse=True)
print('%-6s %-18s %-28s %-34s %9s %8s %7s  how' %
      ('lines', 'cell', 'task', 'file', 'span', 'deltok', 'b->a'))
for r in rows[:14]:
    print('%-6d %-18s %-28s %-34s %4d-%-4d %8d %3s->%-3s  %s' %
          (r[0], r[1].split('|')[-1], r[2][:28], str(r[3])[-34:], r[4], r[5], r[6],
           r[8], r[9], r[7]))
    print('        cmd: %s' % r[10].replace('\n', ' | '))
    print('        req: %s' % r[11])
print()
# ratio of deleted lines to the deleted TOKEN count: a real code span is ~8-12 tok/line
print('deleted tokens per deleted line (a sanity ratio; real code is ~8-14):')
for cell in ('codex|sweet|tab', 'codex|sweet|none', 'codex|sweet|pipe'):
    rr = [(x[6] / max(1, x[0])) for x in rows if x[1] == cell]
    rr.sort()
    if rr:
        print('  %-18s n=%3d  med %.1f  p10 %.1f  p90 %.1f  under-3 %d' %
              (cell, len(rr), rr[len(rr) // 2], rr[len(rr) // 10], rr[-len(rr) // 10],
               sum(1 for x in rr if x < 3)))
