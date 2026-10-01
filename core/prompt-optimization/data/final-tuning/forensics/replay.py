#!/usr/bin/env python3
"""replay.py - $0 replay estimator for the proposed ss-* output fixes (final-tuning forensics, 2026-10-01).

Question: how many tokens would each proposed output fix have saved on the REAL recorded trajectories,
weighted by cache-read amplification (every later model request re-reads a tool output)?

Method in one paragraph. Every recorded ss-* output (dossiers.jsonl, full text) is rewritten by a text
transform that imitates the fix. Saved chars = len(before) - len(after). Tokens = chars / 4.
Amplified saved tokens = saved tokens x (1 + amplification), amplification = later requests of the same
thread (dossier field). Dollar value of one saved token = write price + amplification x cache-read price.
No model call, no network, no benchmark run. Read-only on all sources.

  python3 replay.py                 # all tables to stdout
  python3 replay.py --write         # also (re)write REPLAY.md next to this file
  python3 replay.py --validate N    # print N before/after samples per tool (default 5) and run the self checks
  python3 replay.py --validate 5 --out FILE   # same, validation text to FILE

Owner decision 2026-10-01: ss-read is NOT changed. No B3 (read cap), no B4 (gutter off). A3 applies to
ss-search and ss-find outputs only; code that an earlier ss-read showed still counts as "already shown".

Reuses ss_parse.py (regexes, gutter detection, bucket parser for the cross-check). Never opens HO2 data.
"""
import argparse
import json
import math
import os
import random
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ss_parse as P  # noqa: E402

WT = os.path.abspath(os.path.join(HERE, '../../../../..'))
DATA = os.path.join(WT, 'core/prompt-optimization/data/results/final-tuning-forensics')
HKS = ['claudecode-opus', 'claudecode-luna', 'codex-luna', 'opencode-luna']

# $ per MILLION tokens. Opus: the owner's list prices. Luna: the price model in the project memory
# (project_harness_cost_economics: cache read $0.02, fresh input $0.25, validated to 0.2-3.5% against billing).
# Luna has no cache-write surcharge, so "write" = fresh input price.
PRICES = {
    'opus': {'write': 5.0, 'read': 0.2, 'input': 4.0},
    'luna': {'write': 0.25, 'read': 0.02, 'input': 0.25},
}


def price_of(hk):
    return PRICES['opus'] if hk.endswith('opus') else PRICES['luna']


def hk_of(rec):
    h = rec['harness']
    m = (rec.get('model') or '').lower()
    for key in ('opus', 'sonnet', 'luna', 'sol', 'flash', 'deepseek', 'haiku'):
        if key in m:
            return f'{h}-{key}'
    return h + '-unknown'


# =====================================================================================================
# 1. search / find outputs: split -> transform -> render
# =====================================================================================================
TRAILER_RE = re.compile(r'^(?:shown-full: |route=\S+ confidence=|<<SS_ROUTE_META>>)')
CONT_RE = re.compile(r'^# continues at (\S+?):(\d+)')
HEAD_META = ('# ss-search:', '# ss-find:', '# confidence=', '# variant-sentinel')


class Entry:
    __slots__ = ('pre', 'hdr', 'm', 'body', 'file', 'start', 'end', 'symbol', 'pres', 'stale', 'dropped')

    def __init__(self, pre, hdr, m):
        self.pre, self.hdr, self.m, self.body = pre, hdr, m, []
        self.file, self.start, self.end = m.group(3), int(m.group(4)), int(m.group(5))
        sm = P.SYM_RE.match(m.group(6)) if m.group(6) else None
        self.symbol = sm.group(2) if sm else None
        self.pres = m.group(8)
        self.stale = bool(m.group(10))
        self.dropped = False

    def lines(self):
        out = list(self.pre)
        if self.hdr is not None:
            out.append(self.hdr)
        for kind, v in self.body:
            if kind == 'line':
                out.append(v)
            else:  # fence
                out.append(v['open'])
                out.extend(v['content'])
                if v['close'] is not None:
                    out.append(v['close'])
        return out


class Split:
    def __init__(self, head, entries, tail):
        self.head, self.entries, self.tail = head, entries, tail

    def render(self):
        out = list(self.head)
        for e in self.entries:
            if not e.dropped:
                out.extend(e.lines())
        out.extend(self.tail)
        return '\n'.join(out)


def split_search(text):
    lines = text.split('\n')
    tup = [(l, 0) for l in lines]
    head, entries, tail = [], [], []
    cur = None
    pending = []
    pending_role = None
    i = 0
    n = len(lines)

    def body_add(item):
        nonlocal pending
        tgt = cur.body if cur is not None else None
        for b in pending:
            if tgt is None:
                head.append(b)
            else:
                tgt.append(('line', b))
        pending = []
        if tgt is None:
            head.append(item[1])  # only plain lines can occur before the first entry
        else:
            tgt.append(item)

    while i < n:
        l = lines[i]
        if l == '':
            pending.append(l)
            i += 1
            continue
        if TRAILER_RE.match(l):
            tail = pending + lines[i:]
            pending = []
            i = n
            break
        if l.startswith('```') and cur is not None:
            j = i + 1
            while j < n and not (lines[j] == '```' and P._closes(tup, j)):
                j += 1
            role = pending_role or 'code'
            pending_role = None
            blk = {'open': l, 'content': lines[i + 1:min(j, n)], 'close': lines[j] if j < n else None, 'role': role}
            body_add(('fence', blk))
            i = j + 1
            continue
        m = P.RANK_RE.match(l)
        if m:
            cur = Entry(pending, l, m)
            pending = []
            entries.append(cur)
            pending_role = None
            i += 1
            continue
        # plain line
        if l == '### imports':
            pending_role = 'imports'
        elif CONT_RE.match(l):
            pending_role = 'continuation'
        body_add(('line', l))
        i += 1
    if pending:
        tail = pending + tail
    return Split(head, entries, tail)


def entry_has_code(e):
    return any(k == 'fence' and v['role'] == 'code' for k, v in e.body)


def entry_summary_line(e):
    """The one-line summary of a summary-presentation entry, or None."""
    if e.pres != 'summary':
        return None
    lines = [v for k, v in e.body if k == 'line']
    if len(lines) == 1 and len(e.body) == 1 and P.SUMMARY_RE.match(lines[0].strip()):
        return lines[0]
    return None


# ---- the fixes ---------------------------------------------------------------------------------------
def fx_a1(sp):
    """A1 drop metadata: header lines (# ss-search/# ss-find, # confidence=, variant sentinel), the leading blank
    line after them, the presentation/kind tag and `score=` of every rank line, the shown-full: and route= trailers
    (with the blank lines before them). A STALE flag is kept."""
    sp.head = [h for h in sp.head if not h.startswith(HEAD_META)]
    while sp.head and sp.head[0] == '':
        sp.head.pop(0)
    if not sp.head:
        first = next((e for e in sp.entries if not e.dropped), None)
        if first is not None:
            first.pre = []
    for e in sp.entries:
        if e.hdr is None:
            continue
        m = e.m
        e.hdr = (m.group(1) + m.group(3) + ':' + m.group(4) + '-' + m.group(5) + (m.group(6) or '')
                 + (' STALE' if e.stale else ''))
    if sp.tail and any(TRAILER_RE.match(t) for t in sp.tail):
        # drop trailers and the blanks before them; keep a final newline when the original had one
        sp.tail = []


def fx_a2(sp, use_symbol=True):
    """A2: (a) summary entries become ONE line (the existing `path:line - symbol (kind)` line; the rank line that
    only restates it goes away, with its blank separator); (b) drop an entry whose span lies inside an earlier span of
    the same file, or that repeats an earlier file+symbol (summary entries: any earlier entry; entries that show
    code: only an earlier entry that shows code and fully contains the span)."""
    seen = []  # (file, start, end, symbol, has_code)
    for e in sp.entries:
        cov_any = any(f == e.file and ((e.start >= s and e.end <= en) or (use_symbol and e.symbol and sy == e.symbol))
                      for f, s, en, sy, hc in seen)
        cov_code = any(f == e.file and hc and e.start >= s and e.end <= en for f, s, en, sy, hc in seen)
        seen.append((e.file, e.start, e.end, e.symbol, entry_has_code(e)))
        if e.pres == 'summary':
            if cov_any:
                e.dropped = True
                continue
        elif entry_has_code(e) and cov_code:
            e.dropped = True
            continue
    for e in sp.entries:
        if e.dropped:
            continue
        sl = entry_summary_line(e)
        if sl is not None:
            e.pre = []
            e.hdr = None
            e.body = [('line', sl)]


