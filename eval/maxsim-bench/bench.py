# venv/bin/python -I bench.py --arm NAME --out FILE.json --set DIR [--set DIR ...] [options]
#
# Times ONE MaxSim implementation ("arm") on every call of the given replay sets,
# in its own process (run_matrix.py runs the arms in alternating rounds). One arm
# per process means no other library's worker threads (OpenBLAS / OpenMP / rayon
# keep spinning after a call) compete with the arm being timed.
#
# Inputs, per call: our arms get the documents as stored by the index (int4 or
# int8 per token, with per-token min / scale / stored norms) and the raw query.
# Rival arms get their best case, prepared outside the timer by contracts.spre_inputs:
# every document decoded to f32 and divided by its stored norms, the query
# L2-normalized, cast to the arm's input type, plus the layout the arm prefers.
#
# Timing, per call: one untimed warm-up call, then --reps timed calls. Every timed
# repetition is kept (ts_ns); "ms" is their median. --gap-ms G busy-waits G ms on the
# calling thread before every timed call, so worker pools have parked ("pool-parked";
# it does not test cold caches or process start); 0 = back-to-back (warm).
#
# Accuracy, per call (section 4 of PAPER_PLAN.md): each arm has a scoring contract
# (S, Spre or C), a clamp flag and an input precision. err = max |arm − reference (a) of
# its own contract| (implementation error); err_input = max |(a) − (b)| (input rounding);
# top1 / top10 against (a); top1_S / top10_S = ranking agreement with the contract-S
# reference. References come from the per-set cache (contracts.py --ensure, run first).
#
# Output: JSON written atomically (tmp, then rename) with complete=true and the job
# key given by run_matrix.py; per call also repo / query_id / query_sha256 (from the
# set's provenance.jsonl) and, with --keep-scores or for beir-* sets, the scores.
import argparse, ctypes, json, os, platform, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from replay_py import load_set, load_provenance  # noqa: E402
import contracts  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--arm', required=True)
p.add_argument('--set', action='append', required=True)
p.add_argument('--out', required=True)
p.add_argument('--reps', type=int, default=5)
p.add_argument('--gap-ms', type=float, default=0.0)
p.add_argument('--limit', type=int, default=0, help='first N calls per set (0 = all)')
p.add_argument('--stride', type=int, default=1, help='every Nth call per set')
p.add_argument('--threads', type=int, default=0, help='arm thread count (0 = its default)')
p.add_argument('--prewarm-lead-us', type=float, default=0.0,
               help='ours only: call the pool prewarm, busy-wait this long (untimed: other work), then time the call; the prewarm call is timed too')
p.add_argument('--keep-scores', action='store_true', help='store every call\'s scores (always on for beir-* sets)')
p.add_argument('--job-key', default='', help='written into the output (run_matrix.py)')
p.add_argument('--list-arms', action='store_true')
# Imported as a module (concurrency.py, fixtures): defaults; the importer sets args.*.
if __name__ != '__main__':
    args = p.parse_args(['--arm', '-', '--set', '-', '--out', '-'])
elif '--list-arms' in sys.argv:
    args = p.parse_args(['--arm', '-', '--set', '-', '--out', '-', '--list-arms'])
else:
    args = p.parse_args()

HERE = os.path.dirname(os.path.abspath(__file__))
IS_X86 = platform.machine() in ('x86_64', 'AMD64')

# ---------------------------------------------------------------- arms
# An arm: build(call) -> run (prep untimed), run() -> mean-per-query-token scores.
# Registry entry: (build, contract, clamp, precision).

ARMS = {}


def arm(name, contract='Spre', clamp=False, precision='f32'):
    def reg(fn):
        ARMS[name] = (fn, contract, clamp, precision)
        return fn
    return reg


def rival_inputs(call, precision='f32'):
    key = 'in_' + precision
    if key not in call:
        call[key] = contracts.spre_inputs(call, precision)
    return call[key]


def packed(docs):
    lens = np.array([d.shape[0] for d in docs], np.int64)
    offs = np.concatenate([[0], np.cumsum(lens)[:-1]]).astype(np.int64)
    return np.ascontiguousarray(np.concatenate(docs)), lens, offs


