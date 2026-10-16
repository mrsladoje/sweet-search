# Dev selection (PAPER_PLAN.md section 4, S5b): from the dev records of one CPU type, the operating points of
# comparison (B) per system and retained fraction f, the (A) grid for held-out, R from the A/A runs (section 10)
# and the power of the primary comparisons. Writes shortlist-<type>.json (plan.py --mode heldout --shortlist)
# and a plain report. Dev data only: refuses any held-out record.
#
#   python dev_select.py --data DATA --results RESULTS --type intel [--machines 'dev-intel-*'] [--out DIR]
#
# A point is one (system, family, build_params, search, ours knobs) on one (set, model). Our records written
# before the job key held ef / S1 / EF share hashes, so points are identified from each record's own params
# and deduplicated (first record of a point wins). Per point: per-query quality from the retained lists
# (quality.eval_lists; document = max of its vectors, cut 10), latency = median of the per-query timings.
# Selection: d_q = Q_sys,q - f * Q_exact,q; qualifies when the one-sided 97.5% lower bound of mean(d)
# (cluster bootstrap over repositories for code sets, over queries for BEIR; 10,000 resamples, seed 42)
# is >= 0; the operating point = the fastest qualifying point of that system.
import argparse, fnmatch, glob, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402
import stats  # noqa: E402

FRACTIONS = (0.98, 0.99, 0.995)
CONFIRMATORY = {'quora', 'fiqa'}  # BEIR sets (S0: no fresh code set)
POINT_FIELDS = ('family', 'build_params', 'search', 'gen', 'C', 'H', 'ef', 'S1', 'EF')

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True); ap.add_argument('--results', required=True); ap.add_argument('--type', required=True)
ap.add_argument('--machines', help="glob over machine dirs (default 'dev-<type>-*')"); ap.add_argument('--out', default='.')
ap.add_argument('--target', type=float, default=0.02, help='R rule: 95%% half-width of the latency ratio')
ap.add_argument('--check', type=int, default=0, help='also run stats.selection on N points per (set, model) and compare')
a = ap.parse_args()
pat = a.machines or f'dev-{a.type}-*'
mdirs = sorted(d for d in glob.glob(os.path.join(a.results, '*')) if fnmatch.fnmatch(os.path.basename(d), pat))
if not mdirs:
    sys.exit(f'no machine dirs {pat} in {a.results}')


def point_of(rec):
    """Point identity from a record: the key's fields plus our knobs from params (S1/EF/ef)."""
    k = rec['key']; p = dict(rec.get('params') or {})
    pt = {'system': rec['system']}
    for f in POINT_FIELDS:
        v = k.get(f, p.get(f))
        if v is not None:
            pt[f] = v
    return pt


# ---- load records
pts = {}      # (set, model, comparison) -> {point json: dict(point, rec_path, lat_us, machine)}
aa = {}       # (set, model) -> {arm: {round: median_us}}
kv_of = {}
n_rec = 0
for md in mdirs:
    for f in glob.glob(os.path.join(md, '*', '*', '*.json')):
        if '/plans/' in f or os.path.basename(f).startswith('jobs-'):
            continue
        try:
            r = json.load(open(f))
        except Exception:
            continue
        if not r.get('complete') or 'key' not in r:
            continue
        if r['split'] != 'dev':
            sys.exit(f'refusing: held-out record {f}')
        if r['key'].get('kind') != 'timing':
            continue
        n_rec += 1
        s, m = r['set'], r['model']
        lat = float(np.median(r['timings_ns'])) / 1e3
        if 'kv' in r['key']:
            kv_of[(s, m)] = r['key']['kv']
        arm = (r['key'].get('options') or {}).get('arm')
        if arm:
            aa.setdefault((s, m), {}).setdefault(arm, {})[r['round']] = lat
            continue
        pt = point_of(r)
        pid = json.dumps(pt, sort_keys=True)
        pts.setdefault((s, m, r['comparison']), {}).setdefault(pid, dict(point=pt, rec=f, lat_us=lat, machine=os.path.basename(md)))
print(f'{len(mdirs)} machines, {n_rec} timing records, {sum(len(v) for v in pts.values())} points', file=sys.stderr)