def fx_b1(sp, cap):
    """B1: keep at most `cap` summary-presentation entries (in rank order); drop the rest, with their blank separators."""
    k = 0
    for e in sp.entries:
        if e.dropped or e.pres != 'summary':
            continue
        k += 1
        if k > cap:
            e.dropped = True


def fx_a3(sp, ledger):
    """A3: code lines that an earlier ss-search / ss-find / ss-read / ss-semantic call of the same thread already showed
    (same file, same line number, same text) are replaced by `[lines a-b already shown above]`. A run is replaced only
    when that saves >= 20 chars. A block that is shown in full already is replaced by the marker alone (no fences)."""
    saved_marker = 20
    for e in sp.entries:
        if e.dropped:
            continue
        led = ledger.get(norm_path(e.file))
        if not led:
            continue
        newbody = []
        for kind, v in e.body:
            if kind != 'fence' or v['role'] != 'code':
                newbody.append((kind, v))
                continue
            content = v['content']
            style, glens, nums = P.detect_gutter(content, e.start)
            full = P._fill_numbers(nums, e.start)
            texts = [l[g:] for l, g in zip(content, glens)]
            shown = [(num is not None and (led.get(num) == t or (num > e.end and t == ''))) for num, t in zip(full, texts)]
            if not any(sh for sh, num in zip(shown, full) if num is not None and num <= e.end):
                newbody.append((kind, v))
                continue
            if not any(shown):
                newbody.append((kind, v))
                continue
            # runs
            runs, i = [], 0
            while i < len(content):
                if shown[i]:
                    j = i
                    while j + 1 < len(content) and shown[j + 1]:
                        j += 1
                    runs.append((i, j))
                    i = j + 1
                else:
                    i += 1
            if len(runs) == 1 and runs[0] == (0, len(content) - 1):
                a, b = full[0], full[-1]
                marker = f'[lines {a}-{b} already shown above]'
                blk_chars = len(v['open']) + 1 + sum(len(c) + 1 for c in content) + (len(v['close']) + 1 if v['close'] is not None else 0)
                if blk_chars - (len(marker) + 1) >= saved_marker:
                    newbody.append(('line', marker))
                else:
                    newbody.append((kind, v))
                continue
            out = []
            i = 0
            for (a, b) in runs:
                out.extend(content[i:a])
                run_chars = sum(len(c) + 1 for c in content[a:b + 1])
                marker = f'[lines {full[a]}-{full[b]} already shown above]'
                if run_chars - (len(marker) + 1) >= saved_marker:
                    out.append(marker)
                else:
                    out.extend(content[a:b + 1])
                i = b + 1
            out.extend(content[i:])
            nv = dict(v)
            nv['content'] = out
            newbody.append((kind, nv))
        e.body = newbody


def transform_search(text, ledger=None, a1=False, a2=False, a3=False, b1=None, a2_symbol=True):
    sp = split_search(text)
    if not sp.entries:
        if a1:
            fx_a1(sp)
        return sp.render()
    if a2:
        fx_a2(sp, a2_symbol)   # dedupe before A3, so no chars are counted twice
    if a3 and ledger is not None:
        fx_a3(sp, ledger)
    if b1:
        fx_b1(sp, b1)
    if a1:
        fx_a1(sp)
    return sp.render()


# =====================================================================================================
# 2. shown-code ledger (what code the thread has already seen from ss-* calls)
# =====================================================================================================
RUNS_PREFIX = re.compile(r'^.*?/\.ss-eval/runs/[^/]+/')


def norm_path(p):
    p = RUNS_PREFIX.sub('', p)
    return p[2:] if p.startswith('./') else p


def _add_block(ledger, file, content, start, end=None):
    """Add numbered code lines. Lines numbered beyond the declared end are the padding blank line that every fenced
    block prints before its closing fence; they were never shown and are skipped (a continuation block has no declared
    end: its trailing blank lines are dropped)."""
    if end is None:
        content = list(content)
        while content and content[-1] == '':
            content.pop()
    style, glens, nums = P.detect_gutter(content, start)
    full = P._fill_numbers(nums, start)
    d = ledger.setdefault(norm_path(file), {})
    for l, g, num in zip(content, glens, full):
        if num is not None and (end is None or num <= end):
            d[num] = l[g:]


def ledger_add(ledger, tool, text):
    """Add what one original output showed to the ledger."""
    if tool in ('ss-search', 'ss-find'):
        sp = split_search(text)
        for e in sp.entries:
            cont = None
            for kind, v in e.body:
                if kind == 'line':
                    mm = CONT_RE.match(v)
                    cont = (mm.group(1), int(mm.group(2))) if mm else None
                elif v['role'] == 'code':
                    _add_block(ledger, e.file, v['content'], e.start, e.end)
                elif v['role'] == 'continuation' and cont:
                    _add_block(ledger, cont[0], v['content'], cont[1])
    elif tool == 'ss-read':
        lines = text.split('\n')
        if not lines:
            return
        m = re.match(r'^# ss-read (.+?)(?: \(lines (\d+)-(\d+) of (\d+)\)| \((\d+) lines\))?$', lines[0])
        if not m:
            return
        a = int(m.group(2)) if m.group(2) else 1
        b_end = int(m.group(3)) if m.group(3) else (int(m.group(5)) if m.group(5) else None)
        idx = [k for k, l in enumerate(lines) if l.startswith('```')]
        if not idx:
            return
        first = idx[0]
        last = max([k for k in range(first + 1, len(lines)) if lines[k] == '```'] or [len(lines)])
        _add_block(ledger, m.group(1), lines[first + 1:last], a, b_end)
    elif tool == 'ss-semantic':
        lines = text.split('\n')
        cur = None
        i = 0
        while i < len(lines):
            m = P.SEM_HDR.match(lines[i])
            if m:
                cur = (m.group(1), int(m.group(2)), int(m.group(3)))
            elif lines[i].startswith('```') and cur:
                j = i + 1
                while j < len(lines) and lines[j] != '```':
                    j += 1
                _add_block(ledger, cur[0], lines[i + 1:j], cur[1], cur[2])
                i = j
            i += 1


# =====================================================================================================
# 3. ss-trace (A4)
# =====================================================================================================
MODES = ('callers', 'callees', 'impact')
CALL_RE = re.compile(r'^(.*?) call@(\d+)$')


def trace_mode(args):
    toks = args.split()
    skip = False
    for t in toks[2:]:
        if skip:
            skip = False
            continue
        if t in ('--in', '--file', '--query', '--hint', '--depth', '--budget'):
            skip = True
            continue
        if t.lower() in MODES:
            return t.lower()
    return None


def transform_trace(text, args, lite=False):
    """A4: requested section only; one row per caller/callee (rows with the same name+location merge their call@
    sites); no `answer checklist:` / `answer cues:` lines; no `<<SS_TRACE_META>>` JSON line; `budget=` and `latency=`
    dropped from the fan-in line; target source and the `mode=` hint line dropped. lite=True keeps the caller/callee
    bodies (header + code) and only does the section restriction and the cue/meta cleanup."""
    if text.startswith('No indexed symbol found'):
        return text.split('\n')[0]   # only the JSON meta line (and a blank) follow
    mode = trace_mode(args)
    lines = text.split('\n')
    sec_idx = {}
    for i, l in enumerate(lines):
        if l.startswith('## callers ('):
            sec_idx['callers'] = i
        elif l.startswith('## callees ('):
            sec_idx['callees'] = i
        elif l.startswith('## impact paths'):
            sec_idx['impact'] = i
    if not sec_idx:
        return text
    meta_i = next((i for i, l in enumerate(lines) if l.startswith('<<SS_TRACE_META>>')), len(lines))
    first_sec = min(sec_idx.values())
    out = []
    skipping = False
    for l in lines[:first_sec]:
        if l.startswith('## target'):
            skipping = mode is not None   # a call that asked for a section does not need the target source
            if not skipping:
                out.append(l)
            continue
        if skipping:
            continue
        if l.startswith(('answer checklist:', 'answer cues:', 'mode=')):
            continue
        if l == '' and not (mode is None):
            continue
        out.append(re.sub(r'^(fan-in=\d+ fan-out=\d+) budget=.*$', r'\1', l))
    want = [mode] if mode else [s for s in MODES if s in sec_idx]
    order = sorted(sec_idx.items(), key=lambda kv: kv[1])
    for k, (name, i) in enumerate(order):
        if name not in want:
            continue
        j = order[k + 1][1] if k + 1 < len(order) else meta_i
        body = lines[i:j]
        while body and body[-1] == '':
            body.pop()
        out.append(body[0])
        if lite:
            out.extend(body[1:])
            continue
        if name == 'impact':
            out.extend(b for b in body[1:] if b != '')
            continue
        rows, order_keys, items, cur, fence = {}, [], [], None, False
        for b in body[1:]:
            if b.startswith('```'):
                fence = not fence
                continue
            if fence or b == '':
                continue
            if b.startswith('### '):
                cur = []
                items.append(cur)
            elif cur is not None and not cur:
                cur.append(b)
            elif cur is None:
                out.append(b)  # '(none)' or a stray line
        for it in items:
            if not it:
                continue
            mm = CALL_RE.match(it[0])
            key, site = (mm.group(1), mm.group(2)) if mm else (it[0], None)
            if key not in rows:
                rows[key] = []
                order_keys.append(key)
            if site:
                rows[key].append(site)
        for key in order_keys:
            out.append(key + (' call@' + ','.join(rows[key]) if rows[key] else ''))
    return '\n'.join(out)


