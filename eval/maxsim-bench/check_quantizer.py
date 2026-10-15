# Byte-compares quantize_int4.py against the production JS (see check_quantizer.mjs).
# python check_quantizer.py   (needs node; seed 42)
import os, subprocess, sys, tempfile
import numpy as np
from quantize_int4 import quantize_int4_per_token

HERE = os.path.dirname(os.path.abspath(__file__))


def make_tokens(dim, rng):
    t = []
    t.append(rng.standard_normal((120, dim)) * 0.1)                     # normal-like
    t.append(rng.standard_normal((20, dim)) * 50.0)                     # large range
    t.append(rng.standard_normal((20, dim)) * 1e-4)                     # tiny range
    t.append(-np.abs(rng.standard_normal((20, dim))) - 1.0)             # all negative
    t.append(np.full((3, dim), 0.25))                                   # constant tokens
    t.append(np.zeros((2, dim)))
    t.append(np.full((2, dim), -3.5))
    # exact .5 boundaries: min 0, max 15 -> sc = 1; values k + 0.5
    b = np.zeros((6, dim))
    b[:, 0] = 0.0; b[:, 1] = 15.0
    for i in range(6):
        b[i, 2:] = ((np.arange(dim - 2) + i) % 15) + 0.5
    t.append(b)
    b2 = np.zeros((4, dim))                                             # negative-range boundaries
    b2[:, 0] = -7.5; b2[:, 1] = 7.5
    b2[:, 2:] = (np.arange(dim - 2) % 15) - 7.5 + 0.5
    t.append(b2)
    b3 = np.zeros((4, dim))                                             # scale 0.5
    b3[:, 0] = 0.0; b3[:, 1] = 7.5
    b3[:, 2:] = ((np.arange(dim - 2) % 15) + 0.5) * 0.5
    t.append(b3)
    t.append(rng.integers(-3, 4, (10, dim)).astype(np.float64) / 4.0)   # grid values
    t.append(np.concatenate([np.full((2, dim // 2), 1.0), np.full((2, dim - dim // 2), 2.0)], axis=1))
    return np.concatenate(t).astype(np.float32)


def main():
    rng = np.random.default_rng(42)
    ok = True
    total = 0
    with tempfile.TemporaryDirectory() as td:
        for dim in (96, 128, 127):
            x = make_tokens(dim, rng)
            n = len(x)
            inp, outp = os.path.join(td, 'in.bin'), os.path.join(td, 'out.bin')
            x.tofile(inp)
            subprocess.run(['node', os.path.join(HERE, 'check_quantizer.mjs'), inp, outp, str(dim), str(n)], check=True)
            buf = open(outp, 'rb').read()
            ps = (dim + 1) // 2
            off = 0

            def take(nb, dt, shape):
                nonlocal off
                a = np.frombuffer(buf[off:off + nb], dt).reshape(shape); off += nb
                return a
            js = {}
            for tag in ('A', 'B'):
                js[tag] = (take(n * ps, np.uint8, (n, ps)), take(n * 4, np.float32, n),
                           take(n * 4, np.float32, n), take(n * 4, np.float32, n))
            py = quantize_int4_per_token(x)
            for tag in ('A', 'B'):
                names = ['raw', 'mn', 'sc'] + (['nr'] if tag == 'B' else [])
                for i, nm in enumerate(names):
                    same = js[tag][i].tobytes() == py[i].tobytes()
                    if not same:
                        bad = np.nonzero((js[tag][i] != py[i]).reshape(n, -1).any(axis=1))[0]
                        print(f'dim {dim} {tag}.{nm}: MISMATCH on {len(bad)} tokens, first {bad[:5]}')
                    ok &= same
            print(f'dim {dim}: {n} tokens compared (function text A, add() B); constant tokens={(py[2] == 0).sum()}')
            total += n
    print(f'total tokens {total}; byte-identical (raw, mn, sc, nr): {"YES" if ok else "NO"}')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
