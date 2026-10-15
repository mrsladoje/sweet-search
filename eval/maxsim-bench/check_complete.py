# python3 check_complete.py <jobs.json | results dir> [...]
# python3 check_complete.py --shards FREEZE.json --type intel <results root>
#     (S8: the shards intel-1..n of one type together; every group of the frozen shard table
#     must have its jobs.json on its own shard, and every job must validate)
#
# Passes (exit 0) only if every job listed in every jobs.json (run_matrix.py writes one per
# set group; a directory is searched for them) has its result file, with the job's key,
# complete, every call and every timing. summarize.py runs only after this passes.
import glob, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jobs  # noqa: E402


def job_files(paths):
    out = []
    for p in paths:
        if not os.path.exists(p):
            continue
        if os.path.isdir(p):
            out += sorted(glob.glob(os.path.join(p, '**', 'jobs.json'), recursive=True))
        else:
            out.append(p)
    return out


def check(paths):
    problems, n = [], 0
    files = job_files(paths)
    if not files:
        return 0, ['no jobs.json found']
    for jf in files:
        d = json.load(open(jf))
        base = os.path.dirname(jf)
        for j in d['jobs']:
            n += 1
            why = jobs.validate(os.path.join(base, j['file']), j['key'], j['expected_calls'], j['reps'], j.get('kind', 'matrix'))
            if why:
                problems.append(f"{os.path.relpath(os.path.join(base, j['file']))}: {why}")
    return n, problems


def check_shards(freeze, mtype, root):
    """All shards of one machine type: coverage of the frozen table, then every job."""
    tab = json.load(open(freeze)).get('shards', {}).get(mtype)
    if not tab:
        return 0, [f'FREEZE.json has no shard table for {mtype}']
    problems, dirs = [], []
    for k in range(1, tab['n'] + 1):
        d = os.path.join(root, f'{mtype}-{k}')
        dirs.append(d)
        have = {os.path.relpath(os.path.dirname(f), d) for f in job_files([d])}
        for g, kk in tab['assign'].items():
            if kk != k:
                continue
            if not (g in have or any(h.startswith(g + '/') for h in have)):  # matrix: <tag>/<set>; W6: <name>/<set>
                problems.append(f'{mtype}-{k}: group {g} has no jobs.json')
    n, more = check(dirs)
    return n, problems + more


if __name__ == '__main__':
    if sys.argv[1:2] == ['--shards']:
        fz, t, root = sys.argv[2], sys.argv[sys.argv.index('--type') + 1], sys.argv[-1]
        n, problems = check_shards(fz, t, root)
    else:
        n, problems = check(sys.argv[1:])
    for x in problems:
        print('INCOMPLETE', x)
    print(f'{n - len(problems)} of {n} jobs complete' + ('' if not problems else f'; {len(problems)} not'))
    sys.exit(1 if problems or n == 0 else 0)