# =====================================================================================================
# 4. ss-grep (B7)
# =====================================================================================================
TEST_DIR = re.compile(r'(^|/)(tests?|__tests__|spec|specs|__spec__|fixtures?|__fixtures__|testdata|test_data|testing|e2e|__snapshots__)(/|$)', re.I)
TEST_FILE = re.compile(r'(\.(test|spec)\.[A-Za-z0-9]+$|_tests?\.[A-Za-z0-9]+$|_spec\.[A-Za-z0-9]+$|(^|/)test_[^/]*\.py$|(^|/)conftest\.py$|'
                       r'(Tests?|Spec|IT)\.(java|kt|scala|cs|swift|groovy)$|\.snap$)')


def is_test_path(p):
    return bool(TEST_DIR.search(p) or TEST_FILE.search(p))


MORE_RE = re.compile(r'^(.*?) \(\+(\d+) more in this file\)$')


def transform_grep(text, flood=50, collapse=True, guard=True):
    """B7: (a) hits in test/spec/fixture files collapse to ONE line per file (first hit kept, `(+N more test hits)`
    appended); (b) when the output prints >= `flood` hit lines, every file is shown as one `path: N hits` count line.
    The existing `(+N more in this file)` truncation note of a file's last hit is added to that file's count."""
    lines = text.split('\n')
    matches = [(i, P.GREP_MATCH.match(l)) for i, l in enumerate(lines)]
    matches = [(i, m) for i, m in matches if m]
    if not matches:
        return text
    byfile = {}
    for i, m in matches:
        byfile.setdefault(m.group(1), []).append((i, m))

    def extra_of(hits):
        e = 0
        for i, m in hits:
            mm = MORE_RE.match(m.group(3))
            if mm:
                e += int(mm.group(2))
        return e

    drop, repl = set(), {}
    if guard and len(matches) >= flood:
        for f, hits in byfile.items():
            n = len(hits) + extra_of(hits)
            repl[hits[0][0]] = f'{f}: {n} hit{"s" if n > 1 else ""}'
            drop.update(i for i, _ in hits[1:])
    elif collapse:
        for f, hits in byfile.items():
            if len(hits) > 1 and is_test_path(f):
                i0, m0 = hits[0]
                repl[i0] = f'{lines[i0]}  (+{len(hits) - 1 + extra_of(hits)} more test hits)'
                drop.update(i for i, _ in hits[1:])
    out = []
    for i, l in enumerate(lines):
        if i in drop:
            continue
        out.append(repl.get(i, l))
    return '\n'.join(out)


# =====================================================================================================
# 5. replay driver
# =====================================================================================================
VARIANTS = ['A1', 'A2', 'A2span', 'A3', 'A4', 'A4lite', 'B1_3', 'B1_5', 'B7', 'A', 'A+B5', 'A+B3']
APPLIES = {   # variant -> tools it changes
    'A1': ('ss-search', 'ss-find'), 'A2': ('ss-search', 'ss-find'), 'A2span': ('ss-search', 'ss-find'), 'A3': ('ss-search', 'ss-find'),
    'A4': ('ss-trace',), 'A4lite': ('ss-trace',),
    'B1_3': ('ss-search', 'ss-find'), 'B1_5': ('ss-search', 'ss-find'), 'B7': ('ss-grep',),
    'A': ('ss-search', 'ss-find', 'ss-trace'),
    'A+B5': ('ss-search', 'ss-find', 'ss-trace', 'ss-grep'),
    'A+B3': ('ss-search', 'ss-find', 'ss-trace', 'ss-grep'),
}
LABEL = {
    'A1': 'A1 drop metadata', 'A2': 'A2 one-line summaries + dedupe', 'A2span': 'A2-span-only (dedupe without the same-symbol rule)', 'A3': 'A3 omit already-shown code',
    'A4': 'A4 ss-trace section + rows', 'A4lite': 'A4-lite (section + cues/meta only)',
    'B1_3': 'B1 summary cap 3', 'B1_5': 'B1 summary cap 5', 'B7': 'B7 ss-grep test collapse + flood guard',
    'A': 'Bundle A (A1+A2+A3+A4)', 'A+B5': 'A + B (B1 cap 5, B7)', 'A+B3': 'A + B (B1 cap 3, B7)',
}


def variant_outputs(tool, text, args, ledger):
    """-> {variant: after_text} for the variants that apply to this tool."""
    out = {}
    if tool in ('ss-search', 'ss-find'):
        out['A1'] = transform_search(text, a1=True)
        out['A2'] = transform_search(text, a2=True)
        out['A2span'] = transform_search(text, a2=True, a2_symbol=False)
        out['A3'] = transform_search(text, ledger=ledger, a3=True)
        out['B1_3'] = transform_search(text, b1=3)
        out['B1_5'] = transform_search(text, b1=5)
        out['A'] = transform_search(text, ledger=ledger, a1=True, a2=True, a3=True)
        out['A+B5'] = transform_search(text, ledger=ledger, a1=True, a2=True, a3=True, b1=5)
        out['A+B3'] = transform_search(text, ledger=ledger, a1=True, a2=True, a3=True, b1=3)
    elif tool == 'ss-trace':
        out['A4'] = transform_trace(text, args)
        out['A4lite'] = transform_trace(text, args, lite=True)
        out['A'] = out['A+B5'] = out['A+B3'] = out['A4']
    elif tool == 'ss-grep':
        out['B7'] = transform_grep(text)
        out['A+B5'] = out['A+B3'] = out['B7']
    return out


def load():
    D = []
    with open(os.path.join(DATA, 'dossiers.jsonl')) as fh:
        for ln in fh:
            r = json.loads(ln)
            r['hk'] = hk_of(r)
            D.append(r)
    U = []
    with open(os.path.join(DATA, 'units.jsonl')) as fh:
        for ln in fh:
            u = json.loads(ln)
            u['hk'] = hk_of(u)
            U.append(u)
    T = []
    with open(os.path.join(DATA, 'trajectories.jsonl')) as fh:
        for ln in fh:
            t = json.loads(ln)
            t['hk'] = hk_of(t)
            T.append(t)
    return D, U, T


def run_replay(D, keep_samples=None):
    """Replay every thread in call order. -> list of per-call records."""
    threads = defaultdict(list)
    for d in D:
        threads[(d['id'].rsplit('#', 1)[0], d['thread'])].append(d)
    recs = []
    for key, calls in threads.items():
        calls.sort(key=lambda d: d['callIndex'])
        ledger = {}
        for d in calls:
            if d['class'] != 'ss' or not d.get('outputKnown'):
                continue
            tool, text = d['tool'], d['output']
            rec = {'hk': d['hk'], 'tool': tool, 'rid': d['id'].rsplit('#', 1)[0], 'amp': d['amplification'], 'before': len(text),
                   'args': d['args'], 'after': {}}
            if tool in ('ss-search', 'ss-find', 'ss-grep', 'ss-trace'):
                outs = variant_outputs(tool, text, d['args'], ledger)
                for v, t in outs.items():
                    rec['after'][v] = len(t)
                if keep_samples is not None:
                    keep_samples.append((d, outs))
            recs.append(rec)
            if tool in ('ss-search', 'ss-find', 'ss-read', 'ss-semantic'):
                ledger_add(ledger, tool, text)
    return recs


# ---- aggregation -------------------------------------------------------------------------------------
def tok_ceil(c):
    return int(math.ceil(c / 4)) if c else 0


