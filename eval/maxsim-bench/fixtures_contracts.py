# venv/bin/python -I fixtures_contracts.py [--arms a,b,...] [--keep DIR]
#
# Contract fixtures (PAPER_PLAN.md section 4), independent of the benchmark code: the
# cases are built byte by byte with struct, the expected values come from plain Python
# loops in float64 (no NumPy in any formula, nothing imported from bench.py or
# contracts.py). The script writes the cases as a replay set, then runs every arm through
# the real entry points (bench.py / bench-node.mjs, as black boxes, --keep-scores) and the
# reference cache builder (contracts.py --ensure), and compares each with its contract.
#
# Cases: a negative best match (every cosine < 0); an opposite pair (cosine -1); unequal
# norms (stored norm 1.10 x the decoded norm); a zero query token; a constant doc token
# (max == min: scale 0, nibbles 0); a zero doc vector; ragged candidates (1, 3, 17, 64
# tokens in one call, to catch padding effects); dims 96, 128 and 127 (odd).
#
# Outcome per arm and case: pass (within the arm's bound), FAIL, "undefined input" (the
# zero query token makes the Spre / C inputs NaN: informational for those arms), or
# "unsupported" (the arm rejects the input, e.g. an odd dim; recorded, not a pass). An arm
# whose library is not installed here (every case: ModuleNotFoundError) is "not available".
# Exit 0 only if no arm FAILs and contracts.py matches every expected value to 1e-12.
import argparse, json, math, os, random, shutil, struct, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
import platform  # noqa: E402
MACH = 'arm64' if platform.machine() in ('arm64', 'aarch64') else 'x86_64'
EPS = 1e-8

p = argparse.ArgumentParser()
p.add_argument('--arms', default='')
p.add_argument('--keep', default='')
a = p.parse_args()


def f32(x):
    return struct.unpack('<f', struct.pack('<f', x))[0]


# ---------------------------------------------------------------- case builders
# A doc token is (nibbles[dim], mn, sc, n): decoded d_k = nib_k * sc + mn (float32 mn, sc).

def tok_from_values(vals, n=None):
    """Exact int4 token for values on a grid: mn = min, sc = step; n = decoded norm unless given."""
    lo = min(vals); hi = max(vals)
    if hi == lo:
        return dict(nib=[0] * len(vals), mn=f32(lo), sc=0.0, n=f32(n if n is not None else math.sqrt(sum(v * v for v in vals))))
    sc = f32((hi - lo) / 15)
    mn = f32(lo)
    nib = [max(0, min(15, int(math.floor((v - mn) / sc + 0.5)))) for v in vals]
    dec = [k * sc + mn for k in nib]
    return dict(nib=nib, mn=mn, sc=sc, n=f32(n if n is not None else math.sqrt(sum(v * v for v in dec))))


def rand_tok(rng, dim, norm_factor=1.0):
    nib = [rng.randrange(16) for _ in range(dim)]
    mn = f32(-rng.uniform(0.05, 0.3)); sc = f32(rng.uniform(0.01, 0.05))
    dec = [k * sc + mn for k in nib]
    return dict(nib=nib, mn=mn, sc=sc, n=f32(math.sqrt(sum(v * v for v in dec)) * norm_factor))


def rand_q(rng, nq, dim):
    return [[f32(rng.gauss(0, 1)) for _ in range(dim)] for _ in range(nq)]


def unit(dim, k, s=1.0):
    v = [0.0] * dim; v[k] = s
    return v


