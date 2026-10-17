# venv/bin/python -I paper/analysis/rerun_beir.py          (after load.py intel-r2 amd-r2 arm-r2)
#
# Post-freeze analysis code (not frozen). BEIR on a second instance per cloud type (plan in
# rerun-plan.md, written before the run). Per type and set group (k = 100, k = 25): the warm
# ratio of every frozen configuration and of the per-library row (the faster frozen
# configuration) on the original instance and on the rerun instance, the relative difference
# (median, maximum) and every ratio that changes sides of 1. Then, per arm, the share of
# scores that are bit-equal to the original run (the kernel is expected at 100 %).
# Aggregates only.
import glob, json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import cache, available, dump  # noqa: E402
from tables import workload_rows, FIXED  # noqa: E402

QIN = os.path.expanduser('~/.ss-eval/maxsim-quality-in')
R2 = os.path.expanduser('~/.ss-eval/maxsim-cloud/r2')


def compare(rows0, rows1):
    one = {r['label']: r for r in rows1}
    rows, cfgs = [], []
    for r0 in rows0:
        r1 = one.get(r0['label'])
        if not r1 or 'ratio' not in r0 or 'ratio' not in r1:
            continue
        rows.append(dict(label=r0['label'], arm0=r0['arm'], arm1=r1['arm'], first=r0['ratio'], rerun=r1['ratio'],
                         rerun_lo=r1['lo'], rerun_hi=r1['hi'], rel_diff=r1['ratio'] / r0['ratio'] - 1,
                         side_change=(r0['ratio'] < 1) != (r1['ratio'] < 1),
                         faster_rule=[r0.get('rival_faster'), r1.get('rival_faster')]))
        c1 = {c['arm']: c for c in r1.get('configs', [])}
        for c0 in r0.get('configs', []):
            if c0['arm'] in c1:
                x = c1[c0['arm']]
                cfgs.append(dict(label=r0['label'], arm=c0['arm'], first=c0['ratio'], rerun=x['ratio'], rel_diff=x['ratio'] / c0['ratio'] - 1,
                                 side_change=(c0['ratio'] < 1) != (x['ratio'] < 1)))
    d = [abs(x['rel_diff']) for x in cfgs]
    return dict(rows=rows, configs=cfgs, abs_rel_diff_median=float(np.median(d)) if d else None, abs_rel_diff_max=float(max(d)) if d else None,
                side_changes=[x for x in rows if x['side_change']], config_side_changes=[x for x in cfgs if x['side_change']])


def scores(f):
    return {c['file']: np.asarray(c['scores'], np.float64) for c in json.load(open(f))['calls']}


def bit_equal(p):
    """Per arm: share of scores in every rerun file equal to the original r0.p0 file (NaN = NaN)."""
    out = {}
    for d1 in glob.glob(os.path.join(R2, f'{p}-r2*', 'ho-warm', 'beir-*')):
        s = os.path.basename(d1)
        d0 = glob.glob(os.path.join(QIN, p, '*', 'ho-warm', s))
        if not d0:
            continue
        for f0 in glob.glob(os.path.join(d0[0], '*.r0.p0.json')):
            arm = os.path.basename(f0)[:-len('.r0.p0.json')]
            base = scores(f0)
            a = out.setdefault(arm, dict(files=0, scores=0, equal=0, maxabs=0.0))
            for f in glob.glob(os.path.join(d1, f'{glob.escape(arm)}.r*.p*.json')):
                a['files'] += 1
                for k, x in scores(f).items():
                    y = base[k]
                    a['scores'] += x.size
                    a['equal'] += int(np.sum((x == y) | (np.isnan(x) & np.isnan(y))))
                    ok = np.isfinite(x) & np.isfinite(y)
                    if ok.any():
                        a['maxabs'] = max(a['maxabs'], float(np.max(np.abs(x[ok] - y[ok]))))
    return {k: dict(v, bit_equal_share=v['equal'] / v['scores']) for k, v in out.items() if v['files']}


def main():
    res = {}
    for p in ('intel', 'amd', 'arm'):
        if not available(f'{p}-r2'):
            continue
        w0, w1 = cache(p, 'ho-warm'), cache(f'{p}-r2', 'ho-warm')
        res[p] = {}
        for grp in ('k100', 'k25'):
            sets = sorted(s for s in w1 if s.startswith('beir-') and s.endswith('-' + grp))
            if not sets:
                continue
            res[p][grp] = dict(sets=sets, **compare(workload_rows(w0, sets, 'beir', p, fixed=FIXED), workload_rows(w1, sets, 'beir', p, fixed=FIXED)))
            g = res[p][grp]
            # the kernel's own time on the rerun instance against the first one (geometric mean over the calls)
            o0 = np.concatenate([w0[s]['arms']['ours']['ms'] for s in sets]); o1 = np.concatenate([w1[s]['arms']['ours']['ms'] for s in sets])
            g['ours_rerun_over_first'] = float(np.exp(np.mean(np.log(o1 / o0))))
            print(p, grp, len(sets), 'sets;', len(g['configs']), 'configurations; |rel diff| median',
                  f"{g['abs_rel_diff_median']:.3f} max {g['abs_rel_diff_max']:.3f};", len(g['side_changes']), 'rows and', len(g['config_side_changes']),
                  'configurations change sides; kernel time rerun / first', f"{g['ours_rerun_over_first']:.3f}")
        res[p]['scores'] = bit_equal(p)
        bad = {k: round(v['bit_equal_share'], 4) for k, v in res[p]['scores'].items() if v['bit_equal_share'] < 1}
        print(p, 'scores:', 'all bit-equal' if not bad else bad)
    dump('rerun_beir.json', res)


if __name__ == '__main__':
    main()
