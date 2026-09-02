#!/usr/bin/env python3
"""tail_extras.py -- the secondary analyses quoted in verify-tail.md, over tail-census.json:
  1. head (through the last edit) vs tail cost per cell
  2. plan-tool requests (update_plan / todowrite / TodoWrite): count, position, predecessor,
     attribution cost vs counterfactual saving (output + re-send only)
  3. post-edit retrieval prevalence and the aws-actions bundle hunt
  4. rollouts whose last edit is never followed by a run_tests
  5. claude-code text-only requests after the final answer (late subagent returns)
Usage: python3 tail_extras.py tail-census.json
"""
import json, sys, collections

J = json.load(open(sys.argv[1]))
R = [r for r in J['rollouts'] if r['ok']]
by = collections.defaultdict(list)
for r in R:
    by[(r['harness'], r['arm'])].append(r)
H = ['codex', 'opencode', 'claude-code']
RET = {'ss_search', 'ss_read_other', 'native_read', 'native_find', 'reread_edited'}


def plan_only(x):
    return bool(x['calls']) and all(c['cls'] == 'plan' for c in x['calls'])


print('## 1. Head (through last edit) vs tail cost per rollout')
print('| cell | rollout $ | head $ | tail $ | head req | tail req |')
for h in H:
    for arm in ['native', 'sweet']:
        rs = [r for r in by[(h, arm)] if r['last_edit'] is not None]
        n = len(rs)
        tot = sum(r['usd'] for r in rs) / n
        tail = sum(sum(x['usd'] for x in r['requests'] if x['i'] > r['last_edit']) for r in rs) / n
        hreq = sum(r['last_edit'] + 1 for r in rs) / n
        treq = sum(r['n_req'] - r['last_edit'] - 1 for r in rs) / n
        print('| %s/%s | %.6f | %.6f | %.6f | %.2f | %.2f |' % (h, arm, tot, tot - tail, tail, hreq, treq))

print('\n## 2. Plan-tool requests')
print('| cell | plan calls | plan-only requests | per rollout | share of requests | attributed $ share | counterfactual saving/req | saving/rollout | share of rollout $ | first-request plan | in tail | plan->plan consecutive |')
for h in H:
    for arm in ['native', 'sweet']:
        rs = by[(h, arm)]
        n = len(rs)
        calls = sum(1 for r in rs for x in r['requests'] for c in x['calls'] if c['cls'] == 'plan')
        po = [x for r in rs for x in r['requests'] if plan_only(x)]
        tail = sum(1 for r in rs for x in r['requests'] if plan_only(x) and r['last_edit'] is not None and x['i'] > r['last_edit'])
        first = sum(1 for r in rs if r['requests'] and plan_only(r['requests'][0]))
        consec = sum(1 for r in rs for x in r['requests'] if plan_only(x) and x['i'] > 0 and r['requests'][x['i'] - 1]['cls'] == 'plan')
        cell = sum(r['usd'] for r in rs)
        reqs = sum(r['n_req'] for r in rs)
        sav = sum((x['out'] * 0.60 + x['cached'] * 0.01) / 1e6 for x in po)
        print('| %s/%s | %d | %d | %.2f | %.1f%% | %.1f%% | $%.6f | $%.6f | %.1f%% | %d | %d | %d |' % (
            h, arm, calls, len(po), len(po) / n, 100 * len(po) / reqs, 100 * sum(x['usd'] for x in po) / cell,
            sav / len(po), sav / n, 100 * sav / cell, first, tail, consec))
print('\nPredecessor class of plan-only requests and edit->plan adjacency:')
for h in H:
    for arm in ['native', 'sweet']:
        pred = collections.Counter()
        e = ep = 0
        for r in by[(h, arm)]:
            reqs = r['requests']
            for x in reqs:
                if plan_only(x) and x['i'] > 0:
                    pred[reqs[x['i'] - 1]['cls']] += 1
                if x['is_edit']:
                    e += 1
                    nxt = reqs[x['i'] + 1] if x['i'] + 1 < len(reqs) else None
                    if nxt and plan_only(nxt):
                        ep += 1
        print('  %s/%s: predecessors %s ; edit requests %d, followed by a plan-only request %d (%.0f%%)' % (h, arm, pred.most_common(6), e, ep, 100 * ep / e))

