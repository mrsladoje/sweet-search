# venv/bin/python -I paper/analysis/budget.py
#
# Post-freeze analysis code (not frozen). Quality per latency budget (W8) across machines.
#
# Why not quality.py's "latency" block: quality.py:read_results keys an implementation by
# the "arm" field inside the result file, and that field drops the thread budget and the
# library variant (ours@t1 and ours both say "ours"; numpy_packed+blis says
# "numpy_packed"). Its latency points therefore pool several configurations. Its scores
# are unaffected for the kernel (every ours file of a set is bit-identical; checked in
# RESULTS-paper.md). Here each arm is the result FILE name, as in summarize.py:
#   time   per-request p50 / p95 over every timed repetition of every call of the set
#          (load.py cache, ho-warm), the timed scoring call only
#   nDCG   from that arm's own recorded scores (its r0.p0 file), quality.py's metric code
# Per p95 budget: the largest k (10 ... 200) whose per-request p95 fits, and nDCG@10 there.
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PLATFORMS, SHORT, OUT, dump, frozen_rivals, LIB_NAME, available, cache  # noqa: E402
from common import BENCH  # noqa: E402
sys.path.insert(0, BENCH)
import quality as Q  # noqa: E402
import numpy as np  # noqa: E402
import glob  # noqa: E402

PREP = os.path.expanduser('~/.ss-eval/maxsim-beir-prep')
QIN = os.path.expanduser('~/.ss-eval/maxsim-quality-in')
BUDGETS_MS = (0.1, 0.25, 0.5, 1.0, 2.0)
KS = (10, 25, 50, 100, 200)


def arm_ndcg(platform, s, arm, P, ds, mk, k):
    fs = glob.glob(os.path.join(QIN, platform, '*', 'ho-warm', s, f'{arm}.r0.p0.json'))
    if not fs:
        return None
    d = json.load(open(fs[0]))
    pv = Q.read_provenance(PREP, ds, mk, k)
    byq = {pv[c['file']]: np.asarray(c['scores'], np.float64) for c in d['calls']}
    if set(byq) != set(P['qids']):
        return None
    return float(Q.per_query(P['qids'], P['bm25'], P['rel'], k, byq)[0].mean())


def main():
    res = {}
    for p in PLATFORMS:
        if not available(p):
            continue
        w = cache(p, 'ho-warm')
        impls = [('ours', 'sweet kernel')] + [(arm, f"{LIB_NAME.get(lib, lib)}, {it}") for lib, it, arm in frozen_rivals(p, 'beir')]
        res[p] = {}
        for ds in ('scifact', 'nfcorpus'):
            for mk in ('colbertv2', 'answersmall'):
                P = Q.read_prep(PREP, ds, mk)
                cell = res[p].setdefault(f'{ds}|{mk}', {'curves': {}, 'budget': {}})
                for arm, lab in impls:
                    pts = []
                    for k in KS:
                        s = f'beir-{ds}-{mk}-k{k}'
                        a = w.get(s, {}).get('arms', {}).get(arm)
                        if not a:
                            continue
                        pts.append(dict(k=k, p50_ms=a['req'][0], p95_ms=a['req'][1], p99_ms=a['req'][2], n_timed=a['n_timed'],
                                        ndcg10=arm_ndcg(p, s, arm, P, ds, mk, k)))
                    if pts:
                        cell['curves'][arm] = dict(label=lab, points=pts)
                for X in BUDGETS_MS:
                    row = {}
                    for arm, c in cell['curves'].items():
                        ok = [pt for pt in c['points'] if pt['p95_ms'] <= X and pt['ndcg10'] is not None]
                        b = max(ok, key=lambda pt: pt['k']) if ok else None
                        row[arm] = None if not b else dict(k=b['k'], ndcg10=b['ndcg10'])
                    cell['budget'][str(X)] = row
    dump('budget.json', res)
    L = ['# Quality per latency budget (BEIR, fresh held-out)', '',
         'Per-request p95 of the timed scoring call (every timed repetition of every call pooled; the rivals\' decode and cast are outside '
         'their timer, the int4-self rows decode inside it). Entry: largest k whose p95 fits the budget, and nDCG@10 at that k from the '
         'arm\'s own scores. — = not even k = 10 fits.', '']
    for p, cells in res.items():
        for cell, d in sorted(cells.items()):
            impls = sorted(d['curves'], key=lambda i: (i != 'ours', i))
            L += [f'## {SHORT[p]} — {cell}', '', '| p95 budget ms | ' + ' | '.join(d['curves'][i]['label'] for i in impls) + ' |',
                  '|--:|' + '--:|' * len(impls)]
            for X, row in d['budget'].items():
                L.append(f'| {X} | ' + ' | '.join('—' if row.get(i) is None else f"k={row[i]['k']} ({row[i]['ndcg10']:.3f})" for i in impls) + ' |')
            L += ['', '| k | ' + ' | '.join(f"{d['curves'][i]['label']} p50 / p95 ms (nDCG@10)" for i in impls) + ' |', '|--:|' + '--:|' * len(impls)]
            for k in KS:
                cells_ = []
                for i in impls:
                    pt = next((x for x in d['curves'][i]['points'] if x['k'] == k), None)
                    cells_.append('' if not pt else f"{pt['p50_ms']:.3f} / {pt['p95_ms']:.3f} ({pt['ndcg10']:.3f})" if pt['ndcg10'] is not None else
                                  f"{pt['p50_ms']:.3f} / {pt['p95_ms']:.3f}")
                L.append(f'| {k} | ' + ' | '.join(cells_) + ' |')
            L.append('')
    open(os.path.join(OUT, 'budget.md'), 'w').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
