# python3 shard_weights.py <results/MACHINE> --heldout-groups FILE > weights-TYPE.json
#   (FILE: plan_groups.py heldout --machine TYPE --replay ROOT --shortlist shortlist-TYPE.json --beir ROOT --R N)
#
# The --weights file of plan_groups.py --print-shards (PAPER_PLAN.md 9a F3): estimated
# seconds per held-out group, from the S5 dev run of one machine of the type. Dev data only
# (timing of dev jobs; nothing from a held-out or BEIR set is read except call counts from
# the index files).
#
# --heldout-groups: the JSON lines of `plan_groups.py heldout ...` (without --print-shards).
# For each held-out group, its dev twin: tag ho-X -> dev-X (ho-conc-<set> -> dev-conc-<dev
# set>), set agent-ho -> agent-dev, gcsn-ho -> gcsn-dev, a sweep-ho cell -> the sweep-dev
# cell of the same name. BEIR groups have no dev twin and are left out (plan_groups.py
# scales its proxy for them by the median measured/proxy ratio).
#
# Matrix groups: per arm, the wall time of each dev job (matrix.log: from "cpu busy ...
# before ARM" to "rR pP ARM:"), split over the sets of the job by the job's timed
# nanoseconds per set, then scaled by calls (held-out / dev) and by process repetitions x
# rounds. An arm of the held-out group that has no dev job gets the mean of its group.
# Concurrency (W6) groups: the dev group's wall time (run.log), scaled by calls and arms. A dev
# set path of the machine (/opt/replay/...) that is not here is looked up next to the held-out set.
import argparse, collections, datetime, hashlib, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from replay_py import count_calls  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('results')
p.add_argument('--heldout-groups', required=True)
a = p.parse_args()

TS = re.compile(r'^(\d\d):(\d\d):(\d\d) (.*)$')


def secs(h, m, s):
    return int(h) * 3600 + int(m) * 60 + int(s)


def arg(args, k, d):
    return type(d)(args[args.index(k) + 1]) if k in args else d


def dev_set_name(ho):
    return {'agent-ho': 'agent-dev', 'gcsn-ho': 'gcsn-dev'}.get(ho, ho)


# ---- dev: seconds per (tag, arm, set) for matrix jobs
per_arm = collections.defaultdict(float)      # (tag, arm, set) -> seconds (dev run)
dev_shape = {}                                # (tag, set) -> (procs * rounds, calls)
for tag in sorted(os.listdir(a.results)):
    tdir = os.path.join(a.results, tag)
    if not tag.startswith('dev-') or not os.path.isdir(tdir):
        continue
    for grp in sorted(os.listdir(tdir)):
        gdir = os.path.join(tdir, grp)
        jf, ml = os.path.join(gdir, 'jobs.json'), os.path.join(gdir, 'matrix.log')
        if not (os.path.exists(jf) and os.path.exists(ml)):
            continue
        jobs = json.load(open(jf))['jobs']
        # wall time per job, in log order
        walls, start, prev = collections.defaultdict(list), None, None
        for line in open(ml):
            m = TS.match(line.rstrip('\n'))
            if not m:
                continue
            t, rest = secs(*m.groups()[:3]), m.group(4)
            if prev is not None and t < prev - 43200:
                t += 86400   # past midnight
            prev = t
            if rest.startswith('cpu busy') or rest.startswith('start machine='):
                start = t
            mm = re.match(r'r(\d+) p(\d+) (\S+): ', rest)
            if mm and start is not None:
                walls[(mm.group(3), int(mm.group(1)), int(mm.group(2)))].append(max(1, t - start))
                start = t
        for j in jobs:
            w = walls.get((j['arm'], j['round'], j['proc']))
            f = os.path.join(gdir, j['file'])
            if not w or not os.path.exists(f):
                continue
            d = json.load(open(f))
            calls = d.get('calls') or []   # W11 (mem) files have no per-call timings
            ns = collections.Counter()
            for c in calls:
                ns[c['set']] += sum(c.get('ts_ns', [])) or 1
            if not calls:
                for s in j['sets']:
                    ns[os.path.basename(s.rstrip('/'))] += 1
            tot = sum(ns.values()) or 1
            for s, v in ns.items():
                per_arm[(tag, j['arm'], s)] += w[-1] * v / tot
                n_runs = len({(x['round'], x['proc']) for x in jobs if x['arm'] == j['arm']})
                dev_shape[(tag, s)] = (n_runs, sum(1 for c in calls if c['set'] == s) or j['expected_calls'])

