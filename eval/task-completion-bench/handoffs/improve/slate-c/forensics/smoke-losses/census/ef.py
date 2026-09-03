"""Sections E and F: gain-cell contrasts and candidate-lever token cost."""
import json, os, re, sys, statistics as st, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parselib import *
from census import step_actions, hits_from_output

R = [json.loads(l) for l in open(f"{S}/census/rollouts.jsonl")]
IDX = {(r['h'], r['task'], r['arm'], r['rep']): r for r in R}
OUT = []
def P(s=''):
    print(s); OUT.append(s)

CPT = 4.0   # chars per token, code-ish tool output

# ---------------------------------------------------------------- E
P("\n## E. the cells where sweet gained reps over native\n")
gain = collections.defaultdict(lambda: [0, 0])
for r in R:
    gain[(r['h'], r['task'])][0 if r['arm'] == 'native' else 1] += 1 if r['resolved'] else 0
cells = sorted([k for k, v in gain.items() if v[1] > v[0]], key=lambda k: -(gain[k][1] - gain[k][0]))
P("| harness | task | native solves /3 | sweet solves /3 | delta |")
P("|---|---|---|---|---|")
for h, t in cells:
    P(f"| {h} | {t} | {gain[(h,t)][0]} | {gain[(h,t)][1]} | +{gain[(h,t)][1]-gain[(h,t)][0]} |")
P(f"\n<sub>the brief named 4 gain cells; the data has **{len(cells)}** "
  f"(gleam-lang__gleam-3458 on codex, 1 -> 2, was missing).</sub>\n")
P("| cell | arm-rep | solved | pre-edit calls | code refs | edited-file frac in view | files read | output chars | patched file(s) |")
P("|---|---|---|---|---|---|---|---|---|")
for h, t in cells:
    for arm in ('native', 'sweet'):
        for rep in (0, 1, 2):
            r = IDX[(h, t, arm, rep)]
            P(f"| {h}/{t.split('__')[1]} | {arm}-r{rep} | {'Y' if r['resolved'] else 'n'} | "
              f"{r['n_tool_calls_pre']} | {r['distinct_refs_pre_norm']} | {r['cov_frac_mean']} | "
              f"{r['n_files_read_pre']} | {r['chars_out_pre']} | {', '.join(x.split('/')[-1] for x in r['patch_list'])} |")

# did each rollout run a "symbol-family sweep" pre-edit?
FAMILY = re.compile(r'ss-grep|ss-find|\brg\b|\bgrep\b')
def family_sweep(r):
    """A pre-edit literal search whose pattern names >1 symbol OR is scoped to the edited file."""
    for s in r['searches']:
        if not s['content']: continue
        pat = s['pattern'] or ''
        if '|' in pat or '\\|' in pat: return True, s['cmd']
        if '--in' in (s['cmd'] or ''): return True, s['cmd']
    return False, None
P("\n**did the rollout run one broad symbol-family search before its first edit?**\n")
P("| cell | native yes/3 | sweet yes/3 |")
P("|---|---|---|")
for h, t in cells:
    row = []
    for arm in ('native', 'sweet'):
        row.append(sum(family_sweep(IDX[(h, t, arm, rep)])[0] for rep in (0, 1, 2)))
    P(f"| {h}/{t.split('__')[1]} | {row[0]} | {row[1]} |")

# ---------------------------------------------------------------- F
P("\n## F. token cost of the candidate levers\n")
sizes = json.load(open(f"{S}/census/toolsizes.json"))
g, rd = sorted(sizes['ssgrep_out_chars']), sorted(sizes['ssread_out_chars'])
def q(xs, p): return xs[int(p * (len(xs) - 1))]
P("| observed tool-output size (chars) | n | p25 | median | p75 | median tokens @4 chars/token |")
P("|---|---|---|---|---|---|")
for nm, xs in [('ss-grep step output', g), ('ss-read step output', rd)]:
    P(f"| {nm} | {len(xs)} | {q(xs,.25)} | {q(xs,.5)} | {q(xs,.75)} | {q(xs,.5)/CPT:.0f} |")

# exact re-send multipliers: an output added at call k of N is resent in N-k+1 requests
mult_i, mult_ii, n_ii, mult_iii, extra_iii = [], [], [], [], []
for r in R:
    if r['arm'] != 'sweet': continue
    h, t, rep = r['h'], r['task'], r['rep']
    m, _ = parse_transcript(f"{S}/norm/{h}/{t}-sweet-r{rep}.md")
    calls = [st_ for st_ in m if st_['kind'] == 'tool']
    N = len(calls)
    kpre = r['n_tool_calls_pre']
    mult_i.append(N - kpre + 1)
    tot = 0; cnt = 0
    for k, st_ in enumerate(calls, 1):
        acts = step_actions(h, st_)
        for kind, a in acts:
            c = a.get('cmd') or ''
            if re.search(r'(?<!\S)ss-read(?!\S)', c) and re.search(r'ss-read\s+\S+\s+\d+\s+\d+', c):
                tot += (N - k + 1); cnt += 1
            elif a.get('prog') == 'ss-grep':
                hh, _s = hits_from_output('ss-grep', st_['out'])
                if hh == 1:
                    tot += (N - k + 1); cnt += 1
    mult_ii.append(tot); n_ii.append(cnt)
    # (iii) whole edited file when < 500 lines
    ex = 0; applies = False
    for c in r['cov']:
        if c['n_src'] == 'ss-read-header' and c['n_lines'] and c['n_lines'] < 500:
            applies = True
            ex += max(0, c['n_lines'] - (c['seen'] or 0))
    extra_iii.append((ex, applies)); mult_iii.append(N - kpre + 1)

