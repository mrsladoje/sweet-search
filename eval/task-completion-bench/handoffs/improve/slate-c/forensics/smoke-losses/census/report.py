"""Sections A-F of the census report. Prints tables and writes reports/census.md."""
import json, os, statistics as st, collections, math, re, sys
S = "/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/063da756-75ad-43bc-87fc-ccc06d42f3a7/scratchpad"
R = [json.loads(l) for l in open(f"{S}/census/rollouts.jsonl")]
H = ['codex', 'opencode', 'claudecode']
OUT = []
def P(s=''):
    print(s); OUT.append(s)

def m_(xs):
    xs = [x for x in xs if x is not None]
    return (round(st.mean(xs), 2), round(st.median(xs), 2), len(xs)) if xs else (None, None, 0)
def sh(xs):
    xs = [x for x in xs if x is not None]
    return (round(100 * sum(bool(x) for x in xs) / len(xs), 1), len(xs)) if xs else (None, 0)
def fm(v): return '-' if v is None else (f"{v:g}" if isinstance(v, float) else str(v))

MEAS = [
    ('1 first content-search hits',      lambda r: r['fcs_hits']),
    ('1 singleton_first (content) %',    lambda r: r['singleton_first_content'], 'share'),
    ('1 singleton_first (as-spec) %',    lambda r: r['singleton_first'], 'share'),
    ('2 broad search pre-edit %',        lambda r: r['broad_pre'], 'share'),
    ('3 distinct code refs pre (norm)',  lambda r: r['distinct_refs_pre_norm']),
    ('3 distinct refs, spec regex only',  lambda r: r['distinct_refs_pre']),
    ('4 edited-file frac in view pre',   lambda r: r['cov_frac_mean']),
    ('5 whole edited file read pre %',   lambda r: r['whole_file_pre'], 'share'),
    ('6 files read pre-edit',            lambda r: r['n_files_read_pre']),
    ('6 chars of tool output pre-edit',  lambda r: r['chars_out_pre']),
    ('6 tool calls pre-edit',            lambda r: r['n_tool_calls_pre']),
    ('- searches pre-edit (content)',    lambda r: r['n_content_searches_pre']),
    ('- steps to first edit',            lambda r: r['first_edit_step']),
    ('- subagent tool calls',            lambda r: r['sub_tool_calls']),
    ('- subagent output chars',          lambda r: r['sub_chars']),
]

def table(rows_by_col, cols, title):
    P(f"\n**{title}**\n")
    P('| measure | ' + ' | '.join(cols) + ' |')
    P('|---|' + '---|' * len(cols))
    for spec in MEAS:
        name, f = spec[0], spec[1]
        kind = spec[2] if len(spec) > 2 else 'num'
        cells = []
        for c in cols:
            rs = rows_by_col[c]
            if kind == 'share':
                v, n = sh([f(r) for r in rs]); cells.append('-' if v is None else f"{v}% (n={n})")
            else:
                mu, md, n = m_([f(r) for r in rs])
                cells.append('-' if mu is None else f"{fm(mu)} / {fm(md)}")
        P(f"| {name} | " + ' | '.join(cells) + ' |')
    P('\n<sub>numeric cells are mean / median; share cells are % true (n with a defined value).</sub>')

# ---------------------------------------------------------------- task sets
solved_sweet = sorted({r['task'] for r in R if r['arm'] == 'sweet' and r['resolved']})
solved_any   = sorted({r['task'] for r in R if r['resolved']})
never        = sorted({r['task'] for r in R} - set(solved_any))
P("# Retrieval census: 360 rollouts, sweet vs native\n")
P(f"- rollouts parsed: **{len(R)}** (20 tasks x 2 arms x 3 reps x 3 harnesses); every rollout has a first edit.")
P(f"- tasks with >=1 **sweet** solve anywhere: **{len(solved_sweet)}** -> {', '.join(solved_sweet)}")
P(f"- tasks with >=1 solve in **either** arm: **{len(solved_any)}**; never solved by anyone: **{len(never)}** -> {', '.join(never)}")
P(f"- (the brief said 8 solvable / 12 never-solved; the data says **9 / 11**.)")
P("\n## Headline\n")
P("1. **Sweet reads a much narrower slice of the repo before it edits, but not a narrower slice of the "
  "file it edits.** Pooled, sweet sees 58 distinct code locations before its first edit against native's "
  "113 (median 51 vs 100), 4.3 files against 6.7, 49k output characters against 59k, and 11.9 tool calls "
  "against 15.0; on codex and opencode the reference gap is about 2.5x. Inside the file it finally "
  "patches, sweet is if anything better covered -- 0.86 median fraction in view against native's 0.75 -- "
  "though native reads that file end to end more often (36.7% vs 21.7%). The narrowing is lateral: "
  "fewer neighbouring files, not fewer lines of the target.")
