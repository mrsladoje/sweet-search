# python3 numkong_negcos_repro.py [saved.npz]
#
# Standalone repro (numpy + numkong only) for a NumKong maxsim_packed defect seen on x86
# (Intel Granite Rapids, NumKong 7.8.5, backend `sapphireamx`): when every cosine between a
# query token and the doc tokens is negative and the doc length mod 64 is 49-63, the result
# is wrong (f16: NaN; bf16: cosine 0; f32: 1, 0 or garbage). Cause: the AMX fast path scans
# the zero-padded columns of a partial last tile (include/numkong/maxsim/sapphireamx.h).
#
# Why the check does not depend on NumKong's approximate token choice: NumKong refines the
# cosine of ONE real doc token (picked by its i8 screen), so the returned cosine must lie
# in [min, max] of the true cosines (here all negative). Anything outside, or NaN, is wrong.
# maxsim_packed returns sum_i (1 - cos_i); with one query token, cos = 1 - result.
import platform, sys

import numpy as np
import numkong as nk

DIM = 128
LENGTHS = [1, 15, 16, 17, 31, 32, 33, 48, 49, 63, 64, 100, 113, 128, 183]
TYPES = {'f32': None, 'f16': 'float16', 'bf16': 'bfloat16'}


def cosines(q, d):
    q = q.astype(np.float64); d = d.astype(np.float64)
    return (d @ q[0]) / (np.linalg.norm(d, axis=1) * np.linalg.norm(q[0]))


def nk_cos(q, d, dt):
    cast = (lambda a: a) if TYPES[dt] is None else (lambda a: nk.astype(a, TYPES[dt]))
    r = nk.maxsim_packed(nk.maxsim_pack(cast(q), dtype=dt), nk.maxsim_pack(cast(d), dtype=dt))
    return 1.0 - float(r)


def check(name, q, d):
    c = cosines(q, d)
    assert c.max() < 0, 'test input must have only negative cosines'
    bad = []
    for dt in TYPES:
        got = nk_cos(q, d, dt)
        wrong = not np.isfinite(got) or not (c.min() - 0.01 <= got <= c.max() + 0.01)
        bad += [dt] if wrong else []
        print(f'{name:>14} n={d.shape[0]:>3} {dt:>4}: cos={got: .4f}  true max={c.max(): .4f} min={c.min(): .4f}  {"WRONG" if wrong else "ok"}')
    return bad


def main():
    print(f'numkong {nk.__version__}, numpy {np.__version__}, {platform.machine()}, {platform.processor() or platform.platform()}')
    rng = np.random.default_rng(42)
    q = rng.standard_normal((1, DIM)).astype(np.float32)
    fails = {}
    for n in LENGTHS:
        d = (-q + 0.5 * rng.standard_normal((n, DIM))).astype(np.float32)   # every cosine < 0
        b = check('synthetic', q, d)
        if b:
            fails[n] = b
    if len(sys.argv) > 1:
        z = np.load(sys.argv[1])
        b = check('saved', z['q'], z['d'])
        if b:
            fails[f'saved n={z["d"].shape[0]}'] = b
    print('RESULT:', 'no wrong result' if not fails else f'wrong results: {fails}')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
