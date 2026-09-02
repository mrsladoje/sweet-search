#!/usr/bin/env python3
"""e3-pertask.py — per-task pairing, concentration, and the resident-token profile.
Shows WHICH tasks carry each form-to-form gap, so a gap driven by one or two cells
cannot be read as a delimiter effect."""
import gzip, json, statistics
from collections import defaultdict

rolls = [json.loads(l) for l in gzip.open('data/rollouts.ndjson.gz', 'rt') if l.strip()]
toks = [json.loads(l) for l in open('data/blocks-tok.ndjson')]
FORMS = ['tab', 'none', 'pipe']
for r in rolls:
    r['totUsd'] = r['realUsd'] + r.get('sideRealUsd', 0.0)


def by(h, form, arm='sweet'):
    d = defaultdict(list)
    for r in rolls:
        if r['h'] == h and r['form'] == form and r['arm'] == arm:
            d[r['task']].append(r)
    return d


print('=== per-task cost, sweet arm, mean of 3 reps ($) — sorted by |PIPE-TAB| ===')
for h in ['codex', 'opencode', 'claude-code']:
    B = {f: by(h, f) for f in FORMS}
    tasks = sorted(B['tab'])
    rows = []
    for t in tasks:
        v = {f: sum(x['totUsd'] for x in B[f][t]) / len(B[f][t]) for f in FORMS}
        rows.append((t, v))
    rows.sort(key=lambda r: -abs(r[1]['pipe'] - r[1]['tab']))
    tot = {f: sum(r[1][f] for r in rows) / len(rows) for f in FORMS}
    print(f'\n--- {h} --- mean/rollout: TAB {tot["tab"]:.6f}  NONE {tot["none"]:.6f}  PIPE {tot["pipe"]:.6f}')
    gapN = sum(r[1]['none'] - r[1]['tab'] for r in rows)
    gapP = sum(r[1]['pipe'] - r[1]['tab'] for r in rows)
    print(f'{"task":<44}{"TAB":>10}{"NONE":>10}{"PIPE":>10}{"P-T":>10}{"share of P-T gap":>18}')
    for t, v in rows[:6]:
        d = v['pipe'] - v['tab']
        print(f'{t:<44}{v["tab"]:>10.5f}{v["none"]:>10.5f}{v["pipe"]:>10.5f}{d:>10.5f}'
              f'{(100*d/gapP if gapP else 0):>17.0f}%')
    top3 = sum(r[1]['pipe'] - r[1]['tab'] for r in rows[:3])
    print(f'  top-3 tasks carry {100*top3/gapP:.0f}% of the PIPE-TAB gap; '
          f'sign count PIPE<TAB on {sum(1 for _, v in rows if v["pipe"] < v["tab"])}/{len(rows)} tasks, '
          f'NONE<TAB on {sum(1 for _, v in rows if v["none"] < v["tab"])}/{len(rows)}')
    top3n = sorted((r[1]['none'] - r[1]['tab'] for r in rows), key=abs, reverse=True)[:3]
    print(f'  top-3 |NONE-TAB| carry {100*sum(top3n)/gapN:.0f}% of the NONE-TAB gap' if gapN else '')

print('\n=== resident profile: how long a delivered gutter token stays in context ===')
agg = defaultdict(lambda: [0, 0, 0])   # gtok, gtok*resid, blocks
for b in toks:
    h, form = b['id'].split('|')[0], b['id'].split('|')[1]
    g = b['tokDel'] - b['tokStrip']
    a = agg[(h, form)]
    a[0] += g
    a[1] += g * b['resid']
    a[2] += 1
print(f'{"harness":<12}{"form":<6}{"gutter tok":>12}{"mean resident turns":>21}{"resident/ingest $ ratio":>25}')
for (h, form), a in sorted(agg.items()):
    if a[0] == 0:
        continue
    mr = a[1] / a[0]
    print(f'{h:<12}{form:<6}{a[0]:>12}{mr:>21.1f}{(0.01*mr/0.10):>25.2f}')

print('\n=== ingest vs resident split of the direct gutter cost (per rollout, $) ===')
gu = defaultdict(lambda: [0.0, 0.0, 0])
byid = defaultdict(lambda: [0.0, 0.0])
for b in toks:
    g = b['tokDel'] - b['tokStrip']
    wi = 0.0 if b['T'] <= b['k'] else 0.10 / 1e6
    wr = 0.0 if b['T'] <= b['k'] else 0.01 * b['resid'] / 1e6
    byid[b['id']][0] += g * wi
    byid[b['id']][1] += g * wr
for r in rolls:
    if r['arm'] != 'sweet':
        continue
    k = f"{r['h']}|{r['form']}|{r['arm']}|{r['task']}|{r['rep']}"
    v = byid.get(k, [0.0, 0.0])
    a = gu[(r['h'], r['form'])]
    a[0] += v[0]
    a[1] += v[1]
    a[2] += 1
print(f'{"harness":<12}{"form":<6}{"ingest $":>11}{"resident $":>12}{"total $":>11}{"resident share":>16}')
for (h, form), a in sorted(gu.items()):
    n = a[2]
    tot = (a[0] + a[1]) / n
    print(f'{h:<12}{form:<6}{a[0]/n:>11.6f}{a[1]/n:>12.6f}{tot:>11.6f}'
          f'{(100*a[1]/(a[0]+a[1]) if tot else 0):>15.0f}%')
