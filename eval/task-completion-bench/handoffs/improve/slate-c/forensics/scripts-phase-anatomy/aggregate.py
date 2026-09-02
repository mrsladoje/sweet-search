#!/usr/bin/env python3
"""aggregate.py -- per-harness, per-phase tables (sweet minus native) from data/anatomy.json.

Usage: python3 aggregate.py [--boundary read|sight] [--json out.json]

Two localize/understand boundaries are supported:
  read   first request with a READ-class call on a file the final patch edits (task statement)
  sight  first request whose tool OUTPUT (or call target) names a file the final patch edits;
         arm-neutral: an `rg -n` hit, an `ss-search` body, a `glob` listing all count
Post-first-edit phases (edit / verify / narrate / finalize) are identical under both.
All means are per rollout. Paired deltas: per task, mean over the 3 reps per arm, sweet minus
native; then mean and median over tasks; 'S>N' counts tasks where sweet's per-task mean is larger.
"""
import json, sys, os, statistics, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data', 'anatomy.json')
PHASES = ['localize', 'understand', 'edit', 'verify', 'narrate', 'finalize']
CLASSES = ['edit', 'test', 'exec', 'delegate', 'read', 'search', 'git', 'poll', 'plan', 'other', 'text']
METRICS = ['req', 'newIn', 'resent', 'out', 'cost']


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


BOUNDARY = arg('--boundary', 'sight')
JSON_OUT = arg('--json', None)


def rephase(r, boundary):
    """Return list of phases per request under the chosen boundary."""
    m = r['marks']
    fe = m['first_edit']
    b = m['first_read'] if boundary == 'read' else m['first_sight']
    n = r['n_req']
    if b is None:
        b = fe if fe is not None else n
    out = []
    for q in r['requests']:
        i = q['i']
        stored = q['phase']
        if fe is not None and i >= fe:
            out.append(stored)
        elif stored == 'finalize':
            out.append('finalize')
        else:
            out.append('localize' if i < b else 'understand')
    return out


def per_rollout(r, boundary):
    ph = rephase(r, boundary)
    agg = {p: {k: 0.0 for k in METRICS} | {'classes': collections.Counter(), 'calls': 0, 'err': 0, 'edit_fail': 0} for p in PHASES}
    for q, p in zip(r['requests'], ph):
        a = agg[p]
        a['req'] += 1
        a['newIn'] += q['newIn']
        a['resent'] += q['resent']
        a['out'] += q['out']
        a['cost'] += q['cost']
        a['calls'] += q['n_calls']
        a['err'] += int(q['err'])
        a['edit_fail'] += int(q['edit_fail'])
        a['classes'][q['class']] += 1
    return agg, ph


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def fmt(x, k):
    if k == 'cost':
        return f"{x:+.6f}" if x < 0 or True else f"{x:.6f}"
    return f"{x:+.2f}" if abs(x) < 100 else f"{x:+,.0f}"


