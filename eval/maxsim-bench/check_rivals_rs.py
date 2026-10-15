"""Correctness check for rivals_rs (synthetic data only, seed 42, no timing).
Compares each shim function with a float64 NumPy implementation of the library's formula."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # python -I drops the script dir
import rivals_rs as rv

LENS = [1, 3, 17, 64, 300]


def bf16_round(x):
    u = np.ascontiguousarray(x, np.float32).view(np.uint32).astype(np.uint64)
    u = (u + 0x7FFF + ((u >> 16) & 1)) >> 16 << 16  # round to nearest even
    return u.astype(np.uint32).view(np.float32)


def cast(x, dt):
    return {'f32': lambda a: a, 'f16': lambda a: a.astype(np.float16).astype(np.float32), 'bf16': bf16_round}[dt](x)


def make(rng, nq, dim, ndoc=25):
    q = rng.standard_normal((nq, dim)).astype(np.float32)
    docs = []
    for i in range(ndoc):
        n = LENS[i % len(LENS)]
        d = rng.standard_normal((n, dim)).astype(np.float32)
        a = rng.uniform(0, 2.5)  # doc-dependent correlation with the query, so scores differ and top-1 is meaningful
        d += a * q[rng.integers(0, nq, n)]
        docs.append(d.astype(np.float32))
    return q, docs


def ref_np_raw_mean(q, docs):  # NextPlaid formula: mean_i max_j q_i . d_j (raw dot)
    q = q.astype(np.float64)
    return np.array([(q @ d.astype(np.float64).T).max(1).mean() for d in docs])


def ref_nk_mean(q, docs):  # NumKong formula with exact argmax: mean_i min(1, max_j cos)
    q = q.astype(np.float64); qn = q / np.linalg.norm(q, axis=1, keepdims=True)
    out = []
    for d in docs:
        d = d.astype(np.float64); dn = d / np.linalg.norm(d, axis=1, keepdims=True)
        out.append(np.minimum((qn @ dn.T).max(1), 1.0).mean())
    return np.array(out)


def report(name, got, ref):
    err = np.abs(got - ref).max()
    top = int(np.argmax(got) == np.argmax(ref))
    # rank agreement over the whole candidate list
    rk = float((np.argsort(-got) == np.argsort(-ref)).mean())
    print(f'  {name:<22} max_abs_err={err:.3e}  top1_agree={top}  rank_positions_equal={rk:.2f}')
    return err


def main():
    print('build_info:', rv.build_info())
    rng = np.random.default_rng(42)
    for dim in (96, 128, 127):
        for nq in (1, 32):
            q, docs = make(rng, nq, dim)
            print(f'dim={dim} nq={nq} doc_lens={LENS}x5')
            # NextPlaid on raw (unnormalised) vectors: raw-dot formula
            for th in (1, 4):
                report(f'nextplaid th={th}', rv.nextplaid_scores(q, docs, th), ref_np_raw_mean(q, docs))
            # NumKong: compare with the exact-argmax formula on dtype-rounded inputs
            for dt in ('f32', 'f16', 'bf16'):
                qc, dc = cast(q, dt), [cast(d, dt) for d in docs]
                ref = ref_nk_mean(qc, dc)
                prep = rv.NumKongPrepared(q, docs, dt)
                for th in (1, 4):
                    report(f'numkong_{dt} th={th}', prep.run(th), ref)
    # NumKong shim vs the Python interface (same library, must be identical) and single-token docs (no argmax choice)
    try:
        import numkong as nk
    except ImportError:
        nk = None
    q, docs = make(rng, 32, 128)
    one_tok = [d[:1] for d in docs]
    for dt in ('f32', 'f16', 'bf16'):
        cast_nk = (lambda a: a) if dt == 'f32' else (lambda a: nk.astype(a, 'bfloat16' if dt == 'bf16' else 'float16'))
        shim = rv.NumKongPrepared(q, docs, dt).run_raw(1)
        if nk is not None:
            qp = nk.maxsim_pack(cast_nk(q), dtype=dt)
            py = np.array([nk.maxsim_packed(qp, nk.maxsim_pack(cast_nk(d), dtype=dt)) for d in docs])
            print(f'parity numkong_{dt}: max |shim - python| = {np.abs(shim - py).max():.3e}')
        qc, oc = cast(q, dt), [cast(d, dt) for d in one_tok]
        report(f'numkong_{dt} 1-tok docs', rv.NumKongPrepared(q, one_tok, dt).run(1), ref_nk_mean(qc, oc))
    # zero-norm and opposite-pair edge cases
    q = np.zeros((2, 96), np.float32); q[1, 0] = 1
    d = [np.zeros((3, 96), np.float32), np.tile(np.eye(96, dtype=np.float32)[0] * -1, (3, 1))]
    print('edge: zero q-token & zero doc / opposite pair, NumKong f32 mean-cos (exact formula: 0 and -0.5 for opposite on token 1):')
    print('  ', rv.numkong_scores(q, d, 'f32', 1), ' nextplaid mean dot:', rv.nextplaid_scores(q, d, 1))


if __name__ == '__main__':
    main()