P("2. **The `trust the top hit and stop` instruction is not what sweet mostly does, but where it does, "
  "it hurts.** Only 5.0% of sweet rollouts open with a single-hit content search, and the median first "
  "search returns 11 hits. What sweet actually drops is pattern breadth, not search count: 64.4% of "
  "sweet rollouts use a broad pattern before editing against 93.3% of native, at 4.9 vs 4.4 searches. "
  "The clearest single failure in the whole set is the literal case: `codex/squashql__squashql-295-"
  "sweet-r0` ran `ss-grep \"sub-query in a sub-query is not supported\"`, got exactly 1 hit, read 66 of "
  "`QueryResolver.java`'s 468 lines, saw 3 code references, and failed -- while all 9 native reps on "
  "that task solved it.")
P("3. **No pre-edit retrieval measure separates a solved sweet rollout from a failed one once task "
  "difficulty is held fixed.** Only 6 of 20 tasks have both a sweet solve and a sweet failure. Across "
  "those 6, the best measure is *chars of tool output pre-edit* at 5 tasks up / 1 down, sign-test "
  "p = 0.219, and it points the wrong way for a narrowing lever: the rollouts that solved read MORE. "
  "The eye-catching pooled odds ratios in B1/B3 are task mix, not behaviour.")
P("4. **The sufficiency-verdict lever is aimed at a behaviour the agent already has.** After a "
  "`sufficient=no` or `sufficient=unknown` verdict the agent's next action is another search 52% of the "
  "time and a read 29% of the time; it goes straight to an edit 3% of the time. There is no population "
  "of rollouts that sees a low verdict and charges ahead.")
P("5. **All three candidate levers are cheap.** Re-send-corrected, one extra ss-grep costs 0.26% of the "
  "sweet arm's prompt tokens, a footer on singleton hits 0.44%, and reading the whole edited file when "
  "it is under 500 lines 0.22% (0.41% among the 94/180 rollouts where it fires). At ~93% cache hits "
  "the dollar effect is roughly a tenth of that. Cost is not what should decide these.")
P("\n## A. sweet vs native\n")

by = {}
for h in H:
    for a in ('native', 'sweet'):
        by[f"{h} {a}"] = [r for r in R if r['h'] == h and r['arm'] == a]
by['POOL native'] = [r for r in R if r['arm'] == 'native']
by['POOL sweet']  = [r for r in R if r['arm'] == 'sweet']
table(by, ['POOL native', 'POOL sweet'], 'A1 pooled (180 vs 180)')
table(by, [f"{h} {a}" for h in H for a in ('native', 'sweet')], 'A2 per harness (30 vs 30 each)')

# ---------------------------------------------------------------- B
def odds(a, b, c, d):
    """a=hi&solved b=hi&failed c=lo&solved d=lo&failed ; Haldane 0.5 correction."""
    if 0 in (a, b, c, d): a, b, c, d = a + .5, b + .5, c + .5, d + .5
    return (a * d) / (b * c)

