# venv/bin/python -I paper/analysis/numkong_check.py
#
# Post-freeze diagnostic (not frozen; synthetic data only, no benchmark data). Is NumKong's
# quality collapse with answerai-colbert-small (dimension 96) a property of NumKong or of our
# adapter? Two checks per dimension (96, 128) and input type (f32, bf16, f16):
#   1. library vs exact: NumKong's maxsim_packed (its own Python API) against an exact float64
#      MaxSim of the same vectors (contract C: cosine, no clamp), on
#        random     random unit vectors (candidate scores about 3% apart)
#        clustered  every token = a shared direction + small noise: candidate scores about 0.1% apart,
#                like answerai-colbert-small's candidates (median top-1/top-10 gap 0.8-2.1%)
#      reported: top-1 agreement over queries, mean |score error|, Spearman correlation of the
#      candidate order;
#   2. adapter vs library: our Rust loop over NumKong's C kernel (rivals_rs.NumKongPrepared,
#      the "native" arms) against the Python API on the same inputs (must be equal).
import json, os, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
import numkong as nk  # noqa: E402

RNG = np.random.default_rng(42)
NQ, NDOC, NTOK = 32, 100, 160          # BEIR-like: 32 query tokens, 100 candidates of ~160 tokens
QUERIES = 40


def unit(a):
    return (a / np.linalg.norm(a, axis=-1, keepdims=True)).astype(np.float32)


def make(dim, kind):
    if kind == 'random':
        q = unit(RNG.standard_normal((NQ, dim)))
        docs = [unit(RNG.standard_normal((NTOK, dim))) for _ in range(NDOC)]
    else:
        base = RNG.standard_normal(dim)
        q = unit(base + 0.35 * RNG.standard_normal((NQ, dim)))
        docs = [unit(base + 0.35 * RNG.standard_normal((NTOK, dim))) for _ in range(NDOC)]
    return q, docs


def exact(q, docs):
    q64 = q.astype(np.float64)
    q64 /= np.linalg.norm(q64, axis=1, keepdims=True)
    out = []
    for d in docs:
        d64 = d.astype(np.float64); d64 /= np.linalg.norm(d64, axis=1, keepdims=True)
        out.append((q64 @ d64.T).max(1).mean())
    return np.array(out)


def numkong_py(q, docs, dt):
    cast = (lambda a: a) if dt == 'f32' else (lambda a: nk.astype(a, 'bfloat16' if dt == 'bf16' else 'float16'))
    qp = nk.maxsim_pack(cast(q), dtype=dt)
    r = np.array([nk.maxsim_packed(qp, nk.maxsim_pack(cast(d), dtype=dt)) for d in docs], np.float64)
    return (q.shape[0] - r) / q.shape[0]           # NumKong returns sum(1 - cos)


def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def main():
    try:
        import rivals_rs
    except ImportError:
        rivals_rs = None
    res = {}
    for dim in (96, 128):
        for kind in ('random', 'clustered'):
            for dt in ('f32', 'bf16', 'f16'):
                top1, err, rho, gap, adapter = [], [], [], [], []
                for _ in range(QUERIES):
                    q, docs = make(dim, kind)
                    ex, got = exact(q, docs), numkong_py(q, docs, dt)
                    s = np.sort(ex)[::-1]
                    gap.append((s[0] - s[9]) / s[0])
                    top1.append(int(np.argmax(ex) == np.argmax(got)))
                    err.append(float(np.mean(np.abs(ex - got))))
                    rho.append(spearman(ex, got))
                    if rivals_rs is not None:
                        nat = np.asarray(rivals_rs.NumKongPrepared(q, docs, dt).run(1), np.float64)
                        adapter.append(float(np.max(np.abs(nat - got))))
                res[f'dim{dim}|{kind}|{dt}'] = dict(
                    top1_agreement=float(np.mean(top1)), mean_abs_error=float(np.mean(err)), spearman_median=float(np.median(rho)),
                    top1_top10_gap_median=float(np.median(gap)),
                    adapter_vs_python_max_abs=(max(adapter) if adapter else None))
                print(f'dim {dim:3d} {kind:9s} {dt:4s}  top-1 {np.mean(top1):.2f}  mean|err| {np.mean(err):.4f}  '
                      f'spearman {np.median(rho):.3f}  gap {np.median(gap):.3f}  adapter-vs-python {max(adapter) if adapter else "n/a"}')
    out = os.path.join(HERE, 'tables', 'numkong_check.json')
    json.dump(dict(numkong=getattr(nk, '__version__', '?'), queries=QUERIES, shape=[NQ, NDOC, NTOK], results=res), open(out, 'w'), indent=1)


if __name__ == '__main__':
    main()
