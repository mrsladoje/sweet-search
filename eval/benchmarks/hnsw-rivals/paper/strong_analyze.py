# Post hoc (descriptive): the strong-<type> runs (make_posthoc_plans.py). Per CPU type and set:
#  (A) every generator with the shared path's SIMD kernels: total, generator and shared-stage time (median over rounds of
#      the per-round median, us), retained share, for H 100 (int8 screen) and H 400 with no int8 stage; FAISS and our
#      distance counts per query
#  (B) the refining dev rival with float32 and float16 refine (time and retained share), ours (preloaded)
#  perf (dev, MS MARCO): counters per query = (full run - one-query run) / (queries - 1); top symbols of perf record
#   python strong_analyze.py --data DATA --results RESULTS [--out strong.json]
import argparse, collections, csv, glob, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402

ap = argparse.ArgumentParser(); ap.add_argument('--data', required=True); ap.add_argument('--results', required=True)
ap.add_argument('--out', default=os.path.join(HERE, 'strong.json'))
a = ap.parse_args()
MODEL = 'bge-base-en-v1.5'; SQ = {}


def share(s, split, fn):
    if (s, split) not in SQ:
        S = Q.load_set(a.data, s); qi = Q.split_index(S, split); SQ[(s, split)] = (S, qi, Q.exact_quality(S, a.data, MODEL, split))
    S, qi, qx = SQ[(s, split)]
    rec, v, sc = Q.read_record(fn)
    if rec['n_queries'] != len(qi):
        return None
    return float(Q.eval_lists_fast(S, qi, v, sc)['q'].mean() / qx.mean())


def perf_csv(p):
    out = {}
    for row in csv.reader(open(p)):
        if len(row) > 2 and row[0] and row[0][0].isdigit():
            try:
                out[row[2]] = float(row[0])
            except ValueError:
                pass
    return out


res = {}
for t in ('intel', 'amd', 'arm'):
    G = collections.defaultdict(list); P = {}
    for fn in glob.glob(os.path.join(a.results, f'hs-{t}', '*', '*', '*.json')):
        if fn.endswith('.key.json'):
            continue
        try:
            r = json.load(open(fn))
        except Exception:
            continue
        if not isinstance(r, dict) or not r.get('complete'):
            continue
        k = r['key']; o = k.get('options') or {}; env = o.get('env') or {}
        arm = ('bypass' if env.get('SS_FIX_NO_INT8') == '1' else 'screen') if r['comparison'] == 'A' else ('f16' if env.get('SS_FIX_REFINE_F16') == '1' else 'f32')
        if o.get('perf'):
            name = r['system'] + ('-fixed' if env.get('SS_FIX_HNSW_ADAPTIVE') == '0' else '')
            P.setdefault(name, {})[(o['perf'], o.get('limit'))] = (fn, r)
            continue
        G[(r['set'], r['comparison'], r['system'], arm)].append((r['round'], fn, r))
    rows = []
    for (s, comp, sysn, arm), rs in sorted(G.items()):
        rs.sort(key=lambda x: x[0]); st = [x[2].get('stage_ns') or {} for x in rs]
        med = lambda key: float(np.median([np.median(x[key]) for x in st if key in x])) / 1e3 if any(key in x for x in st) else None
        shared = med('rest') if any('rest' in x for x in st) else (None if med('screen') is None else med('screen') + med('rescore'))
        row = dict(set=s, comparison=comp, system=sysn, arm=arm, rounds=len(rs), us=float(np.median([np.median(x[2]['timings_ns']) for x in rs])) / 1e3,
                   gen=med('gen'), shared=shared, share=share(s, 'ho', rs[0][1]),
                   ndis=(rs[0][2].get('ndis_per_query') if sysn.startswith('ours') else ((rs[0][2].get('hnsw_stats') or {}).get('ndis', 0) / rs[0][2]['n_queries'] or None)),
                   faults=sum(1 for x in rs if x[2].get('fault_rule')))
        rows.append(row)
    perf = {}
    for name, d in P.items():
        full, one = d.get(('stat', None)), d.get(('stat', 1))
        e = {}
        if full and one and os.path.exists(full[0] + '.perf.csv') and os.path.exists(one[0] + '.perf.csv'):
            cf, co = perf_csv(full[0] + '.perf.csv'), perf_csv(one[0] + '.perf.csv'); nq = full[1]['n_queries'] - 1
            e['per_query'] = {k: (cf[k] - co.get(k, 0)) / nq for k in cf}
            e['ndis'] = full[1].get('ndis_per_query') or ((full[1].get('hnsw_stats') or {}).get('ndis', 0) / full[1]['n_queries'])
        rec = d.get(('record', None))
        if rec and os.path.exists(rec[0] + '.perf.txt'):
            e['top'] = [l.strip() for l in open(rec[0] + '.perf.txt') if l.strip() and not l.startswith('#')][:15]
        perf[name] = e
    res[t] = dict(rows=rows, perf=perf)
    for r in rows:
        print(t, r['set'], r['comparison'], r['system'], r['arm'], r['rounds'], f"{r['us']:.0f}", r['gen'] and f"{r['gen']:.0f}", r['shared'] and f"{r['shared']:.0f}",
              r['share'] and f"{r['share']:.4f}", r['ndis'] and f"{r['ndis']:.0f}", file=sys.stderr)
json.dump(res, open(a.out, 'w'), indent=1)