def mh_or(rs, f, kind, strat):
    """Mantel-Haenszel OR, one stratum per key -> holds task difficulty fixed."""
    num = den = 0.0; used = 0
    by = collections.defaultdict(list)
    for r in rs:
        if f(r) is not None: by[strat(r)].append(r)
    allv = [f(r) for r in rs if f(r) is not None]
    if not allv: return None, 0
    med = None if kind == 'share' else st.median(allv)
    for k, g in by.items():
        if kind == 'share':
            hi = [r for r in g if f(r)]; lo = [r for r in g if not f(r)]
        else:
            hi = [r for r in g if f(r) >= med]; lo = [r for r in g if f(r) < med]
        if not hi or not lo: continue
        a = sum(r['resolved'] for r in hi); b = len(hi) - a
        c = sum(r['resolved'] for r in lo); d = len(lo) - c
        n = len(g)
        if a + b + c + d == 0: continue
        num += a * d / n; den += b * c / n; used += 1
    if den == 0 or used == 0: return None, used
    return num / den, used

def sep_table(rs, label, strat=None, MINV=10):
    P(f"\n**{label}** (n={len(rs)}, solved={sum(r['resolved'] for r in rs)})\n")
    P('| measure | cut | solved>=cut / failed>=cut | solved<cut / failed<cut | crude OR | task-stratified OR (MH) |')
    P('|---|---|---|---|---|---|')
    best = []
    for spec in MEAS:
        name, f = spec[0], spec[1]
        kind = spec[2] if len(spec) > 2 else 'num'
        vals = [(f(r), r['resolved']) for r in rs if f(r) is not None]
        if len(vals) < MINV: continue
        if kind == 'share':
            cut = 'true'
            hi = [(v, s) for v, s in vals if v]; lo = [(v, s) for v, s in vals if not v]
        else:
            med = st.median([v for v, _ in vals])
            cut = f"{fm(round(med,2))}"
            hi = [(v, s) for v, s in vals if v >= med]; lo = [(v, s) for v, s in vals if v < med]
            if not lo or not hi: continue
        a = sum(s for _, s in hi); b = len(hi) - a
        c = sum(s for _, s in lo); d = len(lo) - c
        orr = odds(a, b, c, d)
        mh, used = (mh_or(rs, f, kind, strat) if strat else (None, 0))
        best.append((abs(math.log(mh if mh else orr)), name, cut, a, b, c, d, orr, mh))
        P(f"| {name} | {cut} | {a} / {b} | {c} / {d} | {orr:.2f} | {'-' if mh is None else f'{mh:.2f} ({used} strata)'} |")
    best.sort(reverse=True)
    P(f"\nstrongest separator: **{best[0][1]}** (crude OR {best[0][7]:.2f}, MH {'-' if best[0][8] is None else format(best[0][8],'.2f')})" if best else "")
    return best

P("\n## B. within-arm: solved vs failed\n")
sw_all = [r for r in R if r['arm'] == 'sweet']
na_all = [r for r in R if r['arm'] == 'native']
sw_9   = [r for r in sw_all if r['task'] in solved_sweet]
na_9   = [r for r in na_all if r['task'] in solved_any]
b1 = sep_table(sw_all, 'B1 sweet, all 20 tasks')
b2 = sep_table(sw_9,  'B2 sweet, restricted to the 9 sweet-solvable tasks', strat=lambda r: r['task'])
b3 = sep_table(na_all, 'B3 native, all 20 tasks')
b4 = sep_table(na_9,  'B4 native, restricted to the 9 native-solvable tasks', strat=lambda r: r['task'])

