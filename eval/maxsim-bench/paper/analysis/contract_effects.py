# venv/bin/python -I paper/analysis/contract_effects.py [REPLAY_ROOT]
#
# Post-freeze analysis code (not frozen). Contract effects, reference against reference
# (PAPER_PLAN.md section 4): both sides are float64 references from contracts.py's refs-v2
# caches, so no implementation error enters. Per set group: max absolute score difference,
# top-1 agreement and mean top-10 overlap over calls. Aggregates only.
#   epsilon placement   S-noclamp      vs Spre-b-noclamp   (S: eps on the norm product; Spre: eps on the doc norm)
#   clamp               S-clamp        vs S-noclamp
#   S vs C              S-clamp        vs C-b-noclamp      (NumKong's contract: cosine of the received vectors, no clamp)
#   PyLate padding      Spre-pad0-b    vs Spre-b-noclamp
#   f32 pre-scaling     Spre-a-f32-*   vs Spre-b-*         (input rounding of the rival inputs)
#   bf16 / f16 cast     Spre-a-bf16/f16 vs Spre-b          (input rounding of the low-precision inputs)
import glob, json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, dump  # noqa: E402

PAIRS = [('epsilon placement (S vs S-pre, no clamp)', 'S-noclamp', 'Spre-b-noclamp'),
         ('clamp (S with vs without max(0, .))', 'S-clamp', 'S-noclamp'),
         ('S vs C (NumKong contract)', 'S-clamp', 'C-b-noclamp'),
         ('PyLate zero padding (S-pre-pad0 vs S-pre)', 'Spre-pad0-b-noclamp', 'Spre-b-noclamp'),
         ('f32 pre-scaling of rival inputs', 'Spre-a-f32-noclamp', 'Spre-b-noclamp'),
         ('bf16 cast of rival inputs', 'Spre-a-bf16-noclamp', 'Spre-b-noclamp'),
         ('f16 cast of rival inputs', 'Spre-a-f16-noclamp', 'Spre-b-noclamp')]


def set_effects(root):
    idx = json.load(open(os.path.join(root, 'refs-v2', 'index.json')))
    arr = {}

    def get(sub, v):
        if (sub, v) not in arr:
            arr[(sub, v)] = np.fromfile(os.path.join(root, 'refs-v2', sub, v + '.f64'), '<f8')
        return arr[(sub, v)]
    acc = {name: dict(maxabs=0.0, top1=[], top10=[]) for name, _, _ in PAIRS}
    for key, (o, n) in idx['calls'].items():
        sub = key.split('/', 1)[0]
        for name, x, y in PAIRS:
            a, b = get(sub, x)[o:o + n], get(sub, y)[o:o + n]
            acc[name]['maxabs'] = max(acc[name]['maxabs'], float(np.max(np.abs(a - b))) if n else 0.0)
            if n > 1:
                ta, tb = np.argsort(-a, kind='stable'), np.argsort(-b, kind='stable')
                acc[name]['top1'].append(ta[0] == tb[0])
                k = min(10, n)
                acc[name]['top10'].append(len(set(ta[:k]) & set(tb[:k])) / k)
    return acc, len(idx['calls'])


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/.ss-eval/maxsim-v2-mac/replay')
    groups = {'agent-ho': [os.path.join(root, 'agent-ho')], 'gcsn-ho': [os.path.join(root, 'gcsn-ho')],
              'beir (20 sets)': sorted(glob.glob(os.path.join(root, 'beir', 'beir-*')))}
    res = {}
    for g, roots in groups.items():
        tot = {name: dict(maxabs=0.0, top1=[], top10=[]) for name, _, _ in PAIRS}
        calls = 0
        for r in roots:
            acc, n = set_effects(r)
            calls += n
            for name in tot:
                tot[name]['maxabs'] = max(tot[name]['maxabs'], acc[name]['maxabs'])
                tot[name]['top1'] += acc[name]['top1']; tot[name]['top10'] += acc[name]['top10']
        res[g] = dict(calls=calls, effects={name: dict(max_abs=v['maxabs'], top1_agree=float(np.mean(v['top1'])),
                                                      top10_overlap=float(np.mean(v['top10'])), calls_with_2plus=len(v['top1']))
                                            for name, v in tot.items()})
    dump('contract_effects.json', res)
    L = ['# Contract effects (float64 reference vs float64 reference; held-out sets)', '',
         '| set group | effect | calls (pool ≥ 2) | max abs score difference | top-1 agreement | mean top-10 overlap |', '|---|---|--:|--:|--:|--:|']
    for g, d in res.items():
        for name, e in d['effects'].items():
            L.append(f"| {g} | {name} | {e['calls_with_2plus']} | {e['max_abs']:.1e} | {e['top1_agree']*100:.2f}% | {e['top10_overlap']*100:.2f}% |")
    open(os.path.join(OUT, 'contract_effects.md'), 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L))


if __name__ == '__main__':
    main()
