#!/usr/bin/env python3
"""p1-gutter.py — INDEPENDENT re-tokenisation of the delivered ss-* blocks.

Reads data/blocks.ndjson.gz (the raw delivered block bodies extracted by e3-extract),
re-implements gutter stripping and re-rendering, re-tokenises with o200k_base, and
re-prices with the residency model. Does NOT read blocks-tok.ndjson.
"""
import gzip, json, re, sys, collections, statistics
import tiktoken

ENC = tiktoken.get_encoding('o200k_base')
SRC = sys.argv[1] if len(sys.argv) > 1 else 'data/blocks.ndjson.gz'

TAB_RE = re.compile(r'^(\d+)\t')
PIPE_RE = re.compile(r'^(\d+)\| ')

def strip_and_numbers(body, gf):
    """Return (stripped_body, numbers, n_gutted, n_lines)."""
    lines = body.split('\n')
    out, nums, gut = [], [], 0
    for ln in lines:
        m = TAB_RE.match(ln) if gf == 'tab' else (PIPE_RE.match(ln) if gf == 'pipe' else None)
        if m:
            nums.append(int(m.group(1)))
            out.append(ln[m.end():])
            gut += 1
        else:
            nums.append(None)
            out.append(ln)
    return '\n'.join(out), nums, gut, len(lines)

def render(stripped, nums, form):
    lines = stripped.split('\n')
    out = []
    for ln, n in zip(lines, nums):
        if n is None or form == 'none':
            out.append(ln)
        elif form == 'tab':
            out.append(f'{n}\t{ln}')
        else:
            out.append(f'{n}| {ln}')
    return '\n'.join(out)

FENCE_PRE = '```\n'
FENCE_POST = '\n```'
def tok(s):
    return len(ENC.encode(FENCE_PRE + s + FENCE_POST, disallowed_special=()))

per_rollout = collections.defaultdict(lambda: dict(
    gutTok=0, gutUsd=0.0, ingestUsd=0.0, residUsd=0.0,
    tabUsd=0.0, pipeUsd=0.0, noneUsd=0.0, lines=0, gutLines=0, blocks=0,
    surf=collections.Counter(), surfLines=collections.Counter(), weightSum=0.0, residSum=0))
nblocks = 0
weight_mismatch = 0
per_line = collections.defaultdict(lambda: [0, 0, 0])   # harness -> [lines, tabExtra, pipeExtra]

with gzip.open(SRC, 'rt') as fh:
    for line in fh:
        b = json.loads(line)
        nblocks += 1
        rid = b['id']
        harness, form, arm, task, rep = rid.split('|')
        gf = b['gf']
        body = b['body']
        stripped, nums, gut, nlines = strip_and_numbers(body, gf)
        t_del = tok(body)
        t_strip = tok(stripped)
        t_tab = tok(render(stripped, nums, 'tab'))
        t_pipe = tok(render(stripped, nums, 'pipe'))
        # residency weight: ingest once at $0.10/M, then $0.01/M for `resid` further requests
        resid = b['resid']
        w = (0.10 + 0.01 * resid) / 1e6
        if abs(w - b['weight']) > 1e-12:
            weight_mismatch += 1
        R = per_rollout[rid]
        R['blocks'] += 1
        R['lines'] += nlines
        R['gutLines'] += gut
        R['gutTok'] += (t_del - t_strip)
        R['gutUsd'] += (t_del - t_strip) * w
        R['ingestUsd'] += (t_del - t_strip) * 0.10 / 1e6
        R['residUsd'] += (t_del - t_strip) * 0.01 * resid / 1e6
        R['tabUsd'] += (t_tab - t_strip) * w
        R['pipeUsd'] += (t_pipe - t_strip) * w
        R['surf'][b['surf']] += 1
        R['surfLines'][b['surf']] += nlines
        R['weightSum'] += w
        R['residSum'] += resid
        if gut:
            pl = per_line[harness + '|' + gf]
            pl[0] += gut
            pl[1] += (t_tab - t_strip)
            pl[2] += (t_pipe - t_strip)

print(f'blocks={nblocks} rollouts={len(per_rollout)} weight-model mismatches={weight_mismatch}')

# per cell
cells = collections.defaultdict(list)
for rid, R in per_rollout.items():
    harness, form, arm, task, rep = rid.split('|')
    cells[(harness, form)].append(R)

print('\n=== per-rollout gutter cost (my tokenisation) ===')
print(f'{"harness":<12}{"form":<6}{"n":>5}{"blocks":>8}{"lines":>8}{"gutLines":>9}{"gutTok":>9}{"gutUsd":>11}{"ingest":>10}{"resid":>10}{"residShare":>11}{"tok/line":>9}')
res = {}
for (h, f), rs in sorted(cells.items()):
    n = len(rs)
    m = lambda k: sum(r[k] for r in rs) / n
    gl = m('gutLines')
    res[(h, f)] = dict(gutUsd=m('gutUsd'), gutTok=m('gutTok'), lines=m('lines'), gutLines=gl,
                       tabUsd=m('tabUsd'), pipeUsd=m('pipeUsd'), ingest=m('ingestUsd'), resid=m('residUsd'))
    share = m('residUsd') / m('gutUsd') if m('gutUsd') else 0
    print(f'{h:<12}{f:<6}{n:>5}{m("blocks"):>8.1f}{m("lines"):>8.1f}{gl:>9.1f}{m("gutTok"):>9.1f}{m("gutUsd"):>11.6f}{m("ingestUsd"):>10.6f}{m("residUsd"):>10.6f}{share:>11.3f}{(m("gutTok")/gl if gl else 0):>9.3f}')

print('\n=== per-gutted-line token overhead (all cells with a gutter, my tokenisation) ===')
for k, (lines, tabx, pipex) in sorted(per_line.items()):
    print(f'  {k}: guttedLines={lines} tabExtra/line={tabx/lines:.3f} pipeExtra/line={pipex/lines:.3f} pipe-tab={(pipex-tabx)/lines:.3f}')

print('\n=== counterfactual: TAB cell re-rendered as NONE / PIPE (behaviour held fixed) ===')
for h in ['codex', 'opencode', 'claude-code']:
    if (h, 'tab') not in res: continue
    r = res[(h, 'tab')]
    print(f'  {h}: TAB gutter costs ${r["tabUsd"]:.6f}/rollout; as PIPE it would cost ${r["pipeUsd"]:.6f}; '
          f'direct TAB->NONE = ${-r["tabUsd"]:.6f}; direct TAB->PIPE = ${r["pipeUsd"]-r["tabUsd"]:.6f}')

print('\n=== delivered code lines by surface (TAB cells) ===')
for h in ['codex', 'opencode', 'claude-code']:
    rs = cells.get((h, 'tab'), [])
    if not rs: continue
    n = len(rs)
    tot = collections.Counter()
    for r in rs: tot.update(r['surfLines'])
    s = sum(tot.values())
    print(f'  {h}: lines/rollout={s/n:.1f} ' + ' '.join(f'{k}={v/n:.1f}({100*v/s:.1f}%)' for k, v in tot.most_common()))