def signtest(rs, label):
    """Within each task that has both a solve and a failure, compare solved vs failed medians.
    Counting tasks (not rollouts) removes task-difficulty confounding entirely."""
    by = collections.defaultdict(list)
    for r in rs: by[r['task']].append(r)
    disc = {t: g for t, g in by.items()
            if any(x['resolved'] for x in g) and any(not x['resolved'] for x in g)}
    P(f"\n**{label}** - discriminating tasks (both a solve and a failure in this arm): "
      f"{len(disc)} of {len(by)} -> {', '.join(sorted(disc))}\n")
    P('| measure | tasks where solved > failed | solved < failed | tie | two-sided sign-test p |')
    P('|---|---|---|---|---|')
    for spec in MEAS:
        name, f = spec[0], spec[1]
        up = dn = tie = 0
        for t, g in disc.items():
            sv = [f(r) for r in g if r['resolved'] and f(r) is not None]
            fv = [f(r) for r in g if not r['resolved'] and f(r) is not None]
            if not sv or not fv: continue
            a, b = st.median([float(x) for x in sv]), st.median([float(x) for x in fv])
            if a > b: up += 1
            elif a < b: dn += 1
            else: tie += 1
        n = up + dn
        if n == 0: pv = '-'
        else:
            k = min(up, dn)
            pv = f"{min(1.0, 2*sum(math.comb(n,i) for i in range(k+1))/2**n):.3f}"
        P(f"| {name} | {up} | {dn} | {tie} | {pv} |")

signtest(sw_all, 'B5 sweet, within-task sign test')
signtest(na_all, 'B6 native, within-task sign test')

# ---------------------------------------------------------------- C
P("\n## C. within-task contrasts (tasks where sweet loses reps)\n")
LOSE = ['squashql__squashql-295', 'getmoto__moto-6716', 'gleam-lang__gleam-3458']
cols = ['id', 'arm', 'res', 'fcs prog', 'fcs hits', 'broad', 'refs', 'frac', 'whole', 'files', 'chars', 'calls', 'patch/gold']
for t in LOSE:
    P(f"\n**{t}** (gold source files = {[r for r in R if r['task']==t][0]['gold_src_files']})\n")
    P('| ' + ' | '.join(cols) + ' |')
    P('|' + '---|' * len(cols))
    for r in sorted([x for x in R if x['task'] == t], key=lambda x: (x['arm'], x['h'], x['rep'])):
        P('| ' + ' | '.join([
            f"{r['h']}-r{r['rep']}", r['arm'], 'Y' if r['resolved'] else 'n',
            str(r['fcs_prog']), fm(r['fcs_hits']), 'Y' if r['broad_pre'] else 'n',
            str(r['distinct_refs_pre_norm']), fm(r['cov_frac_mean']),
            'Y' if r['whole_file_pre'] else 'n', str(r['n_files_read_pre']),
            str(r['chars_out_pre']), str(r['n_tool_calls_pre']),
            f"{r['patch_files']}/{r['gold_src_files']}"]) + ' |')
    sub = [r for r in R if r['task'] == t and r['arm'] == 'sweet']
    sep_table(sub, f"C-within sweet on {t}", MINV=6)

# ---------------------------------------------------------------- D
P("\n## D. the sufficiency-verdict claim\n")
def vstats(rs):
    o = {}
    rs = [r for r in rs if r['verdicts']]
    o['n'] = len(rs)
    for tag, pred in [('saw conf=low', lambda r: any(v['conf'] == 'low' for v in r['verdicts'])),
                      ('saw conf=high', lambda r: any(v['conf'] == 'high' for v in r['verdicts'])),
                      ('saw sufficient=YES', lambda r: any(v['suff'] == 'yes' for v in r['verdicts'])),
                      ('LAST verdict overall = YES', lambda r: r['verdicts'][-1]['suff'] == 'yes'),
                      ('LAST pre-edit verdict = YES', lambda r: ([v for v in r['verdicts'] if v['pre']] or [{'suff': None}])[-1]['suff'] == 'yes'),
                      ('any pre-edit verdict', lambda r: any(v['pre'] for v in r['verdicts']))]:
        s = [r for r in rs if r['resolved']]; f = [r for r in rs if not r['resolved']]
        o[tag] = (round(100 * sum(pred(r) for r in s) / len(s), 1) if s else None,
                  round(100 * sum(pred(r) for r in f) / len(f), 1) if f else None, len(s), len(f))
    return o
P('| population | n(with verdicts) | metric | solved | failed |')
P('|---|---|---|---|---|')
pops = [('sweet, all 20 tasks', sw_all), ('sweet, 9 solvable tasks', sw_9)] + \
       [(f'sweet, {t}', [r for r in R if r['task'] == t and r['arm'] == 'sweet']) for t in LOSE]