print('\n## 3. Post-edit retrieval prevalence')
print('| cell | rollouts with tail retrieval | mean tail retrieval req | solved mean | unsolved mean | tail retrieval $/rollout |')
for h in H:
    for arm in ['native', 'sweet']:
        rs = [r for r in by[(h, arm)] if r['last_edit'] is not None]
        cnt = tot = 0
        usd = 0.0
        s, u = [], []
        for r in rs:
            t = [x for x in r['requests'] if x['i'] > r['last_edit'] and x['cls'] in RET]
            cnt += bool(t)
            tot += len(t)
            usd += sum(x['usd'] for x in t)
            (s if r['resolved'] else u).append(len(t))
        print('| %s/%s | %d/%d | %.2f | %.2f | %.2f | $%.6f |' % (h, arm, cnt, len(rs), tot / len(rs), sum(s) / len(s), sum(u) / len(u), usd / len(rs)))
print('\naws-actions__configure-aws-credentials-42 per rollout (tail req, tail $, retrieval req in tail, calls naming dist/ in tail, edited files):')
for h in H:
    for arm in ['native', 'sweet']:
        for r in by[(h, arm)]:
            if r['task'] != 'aws-actions__configure-aws-credentials-42':
                continue
            t = [x for x in r['requests'] if x['i'] > r['last_edit']]
            ret = [x for x in t if x['cls'] in RET]
            dist = sum(1 for x in t for c in x['calls'] if 'dist/' in c['cmd'])
            print('  %s solved=%s n_req=%d tail=%d tail$=%.6f rollout$=%.6f retrieval=%d dist_calls=%d edited=%s' % (r['rid'], r['resolved'], r['n_req'], len(t), sum(x['usd'] for x in t), r['usd'], len(ret), dist, r['edited_files']))
print('\nss-grep/ss-read/ss-semantic calls naming dist/index.js in sweet rollouts, with the output head:')
for h in H:
    for r in by[(h, 'sweet')]:
        for x in r['requests']:
            for c in x['calls']:
                if 'dist/index.js' in c['cmd'] and c['cls'] in RET:
                    print('  %s %s/r%d req%d %s :: %r -> %r' % (h, r['task'], r['rep'], x['i'], 'tail' if x['i'] > r['last_edit'] else 'head', c['cmd'][:90], c['out_head'][:110]))

print('\n## 4. Rollouts whose LAST edit is never followed by a run_tests')
for h in H:
    for arm in ['native', 'sweet']:
        ids = []
        for r in by[(h, arm)]:
            le = r['last_edit']
            if le is None:
                continue
            reqs = r['requests']
            tail_rt = any(c['cls'] in ('run_tests', 'rt_poll', 'direct_test') for x in reqs if x['i'] > le for c in x['calls'])
            edit_rt = any('run_tests' in c['kinds'] for c in reqs[le]['calls'])
            if not tail_rt and not edit_rt:
                ids.append((r['rid'], r['resolved'], r['rtEndedUnverified']))
        print('  %s/%s: %d (solved %d; rtEndedUnverified flag set on %d): %s' % (h, arm, len(ids), sum(1 for i in ids if i[1]), sum(1 for i in ids if i[2]), '; '.join(i[0] for i in ids)))
print('\nrun_tests calls in the tail per rollout (distribution):')
for h in H:
    for arm in ['native', 'sweet']:
        c = collections.Counter()
        for r in by[(h, arm)]:
            le = r['last_edit']
            if le is None:
                continue
            c[sum(1 for x in r['requests'] if x['i'] > le for cc in x['calls'] if cc['cls'] == 'run_tests')] += 1
        print('  %s/%s: %s' % (h, arm, dict(sorted(c.items()))))

print('\n## 5. Text-only requests in the tail beyond the final answer')
for h in H:
    for arm in ['native', 'sweet']:
        for r in by[(h, arm)]:
            if r['last_edit'] is None:
                continue
            t = [x for x in r['requests'] if x['i'] > r['last_edit'] and x['cls'] == 'text_only']
            if len(t) > 1:
                print('  %s text_only in tail=%d resolved=%s heads=%s' % (r['rid'], len(t), r['resolved'], [x['text_head'][:60] for x in t]))
