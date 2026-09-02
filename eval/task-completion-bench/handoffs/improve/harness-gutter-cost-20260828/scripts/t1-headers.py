#!/usr/bin/env python3
"""Header vocabulary probe: what block headers appear in codex sweet tool outputs, so a
truncation marker can be attributed to the sub-command that produced it."""
import json, os, re, sys, collections
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import R, transcripts, events_codex

hdr = collections.Counter()
trailer = collections.Counter()
for run in ('fp-codex-tab-20260826',):
    asd = os.path.join(R, run, 'agent-state')
    for cell in sorted(os.listdir(asd)):
        if not cell.endswith('-sweet'):
            continue
        for p, _ in transcripts(run, 'codex', cell):
            ev, turns = events_codex(p)
            for e in ev:
                if e['kind'] != 'result':
                    continue
                out = e.get('output') or ''
                if not out:
                    continue
                for ln in out.split('\n'):
                    if re.match(r'^#{1,3} ', ln):
                        hdr[re.sub(r'\d+', 'N', ln)[:78]] += 1
                    if re.search(r'sufficient=|unread|not shown|shown-full|more result', ln):
                        trailer[re.sub(r'\d+', 'N', ln)[:78]] += 1
print('=== HEADERS (top 40)')
for k, v in hdr.most_common(40):
    print('%6d  %s' % (v, k))
print()
print('=== TRAILER-ish lines (top 25)')
for k, v in trailer.most_common(25):
    print('%6d  %s' % (v, k))
