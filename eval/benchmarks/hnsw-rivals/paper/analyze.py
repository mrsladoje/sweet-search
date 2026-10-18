# S9 analysis (PAPER_PLAN.md section 11): held-out results of the frozen points -> RESULTS-paper.md.
#   python analyze.py --data DATA --results RESULTS --shortlists DIR [--builds BUILDS] [--out RESULTS-paper.md]
# Machines are grouped by type from their name (ho-<type>-*, hr-<type>-* repair, box, mac). Per (type, set, model) and frozen point:
#   latency  = median over rounds of the per-round median per-query time (µs); 95% interval of the ratio
#              rival/ours from the round medians (log scale, Welch t);
#   quality  = held-out MRR@10 (code) or nDCG@10 (BEIR) of round 0, as a share of the exact ranking's quality;
#              "missed" when the one-sided 97.5% cluster-bootstrap bound of mean(Q_sys - f Q_exact) < 0;
#   memory   = RSS after the timed pass (MB); cold start = load + first query of the cold job.
# Primary comparisons (FREEZE.json): per CPU type and confirmatory set (quora, fiqa), f = 0.99 in (B): ours vs the
# fastest rival at that point; non-inferiority of quality at delta (one-sided 0.025), Holm over all of them.
import argparse, collections, fnmatch, glob, json, math, os, statistics as st, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402
import stats  # noqa: E402

FIELDS = ('family', 'build_params', 'search', 'gen', 'C', 'H', 'ef', 'S1', 'EF')
ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True); ap.add_argument('--results', required=True); ap.add_argument('--shortlists', required=True)
ap.add_argument('--builds', help='DATA/builds/shared with build.json files (build cost table)')
ap.add_argument('--need-lists', help='write the result-relative paths of the .lists.bin files the analysis reads and are missing, then stop')
ap.add_argument('--json', help='also write every reported value as JSON (tables and numbers of the paper)')
ap.add_argument('--types', help='comma list of machine types to analyse (parallel runs; merge with merge_results.py)')
ap.add_argument('--freeze', default=os.path.join(HERE, 'FREEZE.json')); ap.add_argument('--out', default='RESULTS-paper.md')
a = ap.parse_args()
fz = json.load(open(a.freeze)); DELTA = fz['delta']


def mtype(name):
    if name.startswith(('ho-', 'hr-')):  # held-out and its repair pass (same frozen code)
        return name.split('-')[1]
    return {'box': 'box', 'mac': 'mac', 'mac-local': 'mac'}.get(name)


def pkey(system, d):
    return json.dumps({'system': system, **{f: d[f] for f in FIELDS if f in d and d[f] is not None}}, sort_keys=True)


# ---- load held-out records
recs = collections.defaultdict(lambda: collections.defaultdict(list))  # (type, set, model, comp) -> point -> [records]
cold = {}
for md in glob.glob(os.path.join(a.results, '*')):
    t = mtype(os.path.basename(md))
    if not t:
        continue
    for f in glob.glob(os.path.join(md, '*', '*', '*.json')):
        if f.endswith('.key.json') or '/stale/' in f or '/plans/' in f:
            continue
        try:
            r = json.load(open(f))
        except Exception:
            continue
        if not r.get('complete') or r.get('split') != 'ho' or 'key' not in r:
            continue
        k = r['key']; d = dict(r.get('params') or {}); d.update(k)
        pk = pkey(r['system'], d)
        if k.get('kind') == 'cold':
            cold[(t, r['set'], r['model'], pk)] = r
        elif k.get('kind') == 'timing':
            recs[(t, r['set'], r['model'], r['comparison'])][pk].append((r['round'], f, r))
print(f"{sum(len(v) for v in recs.values())} held-out points, {len(cold)} cold jobs", file=sys.stderr)
if a.need_lists:  # quality is read from the lowest round of every point (comparisons A and B)
    need = [min(rs)[1] for v in recs.values() for rs in v.values()]
    need = [os.path.relpath(os.path.splitext(f)[0] + '.lists.bin', a.results) for f in need if not os.path.exists(os.path.splitext(f)[0] + '.lists.bin')]
    open(a.need_lists, 'w').write(''.join(x + '\n' for x in need))
    print(f'{len(need)} lists missing -> {a.need_lists}', file=sys.stderr); sys.exit(0)