def cases():
    rng = random.Random(42)
    out = []
    d = 128
    # negative best match: the query points along +e0, every doc token has a negative e0 part
    q = [[f32(1.0)] + [0.0] * (d - 1)]
    docs = [[tok_from_values([-0.5] + [0.0] * (d - 2) + [0.25]), tok_from_values([-0.25] + [0.5] + [0.0] * (d - 2))]]
    out.append(('negative-best', q, docs))
    # opposite pair: doc token = -q -> cosine -1 (second doc: +q, cosine 1)
    vals = [1.0 if k % 2 == 0 else -1.0 for k in range(d)]
    q = [[f32(v) for v in vals]]
    out.append(('opposite-pair', q, [[tok_from_values([-v for v in vals])], [tok_from_values(vals)]]))
    # unequal norms: stored n = 1.10 x the decoded norm (S and Spre divide by it; C does not)
    t = tok_from_values([0.5] * 64 + [0.0] * 64)
    t110 = dict(t, n=f32(t['n'] * 1.10))
    q = [[f32(1.0)] * 64 + [0.0] * 64]
    out.append(('unequal-norms', q, [[t110], [t]]))
    # zero query token, next to a normal one
    q = [[0.0] * d, [f32(x) for x in vals]]
    out.append(('zero-query-token', q, [[tok_from_values(vals)], [rand_tok(rng, d)]]))
    # constant doc token: max == min -> scale 0, nibbles 0, decoded value = mn everywhere
    q = rand_q(rng, 2, d)
    out.append(('constant-doc-token', q, [[tok_from_values([0.125] * d)], [tok_from_values([-0.0625] * d), rand_tok(rng, d)]]))
    # zero doc vector: scale 0, min 0, stored norm 0
    out.append(('zero-doc-vector', rand_q(rng, 2, d), [[dict(nib=[0] * d, mn=0.0, sc=0.0, n=0.0)], [rand_tok(rng, d)]]))
    # padding: one 256-token doc and 30 docs of 64-255 tokens in one call, every doc token
    # turned away from query token 0 (its best cosine < 0): zero padding inside a library
    # would clamp that token to 0 for the shorter docs (maxsim-cpu#5, PyLate's mask)
    q = rand_q(rng, 4, d)
    q0n = norm(q[0])
    def away(nt):
        toks = []
        for _ in range(nt):
            v = [rng.gauss(0, 1) for _ in range(d)]
            s_ = dot(v, q[0])
            v = [x - (s_ / q0n ** 2 + 0.3 / q0n) * y for x, y in zip(v, q[0])]  # dot with q0 = -0.3 x |q0|
            nv = norm(v); toks.append(tok_from_values([x / nv for x in v]))
        return toks
    out.append(('padding', q, [away(256)] + [away(rng.randrange(64, 256)) for _ in range(30)]))
    # ragged candidates in one call, per dim (96, 128, odd 127); norms off by up to 10%
    for dim in (96, 128, 127):
        q = rand_q(rng, 5, dim)
        docs = [[rand_tok(rng, dim, rng.uniform(0.9, 1.1)) for _ in range(nt)] for nt in (1, 3, 17, 64)]
        out.append((f'ragged-d{dim}', q, docs))
    return out


# ---------------------------------------------------------------- expected values (plain Python)

def decoded(t):
    return [k * t['sc'] + t['mn'] for k in t['nib']]


def norm(v):
    return math.sqrt(sum(x * x for x in v))


def dot(u, v):
    return sum(x * y for x, y in zip(u, v))


def mean(xs):
    return sum(xs) / len(xs)


def expect_S(q, doc, clamp):
    vals = []
    for qi in q:
        qn = norm(qi)
        best = max(dot(qi, decoded(t)) / (qn * t['n'] + EPS) for t in doc)
        vals.append(max(0.0, best) if clamp else best)
    return mean(vals)


def expect_Spre(q, doc, clamp):
    vals = []
    for qi in q:
        qn = norm(qi)
        if qn == 0:
            return float('nan')
        qh = [x / qn for x in qi]
        best = max(dot(qh, [x / (t['n'] + EPS) for x in decoded(t)]) for t in doc)
        vals.append(max(0.0, best) if clamp else best)
    return mean(vals)


def expect_C(q, doc):
    vals = []
    for qi in q:
        qn = norm(qi)
        if qn == 0:
            return float('nan')  # the arm receives a NaN row (q / 0): undefined input
        qh = [x / qn for x in qi]
        best = -math.inf
        for t in doc:
            y = [x / (t['n'] + EPS) for x in decoded(t)]
            ny = norm(y)
            c = 0.0 if ny == 0 else min(1.0, dot(qh, y) / (norm(qh) * ny))
            best = max(best, c)
        vals.append(best)
    return mean(vals)


def expect_Spre_pad0(q, docs):
    """Spre without clamp, except that docs shorter than the longest get max(0, ·)."""
    L = max(len(d) for d in docs)
    return [expect_Spre(q, d, len(d) < L) for d in docs]


_memo = {}


def expected(contract, clamp, q, docs):
    key = (contract, clamp, id(q))
    if key not in _memo:
        if contract == 'S':
            _memo[key] = [expect_S(q, d, clamp) for d in docs]
        elif contract == 'Spre':
            _memo[key] = [expect_Spre(q, d, clamp) for d in docs]
        elif contract == 'Spre-pad0':
            _memo[key] = expect_Spre_pad0(q, docs)
        else:
            _memo[key] = [expect_C(q, d) for d in docs]
    return _memo[key]


