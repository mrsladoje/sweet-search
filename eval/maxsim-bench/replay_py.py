# Loads a replay set written by hook.mjs (the Python twin of replay.mjs): per call the
# raw query (f32 [nq, dim]) and the candidate docs as the index stores them.
# <set>/EXCLUDE.json ({"reason", "files": ["<subdir>/<file>", ...]}) lists calls that are
# not part of the set (e.g. held-out calls whose query also occurs in a dev set).
import glob, json, os
import numpy as np


def excluded(root):
    p = os.path.join(root, 'EXCLUDE.json')
    return set(json.load(open(p))['files']) if os.path.exists(p) else set()


def load_provenance(root):
    """{(subdir, file): provenance record} from every <subdir>/provenance.jsonl."""
    out = {}
    for path in sorted(glob.glob(os.path.join(root, '*', 'provenance.jsonl'))):
        sub = os.path.basename(os.path.dirname(path))
        for line in open(path):
            if line.strip():
                r = json.loads(line)
                out[(sub, r['file'])] = r
    return out


def load_set(root, honor_exclude=True):
    calls = []
    skip = excluded(root) if honor_exclude else set()
    for repo in sorted(os.listdir(root)):
        d = os.path.join(root, repo)
        if not os.path.isdir(d) or repo in ('refs-v2', 'stale'):
            continue
        for idx in sorted(glob.glob(os.path.join(d, 'index-*.jsonl'))):
            for line in open(idx):
                m = json.loads(line)
                if f"{repo}/{m['file']}" in skip:
                    continue
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


def count_calls(root, limit=0, stride=1):
    """Number of calls a run with --limit / --stride sees, from the index files only."""
    skip = excluded(root)
    n = 0
    for repo in sorted(os.listdir(root)):
        d = os.path.join(root, repo)
        if not os.path.isdir(d) or repo in ('refs-v2', 'stale'):
            continue
        for idx in sorted(glob.glob(os.path.join(d, 'index-*.jsonl'))):
            n += sum(1 for line in open(idx) if line.strip() and f"{repo}/{json.loads(line)['file']}" not in skip)
    n = len(range(0, n, stride))
    return min(n, limit) if limit else n
