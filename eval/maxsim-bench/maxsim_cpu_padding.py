# venv/bin/python -I maxsim_cpu_padding.py [seed]
# Shows why maxsim-cpu's list API (maxsim_scores_variable) differs from the exact
# score on some calls (the "max abs err" footnote in RESULTS.md). Shorter docs are
# padded with zero vectors inside its batches; a zero vector scores 0, so a query
# token whose best cosine is below 0 counts as 0 (a max(0, .) clamp) for some docs,
# depending on which other docs are in the call. One doc per call, and the padded
# 3D API (maxsim_scores), give the exact score. Seen on the arm64 build; the x86
# build is exact here. Synthetic data: random unit vectors, with every doc token
# turned away from query token 0, so that token's best cosine is below 0; docs of
# 100-511 tokens are scored together with one 512-token doc.
import importlib.metadata, sys
import numpy as np
import maxsim_cpu as mx

rng = np.random.default_rng(int(sys.argv[1]) if len(sys.argv) > 1 else 42)
unit = lambda a: (a / np.linalg.norm(a, axis=1, keepdims=True)).astype(np.float32)
q = unit(rng.standard_normal((8, 128)))
def doc(n):
    d = unit(rng.standard_normal((n, 128)))
    return np.ascontiguousarray(d * -np.sign(d @ q[0])[:, None])  # dot with q[0] < 0
docs = [doc(512)] + [doc(int(n)) for n in rng.integers(100, 512, 199)]

def exact(d, clamp=False):
    m = (q.astype(np.float64) @ d.astype(np.float64).T).max(1)
    return (np.maximum(m, 0) if clamp else m).sum()

ref = np.array([exact(d) for d in docs])
ref_clamped = np.array([exact(d, True) for d in docs])
listed = np.asarray(mx.maxsim_scores_variable(q, docs), np.float64)
single = np.array([mx.maxsim_scores_variable(q, [d])[0] for d in docs], np.float64)
off = np.abs(listed - ref) > 1e-4
print(f'maxsim-cpu {importlib.metadata.version("maxsim-cpu")}: {len(docs)} docs, 8 query tokens')
print(f'list API, all docs in one call: {off.sum()} docs differ from the exact score (max {np.abs(listed - ref).max():.3f})')
print(f'  of those, equal to the clamped score max(0, .): {(np.abs(listed[off] - ref_clamped[off]) < 1e-4).sum()}')
L = max(len(d) for d in docs)  # 3D API: pad by repeating the last token (no new maxima)
d3 = np.stack([np.vstack([d, np.repeat(d[-1:], L - len(d), 0)]) for d in docs])
print(f'padded 3D API, all docs in one call: max difference {np.abs(np.asarray(mx.maxsim_scores(q, d3), np.float64) - ref).max():.1e}')
print(f'list API, one doc per call: max difference {np.abs(single - ref).max():.1e}')