def aggregate(D, U, T, recs):
    n_roll = Counter(t['hk'] for t in T)
    cost = defaultdict(float)
    cost_n = Counter()
    for t in T:
        if t.get('cost') is not None:
            cost[t['hk']] += t['cost']
            cost_n[t['hk']] += 1
    costed = {t['id'] for t in T if t.get('cost') is not None}
    all_chars, all_amp, all_usd = Counter(), Counter(), defaultdict(float)
    all_usd_costed = defaultdict(float)
    for u in U:
        c = u.get('unitOutputChars')
        if c is None:
            continue
        rem = max(u['turnsTotal'] - u.get('deliveredTurn', u['turnIndex']), 0)
        hk = u['hk']
        all_chars[hk] += c
        all_amp[hk] += tok_ceil(c) * (1 + rem)
        pr = price_of(hk)
        usd = (c / 4) * (pr['write'] + rem * pr['read']) / 1e6
        all_usd[hk] += usd
        if f"{u['run']}/{u['task']}/r{u['rep']}" in costed:
            all_usd_costed[hk] += usd
    # ss totals per hk x tool
    tool_chars, tool_amp, tool_n, tool_usd = Counter(), Counter(), Counter(), defaultdict(float)
    ss_amp, ss_usd, ss_usd_costed = Counter(), defaultdict(float), defaultdict(float)
    for r in recs:
        tool_chars[(r['hk'], r['tool'])] += r['before']
        a = tok_ceil(r['before']) * (1 + r['amp'])
        tool_amp[(r['hk'], r['tool'])] += a
        tool_n[(r['hk'], r['tool'])] += 1
        pr = price_of(r['hk'])
        u = (r['before'] / 4) * (pr['write'] + r['amp'] * pr['read']) / 1e6
        tool_usd[(r['hk'], r['tool'])] += u
        ss_amp[r['hk']] += a
        ss_usd[r['hk']] += u
        if r['rid'] in costed:
            ss_usd_costed[r['hk']] += u
    # per (harness, task) sums for the task-cluster bootstrap
    by_task = defaultdict(lambda: defaultdict(float))
    for u in U:
        c = u.get('unitOutputChars')
        if c is None:
            continue
        rem = max(u['turnsTotal'] - u.get('deliveredTurn', u['turnIndex']), 0)
        by_task[(u['hk'], u['task'])]['all_amp'] += tok_ceil(c) * (1 + rem)
    for r in recs:
        task = r['rid'].split('/')[1]
        for v, after in r['after'].items():
            by_task[(r['hk'], task)][v] += ((r['before'] - after) / 4) * (1 + r['amp'])
    # savings
    S = {}  # (hk, variant, tool) -> dict(chars, amp_tok, usd, calls, touched)
    for r in recs:
        pr = price_of(r['hk'])
        for v, after in r['after'].items():
            if r['tool'] not in APPLIES[v]:
                continue
            saved = r['before'] - after
            k = (r['hk'], v, r['tool'])
            s = S.setdefault(k, {'chars': 0, 'amp_tok': 0.0, 'usd': 0.0, 'calls': 0, 'touched': 0})
            s['chars'] += saved
            s['amp_tok'] += (saved / 4) * (1 + r['amp'])
            s['usd'] += (saved / 4) * (pr['write'] + r['amp'] * pr['read']) / 1e6
            s['calls'] += 1
            if saved > 0:
                s['touched'] += 1
    return dict(n_roll=n_roll, cost=cost, cost_n=cost_n, all_chars=all_chars, all_amp=all_amp, by_task=by_task, all_usd=all_usd, all_usd_costed=all_usd_costed, ss_usd_costed=ss_usd_costed,
                tool_chars=tool_chars, tool_amp=tool_amp, tool_n=tool_n, tool_usd=tool_usd, ss_amp=ss_amp, ss_usd=ss_usd, S=S)


def boot_ci(A, hk, v, reps=2000, seed=42):
    """95% interval of (amplified tokens saved by v) / (all amplified tool-output tokens), resampling TASKS with replacement."""
    tasks = [t for (h, t) in A['by_task'] if h == hk]
    rnd = random.Random(seed)
    num = [A['by_task'][(hk, t)].get(v, 0.0) for t in tasks]
    den = [A['by_task'][(hk, t)].get('all_amp', 0.0) for t in tasks]
    vals = []
    for _ in range(reps):
        idx = [rnd.randrange(len(tasks)) for _ in tasks]
        d = sum(den[i] for i in idx)
        if d:
            vals.append(sum(num[i] for i in idx) / d)
    vals.sort()
    return vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]


def fmt_pct(x, d=1):
    return f'{100 * x:.{d}f}%'


def md_table(headers, rows):
    out = ['| ' + ' | '.join(headers) + ' |', '|' + '|'.join(['---'] * len(headers)) + '|']
    for r in rows:
        out.append('| ' + ' | '.join(str(x) for x in r) + ' |')
    return '\n'.join(out)


def variant_row(A, hk, v, tools=None):
    """Totals of variant v for harness hk over `tools` (default: all tools the variant applies to)."""
    tools = tools or APPLIES[v]
    ch = sum(A['S'].get((hk, v, t), {}).get('chars', 0) for t in tools)
    amp = sum(A['S'].get((hk, v, t), {}).get('amp_tok', 0) for t in tools)
    usd = sum(A['S'].get((hk, v, t), {}).get('usd', 0) for t in tools)
    touched = sum(A['S'].get((hk, v, t), {}).get('touched', 0) for t in tools)
    calls = sum(A['S'].get((hk, v, t), {}).get('calls', 0) for t in tools)
    tchars = sum(A['tool_chars'].get((hk, t), 0) for t in tools)
    return dict(chars=ch, tok=ch / 4, amp=amp, usd=usd, touched=touched, calls=calls, tool_chars=tchars)


def main_table(A, hk):
    rows = []
    nr = A['n_roll'][hk]
    for v in VARIANTS:
        if v in ('A4lite', 'A2span'):
            continue
        tools = APPLIES[v]
        singles = [(v, t) for t in tools] if len(tools) > 1 else []
        tot = variant_row(A, hk, v)
        if tot['calls'] == 0:
            continue
        rows.append(row_of(A, hk, v, tot, LABEL[v], nr))
        if v in ('A1', 'A2', 'A3', 'B1_3', 'B1_5'):
            for t in tools:
                sub = variant_row(A, hk, v, (t,))
                if sub['calls']:
                    rows.append(row_of(A, hk, v, sub, f'&nbsp;&nbsp;{t}', nr, sub_tool=t))
        if v in ('A', 'A+B5', 'A+B3'):
            for t in tools:
                sub = variant_row(A, hk, v, (t,))
                if sub['calls'] and sub['chars']:
                    rows.append(row_of(A, hk, v, sub, f'&nbsp;&nbsp;{t}', nr, sub_tool=t))
        if v == 'A2':
            sp_ = variant_row(A, hk, 'A2span')
            if sp_['calls']:
                rows.append(row_of(A, hk, 'A2span', sp_, LABEL['A2span'], nr))
        if v == 'A4':
            lt = variant_row(A, hk, 'A4lite')
            if lt['calls']:
                rows.insert(len(rows), row_of(A, hk, 'A4lite', lt, LABEL['A4lite'], nr))
    return rows


def row_of(A, hk, v, t, label, nr, sub_tool=None):
    tool_pct = t['chars'] / t['tool_chars'] if t['tool_chars'] else 0
    allpct = t['chars'] / A['all_chars'][hk] if A['all_chars'][hk] else 0
    amp_pct = t['amp'] / A['all_amp'][hk] if A['all_amp'][hk] else 0
    usd_roll = t['usd'] / nr if nr else 0
    cost_n = A['cost_n'][hk]
    mean_cost = A['cost'][hk] / cost_n if cost_n else 0
    pct_cost = usd_roll / mean_cost if mean_cost else 0
    return [label, f"{t['chars']:,}", f"{t['tok']:,.0f}", fmt_pct(tool_pct), fmt_pct(allpct, 2), f"{t['amp']:,.0f}",
            fmt_pct(amp_pct, 2), f"${usd_roll:.5f}", fmt_pct(pct_cost, 2), f"{t['touched']}/{t['calls']}"]


MAIN_HEAD = ['fix (applies to)', 'chars saved', 'tokens saved', '% of those tools\' output', '% of ALL tool output',
             'amplified tokens saved', '% of all amplified', '$ saved / rollout', '% of mean rollout cost', 'calls changed']


