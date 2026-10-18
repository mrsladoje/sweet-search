# venv/bin/python -I paper/analysis/scrub.py --out RELEASE_DIR SRC=NAME [SRC=NAME ...]
#
# Post-freeze analysis code (not frozen). Builds the release tree of raw results with cloud
# account data removed (HANDOFF section 7a). Copies each source tree SRC to RELEASE_DIR/NAME
# and replaces, in every file:
#   - each EC2 instance ID (i-0...) with a neutral label per host: <type>-host-<k> (the same
#     instance always gets the same label, so the host-to-host spread stays visible; a
#     tree that holds two instances, after a relaunch, gets labels ...-a / ...-b);
#   - each internal EC2 host name (ip-N-N-N-N plus the EC2 internal domain) with the label of its tree;
#   - fixed strings that must never be released, with "<removed>": the account values in
#     aws/env.local (bucket, security group, profile, account ID) and one string per line in
#     the git-ignored file ~/.ss-eval/maxsim-cloud/scrub-forbidden.txt (names and addresses
#     that must not appear in this public repository, not even in this script).
# The label map (label -> real ID) is written OUTSIDE the release and the repository
# (--map, default ~/.ss-eval/maxsim-cloud/host-labels.json). Originals are not changed.
# Writes RELEASE_DIR/SHA256SUMS (one line per released file) and RELEASE_DIR/SCRUB-README.md.
# Then greps the whole release tree for every forbidden pattern; exit 1 if anything is left.
#
# The job key stored in each result was computed over the instance ID; after scrubbing, a
# recomputed key no longer matches it, but the stored keys of a result and its jobs.json
# still match each other, so check_complete.py and summarize.py run on the release tree.
import argparse, hashlib, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(os.path.dirname(HERE))
IID = re.compile(rb'i-0[0-9a-f]{8,17}')
HOSTNAME = re.compile(rb'ip-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}(?:\.ec2' + rb'\.internal|\.[a-z0-9-]+\.compute\.internal)?')
TEXT_EXT = ('.json', '.jsonl', '.txt', '.log', '.md', '.out', '.csv', '.tsv', '.sh', '')


def forbidden():
    fixed = []
    extra = os.path.expanduser('~/.ss-eval/maxsim-cloud/scrub-forbidden.txt')
    if not os.path.exists(extra):
        sys.exit(f'scrub: {extra} is missing (one forbidden string per line; kept outside the repository)')
    fixed += [l.strip().encode() for l in open(extra) if l.strip()]
    env = os.path.join(BENCH, 'aws', 'env.local')
    if os.path.exists(env):
        for line in open(env):
            m = re.match(r'\s*(?:export\s+)?(BUCKET|SG|INSTANCE_PROFILE)=(\S+)', line)
            if m and m.group(2):
                fixed.append(m.group(2).encode())
                acct = re.search(r'(\d{12})', m.group(2))
                if acct:
                    fixed.append(acct.group(1).encode())
    return sorted(set(fixed), key=len, reverse=True)


def type_of(name):
    return re.split(r'[-_]', name)[0]



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--map', default=os.path.expanduser('~/.ss-eval/maxsim-cloud/host-labels.json'))
    ap.add_argument('pairs', nargs='+', help='SRC=NAME')
    a = ap.parse_args()
    FORB = forbidden()
    labels = json.load(open(a.map)) if os.path.exists(a.map) else {}
    rev = {v: k for k, v in labels.items()}   # real -> label
    used = {}
    for lab in labels:                        # a later run continues the numbering of an earlier one
        m = re.fullmatch(r'([a-z0-9]+)(-dev)?-host-(\d+)[a-h]?', lab)
        if m:
            k = (m.group(1), bool(m.group(2)))
            used[k] = max(used.get(k, 0), int(m.group(3)))
    os.makedirs(a.out, exist_ok=True)
    sums = []
    for pair in a.pairs:
        src, name = pair.split('=', 1)
        src = os.path.expanduser(src)
        # 1. the instance IDs and host names of this tree
        ids, hosts = [], []
        for root, _, files in os.walk(src):
            for f in files:
                p = os.path.join(root, f)
                if not f.endswith(TEXT_EXT) and '.' in f:
                    continue
                b = open(p, 'rb').read()
                for m in IID.findall(b):
                    if m not in ids:
                        ids.append(m)
                for m in HOSTNAME.findall(b):
                    if m not in hosts:
                        hosts.append(m)
        t = type_of(os.path.basename(name))
        dev = name.startswith('dev/')
        if t in ('m3max', 'epyc'):
            stem = f"{t}{'-dev' if dev else ''}-host"
        else:
            n = used.get((t, dev), 0) + 1
            used[(t, dev)] = n
            stem = f"{t}{'-dev' if dev else ''}-host-{n}"
        new_ids = [i for i in ids if i.decode() not in rev]
        for k, iid in enumerate(new_ids):
            lab = stem if len(new_ids) == 1 else f'{stem}{"abcdefgh"[k]}'
            labels[lab] = iid.decode(); rev[iid.decode()] = lab
        tree_label = rev[ids[0].decode()] if ids else stem
        for k, h in enumerate(x for x in hosts if x.decode() not in rev):
            lab = f'{tree_label}-name' + ('' if k == 0 else str(k + 1))
            labels[lab] = h.decode(); rev[h.decode()] = lab
        # 2. copy with replacements
        repl = sorted(((k.encode(), v.encode()) for k, v in rev.items()), key=lambda x: -len(x[0]))
        for root, _, files in os.walk(src):
            rel = os.path.relpath(root, src)
            dst_dir = os.path.join(a.out, name, rel) if rel != '.' else os.path.join(a.out, name)
            os.makedirs(dst_dir, exist_ok=True)
            for f in files:
                sp, dp = os.path.join(root, f), os.path.join(dst_dir, f)
                b = open(sp, 'rb').read()
                if f.endswith(TEXT_EXT) or '.' not in f:
                    for old, new in repl:
                        if old in b:
                            b = b.replace(old, new)
                    for fb in FORB:
                        b = re.sub(re.escape(fb), b'<removed>', b, flags=re.I)
                open(dp, 'wb').write(b)
                sums.append(f'{hashlib.sha256(b).hexdigest()}  {os.path.relpath(dp, a.out)}')
        print(f'{name}: {len(ids)} instance IDs, {len(hosts)} host names', flush=True)
    os.makedirs(os.path.dirname(a.map), exist_ok=True)
    json.dump(labels, open(a.map, 'w'), indent=1, sort_keys=True)
    open(os.path.join(a.out, 'SHA256SUMS'), 'a').write('\n'.join(sums) + '\n')
    # 3. verify: nothing forbidden is left anywhere in the release tree
    bad = 0
    pats = [IID, HOSTNAME, re.compile(rb'ec2' + rb'\.internal')] + [re.compile(re.escape(x), re.I) for x in FORB]
    for root, _, files in os.walk(a.out):
        for f in files:
            if f == 'SHA256SUMS':
                continue
            b = open(os.path.join(root, f), 'rb').read()
            for pt in pats:
                if pt.search(b):
                    bad += 1; print('LEFT:', os.path.relpath(os.path.join(root, f), a.out), pt.pattern[:12]); break
    print(f'verify: {bad} files with a forbidden pattern')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
