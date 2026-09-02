#!/usr/bin/env python3
"""e3-budget.py — the mechanistic budget. Splits each form-to-form dollar gap into
direct gutter tokens / delegation / behaviour residual, and prints the
cheapest-gutter counterfactual. Appends its numbers to 03-gutter-form-cost.json."""
import gzip, json, random
from collections import defaultdict

random.seed(20260828)
FORMS = ['tab', 'none', 'pipe']
HARN = ['codex', 'opencode', 'claude-code']
rolls = [json.loads(l) for l in gzip.open('data/rollouts.ndjson.gz', 'rt') if l.strip()]
toks = [json.loads(l) for l in open('data/blocks-tok.ndjson')]

agg = defaultdict(lambda: dict(g=0, gUsd=0.0, toNone=0.0, toTab=0.0, toPipe=0.0))
for b in toks:
    w = 0.0 if b['T'] <= b['k'] else (0.10 + 0.01 * b['resid']) / 1e6
    a = agg[b['id']]
    g = b['tokDel'] - b['tokStrip']
    a['g'] += g
    a['gUsd'] += g * w
    a['toNone'] += -g * w
    a['toTab'] += (b['tokTab'] - b['tokDel']) * w
    a['toPipe'] += (b['tokPipe'] - b['tokDel']) * w
for r in rolls:
    a = agg.get(f"{r['h']}|{r['form']}|{r['arm']}|{r['task']}|{r['rep']}", {})
    r.update(gTok=a.get('g', 0), gUsd=a.get('gUsd', 0.0), cfNone=a.get('toNone', 0.0),
             cfTab=a.get('toTab', 0.0), cfPipe=a.get('toPipe', 0.0))
    r['totUsd'] = r['realUsd'] + r.get('sideRealUsd', 0.0)


def cell(h, f, arm='sweet'):
    return [r for r in rolls if r['h'] == h and r['form'] == f and r['arm'] == arm]


def mean(x):
    x = list(x)
    return sum(x) / len(x) if x else 0.0


def boot(h, form, field, pool=None, B=10000):
    a_, b_ = cell(h, form), cell(h, 'tab')
    tasks = sorted({r['task'] for r in a_} & {r['task'] for r in b_})
    if pool:
        tasks = [t for t in tasks if t in pool]
    A = {t: [r[field] for r in a_ if r['task'] == t] for t in tasks}
    Bd = {t: [r[field] for r in b_ if r['task'] == t] for t in tasks}
    obs = mean([x for t in tasks for x in A[t]]) - mean([x for t in tasks for x in Bd[t]])
    ds = []
    n = len(tasks)
    for _ in range(B):
        s = [tasks[random.randrange(n)] for _ in range(n)]
        ds.append(mean([x for t in s for x in A[t]]) - mean([x for t in s for x in Bd[t]]))
    ds.sort()
    return obs, ds[int(0.025 * B)], ds[int(0.975 * B)]


OUT = {}
print('=== MECHANISTIC BUDGET, per rollout, USD ===')
print(f"{'harness':<12}{'pair':<11}{'observed':>10}{'direct':>10}{'delegation':>12}"
      f"{'behaviour':>11}{'CI lo':>10}{'CI hi':>10}{'direct in CI':>14}")
for h in HARN:
    tabTot = mean(r['totUsd'] for r in cell(h, 'tab'))
    tabSide = mean(r.get('sideRealUsd', 0.0) for r in cell(h, 'tab'))
    for form in ['none', 'pipe']:
        obs = mean(r['totUsd'] for r in cell(h, form)) - tabTot
        direct = mean(r['cfNone' if form == 'none' else 'cfPipe'] for r in cell(h, 'tab'))
        deleg = mean(r.get('sideRealUsd', 0.0) for r in cell(h, form)) - tabSide
        beh = obs - direct - deleg
        _, lo, hi = boot(h, form, 'totUsd')
        OUT[f'{h}|tab->{form}'] = dict(observed=obs, direct=direct, delegation=deleg,
                                       behaviour=beh, ci=[lo, hi],
                                       directInsideCI=bool(lo <= direct <= hi),
                                       pctObserved=100 * obs / tabTot,
                                       pctDirect=100 * direct / tabTot)
        print(f'{h:<12}{("TAB->" + form.upper()):<11}{obs:>10.6f}{direct:>10.6f}{deleg:>12.6f}'
              f'{beh:>11.6f}{lo:>10.6f}{hi:>10.6f}{("yes" if lo <= direct <= hi else "NO"):>14}')

print('\n=== CLAUDE-CODE: delegation isolated ===')
byT = defaultdict(dict)
for f in FORMS:
    for r in cell('claude-code', f):
        byT[r['task']].setdefault(f, []).append(r)
clean = sorted(t for t, d in byT.items()
               if all(len(d.get(f, [])) == 3 for f in FORMS)
               and all(x['sidechainCount'] == 0 for f in FORMS for x in d[f]))
