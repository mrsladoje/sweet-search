#!/usr/bin/env python3
"""e3-analyse.py — the decomposition. Reads rollouts.ndjson(.gz) + blocks-tok.ndjson,
writes 03-gutter-form-cost.json and prints every table used in the report.

Sections
  A  direct gutter token cost (ingest + resident), measured on the delivered bytes
  B  behaviour per form
  C  delegation on claude-code
  D  bootstrap CI over tasks
  E  idealCost / breakPriced columns
  F  mechanistic budget + cheapest-gutter counterfactual
"""
import gzip, json, math, random, statistics, sys
from collections import defaultdict

random.seed(20260828)
D = 'data/'
ROLL = D + 'rollouts.ndjson.gz'
ROLL2 = D + 'rollouts-repsel.ndjson.gz'
TOK = D + 'blocks-tok.ndjson'
FORMS = ['tab', 'none', 'pipe']
HARN = ['codex', 'opencode', 'claude-code']
PIN, PCACHE = 0.10, 0.01     # USD per 1M tokens


def load(path):
    op = gzip.open if path.endswith('.gz') else open
    with op(path, 'rt', encoding='utf8') as f:
        return [json.loads(l) for l in f if l.strip()]


rolls = load(ROLL)
rolls2 = load(ROLL2)
toks = load(TOK)

# ---- attach per-rollout gutter aggregates -----------------------------------
agg = defaultdict(lambda: dict(g=0, gIngest=0.0, gResident=0.0, gUsd=0.0,
                               toTab=0.0, toPipe=0.0, toNone=0.0,
                               numLines=0, blocks=0, nblocks=0, bySurf=defaultdict(int),
                               tokDel=0, tokStrip=0))
for b in toks:
    a = agg[b['id']]
    g = b['tokDel'] - b['tokStrip']
    w_ing = PIN / 1e6
    w_res = PCACHE * b['resid'] / 1e6
    if b['T'] <= b['k']:
        w_ing = w_res = 0.0            # produced after the last request: never billed
    a['g'] += g
    a['gIngest'] += g * w_ing
    a['gResident'] += g * w_res
    a['gUsd'] += g * (w_ing + w_res)
    a['toNone'] += -g * (w_ing + w_res)
    a['toTab'] += (b['tokTab'] - b['tokDel']) * (w_ing + w_res)
    a['toPipe'] += (b['tokPipe'] - b['tokDel']) * (w_ing + w_res)
    a['numLines'] += b['n'] if b['gf'] != 'none' else 0
    a['blocks'] += 1
    a['bySurf'][b['surf']] += b['n']
    a['nblocks'] = a.get('nblocks', 0) + 1
    a['tokDel'] += b['tokDel']
    a['tokStrip'] += b['tokStrip']
    a['codeUsd'] = a.get('codeUsd', 0.0) + b['tokDel'] * (w_ing + w_res)
    a['allLines'] = a.get('allLines', 0) + b['n']

for r in rolls:
    key = f"{r['h']}|{r['form']}|{r['arm']}|{r['task']}|{r['rep']}"
    a = agg.get(key)
    r['gTok'] = a['g'] if a else 0
    r['gUsd'] = a['gUsd'] if a else 0.0
    r['gIngestUsd'] = a['gIngest'] if a else 0.0
    r['gResidentUsd'] = a['gResident'] if a else 0.0
    r['cfNone'] = a['toNone'] if a else 0.0
    r['cfTab'] = a['toTab'] if a else 0.0
    r['cfPipe'] = a['toPipe'] if a else 0.0
    r['gLines'] = a['numLines'] if a else 0
    r['deliveredCodeTok'] = a['tokDel'] if a else 0
    r['codeUsd'] = a.get('codeUsd', 0.0) if a else 0.0
    r['allCodeLines'] = a.get('allLines', 0) if a else 0
    r['bySurf'] = dict(a['bySurf']) if a else {}
    r['nBlocks'] = a['nblocks'] if a else 0
    r['totUsd'] = r['realUsd'] + r.get('sideRealUsd', 0.0)
    r['idealTot'] = r['idealUsd'] + r.get('sideIdealUsd', 0.0)
    r['breakTot'] = r['breakUsd'] + r.get('sideBreakUsd', 0.0)


def cell(h, form, arm='sweet', src=rolls):
    return [r for r in src if r['h'] == h and r['form'] == form and r['arm'] == arm]


