"""ScaNN adapter, same semantics as adapter.h (DESIGN.md section 5): build / load / set_search / search / files / info.

Pinned: scann==1.4.2 (requirements-scann-*.lock, hashes). Wheels exist for Linux x86_64 and aarch64 (CPython 3.9-3.13),
none for macOS. Metric: dot_product on unit vectors; scores are dot products (higher = better).
Modes (PAPER_PLAN section 8, ScaNN's configuration guide; `mode` build param, default by corpus size n):
  brute    n < 20,000        score_brute_force
  ah       20,000 <= n < 100,000   score_ah + reorder, no partitioning
  tree_ah  n >= 100,000      tree + score_ah + reorder (SOAR optional)
Build params: mode, leaves ("sqrt" | "2sqrt" | int; default "sqrt"), soar (0|1; lambda 1.5, overretrieve 2.0 as in the
ScaNN README), ah_dims (dimensions per block, default 2), aq_threshold (anisotropic threshold, default 0.2),
reorder (reorder depth stored in the index, default 100), train_sample (default min(n, 250000)).
Search params: leaves_to_search (tree_ah), reorder (pre-reorder candidates; <= 0 keeps the build value).
Threads: set_n_training_threads for the build; one thread for search. Seed: the Python API has no seed; k-means
starts from ScaNN's internal state, so a rebuild may differ (scann_test.py compares two builds and reports it).
The serialised index holds the original float32 vectors (the reorder stage needs them): keeps_originals() is True
for modes with reorder and for brute force.
"""
import math
import os

import numpy as np
import scann


class ScannAdapter:
    family = "scann"

    def __init__(self):
        self.searcher = None
        self.mode = None
        self.n = 0
        self.search_params = {}
        self.build_params = {}

    # -- helpers
    @staticmethod
    def _mode(n, p):
        m = str(p.get("mode", "auto"))
        if m != "auto":
            return m
        return "brute" if n < 20000 else ("ah" if n < 100000 else "tree_ah")

    @staticmethod
    def _leaves(n, p):
        v = str(p.get("leaves", "sqrt"))
        if v == "sqrt":
            return max(2, int(round(math.sqrt(n))))
        if v == "2sqrt":
            return max(2, int(round(2 * math.sqrt(n))))
        return int(v)

    def keeps_originals(self):
        return True

    # -- adapter interface
    def build(self, x, params, threads, seed, dir):
        """x: float32 array n x d (unit vectors). Writes the serialised index into `dir` (exists, empty)."""
        x = np.ascontiguousarray(x, dtype=np.float32)
        n, d = x.shape
        mode = self._mode(n, params)
        reorder = int(params.get("reorder", 100))
        b = scann.scann_ops_pybind.builder(x, 10, "dot_product")
        b = b.set_n_training_threads(int(threads))
        sample = int(params.get("train_sample", min(n, 250000)))
        if mode == "brute":
            b = b.score_brute_force()
        else:
            if mode == "tree_ah":
                kw = {}
                if int(params.get("soar", 0)):
                    kw = dict(soar_lambda=1.5, overretrieve_factor=2.0)
                leaves = self._leaves(n, params)
                b = b.tree(num_leaves=leaves, num_leaves_to_search=min(leaves, 10),
                           training_sample_size=sample, **kw)
            elif mode != "ah":
                raise ValueError(f"scann: unknown mode {mode}")
            b = b.score_ah(int(params.get("ah_dims", 2)),
                           anisotropic_quantization_threshold=float(params.get("aq_threshold", 0.2)),
                           training_sample_size=sample)
            b = b.reorder(reorder)
        s = b.build()
        s.serialize(dir)
        del s

    def load(self, dir, x=None, build_params=None):
        self.searcher = scann.scann_ops_pybind.load_searcher(dir)
        self.searcher.set_num_threads(1)
        self.build_params = dict(build_params or {})
        self.n = int(self.searcher.size())
        self.mode = self._mode(self.n, self.build_params)
        self.set_search({})

    def set_search(self, params):
        self.search_params = dict(params)
        self._lts = int(params.get("leaves_to_search", -1))
        self._pre = int(params.get("reorder", -1))

    def search(self, q, k):
        """q: float32 vector (d). Returns (ids int64 array, scores float32 array), best first."""
        pre = max(self._pre, k) if self._pre > 0 else -1
        ids, sc = self.searcher.search(q, final_num_neighbors=k, pre_reorder_num_neighbors=pre,
                                       leaves_to_search=self._lts)
        return ids.astype(np.int64, copy=False), sc

    def files(self, dir):
        return sorted(os.path.join(dir, f) for f in os.listdir(dir) if os.path.isfile(os.path.join(dir, f)))

    def info(self):
        return {"library": "scann", "version": getattr(scann, "__version__", "1.4.2"),
                "mode": str(self.mode), "metric": "dot_product on unit vectors",
                "simd": "runtime dispatch inside the wheel (AVX2 / AVX-512 / NEON by CPU)"}