# Known upstream defects: (arm prefix, case, machine) -> issue. Reported, not a pass.
KNOWN = {('maxsim_cpu_variable', 'padding', 'arm64'): 'maxsim-cpu#5 (list API zero-pads inside its batches, arm64 build)',
         ('numkong_f16', 'padding', 'x86_64'): 'NumKong 7.8.5 x86 (Granite Rapids): a query token whose best cosine is < 0 against a doc of a length not a multiple of 16 gives NaN in f16 (not yet reported upstream)',
         ('numkong_native_f16', 'padding', 'x86_64'): 'same NumKong 7.8.5 f16 defect, through the native loop'}


# ---------------------------------------------------------------- write the replay set

def write_set(root, cs):
    for name, q, docs in cs:
        sub = os.path.join(root, name); os.makedirs(sub)
        dim = len(q[0])
        parts = [struct.pack(f'<{len(q) * dim}f', *[x for row in q for x in row])]
        meta = []
        for doc in docs:
            raw = bytearray()
            for t in doc:
                nib = t['nib'] + [0] * (dim % 2)
                raw += bytes(nib[i] | (nib[i + 1] << 4) for i in range(0, len(nib), 2))
            parts += [bytes(raw), struct.pack(f'<{len(doc)}f', *[t['mn'] for t in doc]),
                      struct.pack(f'<{len(doc)}f', *[t['sc'] for t in doc]), struct.pack(f'<{len(doc)}f', *[t['n'] for t in doc])]
            meta.append(dict(nt=len(doc), dim=dim, tb=len(raw)))
        open(os.path.join(sub, f'{name}.bin'), 'wb').write(b''.join(parts))
        open(os.path.join(sub, 'index-fix.jsonl'), 'w').write(json.dumps(dict(file=f'{name}.bin', kind='int4', numQ=len(q), dim=dim, cands=meta, scores=[])) + '\n')


# ---------------------------------------------------------------- bounds

def bound(arm, contract, precision, case):
    """Allowed max abs error against the contract on the float64 data."""
    b = {'int4': 2e-6, 'f32': 2e-6, 'f16': 4e-3, 'bf16': 3e-2}[precision]
    if contract == 'C' and case.startswith(('ragged', 'padding')):
        return 0.15  # NumKong's int8 screen may pick a non-maximal token (its documented approximation)
    return b


def run_arms(root, arms, outdir):
    got = {}
    for arm in arms:
        f = os.path.join(outdir, arm.replace(':', '-') + '.json')
        if arm.startswith('node:'):
            cmd = ['node', os.path.join(HERE, 'bench-node.mjs'), '--arm', arm[5:]]
        else:
            cmd = [PY, '-I', os.path.join(HERE, 'bench.py'), '--arm', arm]
        r = None
        per_case = {}
        for case in sorted(os.listdir(root)):
            if case == 'refs-v2' or not os.path.isdir(os.path.join(root, case)) or case.startswith('MANIFEST'):
                continue
            # one case per process run, so an unsupported input fails only that case
            single = os.path.join(outdir, 'one-' + case); shutil.rmtree(single, ignore_errors=True); os.makedirs(single)
            shutil.copytree(os.path.join(root, case), os.path.join(single, case))
            subprocess.run([PY, '-I', os.path.join(HERE, 'contracts.py'), '--ensure', single], capture_output=True)
            r = subprocess.run(cmd + ['--set', single, '--out', f, '--reps', '1', '--keep-scores'], capture_output=True, text=True)
            if r.returncode != 0:
                per_case[case] = ('error', (r.stderr.strip().splitlines() or ['?'])[-1][:160])
            else:
                per_case[case] = ('ok', json.load(open(f))['calls'][0]['scores'])
        got[arm] = per_case
    return got


def contract_of(arm):
    if arm.startswith('node:'):
        return ('S', True, 'int4')
    r = subprocess.run([PY, '-I', os.path.join(HERE, 'bench.py'), '--list-arms'], capture_output=True, text=True)
    reg = {l.split('\t')[0]: l.split('\t')[1:] for l in r.stdout.splitlines() if l}
    c, cl, pr = reg[arm]
    return (c, cl == 'clamp', pr)


