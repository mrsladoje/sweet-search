# Replication dev selection (../REPLICATION_PLAN.md section 4) -> shortlists/shortlist-rep-<type>.json.
#   python rep_select.py --data DATA --results RESULTS --type intel [--machines 'rd-intel-*']
# For every system and f = 0.99: the fastest configuration (median over the 3 dev rounds of the per-round median)
# whose one-sided 97.5% cluster-bootstrap lower bound of mean(Q_sys - 0.99 Q_exact) is >= 0. The rival = the
# non-ours system with the lowest dev latency among those with a qualifying point.
import argparse, collections, fnmatch, glob, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402
import stats  # noqa: E402

F = 0.99
MODEL = 'bge-base-en-v1.5'
ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True); ap.add_argument('--results', required=True); ap.add_argument('--type', required=True)
ap.add_argument('--machines'); ap.add_argument('--out', default=os.path.join(HERE, 'shortlists'))
a = ap.parse_args()
pat = a.machines or f'rd-{a.type}-*'
FIELDS = ('family', 'build_params', 'search', 'S1', 'EF')
recs = collections.defaultdict(list)
for md in glob.glob(os.path.join(a.results, '*')):
    if not fnmatch.fnmatch(os.path.basename(md), pat):
        continue
    for fn in glob.glob(os.path.join(md, '*', '*', '*.json')):
        if fn.endswith('.key.json'):
            continue
        try:
            r = json.load(open(fn))
        except Exception:
            continue
        if not r.get('complete') or r.get('split') != 'dev' or r['key'].get('kind') != 'timing':
            continue
        k = r['key']; pt = {'system': r['system'], **{f: k[f] for f in FIELDS if k.get(f) is not None}}
        recs[(r['set'], json.dumps(pt, sort_keys=True))].append((r['round'], fn, float(np.median(r['timings_ns'])) / 1e3))
bad = [k for k, v in recs.items() if sorted(x[0] for x in v) != [0, 1, 2]]
for k in bad:  # section 4: latency = median of exactly 3 dev rounds; a point without them is not selectable
    print(f'not selectable (rounds {sorted(x[0] for x in recs[k])}): {k}', file=sys.stderr)
    del recs[k]
out = {'meta': {'type': a.type, 'f': F, 'rule': 'REPLICATION_PLAN.md section 4', 'machines': pat}}
for s in sorted({k[0] for k in recs}):
    S = Q.load_set(a.data, s); qidx = Q.split_index(S, 'dev')
    qx = Q.exact_quality(S, a.data, MODEL, 'dev'); boot = stats.ClusterBoot([S.clusters[i] for i in qidx])
    per_sys = collections.defaultdict(list)
    for (s_, pk), rs in recs.items():
        if s_ != s:
            continue
        rs.sort(); pt = json.loads(pk)
        _, v, sc = Q.read_record(rs[0][1])
        q = Q.eval_lists_fast(S, qidx, v, sc)['q']
        sel = stats.selection(boot, q, qx, F)
        per_sys[pt['system']].append(dict(point=pt, latency_us=float(np.median([x[2] for x in rs])), rounds=len(rs),
                                          share=float(q.mean() / qx.mean()), lower=sel['lower'], qualifies=bool(sel['qualifies'])))
    frozen, table = [], {}
    for sysname, pts in sorted(per_sys.items()):
        ok = sorted((p for p in pts if p['qualifies']), key=lambda p: p['latency_us'])
        table[sysname] = dict(n_points=len(pts), qualifying=len(ok), frozen=ok[0] if ok else None)
        if ok:
            frozen.append(ok[0]['point'])
    riv = sorted((v['frozen']['latency_us'], k) for k, v in table.items() if v['frozen'] and not k.startswith('ours'))
    kv = json.load(open(os.path.join(a.data, 'sets', s, 'set.json')))['k_v']
    out[s] = dict(k_v=kv.get(MODEL) if isinstance(kv, dict) else kv, n_dev=len(qidx), q_exact=float(qx.mean()),
                  points=frozen, rival=riv[0][1] if riv else None, selection=table)
    print(f"{s}: {len(frozen)} frozen points; ours {table.get('ours_cascade', {}).get('frozen')}; rival {out[s]['rival']}", file=sys.stderr)
os.makedirs(a.out, exist_ok=True)
json.dump(out, open(os.path.join(a.out, f'shortlist-rep-{a.type}.json'), 'w'), indent=1, sort_keys=True)
