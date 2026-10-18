# numbers.tex and tables/*.tex of the paper draft from the analysis JSON (analyze.py --json).
#   python mktex.py results-paper.json [--extra extra.json]
# Every number in the prose is a \defnum here; tables are written whole. Nothing is typed by hand.
import argparse, collections, json, math, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser(); ap.add_argument('json'); ap.add_argument('--extra', help='JSON of extra numbers {key: value}')
a = ap.parse_args()
J = json.load(open(a.json))
TYPES = [t for t in ('intel', 'amd', 'arm', 'box', 'mac') if t in J['R']]
SETS = ['gcsn', 'd20k', 'advtest', 'fiqa', 'dall', 'quora', 'csn1m']  # by size
MODELS = ['CodeRankEmbed', 'jina-v2-base-code', 'bge-base-en-v1.5']
MSHORT = {'CodeRankEmbed': 'CRE', 'jina-v2-base-code': 'jina', 'bge-base-en-v1.5': 'bge'}
TNAME = {'intel': 'Intel', 'amd': 'AMD', 'arm': 'Graviton', 'box': 'box', 'mac': 'Mac'}
nums = {}


def tex(s):
    return str(s).replace('_', r'\_')


import sys
sys.path.insert(0, os.path.join(HERE, '..'))
from paperlib import ratio_ci, headline, dev_latency  # noqa: E402


def cell(est, lo, hi):
    s = f'{est:.2f}'
    if hi is not None and hi < 1:
        s = r'\loss{' + s + '}'
    return r'\rr{' + s + '}{' + (f'{lo:.2f}' if lo else '') + '}{' + (f'{hi:.2f}' if hi else '') + '}'


B = collections.defaultdict(dict)  # (t, s, m, f) -> system -> record
for r in J['B']:
    B[(r['type'], r['set'], r['model'], r['f'])][r['system']] = r

# ---- headline: ours vs the rival that was fastest on dev at f (frozen point), held-out, per CPU and fraction
for f in (0.98, 0.99, 0.995):
    rows, logs, logs_both = [], collections.defaultdict(list), collections.defaultdict(list)
    for s_ in SETS:
        for m in MODELS:
            line = [s_, MSHORT[m]]; any_ = False
            for t in TYPES:
                h = headline(B.get((t, s_, m, f), {}), t, s_, m, f)
                if not h:
                    line.append(''); continue
                any_ = True; o, rn, rv = h
                est, lo, hi = ratio_ci(o['round_us'], rv['round_us'])
                mark = ('' if o['meets_point'] else '$^\\dagger$') + ('' if rv['meets_point'] else '$^\\ddagger$')
                line.append(cell(est, lo, hi) + mark)
                logs[t].append(math.log(est))
                if o['meets_point'] and rv['meets_point']:
                    logs_both[t].append(math.log(est))
            if any_:
                rows.append(' & '.join(line) + r' \\')
    tag = str(f).replace('.', '')
    gm = lambda v: f'{math.exp(sum(v) / len(v)):.2f} ({len(v)})' if v else ''
    with open(os.path.join(HERE, 'tables', f'headline-{tag}.tex'), 'w') as w:
        w.write('\n'.join(rows) + '\n\\midrule\n' + ' & '.join(['geomean', 'all'] + [gm(logs[t]) for t in TYPES]) + ' \\\\\n'
                + ' & '.join(['', 'both meet'] + [gm(logs_both[t]) for t in TYPES]) + ' \\\\\n')
    for t in TYPES:
        if logs[t]:
            nums[f'gm-{t}-{tag}'] = f'{math.exp(sum(logs[t]) / len(logs[t])):.2f}'
            nums[f'gmn-{t}-{tag}'] = str(len(logs[t]))
            nums[f'wins-{t}-{tag}'] = str(sum(1 for x in logs[t] if x > 0))
    allv = [x for v in logs.values() for x in v]
    if allv:
        nums[f'gm-all-{tag}'] = f'{math.exp(sum(allv) / len(allv)):.2f}'; nums[f'gmn-all-{tag}'] = str(len(allv))
        nums[f'wins-all-{tag}'] = str(sum(1 for x in allv if x > 0))