def main():
    d = json.load(open(DATA))
    report = {'boundary': BOUNDARY, 'harnesses': {}}
    for h, H in d['harnesses'].items():
        rolls = H['rollouts']
        tasks = H['selected']
        byarm = {'native': [r for r in rolls if r['arm'] == 'native'], 'sweet': [r for r in rolls if r['arm'] == 'sweet']}
        print(f"\n\n# {h}  runs={H['runs']}  tasks={len(tasks)}  rollouts native={len(byarm['native'])} sweet={len(byarm['sweet'])}  boundary={BOUNDARY}")
        print("solved-everywhere tasks: " + ', '.join(tasks))
        if H['problems']:
            print("PROBLEMS:", H['problems'])
        # per-rollout phase aggregates
        PR = {}
        for r in rolls:
            PR[r['rid']] = per_rollout(r, BOUNDARY)[0]
        # arm means per phase
        arm_means = {}
        for arm, rs in byarm.items():
            arm_means[arm] = {p: {k: mean([PR[r['rid']][p][k] for r in rs]) for k in METRICS} | {
                'calls': mean([PR[r['rid']][p]['calls'] for r in rs]),
                'err': mean([PR[r['rid']][p]['err'] for r in rs]),
                'edit_fail': mean([PR[r['rid']][p]['edit_fail'] for r in rs])} for p in PHASES}
            arm_means[arm]['TOTAL'] = {k: sum(arm_means[arm][p][k] for p in PHASES) for k in METRICS}
        # paired per task
        paired = {p: {k: [] for k in METRICS} for p in PHASES + ['TOTAL']}
        pertask = {}
        for t in tasks:
            tn = [r for r in byarm['native'] if r['task'] == t]
            ts = [r for r in byarm['sweet'] if r['task'] == t]
            if not tn or not ts:
                continue
            pertask[t] = {}
            for p in PHASES + ['TOTAL']:
                for k in METRICS:
                    if p == 'TOTAL':
                        n_ = mean([sum(PR[r['rid']][pp][k] for pp in PHASES) for r in tn])
                        s_ = mean([sum(PR[r['rid']][pp][k] for pp in PHASES) for r in ts])
                    else:
                        n_ = mean([PR[r['rid']][p][k] for r in tn])
                        s_ = mean([PR[r['rid']][p][k] for r in ts])
                    paired[p][k].append(s_ - n_)
                    pertask[t][(p, k)] = (n_, s_)
        print(f"\n## Per-phase means per rollout (native | sweet | sweet-native mean over tasks | median | tasks S>N of {len(pertask)})")
        print("| phase | metric | native | sweet | Δ mean | Δ median | S>N |")
        print("|---|---|---:|---:|---:|---:|---:|")
        for p in PHASES + ['TOTAL']:
            for k in METRICS:
                n_ = arm_means['native'][p][k]
                s_ = arm_means['sweet'][p][k]
                ds = paired[p][k]
                gt = sum(1 for x in ds if x > 1e-12)
                if k == 'cost':
                    print(f"| {p} | {k} | {n_:.6f} | {s_:.6f} | {mean(ds):+.6f} | {statistics.median(ds):+.6f} | {gt} |")
                else:
                    print(f"| {p} | {k} | {n_:,.1f} | {s_:,.1f} | {mean(ds):+,.1f} | {statistics.median(ds):+,.1f} | {gt} |")
        # compact request table
        print(f"\n## Requests per rollout by phase (compact)")
        print("| phase | native | sweet | Δ | share of Δ total |")
        print("|---|---:|---:|---:|---:|")
        dtot = mean(paired['TOTAL']['req']) or 1e-9
        for p in PHASES + ['TOTAL']:
            n_ = arm_means['native'][p]['req']
            s_ = arm_means['sweet'][p]['req']
            dm = mean(paired[p]['req'])
            print(f"| {p} | {n_:.2f} | {s_:.2f} | {dm:+.2f} | {100 * dm / dtot:+.0f}% |")
        # class census per phase per arm
        print(f"\n## Request classes per rollout, by phase (native / sweet)")
        print("| phase | " + " | ".join(CLASSES) + " |")
        print("|---|" + "---|" * len(CLASSES))
        classdelta = collections.Counter()
        for p in PHASES:
            cells = []
            for c in CLASSES:
                n_ = mean([PR[r['rid']][p]['classes'][c] for r in byarm['native']])
                s_ = mean([PR[r['rid']][p]['classes'][c] for r in byarm['sweet']])
                classdelta[c] += s_ - n_
                cells.append(f"{n_:.2f}/{s_:.2f}" if (n_ or s_) else "·")
            print(f"| {p} | " + " | ".join(cells) + " |")
        print("\n### Class deltas summed over phases (sweet − native requests per rollout)")
        print("| class | Δ req/rollout |")
        print("|---|---:|")
        for c, v in sorted(classdelta.items(), key=lambda kv: -abs(kv[1])):
            print(f"| {c} | {v:+.2f} |")
        # per-arm calls per request, first-request ingest, errors, edit fails, never_read
        print("\n## Arm-level facts")
        for arm, rs in byarm.items():
            calls = mean([r['n_calls'] for r in rs])
            reqs = mean([r['n_req'] for r in rs])
            first_in = mean([r['first_req_in'] for r in rs])
            nr = sum(1 for r in rs if r['never_read'])
            errs = mean([sum(PR[r['rid']][p]['err'] for p in PHASES) for r in rs])
            ef = mean([sum(PR[r['rid']][p]['edit_fail'] for p in PHASES) for r in rs])
            fs = [r['marks']['first_sight'] for r in rs if r['marks']['first_sight'] is not None]
            fr = [r['marks']['first_read'] for r in rs if r['marks']['first_read'] is not None]
            fe = [r['marks']['first_edit'] for r in rs if r['marks']['first_edit'] is not None]
            side_req = mean([sum(r['side'][p]['req'] for p in PHASES) for r in rs])
            side_cost = mean([sum(r['side'][p]['cost'] for p in PHASES) for r in rs])
            side_nou = sum(sum(r['side'][p]['no_usage'] for p in PHASES) for r in rs)
            side_files = sum(r['side_files'] for r in rs)
            print(f"- {arm}: requests {reqs:.2f}/rollout, tool calls {calls:.2f}/rollout ({calls / reqs:.2f} calls/request); first-request context {first_in:,.0f} tokens; "
                  f"error-bearing requests {errs:.2f}/rollout; failed-edit requests {ef:.2f}/rollout; rollouts that never READ the edited file {nr}/{len(rs)}; "
                  f"first_sight idx mean {mean(fs):.2f}, first_read idx mean {mean(fr):.2f} (n={len(fr)}), first_edit idx mean {mean(fe):.2f}; "
                  f"sidechain files {side_files}, sidechain requests {side_req:.2f}/rollout (no-usage {side_nou}), sidechain cost {side_cost:.6f}/rollout")
        # top gaps per (task, phase)
        gaps = []
        for t, pt in pertask.items():
            for p in PHASES:
                n_, s_ = pt[(p, 'req')]
                gaps.append((s_ - n_, t, p, n_, s_))
        gaps.sort(key=lambda g: -abs(g[0]))
        print("\n## Largest per-task per-phase request gaps (sweet − native, mean per rollout)")
        print("| task | phase | native | sweet | Δ | rollouts (native req by phase) | rollouts (sweet req by phase) |")
        print("|---|---|---:|---:|---:|---|---|")
        for g in gaps[:12]:
            dv, t, p, n_, s_ = g
            nrs = [r for r in byarm['native'] if r['task'] == t]
            srs = [r for r in byarm['sweet'] if r['task'] == t]
            nd = '; '.join(f"rep{r['rep']}:{int(PR[r['rid']][p]['req'])}" for r in nrs)
            sd = '; '.join(f"rep{r['rep']}:{int(PR[r['rid']][p]['req'])}" for r in srs)
            print(f"| {t} | {p} | {n_:.2f} | {s_:.2f} | {dv:+.2f} | {nd} | {sd} |")
        # per-task total request table
        print("\n## Per-task total requests per rollout (native | sweet | Δ) and cost")
        print("| task | req N | req S | Δ req | cost N | cost S | Δ cost |")
        print("|---|---:|---:|---:|---:|---:|---:|")
        for t, pt in pertask.items():
            n_, s_ = pt[('TOTAL', 'req')]
            cn, cs = pt[('TOTAL', 'cost')]
            print(f"| {t} | {n_:.2f} | {s_:.2f} | {s_ - n_:+.2f} | {cn:.6f} | {cs:.6f} | {cs - cn:+.6f} |")
        report['harnesses'][h] = {'tasks': tasks, 'arm_means': arm_means, 'paired_mean': {p: {k: mean(paired[p][k]) for k in METRICS} for p in paired},
                                  'paired_median': {p: {k: statistics.median(paired[p][k]) for k in METRICS} for p in paired},
                                  'class_delta': dict(classdelta), 'gaps': gaps[:20],
                                  'pertask': {t: {f"{p}/{k}": v for (p, k), v in pt.items()} for t, pt in pertask.items()}}
    if JSON_OUT:
        with open(JSON_OUT, 'w') as fo:
            json.dump(report, fo, indent=1)


if __name__ == '__main__':
    main()
