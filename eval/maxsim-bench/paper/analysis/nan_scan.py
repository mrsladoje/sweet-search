# venv/bin/python -I paper/analysis/nan_scan.py
#
# Post-freeze analysis code (not frozen). Counts, per platform, arm, mode and set family, the
# calls whose recorded error against the arm's contract reference is NaN (the arm returned a
# NaN score). The per-arm maximum error elsewhere skips NaN, so this count is reported beside
# it. Counts over every run file (round x process), aggregates only.
import collections, glob, json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import dump  # noqa: E402

ROOTS = {'intel': '~/.ss-eval/maxsim-cloud/s8/intel-[1-4]', 'amd': '~/.ss-eval/maxsim-cloud/s8/amd-[1-4]',
         'arm': '~/.ss-eval/maxsim-cloud/s8/arm-[1-4]', 'm3max': '~/.ss-eval/maxsim-local/m3max', 'epyc': '~/.ss-eval/maxsim-local/epyc'}


def main():
    res = {}
    for p, r in ROOTS.items():
        nan, tot = collections.Counter(), collections.Counter()
        for f in glob.glob(os.path.expanduser(r) + '/ho-*/*/*.r*.p*.json'):
            arm, tag, s = os.path.basename(f).split('.r')[0], f.split('/')[-3], f.split('/')[-2]
            d = json.load(open(f))
            if 'calls' not in d:
                continue
            fam = 'beir' if s.startswith('beir') else ('sweep' if s.startswith('q') else s)
            for c in d['calls']:
                e = c.get('err')
                k = f'{arm}|{tag}|{fam}'
                tot[k] += 1
                if e is None or (isinstance(e, float) and math.isnan(e)):
                    nan[k] += 1
        if tot:
            res[p] = {k: dict(nan=nan[k], runs=tot[k]) for k in sorted(tot) if nan[k]}
            res[p]['_total_runs'] = sum(tot.values())
    dump('nan.json', res)
    for p, d in res.items():
        print(p, {k: v for k, v in d.items() if k != '_total_runs'} or 'no NaN', d['_total_runs'])


if __name__ == '__main__':
    main()