for nm, rs in pops:
    o = vstats(rs)
    for k, v in o.items():
        if k == 'n': continue
        P(f"| {nm} | {o['n']} | {k} | {'-' if v[0] is None else str(v[0])+'% (n='+str(v[2])+')'} | {'-' if v[1] is None else str(v[1])+'% (n='+str(v[3])+')'} |")
nxt = collections.Counter(); nxt_yes = collections.Counter()
for r in sw_all:
    for v in r['verdicts']:
        (nxt if v['suff'] in ('no', 'unknown') else nxt_yes)[v['nxt'] or 'END'] += 1
P("\n**next tool after a verdict**\n")
P('| next action | after sufficient=no/unknown | after sufficient=YES |')
P('|---|---|---|')
tot_a, tot_b = sum(nxt.values()), sum(nxt_yes.values())
for k in sorted(set(nxt) | set(nxt_yes), key=lambda x: -(nxt[x] + nxt_yes[x])):
    P(f"| {k} | {nxt[k]} ({100*nxt[k]/tot_a:.0f}%) | {nxt_yes[k]} ({100*nxt_yes[k]/tot_b:.0f}%) |")
P(f"| **total** | {tot_a} | {tot_b} |")

# per-task view of the verdict signal, so difficulty is held fixed
disc = sorted({r['task'] for r in sw_all if r['verdicts']}
              & {t for t in solved_sweet}
              & {r['task'] for r in sw_all if not r['resolved']})
P("\n**the same two metrics, one row per discriminating task (both a solve and a failure in sweet)**\n")
P('| task | solved reps | failed reps | saw conf=low: solved / failed | last verdict = YES: solved / failed |')
P('|---|---|---|---|---|')
up = dn = tie = 0
for t in disc:
    g = [r for r in sw_all if r['task'] == t and r['verdicts']]
    sv = [r for r in g if r['resolved']]; fv = [r for r in g if not r['resolved']]
    if not sv or not fv: continue
    lo = (sum(any(v['conf'] == 'low' for v in r['verdicts']) for r in sv) / len(sv),
          sum(any(v['conf'] == 'low' for v in r['verdicts']) for r in fv) / len(fv))
    ye = (sum(r['verdicts'][-1]['suff'] == 'yes' for r in sv) / len(sv),
          sum(r['verdicts'][-1]['suff'] == 'yes' for r in fv) / len(fv))
    if ye[0] > ye[1]: up += 1
    elif ye[0] < ye[1]: dn += 1
    else: tie += 1
    P(f"| {t} | {len(sv)} | {len(fv)} | {lo[0]*100:.0f}% / {lo[1]*100:.0f}% | {ye[0]*100:.0f}% / {ye[1]*100:.0f}% |")
P(f"\nlast-verdict-YES points the right way on **{up}** tasks, the wrong way on **{dn}**, ties on "
  f"**{tie}**. With task difficulty held fixed the verdict carries no usable signal.")
P("\n**plain answer.** The original numbers reproduce: pooled, 67.2% of solved sweet rollouts saw a "
  "`confidence=low` verdict against 92.8% of failed, and 34.5% ended on `sufficient=YES` against 18.9%. "
  "Restricting to the 9 sweet-solvable tasks keeps the direction (67.2 vs 90.5, and 34.5 vs 14.3). But "
  "the association is between the verdict and *how hard the task is*, not between the verdict and the "
  "outcome of a given attempt: the 11 tasks nobody ever solves are the tasks where every search comes "
  "back low-confidence. Held at one task the signal disappears or reverses, and the proposed remedy "
  "-- widen the search when the verdict is low -- describes what the agent already does in 52% of cases.")


# ------------------------------------------------------------- E,F + method
import subprocess
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ef.py')],
               capture_output=True)
OUT.append(open(f"{S}/census/ef_section.md").read())

