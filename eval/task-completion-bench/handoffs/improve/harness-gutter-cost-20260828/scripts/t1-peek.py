#!/usr/bin/env python3
"""Shape probe: native-arm codex truncation, envelope compoundness, cap size."""
import json, os, re, sys, collections
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import R, transcripts, events_codex

run = 'fp-codex-tab-20260826'
asd = os.path.join(R, run, 'agent-state')
MARK = re.compile(r'…[^…\n]*?truncated[^…\n]*?…')
n = 0
caps = collections.Counter()
orig = []
delivered_est = []
for cell in sorted(os.listdir(asd)):
    if not cell.endswith('-native'):
        continue
    for p, _ in transcripts(run, 'codex', cell):
        ev, turns = events_codex(p)
        for e in ev:
            if e['kind'] != 'result':
                continue
            out = e.get('output') or ''
            if 'Warning: truncated output' not in out:
                continue
            inp = e.get('input') or {}
            caps[inp.get('max_output_tokens')] += 1
            m = re.search(r'Original token count: (\d+)', out)
            if m:
                orig.append(int(m.group(1)))
            delivered_est.append(len(out) / 4.0)
            n += 1
            if n <= 3:
                print('=== NATIVE cell=', cell)
                print('CMD:', str(inp.get('cmd'))[:300].replace('\n', ' | '))
                print('HEAD:', repr(out[:260]))
                for mm in MARK.finditer(out):
                    print('CTX:', repr(out[max(0, mm.start() - 260):mm.end() + 260]))
                print()
print('native truncated calls:', n)
print('caps:', dict(caps))
if orig:
    orig.sort()
    print('original token count: min %d med %d max %d' % (orig[0], orig[len(orig) // 2], orig[-1]))
    d = sorted(delivered_est)
    print('delivered chars/4 estimate: min %.0f med %.0f max %.0f' % (d[0], d[len(d) // 2], d[-1]))
