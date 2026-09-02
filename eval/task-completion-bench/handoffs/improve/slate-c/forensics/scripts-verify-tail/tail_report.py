#!/usr/bin/env python3
"""tail_report.py -- analyse tail-census.json (from tail_census.py) and print markdown tables.

Tail definition (primary): every billed request with index > index of the LAST edit request
(edit attempt, failed or not). Variant: after the last SUCCESSFUL edit request.
Removable tail: the tail minus the final text-only answer request (the answer is not removable).
"""
import json, sys, collections, statistics as st

J = json.load(open(sys.argv[1]))
R = [r for r in J['rollouts'] if r.get('ok')]
OUT = {}

CLASSES = ['run_tests', 'rt_poll', 'direct_test', 'git_diff_status', 'git_other', 'git_revert', 'reread_edited',
           'ss_read_other', 'ss_search', 'native_read', 'native_find', 'delegate', 'poll', 'plan', 'other', 'text_only', 'edit']
SWEET_CLS = {'ss_read_other', 'ss_search'}
NATIVE_CLS = {'native_read', 'native_find'}


def q(xs, p):
    if not xs:
        return 0
    s = sorted(xs)
    k = int(round((len(s) - 1) * p))
    return s[k]


def fmt(x, d=2):
    return ('%.' + str(d) + 'f') % x


def tail_of(r, variant='last_edit'):
    le = r.get(variant)
    if le is None:
        return None
    return [x for x in r['requests'] if x['i'] > le]


def cell_stats(rs, variant='last_edit'):
    S = dict(n=0, no_edit=0, tail_req=[], tail_usd=[], tail_share=[], tail_req_share=[], tail_in=[], tail_newin=[], tail_out=[],
             rem_req=[], rem_usd=[], rem_share=[], cls=collections.Counter(), calls_cls=collections.Counter(),
             rollout_usd=[], rollout_req=[], rt_in_tail=[], rt_verdicts_in_tail=[], sweet_calls=0, native_calls=0,
             head_usd_per_req=[], tail_usd_per_req=[], zero_tail=0, tail_ss=0)
    for r in rs:
        t = tail_of(r, variant)
        if t is None:
            S['no_edit'] += 1
            continue
        S['n'] += 1
        tot = r['usd']
        tu = sum(x['usd'] for x in t)
        S['rollout_usd'].append(tot)
        S['rollout_req'].append(r['n_req'])
        S['tail_req'].append(len(t))
        S['tail_usd'].append(tu)
        S['tail_share'].append(tu / tot if tot else 0)
        S['tail_req_share'].append(len(t) / r['n_req'])
        S['tail_in'].append(sum(x['inp'] for x in t))
        S['tail_out'].append(sum(x['out'] for x in t))
        # new-in tokens ingested in the tail (context growth caused by the tail)
        prev = r['requests'][r[variant]]['inp'] if r[variant] is not None else 0
        newin = 0
        for x in t:
            newin += max(0, x['inp'] - prev)
            prev = x['inp']
        S['tail_newin'].append(newin)
        rem = [x for x in t if not (x['cls'] == 'text_only' and x is t[-1])]
        S['rem_req'].append(len(rem))
        ru = sum(x['usd'] for x in rem)
        S['rem_usd'].append(ru)
        S['rem_share'].append(ru / tot if tot else 0)
        if not t:
            S['zero_tail'] += 1
        for x in t:
            S['cls'][x['cls']] += 1
            if x['ss']:
                S['tail_ss'] += 1
            for c in x['calls']:
                S['calls_cls'][c['cls']] += 1
                if c['cls'] in SWEET_CLS:
                    S['sweet_calls'] += 1
                if c['cls'] in NATIVE_CLS:
                    S['native_calls'] += 1
        nrt = sum(1 for x in t for c in x['calls'] if c['cls'] in ('run_tests',))
        S['rt_in_tail'].append(nrt)
        S['rt_verdicts_in_tail'].append(sum(1 for x in t for c in x['calls'] if c.get('rt_verdict')))
        head = [x for x in r['requests'] if x['i'] <= r[variant]]
        if head:
            S['head_usd_per_req'].append(sum(x['usd'] for x in head) / len(head))
        if t:
            S['tail_usd_per_req'].append(tu / len(t))
    return S