def padded_repeat_last(docs):
    """[B, L, dim]: short docs repeat their last token, so every max stays exact (no mask)."""
    L = max(d.shape[0] for d in docs)
    return np.ascontiguousarray(np.stack([np.concatenate([d, np.repeat(d[-1:], L - d.shape[0], 0)]) if d.shape[0] < L else d for d in docs]))


# ---- ours: the production kernel source through a C ABI (capi/), same input as production
def _ours_lib():
    path = os.environ.get('SS_CAPI') or os.path.join(HERE, 'capi', 'target', 'release', 'libss_maxsim_capi' + ('.dylib' if sys.platform == 'darwin' else '.so'))
    lib = ctypes.CDLL(path)
    vp, u32 = ctypes.c_void_p, ctypes.c_uint32
    lib.ss_maxsim_per_token.argtypes = [vp, u32, u32, u32, u32, vp, vp, vp, vp, vp, vp]
    lib.ss_maxsim_per_token.restype = None
    lib.ss_maxsim_prewarm.argtypes = [u32]
    lib.ss_maxsim_prewarm.restype = None
    return lib


@arm('ours', contract='S', clamp=True, precision='int4')
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
    if args.prewarm_lead_us > 0:
        window = int(max(1000, args.prewarm_lead_us * 2))
        def before():
            t0 = time.perf_counter_ns(); lib.ss_maxsim_prewarm(window); t = time.perf_counter_ns() - t0
            busy(args.prewarm_lead_us / 1000)
            return t
        run.before = before
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


# ---- NumPy (BLAS: Accelerate on macOS, OpenBLAS in the Linux wheel, MKL in venv-mkl)
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


@arm('numpy_packed_f16', precision='f16')
def np_packed_f16(call):
    # float16 inputs and float16 matmul (NumPy has no f16 BLAS; kept only if not much
    # slower than f32 on dev).
    _np_threads(); qn, docs = rival_inputs(call, 'f16'); D, lens, offs = packed(docs); nq = qn.shape[0]
    S = np.empty((nq, D.shape[0]), np.float16)
    def run():
        np.matmul(qn, D.T, out=S)
        return np.maximum.reduceat(S, offs, axis=1).sum(0, dtype=np.float64) / nq
    return run