def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else 0.0


def fmt(x, n=6):
    return f'{x:.{n}f}'


OUTJ = {'meta': {
    'run': 'fresh pool epoch C (fp-*/rp-* 2026-08-26/27)',
    'model': 'openai/gpt-5.6-luna via OpenRouter',
    'price_usd_per_mtok': {'new_input': PIN, 'cached_input': PCACHE, 'output': 0.60},
    'rollouts': len(rolls), 'gutter_blocks': len(toks),
    'selection': 'codex=rows.rolloutFile; opencode=cost-matched to rows.json; claude-code=3 dearest per cell',
}}

# =============================================================== A. direct cost
print('\n=== A. HEADLINE COST AND THE DIRECT GUTTER COMPONENT (per rollout) ===')
print(f"{'harness':<12}{'form':<6}{'$/rollout':>11}{'vs TAB':>9}{'$ delta':>11}"
      f"{'gutter tok':>11}{'gutter $':>10}{'ingest $':>10}{'resid $':>9}{'g% of $':>9}")
A = {}
for h in HARN:
    tab = cell(h, 'tab')
    tabM = mean(r['totUsd'] for r in tab)
    for form in FORMS:
        c = cell(h, form)
        m = mean(r['totUsd'] for r in c)
        g = mean(r['gTok'] for r in c)
        gu = mean(r['gUsd'] for r in c)
        gi = mean(r['gIngestUsd'] for r in c)
        gr = mean(r['gResidentUsd'] for r in c)
        A[(h, form)] = dict(usd=m, gTok=g, gUsd=gu, gIngest=gi, gResident=gr,
                            n=len(c), lines=mean(r['gLines'] for r in c))
        print(f'{h:<12}{form:<6}{fmt(m):>11}{(100*(m/tabM-1)):>8.1f}%{fmt(m-tabM):>11}'
              f'{g:>11.0f}{fmt(gu):>10}{fmt(gi):>10}{fmt(gr):>9}{100*gu/m:>8.2f}%')
OUTJ['A_direct'] = {f'{h}|{f}': A[(h, f)] for h in HARN for f in FORMS}

print('\n--- how much of the FORM-TO-FORM $ gap is direct gutter tokens? ---')
print(f"{'harness':<12}{'pair':<12}{'observed $':>12}{'direct $':>11}{'explained':>11}{'residual $':>12}")
EXPL = {}
for h in HARN:
    tabM = mean(r['totUsd'] for r in cell(h, 'tab'))
    for form in ['none', 'pipe']:
        c = cell(h, form)
        m = mean(r['totUsd'] for r in c)
        obs = m - tabM
        # direct = what the delimiter change alone costs, measured on the TAB cell's own
        # delivered blocks (behaviour held fixed at TAB's behaviour)
        if form == 'none':
            direct = mean(r['cfNone'] for r in cell(h, 'tab'))
        else:
            direct = mean(r['cfPipe'] for r in cell(h, 'tab'))
        share = (direct / obs * 100) if abs(obs) > 1e-9 else float('nan')
        EXPL[(h, form)] = dict(observed=obs, direct=direct, residual=obs - direct)
        print(f'{h:<12}{("TAB->" + form.upper()):<12}{fmt(obs):>12}{fmt(direct):>11}'
              f'{share:>10.1f}%{fmt(obs-direct):>12}')
OUTJ['A_explained'] = {f'{h}|{f}': EXPL[(h, f)] for h in HARN for f in ['none', 'pipe']}

print('\n--- gutter overhead per delivered code line, measured ---')
print(f"{'harness':<12}{'form':<6}{'lines/roll':>11}{'gutter tok':>11}{'tok/line':>9}{'blocks':>8}")
for h in HARN:
    for form in FORMS:
        c = cell(h, form)
        L = mean(r['gLines'] for r in c)
        g = mean(r['gTok'] for r in c)
        print(f'{h:<12}{form:<6}{L:>11.0f}{g:>11.0f}{(g/L if L else 0):>9.3f}'
              f'{mean(r["nBlocks"] for r in c):>8.1f}')

