"""Correctness driver for scann_adapter.py (counterpart of adapter_test_new.cpp).
usage: python scann_test.py --old <setDir> [--nq 500] [--threads 8] [--tmp dir]
Per case: build into a temp dir, load in the same process, search the first NQ queries at high effort, print
recall@10 against the exact float64 top 10 and the bytes on disk. PASS when recall@10 >= 0.95. Exit 1 on any FAIL.
Also builds the tree_ah case twice and reports whether the serialised bytes are identical (seed note in the adapter).
"""
import argparse, hashlib, os, shutil, sys, tempfile, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scann_adapter import ScannAdapter

ap = argparse.ArgumentParser()
ap.add_argument("--old", required=True); ap.add_argument("--nq", type=int, default=500)
ap.add_argument("--threads", type=int, default=8); ap.add_argument("--tmp", default=None)
a = ap.parse_args()
D = 768
def unit(m):
    return (m / np.maximum(np.linalg.norm(m.astype(np.float64), axis=1, keepdims=True), 1e-30)).astype(np.float32)
X = unit(np.fromfile(os.path.join(a.old, "corpus768.bin"), dtype=np.float32).reshape(-1, D))
Q = unit(np.fromfile(os.path.join(a.old, "q768.bin"), dtype=np.float32).reshape(-1, D))[:a.nq]
n = len(X)
gt = np.argsort(-(Q.astype(np.float64) @ X.astype(np.float64).T), axis=1, kind="stable")[:, :10]
leaves = int(round(n ** 0.5))
cases = [  # name, build params, search params (high effort)
    ("scann_brute", {"mode": "brute"}, {}),
    ("scann_ah", {"mode": "ah"}, {"reorder": 400}),
    ("scann_tree_ah", {"mode": "tree_ah", "leaves": "sqrt"}, {"leaves_to_search": leaves, "reorder": 400}),
    ("scann_tree_ah_2sqrt", {"mode": "tree_ah", "leaves": "2sqrt"}, {"leaves_to_search": 2 * leaves, "reorder": 400}),
    ("scann_tree_ah_soar", {"mode": "tree_ah", "leaves": "sqrt", "soar": 1}, {"leaves_to_search": leaves, "reorder": 400}),
]
tmp = tempfile.mkdtemp(prefix="scann_test_", dir=a.tmp)
fails = 0
def digest(d):
    h = hashlib.sha256()
    for f in sorted(os.listdir(d)):
        h.update(f.encode()); h.update(open(os.path.join(d, f), "rb").read())
    return h.hexdigest()[:12]
try:
    for name, bp, sp in cases:
        d = os.path.join(tmp, name); os.mkdir(d)
        t0 = time.time(); ScannAdapter().build(X, bp, a.threads, 42, d); bs = time.time() - t0
        ad = ScannAdapter(); ad.load(d, X, bp); ad.set_search(sp)
        nbytes = sum(os.path.getsize(f) for f in ad.files(d))
        hit = short = unsorted = 0
        for i in range(len(Q)):
            ids, sc = ad.search(Q[i], 10)
            hit += len(set(ids.tolist()) & set(gt[i].tolist())); short += len(ids) < 10
            unsorted += int(np.any(np.diff(sc) > 1e-6))
        rec = hit / (10.0 * len(Q))
        ok = rec >= 0.95 and nbytes > 0 and short == 0 and unsorted == 0
        print(f"{name:22s} {'PASS' if ok else 'FAIL'} recall@10={rec:.4f} (min 0.95) nq={len(Q)} bytes={nbytes} "
              f"build_s={bs:.1f} short={short} unsorted={unsorted} files={len(ad.files(d))} mode={ad.info()['mode']}")
        fails += not ok
        if name == "scann_tree_ah":
            d2 = os.path.join(tmp, name + "_2"); os.mkdir(d2); ScannAdapter().build(X, bp, a.threads, 42, d2)
            print(f"    rebuild identical bytes: {digest(d) == digest(d2)} ({digest(d)} vs {digest(d2)})")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
print("RESULT", "FAIL (%d)" % fails if fails else "OK")
sys.exit(1 if fails else 0)
