# Merge per-type runs of analyze.py (--types t --out R-t.md --json J-t.json) into one RESULTS-paper.md and one JSON.
# Holm is applied again over all primary comparisons together (the per-type runs each saw only their own).
#   python merge_results.py --parts DIR --types intel,amd,arm,box,mac --out RESULTS-paper.md --json results-paper.json
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import stats  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--parts', required=True); ap.add_argument('--types', default='intel,amd,arm,box,mac')
ap.add_argument('--out', default='RESULTS-paper.md'); ap.add_argument('--json', default='results-paper.json')
a = ap.parse_args()
types = a.types.split(',')
J = None
md = {}
for t in types:
    j = json.load(open(os.path.join(a.parts, f'J-{t}.json')))
    md[t] = open(os.path.join(a.parts, f'R-{t}.md')).read()
    if J is None:
        J = j
    else:
        J['B'] += j['B']; J['A'] += j['A']; J['primary'] = (J['primary'] or []) + (j['primary'] or [])
        J['n_ho'].update(j['n_ho']); J['q_exact'].update(j['q_exact']); J['R'].update(j['R'])
P = J['primary'] or []
sys.argv = sys.argv[:1]
import importlib.util  # the ratio interval of analyze.py, applied to the round medians in the JSON
_src = open(os.path.join(HERE, 'analyze.py')).read(); _i = _src.index('def ratio_ci('); _j = _src.index('\n\n\n', _i)
import numpy as np, math  # noqa: E401
exec(_src[_i:_j])
Bx = {(r['type'], r['set'], r['model'], r['f'], r['system']): r for r in J['B']}
for p in P:
    o, rv = Bx.get((p['type'], p['set'], p['model'], 0.99, 'ours_cascade')), Bx.get((p['type'], p['set'], p['model'], 0.99, p['rival']))
    if o and rv:
        p['ratio'], p['lo'], p['hi'] = ratio_ci(o['round_us'], rv['round_us'])
hol = stats.holm([p.get('p', 1.0) for p in P]) if P else []
for p, h in zip(P, hol):
    p['holm_pass'] = bool(h)
json.dump(J, open(a.json, 'w'), indent=0, default=float)

first = md[types[0]]
head = first[:first.index('\n## ')]
summ = []
for f in ('0.98', '0.99', '0.995'):
    rows, gm = [], []
    for t in types:
        m = re.search(r'## Summary at f = ' + re.escape(f) + r'\b[^\n]*\n\n\|[^\n]*\n\|[^\n]*\n((?:\|[^\n]*\n)*)\nGeometric mean[^:]*: ([^\n]*)', md[t])
        if m:
            rows.append(m.group(1)); gm.append(m.group(2))
    summ += [f'## Summary at f = {f}: ours vs the fastest rival that meets f on held-out (point estimate)', '',
             '| CPU | Set | Model | Ours µs | Ours meets f (point / bound) | Fastest rival meeting f | Rival µs | rival/ours [95% CI] |',
             '|---|---|---|---:|---|---|---:|---|', ''.join(rows).rstrip('\n'), '',
             'Geometric mean of rival/ours per CPU: ' + '; '.join(gm), '']
prim = ['## Primary comparisons (pairs fixed on dev: quality non-inferiority of ours vs that rival at f = 0.99, Holm over all)', '',
        '| CPU | Set | Model | Rival | rival/ours latency [95% CI] | Meets 0.99 ours ; rival | mean(ours − rival) | lower bound | p | Holm |',
        '|---|---|---|---|---|---|---:|---:|---:|---|']
for p in P:
    if p.get('missing'):
        prim.append(f"| {p['type']} | {p['set']} | {p['model']} | {p['rival']} | no held-out record | | | | | fail |"); continue
    prim.append(f"| {p['type']} | {p['set']} | {p['model']} | {p['rival']} | {p['ratio']:.2f}" + (f" [{p['lo']:.2f}, {p['hi']:.2f}]" if p['lo'] else '') +
                f" | {p['ours_meets']} ; {p['rival_meets']} | {p['mean_diff']:+.4f} | {p['lower']:+.4f} | {p['p']:.4f} | {'pass' if p['holm_pass'] else 'fail'} |")
detail = []
for t in types:
    s = md[t]; i = s.index(f'## {t} (frozen')
    j = min([k for k in (s.find('## Primary comparisons', i), s.find('## Build cost', i)) if k > 0] or [len(s)])
    detail.append(s[i:j].rstrip() + '\n')
build = first[first.index('## Build cost'):] if '## Build cost' in first else ''
open(a.out, 'w').write(head + '\n' + '\n'.join(summ) + '\n' + '\n'.join(prim) + '\n\n' + '\n'.join(detail) + '\n' + build)
print(f'merged {types}: {len(J["B"])} B rows, {len(J["A"])} A rows, {len(P)} primary ({sum(hol)} pass Holm)', file=sys.stderr)