dirty = sorted(set(byT) - set(clean))
print(f'zero-delegation-in-all-forms tasks: {len(clean)}  ({", ".join(clean)})')
print(f'delegation-discordant / always-delegating tasks: {len(dirty)}  ({", ".join(dirty)})')
print(f"\n{'set':<26}{'form':<6}{'main $/roll':>13}{'side $/roll':>13}{'total $/roll':>14}{'vs TAB':>9}")
for label, ts in (('zero-delegation (n=%d)' % len(clean), clean), ('the rest (n=%d)' % len(dirty), dirty)):
    base = None
    for f in FORMS:
        rs = [x for t in ts for x in byT[t][f]]
        mn = mean(r['realUsd'] for r in rs)
        sd = mean(r.get('sideRealUsd', 0.0) for r in rs)
        tt = mn + sd
        base = base or tt
        print(f'{label:<26}{f:<6}{mn:>13.6f}{sd:>13.6f}{tt:>14.6f}{100*(tt/base-1):>8.1f}%')
    OUT[f'claude_{"clean" if ts is clean else "rest"}'] = {
        f: dict(main=mean(r['realUsd'] for t in ts for r in byT[t][f]),
                side=mean(r.get('sideRealUsd', 0.0) for t in ts for r in byT[t][f])) for f in FORMS}

o, lo, hi = boot('claude-code', 'pipe', 'realUsd', pool=set(clean))
d = mean(r['cfPipe'] for r in cell('claude-code', 'tab') if r['task'] in clean)
print(f'\nclaude-code TAB->PIPE, main-only, zero-delegation tasks: observed {o:+.6f} '
      f'CI [{lo:+.6f},{hi:+.6f}]  direct prediction {d:+.6f}  -> direct '
      f'{"inside" if lo <= d <= hi else "OUTSIDE"} the CI')
o2, lo2, hi2 = boot('claude-code', 'none', 'realUsd', pool=set(clean))
d2 = mean(r['cfNone'] for r in cell('claude-code', 'tab') if r['task'] in clean)
print(f'claude-code TAB->NONE, main-only, zero-delegation tasks: observed {o2:+.6f} '
      f'CI [{lo2:+.6f},{hi2:+.6f}]  direct prediction {d2:+.6f}  -> direct '
      f'{"inside" if lo2 <= d2 <= hi2 else "OUTSIDE"} the CI')
OUT['claude_clean_boot'] = dict(pipe=dict(obs=o, lo=lo, hi=hi, direct=d),
                                none=dict(obs=o2, lo=lo2, hi=hi2, direct=d2))

print('\n=== CHEAPEST GUTTER, behaviour held fixed ===')
print(f"{'harness':<12}{'shipped $/roll':>15}{'drop gutter':>13}{'%':>8}"
      f"{'per 1k rollouts':>17}{'PIPE->TAB on PIPE cell':>24}")
CH = {}
for h in HARN:
    c = cell(h, 'tab')
    m = mean(r['totUsd'] for r in c)
    drop = mean(r['cfNone'] for r in c)
    p = cell(h, 'pipe')
    ptab = mean(r['cfTab'] for r in p)
    CH[h] = dict(shipped=m, dropGutter=drop, dropPct=100 * drop / m,
                 per1k=drop * 1000, pipeToTab=ptab, pipeToTabPct=100 * ptab / mean(r['totUsd'] for r in p))
    print(f'{h:<12}{m:>15.6f}{drop:>13.6f}{100*drop/m:>7.2f}%{drop*1000:>16.3f}$'
          f'{ptab:>16.6f} ({100*ptab/mean(r["totUsd"] for r in p):+.2f}%)')
OUT['cheapest'] = CH

# ---------------------------------------- input / output / delegation split
POUT = 0.60 / 1e6
print('\n=== MAIN-AGENT INPUT vs OUTPUT vs DELEGATION ($/rollout) ===')
print(f"{'harness':<12}{'form':<6}{'out tok':>9}{'out $':>10}{'in $':>10}{'side $':>10}"
      f"{'total $':>10}{'d out $':>10}{'d in $':>10}{'d side $':>10}{'d tot $':>10}")
IO = {}
for h in HARN:
    base = None
    for f in FORMS:
        c = cell(h, f)
        ot = mean(r['outTok'] for r in c)
        oc = ot * POUT
        ic = mean(r['realUsd'] for r in c) - oc
        sd = mean(r.get('sideRealUsd', 0.0) for r in c)
        tt = ic + oc + sd
        if base is None:
            base = (oc, ic, sd, tt)
        IO[f'{h}|{f}'] = dict(outTok=ot, outUsd=oc, inUsd=ic, sideUsd=sd, totalUsd=tt,
                              dOut=oc - base[0], dIn=ic - base[1], dSide=sd - base[2], dTot=tt - base[3])
        print(f'{h:<12}{f:<6}{ot:>9.0f}{oc:>10.6f}{ic:>10.6f}{sd:>10.6f}{tt:>10.6f}'
              f'{oc-base[0]:>10.6f}{ic-base[1]:>10.6f}{sd-base[2]:>10.6f}{tt-base[3]:>10.6f}')
OUT['io_split'] = IO

j = json.load(open('03-gutter-form-cost.json'))
j['budget'] = OUT
j['claude_task_sets'] = dict(zeroDelegation=clean, rest=dirty)
json.dump(j, open('03-gutter-form-cost.json', 'w'), indent=1)
print('\nappended budget to 03-gutter-form-cost.json')
