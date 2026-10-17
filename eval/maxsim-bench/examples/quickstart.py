# Small reproduction example for LIRK-Bench.
#
#   cd eval/maxsim-bench
#   venv/bin/python -I examples/quickstart.py [--limit 20] [--set DIR] [--arms a,b,c]
#
# What it does:
#   1. Takes a replay set. With no --set it writes a small synthetic one (seed 42) to a
#      work folder. With --set DIR it reads a real set that you captured or downloaded.
#   2. Builds the contract references for that set (contracts.py --ensure).
#   3. Runs each arm in its own process (bench.py), on the first --limit calls.
#   4. Compares every arm with the float64 reference of its own contract and prints a table.
#
# It changes no frozen file. It writes only inside the work folder (default: a new
# temporary folder). The `ours` arm needs the C library built from capi/ (cargo build
# --release); if the library is missing, that arm is skipped and the table says so.
import argparse, json, os, shutil, struct, subprocess, sys, tempfile, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)          # eval/maxsim-bench
PY = sys.executable

# Largest allowed |arm - reference| per input precision. Same bounds as fixtures_contracts.py.
BOUND = {'int4': 2e-6, 'f32': 2e-6, 'f16': 4e-3, 'bf16': 3e-2}


def synthetic_set(root, n_calls, seed=42, dim=128):
    """Write a replay set in the format hook.mjs writes (see replay_py.py): per call one
    .bin file (raw query f32, then per candidate: int4 bytes, min, scale, norm) and one
    line in index-*.jsonl. Tokens are Gaussian; the int4 code is per token."""
    rng = np.random.default_rng(seed)
    sub = os.path.join(root, 'synthetic'); os.makedirs(sub)
    lines = []
    for i in range(n_calls):
        nq = int(rng.integers(6, 33))
        q = rng.standard_normal((nq, dim)).astype(np.float32)
        parts, cands = [q.tobytes()], []
        for _ in range(int(rng.integers(20, 121))):
            nt = int(rng.integers(30, 301))
            x = rng.standard_normal((nt, dim)).astype(np.float32) * 0.1
            x += 0.05 * rng.standard_normal((1, dim)).astype(np.float32)   # shared direction: positive cosines
            mn = x.min(1).astype(np.float32); sc = ((x.max(1) - mn) / 15).astype(np.float32)
            nib = np.clip(np.floor((x - mn[:, None]) / sc[:, None] + 0.5), 0, 15).astype(np.uint8)
            raw = (nib[:, 0::2] | (nib[:, 1::2] << 4)).astype(np.uint8)
            nr = np.linalg.norm(x, axis=1).astype(np.float32)      # norm before quantization
            parts += [raw.tobytes(), mn.tobytes(), sc.tobytes(), nr.tobytes()]
            cands.append(dict(nt=nt, dim=dim, tb=int(raw.size)))
        name = f'call-{i:04d}.bin'
        open(os.path.join(sub, name), 'wb').write(b''.join(parts))
        lines.append(json.dumps(dict(file=name, kind='int4', numQ=nq, dim=dim, cands=cands, scores=[])))
    open(os.path.join(sub, 'index-synthetic.jsonl'), 'w').write('\n'.join(lines) + '\n')


def ours_available():
    lib = os.environ.get('SS_CAPI') or os.path.join(BENCH, 'capi', 'target', 'release',
                                                      'libss_maxsim_capi' + ('.dylib' if sys.platform == 'darwin' else '.so'))
    return os.path.exists(lib)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=50, help='first N calls of the set (default 50)')
    ap.add_argument('--set', default='', help='replay set folder (default: write a synthetic one)')
    ap.add_argument('--arms', default='ours,numpy_packed,torch_pad_bmm')
    ap.add_argument('--reps', type=int, default=5, help='timed repetitions per call')
    ap.add_argument('--work', default='', help='work folder (default: a new temporary folder)')
    a = ap.parse_args()

    work = a.work or tempfile.mkdtemp(prefix='lirk-quickstart-')
    os.makedirs(work, exist_ok=True)
    t_start = time.time()

    if a.set:
        root = os.path.abspath(a.set)
        src = f'real set {root}'
    else:
        root = os.path.join(work, 'synthetic-set')
        shutil.rmtree(root, ignore_errors=True); os.makedirs(root)
        synthetic_set(root, a.limit)
        src = f'synthetic set (seed 42, {a.limit} calls)'
    print(f'set: {src}\nwork folder: {work}\n')

    # Reference cache. For a real set that already has refs-v2 this is a no-op.
    r = subprocess.run([PY, '-I', os.path.join(BENCH, 'contracts.py'), '--ensure', root], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit('contracts.py --ensure failed:\n' + r.stderr[-1500:])

    listing = subprocess.run([PY, '-I', os.path.join(BENCH, 'bench.py'), '--list-arms'], capture_output=True, text=True).stdout
    known = {l.split('\t')[0] for l in listing.splitlines() if l}

    rows, notes = [], []
    for arm in [x for x in a.arms.split(',') if x]:
        if arm not in known:
            rows.append((arm, '-', '-', '-', '-', '-', 'SKIPPED (unknown arm)')); continue
        if arm.startswith('ours') and not ours_available():
            rows.append((arm, 'S', '-', '-', '-', '-', 'SKIPPED (capi library not built)'))
            notes.append('The `ours` arm was skipped. Build the library first: (cd capi && cargo build --release).')
            continue
        out = os.path.join(work, arm + '.json')
        cmd = [PY, '-I', os.path.join(BENCH, 'bench.py'), '--arm', arm, '--set', root, '--out', out,
               '--limit', str(a.limit), '--reps', str(a.reps)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(out):
            err = (r.stderr.strip().splitlines() or ['?'])[-1][:90]
            rows.append((arm, '-', '-', '-', '-', '-', f'ERROR ({err})')); continue
        d = json.load(open(out))
        cs = d['calls']
        ms = np.array([c['ms'] for c in cs])
        err = max(c['err'] for c in cs)
        top1 = 100 * np.mean([c['top1'] for c in cs])
        bound = BOUND[d['precision']]
        ok = d['complete'] and err <= bound
        rows.append((arm, d['contract'] + ('+clamp' if d['clamp'] else ''), f'{np.median(ms):.3f}', f'{ms.mean():.3f}',
                     f'{err:.1e}', f'{top1:.0f}%', 'PASS' if ok else f'FAIL (bound {bound:.0e})'))

    head = ('arm', 'contract', 'p50 ms', 'mean ms', 'max err', 'top-1', 'check')
    w = [max(len(str(x[i])) for x in rows + [head]) for i in range(len(head))]
    fmt = '  '.join('{:<%d}' % n for n in w)
    print(fmt.format(*head).rstrip()); print(fmt.format(*['-' * n for n in w]).rstrip())
    for row in rows:
        print(fmt.format(*row).rstrip())
    print('\nmax err: largest |score - reference| over all candidates, against the float64 reference of the arm\'s own contract.')
    print('top-1: share of calls where the arm ranks the same best candidate as that reference.')
    print('Latency: median of ' + str(a.reps) + ' timed calls per call, warm, default threads, on a machine that is not idle-gated.')
    print('These timings are NOT benchmark results. Published numbers use held-out sets, idle gating and two rounds.')
    for n in dict.fromkeys(notes):
        print('note: ' + n)
    print(f'\ntotal wall time: {time.time() - t_start:.0f} s')
    if any(r_[-1].startswith(('FAIL', 'ERROR')) for r_ in rows):
        sys.exit(1)


if __name__ == '__main__':
    main()
