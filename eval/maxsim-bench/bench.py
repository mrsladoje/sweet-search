# venv/bin/python -I bench.py --arm NAME --out FILE.json --set DIR [--set DIR ...] [options]
#
# Times ONE MaxSim implementation ("arm") on every call of the given replay sets,
# in its own process (run_matrix.py runs the arms in alternating rounds). One arm
# per process means no other library's worker threads (OpenBLAS / OpenMP / rayon
# keep spinning after a call) compete with the arm being timed.
#
# Inputs, per call: our arms get the documents as stored by the index (int4 or
# int8 per token, with per-token min / scale / stored norms) and the raw query.
# Rival arms get their best case, prepared outside the timer: every document
# dequantized to f32 and divided by its stored norms, the query L2-normalized,
# plus whatever layout the arm prefers (concatenated, padded, packed).
#
# Timing, per call: one untimed warm-up call, then --reps timed calls; the call's
# latency is their median. --gap-ms G busy-waits G ms on the calling thread before
# every timed call, so worker pools have parked (a cold call, as in production,
# where scoring follows other work); 0 = back-to-back (warm).
#
# Accuracy, per call: each arm's scores against a float64 reference of the same
# formula (mean over query tokens of the max cosine; "clamp" arms take max(0, .)
# per query token, as our kernel does), plus top-1 / top-10 agreement with it.
import argparse, ctypes, json, os, platform, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from replay_py import load_set  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--arm', required=True)
p.add_argument('--set', action='append', required=True)
p.add_argument('--out', required=True)
p.add_argument('--reps', type=int, default=5)
p.add_argument('--gap-ms', type=float, default=0.0)
p.add_argument('--limit', type=int, default=0, help='first N calls per set (0 = all)')
p.add_argument('--stride', type=int, default=1, help='every Nth call per set')
p.add_argument('--threads', type=int, default=0, help='arm thread count (0 = its default)')
args = p.parse_args()

HERE = os.path.dirname(os.path.abspath(__file__))
IS_X86 = platform.machine() in ('x86_64', 'AMD64')

# ---------------------------------------------------------------- arms
# An arm: prep(call) -> state (untimed), run(state) -> mean-per-query-token scores.