# ---- Same storage as ours: the rival dequantizes the int4 docs inside the timed call
# (vectorized NumPy: nibble unpack, * scale + min, / stored norm), then scores as above.
# Its arrays equal contracts.dequant_norm32 (checked by fixtures_contracts.py).
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
    b = raw.reshape(-1, (dim + 1) // 2)
    nib = np.empty((b.shape[0], b.shape[1] * 2), np.uint8); nib[:, 0::2] = b & 15; nib[:, 1::2] = b >> 4
    f = nib[:, :dim].astype(np.float32); f *= sc[:, None]; f += mn[:, None]; f /= (nr[:, None] + np.float32(1e-8))
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


def _tdt(torch, precision):
    return torch.bfloat16 if precision == 'bf16' else torch.float32


def _t_pad_flat(precision):
    def build(call):
        torch = _torch(); qn, docs = rival_inputs(call); dt = _tdt(torch, precision)
        Dp = torch.from_numpy(padded_repeat_last(docs)).to(dt); qt = torch.from_numpy(qn).to(dt); nq = qn.shape[0]
        B, L, d = Dp.shape; Df = Dp.view(B * L, d)
        def run():
            with torch.inference_mode():
                return ((Df @ qt.T).view(B, L, nq).amax(1).sum(-1, dtype=torch.float64) / nq).numpy()
        return run
    return build


def _t_pad_bmm(precision):
    def build(call):
        torch = _torch(); qn, docs = rival_inputs(call); dt = _tdt(torch, precision)
        Dp = torch.from_numpy(padded_repeat_last(docs)).to(dt); qt = torch.from_numpy(qn).to(dt); nq = qn.shape[0]
        DpT = Dp.transpose(1, 2)
        def run():
            with torch.inference_mode():
                return (torch.matmul(qt, DpT).amax(-1).sum(-1, dtype=torch.float64) / nq).numpy()
        return run
    return build


ARMS['torch_pad_flat'] = (_t_pad_flat('f32'), 'Spre', False, 'f32')
ARMS['torch_pad_bmm'] = (_t_pad_bmm('f32'), 'Spre', False, 'f32')
# bf16 inputs, bf16 matmul (oneDNN uses AMX on Granite Rapids). torch's f32 -> bf16 cast
# rounds to nearest even, as contracts.to_bf16 does (checked by fixtures_contracts.py).
ARMS['torch_pad_flat_bf16'] = (_t_pad_flat('bf16'), 'Spre', False, 'bf16')
ARMS['torch_pad_bmm_bf16'] = (_t_pad_bmm('bf16'), 'Spre', False, 'bf16')


@arm('torch_pylate', contract='Spre-pad0')
def t_pylate(call):
    # pylate.scores.colbert_scores (1.6.0), its CPU path (flash / LIK need CUDA or MPS):
    # zero-padded docs, einsum, scores * documents_mask, max, sum. A padded position
    # scores 0, so a doc shorter than the call's longest one gets max(0, ·): contract
    # Spre-pad0 (contracts.py).
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


# ---- NextPlaid (next-plaid 1.8.5 maxsim::maxsim_score, raw dot, no clamp; rivals-rs shim):
# a Rust loop over the candidates, on the calling thread (@t1) or a rayon pool.
@arm('nextplaid')
def nextplaid(call):
    import rivals_rs
    qn, docs = rival_inputs(call); prep = rivals_rs.NextPlaidPrepared(qn, docs)
    threads = args.threads or os.cpu_count()
    return lambda: prep.run(threads)


# ---- NumKong (approximate: int8 screen + refinement; returns the sum of 1 - cos).
# "numkong_<dt>": the tested Python interface, one maxsim_packed call per doc on a Python
# thread pool. "numkong_native_<dt>": the same C kernel, looped over the docs in Rust
# (rivals-rs), so no Python cost per doc.
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


def _nk_native(dtype):
    def build(call):
        import rivals_rs
        qn, docs = rival_inputs(call)
        prep = rivals_rs.NumKongPrepared(qn, docs, dtype)
        threads = args.threads or os.cpu_count()
        return lambda: prep.run(threads)
    return build


for _dt in ('bf16', 'f16', 'f32'):
    ARMS[f'numkong_{_dt}'] = (_nk_arm(_dt), 'C', False, _dt)
    ARMS[f'numkong_native_{_dt}'] = (_nk_native(_dt), 'C', False, _dt)

# ---------------------------------------------------------------- run

def busy(ms):
    end = time.perf_counter() + ms / 1000
    while time.perf_counter() < end:
        pass


def env_info():
    info = dict(arm=args.arm, threads=args.threads, reps=args.reps, gap_ms=args.gap_ms, sets=args.set,
                platform=platform.platform(), machine=platform.machine(), python=sys.version.split()[0],
                cpu_count=os.cpu_count(), numpy=np.__version__, started=time.strftime('%Y-%m-%dT%H:%M:%S'),
                loadavg=os.getloadavg(), instance=os.environ.get('SS_INSTANCE_ID', platform.node()))
    try:
        import subprocess
        info['cpu'] = subprocess.run(['sysctl', '-n', 'machdep.cpu.brand_string'] if sys.platform == 'darwin' else ['sh', '-c', "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2"], capture_output=True, text=True).stdout.strip()
    except Exception:
        pass
    for mod in ('torch', 'maxsim_cpu', 'numkong', 'threadpoolctl', 'rivals_rs'):
        m = sys.modules.get(mod)
        if m is not None:
            info[mod] = getattr(m, '__version__', 'loaded')
    if 'rivals_rs' in sys.modules:
        info['rivals_rs'] = sys.modules['rivals_rs'].build_info()
    try:
        from threadpoolctl import threadpool_info
        info['threadpools'] = [{k: v for k, v in t.items() if k in ('internal_api', 'version', 'num_threads', 'filepath', 'threading_layer')} for t in threadpool_info()]
    except Exception:
        pass
    return info


def agree(ref, got):
    order_ref = np.argsort(-ref, kind='stable'); order_got = np.argsort(-got, kind='stable')
    k = min(10, len(got))
    top1 = bool(len(got) == 0 or order_ref[0] == order_got[0])
    top10 = (len(set(order_ref[:k]) & set(order_got[:k])) / k) if k else 1.0
    return top1, top10


def main():
    build, contract, clamp, precision = ARMS[args.arm]
    ref_a = contracts.variant(contract, clamp, precision, 'a')
    ref_b = contracts.variant(contract, clamp, precision, 'b')
    out = dict(env=env_info(), arm=args.arm, contract=contract, clamp=clamp, precision=precision,
               ref_a=ref_a, ref_b=ref_b, job_key=args.job_key, complete=False, calls=[])
    for root in args.set:
        refs = contracts.Refs(root)
        prov = load_provenance(root)
        name = os.path.basename(root.rstrip('/'))
        keep = args.keep_scores or name.startswith('beir-')
        calls = load_set(root)[::args.stride]
        if args.limit:
            calls = calls[:args.limit]
        for call in calls:
            run = build(call)
            got = np.asarray(run(), np.float64).copy()  # warm-up (also the scores we check)
            ts = []
            for _ in range(args.reps):
                if args.gap_ms > 0:
                    busy(args.gap_ms)
                extra = run.before() if hasattr(run, 'before') else 0
                t0 = time.perf_counter_ns(); run(); ts.append(time.perf_counter_ns() - t0 + extra)
            ra, rb, rs = refs.get(call, ref_a), refs.get(call, ref_b), refs.get(call, 'S-clamp')
            top1, top10 = agree(ra, got)
            top1_S, top10_S = agree(rs, got)
            pv = prov.get((call['repo'], call['file']), {})
            rec = dict(set=name, repo=call['repo'], file=call['file'], query_id=pv.get('query_id'), query_sha256=pv.get('query_sha256'),
                       nq=call['nq'], pool=len(call['cands']), tokens=int(sum(c['nt'] for c in call['cands'])),
                       ms=float(np.median(ts)) / 1e6, ts_ns=ts,
                       err=float(np.abs(got - ra).max()) if len(got) else 0.0,
                       err_input=float(np.abs(ra - rb).max()) if len(got) else 0.0,
                       top1=top1, top10=top10, top1_S=top1_S, top10_S=top10_S)
            if keep:
                rec['scores'] = got.tolist()
            out['calls'].append(rec)
            if os.environ.get('SS_TEST_SLEEP_MS'):  # test_harness.sh only: time to kill an arm mid-run
                time.sleep(float(os.environ['SS_TEST_SLEEP_MS']) / 1000)
            for k in [k for k in call if k.startswith('in_')]:
                call.pop(k)
    out['env'].update({k: v for k, v in env_info().items() if k in ('torch', 'maxsim_cpu', 'numkong', 'threadpools', 'rivals_rs')})
    out['env']['loadavg_end'] = os.getloadavg(); out['env']['ended'] = time.strftime('%Y-%m-%dT%H:%M:%S')
    out['complete'] = True
    out['n_calls'] = len(out['calls'])
    tmp = args.out + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(out, f)
    os.replace(tmp, args.out)
    lat = sorted(c['ms'] for c in out['calls'])
    print(f"{args.arm} threads={args.threads or 'default'} gap={args.gap_ms}ms calls={len(lat)} p50={lat[len(lat)//2]:.4f} ms "
          f"total={sum(lat):.1f} ms max|err|={max(c['err'] for c in out['calls']):.2e} top1_S={np.mean([c['top1_S'] for c in out['calls']])*100:.2f}%")


if __name__ == '__main__':
    if args.list_arms:
        for n, (_, c, cl, pr) in ARMS.items():
            print(f'{n}\t{c}\t{"clamp" if cl else "noclamp"}\t{pr}')
    else:
        main()