print('\n--- delivered code lines by ss-* surface (per rollout) ---')
surfs = ['ss-read', 'ss-search', 'ss-find', 'ss-semantic']
print(f"{'harness':<12}{'form':<6}" + ''.join(f'{s:>13}' for s in surfs) + f"{'total':>9}")
SURF = {}
for h in HARN:
    for form in FORMS:
        c = cell(h, form)
        vals = [mean(r['bySurf'].get(s, 0) for r in c) for s in surfs]
        SURF[f'{h}|{form}'] = dict(zip(surfs, vals))
        print(f'{h:<12}{form:<6}' + ''.join(f'{v:>13.0f}' for v in vals) + f'{sum(vals):>9.0f}')
OUTJ['A_surfaces'] = SURF

# ================================================================ B. behaviour
print('\n=== B. BEHAVIOUR PER FORM (mean per rollout, sweet arm) ===')
COLS = [('T', 'turns'), ('calls', 'calls'), ('ssRead', 'ss-read'), ('ssSearch', 'ss-srch'),
        ('readWithRange', 'rangeRd'), ('readWholeFile', 'wholeRd'), ('allCodeLines', 'codeLn'),
        ('rereadBlocks', 'reread'), ('distinctFilesRead', 'files'), ('truncations', 'trunc'),
        ('editCalls', 'edits'), ('editFails', 'editFail'), ('outTok', 'outTok'),
        ('newInTok', 'newIn'), ('resentTok', 'resent'), ('toolOutBytes', 'toolB')]
print(f"{'harness':<12}{'form':<6}" + ''.join(f'{lbl:>9}' for _, lbl in COLS) + f"{'failRoll':>9}")
B = {}
for h in HARN:
    for form in FORMS:
        c = cell(h, form)
        row = {k: mean(r[k] for r in c) for k, _ in COLS}
        row['rolloutsWithEditFailure'] = sum(1 for r in c if r['editFails'] > 0)
        row['n'] = len(c)
        row['meanReadWindow'] = mean(x for r in c for x in r['readWindowSizes']) if any(r['readWindowSizes'] for r in c) else 0
        B[f'{h}|{form}'] = row
        print(f'{h:<12}{form:<6}' + ''.join(f'{row[k]:>9.1f}' for k, _ in COLS)
              + f"{row['rolloutsWithEditFailure']:>6}/{len(c)}")
# native reference
for h in HARN:
    c = cell(h, 'tab', 'native')
    row = {k: mean(r[k] for r in c) for k, _ in COLS}
    row['rolloutsWithEditFailure'] = sum(1 for r in c if r['editFails'] > 0)
    row['n'] = len(c)
    B[f'{h}|native'] = row
    print(f'{h:<12}{"NATIVE":<6}' + ''.join(f'{row[k]:>9.1f}' for k, _ in COLS)
          + f"{row['rolloutsWithEditFailure']:>6}/{len(c)}")
OUTJ['B_behaviour'] = B

print('\n--- read window sizes (ss-read blocks delivered), lines ---')
print(f"{'harness':<12}{'form':<6}{'n blocks':>10}{'mean':>8}{'median':>8}{'p90':>8}{'max':>7}")
W = {}
for h in HARN:
    for form in FORMS:
        c = cell(h, form)
        ws = sorted(x for r in c for x in r['readWindowSizes'])
        if not ws:
            continue
        W[f'{h}|{form}'] = dict(n=len(ws), mean=mean(ws), median=statistics.median(ws),
                                p90=ws[int(0.9 * (len(ws) - 1))], max=ws[-1])
        print(f'{h:<12}{form:<6}{len(ws):>10}{mean(ws):>8.1f}{statistics.median(ws):>8.0f}'
              f'{ws[int(0.9*(len(ws)-1))]:>8.0f}{ws[-1]:>7.0f}')
OUTJ['B_windows'] = W

print('\n--- edit-failure classes (edit-level), sweet ---')
kinds = sorted({k for r in rolls for k in r['editFailKinds']})
print(f"{'harness':<12}{'form':<7}{'edits':>7}{'fails':>7}{'rate':>7}  " + ' '.join(f'{k}' for k in kinds))
EF = {}
for h in HARN:
    for form in FORMS + ['native']:
        c = cell(h, 'tab', 'native') if form == 'native' else cell(h, form)
        e = sum(r['editCalls'] for r in c)
        f_ = sum(r['editFails'] for r in c)
        kk = {k: sum(r['editFailKinds'].get(k, 0) for r in c) for k in kinds}
        EF[f'{h}|{form}'] = dict(edits=e, fails=f_, rolloutsWithFailure=sum(1 for r in c if r['editFails'] > 0), kinds=kk)
        rf = sum(1 for r in c if r['editFails'] > 0)
        print(f'{h:<12}{form:<7}{e:>7}{f_:>7}{(100*f_/e if e else 0):>6.1f}%  roll {rf}/{len(c)}   '
              + ' '.join(f'{k}={kk[k]}' for k in kinds if kk[k]))