with open(os.path.join(HERE, 'tables', 'headline-cols.tex'), 'w') as w:
    w.write(' & '.join(TNAME[t] for t in TYPES))

# ---- which rival was fastest on dev (named), f = 0.99
rows = []
for s_ in SETS:
    for m in MODELS:
        line = [s_, MSHORT[m]]; any_ = False
        for t in TYPES:
            h = headline(B.get((t, s_, m, 0.99), {}), t, s_, m, 0.99)
            line.append(r'\scriptsize ' + tex(h[1]) if h else ''); any_ |= bool(h)
        if any_:
            rows.append(' & '.join(line) + r' \\')
open(os.path.join(HERE, 'tables', 'fastest-rival-099.tex'), 'w').write('\n'.join(rows) + '\n')

# ---- primary comparisons
P = J.get('primary') or []
rows = []
for p in P:
    if p.get('missing'):
        rows.append(f"{TNAME[p['type']]} & {p['set']} & {MSHORT[p['model']]} & {tex(p['rival'])} & \\multicolumn{{5}}{{l}}{{no held-out record}} & fail \\\\"); continue
    rows.append(f"{TNAME[p['type']]} & {p['set']} & {MSHORT[p['model']]} & {tex(p['rival'])} & {cell(p['ratio'], p['lo'], p['hi'])} & "
                f"{p['ours_meets']} ; {p['rival_meets']} & {p['mean_diff']:+.4f} & {p['lower']:+.4f} & {p['p']:.4f} & " + {True: 'pass', False: 'fail', None: 'descr.'}[p.get('holm_pass')] + " \\\\")
open(os.path.join(HERE, 'tables', 'primary.tex'), 'w').write('\n'.join(rows) + '\n')
nums['nprimary'] = str(len(P)) if P else '15'
nums['nprimarypass'] = str(sum(1 for p in P if p.get('holm_pass')))
nums['nconfirm'] = str(sum(1 for p in P if p.get('confirmatory')))
nums['ndescr'] = str(sum(1 for p in P if not p.get('confirmatory')))
nums['nprimaryfaster'] = str(sum(1 for p in P if not p.get('missing') and p['lo'] and p['lo'] > 1))
nums['nprimaryslower'] = str(sum(1 for p in P if not p.get('missing') and p['hi'] and p['hi'] < 1))

# ---- comparison (A) at C 400 / H 100, the smaller declared effort, one model per set kind
A = collections.defaultdict(list)
for r in J['A']:
    A[(r['type'], r['set'], r['model'], r['C'], r['H'], r['system'])].append(r)


def eff_val(e):
    try:
        return float(e.split()[-1])
    except ValueError:
        return 0.0


GENS = ['ours_scan', 'ours_walk', 'faiss_bin_flat', 'faiss_bin_hnsw', 'usearch_b1_rescore', 'hnswlib_f32', 'faiss_hnsw_flat',
        'faiss_rabitq_flat', 'faiss_rabitq_ivf', 'scann', 'diskann_vamana']
for t in TYPES:
    rows = []
    for s in SETS:
        m = 'bge-base-en-v1.5' if s in ('quora', 'fiqa') else 'CodeRankEmbed'
        line = [s]; base = None
        recs = {}
        for g in GENS:
            v = sorted(A.get((t, s, m, 400, 100, g), []), key=lambda r: eff_val(r['effort']))
            recs[g] = v[0] if v and not (g == 'ours_scan' and s in ('quora', 'csn1m')) else None  # above 150k vectors our scan is the walk
        if not any(recs.values()):
            continue
        base = recs.get('ours_scan')
        for g in GENS:
            r = recs[g]
            line.append('' if not r else f"{r['us']:.0f}" + (r'\,{\tiny(' + f"{r['share']:.3f}" + ')}'))
        rows.append(' & '.join(line) + r' \\')
    open(os.path.join(HERE, 'tables', f'compA-{t}.tex'), 'w').write('\n'.join(rows) + '\n')
