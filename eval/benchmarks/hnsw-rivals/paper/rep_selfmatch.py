# Post hoc sensitivity (descriptive): the replication with the self-match rule OFF for MS MARCO 1M.
# The plan's rule (meant for Quora) removed, for 814 of 6,980 MS MARCO queries, the passage whose id equals the query id,
# from every system's list and from exact search. Here the rule is off: system lists are evaluated as returned, and the
# exact ranking gets the removed passage back at its exact float64 cosine. Then, unchanged:
#   1. rep_select.py on dev (into a temporary folder)  -> did any frozen point or dev rival change?
#   2. rep_analyze.py on held-out with the frozen points -> did any quality result change?
#   3. how many held-out top-10 document lists of the frozen points change.
#   python rep_selfmatch.py --data DATA --dev RESULTS_DEV --ho RESULTS_HO [--out rep-selfmatch.json]
import argparse, collections, glob, json, os, runpy, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402

ap = argparse.ArgumentParser(); ap.add_argument('--data', required=True); ap.add_argument('--dev', required=True); ap.add_argument('--ho', required=True)
ap.add_argument('--out', default=os.path.join(HERE, 'rep-selfmatch.json'))
a = ap.parse_args()
SET, MODEL = 'msmarco1m', 'bge-base-en-v1.5'
_load, _exact = Q.load_set, Q.exact_quality
S0 = _load(a.data, SET)
X = np.fromfile(f'{a.data}/emb/{MODEL}/{SET}/corpus.f32', dtype='<f4').reshape(-1, 768)
QV = np.fromfile(f'{a.data}/emb/{MODEL}/{SET}/queries.f32', dtype='<f4').reshape(-1, 768)
vec_of_doc = {int(d): v for v, d in enumerate(S0.doc_of_vec)}  # one vector per passage


def load_off(data, name):
    S = _load(data, name)
    if name == SET:
        S.self_doc = [-1] * S.n_queries
    return S


def exact_off(S, data, model, split, metric=None):
    if S.name != SET:
        return _exact(S, data, model, split, metric)
    gt = Q.read_gt(data, model, S.name, split); qidx = Q.split_index(S, split); fn = Q.METRICS[metric or Q.default_metric(S)]
    out = []
    for i, qi in enumerate(qidx):
        docs = [(float(s), int(d)) for d, s in zip(gt['docs'][i], gt['docs_scores'][i]) if d >= 0]
        sd = S0.self_doc[qi]
        if sd >= 0:  # put the removed passage back at its exact score
            v = vec_of_doc[sd]; x = X[v].astype(np.float64); q = QV[qi].astype(np.float64)
            docs.append((float(x @ q / (np.linalg.norm(x) * np.linalg.norm(q))), sd))
        docs.sort(key=lambda t: (-t[0], t[1]))
        out.append(fn(S, qi, [d for _, d in docs[:Q.CUT]]))
    return np.array(out)


Q.load_set, Q.exact_quality = load_off, exact_off
res = {'n_selfmatch_queries': int(sum(1 for d in S0.self_doc if d >= 0))}
tmp = tempfile.mkdtemp()
# 1. dev selection
changed = []
for t in ('intel', 'amd', 'arm'):
    sys.argv = ['rep_select.py', '--data', a.data, '--results', a.dev, '--type', t, '--out', tmp]
    runpy.run_path(os.path.join(HERE, 'rep_select.py'), run_name='__main__')
    new = json.load(open(os.path.join(tmp, f'shortlist-rep-{t}.json')))[SET]
    old = json.load(open(os.path.join(HERE, 'shortlists', f'shortlist-rep-{t}.json')))[SET]
    key = lambda pts: sorted(json.dumps(p, sort_keys=True) for p in pts)
    changed.append(dict(type=t, rival_old=old['rival'], rival_new=new['rival'], points_same=key(old['points']) == key(new['points'])))
res['dev_selection'] = changed
# 2. held-out tests with the frozen points
sys.argv = ['rep_analyze.py', '--data', a.data, '--results', a.ho, '--out-json', os.path.join(tmp, 'r.json'), '--out-md', os.path.join(tmp, 'r.md')]
runpy.run_path(os.path.join(HERE, 'rep_analyze.py'), run_name='__main__')
new = {(r['type'], r['set']): r for r in json.load(open(os.path.join(tmp, 'r.json')))}
old = {(r['type'], r['set']): r for r in json.load(open(os.path.join(HERE, 'rep-results.json')))}
res['heldout'] = [dict(type=t, q_exact=[old[(t, SET)]['q_exact'], new[(t, SET)]['q_exact']], mean_diff=[old[(t, SET)]['mean_diff'], new[(t, SET)]['mean_diff']],
                       p_quality=[old[(t, SET)]['p_quality'], new[(t, SET)]['p_quality']], holm_quality=[old[(t, SET)]['holm_quality'], new[(t, SET)]['holm_quality']],
                       ours_share=[old[(t, SET)]['ours_share'], new[(t, SET)]['ours_share']], rival_share=[old[(t, SET)]['rival_share'], new[(t, SET)]['rival_share']])
                  for t in ('intel', 'amd', 'arm')]
res['holm_quality_all_same'] = all(old[k].get('holm_quality') == new[k].get('holm_quality') for k in old)
# 3. top-10 lists that change, per frozen point (held-out, round 0)
qidx = Q.split_index(S0, 'ho'); Soff = load_off(a.data, SET); ch = []
for t in ('intel', 'amd', 'arm'):
    sl = json.load(open(os.path.join(HERE, 'shortlists', f'shortlist-rep-{t}.json')))[SET]
    for p in sl['points']:
        if p['system'] not in ('ours_cascade', sl['rival']):
            continue
        for fn in glob.glob(os.path.join(a.ho, f'hh-{t}-i0', SET, MODEL, '*.json')):
            if fn.endswith('.key.json'):
                continue
            r = json.load(open(fn))
            k = r.get('key', {}); pt = {'system': r['system'], **{f: k[f] for f in ('family', 'build_params', 'search', 'S1', 'EF') if k.get(f) is not None}}
            if r.get('round') != 0 or k.get('kind') != 'timing' or pt != p:
                continue
            _, v, sc = Q.read_record(fn)
            n = sum(1 for i, qi in enumerate(qidx) if Q.to_docs(S0, v[i], sc[i], qi)[0] != Q.to_docs(Soff, v[i], sc[i], qi)[0])
            ch.append(dict(type=t, system=p['system'], changed_top10=n, n=len(qidx)))
res['top10_changed'] = ch
json.dump(res, open(a.out, 'w'), indent=1)
print(json.dumps(res, indent=1), file=sys.stderr)