OUTJ['B_editfail'] = EF

# =============================================================== C. delegation
print('\n=== C. CLAUDE-CODE DELEGATION ===')
print(f"{'form':<8}{'roll':>6}{'delegating':>12}{'sidechain $':>13}{'main $/roll':>13}"
      f"{'main $/roll (non-deleg only)':>30}{'n':>5}")
C = {}
for form in FORMS + ['native']:
    c = cell('claude-code', 'tab', 'native') if form == 'native' else cell('claude-code', form)
    deleg = [r for r in c if r['sidechainCount'] > 0]
    nond = [r for r in c if r['sidechainCount'] == 0]
    C[form] = dict(n=len(c), delegating=len(deleg), sidechainTotal=sum(r['sideRealUsd'] for r in c),
                   mainPerRoll=mean(r['realUsd'] for r in c),
                   mainPerRollNonDeleg=mean(r['realUsd'] for r in nond), nNonDeleg=len(nond),
                   totalPerRoll=mean(r['totUsd'] for r in c),
                   delegatingCells=len({r['task'] for r in deleg}))
    print(f'{form:<8}{len(c):>6}{len(deleg):>12}{fmt(C[form]["sidechainTotal"]):>13}'
          f'{fmt(C[form]["mainPerRoll"]):>13}{fmt(C[form]["mainPerRollNonDeleg"]):>30}{len(nond):>5}')
OUTJ['C_delegation'] = C

print('\n--- claude-code paired per task, main-only, on the 14 tasks that never delegated in ANY form ---')
byT = defaultdict(dict)
for form in FORMS:
    for r in cell('claude-code', form):
        byT[r['task']].setdefault(form, []).append(r)
clean = [t for t, d in byT.items() if all(len(d.get(f, [])) == 3 for f in FORMS)
         and all(x['sidechainCount'] == 0 for f in FORMS for x in d[f])]
print(f'tasks with zero delegation in all three forms: {len(clean)} of {len(byT)}')
PT = {}
for form in FORMS:
    v = mean(mean(x['realUsd'] for x in byT[t][form]) for t in clean)
    PT[form] = v
base = PT['tab']
for form in FORMS:
    print(f'  {form:<6}{fmt(PT[form]):>11}  vs TAB {100*(PT[form]/base-1):>7.1f}%')
OUTJ['C_pairedClean'] = dict(tasks=sorted(clean), meanPerRollout=PT)

# =============================================================== D. bootstrap
print('\n=== D. BOOTSTRAP CI, RESAMPLING TASKS (10,000 draws, seed 20260828) ===')


def boot(h, form, field='totUsd', src=rolls, pool=None, B_=10000):
    tabc, formc = cell(h, 'tab', src=src), cell(h, form, src=src)
    tasks = sorted({r['task'] for r in tabc} & {r['task'] for r in formc})
    if pool is not None:
        tasks = [t for t in tasks if t in pool]
    tb = {t: [r[field] for r in tabc if r['task'] == t] for t in tasks}
    fb = {t: [r[field] for r in formc if r['task'] == t] for t in tasks}
    obs = mean([x for t in tasks for x in fb[t]]) - mean([x for t in tasks for x in tb[t]])
    ds = []
    n = len(tasks)
    for _ in range(B_):
        s = [tasks[random.randrange(n)] for _ in range(n)]
        a = [x for t in s for x in fb[t]]
        b = [x for t in s for x in tb[t]]
        ds.append(mean(a) - mean(b))
    ds.sort()
    return obs, ds[int(0.025 * B_)], ds[int(0.975 * B_)], len(tasks)