# ---- dev: wall time of the concurrency groups (run.log, by group id as run.sh hashes it)
conc_wall = {}
gfile, rlog = os.path.join(a.results, 'groups-dev.jsonl'), os.path.join(a.results, 'run.log')
if os.path.exists(gfile) and os.path.exists(rlog):
    ids = {}
    for line in open(gfile):
        line = line.rstrip('\n')
        if line:
            ids[hashlib.sha256(line.encode()).hexdigest()[:16]] = json.loads(line)
    t0 = {}
    for line in open(rlog):
        m = re.match(r'^(\S+Z) group (\S+) \(([0-9a-f]{16})\) start', line)
        if m:
            t0[m.group(3)] = datetime.datetime.fromisoformat(m.group(1).replace('Z', '+00:00'))
        m = re.match(r'^(\S+Z) group (\S+) ok', line)
        if m:
            for gid_, g in ids.items():
                if g['name'] == m.group(2) and g['kind'] == 'concurrency' and gid_ in t0:
                    conc_wall[g['name']] = ((datetime.datetime.fromisoformat(m.group(1).replace('Z', '+00:00')) - t0[gid_]).total_seconds(), g)

# ---- held-out estimates
out, missing = {}, []
calls_cache = {}


def ncalls(root, limit=0, stride=1):
    k = (root, limit, stride)
    if k not in calls_cache:
        calls_cache[k] = count_calls(root, limit, stride)
    return calls_cache[k]


for line in open(a.heldout_groups):
    if not line.strip():
        continue
    g = json.loads(line)
    if g['kind'] != 'matrix':
        dname = re.sub(r'-(agent|gcsn)-ho$', lambda m: f'-{m.group(1)}-dev', g['name'].replace('ho-conc-', 'dev-conc-'))
        if dname not in conc_wall:
            missing.append(g['name']); continue
        w, dg = conc_wall[dname]
        dset = dg['set'] if os.path.isdir(dg['set']) else os.path.join(os.path.dirname(g['set'].rstrip('/')), os.path.basename(dg['set'].rstrip('/')))
        out[g['name']] = w * ncalls(g['set']) / max(1, ncalls(dset)) * len(g['arms']) / max(1, len(dg['arms']))
        continue
    args = g['args']
    sets = [args[i + 1] for i, x in enumerate(args) if x == '--set']
    arms = [args[i + 1] for i, x in enumerate(args) if x == '--arm']
    hset = os.path.basename(sets[0].rstrip('/'))
    gid = f"{g['name']}/{hset}"
    if hset.startswith('beir-'):
        continue
    dtag, dset = g['name'].replace('ho-', 'dev-', 1), dev_set_name(hset)
    if (dtag, dset) not in dev_shape:
        missing.append(gid); continue
    runs_dev, calls_dev = dev_shape[(dtag, dset)]
    runs_ho = arg(args, '--procs', 1) * arg(args, '--rounds', 2)
    if '--mem' in args:
        runs_ho, scale = 1, 1.0   # the W11 pass samples calls up to a token budget: no call scaling
    else:
        scale = ncalls(sets[0], arg(args, '--limit', 0), arg(args, '--stride', 1)) / max(1, calls_dev)
    have = [per_arm[(dtag, x, dset)] / runs_dev for x in arms if (dtag, x, dset) in per_arm]
    if not have:
        missing.append(gid); continue
    mean = sum(have) / len(have)
    per_run = sum(per_arm[(dtag, x, dset)] / runs_dev if (dtag, x, dset) in per_arm else mean for x in arms)
    out[gid] = per_run * runs_ho * scale

print(json.dumps(out, indent=1, sort_keys=True))
print(f'shard_weights: {len(out)} groups measured, {len(missing)} without a dev twin: {missing[:8]}', file=sys.stderr)