# ---- per (set, model): quality, selection
shortlist, report, primary = {}, [], []
for (s, m) in sorted({(k[0], k[1]) for k in pts}):
    S = Q.load_set(a.data, s)
    qidx = Q.split_index(S, 'dev')
    gt = Q.read_gt(a.data, m, s, 'dev')
    qx = Q.exact_quality(S, a.data, m, 'dev')
    boot = stats.ClusterBoot([S.clusters[i] for i in qidx])
    qcache = {}

    def qual(e):
        if e['rec'] not in qcache:
            _, vids, sc = Q.read_record(e['rec'])
            qcache[e['rec']] = Q.eval_lists_fast(S, qidx, vids, sc)
        return qcache[e['rec']]

    B = pts.get((s, m, 'B'), {})
    by_sys = {}
    for e in B.values():
        by_sys.setdefault(e['point']['system'], []).append(e)
    # every point's bootstrap lower bound at every f in one product (the same resamples as stats.selection)
    allp = sorted(B.values(), key=lambda e: json.dumps(e['point'], sort_keys=True))
    lower = {}
    if allp:
        Qm = np.stack([qual(e)['q'] for e in allp], axis=1)                     # n_dev x P
        for f in FRACTIONS:
            dm = Qm - f * qx[:, None]
            cs = np.stack([np.bincount(boot.cidx, weights=dm[:, j], minlength=boot.C) for j in range(dm.shape[1])], axis=1)
            means = np.empty((boot.B, dm.shape[1]))
            for b0 in range(0, boot.B, 1000):
                means[b0:b0 + 1000] = (boot.counts[b0:b0 + 1000].astype(np.float64) @ cs) / boot.denom[b0:b0 + 1000, None]
            lo = np.percentile(means, 100 * stats.ALPHA, axis=0)
            for j, e in enumerate(allp):
                lower[(id(e), f)] = dict(f=f, mean_d=float(dm[:, j].mean()), lower=float(lo[j]), qualifies=bool(lo[j] >= 0))
    for e in allp[:a.check]:  # the batch bounds equal stats.selection
        for f in FRACTIONS:
            r = stats.selection(boot, qual(e)['q'], qx, f)
            assert abs(r['lower'] - lower[(id(e), f)]['lower']) < 1e-12, (s, m, e['point'], f)
    sel, chosen = {}, {}
    for sysname, es in sorted(by_sys.items()):
        sel[sysname] = {}
        for f in FRACTIONS:
            best = None
            for e in es:
                r = lower[(id(e), f)]
                if r['qualifies'] and (best is None or e['lat_us'] < best[0]['lat_us']):
                    best = (e, r)
            if best:
                e, r = best
                sel[sysname][str(f)] = dict(point=e['point'], latency_us=round(e['lat_us'], 2), mean_d=r['mean_d'], lower=r['lower'],
                                            quality=float(qual(e)['q'].mean()), short=qual(e)['short'], machine=e['machine'])
                chosen[json.dumps(e['point'], sort_keys=True)] = e['point']
            else:
                sel[sysname][str(f)] = None
    A = sorted({json.dumps(e['point'], sort_keys=True) for e in pts.get((s, m, 'A'), {}).values()})
    shortlist.setdefault(s, {})[m] = dict(k_v=kv_of.get((s, m)), points=list(chosen.values()), A=[json.loads(x) for x in A],
                                          selection=sel, q_exact=float(qx.mean()), n_dev=len(qidx))
    # primary comparison (confirmatory sets, f = 0.99): ours against the fastest rival at that point
    at = {k: v['0.99'] for k, v in sel.items() if v.get('0.99')}
    ours = at.get('ours_cascade')
    rivals = sorted(((v['latency_us'], k) for k, v in at.items() if not k.startswith('ours')))
    if s in CONFIRMATORY and ours and rivals:
        rk = rivals[0][1]
        eo = B[json.dumps(at['ours_cascade']['point'], sort_keys=True)]; er = B[json.dumps(at[rk]['point'], sort_keys=True)]
        nho = len({S.clusters[i] for i in Q.split_index(S, 'ho')})
        pw = stats.power(boot, qual(eo)['q'] - qual(er)['q'], nho)
        primary.append(dict(set=s, model=m, rival=rk, ours_us=ours['latency_us'], rival_us=at[rk]['latency_us'], **pw))
    for sysname in sorted(sel):
        cells = ' | '.join(f"{sel[sysname][str(f)]['latency_us']:.1f}" if sel[sysname][str(f)] else 'none' for f in FRACTIONS)
        report.append(f'| {s} | {m} | {sysname} | {cells} |')

# ---- R from the A/A runs: per (set, model) and round, log(median a1 / median a2); R so that the 95%
# half-width of the mean ratio over R rounds is <= target; cap 10, at least 3
lr = []
for (s, m), arms in aa.items():
    if 'a1' in arms and 'a2' in arms:
        lr += [math.log(arms['a1'][r] / arms['a2'][r]) for r in arms['a1'] if r in arms['a2']]
sd = float(np.std(lr, ddof=1)) if len(lr) > 2 else float('nan')
R = 10 if not math.isfinite(sd) else max(3, min(10, math.ceil((1.96 * sd / math.log(1 + a.target)) ** 2)))
meta = dict(type=a.type, machines=[os.path.basename(d) for d in mdirs], fractions=FRACTIONS, aa_log_ratio_sd=sd, aa_pairs=len(lr),
            R=R, R_rule=f'95% half-width of the latency ratio <= {a.target:.0%}, cap 10, min 3', primary=primary)
os.makedirs(a.out, exist_ok=True)
json.dump(dict(meta=meta, **shortlist), open(os.path.join(a.out, f'shortlist-{a.type}.json'), 'w'), indent=1)
with open(os.path.join(a.out, f'selection-{a.type}.md'), 'w') as fh:
    fh.write(f'# Dev selection, {a.type} ({len(mdirs)} machines, {n_rec} timing records)\n\n')
    fh.write(f'R = {R} (A/A log-ratio sd {sd:.4f} over {len(lr)} round pairs)\n\n')
    fh.write('| Set | Model | System | ' + ' | '.join(f'µs at f={f}' for f in FRACTIONS) + ' |\n|---|---|---|' + '---:|' * len(FRACTIONS) + '\n')
    fh.write('\n'.join(report) + '\n\n## Primary comparisons (power at δ, held-out)\n\n')
    for p in primary:
        fh.write(f"- {p['set']}/{p['model']}: ours {p['ours_us']:.1f} µs vs {p['rival']} {p['rival_us']:.1f} µs; "
                 f"power {p['power_sim']:.2f} (analytic {p['power_analytic']:.2f})\n")
print(f'wrote shortlist-{a.type}.json and selection-{a.type}.md: R = {R}, {len(primary)} primary pairs', file=sys.stderr)