print(f"{'harness':<12}{'form':<6}{'delta $':>11}{'95% CI lo':>12}{'95% CI hi':>12}{'% vs TAB':>10}{'CI excl 0':>11}")
DD = {}
for h in HARN:
    tabM = mean(r['totUsd'] for r in cell(h, 'tab'))
    for form in ['none', 'pipe']:
        o, lo, hi, nt = boot(h, form)
        DD[f'{h}|{form}'] = dict(delta=o, lo=lo, hi=hi, tasks=nt, pct=100 * o / tabM,
                                 excludesZero=bool(lo > 0 or hi < 0))
        print(f'{h:<12}{form:<6}{fmt(o):>11}{fmt(lo):>12}{fmt(hi):>12}'
              f'{100*o/tabM:>9.1f}%{("YES" if (lo > 0 or hi < 0) else "no"):>11}')
OUTJ['D_bootstrap_total'] = DD

print('\n--- same, MAIN-ONLY cost with delegation held fixed (claude-code, zero-delegation tasks) ---')
DD2 = {}
tabM = mean(mean(x['realUsd'] for x in byT[t]['tab']) for t in clean)
for form in ['none', 'pipe']:
    o, lo, hi, nt = boot('claude-code', form, field='realUsd', pool=set(clean))
    DD2[form] = dict(delta=o, lo=lo, hi=hi, tasks=nt, pct=100 * o / tabM,
                     excludesZero=bool(lo > 0 or hi < 0))
    print(f'{"claude-code":<12}{form:<6}{fmt(o):>11}{fmt(lo):>12}{fmt(hi):>12}'
          f'{100*o/tabM:>9.1f}%{("YES" if (lo > 0 or hi < 0) else "no"):>11}')
OUTJ['D_bootstrap_claude_nodeleg'] = DD2

print('\n--- claude-code, ALL tasks, main-only (delegation cost excluded but behaviour not) ---')
DD3 = {}
tabM = mean(r['realUsd'] for r in cell('claude-code', 'tab'))
for form in ['none', 'pipe']:
    o, lo, hi, nt = boot('claude-code', form, field='realUsd')
    DD3[form] = dict(delta=o, lo=lo, hi=hi, tasks=nt, pct=100 * o / tabM,
                     excludesZero=bool(lo > 0 or hi < 0))
    print(f'{"claude-code":<12}{form:<6}{fmt(o):>11}{fmt(lo):>12}{fmt(hi):>12}'
          f'{100*o/tabM:>9.1f}%{("YES" if (lo > 0 or hi < 0) else "no"):>11}')
OUTJ['D_bootstrap_claude_mainonly'] = DD3

# ================================================== E. ideal / breakPriced cols
print('\n=== E. THE SAME TABLE ON idealCost AND breakPriced ===')
print(f"{'harness':<12}{'form':<6}{'realized':>11}{'ideal':>11}{'break':>11}"
      f"{'ideal vs TAB':>14}{'break vs TAB':>14}")
E = {}
for h in HARN:
    it = mean(r['idealTot'] for r in cell(h, 'tab'))
    bt = mean(r['breakTot'] for r in cell(h, 'tab'))
    for form in FORMS:
        c = cell(h, form)
        rr, ii, bb = mean(r['totUsd'] for r in c), mean(r['idealTot'] for r in c), mean(r['breakTot'] for r in c)
        E[f'{h}|{form}'] = dict(realized=rr, ideal=ii, breakPriced=bb,
                                idealPctVsTab=100 * (ii / it - 1), breakPctVsTab=100 * (bb / bt - 1))
        print(f'{h:<12}{form:<6}{fmt(rr):>11}{fmt(ii):>11}{fmt(bb):>11}'
              f'{100*(ii/it-1):>13.1f}%{100*(bb/bt-1):>13.1f}%')
OUTJ['E_columns'] = E
print('note: contextRewrites are 0 everywhere in this run, so breakPriced == ideal by construction')

# ============================================ F. cheapest-gutter counterfactual
print('\n=== F. WHAT THE CHEAPEST GUTTER WOULD SAVE, BEHAVIOUR HELD FIXED ===')
print(f"{'harness':<12}{'from':<6}{'$/rollout':>11}{'drop gutter $':>15}{'%':>7}"
      f"{'PIPE->TAB $':>13}{'%':>7}")
