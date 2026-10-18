# venv/bin/python -I paper/analysis/checks_collect.py
#
# Post-freeze analysis code (not frozen). The two review checks of 2026-10-17 (plan in
# rerun-plan.md), both run on the M3 Max: rerun/f32direct.py (rivals on the original float32
# token vectors against the int4-decoded ones) and rerun/colbert300.py (ColBERTv2 documents at
# 180 and 300 tokens, contract F). Both files hold aggregates only. Writes tables/checks.json.
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dump  # noqa: E402

LOCAL = os.path.expanduser('~/.ss-eval/maxsim-local/rerun')


def main():
    res = {}
    f = os.path.join(LOCAL, 'm3max', 'f32direct', 'f32direct.json')
    if os.path.exists(f):
        d = json.load(open(f))
        res['f32direct'] = dict(source=os.path.relpath(f, os.path.expanduser('~')), machine=d['machine'], k=d['k'], rounds=d['rounds'], reps=d['reps'],
                                cells=d['cells'])
        r = [a['p95_ratio_original_over_decoded'] for c in d['cells'].values() for a in c['arms'].values()]
        print('f32direct: p95 original / decoded', f'{min(r):.3f}-{max(r):.3f}')
    f = os.path.join(LOCAL, 'colbert300.json')
    if os.path.exists(f):
        d = json.load(open(f))
        res['colbert300'] = dict(source=os.path.relpath(f, os.path.expanduser('~')), model=d['model'], revision=d['revision'], k=d['k'], results=d['results'])
        print('colbert300:', {k: round(v['ndcg10'], 4) for k, v in d['results'].items()})
    dump('checks.json', res)


if __name__ == '__main__':
    main()