open(os.path.join(HERE, 'tables', 'compA-cols.tex'), 'w').write(' & '.join(r'\rotatebox{70}{' + tex(g) + '}' for g in GENS))

# ---- memory and cold start at f = 0.99 (one model per kind; largest sets)
for s in ('csn1m', 'quora', 'dall'):
    m = 'bge-base-en-v1.5' if s == 'quora' else 'CodeRankEmbed'
    rows = []
    for t in [t for t in TYPES if t != 'mac']:  # macOS: the rival harness's freed load buffers stay in the footprint (see text)
        d = B.get((t, s, m, 0.99), {})
        for k, x in sorted(d.items(), key=lambda kv: kv[1]['us']):
            rows.append(f"{TNAME[t]} & {tex(k)} & {x['us']:.0f} & {x['share']:.4f} & {(x['rss_mb'] or 0):.0f} & {('%.0f' % x['cold_ms']) if x.get('cold_ms') else ''} \\\\")
        if d:
            rows.append(r'\midrule')
    open(os.path.join(HERE, 'tables', f'mem-{s}.tex'), 'w').write('\n'.join(rows[:-1] if rows else rows) + '\n')

# ---- memory and cold start at 1M (csn1m, CodeRankEmbed, f = 0.99) per Linux AWS CPU
for t in ('intel', 'amd', 'arm'):
    d = B.get((t, 'csn1m', 'CodeRankEmbed', 0.99), {})
    o = d.get('ours_cascade'); riv = [(x['rss_mb'], k, x) for k, x in d.items() if not k.startswith('ours') and x.get('rss_mb')]
    if o and riv:
        nums[f'mem-ours-{t}'] = f"{o['rss_mb'] / 1024:.1f}"; nums[f'cold-ours-{t}'] = f"{o['cold_ms'] / 1000:.1f}" if o.get('cold_ms') else ''
        lo = min(riv); hi = max(riv)
        nums[f'mem-rivalmin-{t}'] = f"{lo[0] / 1024:.1f}"; nums[f'mem-rivalmin-sys-{t}'] = tex(lo[1])
        nums[f'mem-rivalmax-{t}'] = f"{hi[0] / 1024:.1f}"
        nums[f'mem-smaller-{t}'] = str(sum(1 for r in riv if r[0] < o['rss_mb'])); nums[f'mem-nriv-{t}'] = str(len(riv))
        cs = [x['cold_ms'] for _, _, x in riv if x.get('cold_ms')]
        nums[f'cold-rivalmin-{t}'] = f"{min(cs) / 1000:.1f}"; nums[f'cold-rivalmax-{t}'] = f"{max(cs) / 1000:.1f}"

# ---- build cost at 1M: one row per family (CodeRankEmbed), range over its build grid
rows = []
fam = collections.defaultdict(list)
for b in J.get('build') or []:
    if b['model'] == 'CodeRankEmbed':
        fam[b['family']].append(b)
for f, bs in sorted(fam.items(), key=lambda kv: min(b['wall_s'] for b in kv[1])):
    w = [b['wall_s'] for b in bs]; th = max(b['threads'] or 1 for b in bs); sz = [b['size_gb'] for b in bs]; pk = max(b['peak_gb'] for b in bs)
    rng = lambda v, fmt: (fmt % min(v)) if fmt % min(v) == fmt % max(v) else (fmt % min(v)) + '--' + (fmt % max(v))
    rows.append(f"{tex(f)} & {len(bs)} & {rng(w, '%.0f')} & {th} & {rng([x * th for x in w], '%.0f')} & {rng(sz, '%.2f')} & {pk:.1f} \\\\")
    if f == 'ours':
        nums['build-ours-s'] = f"{w[0]:,.0f}"; nums['build-ours-h'] = f"{w[0] / 3600:.1f}"; nums['build-ours-peak'] = f"{pk:.1f}"
open(os.path.join(HERE, 'tables', 'build.tex'), 'w').write('\n'.join(rows) + '\n')
allr = [b for bs in fam.values() for b in bs if b['family'] != 'ours']
if allr:
    nums['build-rival-max-s'] = f"{max(b['wall_s'] for b in allr):,.0f}"
    nums['build-rival-max-cores'] = f"{max(b['wall_s'] * (b['threads'] or 1) for b in allr):,.0f}"

