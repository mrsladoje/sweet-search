"""Per-call cost of the Python loop around a no-op search (harness overhead to report for ScaNN).
usage: python py_overhead.py [--calls 200000] [--dim 768]
Measures, with time.perf_counter_ns around each call (the same boundary as the timing protocol: query vector in
memory -> (ids, scores)):
  loop_noop    a Python method with the adapter signature that returns preallocated arrays (loop + call + timer)
  timer_only   two perf_counter_ns reads with nothing between them
  scann_1pt    ScannAdapter.search on a 1-vector brute-force index (pybind marshalling + the wrapper; compute ~0)
Prints min / median / p99 in ns per call. loop_noop - timer_only is the interpreter cost; scann_1pt - timer_only is
the wrapper + pybind cost to subtract as a fixed overhead.
"""
import argparse, os, shutil, sys, tempfile, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument("--calls", type=int, default=200000); ap.add_argument("--dim", type=int, default=768)
a = ap.parse_args()
rng = np.random.default_rng(42)
Q = rng.standard_normal((1000, a.dim)).astype(np.float32); Q /= np.linalg.norm(Q, axis=1, keepdims=True)

class Noop:
    def __init__(self): self.i = np.zeros(10, np.int64); self.s = np.zeros(10, np.float32)
    def search(self, q, k): return self.i, self.s

def run(fn):
    t = np.empty(a.calls, np.int64); pc = time.perf_counter_ns
    for w in range(2000): fn(Q[w % 1000])
    for c in range(a.calls):
        q = Q[c % 1000]; t0 = pc(); fn(q); t[c] = pc() - t0
    return t

def rep(name, t):
    print(f"{name:11s} min={int(t.min())} ns  median={int(np.median(t))} ns  p99={int(np.percentile(t, 99))} ns")
    return float(np.median(t))

noop = Noop(); pc = time.perf_counter_ns
t = np.empty(a.calls, np.int64)
for c in range(a.calls): t0 = pc(); t[c] = pc() - t0
m_timer = rep("timer_only", t)
m_loop = rep("loop_noop", run(lambda q: noop.search(q, 10)))
res = {"timer_only_ns": m_timer, "loop_noop_ns": m_loop}
try:
    from scann_adapter import ScannAdapter
    d = tempfile.mkdtemp(prefix="py_overhead_")
    try:
        ScannAdapter().build(Q[:1].copy(), {"mode": "brute"}, 1, 42, d)
        ad = ScannAdapter(); ad.load(d, None, {"mode": "brute"}); ad.set_search({})
        m_sc = rep("scann_1pt", run(lambda q: ad.search(q, 1)))
        res["scann_1pt_ns"] = m_sc
    finally:
        shutil.rmtree(d, ignore_errors=True)
except Exception as e:
    print("scann_1pt skipped:", e)
print("harness overhead (loop_noop - timer_only): %d ns/call" % (m_loop - m_timer))
if "scann_1pt_ns" in res: print("scann wrapper + pybind (scann_1pt - timer_only): %d ns/call" % (res["scann_1pt_ns"] - m_timer))