def context_table(A, hks):
    rows = []
    for hk in hks:
        nr = A['n_roll'][hk]
        cn = A['cost_n'][hk]
        mean_cost = A['cost'][hk] / cn if cn else 0
        tool_share = {t: A['tool_amp'].get((hk, t), 0) / A['all_amp'][hk] for t in
                      ('ss-read', 'ss-grep', 'ss-search', 'ss-find', 'ss-trace', 'ss-semantic')}
        ss_all_share = A['ss_amp'][hk] / A['all_amp'][hk]
        usd_all_roll = A['all_usd_costed'][hk] / cn if cn else 0
        usd_ss_roll = A['ss_usd_costed'][hk] / cn if cn else 0
        rows.append([hk, nr, f'${mean_cost:.4f}', f'{A["all_chars"][hk] / nr:,.0f}', f'${usd_all_roll:.4f}',
                     fmt_pct(usd_all_roll / mean_cost, 1) if mean_cost else '-',
                     f'${usd_ss_roll:.4f}', fmt_pct(usd_ss_roll / mean_cost, 1) if mean_cost else '-',
                     fmt_pct(ss_all_share, 1), fmt_pct(tool_share['ss-read'], 1), fmt_pct(tool_share['ss-grep'], 1),
                     fmt_pct(tool_share['ss-search'], 1), fmt_pct(tool_share['ss-find'], 1)])
    return md_table(['harness-model', 'rollouts', 'mean cost (rows.json)', 'tool-output chars / rollout (all tools)',
                     'modelled $ of ALL tool output / rollout', 'share of rollout cost', 'modelled $ of ss-* output / rollout',
                     'share of rollout cost', 'ss-* share of all amplified tokens', 'ss-read (context only)', 'ss-grep',
                     'ss-search', 'ss-find'], rows)


def pertool_table(A, hks):
    """% of each tool's own output chars removed, per fix, per harness (compact view)."""
    heads = ['harness-model', 'tool', 'calls', 'tool chars']
    cols = ['A1', 'A2', 'A3', 'A', 'B1_3', 'B1_5', 'A+B5', 'A+B3', 'A4', 'A4lite', 'B7']
    heads += cols
    rows = []
    for hk in hks:
        for tool in ('ss-search', 'ss-find', 'ss-trace', 'ss-grep'):
            tc = A['tool_chars'].get((hk, tool), 0)
            if not tc:
                continue
            row = [hk, tool, A['tool_n'][(hk, tool)], f'{tc:,}']
            for v in cols:
                s = A['S'].get((hk, v, tool))
                row.append(fmt_pct(s['chars'] / tc) if s and tool in APPLIES[v] else '-')
            rows.append(row)
    return md_table(heads, rows)


# =====================================================================================================
# 6. validation: self checks and before/after samples
# =====================================================================================================
def self_checks(D):
    """Machine checks that the transforms behave. Returns a list of (name, ok, detail)."""
    res = []
    ss = [d for d in D if d['class'] == 'ss' and d.get('outputKnown')]
    # 1 round trip of the splitter
    bad = 0
    n = 0
    for d in ss:
        if d['tool'] in ('ss-search', 'ss-find'):
            n += 1
            if split_search(d['output']).render() != d['output']:
                bad += 1
    res.append(('split/render round trip on ss-search + ss-find', bad == 0, f'{bad} of {n} outputs differ'))
    # 2 A1 equals the ss_parse bucket sum (header, confidence, tag, score, trailers, blank before trailer, leading blank)
    diff_tot, exp_tot, worst = 0, 0, 0
    nn = 0
    for d in ss:
        if d['tool'] in ('ss-search', 'ss-find'):
            p = P.parse_search_like(d['output'])
            b = p['buckets']
            exp = (b.get('header_meta', 0) + b.get('header_confidence', 0) + b.get('header_other', 0) + b.get('rank_presentation', 0)
                   + b.get('rank_score', 0) + b.get('shown_full', 0) + b.get('route_trailer', 0))
            got = len(d['output']) - len(transform_search(d['output'], a1=True))
            exp_tot += exp
            diff_tot += got - exp
            worst = max(worst, abs(got - exp - 0))
            nn += 1
    res.append(('A1 saved chars vs ss_parse bucket sum', abs(diff_tot) / max(exp_tot, 1) < 0.02,
                f'bucket sum {exp_tot:,}, transform {exp_tot + diff_tot:,}, diff {diff_tot:+,} ({100 * diff_tot / max(exp_tot, 1):+.2f}%; the transform also drops blank lines around the removed lines)'))
    # 3 no transform grows an output
    grow = 0
    tot = 0
    for d in ss:
        if d['tool'] in ('ss-search', 'ss-find', 'ss-grep', 'ss-trace'):
            outs = variant_outputs(d['tool'], d['output'], d['args'], {})
            for v, t in outs.items():
                tot += 1
                if len(t) > len(d['output']):
                    grow += 1
    res.append(('no transform makes an output longer', grow == 0, f'{grow} of {tot} (call, variant) pairs grew'))
    # 4 A1+A2 keep file:line of every surviving entry
    lost, chk = 0, 0
    for d in ss:
        if d['tool'] in ('ss-search', 'ss-find'):
            after = transform_search(d['output'], a1=True, a2=True)
            sp = split_search(d['output'])
            fx_a2(sp)
            chk += 1
            for e in sp.entries:
                if not e.dropped and f'{e.file}:{e.start}' not in after:
                    lost += 1
    res.append(('A1+A2 keep file:line of every surviving entry', lost == 0, f'{lost} entries lost their location in {chk} outputs'))
    # 4b A4: every caller/callee row key of the original is still named; rows <= items
    lost, items_n, rows_n, nchk = 0, 0, 0, 0
    for d in ss:
        if d['tool'] == 'ss-trace' and trace_mode(d['args']) in ('callers', 'callees'):
            after = transform_trace(d['output'], d['args'])
            keys = []
            for k, l in enumerate(d['output'].split('\n')):
                if l.startswith('### '):
                    nxt = d['output'].split('\n')[k + 1]
                    mm = CALL_RE.match(nxt)
                    keys.append(mm.group(1) if mm else nxt)
            nchk += 1
            items_n += len(keys)
            rows_n += sum(1 for l in after.split('\n') if CALL_RE.match(l) or (l and not l.startswith(('#', 'fan-', 'note', 'no stored', 'ambig', '(none)'))))
            lost += sum(1 for kx in set(keys) if kx not in after)
    res.append(('A4 keeps every caller/callee name and location', lost == 0, f'{lost} rows lost in {nchk} moded trace outputs ({items_n} items -> about {rows_n} rows)'))
    # 4c B7: file set and hit total preserved
    bad_files, bad_count, nchk, flood_n = 0, 0, 0, 0
    for d in ss:
        if d['tool'] == 'ss-grep':
            lines = d['output'].split('\n')
            hits = [P.GREP_MATCH.match(l) for l in lines]
            hits = [m for m in hits if m]
            if not hits:
                continue
            nchk += 1
            after = transform_grep(d['output'])
            files0 = {m.group(1) for m in hits}
            files1 = {m.group(1) for m in (P.GREP_MATCH.match(l) for l in after.split('\n')) if m}
            flood = len(hits) >= 50
            if flood:
                flood_n += 1
                files1 = {l.rsplit(': ', 1)[0] for l in after.split('\n') if re.search(r': \d+ hits?$', l)}
                tot0 = len(hits) + sum(int(MORE_RE.match(m.group(3)).group(2)) for m in hits if MORE_RE.match(m.group(3)))
                tot1 = sum(int(re.search(r': (\d+) hits?$', l).group(1)) for l in after.split('\n') if re.search(r': \d+ hits?$', l))
                if tot0 != tot1:
                    bad_count += 1
            if files0 != files1:
                bad_files += 1
    res.append(('B7 keeps every file and (flood mode) the exact hit total', bad_files == 0 and bad_count == 0,
                f'{bad_files} outputs lost a file, {bad_count} flood outputs have a wrong total, of {nchk} outputs ({flood_n} in flood mode)'))
    # 4d B1: only summary entries are dropped
    bad, nchk = 0, 0
    for d in ss:
        if d['tool'] in ('ss-search', 'ss-find'):
            sp0 = split_search(d['output'])
            n_full0 = sum(1 for e in sp0.entries if e.pres != 'summary')
            sp1 = split_search(transform_search(d['output'], b1=3))
            n_full1 = sum(1 for e in sp1.entries if e.pres != 'summary')
            n_sum1 = sum(1 for e in sp1.entries if e.pres == 'summary')
            nchk += 1
            if n_full0 != n_full1 or n_sum1 > 3:
                bad += 1
    res.append(('B1 drops only summary entries and keeps at most N', bad == 0, f'{bad} violations in {nchk} outputs'))
    # 5 A3 against the independent STATS section C2 (same scope: main thread, output ok, not piped)
    ref = {('claudecode-luna', 'ss-search'): 162324, ('claudecode-luna', 'ss-find'): 105482,
           ('codex-luna', 'ss-search'): 106686, ('codex-luna', 'ss-find'): 55853,
           ('opencode-luna', 'ss-search'): 164114, ('opencode-luna', 'ss-find'): 135046}
    th = defaultdict(list)
    for d in D:
        if d['thread'] == 'main':
            th[d['id'].rsplit('#', 1)[0]].append(d)
    got = Counter()
    for k, calls in th.items():
        calls.sort(key=lambda d: d['callIndex'])
        led = {}
        for d in calls:
            if d['class'] != 'ss' or not d.get('outputKnown') or d['outputKind'] != 'ok' or d['piped']:
                continue
            if d['tool'] in ('ss-search', 'ss-find'):
                sp = split_search(d['output'])
                for e in sp.entries:
                    l = led.get(norm_path(e.file), {})
                    for kind, v in e.body:
                        if kind == 'fence' and v['role'] == 'code':
                            st, gl, nums = P.detect_gutter(v['content'], e.start)
                            full = P._fill_numbers(nums, e.start)
                            for x, g, n_ in zip(v['content'], gl, full):
                                if l.get(n_) == x[g:]:
                                    got[(R_hk(d), d['tool'])] += len(x) - g + 1
            ledger_add(led, d['tool'], d['output'])
    parts, ok = [], True
    for key, r in sorted(ref.items()):
        ratio = got[key] / r
        parts.append(f'{key[0]} {key[1]} {ratio:.2f}')
        ok = ok and 0.85 <= ratio <= 1.03
    res.append(('A3 re-shown code chars vs STATS C2 (ratio replay / STATS; replay needs equal TEXT, STATS only equal line number)', ok, '; '.join(parts)))
    return res


