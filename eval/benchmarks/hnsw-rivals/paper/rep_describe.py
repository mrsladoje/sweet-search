# Replication: descriptive additions, written after the held-out run (NOT part of the pre-registered tests;
# rep_analyze.py stays the frozen analysis). Per (CPU type, set):
#   - absolute quality (mean nDCG@10) of exact search, ours and the rival on held-out;
#   - retained share mean(Q_sys) / mean(Q_exact) and a one-sided 97.5% lower bound on the share scale:
#     0.99 + lower(mean(Q_sys - 0.99 Q_exact)) / mean(Q_exact), the bound of the selection rule (>= 0.99 iff it meets f);
#   - the latency statistic with the dropped (fault-invalid) blocks put back in (sensitivity);
#   - the frozen configurations and whether a rival's effort sits at the bottom of the shared grid.
#   python rep_describe.py --data DATA --results RESULTS [--out rep-describe.json]
import argparse, collections, glob, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402
import stats  # noqa: E402

MODEL, ALPHA = 'bge-base-en-v1.5', 0.025
GRID_MIN = 50  # lowest value of the shared 11-value effort grid (REPLICATION_PLAN.md section 2)
ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True); ap.add_argument('--results', required=True)
ap.add_argument('--out', default=os.path.join(HERE, 'rep-describe.json'))
a = ap.parse_args()
FIELDS = ('family', 'build_params', 'search', 'S1', 'EF')
out = []
for t in ('intel', 'amd', 'arm'):
    sl = json.load(open(os.path.join(HERE, 'shortlists', f'shortlist-rep-{t}.json')))
    recs = collections.defaultdict(list)
    for md in glob.glob(os.path.join(a.results, f'hh-{t}-*')):
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
        bx = boot.means(qx)
        o_pt = next(p for p in e['points'] if p['system'] == 'ours_cascade')
        r_pt = next(p for p in e['points'] if p['system'] == e['rival'])
        get = lambda pt: sorted(recs.get((s, 'timing', json.dumps(pt, sort_keys=True)), []), key=lambda x: x[0])
        O, Rv = get(o_pt), get(r_pt)
        qual = lambda rr: Q.eval_lists_fast(S, qidx, *Q.read_record([x for x in rr if x[0] == 0][0][1])[1:])['q']
        row = dict(type=t, set=s, rival=e['rival'], ours_point=o_pt, rival_point=r_pt, q_exact=float(qx.mean()))
        for nm, rr in (('ours', O), ('rival', Rv)):
            q = qual(rr)
            row[f'q_{nm}'] = float(q.mean()); row[f'share_{nm}'] = float(q.mean() / qx.mean())
            row[f'share_{nm}_lower'] = 0.99 + float(np.percentile(boot.means(q - 0.99 * qx), 100 * ALPHA)) / float(qx.mean())  # the selection rule's bound, on the share scale
        eff = (r_pt.get('search') or {})
        knob = next((eff[k] for k in ('ef', 'window', 'L') if k in eff), None)
        row['rival_effort'] = knob; row['rival_at_grid_min'] = knob == GRID_MIN
        # sensitivity: every block with both jobs on one instance, fault-invalid ones included
        last = lambda rr: {x[0]: x for x in rr}  # the record kept for a round (the rerun if there was one)
        mo, mr = last(O), last(Rv)
        inval = lambda x: bool((x[2].get('fault_rule') or {}).get('invalid'))
        by_inst = collections.defaultdict(list); dropped = []
        for k in sorted(set(mo) & set(mr)):
            if mo[k][2]['_machine'] != mr[k][2]['_machine']:
                continue
            if inval(mo[k]) or inval(mr[k]):
                dropped.append(dict(round=k, machine=mo[k][2]['_machine'], invalid=[nm for nm, x in (('ours', mo[k]), ('rival', mr[k])) if inval(x)],
                                    faults={nm: (x[2].get('fault_rule') or {}) for nm, x in (('ours', mo[k]), ('rival', mr[k]))}))
            by_inst[mo[k][2]['_machine']].append(math.log(np.median(mr[k][2]['timings_ns']) / np.median(mo[k][2]['timings_ns'])))
        d = np.array([np.mean(v) for v in by_inst.values()])
        tt = float(d.mean() / (d.std(ddof=1) / math.sqrt(len(d))))
        from scipy.stats import t as T
        row.update(sens_all_blocks=dict(instances=len(d), ratio=float(math.exp(d.mean())), t=tt, p=float(T.sf(tt, len(d) - 1))), dropped_detail=dropped)
        out.append(row)
        print(t, s, f"exact {row['q_exact']:.4f} ours {row['q_ours']:.4f} ({row['share_ours']:.4f} >= {row['share_ours_lower']:.4f}) "
              f"rival {row['q_rival']:.4f} ({row['share_rival']:.4f} >= {row['share_rival_lower']:.4f}) grid-min {row['rival_at_grid_min']} "
              f"sens {row['sens_all_blocks']['ratio']:.3f} p {row['sens_all_blocks']['p']:.2e} dropped {dropped}", file=sys.stderr)
json.dump(out, open(a.out, 'w'), indent=1)
