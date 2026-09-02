#!/usr/bin/env python3
"""e3-exhibits.py — byte-level exhibits behind the aggregate numbers.

1. the SAME read window rendered in all three forms, with exact o200k_base counts
2. the ss-read / ss-search headers that survive under NONE (why NONE keeps range reads)
3. sub-15-line ss-read blocks (the threshold that leaves a read un-numbered)
"""
import gzip, json, re
from collections import defaultdict
import tiktoken

E = tiktoken.get_encoding('o200k_base')
blocks = [json.loads(l) for l in gzip.open('data/blocks.ndjson.gz', 'rt') if l.strip()]

RE_TAB = re.compile(r'^(\d+)\t')
RE_PIPE = re.compile(r'^(\d+)\| ')


def strip(body, gf):
    if gf == 'none':
        return body
    rx = RE_TAB if gf == 'tab' else RE_PIPE
    return '\n'.join(rx.sub('', ln) if rx.match(ln) else ln for ln in body.split('\n'))


def number(body, start, d):
    return '\n'.join(f'{start+i}{d}{ln}' for i, ln in enumerate(body.split('\n')))


def tok(s):
    return len(E.encode('```\n' + s + '\n```'))


print('=== 1. ONE READ WINDOW, THREE FORMS, EXACT TOKENS ===')
# find a block delivered identically (same stripped text) under all three forms
idx = defaultdict(dict)
for b in blocks:
    if b['surf'] != 'ss-read':
        continue
    s = strip(b['body'], b['gf'])
    h, form = b['id'].split('|')[0], b['id'].split('|')[1]
    idx[(h, s)][form] = b
hits = [(k, v) for k, v in idx.items() if len(v) == 3 and v['none']['n'] > 60]
hits.sort(key=lambda kv: -kv[1]['none']['n'])
for (h, s), v in hits[:2]:
    n = v['none']['n']
    print(f"\n-- {h}, {n} lines, id={v['tab']['id']}")
    for form in ['none', 'tab', 'pipe']:
        b = v[form]
        t = tok(b['body'])
        print(f"   {form:<5} tokens={t:<6} first line = {json.dumps(b['body'].split(chr(10))[0][:64])}")
    t0, t1, t2 = (tok(v[f]['body']) for f in ['none', 'tab', 'pipe'])
    print(f"   overhead: TAB +{t1-t0} tok ({(t1-t0)/n:.3f}/line, +{100*(t1-t0)/t0:.1f}%)   "
          f"PIPE +{t2-t0} tok ({(t2-t0)/n:.3f}/line, +{100*(t2-t0)/t0:.1f}%)   "
          f"PIPE-TAB = {(t2-t1)/n:.3f} tok/line")

print('\n=== 2. HEADERS ARE OUTSIDE THE FENCE, SO NONE KEEPS ITS LINE NUMBERS ===')
for form in ['none']:
    for b in blocks:
        if b['id'].split('|')[1] != form or b['surf'] != 'ss-read' or b['start'] is None:
            continue
        print(f"  ss-read block under NONE: id={b['id']} start={b['start']} n={b['n']}")
        print(f"    first body line (no gutter) = {json.dumps(b['body'].split(chr(10))[0][:70])}")
        print('    the range came from the header line, which the gutter env vars never touch')
        break
    for b in blocks:
        if b['id'].split('|')[1] != form or b['surf'] != 'ss-search' or b['start'] is None:
            continue
        print(f"  ss-search hit under NONE: id={b['id']} start={b['start']} n={b['n']}")
        print(f"    first body line (no gutter) = {json.dumps(b['body'].split(chr(10))[0][:70])}")
        break

print('\n=== 3. SUB-15-LINE ss-read BLOCKS (the >=15 threshold leaves them un-numbered) ===')
c = defaultdict(lambda: [0, 0])
for b in blocks:
    if b['surf'] != 'ss-read':
        continue
    h, form = b['id'].split('|')[0], b['id'].split('|')[1]
    c[(h, form)][0] += 1
    if b['n'] < 15:
        c[(h, form)][1] += 1
for k in sorted(c):
    tot, sub = c[k]
    print(f'  {k[0]:<12}{k[1]:<6} ss-read blocks={tot:<5} under 15 lines={sub} ({100*sub/tot:.1f}%)')

print('\n=== 4. GUTTER-BEARING BLOCKS BY SURFACE (epoch C numbers EVERY ss-* surface) ===')
d = defaultdict(lambda: defaultdict(lambda: [0, 0]))
for b in blocks:
    h, form = b['id'].split('|')[0], b['id'].split('|')[1]
    e = d[(h, form)][b['surf']]
    e[0] += 1
    if b['gf'] != 'none':
        e[1] += 1
for k in sorted(d):
    parts = ' '.join(f'{s}:{v[1]}/{v[0]}' for s, v in sorted(d[k].items()))
    print(f'  {k[0]:<12}{k[1]:<6} gutter-bearing/total blocks  {parts}')
