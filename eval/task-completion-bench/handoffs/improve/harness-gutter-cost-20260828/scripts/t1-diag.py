#!/usr/bin/env python3
"""Why does a marker span stay unresolved? Classify the region the cut lands in."""
import json, os, re, sys, collections
sys.path.insert(0, '/tmp/fp-inv/e1')
sys.path.insert(0, '/tmp/fp-inv/trunc')
from e1_common import R, pool, transcripts, events_codex
from t1_shim import CELLS

TRUNC_WARN = re.compile(r'Warning: truncated output \(original token count: (\d+)\)')
MARK = re.compile(r'…([\d,]+) tokens truncated…')
G_NUM = re.compile(r'^\s*(\d+)(\t|\| |: )', re.M)

def region(out, m):
    """what kind of text sits either side of the cut?"""
    pre = out[max(0, m.start() - 900):m.start()]
    post = out[m.end():m.end() + 900]
    lastread = pre.rfind('\n# ss-read ')
    lastpack = pre.rfind('\n# ss-search:')
    tags = []
    if 'run_tests' in pre[-500:] or 'run_tests' in post[:500]:
        tags.append('run_tests-output')
    if 'You are resolving a real software issue' in pre or 'Sweet-search — code search tool guide' in pre:
        tags.append('AGENTS.md-preamble')
    gb = list(G_NUM.finditer(pre))
    ga = G_NUM.search(post)
    tags.append('numbered-before' if gb else 'unnumbered-before')
    tags.append('numbered-after' if ga else 'unnumbered-after')
    if gb and ga:
        b, a = int(gb[-1].group(1)), int(ga.group(1))
        if a <= b:
            tags.append('numbering-RESTARTS (crosses a block/file boundary)')
        elif a == b + 1:
            tags.append('sub-line cut (<1 whole line lost)')
    if lastpack > lastread:
        tags.append('inside-search-pack')
    elif lastread >= 0:
        tags.append('inside-ss-read-block')
    return tags

per = collections.defaultdict(collections.Counter)
ex = collections.defaultdict(list)
P = pool()
for arm, form, run in CELLS:
    key = f'{arm}|{form}'
    for task in P:
        for p, _ in transcripts(run, 'codex', f'{task}-{arm}'):
            ev, _t = events_codex(p)
            for e in ev:
                if e['kind'] != 'result':
                    continue
                out = e.get('output') or ''
                if not TRUNC_WARN.search(out):
                    continue
                for m in MARK.finditer(out):
                    for t in region(out, m):
                        per[key][t] += 1
                    if len(ex[key]) < 2 and 'unnumbered-after' in region(out, m):
                        ex[key].append((task, str((e.get('input') or {}).get('cmd'))[:110],
                                        repr(out[max(0, m.start() - 200):m.end() + 200])))
for k in sorted(per):
    print('===', k)
    for t, v in per[k].most_common():
        print('   %5d  %s' % (v, t))
print()
for k, v in ex.items():
    for t, c, s in v:
        print('--- %s  %s\n    %s\n' % (k, c, s[:600]))