sets_cache, qx_cache, boot_cache = {}, {}, {}


def ctx(s, m):
    if (s, m) not in qx_cache:
        S = sets_cache.setdefault(s, Q.load_set(a.data, s))
        qidx = Q.split_index(S, 'ho')
        qx_cache[(s, m)] = (S, qidx, Q.exact_quality(S, a.data, m, 'ho'))
        boot_cache.setdefault(s, stats.ClusterBoot([S.clusters[i] for i in qidx]))
    return qx_cache[(s, m)] + (boot_cache[s],)


qual_cache = {}


def quality_of(path, s, m):
    if path not in qual_cache:
        S, qidx, qx, _ = ctx(s, m)
        _, v, sc = Q.read_record(path)
        qual_cache[path] = Q.eval_lists_fast(S, qidx, v, sc)['q']
    return qual_cache[path]


def mem_kb(r):
    """Memory after the timed pass (kB): macOS physical footprint (excludes freed pages the allocator keeps and clean
    file pages), else Linux Rss from smaps_rollup (anonymous + file-backed), else rss_kb. Values may be strings."""
    m = (r.get('memory') or {}).get('after') or {}
    for k in ('phys_footprint_kb', 'Rss', 'rss_kb'):
        if m.get(k) not in (None, ''):
            return int(m[k])
    return None


def summarize(rs):
    rs = sorted(rs, key=lambda x: x[0])
    meds = [float(np.median(r['timings_ns'])) / 1e3 for _, _, r in rs]
    mem = [x for x in (mem_kb(r) for _, _, r in rs) if x]
    return dict(lat=float(np.median(meds)), rounds=len(meds), round_meds=meds, rec0=rs[0][1],
                rss_mb=(st.median(mem) / 1024 if mem else None))


def ratio_ci(a_meds, b_meds, B=10000, seed=42):
    """median(b) / median(a) over rounds, 95% percentile interval from a bootstrap over rounds (each arm resampled
    on its own). Robust to a single slow round (an outlier round moves a mean of logs, not a median)."""
    a_, b_ = np.asarray(a_meds, float), np.asarray(b_meds, float)
    est = float(np.median(b_) / np.median(a_))
    if len(a_) < 2 or len(b_) < 2:
        return est, None, None
    rng = np.random.default_rng(seed)
    ra = np.median(a_[rng.integers(0, len(a_), (B, len(a_)))], axis=1)
    rb = np.median(b_[rng.integers(0, len(b_), (B, len(b_)))], axis=1)
    lo, hi = np.percentile(rb / ra, [2.5, 97.5])
    return est, float(lo), float(hi)


out = ['# HNSW rivals paper: held-out results (frozen points)', '',
       f"Freeze: files of commit `{fz['commit'][:10]}` ({fz['frozen_utc']}), delta = {DELTA}, fractions {fz['fractions']}, one-sided alpha {fz['alpha_one_sided']}, "
       f"bootstrap {fz['bootstrap']['resamples']} resamples (seed {fz['bootstrap']['seed']}). Latency = median over R rounds of the per-round "
       "median per-query time (one pinned core, warm page cache). Ratio = median over rounds of rival / median over rounds of ours (> 1: ours faster), 95% percentile interval from a bootstrap over rounds (10,000 resamples, seed 42). "
       "Meets f: the held-out point estimate of retained quality >= f / the one-sided 97.5% cluster-bootstrap bound of "
       "mean(Q_sys - f Q_exact) >= 0 (the dev selection rule, applied once to held-out).", '']