def dequant_norm(c, dim):
    """Doc tokens dequantized exactly as the index stores them, divided by the stored norms."""
    nt = c['nt']
    if c['kind'] == 'int4':
        b = c['raw'].reshape(nt, (dim + 1) // 2)
        nib = np.empty((nt, b.shape[1] * 2), np.uint8); nib[:, 0::2] = b & 15; nib[:, 1::2] = b >> 4
        f = nib[:, :dim].astype(np.float32) * c['sc'][:, None] + c['mn'][:, None]
    else:
        f = (c['raw'].view(np.int8).reshape(nt, dim).astype(np.float32) + 128) * c['sc'][:, None] + c['mn'][:, None]
    return np.ascontiguousarray(f / (c['nr'][:, None] + 1e-8), dtype=np.float32)


def rival_inputs(call):
    if 'docs' not in call:
        q = call['q']
        call['qn'] = np.ascontiguousarray(q / np.linalg.norm(q, axis=1, keepdims=True), dtype=np.float32)
        call['docs'] = [dequant_norm(c, call['dim']) for c in call['cands']]
    return call['qn'], call['docs']


def packed(docs):
    lens = np.array([d.shape[0] for d in docs], np.int64)
    offs = np.concatenate([[0], np.cumsum(lens)[:-1]]).astype(np.int64)
    return np.ascontiguousarray(np.concatenate(docs)), lens, offs


def padded_repeat_last(docs):
    """[B, L, dim]: short docs repeat their last token, so every max stays exact (no mask)."""
    L = max(d.shape[0] for d in docs)
    return np.ascontiguousarray(np.stack([np.concatenate([d, np.repeat(d[-1:], L - d.shape[0], 0)]) if d.shape[0] < L else d for d in docs]))


ARMS = {}


def arm(name, clamp=False):
    def reg(fn):
        ARMS[name] = (fn, clamp)
        return fn
    return reg


# ---- ours: the production kernel source through a C ABI (capi/), same input as production
def _ours_lib():
    path = os.environ.get('SS_CAPI') or os.path.join(HERE, 'capi', 'target', 'release', 'libss_maxsim_capi' + ('.dylib' if sys.platform == 'darwin' else '.so'))
    lib = ctypes.CDLL(path)
    vp, u32 = ctypes.c_void_p, ctypes.c_uint32
    lib.ss_maxsim_per_token.argtypes = [vp, u32, u32, u32, u32, vp, vp, vp, vp, vp, vp]
    lib.ss_maxsim_per_token.restype = None
    return lib


@arm('ours', clamp=True)
def ours(call):
    if args.threads:
        os.environ['SS_MAXSIM_THREADS'] = str(args.threads)  # read once, on first use
    lib = ours.lib = getattr(ours, 'lib', None) or _ours_lib()
    q = np.ascontiguousarray(call['q'], dtype=np.float32)
    cs = call['cands']
    bits = 4 if call['kind'] == 'int4' else 8
    keep = [q] + [a for c in cs for a in (c['raw'], c['mn'], c['sc'], c['nr'])]
    ptrs = [np.array([a.ctypes.data for a in arrs], np.uintp) for arrs in (
        [c['raw'] for c in cs], [c['mn'] for c in cs], [c['sc'] for c in cs], [c['nr'] for c in cs])]
    nts = np.array([c['nt'] for c in cs], np.uint32)
    out = np.empty(len(cs), np.float64)
    a = (q.ctypes.data, call['nq'], call['dim'], bits, len(cs), *[x.ctypes.data for x in ptrs], nts.ctypes.data, out.ctypes.data)
    def run(_keep=keep, _ptrs=ptrs, _nts=nts):
        lib.ss_maxsim_per_token(*a)
        return out
    return run


# ---- mixedbread maxsim-cpu (returns the SUM over query tokens; no clamp)
def _mx():
    if args.threads:
        os.environ['RAYON_NUM_THREADS'] = str(args.threads)
    import maxsim_cpu
    return maxsim_cpu


def _q_chunks(qn):
    # The x86 wheel (libxsmm JIT path) returns garbage for > 32 query tokens once a
    # doc block reaches 64 tokens (mixedbread-ai/maxsim-cpu#1; reproduced on our box).
    # Its correct use there is 32-token query chunks, whose sums add up exactly.
    if IS_X86 and qn.shape[0] > 32:
        return [np.ascontiguousarray(qn[i:i + 32]) for i in range(0, qn.shape[0], 32)]
    return [qn]


@arm('maxsim_cpu_variable')
def mx_variable(call):
    mx = _mx(); qn, docs = rival_inputs(call); qs = _q_chunks(qn); nq = qn.shape[0]
    def run():
        s = mx.maxsim_scores_variable(qs[0], docs)
        for qc in qs[1:]:
            s = s + mx.maxsim_scores_variable(qc, docs)
        return np.asarray(s, np.float64) / nq
    return run


@arm('maxsim_cpu_3d')
def mx_3d(call):
    mx = _mx(); qn, docs = rival_inputs(call); qs = _q_chunks(qn); nq = qn.shape[0]; Dp = padded_repeat_last(docs)
    def run():
        s = mx.maxsim_scores(qs[0], Dp)
        for qc in qs[1:]:
            s = s + mx.maxsim_scores(qc, Dp)
        return np.asarray(s, np.float64) / nq
    return run


# ---- NumPy (BLAS: Accelerate on macOS, OpenBLAS in the Linux wheel)
def _np_threads():
    if args.threads:
        from threadpoolctl import threadpool_limits
        _np_threads.limit = threadpool_limits(args.threads)


@arm('numpy_packed')
def np_packed(call):
    _np_threads(); qn, docs = rival_inputs(call); D, lens, offs = packed(docs); nq = qn.shape[0]
    S = np.empty((nq, D.shape[0]), np.float32)
    def run():
        np.matmul(qn, D.T, out=S)
        return np.maximum.reduceat(S, offs, axis=1).sum(0, dtype=np.float64) / nq
    return run


@arm('numpy_packed_t')
def np_packed_t(call):
    _np_threads(); qn, docs = rival_inputs(call); D, lens, offs = packed(docs); nq = qn.shape[0]
    S = np.empty((D.shape[0], nq), np.float32)
    def run():
        np.matmul(D, qn.T, out=S)
        return np.maximum.reduceat(S, offs, axis=0).sum(1, dtype=np.float64) / nq
    return run


@arm('numpy_perdoc')
def np_perdoc(call):
    _np_threads(); qn, docs = rival_inputs(call); nq = qn.shape[0]
    def run():
        return np.array([(qn @ d.T).max(1).sum(dtype=np.float64) for d in docs]) / nq
    return run


# ---- Same storage as ours: the rival dequantizes the int4 docs inside the timed call
# (vectorized NumPy: nibble unpack, * scale + min, / stored norm), then scores as above.
def _int4_store(call):
    """All docs' int4 bytes and per-token arrays concatenated, prepared outside the timer."""
    cs = call['cands']
    assert all(c['kind'] == 'int4' for c in cs)
    raw = np.concatenate([c['raw'] for c in cs]); mn = np.concatenate([c['mn'] for c in cs])
    sc = np.concatenate([c['sc'] for c in cs]); nr = np.concatenate([c['nr'] for c in cs])
    lens = np.array([c['nt'] for c in cs], np.int64)
    offs = np.concatenate([[0], np.cumsum(lens)[:-1]]).astype(np.int64)
    return raw, mn, sc, nr, lens, offs


def _dequant_all(raw, mn, sc, nr, dim):
    b = raw.reshape(-1, dim // 2)
    nib = np.empty((b.shape[0], dim), np.uint8); nib[:, 0::2] = b & 15; nib[:, 1::2] = b >> 4
    f = nib.astype(np.float32); f *= sc[:, None]; f += mn[:, None]; f /= (nr[:, None] + np.float32(1e-8))
    return f


@arm('numpy_packed_int4')
def np_packed_int4(call):
    _np_threads(); qn, _ = rival_inputs(call); raw, mn, sc, nr, lens, offs = _int4_store(call); nq, dim = qn.shape
    def run():
        D = _dequant_all(raw, mn, sc, nr, dim)
        return np.maximum.reduceat(qn @ D.T, offs, axis=1).sum(0, dtype=np.float64) / nq
    return run


@arm('maxsim_cpu_variable_int4')
def mx_variable_int4(call):
    mx = _mx(); qn, _ = rival_inputs(call); raw, mn, sc, nr, lens, offs = _int4_store(call); nq, dim = qn.shape; qs = _q_chunks(qn)
    def run():
        D = _dequant_all(raw, mn, sc, nr, dim)
        docs = np.split(D, offs[1:])
        s = mx.maxsim_scores_variable(qs[0], docs)
        for qc in qs[1:]:
            s = s + mx.maxsim_scores_variable(qc, docs)
        return np.asarray(s, np.float64) / nq
    return run


# ---- PyTorch CPU (PyLate / colbert-ai / fast-plaid scoring paths)
def _torch():
    import torch
    if args.threads:
        torch.set_num_threads(args.threads)
    return torch


@arm('torch_pad_flat')
def t_pad_flat(call):
    torch = _torch(); qn, docs = rival_inputs(call); Dp = torch.from_numpy(padded_repeat_last(docs)); qt = torch.from_numpy(qn); nq = qn.shape[0]
    B, L, d = Dp.shape; Df = Dp.view(B * L, d)
    def run():
        with torch.inference_mode():
            return ((Df @ qt.T).view(B, L, nq).amax(1).sum(-1, dtype=torch.float64) / nq).numpy()
    return run


@arm('torch_pad_bmm')
def t_pad_bmm(call):
    torch = _torch(); qn, docs = rival_inputs(call); Dp = torch.from_numpy(padded_repeat_last(docs)); qt = torch.from_numpy(qn); nq = qn.shape[0]
    DpT = Dp.transpose(1, 2)
    def run():
        with torch.inference_mode():
            return (torch.matmul(qt, DpT).amax(-1).sum(-1, dtype=torch.float64) / nq).numpy()
    return run


@arm('torch_pylate')
def t_pylate(call):
    # pylate.scores.colbert_scores: zero-padded docs, einsum, mask multiply, max, sum.
    torch = _torch(); qn, docs = rival_inputs(call); nq = qn.shape[0]
    L = max(d.shape[0] for d in docs)
    Dz = torch.zeros(len(docs), L, qn.shape[1]); mask = torch.zeros(len(docs), L)
    for i, d in enumerate(docs):
        Dz[i, :d.shape[0]] = torch.from_numpy(d); mask[i, :d.shape[0]] = 1
    qt = torch.from_numpy(qn)[None]
    def run():
        with torch.inference_mode():
            s = torch.einsum('ash,bth->abst', qt, Dz) * mask[None, :, None, :]
            return (s.max(-1).values.sum(-1, dtype=torch.float64)[0] / nq).numpy()
    return run


_SEG = {}


def _segcpp():
    if 'ext' not in _SEG:
        # torch's extension builder runs `ninja` from PATH; use the venv's.
        os.environ['PATH'] = os.path.dirname(sys.executable) + os.pathsep + os.environ.get('PATH', '')
        from torch.utils.cpp_extension import load
        src = os.environ.get('COLBERT_SEGMAXSIM') or os.path.join(HERE, 'third_party', 'segmented_maxsim.cpp')
        _SEG['ext'] = load('segmented_maxsim_cpp', [src], extra_cflags=['-O3'], verbose=False)
    return _SEG['ext']


@arm('torch_colbert_packed', clamp=True)
def t_colbert(call):
    # colbert-ai colbert_score_packed: one GEMM over packed docs + segmented_maxsim C++
    # (zero-initialised maxima, so negative maxima clamp to 0, like ours).
    torch = _torch(); ext = _segcpp(); qn, docs = rival_inputs(call); D, lens, offs = packed(docs); nq = qn.shape[0]
    Dt = torch.from_numpy(D); qt = torch.from_numpy(qn); lt = torch.from_numpy(lens)
    def run():
        with torch.inference_mode():
            # segmented_maxsim_cpp already sums over query tokens: [ndocs].
            return (ext.segmented_maxsim_cpp(Dt @ qt.T, lt).to(torch.float64) / nq).numpy()
    return run


@arm('torch_segment_reduce')
def t_segred(call):
    torch = _torch(); qn, docs = rival_inputs(call); D, lens, offs = packed(docs); nq = qn.shape[0]
    Dt = torch.from_numpy(D); qt = torch.from_numpy(qn); lt = torch.from_numpy(lens)
    def run():
        with torch.inference_mode():
            return (torch.segment_reduce(Dt @ qt.T, 'max', lengths=lt, axis=0).sum(-1, dtype=torch.float64) / nq).numpy()
    return run


# ---- NumKong (approximate: int8 coarse screening + refinement; returns sum of 1 - cos)
def _nk_arm(dtype):
    def build(call):
        import numkong as nk
        qn, docs = rival_inputs(call); nq = qn.shape[0]
        # Inputs must already be in the packing dtype (nk.astype: one native pass).
        cast = (lambda a: a) if dtype == 'f32' else (lambda a: nk.astype(a, 'bfloat16' if dtype == 'bf16' else 'float16'))
        dps = [nk.maxsim_pack(cast(d), dtype=dtype) for d in docs]
        workers = args.threads or os.cpu_count()
        pool = _nk_arm.pool = getattr(_nk_arm, 'pool', None) or ThreadPoolExecutor(workers)
        slices = [dps[i::workers] for i in range(min(workers, len(dps)))]
        def part(sl, qp):
            return [nk.maxsim_packed(qp, d) for d in sl]
        def run():
            qp = nk.maxsim_pack(cast(qn), dtype=dtype)
            if len(slices) == 1:
                r = part(slices[0], qp)
            else:
                outs = list(pool.map(part, slices, [qp] * len(slices)))
                r = [None] * len(dps)
                for i, o in enumerate(outs):
                    r[i::len(slices)] = o
            return (nq - np.asarray(r, np.float64)) / nq
        return run
    return build


for _dt in ('bf16', 'f16', 'f32'):
    ARMS[f'numkong_{_dt}'] = (_nk_arm(_dt), False)

# ---------------------------------------------------------------- reference

def reference(call):
    """float64 scores of the same formula: per query token the max cosine, mean over tokens."""
    q = call['q'].astype(np.float64); qn = q / np.linalg.norm(q, axis=1, keepdims=True)
    raw, clamped = [], []
    for c in call['cands']:
        d = dequant_norm(c, call['dim']).astype(np.float64)
        m = (qn @ d.T).max(1)
        raw.append(m.mean()); clamped.append(np.maximum(m, 0).mean())
    return np.array(raw), np.array(clamped)

_REFS = {}


def reference_cached(root, call):
    """reference(call), cached per replay set in <set>/<repo>/refs.json (computed once)."""
    path = os.path.join(root, call['repo'], 'refs.json')
    if path not in _REFS:
        _REFS[path] = json.load(open(path)) if os.path.exists(path) else {}
    refs = _REFS[path]
    if call['file'] not in refs:
        raw, clamped = reference(call)
        refs[call['file']] = [raw.tolist(), clamped.tolist()]
        refs['__dirty__'] = True
    r = refs[call['file']]
    return np.array(r[0]), np.array(r[1])


def save_refs():
    for path, refs in _REFS.items():
        if refs.pop('__dirty__', False):
            tmp = path + '.tmp'
            json.dump(refs, open(tmp, 'w')); os.replace(tmp, path)

# ---------------------------------------------------------------- run

def busy(ms):
    end = time.perf_counter() + ms / 1000
    while time.perf_counter() < end:
        pass


def env_info():
    info = dict(arm=args.arm, threads=args.threads, reps=args.reps, gap_ms=args.gap_ms, sets=args.set,
                platform=platform.platform(), machine=platform.machine(), python=sys.version.split()[0],
                cpu_count=os.cpu_count(), numpy=np.__version__, started=time.strftime('%Y-%m-%dT%H:%M:%S'),
                loadavg=os.getloadavg())
    try:
        import subprocess
        info['cpu'] = subprocess.run(['sysctl', '-n', 'machdep.cpu.brand_string'] if sys.platform == 'darwin' else ['sh', '-c', "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2"], capture_output=True, text=True).stdout.strip()
    except Exception:
        pass
    for mod in ('torch', 'maxsim_cpu', 'numkong', 'threadpoolctl'):
        try:
            m = __import__(mod) if mod in sys.modules else None
            if m is not None:
                info[mod] = getattr(m, '__version__', 'loaded')
        except Exception:
            pass
    try:
        from threadpoolctl import threadpool_info
        info['threadpools'] = [{k: v for k, v in t.items() if k in ('internal_api', 'version', 'num_threads', 'filepath')} for t in threadpool_info()]
    except Exception:
        pass
    return info


def main():
    build, clamp = ARMS[args.arm]
    out = dict(env=env_info(), clamp=clamp, calls=[])
    for root in args.set:
        calls = load_set(root)[::args.stride]
        if args.limit:
            calls = calls[:args.limit]
        for call in calls:
            run = build(call)
            got = np.asarray(run(), np.float64)  # warm-up (also the scores we check)
            ts = []
            for _ in range(args.reps):
                if args.gap_ms > 0:
                    busy(args.gap_ms)
                t0 = time.perf_counter_ns(); run(); ts.append(time.perf_counter_ns() - t0)
            ts.sort()
            ref_raw, ref_clamp = reference_cached(root, call)
            ref = ref_clamp if clamp else ref_raw
            err = float(np.abs(got - ref).max()) if len(got) else 0.0
            order_ref = np.argsort(-ref_clamp, kind='stable'); order_got = np.argsort(-got, kind='stable')
            k = min(10, len(got))
            out['calls'].append(dict(set=os.path.basename(root.rstrip('/')), file=call['file'], nq=call['nq'], pool=len(call['cands']),
                                     tokens=int(sum(c['nt'] for c in call['cands'])), ms=ts[len(ts) // 2] / 1e6,
                                     err=err, top1=bool(len(got) == 0 or order_ref[0] == order_got[0]),
                                     top10=(len(set(order_ref[:k]) & set(order_got[:k])) / k) if k else 1.0))
            call.pop('docs', None); call.pop('qn', None)
    save_refs()
    out['env'].update({k: v for k, v in env_info().items() if k in ('torch', 'maxsim_cpu', 'numkong', 'threadpools')})
    out['env']['loadavg_end'] = os.getloadavg(); out['env']['ended'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    json.dump(out, open(args.out, 'w'))
    lat = sorted(c['ms'] for c in out['calls'])
    print(f"{args.arm} threads={args.threads or 'default'} gap={args.gap_ms}ms calls={len(lat)} p50={lat[len(lat)//2]:.4f} ms "
          f"total={sum(lat):.1f} ms max|err|={max(c['err'] for c in out['calls']):.2e} top1={np.mean([c['top1'] for c in out['calls']])*100:.2f}%")


main()
