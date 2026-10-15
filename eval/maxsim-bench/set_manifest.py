# python3 set_manifest.py <set-dir> [<set-dir> ...] [--check]
#
# Content manifest of a replay set: <set>/MANIFEST.sha256, one "sha256  relpath" line per
# data file (index-*.jsonl, *.bin, provenance.jsonl), sorted by path. Reference caches
# (refs-v2/), result files and the manifest itself are not part of it. The set hash
# (used in every job key) is the SHA-256 of the manifest text. EXCLUDE.json (calls left
# out of the set) is part of the manifest.
#
# The manifest is rebuilt when the file list changes or a file is newer than the
# manifest; otherwise it is reused (a stat pass, no reading). --check re-hashes every
# file and fails on any difference (bootstrap uses it on fresh copies).
import hashlib, os, sys

NAME = 'MANIFEST.sha256'


def data_files(root):
    out = []
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if x not in ('refs-v2', 'stale'))
        for f in files:
            if f.endswith('.bin') or (f.startswith('index-') and f.endswith('.jsonl')) or f in ('provenance.jsonl', 'EXCLUDE.json'):
                out.append(os.path.relpath(os.path.join(d, f), root))
    return sorted(out)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def build(root):
    lines = [f'{sha256_file(os.path.join(root, f))}  {f}' for f in data_files(root)]
    text = '\n'.join(lines) + '\n'
    tmp = os.path.join(root, NAME + '.tmp')
    with open(tmp, 'w') as f:
        f.write(text)
    os.replace(tmp, os.path.join(root, NAME))
    return text


def manifest(root):
    """Manifest text of a set, rebuilt only when the set changed since it was written."""
    path = os.path.join(root, NAME)
    files = data_files(root)
    if os.path.exists(path):
        text = open(path).read()
        listed = [l.split('  ', 1)[1] for l in text.splitlines() if l]
        mt = os.path.getmtime(path)
        if listed == files and all(os.path.getmtime(os.path.join(root, f)) <= mt for f in files):
            return text
    return build(root)


def set_hash(root):
    return hashlib.sha256(manifest(root).encode()).hexdigest()


def check(root):
    path = os.path.join(root, NAME)
    if not os.path.exists(path):
        return [f'{root}: no {NAME}']
    want = {l.split('  ', 1)[1]: l.split('  ', 1)[0] for l in open(path).read().splitlines() if l}
    have = data_files(root)
    bad = [f'{root}: missing {f}' for f in want if f not in have] + [f'{root}: not in manifest {f}' for f in have if f not in want]
    bad += [f'{root}: sha256 differs {f}' for f in have if f in want and sha256_file(os.path.join(root, f)) != want[f]]
    return bad


if __name__ == '__main__':
    roots = [a for a in sys.argv[1:] if a != '--check']
    if '--check' in sys.argv:
        problems = [p for r in roots for p in check(r)]
        print('\n'.join(problems) or f'{len(roots)} sets match their manifests')
        sys.exit(1 if problems else 0)
    for r in roots:
        print(set_hash(r), r)