PROMPT = {'opencode': 481_000, 'codex': 541_000, 'claudecode': 1_140_000}
def prompt_tokens(r):
    u = r.get('usage') or {}
    if r['h'] == 'codex':      return u.get('input_tokens')
    if r['h'] == 'claudecode': return (u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0)
                                       + u.get('cache_creation_input_tokens', 0)) or None
    return None                # opencode rows carry only turns
obs = {}
for h in ['codex', 'opencode', 'claudecode']:
    v = [x for x in (prompt_tokens(r) for r in R if r['arm'] == 'sweet' and r['h'] == h) if x]
    obs[h] = round(st.mean(v)) if v else None
P(f"\nsanity check on the denominator: mean sweet prompt tokens per rollout measured from rows.json = "
  f"codex {obs['codex']:,} (brief 541k), claudecode {obs['claudecode']:,} (brief 1,140k); "
  f"opencode rows carry only a turn count, so its 481k comes from the brief. "
  f"The tables below use the brief's figures.\n")

gm = q(g, .5) / CPT          # tokens of one ss-grep output
CPL_SAMPLES = []
for r in R:
    if r['arm'] != 'sweet': continue
    for c in r['cov']:
        pass
CHARS_PER_LINE = None  # measured just below from ss-read outputs
FOOTER = 30                  # 1-2 line footer, tokens
# measure chars/line directly from ss-read outputs
cpl = []
for r in R[:120]:
    if r['arm'] != 'sweet': continue
    m, _ = parse_transcript(f"{S}/norm/{r['h']}/{r['task']}-sweet-r{r['rep']}.md")
    for st_ in m:
        o = st_['out'] or ''
        hs = re.findall(r'^# ss-read \S+ \(lines (\d+)-(\d+) of \d+\)', o, re.M)
        tot_span = sum(int(b) - int(a) + 1 for a, b in hs)
        if hs and tot_span > 20 and st_['out_true_len']:
            cpl.append(st_['out_true_len'] / tot_span)
CHARS_PER_LINE = st.median(cpl) if cpl else 42
P(f"measured line cost: median **{CHARS_PER_LINE:.0f} chars per source line** of ss-read output "
  f"(n={len(cpl)} ranged reads), i.e. ~{CHARS_PER_LINE/CPT:.0f} tokens per line.\n")
P("**cost model.** A tool output of T tokens produced at call k of N is re-sent in the N-k+1 later "
  "requests, so its cost against the rollout's prompt-token total is T x (N-k+1), not T.\n")
P("| lever | added tokens once | re-send multiplier (mean/median) | added prompt tokens per rollout (mean) | % of sweet prompt tokens |")
P("|---|---|---|---|---|")
def pct(add, h=None):
    d = st.mean([PROMPT[r['h']] for r in R if r['arm'] == 'sweet'])
    return 100 * add / d
rows_f = []
a1 = gm * st.mean(mult_i)
rows_f.append(("(i) one extra ss-grep of a stem in the edited file, just before the first edit",
               f"{gm:.0f}", f"{st.mean(mult_i):.1f} / {st.median(mult_i):.0f}", f"{a1:,.0f}", f"{pct(a1):.2f}%"))
a2 = FOOTER * st.mean(mult_ii)
rows_f.append((f"(ii) +{FOOTER}-token footer on every singleton ss-grep and every ranged ss-read "
               f"({st.mean(n_ii):.1f} such calls per rollout)",
               f"{FOOTER} x {st.mean(n_ii):.1f}", f"{st.mean(mult_ii)/max(st.mean(n_ii),1e-9):.1f} / -",
               f"{a2:,.0f}", f"{pct(a2):.2f}%"))
app = [e for e, a in extra_iii if a]
allx = [e for e, a in extra_iii]
a3 = (st.mean(allx) * CHARS_PER_LINE / CPT) * st.mean(mult_iii)
a3c = (st.mean(app) * CHARS_PER_LINE / CPT) * st.mean(mult_iii) if app else 0
rows_f.append((f"(iii) read the whole edited file when under 500 lines "
               f"(applies to {len(app)}/{len(allx)} sweet rollouts; mean {st.mean(app):.0f} unseen "
               f"lines when it applies, {st.mean(allx):.0f} averaged over all)",
               f"{st.mean(allx)*CHARS_PER_LINE/CPT:,.0f}",
               f"{st.mean(mult_iii):.1f} / {st.median(mult_iii):.0f}", f"{a3:,.0f}", f"{pct(a3):.2f}%"))
for r_ in rows_f: P('| ' + ' | '.join(r_) + ' |')
P(f"| (iii) restricted to the {len(app)} rollouts where the rule fires | "
  f"{st.mean(app)*CHARS_PER_LINE/CPT:,.0f} | {st.mean(mult_iii):.1f} / {st.median(mult_iii):.0f} | "
  f"{a3c:,.0f} | {pct(a3c):.2f}% |")
nl = [c['n_lines'] for r in R if r['arm'] == 'sweet' for c in r['cov']
      if c['n_src'] == 'ss-read-header' and c['n_lines']]
P(f"\n<sub>edited files with a known length (n={len(nl)} file-instances in the sweet arm): median "
  f"{st.median(nl):.0f} lines, {100*sum(1 for x in nl if x<500)/len(nl):.0f}% under 500 lines. "
  f"Cache: ~93% of prompt tokens are cache hits, so the dollar effect is roughly 1/10 of the "
  f"token percentages above.</sub>")
open(f"{S}/census/ef_section.md", 'w').write('\n'.join(OUT) + '\n')
print("\n[written] ef_section.md")
