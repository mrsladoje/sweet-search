# Scoring contracts and their float64 references (PAPER_PLAN.md section 4).
#
# Notation: q_i raw query token (float32 as stored), d̂_j = nibble × sc + mn (decoded doc
# token), n_j stored pre-quantization norm, EPS = 1e-8. A score is the mean over query
# tokens i of a per-token value:
#
#   S     max_j dot(q_i, d̂_j) / (‖q_i‖·n_j + EPS), then max(0, ·)   production kernel, all sweet paths
#   Spre  max_j dot(q_i/‖q_i‖, d̂_j/(n_j + EPS)), max(0, ·) per arm   NumPy, PyTorch, maxsim-cpu, NextPlaid, colbert-ai
#   C     max_j cos(x_i, y_j) of the vectors the arm receives (the     NumKong
#         Spre arrays cast to the arm's type), no clamp
#   Spre-pad0  Spre, but every doc shorter than the call's longest     PyLate (colbert_scores, CPU torch path:
#         doc also gets max(0, ·): zero padding times the doc mask      scores * documents_mask, then max)
#         gives padded positions the score 0 (a call-dependent clamp)
#
# C is NumKong 7.8.5's cosine, read from its source (include/numkong/maxsim/serial.h,
# neonsdot.h): cos = dot · (1/‖x‖) · (1/‖y‖), no epsilon; a zero-norm vector has inverse
# norm 0, so its cosine is 0 (not NaN); angular = max(1 − cos, 0) caps cos at 1; negative
# cosines stay (an opposite pair gives −1). Its kernel picks each query token's best doc
# token with an int8 screen and refines only that token: that approximation is measured
# against reference (a) of contract C.
#
# Two references per rival arm (both float64):
#   (b) the contract on data decoded in float64 straight from the raw nibbles;
#   (a) the same formula on the arm's ACTUAL input arrays: the Spre arrays the harness
#       builds in float32 (spre_inputs, the only builder of rival inputs), cast to the
#       arm's precision. arm vs (a) = implementation error; (a) − (b) = input rounding.
# Contract effects (S vs Spre, clamp vs none, S vs C) compare (b) with (b). For S arms the
# input is the raw storage itself, so (a) = (b).
#
# python3 contracts.py --ensure <set-dir> [<set-dir> ...]   build or refresh the caches
#
# Cache: <set>/refs-v2/<subdir>/<variant>.f64 (little-endian float64, the docs of every
# call in load order) + <set>/refs-v2/index.json (set hash, rules, variants, per call:
# "<subdir>/<file>" -> [offset, count]). Valid only for the set hash it records.
import json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from replay_py import load_set  # noqa: E402
from set_manifest import set_hash  # noqa: E402

EPS = 1e-8
RULES = 'v2.1 (C inputs cast by numkong): S eps on the norm product; Spre eps on doc norm, f32 prescale; C numkong-7.8.5 (inv-norm 0 for zero vectors, cap 1, no eps)'
PRECISIONS = ('f32', 'f16', 'bf16')
VARIANTS = ('S-clamp', 'S-noclamp', 'Spre-b-clamp', 'Spre-b-noclamp', 'C-b-noclamp', 'Spre-pad0-b-noclamp', 'Spre-pad0-a-f32-noclamp') + tuple(
    v for p in PRECISIONS for v in (f'Spre-a-{p}-clamp', f'Spre-a-{p}-noclamp', f'C-a-{p}-noclamp'))


def variant(contract, clamp, precision=None, which='a'):
    """Cache name of the reference an arm is checked against."""
    c = 'clamp' if clamp else 'noclamp'
    if contract == 'S':
        return f'S-{c}'
    return f'{contract}-b-{c}' if which == 'b' else f'{contract}-a-{precision}-{c}'


# ---- inputs

