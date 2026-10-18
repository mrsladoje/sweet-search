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
from paperlib import ratio_ci, headline  # noqa: E402
Bx = {(r['type'], r['set'], r['model'], r['f'], r['system']): r for r in J['B']}
pw = {}
for t in ('intel', 'amd', 'arm'):
    for q in json.load(open(os.path.join(HERE, 'shortlists', f'shortlist-{t}.json')))['meta']['primary']:
        pw[(t, q['set'], q['model'])] = (q['power_analytic'], q['power_sim'])
for p in P:
    o, rv = Bx.get((p['type'], p['set'], p['model'], 0.99, 'ours_cascade')), Bx.get((p['type'], p['set'], p['model'], 0.99, p['rival']))
    if o and rv:
        p['ratio'], p['lo'], p['hi'] = ratio_ci(o['round_us'], rv['round_us'])
    pa, ps = pw.get((p['type'], p['set'], p['model']), (1, 1))
    p['power_analytic'], p['power_sim'] = pa, ps
    p['confirmatory'] = min(pa, ps) >= 0.8  # PAPER_PLAN section 4: a pair with power < 80% is descriptive only
C = [p for p in P if p['confirmatory']]
hol = stats.holm([p.get('p', 1.0) for p in C]) if C else []
for p in P:
    p['holm_pass'] = None
for p, h in zip(C, hol):
    p['holm_pass'] = bool(h)
json.dump(J, open(a.json, 'w'), indent=0, default=float)

first = md[types[0]]
head = first[:first.index('\n## ')]
summ = []
import collections, math  # noqa: E401
G = collections.defaultdict(dict)
for r in J['B']:
    G[(r['type'], r['set'], r['model'], r['f'])][r['system']] = r
for f in (0.98, 0.99, 0.995):
    summ += [f'## Summary at f = {f}: ours vs the rival that was fastest on dev at f (its frozen point, held-out)', '',
             '| CPU | Set | Model | Ours µs | Ours meets f (point / bound) | Rival (fastest on dev) | Rival µs | Rival meets f | rival/ours [95% CI] |',
             '|---|---|---|---:|---|---|---:|---|---|']
    logs = collections.defaultdict(list)
    for (t, s_, m, ff), d in sorted(G.items()):
        if ff != f:
            continue
        h = headline(d, t, s_, m, f)
        if not h:
            continue
        o, rn, rv = h; est, lo, hi = ratio_ci(o['round_us'], rv['round_us'])
        logs[t].append(math.log(est))
        yn = lambda b: 'yes' if b else 'no'
        summ.append(f"| {t} | {s_} | {m} | {o['us']:.1f} | {yn(o['meets_point'])} / {yn(o['meets_bound'])} | {rn} | {rv['us']:.1f} | "
                    f"{yn(rv['meets_point'])} / {yn(rv['meets_bound'])} | {est:.2f}" + (f' [{lo:.2f}, {hi:.2f}]' if lo else '') + ' |')
    summ += ['', 'Geometric mean of rival/ours per CPU: ' + '; '.join(f'{t} {math.exp(sum(v) / len(v)):.2f} (n = {len(v)})' for t, v in sorted(logs.items())), '']
prim = ['## Primary comparisons (pairs fixed on dev: quality non-inferiority of ours vs that rival at f = 0.99; Holm over the pairs with power >= 0.8)', '',
        '| CPU | Set | Model | Rival | rival/ours latency [95% CI] | Meets 0.99 ours ; rival | mean(ours − rival) | lower bound | p | Holm |',
        '|---|---|---|---|---|---|---:|---:|---:|---|']
for p in P:
    if p.get('missing'):
        prim.append(f"| {p['type']} | {p['set']} | {p['model']} | {p['rival']} | no held-out record | | | | | fail |"); continue
    prim.append(f"| {p['type']} | {p['set']} | {p['model']} | {p['rival']} | {p['ratio']:.2f}" + (f" [{p['lo']:.2f}, {p['hi']:.2f}]" if p['lo'] else '') +
                f" | {p['ours_meets']} ; {p['rival_meets']} | {p['mean_diff']:+.4f} | {p['lower']:+.4f} | {p['p']:.4f} | "
                + ({True: 'pass', False: 'fail', None: f"descriptive (power {min(p['power_analytic'], p['power_sim']):.2f})"}[p['holm_pass']]) + ' |')
detail = []
for t in types:
    s = md[t]; i = s.index(f'## {t} (frozen')
    j = min([k for k in (s.find('## Primary comparisons', i), s.find('## Build cost', i)) if k > 0] or [len(s)])
    detail.append(s[i:j].rstrip() + '\n')
build = first[first.index('## Build cost'):] if '## Build cost' in first else ''
open(a.out, 'w').write(head + '\n' + '\n'.join(summ) + '\n' + '\n'.join(prim) + '\n\n' + '\n'.join(detail) + '\n' + build)
print(f'merged {types}: {len(J["B"])} B rows, {len(J["A"])} A rows, {len(P)} primary, {len(C)} confirmatory ({sum(hol)} pass Holm)', file=sys.stderr)
