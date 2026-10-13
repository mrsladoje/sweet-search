# Loads a replay set written by hook.mjs (the Python twin of replay.mjs): per call the
# raw query (f32 [nq, dim]) and the candidate docs as the index stores them.
import glob, json, os
import numpy as np


def load_set(root):
    calls = []
    for repo in sorted(os.listdir(root)):
        d = os.path.join(root, repo)
        if not os.path.isdir(d):
            continue
        for idx in sorted(glob.glob(os.path.join(d, 'index-*.jsonl'))):
            for line in open(idx):
                m = json.loads(line)
                buf = open(os.path.join(d, m['file']), 'rb').read()
                off = 0

                def take(n):
                    nonlocal off
                    b = buf[off:off + n]; off += n
                    return b
                nq, dim = m['numQ'], m['dim']
                q = np.frombuffer(take(nq * dim * 4), np.float32).reshape(nq, dim)
                cands = []
                for c in m['cands']:
                    nt = c['nt']
                    raw = np.frombuffer(take(c['tb']), np.uint8)
                    if m['kind'] == 'perdoc':
                        raise ValueError('per-doc quantized calls are not used by the current index')
                    mn = np.frombuffer(take(nt * 4), np.float32)
                    sc = np.frombuffer(take(nt * 4), np.float32)
                    nr = np.frombuffer(take(nt * 4), np.float32)
                    cands.append(dict(kind=m['kind'], raw=raw, nt=nt, mn=mn, sc=sc, nr=nr))
                calls.append(dict(repo=repo, file=m['file'], kind=m['kind'], q=q, nq=nq, dim=dim, cands=cands, ref=m['scores']))
    return calls