primaries = []
J = dict(B=[], A=[], primary=None, build=[], n_ho={}, q_exact={}, R={})
summary = []  # (type, set, model, f, ours sm, best rival name, its sm): fastest rival whose held-out point estimate meets f
types = sorted({k[0] for k in recs if not a.types or k[0] in a.types.split(',')})
for t in types:
    sl_type = {'box': 'amd', 'mac': 'arm'}.get(t, t)
    sl = json.load(open(os.path.join(a.shortlists, f'shortlist-{sl_type}.json')))
    out += [f'## {t} (frozen points from the {sl_type} shortlist, R = {sl["meta"]["R"] if t == sl_type else "own A/A"})', '']
    for s in sorted({k[1] for k in recs if k[0] == t}):
        for m in sorted({k[2] for k in recs if k[0] == t and k[1] == s}):
            B = recs.get((t, s, m, 'B'), {})
            if not B or s not in sl or m not in sl[s]:
                continue
            S, qidx, qx, boot = ctx(s, m)
            sel = sl[s][m]['selection']
            J['n_ho'][s] = len(qidx); J['q_exact'][f'{s}/{m}'] = float(qx.mean()); J['R'][t] = sl['meta']['R'] if t == sl_type else None
            out += [f'### {s} / {m} (n_ho = {len(qidx)}, exact quality {qx.mean():.4f})', '',
                    '| System | f | Held-out µs | Rounds | Retained quality | Meets f (point / bound) | rival/ours [95% CI] | RSS MB | Cold start ms |',
                    '|---|---:|---:|---:|---:|---|---|---:|---:|']
            ours_at = {}
            rows = []
            absent = []
            for sysname, per_f in sorted(sel.items()):
                pks = [pkey(e['point']['system'], e['point']) for e in per_f.values() if e]
                if pks and not any(B.get(k) for k in pks):
                    absent.append(sysname); continue  # this machine does not run the system (or lost all its jobs)
                for f, e in sorted(per_f.items()):
                    if not e:
                        continue
                    pk = pkey(e['point']['system'], e['point'])
                    rs = B.get(pk)
                    if not rs:
                        rows.append((sysname, f, None)); continue
                    sm = summarize(rs); q = quality_of(sm['rec0'], s, m)
                    selr = stats.selection(boot, q, qx, float(f))
                    c = cold.get((t, s, m, pk))
                    sm.update(q=q, share=float(q.mean() / qx.mean()) if qx.mean() else float('nan'), meets=('yes' if selr['mean_d'] >= 0 else 'no') + ' / ' + ('yes' if selr['qualifies'] else 'no'),
                              cold_ms=((c['load_s'] * 1e3 + c['first_query_ns'] / 1e6) if c and c.get('first_query_ns') else None))
                    rows.append((sysname, f, sm))
                    J['B'].append(dict(type=t, set=s, model=m, system=sysname, f=float(f), us=sm['lat'], rounds=sm['rounds'], round_us=sm['round_meds'],
                                       share=sm['share'], meets_point=selr['mean_d'] >= 0, meets_bound=bool(selr['qualifies']), lower=selr['lower'],
                                       rss_mb=sm['rss_mb'], cold_ms=sm['cold_ms'], point=e['point']))
                    if sysname == 'ours_cascade':
                        ours_at[f] = sm
            for sysname, f, sm in rows:
                if sm is None:
                    out.append(f'| {sysname} | {f} | not run | | | | | | |'); continue
                o = ours_at.get(f)
                rc = ''
                if o and sysname != 'ours_cascade':
                    est, lo, hi = ratio_ci(o['round_meds'], sm['round_meds'])
                    rc = f'{est:.2f}' + (f' [{lo:.2f}, {hi:.2f}]' if lo else '')
                out.append(f"| {sysname} | {f} | {sm['lat']:.1f} | {sm['rounds']} | {sm['share']:.4f} | {sm['meets']} | {rc} | "
                           f"{(sm['rss_mb'] or 0):.0f} | {('%.0f' % sm['cold_ms']) if sm['cold_ms'] else ''} |")
            for f, o in sorted(ours_at.items()):
                ok = sorted((sm['lat'], sn, sm) for sn, ff, sm in rows if sm and ff == f and not sn.startswith('ours') and sm['meets'].startswith('yes'))
                summary.append((t, s, m, f, o, ok[0][1] if ok else None, ok[0][2] if ok else None))
            if absent:
                out.append(f"No held-out record on this machine: {', '.join(absent)}.")
            out.append('')
            # primary comparison: the pair fixed on dev (shortlist meta.primary), at f = 0.99 in (B)
            for pp in (sl['meta'].get('primary') or []) if t == sl_type else []:
                if (pp['set'], pp['model']) != (s, m):
                    continue
                rsm = next((sm for sn, f, sm in rows if sn == pp['rival'] and f == '0.99'), None)
                o = ours_at.get('0.99')
                if o is None or rsm is None:
                    primaries.append(dict(type=t, set=s, model=m, rival=pp['rival'], missing=True)); continue
                ni = stats.noninferiority(boot, o['q'], rsm['q'], DELTA)
                est, lo, hi = ratio_ci(o['round_meds'], rsm['round_meds'])
                primaries.append(dict(type=t, set=s, model=m, rival=pp['rival'], ratio=est, lo=lo, hi=hi, ours_meets=o['meets'], rival_meets=rsm['meets'], **ni))
            # comparison (A): every generator with the common rescoring, per budget (C candidates, H rescored)
            Ar = recs.get((t, s, m, 'A'), {})
            if Ar:
                cells = collections.defaultdict(list)  # (generator, C, H) -> [(lat, share, meets 0.99 point, effort)]
                for pk, rs in Ar.items():
                    d = json.loads(pk); sm = summarize(rs); q = quality_of(sm['rec0'], s, m)
                    share = float(q.mean() / qx.mean())
                    sd = d.get('search') or ({'ef': d['ef']} if 'ef' in d else {})
                    eff = ', '.join(f'{k} {v}' for k, v in sorted(sd.items())) or 'exhaustive'
                    cells[(d['system'], d.get('C'), d.get('H'))].append((sm['lat'], share, share >= 0.99, eff, sm))
                    J['A'].append(dict(type=t, set=s, model=m, system=d['system'], C=d.get('C'), H=d.get('H'), effort=eff, us=sm['lat'],
                                       rounds=sm['rounds'], round_us=sm['round_meds'], share=share, rss_mb=sm['rss_mb']))
                budgets = sorted({(c, h) for _, c, h in cells})
                rowsA = sorted({(g, x[3]) for (g, _, _), v in cells.items() for x in v})
                out += ['Comparison (A), common rescoring, every declared generator effort at every budget (C candidates, H rescored): '
                        'held-out µs / retained quality.', '',
                        '| Generator | Effort | ' + ' | '.join(f'C {c} / H {h}' for c, h in budgets) + ' |', '|---|---|' + '---:|' * len(budgets)]
                for g, eff in rowsA:
                    row = []
                    for b in budgets:
                        v = [x for x in cells.get((g,) + b, []) if x[3] == eff]
                        row.append(f'{v[0][0]:.1f} / {v[0][1]:.4f}' if v else '')
                    out.append(f"| {g} | {eff} | " + ' | '.join(row) + ' |')
                out.append('')