P("\n### E, in plain terms\n")
P("On yasson-395 the gain is a file-selection win, not a depth win: all three codex native reps edit "
  "`SerializerBuilder.java` and all three fail, while all three sweet reps edit `Marshaller.java`, the "
  "file the gold patch touches, because the first `ss-search` named it. The sweet rep that still failed "
  "(codex sweet-r0) did 9 pre-edit calls and saw 16 references, against 19/74 and 15/67 for the two that "
  "solved. On uniforms-787 and markdown-1294 the failing native rep is the shallow one (7 and 5 pre-edit "
  "calls, 0 code references) while every sweet rep ran a symbol-family `ss-grep` before editing.")
P("A rule of *always run one broad stem grep of the symbol family in the edited file before the first "
  "edit* would have changed the path in exactly one of these 15 sweet rollouts: codex/yasson sweet-r0, "
  "the only sweet failure among them, which went straight from one `ss-search` to ranged reads. In the "
  "other 14 it either fires on a search the rollout already made or adds one call. Native already "
  "satisfies the rule in 14 of 15 of these rollouts, sweet in 8 of 15 -- so the rule mostly closes a gap "
  "sweet opened, at the cost in F(i): about 220 tokens once, 1.9k prompt tokens after re-send, 0.26%.")

P("\n## Method, and what these numbers cannot say\n")
P("- Source: the 360 normalised transcripts in `$S/norm/<harness>/`, the three `rows.json` outcome "
  "files, `$S/traces/<run>/{native,sweet}[/rep-N]/patches.json` for the final patch file list, and "
  "`$S/gold/*.gold.diff`. Scripts: `$S/census/{parselib,census,report,ef}.py`; per-rollout records in "
  "`$S/census/rollouts.jsonl`. Re-run with `python3 census.py && python3 report.py`.")
P("- **Edits are not always a tool call.** codex applies some patches as `apply_patch <<'PATCH'` inside "
  "a shell call, so 5 rollouts had no `EDIT` heading; shell-level `apply_patch`/`sed -i` now counts as "
  "the first edit. Without that fix those rollouts measure their whole trajectory as pre-edit.")
P("- **`sufficient=YES` is uppercase** in the tool output while `no`/`unknown` are lowercase. A "
  "case-sensitive scan finds zero YES verdicts. There are 135.")
P("- **Measure 3 is harness-shaped.** opencode's grep tool prints `<path>:` then `  Line N:` instead of "
  "`path:line`, so the brief's regex scores opencode native at 0.2 refs. The reported figure normalises "
  "that format; the raw-regex row is kept beside it.")
P("- **Measure 4 and 5 denominators had to be repaired.** `ss-read` prints a true file length "
  "(`lines a-b of N`); native never calls `ss-read`, so on native alone the only denominator available "
  "is the highest line number the transcript happens to show, which scored 129 native file-instances as "
  "a whole-file read purely because nothing deeper was ever mentioned. True lengths are therefore "
  "harvested from every `ss-read` header in **any** rollout of the same task and applied to both arms: "
  "479 of 480 edited-file instances now have a real line count. With the broken denominators the "
  "whole-file rate read 55.0% native / 47.2% sweet; corrected it is **36.7% / 21.7%**. Do not use the "
  "earlier figure.")
P("- **claudecode subagents** are reported in their own columns and excluded from the pre-edit measures. "
  "claudecode native puts 25 tool calls and 85k output chars per rollout inside a subagent; 10 of its 60 "
  "native rollouts run no search at all in the main transcript because the subagent did it.")
P("- Hit counts for native shell searches come from the step output; 68 of 180 native rollouts issue "
  "their first content search inside a compound `a && b; c` command, so that count can include other "
  "commands' lines. ss-* hit counts are exact (`# ss-grep: N total match(es)`, `results=N`).")
P("- Nine rollouts per task-arm cell is too few for a within-task test. Section C tables are evidence "
  "for reading trajectories, not significance claims.")

json.dump(dict(solved_sweet=solved_sweet, solved_any=solved_any, never=never),
          open(f"{S}/census/tasksets.json", 'w'))
open(f"{S}/reports/census.md", 'w').write('\n'.join(OUT) + '\n')
print("\n[written]", f"{S}/reports/census.md")