# ---- power of the primary comparisons (dev, from the frozen shortlists)
rows = []
for t in ('intel', 'amd', 'arm'):
    for p in json.load(open(os.path.join(HERE, '..', 'shortlists', f'shortlist-{t}.json')))['meta']['primary']:
        rows.append(f"{TNAME[t]} & {p['set']} & {MSHORT[p['model']]} & {tex(p['rival'])} & {p['ours_us']:.0f} & {p['rival_us']:.0f} & "
                    f"{p['n_clusters_ho']} & {p['se_ho']:.4f} & {p['power_analytic']:.2f} & {p['power_sim']:.2f} \\\\")
open(os.path.join(HERE, 'tables', 'power.tex'), 'w').write('\n'.join(rows) + '\n')

# ---- prose counts at f = 0.99 (B): large sets (Quora, csn1m) and small code sets (gcsn, d20k, advtest)
def cells(sets, f=0.99):
    out = []
    for t in TYPES:
        for s in sets:
            for m in MODELS:
                h = headline(B.get((t, s, m, f), {}), t, s, m, f)
                if h:
                    out.append((t, s, m) + ratio_ci(h[0]['round_us'], h[2]['round_us']))
    return out
for tag, sets in (('large', ('quora', 'csn1m')), ('small', ('gcsn', 'd20k', 'advtest')), ('mid', ('fiqa', 'dall'))):
    c = cells(sets)
    nums[f'n-{tag}'] = str(len(c))
    nums[f'faster-{tag}'] = str(sum(1 for x in c if x[4] and x[4] > 1))
    nums[f'slower-{tag}'] = str(sum(1 for x in c if x[5] and x[5] < 1))
    nums[f'gm-{tag}'] = f"{math.exp(sum(math.log(x[3]) for x in c) / len(c)):.2f}" if c else ''
    nums[f'min-{tag}'] = f"{min(x[3] for x in c):.2f}" if c else ''
    nums[f'max-{tag}'] = f"{max(x[3] for x in c):.2f}" if c else ''
# (A) at C 400 / H 100: fastest other generator that retains >= 0.99 vs the faster of our two generators
ra, lowq, lowq_part = [], 0, 0
for t in TYPES:
    for s in SETS:
        m = 'bge-base-en-v1.5' if s in ('quora', 'fiqa') else 'CodeRankEmbed'
        best = {}
        for g in GENS:
            v = sorted(A.get((t, s, m, 400, 100, g), []), key=lambda r: eff_val(r['effort']))
            if v and not (g == 'ours_scan' and s in ('quora', 'csn1m')):
                best[g] = v[0]
        ours = [best[g] for g in ('ours_scan', 'ours_walk') if g in best]
        oth = [r for g, r in best.items() if not g.startswith('ours') and r['share'] >= 0.99]
        lowq += sum(1 for g, r in best.items() if not g.startswith('ours') and r['share'] < 0.99)
        lowq_part += sum(1 for g, r in best.items() if g in ('faiss_rabitq_ivf', 'scann') and r['share'] < 0.99)
        if ours and oth:
            ra.append(min(r['us'] for r in oth) / min(r['us'] for r in ours))
if ra:
    nums['A-min'] = f'{min(ra):.1f}'; nums['A-max'] = f'{max(ra):.1f}'; nums['A-n'] = str(len(ra))
    nums['A-gm'] = f'{math.exp(sum(math.log(x) for x in ra) / len(ra)):.1f}'; nums['A-oursbest'] = str(sum(1 for x in ra if x > 1))
nums['A-lowq'] = str(lowq); nums['A-lowq-part'] = str(lowq_part); nums['A-lowq-graph'] = str(lowq - lowq_part)
nA = sum(1 for r in J['A']); nums['A-records'] = f'{nA:,}'
nums['B-records'] = f"{len(J['B']):,}"