# summary at the top: ours vs the fastest rival that meets f (point estimate), per fraction
head = []
for f in sorted({x[3] for x in summary}):
    head += [f'## Summary at f = {f}: ours vs the fastest rival that meets f on held-out (point estimate)', '',
             '| CPU | Set | Model | Ours µs | Ours meets f (point / bound) | Fastest rival meeting f | Rival µs | rival/ours [95% CI] |',
             '|---|---|---|---:|---|---|---:|---|']
    by_t, by_both = collections.defaultdict(list), collections.defaultdict(list)
    for t, s, m, ff, o, rn, rsm in summary:
        if ff != f:
            continue
        if rsm is None:
            head.append(f"| {t} | {s} | {m} | {o['lat']:.1f} | {o['meets']} | none | | |"); continue
        est, lo, hi = ratio_ci(o['round_meds'], rsm['round_meds']); by_t[t].append(math.log(est))
        if o['meets'].startswith('yes'):
            by_both[t].append(math.log(est))
        head.append(f"| {t} | {s} | {m} | {o['lat']:.1f} | {o['meets']} | {rn} | {rsm['lat']:.1f} | {est:.2f}" + (f' [{lo:.2f}, {hi:.2f}]' if lo else '') + ' |')
    head += ['', 'Geometric mean of rival/ours per CPU (cells with a rival that meets f): ' +
             ', '.join(f'{t} {math.exp(np.mean(v)):.2f} (n = {len(v)})' for t, v in sorted(by_t.items())) + '; cells where ours also meets f: ' +
             ', '.join(f'{t} {math.exp(np.mean(v)):.2f} (n = {len(v)})' for t, v in sorted(by_both.items())), '']
