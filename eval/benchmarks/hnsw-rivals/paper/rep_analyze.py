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
    """Survival function of Student's t (one-sided p), by numeric integration of the density (no scipy needed)."""
    if not math.isfinite(t):
        return 0.0 if t > 0 else 1.0
    xs = np.linspace(t, t + 200, 400001)
    c = math.gamma((df + 1) / 2) / (math.sqrt(df * math.pi) * math.gamma(df / 2))
    return float(np.trapz(c * (1 + xs ** 2 / df) ** (-(df + 1) / 2), xs))


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
        med = lambda rr: {x[0]: float(np.median(x[2]['timings_ns'])) / 1e3 for x in rr}
        mo, mr = med(O), med(Rv)
        rounds = sorted(set(mo) & set(mr))
        d = np.array([math.log(mr[k] / mo[k]) for k in rounds])
        tstat = float(d.mean() / (d.std(ddof=1) / math.sqrt(len(d)))) if len(d) > 1 and d.std(ddof=1) > 0 else float('inf') * np.sign(d.mean())
        p_lat = t_sf(tstat, len(d) - 1) if len(d) > 1 else 1.0
        qual = lambda rr: Q.eval_lists_fast(S, qidx, *Q.read_record(rr[0][1])[1:])['q']
        qo, qr = qual(O), qual(Rv)
        diff = qo - qr; m = boot.means(diff); marg = -REL * float(qx.mean())
        p_q = (int((m <= marg).sum()) + 1) / (boot.B + 1)
        est, lo, hi = ratio_ci([mo[k] for k in sorted(mo)], [mr[k] for k in sorted(mr)])
        so, sr = stats.selection(boot, qo, qx, F), stats.selection(boot, qr, qx, F)
        pct = lambda rr, q: float(np.median([np.percentile(x[2]['timings_ns'], q) for x in rr])) / 1e3
        flt = lambda rr: [int(x[2]['memory']['after'].get('majflt', 0)) - int(x[2]['memory']['loaded'].get('majflt', 0)) for x in rr]
        nat = get(o_pt, 'native')
        dflt = get({'system': 'ours_cascade', 'S1': 400, 'EF': 400})
        row.update(rounds=len(rounds), mean_log_ratio=float(d.mean()), t=tstat, p_latency=p_lat, ratio=est, lo=lo, hi=hi,
                   ours_us=float(np.median(list(mo.values()))), rival_us=float(np.median(list(mr.values()))),
                   mean_diff=float(diff.mean()), lower=float(np.percentile(m, 100 * ALPHA)), margin=marg, p_quality=p_q,
                   ours_share=float(qo.mean() / qx.mean()), rival_share=float(qr.mean() / qx.mean()),
                   ours_meets=[bool(so['mean_d'] >= 0), bool(so['qualifies'])], rival_meets=[bool(sr['mean_d'] >= 0), bool(sr['qualifies'])],
                   ours_p99=pct(O, 99), rival_p99=pct(Rv, 99), ours_p95=pct(O, 95), rival_p95=pct(Rv, 95),
                   ours_faults=flt(O), rival_faults=flt(Rv), fault_reruns=sum(1 for x in O + Rv if x[2].get('fault_rule')),
                   native_share=float(np.median([np.sum(x[2]['native_ns']) / np.sum(x[2]['timings_ns']) for x in nat if x[2].get('native_ns')])) if nat else None,
                   default_us=float(np.median([np.median(x[2]['timings_ns']) for x in dflt])) / 1e3 if dflt else None,
                   default_share=float(qual(dflt).mean() / qx.mean()) if dflt else None)
        res.append(row)
ok = [r for r in res if 'missing' not in r]
for key, name in (('p_latency', 'holm_latency'), ('p_quality', 'holm_quality')):
    h = stats.holm([r[key] for r in ok], alpha=ALPHA) if ok else []
    for r, x in zip(ok, h):
        r[name] = bool(x)
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
