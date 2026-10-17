# venv/bin/python -I paper/analysis/rival_scores_check.py
#
# Post-freeze analysis code (not frozen). The quality-per-budget points take an arm's scores
# from its r0.p0 file. Here every rival's BEIR scores are compared across all its run files
# (rounds x processes) on each CPU: share of bit-equal scores, largest absolute difference,
# and the share of calls whose candidate order changes. Aggregates only.
import glob, json, os, sys, collections

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dump  # noqa: E402

QIN = os.path.expanduser('~/.ss-eval/maxsim-quality-in')


def main():
    res = {}
    for plat in ('intel', 'amd', 'arm', 'm3max', 'epyc'):
        acc = collections.defaultdict(lambda: dict(files=0, scores=0, equal=0, maxabs=0.0, calls=0, reordered=0))
        for d in glob.glob(os.path.join(QIN, plat, '*', 'ho-warm', 'beir-*')):
            for f0 in glob.glob(os.path.join(d, '*.r0.p0.json')):
                arm = os.path.basename(f0)[:-len('.r0.p0.json')]
                base = {c['file']: np.asarray(c['scores'], np.float64) for c in json.load(open(f0))['calls']}
                for f in glob.glob(os.path.join(d, f'{glob.escape(arm)}.r*.p*.json')):
                    if f == f0:
                        continue
                    a = acc[arm]; a['files'] += 1
                    for c in json.load(open(f))['calls']:
                        x, y = np.asarray(c['scores'], np.float64), base[c['file']]
                        ok = np.isfinite(x) & np.isfinite(y)
                        a['scores'] += x.size; a['equal'] += int(np.sum((x == y) | (~np.isfinite(x) & ~np.isfinite(y))))
                        if ok.any():
                            a['maxabs'] = max(a['maxabs'], float(np.max(np.abs(x[ok] - y[ok]))))
                        a['calls'] += 1; a['reordered'] += int(not np.array_equal(np.argsort(-x, kind='stable'), np.argsort(-y, kind='stable')))
        res[plat] = {k: dict(v, bit_equal_share=v['equal'] / max(v['scores'], 1), reordered_share=v['reordered'] / max(v['calls'], 1)) for k, v in acc.items()}
        bad = {k: v for k, v in res[plat].items() if v['bit_equal_share'] < 1}
        print(plat, len(res[plat]), 'arms;', 'all bit-equal' if not bad else {k: (round(v['bit_equal_share'], 4), f"{v['maxabs']:.1e}", round(v['reordered_share'], 4)) for k, v in bad.items()})
    dump('rival_scores_check.json', res)


if __name__ == '__main__':
    main()