def R_hk(d):
    return d['hk'] if 'hk' in d else hk_of(d)


def pick_samples(samples, tool, k, seed=11, want=None):
    c = [(d, o) for d, o in samples if d['tool'] == tool and 300 < d['outputChars'] < 3200]
    if want:
        c2 = [(d, o) for d, o in c if want(d, o)]
        rnd = random.Random(seed)
        rnd.shuffle(c2)
        pick = c2[:k]
        if len(pick) < k:
            rest = [x for x in c if x not in pick]
            rnd.shuffle(rest)
            pick += rest[:k - len(pick)]
        return pick
    rnd = random.Random(seed)
    rnd.shuffle(c)
    return c[:k]


def print_validation(samples, k, fh):
    def w(s=''):
        fh.write(s + '\n')
    plan = [
        ('ss-search', ['A+B5', 'A1', 'A2', 'A3', 'B1_3'], lambda d, o: 'A3' in o and len(o['A3']) < d['outputChars'] - 40),
        ('ss-find', ['A+B5', 'A3'], lambda d, o: 'A3' in o and len(o['A3']) < d['outputChars'] - 40),
        ('ss-trace', ['A4', 'A4lite'], None),
        ('ss-grep', ['B7'], lambda d, o: 'B7' in o and len(o['B7']) < d['outputChars']),
    ]
    for tool, variants, want in plan:
        for n, (d, o) in enumerate(pick_samples(samples, tool, k, want=want), 1):
            w('=' * 100)
            w(f'[{tool} sample {n}/{k}] {d["hk"]}  {d["id"]}  callIndex={d["callIndex"]}  amp={d["amplification"]}')
            w(f'args: {d["args"]}')
            w(f'--- BEFORE ({len(d["output"])} chars) ---')
            w(d['output'])
            for v in variants:
                if v in o:
                    w(f'--- AFTER {v} ({len(o[v])} chars, saved {len(d["output"]) - len(o[v])}) ---')
                    w(o[v])


