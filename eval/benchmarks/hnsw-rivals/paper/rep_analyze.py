# Replication held-out tests (../REPLICATION_PLAN.md section 5) -> rep-results.json + REP-RESULTS.md.
#   python rep_analyze.py --data DATA --results RESULTS [--types intel,amd,arm]
# Primary latency test per (CPU type, set): per round, d_r = log(median rival / median ours) of the two jobs of that
# round's block (same instance); one-sided paired t-test over the rounds, H0 mean d <= 0. Primary quality test:
# H0 mean(Q_ours - Q_rival) <= -0.005 mean(Q_exact), one-sided cluster bootstrap (10,000, seed 42). Holm over the
# 6 latency tests and, separately, over the 6 quality tests, alpha = 0.025. Descriptive: ratio of medians with a
# bootstrap interval over rounds, meets-f (point / bound), p95/p99, native share, shipped default, faults.
import argparse, collections, glob, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402
import stats  # noqa: E402
from paperlib import ratio_ci  # noqa: E402

F, MODEL, ALPHA, REL = 0.99, 'bge-base-en-v1.5', 0.025, 0.005
ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True); ap.add_argument('--results', required=True); ap.add_argument('--types', default='intel,amd,arm')
ap.add_argument('--out-json', default='rep-results.json'); ap.add_argument('--out-md', default='REP-RESULTS.md')
a = ap.parse_args()
FIELDS = ('family', 'build_params', 'search', 'S1', 'EF')


def t_sf(t, df):
    """One-sided p of Student's t (scipy)."""
    from scipy.stats import t as T
    if df < 1:
        return 1.0
    if not math.isfinite(t):
        return 0.0 if t > 0 else 1.0
    return float(T.sf(t, df))


res = []
for t in a.types.split(','):
    sl = json.load(open(os.path.join(HERE, 'shortlists', f'shortlist-rep-{t}.json')))
    recs = collections.defaultdict(list)
    for md in glob.glob(os.path.join(a.results, f'rh-{t}-*')):
        for fn in glob.glob(os.path.join(md, '*', '*', '*.json')):
            if fn.endswith('.key.json'):
                continue
            try:
                r = json.load(open(fn))
            except Exception:
                continue
            if not r.get('complete') or r.get('split') != 'ho':
                continue
            k = r['key']; pt = {'system': r['system'], **{f: k[f] for f in FIELDS if k.get(f) is not None}}
            r['_machine'] = os.path.basename(md)
            recs[(r['set'], k.get('kind'), json.dumps(pt, sort_keys=True))].append((r['round'], fn, r))
    for s in [x for x in sl if x != 'meta']:
        e = sl[s]; S = Q.load_set(a.data, s); qidx = Q.split_index(S, 'ho')
        qx = Q.exact_quality(S, a.data, MODEL, 'ho'); boot = stats.ClusterBoot([S.clusters[i] for i in qidx])
        o_pt = next((p for p in e['points'] if p['system'] == 'ours_cascade'), None)
        r_pt = next((p for p in e['points'] if p['system'] == e['rival']), None)
        row = dict(type=t, set=s, rival=e['rival'], n_ho=len(qidx), q_exact=float(qx.mean()))
        if not o_pt or not r_pt:
            row['missing'] = 'no frozen point for ours or no rival'; res.append(row); continue
        get = lambda pt, kind='timing': sorted(recs.get((s, kind, json.dumps(pt, sort_keys=True)), []), key=lambda x: x[0])
        O, Rv = get(o_pt), get(r_pt)
        for nm, rr in (('ours', O), ('rival', Rv)):  # one record per round, or the analysis stops
            rs_ = [x[0] for x in rr]
            assert len(rs_) == len(set(rs_)), f'{t}/{s} {nm}: duplicate rounds {rs_}'
        inval = lambda x: bool((x[2].get('fault_rule') or {}).get('invalid'))
        mo = {x[0]: (float(np.median(x[2]['timings_ns'])) / 1e3, x[2]['_machine'], inval(x)) for x in O}
        mr = {x[0]: (float(np.median(x[2]['timings_ns'])) / 1e3, x[2]['_machine'], inval(x)) for x in Rv}
        R_exp = 12  # 6 instances x 2 blocks (section 5)
        rounds = [k for k in range(R_exp) if k in mo and k in mr and mo[k][1] == mr[k][1] and not mo[k][2] and not mr[k][2]]
        dropped = [k for k in range(R_exp) if k not in rounds]  # missing, unpaired (other machine) or invalid by the fault rule
        by_inst = collections.defaultdict(list)  # the unit of the test is the instance: mean log ratio of its blocks
        for k in rounds:
            by_inst[mo[k][1]].append(math.log(mr[k][0] / mo[k][0]))
        d = np.array([float(np.mean(v)) for v in by_inst.values()])
        if len(d) > 1:
            sd = d.std(ddof=1)
            tstat = float(d.mean() / (sd / math.sqrt(len(d)))) if sd > 0 else (math.inf if d.mean() > 0 else -math.inf)
            p_lat = t_sf(tstat, len(d) - 1)
        else:
            tstat, p_lat = float('nan'), 1.0
        r0 = lambda rr: [x for x in rr if x[0] == 0]
        qual = lambda rr: Q.eval_lists_fast(S, qidx, *Q.read_record(r0(rr)[0][1])[1:])['q']
        sha_ok = lambda rr: len({x[2].get('lists_sha256') for x in rr}) == 1
        qo, qr = qual(O), qual(Rv)
        diff = qo - qr; marg = -REL * float(qx.mean())
        m = boot.means(qo - qr + REL * qx)  # joint bootstrap of the margin term (section 5): H0 mean <= 0
        p_q = (int((m <= 0).sum()) + 1) / (boot.B + 1)
        est = float(math.exp(d.mean())) if len(d) else float('nan')  # geometric mean ratio over instances
        if len(d) > 1:  # paired bootstrap over instances (10,000, seed 42)
            bm = d[np.random.default_rng(42).integers(0, len(d), (10000, len(d)))].mean(axis=1)
            lo, hi = (float(math.exp(x)) for x in np.percentile(bm, [2.5, 97.5]))
        else:
            lo = hi = None
        so, sr = stats.selection(boot, qo, qx, F), stats.selection(boot, qr, qx, F)
        pct = lambda rr, q: float(np.median([np.percentile(x[2]['timings_ns'], q) for x in rr])) / 1e3
        flt = lambda rr: [int(x[2]['memory']['after'].get('majflt', 0)) - int(x[2]['memory']['loaded'].get('majflt', 0)) for x in rr]
        nat = get(o_pt, 'native')
        dflt = get({'system': 'ours_cascade', 'S1': 400, 'EF': 400})
        row.update(rounds=len(rounds), instances=len(d), dropped_rounds=dropped, lists_identical=[sha_ok(O), sha_ok(Rv)], mean_log_ratio=float(d.mean()) if len(d) else float('nan'), t=tstat, p_latency=p_lat, ratio=est, lo=lo, hi=hi,
                   ours_us=float(np.median(list(mo.values()))), rival_us=float(np.median(list(mr.values()))),
                   mean_diff=float(diff.mean()), lower=float(np.percentile(m, 100 * ALPHA)) + marg, margin=marg, p_quality=p_q,
                   ours_share=float(qo.mean() / qx.mean()), rival_share=float(qr.mean() / qx.mean()),
                   ours_meets=[bool(so['mean_d'] >= 0), bool(so['qualifies'])], rival_meets=[bool(sr['mean_d'] >= 0), bool(sr['qualifies'])],
                   ours_p99=pct(O, 99), rival_p99=pct(Rv, 99), ours_p95=pct(O, 95), rival_p95=pct(Rv, 95),
                   ours_faults=flt(O), rival_faults=flt(Rv), fault_reruns=sum(1 for x in O + Rv if x[2].get('fault_rule')),
                   native_share=float(np.median([np.sum(x[2]['native_ns']) / np.sum(x[2]['timings_ns']) for x in nat if x[2].get('native_ns')])) if nat else None,
                   default_us=float(np.median([np.median(x[2]['timings_ns']) for x in dflt])) / 1e3 if dflt else None,
                   default_share=float(qual(dflt).mean() / qx.mean()) if dflt else None)
        res.append(row)