# ---- tuning budget: distinct dev configurations of (B) per (set, model), from the frozen plans (first sweep + widening)
import glob
tb = collections.defaultdict(lambda: collections.defaultdict(set))
for t in ('intel', 'amd', 'arm'):
    for f in glob.glob(os.path.join(HERE, '..', 'plans', f'q-{t}', 'dev', '*.json')) + glob.glob(os.path.join(HERE, '..', 'plans', f'w-{t}', 'dev', '*.json')):
        for j in json.load(open(f))['jobs']:
            if j.get('comparison') == 'B' and j.get('kind', 'timing') == 'timing':
                tb[t][j['system']].add((j['set'], j['model'], json.dumps({x: j.get(x) for x in ('family', 'build_params', 'search', 'S1', 'EF')}, sort_keys=True)))
syss = sorted({k for v in tb.values() for k in v}, key=lambda k: -len(tb['intel'].get(k, ())))
rows = []
for k in syss:
    n = {t: len(tb[t].get(k, ())) for t in ('intel', 'amd', 'arm')}
    sm = {t: len({(a, b) for a, b, _ in tb[t].get(k, ())}) or 1 for t in n}
    rows.append(tex(k) + ' & ' + ' & '.join((f"{n[t] / sm[t]:.0f}" if n[t] else '') for t in ('intel', 'amd', 'arm')) + r' \\')
    if k == 'ours_cascade':
        nums['tune-ours'] = f"{n['intel'] / sm['intel']:.0f}"
nums['tune-max'] = f"{max(len(v) / (len({(a, b) for a, b, _ in v}) or 1) for v in tb['intel'].values()):.0f}"
open(os.path.join(HERE, 'tables', 'tuning.tex'), 'w').write('\n'.join(rows) + '\n')

# ---- held-out re-test of the dev points at f = 0.99: point estimate and bound, ours vs rivals
for who, sel in (('ours', lambda k: k == 'ours_cascade'), ('riv', lambda k: not k.startswith('ours') and k != 'faiss_exact')):
    rr = [r for r in J['B'] if r['f'] == 0.99 and sel(r['system'])]
    nums[f'ret-{who}-n'] = f'{len(rr):,}'
    nums[f'ret-{who}-point'] = f"{sum(r['meets_point'] for r in rr):,}"; nums[f'ret-{who}-bound'] = f"{sum(r['meets_bound'] for r in rr):,}"
    nums[f'ret-{who}-boundpct'] = f"{100 * sum(r['meets_bound'] for r in rr) / len(rr):.0f}"
    nums[f'ret-{who}-pointpct'] = f"{100 * sum(r['meets_point'] for r in rr) / len(rr):.0f}"

# ---- slow rounds: a round whose median exceeds 3x the fastest round of the same point (B and A)
slow = collections.Counter(); tot = collections.Counter(); moved = 0
for r in J['B'] + J['A']:
    if r['system'] == 'ours_scan' and r['set'] in ('quora', 'csn1m'):
        continue  # the scan does not exist above 150k vectors (these rows repeat the walk)
    who = 'ours' if r['system'].startswith('ours') else 'riv'
    lo = min(r['round_us']); n = sum(1 for x in r['round_us'] if x > 3 * lo)
    slow[who] += n; tot[who] += len(r['round_us'])
    if who == 'ours' and n * 2 >= len(r['round_us']) and n:
        moved += 1
for who in ('ours', 'riv'):
    nums[f'slow-{who}'] = f'{slow[who]:,}'; nums[f'rounds-{who}'] = f'{tot[who]:,}'
nums['slow-ours-pct'] = f"{100 * slow['ours'] / tot['ours']:.1f}"
nums['slow-moved'] = str(moved)

# ---- (A) over every model, budget and effort: is the fastest generator that keeps >= 0.99 always ours?
cellsA = collections.defaultdict(list)
for r in J['A']:
    if r['system'] == 'ours_scan' and r['set'] in ('quora', 'csn1m'):
        continue
    cellsA[(r['type'], r['set'], r['model'], r['C'], r['H'], r['effort'] if not r['system'].startswith('ours') else 'x')].append(r)