F = {}
for h in HARN:
    for form in FORMS:
        c = cell(h, form)
        m = mean(r['totUsd'] for r in c)
        dropG = mean(r['cfNone'] for r in c)          # negative = saving
        toTab = mean(r['cfTab'] for r in c)
        F[f'{h}|{form}'] = dict(usd=m, dropGutterUsd=dropG, dropGutterPct=100 * dropG / m,
                                toTabUsd=toTab, toTabPct=100 * toTab / m)
        print(f'{h:<12}{form:<6}{fmt(m):>11}{fmt(dropG):>15}{100*dropG/m:>6.2f}%'
              f'{fmt(toTab):>13}{100*toTab/m:>6.2f}%')
OUTJ['F_counterfactual'] = F

# --------------------------------------------------- selection robustness note
print('\n=== G. TRANSCRIPT-SELECTION SENSITIVITY (claude-code only) ===')
for src, lbl in ((rolls, '3-dearest (published convention)'), (rolls2, 'rep-from-slug, dearest per rep')):
    row = []
    for form in FORMS:
        c = [r for r in src if r['h'] == 'claude-code' and r['form'] == form and r['arm'] == 'sweet']
        row.append(mean(r['realUsd'] + r.get('sideRealUsd', 0) for r in c))
    print(f'{lbl:<36} TAB {fmt(row[0])}  NONE {fmt(row[1])} ({100*(row[1]/row[0]-1):+.1f}%)'
          f'  PIPE {fmt(row[2])} ({100*(row[2]/row[0]-1):+.1f}%)')
OUTJ['G_selection'] = {
    'dearest': {f: mean(r['realUsd'] + r.get('sideRealUsd', 0)
                        for r in cell('claude-code', f)) for f in FORMS},
    'repslug': {f: mean(r['realUsd'] + r.get('sideRealUsd', 0)
                        for r in [x for x in rolls2 if x['h'] == 'claude-code' and x['form'] == f and x['arm'] == 'sweet'])
                for f in FORMS},
}

# --------------------------------------------- H. paired sign test over tasks
def binom_two_sided(k, n, p=0.5):
    if n == 0:
        return 1.0
    def c(a, b):
        return math.comb(a, b)
    probs = [c(n, i) * p**i * (1 - p)**(n - i) for i in range(n + 1)]
    obs = probs[k]
    return min(1.0, sum(q for q in probs if q <= obs + 1e-12))


print('\n=== H. PAIRED SIGN TEST OVER THE 22 TASKS (mean of 3 reps per cell) ===')
print(f"{'harness':<12}{'pair':<12}{'cheaper':>9}{'dearer':>8}{'tie':>5}{'p (2-sided)':>13}")
H = {}
for h in HARN:
    tabs = {}
    for r in cell(h, 'tab'):
        tabs.setdefault(r['task'], []).append(r['totUsd'])
    for form in ['none', 'pipe']:
        oth = {}
        for r in cell(h, form):
            oth.setdefault(r['task'], []).append(r['totUsd'])
        lo = hi = tie = 0
        for t in tabs:
            if t not in oth:
                continue
            a, b_ = mean(oth[t]), mean(tabs[t])
            if a < b_: lo += 1
            elif a > b_: hi += 1
            else: tie += 1
        p = binom_two_sided(lo, lo + hi)
        H[f'{h}|{form}'] = dict(cheaper=lo, dearer=hi, tie=tie, p=p)
        print(f'{h:<12}{("TAB->" + form.upper()):<12}{lo:>9}{hi:>8}{tie:>5}{p:>13.3f}')
OUTJ['H_signtest'] = H

print('\n=== I. SANITY: delivered ss-* code tokens vs the rollout bill ===')
print(f"{'harness':<12}{'form':<6}{'code tok':>10}{'gutter tok':>11}"
      f"{'modelled code $':>17}{'share of $':>11}")
for h in HARN:
    for form in FORMS:
        c = cell(h, form)
        codeTok = mean(r['deliveredCodeTok'] for r in c)
        g = mean(r['gTok'] for r in c)
        m = mean(r['totUsd'] for r in c)
        # code payload priced with the same ingest+resident weights as the gutter
        share = mean(r['gUsd'] for r in c) / m if m else 0
        code_usd = mean(r['codeUsd'] for r in c)
        print(f'{h:<12}{form:<6}{codeTok:>10.0f}{g:>11.0f}{code_usd:>17.6f}{100*code_usd/m:>10.1f}%')

with open('03-gutter-form-cost.json', 'w', encoding='utf8') as f:
    json.dump(OUTJ, f, indent=1)
print('\nwrote 03-gutter-form-cost.json')