ok = [r for r in res if 'missing' not in r]
fam = [(t, s) for t in ('intel', 'amd', 'arm') for s in ('cqadup', 'msmarco1m')]  # the fixed family of 6 (section 5)
byk = {(r['type'], r['set']): r for r in res}
for key, name in (('p_latency', 'holm_latency'), ('p_quality', 'holm_quality')):
    ps = [byk[k].get(key, 1.0) if k in byk else 1.0 for k in fam]  # an unavailable test counts as p = 1
    h = stats.holm(ps, alpha=ALPHA)
    for k, x in zip(fam, h):
        if k in byk:
            byk[k][name] = bool(x)
json.dump(res, open(a.out_json, 'w'), indent=1)
L = ['# Replication: held-out results (pre-registered tests, REPLICATION_PLAN.md)', '',
     '| CPU | Set | Rival | Rounds | Ours µs | Rival µs | rival/ours [95% CI] | mean log ratio | p (latency) | Holm | mean(ours−rival) | lower | margin | p (quality) | Holm | Meets 0.99 ours ; rival |',
     '|---|---|---|---:|---:|---:|---|---:|---:|---|---:|---:|---:|---:|---|---|']
for r in res:
    if 'missing' in r:
        L.append(f"| {r['type']} | {r['set']} | {r['rival']} | {r['missing']} |"); continue
    yn = lambda b: 'yes' if b else 'no'
    L.append(f"| {r['type']} | {r['set']} | {r['rival']} | {r['rounds']} | {r['ours_us']:.1f} | {r['rival_us']:.1f} | {r['ratio']:.2f}"
             + (f" [{r['lo']:.2f}, {r['hi']:.2f}]" if r['lo'] else '') + f" | {r['mean_log_ratio']:+.3f} | {r['p_latency']:.4f} | "
             f"{'pass' if r.get('holm_latency') else 'fail'} | {r['mean_diff']:+.4f} | {r['lower']:+.4f} | {r['margin']:+.4f} | {r['p_quality']:.4f} | "
             f"{'pass' if r.get('holm_quality') else 'fail'} | {yn(r['ours_meets'][0])}/{yn(r['ours_meets'][1])} ; {yn(r['rival_meets'][0])}/{yn(r['rival_meets'][1])} |")
open(a.out_md, 'w').write('\n'.join(L) + '\n')
print(f'{len(ok)} tests -> {a.out_md}', file=sys.stderr)