cellsA2 = collections.defaultdict(list)
for r in J['A']:
    if r['system'] == 'ours_scan' and r['set'] in ('quora', 'csn1m'):
        continue
    cellsA2[(r['type'], r['set'], r['model'], r['C'], r['H'])].append(r)
nA = exc = noours = 0
for k, v in cellsA2.items():
    ok = [r for r in v if r['share'] >= 0.99]
    if not ok:
        continue
    nA += 1
    if not any(r['system'].startswith('ours') for r in ok):
        noours += 1
    elif not min(ok, key=lambda r: r['us'])['system'].startswith('ours'):
        exc += 1
byC = collections.Counter(); totC = collections.Counter()
for k, v in cellsA2.items():
    band = 'small' if k[3] <= 200 else ('400' if k[3] == 400 else '1000')
    totC[band] += 1
    ok = [r for r in v if r['share'] >= 0.99]
    if ok and not any(r['system'].startswith('ours') for r in ok):
        byC[band] += 1
for band in ('small', '400', '1000'):
    nums[f'Aonly-{band}'] = str(byC[band]); nums[f'Atot-{band}'] = str(totC[band])
nums['Aall-n'] = f'{nA:,}'; nums['Aall-exc'] = str(exc); nums['Aall-noours'] = str(noours)
lowest = collections.defaultdict(lambda: 9.0)
for r in J['A']:
    if r['C'] == 400 and r['H'] == 100:
        lowest[r['system']] = min(lowest[r['system']], r['share'])
for g in ('ours_walk', 'ours_scan', 'faiss_bin_hnsw', 'scann', 'hnswlib_f32'):
    if g in lowest:
        nums[f'Aall-min-{g}'] = f'{100 * lowest[g]:.1f}'

# ---- the int8 screen (A): H = C (no screen) vs H = 100 at C = 400, our walk, smaller effort, same rows
scr = []
for r in J['A']:
    if r['system'] == 'ours_walk' and r['C'] == 400 and r['H'] == 400:
        twin = [x for x in J['A'] if x['system'] == 'ours_walk' and x['C'] == 400 and x['H'] == 100 and x['type'] == r['type']
                and x['set'] == r['set'] and x['model'] == r['model'] and x['effort'] == r['effort']]
        if twin:
            scr.append((r['us'] / twin[0]['us'], r['share'] - twin[0]['share']))
if scr:
    q = np.percentile([x[0] for x in scr], [10, 50, 90])
    nums['screen-p10'], nums['screen-med'], nums['screen-p90'] = (f'{x:.1f}' for x in q)
    nums['screen-n'] = str(len(scr))
    nums['screen-tmin'] = f'{min(x[0] for x in scr):.1f}'; nums['screen-tmax'] = f'{max(x[0] for x in scr):.1f}'
    nums['screen-qmin'] = f'{min(x[1] for x in scr):+.4f}'; nums['screen-qmax'] = f'{max(x[1] for x in scr):+.4f}'

# ---- power range of the primary pairs (dev)
pa, ps = [], []
for t in ('intel', 'amd', 'arm'):
    for q in json.load(open(os.path.join(HERE, '..', 'shortlists', f'shortlist-{t}.json')))['meta']['primary']:
        pa.append(q['power_analytic']); ps.append(q['power_sim'])
nums['powermin-a'] = f'{min(pa):.2f}'; nums['powermin-s'] = f'{min(ps):.2f}'; nums['powermax'] = f'{max(pa + ps):.2f}'

# ---- protocol numbers
fz = J['freeze']
nums['delta'] = str(fz['delta'])
for t in TYPES:
    nums[f'R-{t}'] = str(J['R'][t]) if J['R'][t] else ''
if a.extra:
    nums.update({k: str(v) for k, v in json.load(open(a.extra)).items()})
with open(os.path.join(HERE, 'numbers.tex'), 'w') as w:
    w.write('% generated by mktex.py from ' + os.path.basename(a.json) + '; do not edit\n')
    for k in sorted(nums):
        w.write(f'\\defnum{{{k}}}{{{nums[k]}}}\n')
print(f'{len(nums)} numbers, tables for {TYPES}')
