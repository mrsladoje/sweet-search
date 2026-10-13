# python3 make_sweep.py <out-dir> <replay-set-dir> [<replay-set-dir> ...] [--seed 42] [--small]
#
# Size sweep built only from REAL embeddings of the given replay sets (use held-out
# sets for published numbers): query token embeddings from their queries, document
# token embeddings (int4 per token, as the index stores them) from their candidate
# pools. Writes one replay set (hook.mjs format) per cell, <out-dir>/<cell>/sweep/:
#
#   q{8,32,64}  query tokens: real queries with at least that many tokens, cut to it
#   d{1..4096}  candidates per call
#   len{nat,32,128,512}  doc tokens: natural (a random real doc), or real docs with at
#               least that many tokens cut to exactly it
#
# Calls per cell shrink as cells grow (CALLS below), so each cell costs about the
# same to time. Cells without enough long-enough real docs/queries are skipped.
# --small: pools {1, 16, 256, 4096} x lengths {nat, 512} and a quarter of the calls
# (used on dev sets to shortlist rival configurations).
import hashlib, json, os, random, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from replay_py import load_set  # noqa: E402

args = [a for a in sys.argv[1:]]
seed = 42
small = '--small' in args
args = [x for x in args if x != '--small']
if '--seed' in args:
    i = args.index('--seed'); seed = int(args[i + 1]); del args[i:i + 2]
out_dir, sets = args[0], args[1:]
rng = random.Random(seed)

queries, docs, seen_q, seen_d = [], [], set(), set()
for s in sets:
    for c in load_set(s):
        if c['kind'] != 'int4':
            continue
        h = hashlib.sha1(c['q'].tobytes()).digest()
        if h not in seen_q:
            seen_q.add(h); queries.append(c['q'])
        for d in c['cands']:
            h = hashlib.sha1(d['raw'].tobytes()).digest()
            if h not in seen_d:
                seen_d.add(h); docs.append(d)
dim = queries[0].shape[1]
print(f'{len(queries)} unique queries, {len(docs)} unique docs, dim {dim}')

Q_TOKENS = [8, 32, 64]
POOLS = [1, 16, 256, 4096] if small else [1, 4, 16, 64, 256, 1024, 4096]
LENS = ['nat', 512] if small else ['nat', 32, 128, 512]


def calls_for(pool, ln):
    tokens = pool * (366 if ln == 'nat' else ln)
    n = int(min(60, max(6, 400_000 // max(tokens, 1))))
    return max(3, n // 4) if small else n


def cut(d, n):
    pd = (dim + 1) // 2
    return dict(raw=d['raw'][:n * pd], nt=n, mn=d['mn'][:n], sc=d['sc'][:n], nr=d['nr'][:n])


written = 0
for nq in Q_TOKENS:
    qs = [q[:nq] for q in queries if q.shape[0] >= nq]
    for ln in LENS:
        pool_docs = docs if ln == 'nat' else [cut(d, ln) for d in docs if d['nt'] >= ln]
        for pool in POOLS:
            if len(qs) < 4 or len(pool_docs) < 64:
                print(f'skip q{nq} d{pool} len{ln}: {len(qs)} queries, {len(pool_docs)} docs')
                continue
            # Fewer real docs than the pool: sample with replacement (timing does not
            # depend on repeats; the call's metadata records it).
            replace = len(pool_docs) < pool
            cell = f'q{nq}-d{pool}-len{ln}'
            d_out = os.path.join(out_dir, cell, 'sweep'); os.makedirs(d_out, exist_ok=True)
            with open(os.path.join(d_out, 'index-sweep.jsonl'), 'w') as idx:
                for k in range(calls_for(pool, ln)):
                    q = np.ascontiguousarray(rng.choice(qs), dtype=np.float32)
                    cands = rng.choices(pool_docs, k=pool) if replace else rng.sample(pool_docs, pool)
                    name = f'{cell}-{k:04d}.bin'
                    parts = [q.tobytes()]
                    meta = []
                    for d in cands:
                        parts += [d['raw'].tobytes(), d['mn'].tobytes(), d['sc'].tobytes(), d['nr'].tobytes()]
                        meta.append(dict(nt=int(d['nt']), dim=dim, tb=int(d['raw'].nbytes)))
                    with open(os.path.join(d_out, name), 'wb') as f:
                        f.write(b''.join(parts))
                    idx.write(json.dumps(dict(file=name, kind='int4', numQ=nq, dim=dim, cands=meta, scores=[], replacement=replace)) + '\n')
                    written += 1
print(f'wrote {written} calls under {out_dir}')
