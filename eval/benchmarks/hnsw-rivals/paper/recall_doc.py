# Post hoc (descriptive): recall against task quality, two ways the reviews asked for.
#  main   for every distinct operating point of ours and of the dev-chosen rival at f = 0.99 (main study, held-out,
#         round 0): vector recall@10 (as in tails_recall.py) and DOCUMENT recall@10 = |top-10 documents of the system
#         after the shared mapping ∩ exact top-10 documents| / 10, with the retained share.
#  rep    the replication sets (one vector per document, BEIR labels, no earlier tuning): every dev configuration of
#         every system (round 0 lists): recall@10 against the exact top 10, retained share, and whether it meets
#         f = 0.99 by the selection bound; and the held-out frozen points of ours and the rival.
#   python recall_doc.py --data DATA --main RESULTS_MAIN --json results-paper.json --dev REP_DEV --ho REP_HO [--out recall-doc.json]
import argparse, collections, glob, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import quality as Q  # noqa: E402
import stats  # noqa: E402
from paperlib import headline  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True); ap.add_argument('--main', required=True); ap.add_argument('--json', required=True)
ap.add_argument('--dev', required=True); ap.add_argument('--ho', required=True); ap.add_argument('--out', default=os.path.join(HERE, 'recall-doc.json'))
a = ap.parse_args()
FIELDS = ('family', 'build_params', 'search', 'gen', 'C', 'H', 'ef', 'S1', 'EF')
SETS = {}


def setq(s, m, split):
    k = (s, m, split)
    if k not in SETS:
        S = Q.load_set(a.data, s); qidx = Q.split_index(S, split); gt = Q.read_gt(a.data, m, s, split)
        SETS[k] = (S, qidx, gt, Q.exact_quality(S, a.data, m, split), stats.ClusterBoot([S.clusters[i] for i in qidx]))
    return SETS[k]


def recalls(S, qidx, gt, v, sc):
    rv, rd = [], []
    for i, qi in enumerate(qidx):
        rv.append(Q.recall_vec(S, qi, v[i], gt['vecs'][i]))
        docs = Q.to_docs(S, v[i], sc[i], qi)[0]
        ex = [int(d) for d in gt['docs'][i][:Q.CUT] if d >= 0]
        rd.append(len(set(docs) & set(ex)) / Q.CUT)
    return float(np.mean(rv)), float(np.mean(rd))


out = {'main': [], 'rep_dev': [], 'rep_ho': []}
# ---- main study
J = json.load(open(a.json)); B = collections.defaultdict(dict)
for r in J['B']:
    B[(r['type'], r['set'], r['model'], r['f'])][r['system']] = r
want = {}
for (t, s, m, f), d in B.items():
    if f == 0.99 and not (t == 'box' and s == 'csn1m'):
        h = headline(d, t, s, m, f)
        if h:
            for role, row in (('ours', h[0]), ('rival', h[2])):
                p = row['point']; want[(s, m, json.dumps({'system': p['system'], **{k: p[k] for k in FIELDS if p.get(k) is not None}}, sort_keys=True))] = (role, row['share'])
done = set()
for md in glob.glob(os.path.join(a.main, '*')):
    for fn in glob.glob(os.path.join(md, '*', '*', '*.json')):
        if fn.endswith('.key.json'):
            continue
        try:
            r = json.load(open(fn))
        except Exception:
            continue
        if not isinstance(r, dict) or not r.get('complete') or r.get('split') != 'ho' or r.get('comparison') != 'B' or r['key'].get('kind') != 'timing' or r.get('round') != 0:
            continue
        d = dict(r.get('params') or {}); d.update(r['key'])
        k = (r['set'], r['model'], json.dumps({'system': r['system'], **{f: d[f] for f in FIELDS if d.get(f) is not None}}, sort_keys=True))
        if k not in want or k in done:
            continue
        done.add(k); S, qidx, gt, qx, _ = setq(r['set'], r['model'], 'ho')
        _, v, sc = Q.read_record(fn); rv, rd = recalls(S, qidx, gt, v, sc)
        out['main'].append(dict(set=r['set'], model=r['model'], role=want[k][0], point=json.loads(k[2]), share=want[k][1], recall_vec=rv, recall_doc=rd))
print(f"main: {len(out['main'])} distinct points of {len(want)}", file=sys.stderr)
# ---- replication dev (every configuration) and held-out (frozen points)
for split, root, pat in (('dev', a.dev, 'hd-*'), ('ho', a.ho, 'hh-*-i0')):
    seen = set()
    for md in glob.glob(os.path.join(root, pat)):
        for fn in glob.glob(os.path.join(md, '*', '*', '*.json')):
            if fn.endswith('.key.json'):
                continue
            try:
                r = json.load(open(fn))
            except Exception:
                continue
            if not isinstance(r, dict) or not r.get('complete') or r.get('split') != split or r['key'].get('kind') != 'timing' or r.get('round') != 0:
                continue
            k = r['key']; pt = json.dumps({'system': r['system'], **{f: k[f] for f in ('family', 'build_params', 'search', 'S1', 'EF') if k.get(f) is not None}}, sort_keys=True)
            if (r['set'], pt) in seen or not os.path.exists(fn[:-5] + '.lists.bin'):
                continue
            seen.add((r['set'], pt)); S, qidx, gt, qx, boot = setq(r['set'], 'bge-base-en-v1.5', split)
            _, v, sc = Q.read_record(fn); q = Q.eval_lists_fast(S, qidx, v, sc)['q']
            rv, rd = recalls(S, qidx, gt, v, sc)
            out['rep_' + split].append(dict(set=r['set'], point=json.loads(pt), share=float(q.mean() / qx.mean()),
                                            meets=bool(stats.selection(boot, q, qx, 0.99)['qualifies']), recall_vec=rv, recall_doc=rd))
    print(f"rep {split}: {len(out['rep_' + split])} configurations", file=sys.stderr)
json.dump(out, open(a.out, 'w'), indent=1)
m = out['main']
print('main ours: doc recall < 0.9:', sum(1 for x in m if x['role'] == 'ours' and x['recall_doc'] < 0.9), 'of', sum(1 for x in m if x['role'] == 'ours'),
      'min doc', min(x['recall_doc'] for x in m if x['role'] == 'ours'), file=sys.stderr)
for s in ('cqadup', 'msmarco1m'):
    d = [x for x in out['rep_dev'] if x['set'] == s and x['meets']]
    print(s, 'dev configs meeting 0.99:', len(d), 'with recall@10 < 0.9:', sum(1 for x in d if x['recall_vec'] < 0.9), 'min', min(x['recall_vec'] for x in d) if d else None, file=sys.stderr)
