"""ctypes wrapper for rivals-rs (NextPlaid and NumKong native batch scorers).

Library: env SS_RIVALS_RS, else rivals-rs/target/release/librivals_rs.{dylib,so}.

Return conventions (all float64, one value per candidate doc):
  nextplaid_scores     MEAN over query tokens of the per-token max RAW dot product. next-plaid's
                       maxsim_score returns the SUM (f32, no normalisation, no clamp); this wrapper divides
                       by nq. Feed it unit-norm vectors to get mean cosine. Non-finite maxima are skipped
                       by the library (they add 0 to the sum).
  numkong_scores_raw   what NumKong returns: SUM over query tokens of angular distance (1 - cos, clamped
                       at 0 per token). NumKong normalises internally; feed raw or unit vectors.
  numkong_scores       (nq - raw) / nq = mean over query tokens of min(max cosine, 1). Comparable to
                       the other arms; best token chosen by an int8 coarse screen (approximate).

Thread pools: native rayon pool is built once per library on the first threads > 1 call and keyed by that
first size; later calls with a different size reuse it. threads <= 1 runs on the calling thread.
Packing (numkong_pack*) and pointer-array building (prepare_*) belong OUTSIDE any timer.
"""
import ctypes
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_u32, _vp = ctypes.c_uint32, ctypes.c_void_p
_lib = None
DTYPES = {'f32': 0, 'f16': 1, 'bf16': 2}


def _load():
    global _lib
    if _lib is None:
        ext = 'dylib' if sys.platform == 'darwin' else 'so'
        path = os.environ.get('SS_RIVALS_RS') or os.path.join(HERE, 'rivals-rs', 'target', 'release', f'librivals_rs.{ext}')
        lib = ctypes.CDLL(path)
        lib.rv_build_info.restype = ctypes.c_char_p
        lib.rv_build_info.argtypes = []
        lib.rv_nextplaid_scores.restype = None
        lib.rv_nextplaid_scores.argtypes = [_vp, _u32, _u32, _u32, _vp, _vp, _u32, _vp]
        lib.rv_numkong_pack.restype = _vp
        lib.rv_numkong_pack.argtypes = [_u32, _vp, _u32, _u32]
        lib.rv_numkong_free.restype = None
        lib.rv_numkong_free.argtypes = [_vp]
        lib.rv_numkong_scores.restype = None
        lib.rv_numkong_scores.argtypes = [_vp, _u32, _vp, _u32, _vp]
        _lib = lib
    return _lib


def build_info():
    return _load().rv_build_info().decode()


class NextPlaidPrepared:
    """Untimed setup: contiguous f32 buffers plus the pointer/length arrays. run(threads) is the timed part."""

    def __init__(self, qn, docs):
        self.q = np.ascontiguousarray(qn, dtype=np.float32)
        self.docs = [np.ascontiguousarray(d, dtype=np.float32) for d in docs]
        self.nq, self.dim = self.q.shape
        self.n = len(self.docs)
        self.ptrs = (ctypes.c_void_p * self.n)(*[d.ctypes.data for d in self.docs])
        self.lens = np.array([d.shape[0] for d in self.docs], np.uint32)
        self.out = np.empty(self.n, np.float64)

    def run(self, threads=1):
        _load().rv_nextplaid_scores(self.q.ctypes.data, self.nq, self.dim, self.n, ctypes.addressof(self.ptrs),
                                    self.lens.ctypes.data, int(threads), self.out.ctypes.data)
        return self.out / self.nq  # fresh array: mean over query tokens


def nextplaid_scores(qn, docs, threads=1):
    return NextPlaidPrepared(qn, docs).run(threads)


class NumKongPacked:
    def __init__(self, arr, dtype):
        a = np.ascontiguousarray(arr, dtype=np.float32)
        self.n, self.dim = a.shape
        self.handle = _load().rv_numkong_pack(DTYPES[dtype], a.ctypes.data, self.n, self.dim)
        if not self.handle:
            raise ValueError(f'bad dtype {dtype}')

    def __del__(self):
        if getattr(self, 'handle', None) and _lib is not None:
            _lib.rv_numkong_free(self.handle)
            self.handle = None


def numkong_pack(arr, dtype='f32'):
    return NumKongPacked(arr, dtype)


class NumKongPrepared:
    def __init__(self, qn, docs, dtype='f32'):
        self.q = numkong_pack(qn, dtype)
        self.docs = [numkong_pack(d, dtype) for d in docs]
        self.n = len(self.docs)
        self.ptrs = (ctypes.c_void_p * self.n)(*[d.handle for d in self.docs])
        self.out = np.empty(self.n, np.float64)

    def run_raw(self, threads=1):
        _load().rv_numkong_scores(self.q.handle, self.n, ctypes.addressof(self.ptrs), int(threads), self.out.ctypes.data)
        return self.out.copy()

    def run(self, threads=1):
        return (self.q.n - self.run_raw(threads)) / self.q.n


def numkong_scores_raw(qn, docs, dtype='f32', threads=1):
    return NumKongPrepared(qn, docs, dtype).run_raw(threads)


def numkong_scores(qn, docs, dtype='f32', threads=1):
    return NumKongPrepared(qn, docs, dtype).run(threads)