def main():
    cs = cases()
    tmp = a.keep or tempfile.mkdtemp(prefix='maxsim-fixtures.')
    root = os.path.join(tmp, 'fixtures'); shutil.rmtree(root, ignore_errors=True)
    write_set(root, cs)
    status = 0

    # 1. the reference builder against the independent expected values
    subprocess.run([PY, '-I', os.path.join(HERE, 'contracts.py'), '--ensure', root], check=True, capture_output=True)
    idx = json.load(open(os.path.join(root, 'refs-v2', 'index.json')))
    worst = {}
    for name, q, docs in cs:
        o, n = idx['calls'][f'{name}/{name}.bin']
        for var, (con, cl) in {'S-clamp': ('S', True), 'S-noclamp': ('S', False), 'Spre-b-clamp': ('Spre', True),
                               'Spre-b-noclamp': ('Spre', False), 'C-b-noclamp': ('C', False), 'Spre-pad0-b-noclamp': ('Spre-pad0', False)}.items():
            raw = open(os.path.join(root, 'refs-v2', name, var + '.f64'), 'rb').read()
            vals = struct.unpack(f'<{len(raw) // 8}d', raw)[o:o + n]
            exp = expected(con, cl, q, docs)
            for v, e in zip(vals, exp):
                if math.isnan(e) and math.isnan(v):
                    continue
                err = abs(v - e) if not (math.isnan(e) or math.isnan(v)) else math.inf
                worst[var] = max(worst.get(var, 0), err)
    for var, w in worst.items():
        print(f"contracts.py {var:16s} max |ref - expected| = {w:.1e} {'pass' if w <= 1e-12 else 'FAIL'}")
        status |= w > 1e-12

    # 2. every arm against its contract
    r = subprocess.run([PY, '-I', os.path.join(HERE, 'bench.py'), '--list-arms'], capture_output=True, text=True)
    arms = [l.split('\t')[0] for l in r.stdout.splitlines() if l]
    arms += ['node:production', 'node:prewarm', 'node:wasm', 'node:js'] + (['node:legacy'] if os.environ.get('LEGACY_ADDON') else [])
    if a.arms:
        arms = a.arms.split(',')
    got = run_arms(root, arms, tmp)
    summary = {}
    for arm in arms:
        con, cl, pr = contract_of(arm)
        row = {}
        # The arm's library is not installed on this machine (e.g. maxsim-cpu has no Linux
        # aarch64 wheel): every case fails to import it. Recorded, not a failure; the
        # benchmark leaves such arms out too (plan_groups.py: missing-arms).
        if all(st == 'error' and 'ModuleNotFoundError' in str(val) for st, val in (got[arm][n] for n, _, _ in cs)):
            summary[arm] = dict(contract=con, clamp=cl, precision=pr, cases={}, not_available=str(got[arm][cs[0][0]][1]))
            print(f"{arm:26s} not available on this machine ({got[arm][cs[0][0]][1]})")
            continue
        for name, q, docs in cs:
            st, val = got[arm][name]
            exp = expected(con, cl, q, docs)
            if any(math.isnan(e) for e in exp) and con != 'S':
                row[name] = 'undefined input'
                continue
            if st == 'error':
                # An odd dim is the only input an arm may reject; any other error is a failure.
                ok_unsupported = name == 'ragged-d127'
                row[name] = f"{'unsupported' if ok_unsupported else 'FAIL error'} ({val})"
                status |= not ok_unsupported
                continue
            err = max((abs(v - e) if not (math.isnan(v) or math.isnan(e)) else math.inf) for v, e in zip(val, exp))
            ok = err <= bound(arm, con, pr, name)
            known = [why for (pre, case, mach), why in KNOWN.items() if arm.startswith(pre) and case == name and mach == MACH]
            if not ok and known:
                row[name] = f'known defect {err:.1e}: {known[0]}'
                continue
            row[name] = f"{'pass' if ok else 'FAIL'} {err:.1e}"
            status |= not ok
        summary[arm] = dict(contract=con, clamp=cl, precision=pr, cases=row)
        fails = [k for k, v in row.items() if v.startswith('FAIL')]
        other = [f'{k}: {v}' for k, v in row.items() if not v.startswith(('pass', 'FAIL'))]
        print(f"{arm:26s} {con}{'+clamp' if cl else ''} {pr:5s} " + ('FAIL ' + ', '.join(f'{k} {row[k]}' for k in fails) if fails else 'pass')
              + (f"  [{'; '.join(other)}]" if other else ''))
    json.dump(summary, open(os.path.join(tmp, 'fixtures-result.json'), 'w'), indent=1)
    print(f'fixtures: {"FAIL" if status else "all arms match their contracts"} (details: {tmp}/fixtures-result.json)')
    sys.exit(1 if status else 0)


main()
