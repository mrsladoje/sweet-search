#!/usr/bin/env python3
"""e3-appendjson.py — fold the byte-level exhibits, the codex truncation census and the
rep-index check into 03-gutter-form-cost.json so the JSON stands alone."""
import gzip, json, re
from collections import Counter, defaultdict
import tiktoken
E = tiktoken.get_encoding('o200k_base')
RE = {'tab': re.compile(r'^(\d+)\t'), 'pipe': re.compile(r'^(\d+)\| ')}
blocks = [json.loads(l) for l in gzip.open('data/blocks.ndjson.gz', 'rt') if l.strip()]
rolls = [json.loads(l) for l in gzip.open('data/rollouts.ndjson.gz', 'rt') if l.strip()]
for r in rolls:
    r['tot'] = r['realUsd'] + r.get('sideRealUsd', 0.0)


def strip(b, gf):
    if gf == 'none':
        return b
    rx = RE[gf]
    return '\n'.join(rx.sub('', l) if rx.match(l) else l for l in b.split('\n'))


def tok(s):
    return len(E.encode('```\n' + s + '\n```'))


idx = defaultdict(dict)
for b in blocks:
    if b['surf'] != 'ss-read':
        continue
    idx[(b['id'].split('|')[0], strip(b['body'], b['gf']))][b['id'].split('|')[1]] = b
hits = sorted([(k, v) for k, v in idx.items() if len(v) == 3 and v['none']['n'] > 60],
              key=lambda kv: -kv[1]['none']['n'])[:2]
ex = []
for (h, s), v in hits:
    t = {f: tok(v[f]['body']) for f in ['none', 'tab', 'pipe']}
    n = v['none']['n']
    ex.append(dict(harness=h, lines=n, id=v['tab']['id'], tokens=t,
                   tabPerLine=(t['tab'] - t['none']) / n, pipePerLine=(t['pipe'] - t['none']) / n,
                   pipeMinusTabPerLine=(t['pipe'] - t['tab']) / n,
                   firstLine={f: v[f]['body'].split('\n')[0][:70] for f in ['none', 'tab', 'pipe']}))

integ = dict(gutterBlocks=0, startMatchesHeader=0, nonConsecutive=Counter())
for b in blocks:
    if b['gf'] == 'none':
        continue
    integ['gutterBlocks'] += 1
    nums = [int(m.group(1)) for m in (RE[b['gf']].match(l) for l in b['body'].split('\n')) if m]
    if nums and nums[0] == b['start']:
        integ['startMatchesHeader'] += 1
    if nums and nums != list(range(nums[0], nums[0] + len(nums))):
        integ['nonConsecutive'][b['id'].split('|')[0] + '|' + b['id'].split('|')[1]] += 1
integ['nonConsecutive'] = dict(integ['nonConsecutive'])

sub = defaultdict(lambda: [0, 0])
gsurf = defaultdict(lambda: defaultdict(lambda: [0, 0]))
for b in blocks:
    k = b['id'].split('|')[0] + '|' + b['id'].split('|')[1]
    if b['surf'] == 'ss-read':
        sub[k][0] += 1
        if b['n'] < 15:
            sub[k][1] += 1
    e = gsurf[k][b['surf']]
    e[0] += 1
    if b['gf'] != 'none':
        e[1] += 1

trunc = {}
for h in ['codex']:
    for f in ['tab', 'none', 'pipe']:
        c = [r for r in rolls if r['h'] == h and r['form'] == f and r['arm'] == 'sweet']
        trunc[f'{h}|{f}'] = dict(total=sum(r['truncations'] for r in c),
                                 rollouts=sum(1 for r in c if r['truncations'] > 0), n=len(c))
c = [r for r in rolls if r['h'] == 'codex' and r['form'] == 'tab' and r['arm'] == 'native']
trunc['codex|native'] = dict(total=sum(r['truncations'] for r in c),
                             rollouts=sum(1 for r in c if r['truncations'] > 0), n=len(c))

rep = {}
for h in ['codex', 'opencode', 'claude-code']:
    for f in ['tab', 'none', 'pipe']:
        c = [r for r in rolls if r['h'] == h and r['form'] == f and r['arm'] == 'sweet']
        rep[f'{h}|{f}'] = [round(sum(x['tot'] for x in c if x['rep'] == i)
                                 / max(1, len([x for x in c if x['rep'] == i])), 6) for i in range(3)]

j = json.load(open('03-gutter-form-cost.json'))
j['exhibits'] = dict(sameWindowThreeForms=ex, integrity=integ,
                     subFifteenLineReads={k: dict(total=v[0], under15=v[1]) for k, v in sorted(sub.items())},
                     gutterBearingBlocksBySurface={k: {s: dict(gutter=v[1], total=v[0])
                                                       for s, v in sorted(d.items())} for k, d in sorted(gsurf.items())},
                     codexTruncations=trunc, costByRepIndex=rep)
json.dump(j, open('03-gutter-form-cost.json', 'w'), indent=1)
print('appended exhibits')