def summarize(S):
    n = S['n']
    if not n:
        return {}
    tot_usd = sum(S['rollout_usd'])
    return dict(
        n=n, no_edit=S['no_edit'], zero_tail=S['zero_tail'],
        tail_req_mean=sum(S['tail_req']) / n, tail_req_median=st.median(S['tail_req']), tail_req_p90=q(S['tail_req'], 0.9), tail_req_max=max(S['tail_req']),
        tail_req_total=sum(S['tail_req']), req_total=sum(S['rollout_req']),
        tail_req_share=sum(S['tail_req']) / sum(S['rollout_req']),
        tail_usd_mean=sum(S['tail_usd']) / n, tail_usd_share=sum(S['tail_usd']) / tot_usd,
        tail_share_median=st.median(S['tail_share']),
        rem_req_mean=sum(S['rem_req']) / n, rem_usd_mean=sum(S['rem_usd']) / n, rem_usd_share=sum(S['rem_usd']) / tot_usd,
        tail_in_mean=sum(S['tail_in']) / n, tail_newin_mean=sum(S['tail_newin']) / n, tail_out_mean=sum(S['tail_out']) / n,
        rollout_usd_mean=tot_usd / n, rollout_req_mean=sum(S['rollout_req']) / n,
        cls={k: S['cls'][k] for k in CLASSES if S['cls'][k]}, calls_cls={k: S['calls_cls'][k] for k in CLASSES if S['calls_cls'][k]},
        sweet_calls=S['sweet_calls'], native_calls=S['native_calls'],
        rt_in_tail_rollouts=sum(1 for x in S['rt_in_tail'] if x >= 1), rt2_in_tail_rollouts=sum(1 for x in S['rt_in_tail'] if x >= 2),
        rt_in_tail_total=sum(S['rt_in_tail']), rt_verdicts_in_tail=sum(S['rt_verdicts_in_tail']),
        head_usd_per_req=(sum(S['head_usd_per_req']) / len(S['head_usd_per_req'])) if S['head_usd_per_req'] else 0,
        tail_usd_per_req=(sum(S['tail_usd_per_req']) / len(S['tail_usd_per_req'])) if S['tail_usd_per_req'] else 0,
        tail_ss=S['tail_ss'])


by = collections.defaultdict(list)
for r in R:
    by[(r['harness'], r['arm'])].append(r)
HARN = ['codex', 'opencode', 'claude-code']