# =====================================================================================================
# 7. REPLAY.md writer
# =====================================================================================================
def build_report(A, D, checks, extra):
    L = []
    w = L.append
    hks = [h for h in HKS if A['n_roll'][h]]
    S = A['S']

    def tot(hk, v):
        return variant_row(A, hk, v)

    def amp_pct(hk, v):
        t = tot(hk, v)
        return t['amp'] / A['all_amp'][hk]

    def chars_pct_all(hk, v):
        return tot(hk, v)['chars'] / A['all_chars'][hk]

    w('# Replay estimate: what the proposed ss-* output fixes would have saved on recorded trajectories')
    w('')
    w('Generated by `replay.py` (this folder). No model call, no network, no benchmark run. Date: 2026-10-01.')
    w('')
    w('## Conclusion')
    w('')
    amp = lambda h, v: amp_pct(h, v)
    ci = lambda h, v: boot_ci(A, h, v)
    w('Bundle A would have saved between {} and {} of all amplified tool-output tokens, depending on the harness. '
      'Adding B1 (cap 5) and B7 raises this to between {} and {}.'.format(
          fmt_pct(min(amp(h, 'A') for h in hks)), fmt_pct(max(amp(h, 'A') for h in hks)),
          fmt_pct(min(amp(h, 'A+B5') for h in hks)), fmt_pct(max(amp(h, 'A+B5') for h in hks))))
    w('')
    for h in hks:
        lo, hi = ci(h, 'A+B5')
        la, ha = ci(h, 'A')
        usd_a = tot(h, 'A')['usd'] / A['n_roll'][h]
        usd_ab = tot(h, 'A+B5')['usd'] / A['n_roll'][h]
        mc = A['cost'][h] / A['cost_n'][h]
        ranked = sorted(('A1', 'A2', 'A3', 'A4', 'B1_5', 'B7'), key=lambda v: -tot(h, v)['amp'])
        w(f'- **{h}.** Bundle A saves {fmt_pct(amp(h, "A"), 2)} of amplified tokens (95% interval {fmt_pct(la, 2)} to {fmt_pct(ha, 2)}). '
          f'A + B cap 5 saves {fmt_pct(amp(h, "A+B5"), 2)} ({fmt_pct(lo, 2)} to {fmt_pct(hi, 2)}). '
          f'The value is ${usd_a:.5f} (A) and ${usd_ab:.5f} (A + B) per rollout. '
          f'This is {fmt_pct(usd_a / mc, 2)} and {fmt_pct(usd_ab / mc, 2)} of the mean rollout cost, ${mc:.4f}. '
          f'The largest single fixes are {", ".join(LABEL[v].split(" ")[0] for v in ranked[:3])}.')
    w('')
    w('The Opus saving is small because Opus calls ss-grep and ss-read, and almost never ss-search, ss-find or ss-trace. '
      'The Luna harnesses call ss-search and ss-find often, so Bundle A matters there. '
      'The intervals come from resampling the 13 tasks. They are wide, because all rollouts of one task count as one unit. '
      'Single fixes overlap, so do not add them.')
    w('')
    w('ss-read is unchanged by owner decision. It stays the largest source of amplified tokens: '
      + ', '.join(f'{h} {fmt_pct(A["tool_amp"].get((h, "ss-read"), 0) / A["all_amp"][h])}' for h in hks) + '. This number is context only.')
    w('')
    w('Tool output is a large part of rollout cost. The modelled cost of all tool output is '
      + ', '.join(f'{h} {fmt_pct(A["all_usd_costed"][h] / A["cost_n"][h] / (A["cost"][h] / A["cost_n"][h]))}' for h in hks)
      + ' of the mean rollout cost (section 3). The ss-* tools alone are '
      + ', '.join(f'{h} {fmt_pct(A["ss_usd_costed"][h] / A["cost_n"][h] / (A["cost"][h] / A["cost_n"][h]))}' for h in hks)
      + '. This is a lower bound, because the cost model counts only the tool-output tokens.')
    w('')
    w('## 1. Headline table: share saved, per harness and model')
    w('')
    w('Each cell is a sum over all recorded ss-* calls of that harness and model. "Amplified" = saved tokens x (1 + later requests that re-read the output), '
      'as a share of ALL amplified tool-output tokens of the harness (every tool, not only ss-*).')
    w('')
    hrows = []
    for hk in hks:
        r = []
        for v in ('A1', 'A2', 'A3', 'A4', 'B1_3', 'B1_5', 'B7', 'A', 'A+B5', 'A+B3'):
            t = tot(hk, v)
            r.append(f'{fmt_pct(amp_pct(hk, v), 2)}' if t['calls'] else '-')
        hrows.append([hk] + r)
    w('**Amplified tokens saved, as % of all amplified tool-output tokens**')
    w('')
    w(md_table(['harness-model', 'A1', 'A2', 'A3', 'A4', 'B1 cap 3', 'B1 cap 5', 'B7', 'Bundle A', 'A + B (cap 5)', 'A + B (cap 3)'], hrows))
    w('')
    hrows = []
    for hk in hks:
        r = []
        for v in ('A', 'A+B5', 'A+B3'):
            lo, hi = ci(hk, v)
            r.append(f'{fmt_pct(amp_pct(hk, v), 2)} ({fmt_pct(lo, 2)} to {fmt_pct(hi, 2)})')
        hrows.append([hk] + r)
    w('**Bundles with a 95% interval** (bootstrap over the 13 tasks, 2,000 resamples, seed 42)')
    w('')
    w(md_table(['harness-model', 'Bundle A', 'A + B (cap 5)', 'A + B (cap 3)'], hrows))
    w('')
    hrows = []
    for hk in hks:
        r = []
        for v in ('A1', 'A2', 'A3', 'A4', 'B1_3', 'B1_5', 'B7', 'A', 'A+B5', 'A+B3'):
            t = tot(hk, v)
            r.append(f'{fmt_pct(chars_pct_all(hk, v), 2)}' if t['calls'] else '-')
        hrows.append([hk] + r)
    w('**Plain characters saved, as % of ALL tool-output characters (no amplification)**')
    w('')
    w(md_table(['harness-model', 'A1', 'A2', 'A3', 'A4', 'B1 cap 3', 'B1 cap 5', 'B7', 'Bundle A', 'A + B (cap 5)', 'A + B (cap 3)'], hrows))
    w('')
    hrows = []
    for hk in hks:
        nr = A['n_roll'][hk]
        r = []
        for v in ('A1', 'A2', 'A3', 'A4', 'B1_3', 'B1_5', 'B7', 'A', 'A+B5', 'A+B3'):
            t = tot(hk, v)
            r.append(f'${t["usd"] / nr:.5f}' if t['calls'] else '-')
        hrows.append([hk] + r)
    w('**Dollars saved per rollout** (list prices, formula in section 2; mean over all rollouts of the harness, including rollouts that never call the tool)')
    w('')
    w(md_table(['harness-model', 'A1', 'A2', 'A3', 'A4', 'B1 cap 3', 'B1 cap 5', 'B7', 'Bundle A', 'A + B (cap 5)', 'A + B (cap 3)'], hrows))
    w('')
    w('Fixes overlap (A1 and A2 both touch rank lines; A3 and A2 both remove code). Bundle rows are computed by applying the transforms in sequence on the same output, so they are smaller than the sum of the single rows.')
    w('')
    w('## 2. Method, formulas and how each transform is approximated')
    w('')
    w('**Data.** `dossiers.jsonl` holds one record per tool call with the FULL output text. The replay uses the 10,353 ss-* calls whose output boundary is known (`outputKnown`). '
      'Calls are ordered by `callIndex` inside one `(rollout, thread)`. The 13 tasks are all development tasks. No HO2 data is read.')
    w('')
    w('**Tokens.** tokens = chars / 4 (a call saves `before - after` chars). The "% of ALL tool output" denominator is the sum of `unitOutputChars` of units.jsonl '
      '(every tool result the model saw: ss-*, native read and search, edit, test, other). "% of that tool\'s output" uses the summed characters of the tools the fix touches.')
    w('')
    w('**Amplification.** `amplification` (= `turnsRemaining`) = later model requests in the same thread. Amplified tokens saved = saved tokens x (1 + amplification). '
      'The denominator is the STATS definition: ceil(chars / 4) x (1 + turnsTotal - deliveredTurn), summed over all units of the harness. '
      'The "1 +" counts the first read; the true number of cache re-reads is `amplification`, so the amplified figure over-counts the first read slightly.')
    w('')
    w('**Dollars.** For one saved token of a call with `amp` later requests:')
    w('')
    w('    usd = saved_tokens x ( P_write + amp x P_read ) / 1,000,000')
    w('')
    w('The token is written once to the cache at the write price, then read `amp` times at the cache-read price. '
      'Opus (Claude Code): P_write = $5, P_read = $0.20 per million. '
      'Luna (all three harnesses): P_write = $0.25 (fresh input, no write surcharge), P_read = $0.02 per million. The Luna prices come from the price model in the project memory '
      '(it reproduced OpenRouter billing to 0.2 to 3.5%). The owner gave only the Opus prices. '
      '"$ saved / rollout" = total over all calls of the harness / number of rollouts of the harness. '
      'It ignores output-token and reasoning savings, and it ignores that a smaller context may change the number of turns.')
    w('')
    w('**Share of rollout cost.** The same formula applied to every tool result (all units) gives the modelled cost of tool output. It is compared with the mean `cost` of rows.json '
      '(trajectories.jsonl field `cost`; 491 of 492 Opus, 71 of 78 Claude Code Luna, 210 of 210 Codex, 361 of 361 opencode rollouts have it). '
      'Only rollouts that have a cost enter the modelled sum and the mean, so numerator and denominator cover the same rollouts. '
      '"$ saved / rollout" in sections 1 and 4 divides by ALL rollouts of the harness.')
    w('')
    w('### Transform definitions (text rewrites of the recorded output)')
    w('')
    w(TRANSFORM_DOC)
    w('')
    w('## 3. Context: where tool output sits in the rollout cost')
    w('')
    w(context_table(A, hks))
    w('')
    w('Reading the table. The modelled cost counts only tool-result tokens (written once, re-read per later request). '
      'The rows.json cost also holds system prompt and tool-definition tokens, user prompt, model output, reasoning, and sub-agent work. The modelled tool-output cost is therefore only a part of the rollout cost, and no fix can save more than that part. '
      'Claude Code Luna rows.json cost is the OpenRouter bill. The Opus cost has no re-pricing here.')
    w('')
    w('## 4. Per harness: every fix, every tool')
    w('')
    w('Columns: chars and tokens saved; % of the output of the tools the row covers; % of ALL tool output chars; amplified tokens saved; % of all amplified tokens; $ per rollout; '
      '% of the mean rollout cost; calls changed / calls of that tool that the fix applies to.')
    w('')
    for hk in hks:
        w(f'### {hk}')
        w('')
        w(md_table(MAIN_HEAD, main_table(A, hk)))
        w('')
    w('## 5. Compact view: % of each tool\'s own output removed')
    w('')
    w(pertool_table(A, hks))
    w('')
    w('## 6. Validation')
    w('')
    w('Self checks (run by `python3 replay.py --validate 5`):')
    w('')
    for name, ok, detail in checks:
        w(f'- {"PASS" if ok else "FAIL"}: {name} - {detail}')
    w('')
    w(f'Before/after print-outs: 5 samples per tool (ss-search, ss-find, ss-trace, ss-grep) are written to `{extra["val_path"]}` by `--validate 5 --out`. Two short samples follow.')
    w('')
    w(extra['val_md'])
    w('')
    w('## 7. Caveats')
    w('')
    w(CAVEATS)
    return '\n'.join(L) + '\n'