out[4:4] = head
# Holm over the primary comparisons
if primaries:
    ps = [p.get('p', 1.0) for p in primaries]; hol = stats.holm(ps)  # a missing comparison counts as p = 1
    out += ['## Primary comparisons (pairs fixed on dev: quality non-inferiority of ours vs that rival at f = 0.99, Holm)', '',
            '| CPU | Set | Model | Fastest rival | rival/ours latency [95% CI] | Meets 0.99 ours / rival | mean(ours − rival) | lower bound | p | Holm |',
            '|---|---|---|---|---|---|---:|---:|---:|---|']
    for p, h in zip(primaries, hol):
        if p.get('missing'):
            out.append(f"| {p['type']} | {p['set']} | {p['model']} | {p['rival']} | no held-out record at f = 0.99 | | | | | fail |"); continue
        out.append(f"| {p['type']} | {p['set']} | {p['model']} | {p['rival']} | {p['ratio']:.2f}" + (f" [{p['lo']:.2f}, {p['hi']:.2f}]" if p['lo'] else '') +
                   f" | {p['ours_meets']} ; {p['rival_meets']} | {p.get('mean_diff', float('nan')):+.4f} | {p.get('lower', float('nan')):+.4f} | {p['p']:.4f} | {'pass' if h else 'fail'} |")
    out.append('')
# build cost at 1M
brows = []
if a.builds:
    rows = brows
    for bj in glob.glob(os.path.join(a.builds, 'csn1m', '*', '*', '*', 'build.json')):
        b = json.load(open(bj))
        rows.append((b['model'], b['family'], json.dumps(b['params'], sort_keys=True), b['build_s'], b.get('threads'), b['bytes'] / 1e9,
                     int((b.get('memory') or {}).get('maxrss_kb', 0)) / 1e6))
    for bj in glob.glob(os.path.join(a.data, 'emb', '*', 'csn1m', 'index', 'build.json')):
        b = json.load(open(bj))
        rows.append((b['model'], 'ours', 'M=64,efC=800', b['build_s'], 1, sum(v['bytes'] for v in b['files'].values()) / 1e9, b['peak_rss_kb'] / 1e6))
    out += ['## Build cost at 1M (csn1m; memory-admitted builds, not isolated cost runs)', '',
            '| Model | Family | Params | Wall s | Threads | Core-s | Size GB | Peak RSS GB |', '|---|---|---|---:|---:|---:|---:|---:|']
    for r in sorted(rows):
        out.append(f'| {r[0]} | {r[1]} | {r[2]} | {r[3]:.0f} | {r[4]} | {r[3] * (r[4] or 1):.0f} | {r[5]:.2f} | {r[6]:.1f} |')
open(a.out, 'w').write('\n'.join(out) + '\n')
if a.json:
    J['primary'] = [{k: v for k, v in p.items()} for p in primaries]
    if primaries:
        for p, h in zip(J['primary'], hol):
            p['holm_pass'] = bool(h)
    J['build'] = [dict(model=r[0], family=r[1], params=r[2], wall_s=r[3], threads=r[4], size_gb=r[5], peak_gb=r[6]) for r in (brows if a.builds else [])]
    J['freeze'] = {k: fz[k] for k in ('commit', 'frozen_utc', 'delta', 'fractions', 'alpha_one_sided', 'bootstrap')}
    json.dump(J, open(a.json, 'w'), indent=0, default=float)
print(f'wrote {a.out}: {len(types)} machine types, {len(primaries)} primary comparisons', file=sys.stderr)