print('# Tail census (primary: after the LAST edit attempt)\n')
for variant in ['last_edit', 'last_ok_edit']:
    print('\n## Variant: %s\n' % variant)
    print('| harness | arm | n | no-edit | tail req mean | median | p90 | max | tail req share | tail $ mean | tail $ share | removable req mean | removable $ mean | removable $ share | tail $/req | head $/req | ratio |')
    print('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    for h in HARN:
        for arm in ['native', 'sweet']:
            S = summarize(cell_stats(by[(h, arm)], variant))
            OUT.setdefault(variant, {})['%s/%s' % (h, arm)] = S
            print('| %s | %s | %d | %d | %s | %s | %d | %d | %s%% | $%s | %s%% | %s | $%s | %s%% | $%s | $%s | %s |' % (
                h, arm, S['n'], S['no_edit'], fmt(S['tail_req_mean']), fmt(S['tail_req_median'], 1), S['tail_req_p90'], S['tail_req_max'],
                fmt(100 * S['tail_req_share'], 1), fmt(S['tail_usd_mean'], 6), fmt(100 * S['tail_usd_share'], 1),
                fmt(S['rem_req_mean']), fmt(S['rem_usd_mean'], 6), fmt(100 * S['rem_usd_share'], 1),
                fmt(S['tail_usd_per_req'], 6), fmt(S['head_usd_per_req'], 6), fmt(S['tail_usd_per_req'] / S['head_usd_per_req'] if S['head_usd_per_req'] else 0)))

print('\n## Solved vs unsolved (primary variant)\n')
print('| harness | arm | outcome | n | tail req mean | median | p90 | tail $ mean | tail $ share | removable req mean | removable $ share | run_tests reqs in tail (total) | rollouts with >=2 run_tests in tail |')
print('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for h in HARN:
    for arm in ['native', 'sweet']:
        for outcome in [True, False]:
            rs = [r for r in by[(h, arm)] if r['resolved'] == outcome]
            S = summarize(cell_stats(rs))
            if not S:
                continue
            OUT.setdefault('by_outcome', {})['%s/%s/%s' % (h, arm, 'solved' if outcome else 'unsolved')] = S
            print('| %s | %s | %s | %d | %s | %s | %d | $%s | %s%% | %s | %s%% | %d | %d |' % (
                h, arm, 'solved' if outcome else 'unsolved', S['n'], fmt(S['tail_req_mean']), fmt(S['tail_req_median'], 1), S['tail_req_p90'],
                fmt(S['tail_usd_mean'], 6), fmt(100 * S['tail_usd_share'], 1), fmt(S['rem_req_mean']), fmt(100 * S['rem_usd_share'], 1),
                S['rt_in_tail_total'], S['rt2_in_tail_rollouts']))

print('\n## Tail request classes (primary variant; requests classified by priority run_tests > rt_poll > direct_test > edit > git_revert > git_diff/status > git_other > reread_edited > ss_read_other > ss_search > native_read > native_find > delegate > poll > plan > other > text_only)\n')
hdr = ['run_tests', 'rt_poll', 'direct_test', 'git_diff_status', 'git_other', 'git_revert', 'reread_edited', 'ss_read_other', 'ss_search', 'native_read', 'native_find', 'delegate', 'poll', 'plan', 'other', 'text_only']
print('| cell | n | tail reqs | ' + ' | '.join(hdr) + ' |')
print('|---|---:|---:|' + '---:|' * len(hdr))
for h in HARN:
    for arm in ['native', 'sweet']:
        S = OUT['last_edit']['%s/%s' % (h, arm)]
        print('| %s/%s | %d | %d | ' % (h, arm, S['n'], S['tail_req_total']) + ' | '.join(str(S['cls'].get(k, 0)) for k in hdr) + ' |')
print('\nPer-rollout means:\n')
print('| cell | ' + ' | '.join(hdr) + ' |')
print('|---|' + '---:|' * len(hdr))
for h in HARN:
    for arm in ['native', 'sweet']:
        S = OUT['last_edit']['%s/%s' % (h, arm)]
        print('| %s/%s | ' % (h, arm) + ' | '.join(fmt(S['cls'].get(k, 0) / S['n']) for k in hdr) + ' |')

print('\n## Tail CALL classes (every tool call inside tail requests; opencode/claude pack several calls per request)\n')
hdr2 = ['run_tests', 'rt_poll', 'direct_test', 'git_diff_status', 'git_other', 'git_revert', 'reread_edited', 'ss_read_other', 'ss_search', 'native_read', 'native_find', 'delegate', 'poll', 'plan', 'other']
print('| cell | tail calls | ' + ' | '.join(hdr2) + ' | sweet-specific (ss-*) | native-specific (Read/Grep/Glob/cat/sed) |')
print('|---|---:|' + '---:|' * (len(hdr2) + 2))
for h in HARN:
    for arm in ['native', 'sweet']:
        S = OUT['last_edit']['%s/%s' % (h, arm)]
        tot = sum(S['calls_cls'].values())
        print('| %s/%s | %d | ' % (h, arm, tot) + ' | '.join(str(S['calls_cls'].get(k, 0)) for k in hdr2) + ' | %d | %d |' % (S['sweet_calls'], S['native_calls']))

# ---- paired per-task comparison ----
print('\n## Paired per-task comparison of mean tail requests (sweet - native), per harness\n')
print('| harness | tasks | sweet longer | native longer | tie | mean diff (req) | mean diff ($) | sum tail $ sweet | sum tail $ native |')
print('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
for h in HARN:
    per = collections.defaultdict(lambda: {'native': [], 'sweet': []})
    perusd = collections.defaultdict(lambda: {'native': [], 'sweet': []})
    for arm in ['native', 'sweet']:
        for r in by[(h, arm)]:
            t = tail_of(r)
            if t is None:
                continue
            per[r['task']][arm].append(len(t))
            perusd[r['task']][arm].append(sum(x['usd'] for x in t))
    sw = nt = tie = 0
    diffs = []
    dusd = []
    for task, d in per.items():
        if not d['native'] or not d['sweet']:
            continue
        a = sum(d['sweet']) / len(d['sweet'])
        b = sum(d['native']) / len(d['native'])
        diffs.append(a - b)
        ua = sum(perusd[task]['sweet']) / len(perusd[task]['sweet'])
        ub = sum(perusd[task]['native']) / len(perusd[task]['native'])
        dusd.append(ua - ub)
        if a > b:
            sw += 1
        elif b > a:
            nt += 1
        else:
            tie += 1
    print('| %s | %d | %d | %d | %d | %s | $%s | $%s | $%s |' % (h, len(diffs), sw, nt, tie, fmt(sum(diffs) / len(diffs)), fmt(sum(dusd) / len(dusd), 6),
          fmt(sum(sum(v['sweet']) for v in perusd.values()), 4), fmt(sum(sum(v['native']) for v in perusd.values()), 4)))
    OUT.setdefault('paired', {})[h] = dict(tasks=len(diffs), sweet_longer=sw, native_longer=nt, tie=tie, mean_diff_req=sum(diffs) / len(diffs), mean_diff_usd=sum(dusd) / len(dusd))

# ---- ten largest tails ----
print('\n## Ten largest tails per harness (by tail requests; primary variant)\n')
for h in HARN:
    rows = []
    for arm in ['native', 'sweet']:
        for r in by[(h, arm)]:
            t = tail_of(r)
            if t is None:
                continue
            rows.append((len(t), sum(x['usd'] for x in t), r, t))
    rows.sort(key=lambda x: (-x[0], -x[1]))
    print('\n### %s\n' % h)
    print('| rank | rollout id | arm | solved | patch | total req | tail req | tail $ | tail share | tail class mix | last req |')
    print('|---:|---|---|---|---|---:|---:|---:|---:|---|---|')
    for k, (n, u, r, t) in enumerate(rows[:10], 1):
        mix = collections.Counter(x['cls'] for x in t).most_common(5)
        print('| %d | `%s` | %s | %s | %s | %d | %d | $%s | %s%% | %s | %s |' % (k, r['rid'], r['arm'], 'yes' if r['resolved'] else 'no', 'empty' if r['patch_empty'] else '%d hunks' % (r['patchHunks'] or 0),
              r['n_req'], n, fmt(u, 6), fmt(100 * u / r['usd'], 1), ', '.join('%s %d' % (a, b) for a, b in mix), r['last_req_cls']))
    OUT.setdefault('top10', {})[h] = [dict(rid=r['rid'], arm=r['arm'], resolved=r['resolved'], tail_req=n, tail_usd=u, n_req=r['n_req'], share=u / r['usd']) for n, u, r, t in rows[:10]]
    print('\nTen largest by tail cost:\n')
    rows.sort(key=lambda x: -x[1])
    print('| rank | rollout id | arm | solved | tail req | tail $ | tail share | rollout $ |')
    print('|---:|---|---|---|---:|---:|---:|---:|')
    for k, (n, u, r, t) in enumerate(rows[:10], 1):
        print('| %d | `%s` | %s | %s | %d | $%s | %s%% | $%s |' % (k, r['rid'], r['arm'], 'yes' if r['resolved'] else 'no', n, fmt(u, 6), fmt(100 * u / r['usd'], 1), fmt(r['usd'], 6)))

# ---- failed edit, no retry ----
print('\n## Rollouts that end on a failed edit with no retry (last edit request failed; no later edit request)\n')
print('| cell | count | of which empty patch | of which solved | rollout ids |')
print('|---|---:|---:|---:|---|')
for h in HARN:
    for arm in ['native', 'sweet']:
        ids = []
        for r in by[(h, arm)]:
            le = r['last_edit']
            if le is None:
                continue
            x = r['requests'][le]
            if x['edit_fail'] and not x['edit_ok']:
                t = tail_of(r)
                ids.append((r['rid'], r['patch_empty'], r['resolved'], len(t)))
        OUT.setdefault('failed_edit_no_retry', {})['%s/%s' % (h, arm)] = ids
        print('| %s/%s | %d | %d | %d | %s |' % (h, arm, len(ids), sum(1 for i in ids if i[1]), sum(1 for i in ids if i[2]),
              '<br>'.join('`%s` (tail %d%s%s)' % (i[0], i[3], ', EMPTY PATCH' if i[1] else '', ', solved' if i[2] else '') for i in ids) or '—'))

# ---- last message is a state summary ----
print('\n## Rollouts whose LAST assistant text is a `<state_summary>` block\n')
print('| cell | last text is state_summary | ... and empty patch | empty patch (any last text) | rollout ids (state_summary last) |')
print('|---|---:|---:|---:|---|')
for h in HARN:
    for arm in ['native', 'sweet']:
        rs = by[(h, arm)]
        ss = [r for r in rs if r['last_text_ss']]
        ss_np = [r for r in ss if r['patch_empty']]
        np_ = [r for r in rs if r['patch_empty']]
        OUT.setdefault('state_summary_last', {})['%s/%s' % (h, arm)] = dict(ss=[r['rid'] for r in ss], ss_nopatch=[r['rid'] for r in ss_np], nopatch=[(r['rid'], r['resolved'], r['n_edit_req']) for r in np_])
        print('| %s/%s | %d | %d | %d | %s |' % (h, arm, len(ss), len(ss_np), len(np_), '<br>'.join('`%s`%s%s' % (r['rid'], ' EMPTY' if r['patch_empty'] else '', ' solved' if r['resolved'] else '') for r in ss) or '—'))
print('\nEmpty-patch rollouts (any last text):\n')
for h in HARN:
    for arm in ['native', 'sweet']:
        d = OUT['state_summary_last']['%s/%s' % (h, arm)]['nopatch']
        if d:
            print('- %s/%s: ' % (h, arm) + ', '.join('`%s` (edits %d%s)' % (rid, ne, ', solved' if res else '') for rid, res, ne in d))

# ---- quarter-position check (replicates r2-turn-profile: cache-normalised "ideal" price, T>=8) ----
print('\n## Cost by request position (replicates r2-turn-profile-and-subagents.mjs: ideal price, rollouts with >= 8 requests)\n')
print('| cell | n(>=8 req) | first quarter share | last quarter share | ratio last:first | first request share | last request share | tail (post-edit) $ share | tail req share | tail-share / req-share |')
print('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for h in HARN:
    for arm in ['sweet', 'native']:
        fq = lq = tot = f1 = l1 = 0.0
        n = 0
        tus = trs = 0.0
        for r in by[(h, arm)]:
            T = r['requests']
            if len(T) < 8:
                continue
            n += 1
            costs = [x['ideal_usd'] for x in T]
            k = len(T) // 4
            s = sum(costs)
            tot += s
            fq += sum(costs[:k])
            lq += sum(costs[-k:])
            f1 += costs[0]
            l1 += costs[-1]
        S = OUT['last_edit']['%s/%s' % (h, arm)]
        OUT.setdefault('quarters', {})['%s/%s' % (h, arm)] = dict(n=n, first_q=fq / tot, last_q=lq / tot, ratio=lq / fq, first_req=f1 / tot, last_req=l1 / tot)
        print('| %s/%s | %d | %s%% | %s%% | %sx | %s%% | %s%% | %s%% | %s%% | %s |' % (h, arm, n, fmt(100 * fq / tot, 1), fmt(100 * lq / tot, 1), fmt(lq / fq), fmt(100 * f1 / tot, 1), fmt(100 * l1 / tot, 1),
              fmt(100 * S['tail_usd_share'], 1), fmt(100 * S['tail_req_share'], 1), fmt(S['tail_usd_share'] / S['tail_req_share'])))

# realized-price variant of the same quarter table
print('\nSame table at REALIZED price (what the ledger bills; claude includes the 1.25x cache-write premium):\n')
print('| cell | first quarter share | last quarter share | ratio |')
print('|---|---:|---:|---:|')
for h in HARN:
    for arm in ['sweet', 'native']:
        fq = lq = tot = 0.0
        for r in by[(h, arm)]:
            T = r['requests']
            if len(T) < 8:
                continue
            costs = [x['usd'] for x in T]
            k = len(T) // 4
            tot += sum(costs)
            fq += sum(costs[:k])
            lq += sum(costs[-k:])
        print('| %s/%s | %s%% | %s%% | %sx |' % (h, arm, fmt(100 * fq / tot, 1), fmt(100 * lq / tot, 1), fmt(lq / fq)))

# ---- tail composition in tokens: what the tail re-sends vs ingests vs emits ----
print('\n## Tail token anatomy (per rollout means, primary variant)\n')
print('| cell | tail req | tail billed input (re-sent context, sum over tail requests) | tail new input (ingested in tail) | tail output | tail $ | of which output $ | of which resend $ | of which ingest $ |')
print('|---|---:|---:|---:|---:|---:|---:|---:|---:|')
for h in HARN:
    for arm in ['native', 'sweet']:
        S = OUT['last_edit']['%s/%s' % (h, arm)]
        out_usd = S['tail_out_mean'] * 0.60 / 1e6
        ing_usd = S['tail_newin_mean'] * 0.10 / 1e6
        res_usd = (S['tail_in_mean'] - S['tail_newin_mean']) * 0.01 / 1e6
        print('| %s/%s | %s | %s | %s | %s | $%s | $%s | $%s | $%s |' % (h, arm, fmt(S['tail_req_mean']), fmt(S['tail_in_mean'], 0), fmt(S['tail_newin_mean'], 0), fmt(S['tail_out_mean'], 0), fmt(S['tail_usd_mean'], 6), fmt(out_usd, 6), fmt(res_usd, 6), fmt(ing_usd, 6)))

# ---- claude sidechain note ----
print('\n## Claude-code sidechain (subagent) position relative to the last main-thread edit\n')
for arm in ['native', 'sweet']:
    before = after = both = 0
    n_del = 0
    sc_usd = 0.0
    sc_req = 0
    for r in by[('claude-code', arm)]:
        sc = r.get('sidechain') or {}
        idx = [x['i'] for x in r['requests'] for c in x['calls'] if c['cls'] == 'delegate']
        if not idx:
            continue
        n_del += 1
        sc_usd += sc.get('usd', 0)
        sc_req += sc.get('requests', 0)
        le = r['last_edit']
        if le is None:
            continue
        b = any(i < le for i in idx)
        a = any(i > le for i in idx)
        if b and a:
            both += 1
        elif a:
            after += 1
        else:
            before += 1
    print('- %s: rollouts that delegated = %d; delegation only before the last edit = %d, only after = %d, both = %d; sidechain requests = %d, sidechain $ = %s (main-thread requests are the tail basis; sidechain requests are excluded from the tail counts)' % (arm, n_del, before, after, both, sc_req, fmt(sc_usd, 4)))

json.dump(OUT, open(sys.argv[2] if len(sys.argv) > 2 else '/dev/null', 'w'), indent=1, default=str)