TRANSFORM_DOC = """\
| fix | tools | exact approximation |
|---|---|---|
| A1 drop metadata | ss-search, ss-find | Remove the lines `# ss-search: ...` / `# ss-find: ...`, `# confidence=...`, `# variant-sentinel`, and the blank line after them. In every rank line remove the `(presentation kind=...)` tag and ` score=...` (a `STALE` flag is kept). Remove the whole trailer: `shown-full:` line, `route=...` / `<<SS_ROUTE_META>>` line, and the blanks before them. Cross-checked against the `ss_parse` bucket sums. |
| A2 one-line summaries + dedupe | ss-search, ss-find | A summary entry (presentation `summary`, one body line `path:line - symbol (kind)`) becomes that single line: its rank line and its blank separator go. Then drop an entry when its span lies inside an earlier span of the same file, or when it repeats an earlier file+symbol. For summary entries any earlier entry counts. For entries that show code only an earlier entry that shows code and contains the span counts. This is the existing `SS_VARIANT_SEARCH_DEDUPE` rule plus the one-line form. |
| A3 omit already-shown code | ss-search, ss-find (NOT ss-read) | Per `(rollout, thread)` the replay keeps a ledger `(file, line number) -> text` of code shown by EARLIER ss-search, ss-find, ss-read and ss-semantic calls (also `# continues at` blocks). In a later ss-search or ss-find output a code line is omitted only when file, line number and text all equal a ledger line (so an edited line is never omitted). A run of omitted lines becomes `[lines a-b already shown above]` when that saves at least 20 chars. A block that is wholly shown becomes the marker line alone (fences go). Imports blocks are not touched. ss-read outputs are never changed, but they fill the ledger. Parallel calls of one turn are treated as sequential in `callIndex` order. |
| A4 ss-trace | ss-trace | Keep: `# trace` line, `fan-in=N fan-out=M` (budget and latency removed), `note:` / `ambiguous:` / `no stored call edges` lines, and the requested section header (mode word read from the recorded command; all recorded trace calls carry one). Drop: `answer checklist:` and `answer cues:` lines, target imports/code/callsite hints, the `mode=...` hint line, the other sections, the `<<SS_TRACE_META>>` JSON line. Each caller/callee item (`### name [type] importance=x` + summary line + optional code block) becomes ONE row (its summary line); items with the same name and location merge their `call@` sites (`call@336,340`). Impact paths are already one row each and are kept. External callees are NOT filtered (the spec did not ask for it). **A4-lite** keeps the item bodies (header + code) and only restricts the section and removes cues, meta and budget/latency. |
| B1 summary cap 3 / 5 | ss-search, ss-find | Keep the first N summary-presentation entries in rank order; drop the later ones, with their blank separators. Entries that show code are never dropped. Standalone B1 acts on the raw output; inside A + B it acts after A2. |
| B7 ss-grep | ss-grep | Hit line = `path:line: text`. (a) In a test/spec/fixture file (directory `test(s)`, `__tests__`, `spec(s)`, `fixture(s)`, `testdata`, `e2e`, `__snapshots__`; file `*.test.*`, `*.spec.*`, `*_test.*`, `*_spec.*`, `test_*.py`, `conftest.py`, `*Test(s).java/kt/cs...`, `*.snap`) all hits collapse to the first hit line plus `(+N more test hits)`. (b) When the output prints at least 50 hit lines, EVERY file (source and test) becomes one line `path: N hits`, and (a) is not applied. Reordering source before test is not simulated (no size effect). |
| Bundle A | all | A1 + A2 + A3 on ss-search and ss-find (order: A2, A3, A1), A4 on ss-trace. |
| A + B | all | Bundle A, then B1 (cap 5 or cap 3) on ss-search / ss-find, and B7 on ss-grep. |
| Not simulated | | A5 and A6 (robustness and rules text: no size effect on recorded calls), B2, B5, B6, B8 (behaviour changes). B3 and B4 are dropped by owner decision; ss-read is unchanged. |
"""

CAVEATS = """\
- **Static replay.** The agent is not re-run. A shorter output may change what the agent does next (more or fewer follow-up calls). The estimate is the saving at constant behaviour. Real savings need a task A/B.
- **13 tasks, 1,141 rollouts.** Two tasks hold half of the trace calls and most Opus ss-search calls come from one task. Opus has only 35 ss-search, 4 ss-find and 6 ss-trace calls, so its A-bundle numbers are noisy.
- **Model mix.** Three of four harness keys are gpt-5.6-luna. The current target models (Sol, DeepSeek, Opus, Sonnet) may call the tools differently.
- **A3 is a lower bound for the ledger.** The ledger holds only code shown by ss-* tools. Code the agent saw through native `cat`, `sed`, or `Read` is not counted. Edits are handled by the text-equality test (an edited line no longer matches). Lines shown inside `### imports` blocks are not numbered and not counted.
- **A3 order effect.** The replay treats parallel calls of one turn as ordered by `callIndex`. A real tool would need to track state across such calls.
- **A2 same-symbol rule.** The rule "repeats an earlier file+symbol" also removes distinct entries that share a generic name (for example several `it` or `init` blocks of one file). The row `A2-span-only` shows A2 without that rule. The existing `SS_VARIANT_SEARCH_DEDUPE` variant has the same rule.
- **A2 loses two small things.** A one-line summary has no rank number and no span end (the line keeps `path:line symbol (kind)`). The agent never quoted either in the reader sample, but it is a change.
- **A3 on Codex.** Codex outputs print no line-number gutter. Line numbers come from the entry start line plus position, and a block that elides lines in the middle (`...`) can shift later numbers. The text-equality test then fails and nothing is omitted, so the error is on the safe side. STATS section C2 counts equal line numbers only; the replay needs equal text, so the replay figures are 0.87 to 1.01 of the C2 figures (check in section 6).
- **A3 sub-agent threads.** The ledger is per `(rollout, thread)`. Claude Code Luna sub-agent threads (`side:...`) hold about half of the Claude Code Luna ss-find code and re-read many files, so A3 is large there. The STATS C2 table covers only the main thread.
- **A4 drops caller/callee code bodies.** "One row per caller/callee" removes the code block of each item. If the owner wants the bodies kept, use the A4-lite row.
- **Boundary quality.** 6% of ss-* calls have a split boundary that is not `exact` (STATS validation table). A wrong split shifts a few characters between neighbouring calls. All calls with a known output are used.
- **Cost model.** Dollars use list prices and a write-once, read-`amp`-times model. Opus uses the 5-minute write price; a 1-hour cache would cost more per write. The Luna prices are the project price model, not a quote from the owner. Output-token savings and turn-count changes are not modelled.
- **Amplification counts the first read.** The denominator and the numerator use (1 + amp), as in STATS. This slightly overstates both, and the ratio is nearly unchanged.
- **Persisted large results.** Claude Code replaces results above its context limit by a 2 KB preview. The replay uses the full text; this affects 8 results.
- **B7 thresholds and test-path rule are heuristics.** The flood guard (50 hits) and the path regex are the spec text turned into code. A different test-file rule changes the B7 number by a few points.
"""


def sample_md(samples):
    """Two short before/after samples for REPLAY.md."""
    out = []
    picks = [('ss-search', 'A+B5', lambda d, o: 'A3' in o and len(o['A3']) < d['outputChars'] - 40 and d['outputChars'] < 1800),
             ('ss-trace', 'A4', lambda d, o: d['outputChars'] < 2600),
             ('ss-grep', 'B7', lambda d, o: 'B7' in o and len(o['B7']) < d['outputChars'] - 100 and d['outputChars'] < 1500)]
    for tool, v, want in picks:
        c = [(d, o) for d, o in samples if d['tool'] == tool and want(d, o)]
        if not c:
            continue
        rnd = random.Random(5)
        d, o = rnd.choice(c)
        out.append(f'**{tool}**, `{d["args"]}` ({d["hk"]}), {len(d["output"])} chars -> {len(o[v])} chars with {v}')
        out.append('')
        out.append('Before:')
        out.append('')
        out.append('````text')
        out.append(d['output'][:2400])
        out.append('````')
        out.append('')
        out.append('After:')
        out.append('')
        out.append('````text')
        out.append(o[v][:2400])
        out.append('````')
        out.append('')
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='write REPLAY.md next to this script')
    ap.add_argument('--validate', type=int, default=0, metavar='N', help='print N before/after samples per tool and run self checks')
    ap.add_argument('--out', default=None, help='with --validate: write the sample print-out to this file')
    args = ap.parse_args()
    D, U, T = load()
    samples = []
    recs = run_replay(D, keep_samples=samples)
    A = aggregate(D, U, T, recs)
    hks = [h for h in HKS if A['n_roll'][h]]
    print(f'# replay: {len(recs)} ss-* calls replayed, {len(T)} rollouts, harness keys {hks}')
    checks = self_checks(D)
    for name, ok, detail in checks:
        print(f'check {"PASS" if ok else "FAIL"}: {name} - {detail}')
    if args.validate:
        if args.out:
            with open(args.out, 'w') as fh:
                print_validation(samples, args.validate, fh)
            print(f'validation samples written to {args.out}')
        else:
            print_validation(samples, args.validate, sys.stdout)
    for hk in hks:
        print(f'\n## {hk}')
        print(md_table(MAIN_HEAD, main_table(A, hk)))
    print('\n## per tool\n')
    print(pertool_table(A, hks))
    print('\n## context\n')
    print(context_table(A, hks))
    if args.write:
        val_path = os.path.relpath(os.path.join(DATA, 'replay-validation.txt'), WT)
        text = build_report(A, D, checks, {'val_path': val_path, 'val_md': sample_md(samples)})
        path = os.path.join(HERE, 'REPLAY.md')
        with open(path, 'w') as fh:
            fh.write(text)
        print(f'\nwrote {path}')


if __name__ == '__main__':
    main()
