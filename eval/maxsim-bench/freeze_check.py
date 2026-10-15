# python3 freeze_check.py FREEZE.json            exit 0 only if every frozen file matches
# python3 freeze_check.py --write FREEZE.json --R N --delta D [--w6-rates w6-rates.json (w6_rates.py)]
#         [--optional W4=out,W10=out] [--set DIR ...] [--shards FILE ...]
#         (step S7; the owner confirms delta; --shards: the tables of plan_groups.py
#         --print-shards, one file per machine type, merged into "shards")
#
# FREEZE.json (PAPER_PLAN.md rule 2) records the paper commit and the SHA-256 of every file
# that shapes a paper number: the kernel source, the C ABI and rival shims, every arm
# adapter, the analysis scripts, the cloud scripts, the lock files, every shortlist, the
# dataset manifests; plus R, delta, the W6 rates, the primary quality comparisons, the
# claim-upgrade rule and which optional items are in. run.sh refuses held-out modes unless
# this check passes. Paths are relative to the repository root.
import argparse, glob, hashlib, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..'))
FROZEN_GLOBS = [
    'crates/sweet-search-native/src/maxsim/*.rs',
    'eval/maxsim-bench/capi/Cargo.toml', 'eval/maxsim-bench/capi/Cargo.lock', 'eval/maxsim-bench/capi/src/*.rs',
    'eval/maxsim-bench/rivals-rs/Cargo.toml', 'eval/maxsim-bench/rivals-rs/Cargo.lock', 'eval/maxsim-bench/rivals-rs/src/*.rs',
    'eval/maxsim-bench/third_party/segmented_maxsim.cpp',
    'eval/maxsim-bench/*.py', 'eval/maxsim-bench/*.mjs', 'eval/maxsim-bench/aws/*.sh',
    'eval/maxsim-bench/requirements*.lock', 'eval/maxsim-bench/shortlist-*.json',
    'core/infrastructure/simd-distance.js', 'core/infrastructure/maxsim-pack.js', 'core/infrastructure/native-resolver.js',
    'core/ranking/late-interaction-index.js', 'core/infrastructure/maxsim.wasm',
]
CLAIM_RULE = ('Use the stronger claim only if all hold: (a) at 14 query tokens, pool 25, 366 doc tokens per candidate, the fixed '
              'share f/t of the fastest rival is > 50% on at least 4 of 5 CPUs; (b) the cost model predicts the measured winner on '
              '>= 80% of held-out sweep cells; (c) it beats the constant-winner baseline by >= 10 percentage points on held-out '
              'cells. Otherwise the narrow claim.')
PRIMARY_QUALITY = [f'beir-{d}-{m}-k100' for d in ('scifact', 'nfcorpus') for m in ('colbertv2', 'answersmall')]


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def frozen_files():
    out = set()
    for g in FROZEN_GLOBS:
        out.update(os.path.relpath(f, SRC) for f in glob.glob(os.path.join(SRC, g)))
    return sorted(out)


def check(path):
    fz = json.load(open(path))
    bad = []
    for rel, want in fz['files'].items():
        f = os.path.join(SRC, rel)
        if not os.path.exists(f):
            bad.append(f'missing {rel}')
        elif sha(f) != want:
            bad.append(f'changed {rel}')
    new = [f for f in frozen_files() if f not in fz['files'] and not f.endswith('FREEZE.json')]
    bad += [f'not frozen {f}' for f in new]
    for t, tab in fz.get('shards', {}).items():  # S8 shard table (plan_groups.py --print-shards)
        n = tab.get('n')
        if not isinstance(n, int) or n < 1 or not tab.get('assign'):
            bad.append(f'shards {t}: no n or no assignment')
        elif any(not isinstance(k, int) or not 1 <= k <= n for k in tab['assign'].values()):
            bad.append(f'shards {t}: a shard number outside 1..{n}')
        elif sorted(set(tab['assign'].values())) != list(range(1, n + 1)):
            bad.append(f'shards {t}: a shard without groups')
    return bad


if __name__ == '__main__':
    if sys.argv[1:2] != ['--write']:
        bad = check(sys.argv[1]) if len(sys.argv) > 1 and os.path.exists(sys.argv[1]) else ['FREEZE.json missing']
        print('\n'.join(bad) or 'freeze check passed')
        sys.exit(1 if bad else 0)
    p = argparse.ArgumentParser()
    p.add_argument('--write', required=True)
    p.add_argument('--R', type=int, required=True)
    p.add_argument('--delta', type=float, required=True)
    p.add_argument('--w6-rates')
    p.add_argument('--optional', default='W4=out,W10=out')
    p.add_argument('--set', action='append', default=[])
    p.add_argument('--shards', action='append', default=[])
    a = p.parse_args()
    sys.path.insert(0, HERE)
    from set_manifest import set_hash
    commit = subprocess.run(['git', '-C', SRC, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(['git', '-C', SRC, 'status', '--porcelain', '--', *FROZEN_GLOBS], capture_output=True, text=True).stdout.strip()
    fz = dict(made=time.strftime('%Y-%m-%dT%H:%M:%S'), commit=commit, commit_clean=not dirty, R=a.R, delta=a.delta,
              delta_note='absolute nDCG@10; confirmed by the owner at S7',
              w6_rates=json.load(open(a.w6_rates)) if a.w6_rates else {}, primary_quality=PRIMARY_QUALITY,
              claim_upgrade_rule=CLAIM_RULE, optional=dict(x.split('=') for x in a.optional.split(',')),
              sets={os.path.basename(s.rstrip('/')): set_hash(s) for s in a.set},
              shards={t: tab for f in a.shards for t, tab in json.load(open(f)).items()},
              files={f: sha(os.path.join(SRC, f)) for f in frozen_files()})
    json.dump(fz, open(a.write, 'w'), indent=1)
    print(f'{a.write}: {len(fz["files"])} files, commit {commit[:12]}' + ('' if fz['commit_clean'] else ' (frozen files differ from the commit: commit them first)'))