def decode64(c, dim):
    """Doc tokens decoded in float64 from the raw nibbles / bytes: nibble × sc + mn."""
    nt = c['nt']
    if c['kind'] == 'int4':
        b = c['raw'].reshape(nt, (dim + 1) // 2)
        nib = np.empty((nt, b.shape[1] * 2), np.uint8); nib[:, 0::2] = b & 15; nib[:, 1::2] = b >> 4
        v = nib[:, :dim].astype(np.float64)
    else:
        v = c['raw'].view(np.int8).reshape(nt, dim).astype(np.float64) + 128
    return v * c['sc'].astype(np.float64)[:, None] + c['mn'].astype(np.float64)[:, None]


def dequant_norm32(c, dim):
    """Rival doc input: decoded in float32 as a float32 pipeline would, divided by n + EPS."""
    nt = c['nt']
    if c['kind'] == 'int4':
        b = c['raw'].reshape(nt, (dim + 1) // 2)
        nib = np.empty((nt, b.shape[1] * 2), np.uint8); nib[:, 0::2] = b & 15; nib[:, 1::2] = b >> 4
        f = nib[:, :dim].astype(np.float32) * c['sc'][:, None] + c['mn'][:, None]
    else:
        f = (c['raw'].view(np.int8).reshape(nt, dim).astype(np.float32) + 128) * c['sc'][:, None] + c['mn'][:, None]
    return np.ascontiguousarray(f / (c['nr'][:, None] + np.float32(EPS)), dtype=np.float32)


def to_bf16(a):
    """float32 -> bfloat16 values (round to nearest even), returned as float32."""
    u = np.ascontiguousarray(a, np.float32).view(np.uint32).astype(np.uint64)
    r = ((u + 0x7FFF + ((u >> 16) & 1)) >> 16) << 16
    return r.astype(np.uint32).view(np.float32).reshape(np.shape(a))


def cast(a, precision):
    """The values an arm of this precision receives (float32 container for bf16)."""
    if precision == 'f32':
        return a
    if precision == 'f16':
        return a.astype(np.float16)
    if precision == 'bf16':
        return to_bf16(a)
    raise ValueError(precision)


def cast_numkong(a, precision):
    """The values NumKong receives after its own nk.astype cast. Its bf16 cast is not round
    to nearest even for |x| < 2^-17 (it rounds toward zero there; check_inputs.py), so
    contract C's reference (a) uses NumKong's cast itself."""
    if precision == 'f32':
        return a
    try:
        import numkong as nk
    except ImportError:
        return cast(a, precision)
    x = np.ascontiguousarray(a, np.float32)
    return np.asarray(nk.astype(nk.astype(x, {'bf16': 'bfloat16', 'f16': 'float16'}[precision]), 'float32'), np.float32).reshape(x.shape)


def spre_inputs(call, precision='f32', caster=None):
    """The rival input arrays: query L2-normalized in float32, docs from dequant_norm32,
    then cast. bench.py builds every rival input through this function."""
    q = call['q']
    with np.errstate(invalid='ignore', divide='ignore'):
        qn = np.ascontiguousarray(q / np.linalg.norm(q, axis=1, keepdims=True), dtype=np.float32)
    docs = [dequant_norm32(c, call['dim']) for c in call['cands']]
    if precision == 'f32':
        return qn, docs
    caster = caster or cast
    return caster(qn, precision), [caster(d, precision) for d in docs]


# ---- per-token maxima, float64

def _pt_max(Q, docs, norms=None, chunk=1 << 16):
    """Per doc: (dot maximum, cosine maximum) per query token, float64 [nq] each.
    norms given: the dot is contract S's dot / (‖q‖·n + EPS), and no cosine is computed."""
    qn = np.sqrt((Q * Q).sum(1))
    inv_q = np.divide(1.0, qn, out=np.zeros_like(qn), where=qn > 0)
    dots, coss = [], []
    for i, D in enumerate(docs):
        if D.shape[0] == 0:
            dots.append(np.full(Q.shape[0], np.nan)); coss.append(np.full(Q.shape[0], np.nan)); continue
        bd = np.full(Q.shape[0], -np.inf); bc = np.full(Q.shape[0], -np.inf)
        for s in range(0, D.shape[0], chunk):
            Dc = D[s:s + chunk]
            M = Q @ Dc.T
            if norms is not None:
                bd = np.maximum(bd, (M / (qn[:, None] * norms[i][s:s + chunk][None, :] + EPS)).max(1))
                continue
            bd = np.maximum(bd, M.max(1))
            dn = np.sqrt((Dc * Dc).sum(1))
            inv_d = np.divide(1.0, dn, out=np.zeros_like(dn), where=dn > 0)
            bc = np.maximum(bc, np.minimum(M * inv_q[:, None] * inv_d[None, :], 1.0).max(1))
        dots.append(bd); coss.append(bc)
    return dots, coss


def reduce(per_token, clamp):
    """Mean over query tokens, with or without max(0, ·)."""
    return np.array([(np.maximum(m, 0) if clamp else m).mean() for m in per_token])


def reduce_pad0(per_token, lens):
    """Spre-pad0: docs shorter than the longest one in the call get max(0, ·)."""
    L = max(lens) if lens else 0
    return np.array([(np.maximum(m, 0) if n < L else m).mean() for m, n in zip(per_token, lens)])


def refs_for_call(call):
    """Every cached variant for one call: {variant: float64[pool]}."""
    dim = call['dim']
    Q = call['q'].astype(np.float64)
    D = [decode64(c, dim) for c in call['cands']]
    N = [c['nr'].astype(np.float64) for c in call['cands']]
    out = {}
    s, _ = _pt_max(Q, D, N)
    out['S-clamp'], out['S-noclamp'] = reduce(s, True), reduce(s, False)
    with np.errstate(invalid='ignore', divide='ignore'):
        Qn = Q / np.sqrt((Q * Q).sum(1))[:, None]
    p, c = _pt_max(Qn, [d / (n[:, None] + EPS) for d, n in zip(D, N)])
    lens = [c['nt'] for c in call['cands']]
    out['Spre-b-clamp'], out['Spre-b-noclamp'], out['C-b-noclamp'] = reduce(p, True), reduce(p, False), reduce(c, False)
    out['Spre-pad0-b-noclamp'] = reduce_pad0(p, lens)
    for prec in PRECISIONS:
        qa, da = spre_inputs(call, prec)
        p, c = _pt_max(qa.astype(np.float64), [d.astype(np.float64) for d in da])
        if prec == 'f32':
            out['Spre-pad0-a-f32-noclamp'] = reduce_pad0(p, lens)
        else:
            qk, dk = spre_inputs(call, prec, cast_numkong)
            _, c = _pt_max(qk.astype(np.float64), [d.astype(np.float64) for d in dk])
        out[f'Spre-a-{prec}-clamp'], out[f'Spre-a-{prec}-noclamp'], out[f'C-a-{prec}-noclamp'] = reduce(p, True), reduce(p, False), reduce(c, False)
    return out


# ---- the per-set cache

def _cache_dir(root):
    return os.path.join(root, 'refs-v2')


def ensure(root, log=print):
    """Build the reference cache of a set if it is missing or was built for other data."""
    h = set_hash(root)
    idx_path = os.path.join(_cache_dir(root), 'index.json')
    if os.path.exists(idx_path):
        idx = json.load(open(idx_path))
        if idx.get('set_hash') == h and tuple(idx.get('variants', ())) == VARIANTS and idx.get('rules') == RULES:
            return idx
    calls = load_set(root)
    files, buf, pos = {}, {}, {}
    for call in calls:
        r = refs_for_call(call)
        sub = call['repo']
        o = pos.get(sub, 0)
        for v in VARIANTS:
            buf.setdefault((sub, v), []).append(r[v])
        files[f"{sub}/{call['file']}"] = [o, len(call['cands'])]
        pos[sub] = o + len(call['cands'])
    for (sub, v), parts in buf.items():
        d = os.path.join(_cache_dir(root), sub); os.makedirs(d, exist_ok=True)
        tmp = os.path.join(d, v + '.f64.tmp')
        np.concatenate(parts).astype('<f8').tofile(tmp); os.replace(tmp, os.path.join(d, v + '.f64'))
    idx = dict(version=2, set_hash=h, eps=EPS, rules=RULES, variants=list(VARIANTS), calls=files)
    tmp = idx_path + '.tmp'
    json.dump(idx, open(tmp, 'w')); os.replace(tmp, idx_path)
    log(f'refs-v2 built: {root} ({len(calls)} calls)')
    return idx


class Refs:
    """Reader of one set's cache (the benchmark side). It never computes; ensure() runs
    first, in its own process, before any timing."""

    def __init__(self, root):
        self.root = root
        self.idx = json.load(open(os.path.join(_cache_dir(root), 'index.json')))
        self.arr = {}

    def get(self, call, name):
        o, n = self.idx['calls'][f"{call['repo']}/{call['file']}"]
        key = (call['repo'], name)
        if key not in self.arr:
            self.arr[key] = np.fromfile(os.path.join(_cache_dir(self.root), call['repo'], name + '.f64'), '<f8')
        return self.arr[key][o:o + n]


if __name__ == '__main__':
    if sys.argv[1:2] != ['--ensure']:
        sys.exit('usage: contracts.py --ensure <set-dir> ...')
    for r in sys.argv[2:]:
        ensure(r)
