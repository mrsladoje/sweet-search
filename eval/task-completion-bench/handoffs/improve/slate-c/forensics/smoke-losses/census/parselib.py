"""Shared parsing helpers for the 360-rollout census.

Grammar of $S/norm/<h>/<task>-<arm>-r<rep>.md is fixed by $S/normalize.py:
  header line, then (claudecode only) '# SUBAGENT ...' blocks holding
  '### sub-step N * kind [* tool]', then '---' + '## step N * kind [* tool]'.
Each step may carry free text, then '**INPUT**' fence, then '**OUTPUT**' fence.
Outputs were capped at 12000 chars (6000 in subagent blocks) with a
'...[truncated K chars]' marker, so true output length is recoverable.
"""
import re, os, json, glob

S = "/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/063da756-75ad-43bc-87fc-ccc06d42f3a7/scratchpad"
HARNESSES = ["codex", "opencode", "claudecode"]
RUN = {h: f"{S}/traces/sm-{h}-20260902" for h in HARNESSES}

HEAD_RE = re.compile(r'^(#{1,3}) (?:(step|sub-step) (\d+) · (\S+)(?: · (\S+))?|SUBAGENT .*)\s*$', re.M)
TRUNC_RE = re.compile(r'…\[truncated (\d+) chars\]\s*$')

# ---------------------------------------------------------------- transcript
def parse_transcript(path):
    """-> (main_steps, sub_steps). Each step: dict(idx,kind,tool,text,inp,out,out_true_len)."""
    t = open(path, encoding='utf-8', errors='replace').read()
    heads = list(HEAD_RE.finditer(t))
    main, sub = [], []
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(t)
        if m.group(2) is None:          # a '# SUBAGENT' banner
            continue
        seg = t[m.end():end]
        step = _split_seg(seg)
        step.update(idx=int(m.group(3)), kind=m.group(4), tool=m.group(5))
        (main if m.group(2) == 'step' else sub).append(step)
    return main, sub

def _unfence(block):
    b = block.strip()
    if b.startswith('```'):
        b = b[3:]
        if b.startswith('\n'):
            b = b[1:]
    b = b.rstrip()
    if b.endswith('```'):
        b = b[:-3]
    return b.strip('\n')

def _split_seg(seg):
    oi = seg.find('\n**OUTPUT**\n')
    head = seg if oi < 0 else seg[:oi]
    out = None
    if oi >= 0:
        out = _unfence(seg[oi + len('\n**OUTPUT**\n'):].rstrip().rstrip('-').rstrip())
    ii = head.find('\n**INPUT**\n')
    if ii >= 0:
        inp = _unfence(head[ii + len('\n**INPUT**\n'):])
        text = head[:ii].strip()
    else:
        inp, text = None, head.strip()
    tl = len(out) if out is not None else 0
    if out is not None:
        m = TRUNC_RE.search(out)
        if m:
            tl = len(out) - len(m.group(0)) + int(m.group(1))
    return dict(text=text, inp=inp, out=out, out_true_len=tl)

# ---------------------------------------------------------------- shell split
def shell_segments(cmd):
    """Split a shell string on && || ; and newlines, honouring quotes. Pipelines stay whole."""
    if not cmd:
        return []
    out, cur, q, i = [], [], None, 0
    while i < len(cmd):
        c = cmd[i]
        if q:
            cur.append(c)
            if c == '\\' and q == '"' and i + 1 < len(cmd):
                cur.append(cmd[i + 1]); i += 2; continue
            if c == q:
                q = None
            i += 1; continue
        if c in '"\'':
            q = c; cur.append(c); i += 1; continue
        if c == '\\' and i + 1 < len(cmd):
            cur.append(c); cur.append(cmd[i + 1]); i += 2; continue
        if cmd.startswith('&&', i) or cmd.startswith('||', i):
            out.append(''.join(cur)); cur = []; i += 2; continue
        if c in ';\n':
            out.append(''.join(cur)); cur = []; i += 1; continue
        cur.append(c); i += 1
    out.append(''.join(cur))
    return [s.strip() for s in out if s.strip()]

def pipeline_stages(seg):
    out, cur, q, i = [], [], None, 0
    while i < len(seg):
        c = seg[i]
        if q:
            cur.append(c)
            if c == '\\' and q == '"' and i + 1 < len(seg):
                cur.append(seg[i + 1]); i += 2; continue
            if c == q: q = None
            i += 1; continue
        if c in '"\'':
            q = c; cur.append(c); i += 1; continue
        if c == '|' and not seg.startswith('||', i):
            out.append(''.join(cur)); cur = []; i += 1; continue
        cur.append(c); i += 1
    out.append(''.join(cur))
    return [s.strip() for s in out if s.strip()]

def head_word(stage):
    toks = stage.split()
    for tk in toks:
        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', tk):
            continue
        return tk.strip('()')
    return ''

SEARCH_CMDS = {'rg', 'grep', 'egrep', 'fgrep', 'ag', 'ack',
               'ss-grep', 'ss-search', 'ss-find'}
SS_OTHER = {'ss-semantic', 'ss-trace'}
READ_CMDS = {'sed', 'cat', 'head', 'tail', 'nl', 'awk', 'ss-read'}

def first_arg(stage):
    """First non-flag, non-command argument (a search pattern, usually quoted)."""
    toks = _tokens(stage)
    if not toks:
        return None
    skip_val = {'-g', '-e', '-k', '--regex', '--include', '--glob', '-t', '-m',
                '--max-count', '-A', '-B', '-C', '--in', '-f'}
    i = 1
    while i < len(toks):
        tk = toks[i]
        if tk in skip_val:
            i += 2; continue
        if tk.startswith('-'):
            i += 1; continue
        return tk
        i += 1
    return None

def _tokens(stage):
    out, cur, q = [], [], None
    for c in stage:
        if q:
            if c == q:
                q = None
            else:
                cur.append(c)
            continue
        if c in '"\'':
            q = c; continue
        if c.isspace():
            if cur: out.append(''.join(cur)); cur = []
            continue
        cur.append(c)
    if cur: out.append(''.join(cur))
    return out

# ---------------------------------------------------------------- paths
PFX = re.compile(r'^/?root/\.ss-eval/runs/r\d+-\d+/')
WT = re.compile(r'^\.claude/worktrees/agent-[0-9a-f]+/')
def relpath(p):
    if not p: return p
    p = p.strip().strip('"\'')
    p = PFX.sub('', p)
    p = p.lstrip('./')
    p = WT.sub('', p)
    return p

# ---------------------------------------------------------------- hit counts
def hits_from_output(cmdhead, out):
    if out is None:
        return None, 'no-output'
    m = re.search(r'^# ss-grep: (\d+) total match', out, re.M)
    if m: return int(m.group(1)), 'ss-grep-header'
    m = re.search(r'^# ss-find: \S+ (\d+) for ', out, re.M)
    if m: return int(m.group(1)), 'ss-find-header'
    m = re.search(r'\bresults=(\d+)\b', out)
    if m: return int(m.group(1)), 'results='
    m = re.search(r'\bspans=(\d+)\b', out)
    if m: return int(m.group(1)), 'spans='
    m = re.search(r'^Found (\d+) matches', out, re.M)
    if m: return int(m.group(1)), 'Found-N'
    lines = [l for l in out.split('\n') if l.strip()]
    hitl = [l for l in lines if re.match(r'^\s*(/|\w|\.)[\w./+-]*:\d+[:\s]', l)]
    if hitl: return len(hitl), 'path:line-lines'
    if 'No matches' in out or 'no matches' in out: return 0, 'no-match-text'
    return len(lines), 'nonempty-lines'
