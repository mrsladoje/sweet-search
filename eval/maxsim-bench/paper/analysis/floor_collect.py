# venv/bin/python -I paper/analysis/floor_collect.py
#
# Post-freeze analysis code (not frozen). Fixed cost per call (rerun/floor.py; plan in
# rerun-plan.md): per CPU and arm, the time of the smallest call (one query token, one
# candidate of one token), the time of the median development agent call, and their ratio.
# Development data only. Writes tables/floor.json; the paper table uses the kernel and each
# library's frozen primary float32 agent configuration.
import glob, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PLATFORMS, dump, shortlist  # noqa: E402

CLOUD = os.path.expanduser('~/.ss-eval/maxsim-cloud/r2')
LOCAL = os.path.expanduser('~/.ss-eval/maxsim-local/rerun')
LIBS = ('numpy', 'torch', 'maxsim_cpu', 'nextplaid', 'numkong')


def files(p):
    if p in ('intel', 'amd', 'arm'):
        return sorted(glob.glob(os.path.join(CLOUD, f'{p}-r2*', 'floor', 'floor.json')))
    return sorted(glob.glob(os.path.join(LOCAL, p, 'floor', 'floor.json')))


def main():
    res = {}
    for p in PLATFORMS:
        fs = files(p)
        if not fs:
            continue
        d = json.load(open(fs[-1]))                     # one measurement per CPU (the last one if two instances ran it)
        arms = {a: {k: v[k] for k in ('floor_us', 'floor_range', 'median_us', 'median_range', 'share')} for a, v in d['arms'].items() if 'floor_us' in v}
        errors = {a: v['errors'] for a, v in d['arms'].items() if v['errors']}
        fam = shortlist(p)['families']['agent']
        prim = {lib: fam[lib]['f32']['primary'] for lib in LIBS if lib in fam and 'f32' in fam[lib]}
        res[p] = dict(source=os.path.relpath(fs[-1], os.path.expanduser('~')), median_shape=d['median_shape'], arms=arms, errors=errors,
                      primary={lib: a for lib, a in prim.items() if a in arms}, instances=len(fs))
        print(p, len(arms), 'arms', 'errors:', list(errors) or 'none')
    dump('floor.json', res)


if __name__ == '__main__':
    main()
