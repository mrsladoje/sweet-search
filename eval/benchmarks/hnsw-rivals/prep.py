# Exact 768-d cosine top-10 for every query -> <out>/gt.bin (int32 nq x 10). usage: python prep.py <setDir>
import sys, os, numpy as np
s = sys.argv[1]; os.makedirs(f'{s}/res', exist_ok=True)
X = np.fromfile(f'{s}/corpus768.bin', dtype=np.float32).reshape(-1, 768); Q = np.fromfile(f'{s}/q768.bin', dtype=np.float32).reshape(-1, 768)
X /= np.linalg.norm(X, axis=1, keepdims=True); Q /= np.linalg.norm(Q, axis=1, keepdims=True)
GT = np.empty((len(Q), 10), dtype=np.int32)
for b in range(0, len(Q), 256):
    S = Q[b:b+256] @ X.T; P = np.argpartition(-S, 10, axis=1)[:, :10]
    GT[b:b+256] = np.take_along_axis(P, np.argsort(-np.take_along_axis(S, P, 1), 1), 1)
GT.tofile(f'{s}/gt.bin'); print(s, len(X), len(Q))
