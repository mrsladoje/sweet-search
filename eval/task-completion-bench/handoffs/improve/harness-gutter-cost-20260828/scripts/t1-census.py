#!/usr/bin/env python3
"""T1 - codex middle-out truncation census over the fresh pool (epoch C).

For every truncated codex tool output in the four codex cells (native, sweet TAB, sweet
NONE, sweet PIPE): the command class, the original token count, the tokens deleted, the
deleted LINE span, what the model did in the next 1/2/3 tool calls, the price of the
re-read and gap-search follow-ups, a no-cap counterfactual, and the truncation/outcome
correlation.

Read-only. Writes /tmp/fp-inv/trunc/census.json only.
"""
import json, os, re, sys, collections
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import (R, pool, transcripts, events_codex, turn_costs, edit_kind,
                       anchors_of, golden_for, resolve_path, resolution_index,
                       assign_reps, strip_gutter, PRICE)

OUT = '/tmp/fp-inv/trunc'
os.makedirs(OUT, exist_ok=True)

CELLS = [('native', '-', 'fp-codex-tab-20260826'),
         ('sweet', 'tab', 'fp-codex-tab-20260826'),
         ('sweet', 'none', 'fp-codex-none-20260826'),
         ('sweet', 'pipe', 'fp-codex-pipe-20260826')]

TRUNC_WARN = re.compile(r'Warning: truncated output \(original token count: (\d+)\)')
ORIG_TOK = re.compile(r'Original token count: (\d+)')
TOTAL_LINES = re.compile(r'Total output lines: (\d+)')
MARK = re.compile(r'…([\d,]+) tokens truncated…')

H_SSREAD = re.compile(r'^# ss-read (\S+) \((?:lines (\d+)-(\d+) of \d+|(\d+) lines?)\)', re.M)
H_RANK = re.compile(r'^## #(\d+) (\S+?):(\d+)-(\d+)\b', re.M)
H_PACK = re.compile(r'^# ss-search: ', re.M)
RG_PREFIX = re.compile(r'^([^\s:]+):(\d+)[:-]', re.M)
G_NUM = re.compile(r'^\s*(\d+)(\t|\| |: )', re.M)

TRAILER = re.compile(r'sufficient=|^# unread below|not shown|^shown-full:|^route=', re.M)

SS_TOOLS = ('ss-read', 'ss-search', 'ss-find', 'ss-grep', 'ss-trace', 'ss-semantic')
SEARCHY = ('ss-search', 'ss-find', 'ss-grep', 'ss-trace', 'ss-semantic', 'rg', 'grep', 'ag', 'ack')
READY = ('ss-read', 'sed', 'cat', 'nl', 'head', 'tail', 'less', 'awk')

IDENT = re.compile(r'[A-Za-z_][A-Za-z0-9_]{3,}')


# --------------------------------------------------------------- command parsing
def split_subcmds(cmd):
    return [s.strip() for s in re.split(r'&&|\|\||;|\n', cmd or '') if s.strip()]


def parse_ssread_args(argstr):
    parts = [p for p in argstr.strip().split() if not p.startswith('--')]
    if not parts:
        return None
    f = parts[0].strip('\'"')
    if len(parts) == 1:
        return (f, None, None)
    m = re.fullmatch(r'(\d+)[-:,](\d+)', parts[1])
    if m and len(parts) == 2:
        return (f, int(m.group(1)), int(m.group(2)))
    try:
        s = int(parts[1])
    except ValueError:
        return (f, None, None)
    if len(parts) == 2:
        return (f, s, s)
    try:
        e = int(parts[2])
    except ValueError:
        return (f, s, s)
    if e < s:
        e = s + e - 1
    return (f, s, e)


SSREAD_CALL = re.compile(r'(?:^|[\s;&|(])ss-read\s+((?:(?!&&|\|\||;|\n).)*)')
SED_N = re.compile(r"sed\s+-n\s+'?(\d+),(\d+)p'?\s+(\S+)")
CAT_F = re.compile(r'\bcat\s+(?!<<)([\w./$~+-]+\.[\w]+)')
NL_F = re.compile(r'\bnl\s+(?:-\S+\s+)*([\w./$~+-]+\.[\w]+)')
HEAD_F = re.compile(r'\bhead\s+-n?\s*(\d+)\s+([\w./$~+-]+\.[\w]+)')


def read_targets(cmd):
    """[(file, start, end)] a command would deliver. end=None means to end of file."""
    out = []
    for m in SSREAD_CALL.finditer(cmd):
        a = parse_ssread_args(m.group(1))
        if a:
            out.append(a)
    for m in SED_N.finditer(cmd):
        out.append((m.group(3).strip('\'"'), int(m.group(1)), int(m.group(2))))
    for m in CAT_F.finditer(cmd):
        out.append((m.group(1), 1, None))
    for m in NL_F.finditer(cmd):
        out.append((m.group(1), 1, None))
    for m in HEAD_F.finditer(cmd):
        out.append((m.group(2), 1, int(m.group(1))))
    return out


def search_queries(cmd):
    """quoted patterns and bare first args of search-class sub-commands."""
    qs = []
    for sub in split_subcmds(cmd):
        toks = sub.split()
        if not toks:
            continue
        tool = os.path.basename(toks[0])
        if tool not in SEARCHY:
            continue
        for m in re.finditer(r'"([^"]{2,})"|\'([^\']{2,})\'', sub):
            qs.append(m.group(1) or m.group(2))
        for t in toks[1:]:
            if t.startswith('-') or t.startswith('"') or t.startswith("'"):
                continue
            if '/' in t or t.startswith('$'):
                continue
            if len(t) >= 3:
                qs.append(t)
    return qs


def cmd_classes(cmd):
    """set of read/search command classes present in an envelope."""
    cs = set()
    for sub in split_subcmds(cmd):
        toks = sub.split()
        if not toks:
            continue
        t = os.path.basename(toks[0].strip('\'"'))
        if t in SS_TOOLS or t in ('sed', 'cat', 'rg', 'nl', 'grep', 'head', 'tail', 'awk', 'ls', 'find'):
            cs.add(t)
    return cs


def same_file(a, b):
    if not a or not b:
        return False
    a = str(a).lstrip('./')
    b = str(b).lstrip('./')
    return a == b or a.endswith('/' + b) or b.endswith('/' + a) or (
        os.path.basename(a) == os.path.basename(b) and os.path.basename(a) != '')


def spans_overlap(s1, e1, s2, e2):
    e1 = e1 if e1 is not None else 10 ** 9
    e2 = e2 if e2 is not None else 10 ** 9
    s1 = s1 or 1
    s2 = s2 or 1
    return not (e1 < s2 or e2 < s1)


# ----------------------------------------------------------- marker resolution
def golden_lines(gold, fp, cache):
    p = resolve_path(gold, fp)
    if not p:
        return None
    if p not in cache:
        try:
            cache[p] = open(p, encoding='utf8', errors='replace').read().split('\n')
        except Exception:
            cache[p] = None
    return cache[p]


def preceding_block(out, pos):
    """(kind, file, hdr_lo, hdr_hi, rank) of the nearest block header before pos."""
    seg = out[:pos]
    best = (None, None, None, None, None)
    for m in H_SSREAD.finditer(seg):
        if m.group(2):
            lo, hi = int(m.group(2)), int(m.group(3))
        elif m.group(4):
            lo, hi = 1, int(m.group(4))
        else:
            lo = hi = None
        best = ('ss-read', m.group(1), lo, hi, None)
    bp = seg.rfind('\n# ss-read ')
    for m in H_RANK.finditer(seg):
        if m.start() > bp:
            best = ('pack-rank', m.group(2), int(m.group(3)), int(m.group(4)), int(m.group(1)))
    return best


def resolve_marker(out, m, gold, cache, cand_files):
    """-> dict(file, lo, hi, how). lo/hi = first and last line NOT fully delivered
    (the deleted span); how names the evidence."""
    pre = out[out.rfind('\n', 0, m.start()) + 1:m.start()]
    nxt = out.find('\n', m.end())
    post = out[m.end(): nxt if nxt >= 0 else len(out)]
    kind, hfile, hlo, hhi, rank = preceding_block(out, m.start())

    # 1. gutter numbers either side (TAB / PIPE / colon)
    before_n = after_n = None
    for g in G_NUM.finditer(out[:m.start()]):
        before_n = int(g.group(1))
    tail = out[m.end():]
    g2 = G_NUM.search(tail)
    if g2 and tail[:g2.start()].count('\n') <= 2:
        after_n = int(g2.group(1))
    if before_n is None and after_n is None:
        shape = 'unnumbered'
    elif before_n is None or after_n is None:
        shape = 'half-numbered'
    elif after_n > before_n + 1:
        shape = 'within-block-gap'
    elif after_n == before_n + 1:
        shape = 'sub-line-cut'
    else:
        shape = 'cross-block-cut'
    base = {'shape': shape, 'before_n': before_n, 'after_n': after_n}
    if shape == 'within-block-gap':
        # the number can only be read as a within-file gap when the block GOVERNING the
        # line after the cut is the same file as the block before it. A middle-out cut
        # that jumps from one rendered block into the next leaves an increasing pair of
        # numbers that belong to two different files.
        after_abs = m.end() + g2.start()
        kb, fb, _lo, _hi, _rk = preceding_block(out, after_abs)
        boundary = re.search(r'^(```|# ss-read |## #\d+ |### |# ss-search:|\[run_tests)',
                             out[m.end():after_abs], re.M)
        contained = (_lo is not None and _hi is not None and hlo is not None
                     and hhi is not None and hlo <= before_n + 1 and after_n - 1 <= hhi
                     and _lo == hlo and _hi == hhi)
        if (boundary or (hfile and fb and hfile != fb)
                or (hfile is None) != (fb is None) or not contained):
            base['shape'] = 'cross-block-cut'
        else:
            base.update({'file': hfile, 'lo': before_n + 1, 'hi': after_n - 1,
                         'how': 'gutter', 'block': kind, 'rank': rank})
            return base

    # 2. rg-style path:line: prefixes either side
    rb = None
    for g in RG_PREFIX.finditer(out[:m.start()]):
        rb = g
    ra = RG_PREFIX.search(tail)
    if rb and ra and tail[:ra.start()].count('\n') <= 2 and rb.group(1) == ra.group(1):
        lo, hi = int(rb.group(2)) + 1, int(ra.group(2)) - 1
        if hi >= lo:
            base.update({'file': rb.group(1), 'lo': lo, 'hi': hi, 'how': 'rg-prefix',
                         'block': 'rg', 'rank': None})
            return base

    # 3. match the cut line fragments against the golden files named in the envelope
    pre_s = strip_gutter(pre).rstrip()
    post_s = post.strip()
    cands = ([hfile] if hfile else []) + list(cand_files)
    seen_c = set()
    for fp in cands:
        if not fp or fp in seen_c:
            continue
        seen_c.add(fp)
        gl = golden_lines(gold, fp, cache)
        if not gl:
            continue
        pk, po = pre_s.strip()[:80], post_s[-80:]
        pres = [i + 1 for i, l in enumerate(gl) if len(pk) >= 12 and l.strip().startswith(pk)]
        posts = [i + 1 for i, l in enumerate(gl) if len(po) >= 12 and l.strip().endswith(po)]
        best = None
        for a in pres:
            for b in posts:
                if b - 1 >= a + 1 and (best is None or (b - a) < (best[1] - best[0])):
                    best = (a, b)
        if best:
            uniq = (len(pres) == 1 and len(posts) == 1)
            base.update({'file': fp, 'lo': best[0] + 1, 'hi': best[1] - 1,
                         'how': 'golden-match' if uniq else 'golden-match-multi',
                         'block': kind or 'shell', 'rank': rank})
            return base
    # 3b. file-only: the cut line prefix alone names the file (and its first lost line)
    if len(pre_s.strip()) >= 20:
        hit = []
        for fp in cands:
            gl = golden_lines(gold, fp, cache)
            if not gl:
                continue
            n = [i + 1 for i, l in enumerate(gl)
                 if l.strip().startswith(pre_s.strip()[:80])]
            if n:
                hit.append((fp, n))
        if len(hit) == 1 and len(hit[0][1]) == 1:
            base.update({'file': hit[0][0], 'lo': hit[0][1][0] + 1, 'hi': None,
                         'how': 'golden-file-only', 'block': kind or 'shell', 'rank': rank})
            return base
    # 3c. sole read target in the envelope
    uniq_c = [f for f in dict.fromkeys(cands) if f]
    if hfile is None and len(uniq_c) == 1:
        base.update({'file': uniq_c[0], 'lo': None, 'hi': None, 'how': 'sole-candidate',
                     'block': kind or 'shell', 'rank': rank})
        return base
    base.update({'file': hfile, 'lo': None, 'hi': None, 'how': 'unknown',
                 'block': kind or 'shell', 'rank': rank})
    return base


def marker_class(out, m, cmd):
    """command class that produced the truncated region."""
    kind, hfile, hlo, hhi, rank = preceding_block(out, m.start())
    seg = out[:m.start()]
    last_pack = seg.rfind('\n# ss-search:')
    last_read = seg.rfind('\n# ss-read ')
    if kind == 'ss-read' and last_read > last_pack:
        return 'ss-read'
    if kind == 'pack-rank' or last_pack > last_read:
        # a rank block: which sweet tool emitted it?
        cs = cmd_classes(cmd)
        for t in ('ss-search', 'ss-find', 'ss-semantic', 'ss-grep', 'ss-trace'):
            if t in cs:
                return t
        return 'ss-search'
    cs = cmd_classes(cmd)
    order = ['ss-read', 'ss-search', 'ss-find', 'ss-grep', 'ss-trace', 'ss-semantic',
             'sed', 'cat', 'rg', 'nl', 'grep', 'head', 'tail']
    present = [t for t in order if t in cs]
    if len(present) == 1:
        return present[0]
    if present:
        return present[0] + '?compound'
    return 'other'


def pack_survival(out, markers):
    """ss-search pack: ranks before the first marker, ranks after the last, trailer?"""
    if not markers:
        return None
    first, last = markers[0].start(), markers[-1].end()
    head = [int(m.group(1)) for m in H_RANK.finditer(out[:first])]
    tailr = [int(m.group(1)) for m in H_RANK.finditer(out[last:])]
    trailer = any(TRAILER.search(l) for l in out[last:].split('\n'))
    return {'ranks_head': head, 'ranks_tail': tailr, 'trailer_survived': trailer}


# ------------------------------------------------------------------------ main
def main():
    cache = {}
    cases = []
    per = collections.defaultdict(lambda: {
        'rollouts': 0, 'transcripts_seen': 0, 'cells_over_3': 0, 'cost': 0.0,
        'trunc_calls': 0, 'rollouts_with_trunc': 0, 'markers': 0,
        'orig_tokens': 0, 'deleted_tokens': 0, 'delivered_tokens': 0,
        'by_class': collections.Counter(), 'span_how': collections.Counter(),
        'fu': collections.Counter(), 'fu_rollouts': collections.defaultdict(set),
        'reread_cost': 0.0, 'gapsearch_cost': 0.0,
        'reread_turns': 0, 'gapsearch_turns': 0,
        'cf_extra': 0.0, 'trunc_per_rollout': [], 'solved_by_bucket': collections.Counter(),
        'touch': collections.Counter(), 'shape': collections.Counter(),
        'file_known': collections.Counter(),
        'n_by_bucket': collections.Counter(), 'edit_in_gap': 0,
        'edit_in_gap_rollouts': set(), 'blind_edit_rollouts': set(),
    })
    P = pool()
    for arm, form, run in CELLS:
        key = f'codex|{arm}|{form}'
        byrep, bycell, bypath = resolution_index(run)
        for task in P:
            cell = f'{task}-{arm}'
            tl = transcripts(run, 'codex', cell)
            if not tl:
                continue
            per[key]['transcripts_seen'] += len(tl)
            if len(tl) > 3:
                per[key]['cells_over_3'] += 1
            parsed = []
            for mp, _ in tl:
                ev, turns = events_codex(mp)
                tc = turn_costs(turns)
                parsed.append({'path': mp, 'ev': ev, 'turns': turns, 'tc': tc,
                               'cost': sum(x['usd'] for x in tc)})
            parsed.sort(key=lambda x: -x['cost'])
            sel = parsed[:3]
            reps = assign_reps([p['path'] for p in sel], [p['ev'] for p in sel], bypath)
            gold = golden_for(task)
            for p, rep in zip(sel, reps):
                S = per[key]
                S['rollouts'] += 1
                S['cost'] += p['cost']
                ev, tc = p['ev'], p['tc']
                nturns = len(tc)
                resolved = byrep.get((task, arm, rep))
                results = [e for e in ev if e['kind'] == 'result']
                # every line ever shown in this rollout (gutter-stripped, trimmed)
                shown_all = set()
                for e in results:
                    for l in (e.get('output') or '').split('\n'):
                        s = strip_gutter(l).strip()
                        if s:
                            shown_all.add(s)
                # ---- find truncations
                ntr = 0
                rollout_spans = []          # (file, lo, hi) for the later-edit check
                for i, e in enumerate(results):
                    out = e.get('output') or ''
                    mw = TRUNC_WARN.search(out)
                    if not mw:
                        continue
                    ntr += 1
                    inp = e.get('input') or {}
                    cmd = str(inp.get('cmd') or '')
                    markers = list(MARK.finditer(out))
                    orig = int(mw.group(1))
                    deleted = sum(int(m.group(1).replace(',', '')) for m in markers)
                    S['trunc_calls'] += 1
                    S['markers'] += len(markers)
                    S['orig_tokens'] += orig
                    S['deleted_tokens'] += deleted
                    S['delivered_tokens'] += max(0, orig - deleted)
                    cands = [t[0] for t in read_targets(cmd)]
                    mrecs = []
                    for m in markers:
                        r = resolve_marker(out, m, gold, cache, cands)
                        r['deleted_tokens'] = int(m.group(1).replace(',', ''))
                        r['class'] = marker_class(out, m, cmd)
                        mrecs.append(r)
                        S['span_how'][r['how']] += 1
                        S['by_class'][r['class']] += 1
                        if r['file'] and r['lo'] is not None and r['hi'] is not None:
                            rollout_spans.append((r['file'], r['lo'], r['hi'], i))
                    # requested range for ss-read
                    req = [t for t in read_targets(cmd)]
                    pack = pack_survival(out, markers) if any(
                        c.startswith('ss-search') or c.startswith('ss-find') or
                        c.startswith('ss-semantic') for c in [x['class'] for x in mrecs]) else None
                    # ---- follow-ups in the next 1,2,3 tool calls
                    fus = []
                    for k in range(1, 4):
                        j = i + k
                        if j >= len(results):
                            fus.append({'k': k, 'cls': 'e-ended', 'touch': 'ended',
                                        'turn': None})
                            continue
                        f = results[j]
                        fcmd = str((f.get('input') or {}).get('cmd') or '')
                        cls = classify_followup(fcmd, mrecs, gold, cache, shown_all)
                        touch = file_touch(fcmd, mrecs)
                        fus.append({'k': k, 'cls': cls, 'touch': touch,
                                    'turn': f.get('turn'), 'cmd': fcmd[:220]})
                    for f in fus:
                        S['fu'][f"k{f['k']}:{f['cls']}"] += 1
                        S['fu_rollouts'][f"k{f['k']}:{f['cls']}"].add((task, rep))
                        S['touch'][f"k{f['k']}:{f['touch']}"] += 1
                    for r in mrecs:
                        S['shape'][r.get('shape') or '?'] += 1
                        S['file_known'][bool(r.get('file'))] += 1
                    # ---- cost of (a) and (c) follow-ups
                    rt = set()
                    gt = set()
                    for f in fus:
                        if f['turn'] is None or f['turn'] >= nturns:
                            continue
                        if f['cls'] == 'a-reread-gap':
                            rt.add(f['turn'])
                        elif f['cls'] == 'c-gap-symbol-search':
                            gt.add(f['turn'])
                    for t in rt:
                        S['reread_cost'] += tc[t]['usd']
                        S['reread_turns'] += 1
                    for t in gt - rt:
                        S['gapsearch_cost'] += tc[t]['usd']
                        S['gapsearch_turns'] += 1
                    # ---- counterfactual: deliver in full
                    turn_i = e.get('turn') or 0
                    later = max(0, nturns - turn_i - 1)
                    cf = deleted * PRICE['in'] / 1e6 + deleted * PRICE['cache'] / 1e6 * later
                    S['cf_extra'] += cf
                    cases.append({
                        'cell': key, 'task': task, 'rep': rep, 'resolved': resolved,
                        'call_index': i, 'turn': turn_i, 'later_requests': later,
                        'cmd': cmd[:400], 'max_output_tokens': inp.get('max_output_tokens'),
                        'yield_time_ms': inp.get('yield_time_ms'),
                        'orig_tokens': orig, 'deleted_tokens': deleted,
                        'delivered_tokens': max(0, orig - deleted),
                        'total_output_lines': int(TOTAL_LINES.search(out).group(1))
                        if TOTAL_LINES.search(out) else None,
                        'markers': mrecs, 'requested': req, 'pack': pack,
                        'followups': fus, 'cf_extra_usd': cf,
                        'reread_usd': sum(tc[t]['usd'] for t in rt),
                        'gapsearch_usd': sum(tc[t]['usd'] for t in (gt - rt)),
                    })
                # ---- later edits anchored inside a deleted span, never shown elsewhere
                if rollout_spans:
                    blind = check_blind_edits(ev, results, rollout_spans, gold, cache, shown_all)
                    if blind:
                        S['edit_in_gap'] += blind
                        S['blind_edit_rollouts'].add((task, rep))
                S['trunc_per_rollout'].append(ntr)
                b = '0' if ntr == 0 else ('1' if ntr == 1 else ('2' if ntr == 2 else '3+'))
                S['n_by_bucket'][b] += 1
                if resolved is None:
                    S['n_by_bucket']['NULL:' + b] += 1
                elif resolved:
                    S['solved_by_bucket'][b] += 1
                if ntr:
                    S['rollouts_with_trunc'] += 1
    dump(per, cases)


def classify_followup(fcmd, mrecs, gold, cache, shown_all):
    if not fcmd:
        return 'd-unrelated'
    tgts = read_targets(fcmd)
    qs = search_queries(fcmd)
    files = set(x['file'] for x in mrecs if x.get('file'))
    # (a) re-read overlapping a deleted span
    for t in tgts:
        for r in mrecs:
            if not r.get('file') or not same_file(t[0], r['file']):
                continue
            if r.get('lo') is None or r.get('hi') is None:
                if t[1] is None or t[2] is None:
                    return 'a-reread-gap'
                continue
            if spans_overlap(t[1], t[2], r['lo'], r['hi']):
                return 'a-reread-gap'
    # (c) search for a symbol that lives only inside a deleted span
    if qs:
        for r in mrecs:
            if not r.get('file') or r.get('lo') is None or r.get('hi') is None:
                continue
            gl = golden_lines(gold, r['file'], cache)
            if not gl:
                continue
            lo, hi = r['lo'], min(r['hi'], len(gl))
            ins, outs = set(), set()
            for i, l in enumerate(gl, 1):
                for w in IDENT.findall(l):
                    (ins if lo <= i <= hi else outs).add(w)
            only = ins - outs
            for q in qs:
                for w in IDENT.findall(q):
                    if w in only:
                        return 'c-gap-symbol-search'
    # (b) same file, non-overlapping
    for t in tgts:
        if any(same_file(t[0], f) for f in files):
            return 'b-samefile-nonoverlap'
    return 'd-unrelated'


def file_touch(fcmd, mrecs):
    """unbiased, span-free: does the next call touch the file the truncated block came
    from, and how? read / search / neither. Needs only the file name."""
    files = set(x['file'] for x in mrecs if x.get('file'))
    if not files:
        return 'nofile'
    if not fcmd:
        return 'other'
    for t in read_targets(fcmd):
        if any(same_file(t[0], f) for f in files):
            return 'read-same-file'
    for f in files:
        b = os.path.basename(str(f))
        if b and b in fcmd:
            return 'search-mentions-file'
    return 'other'


def check_blind_edits(ev, results, spans, gold, cache, shown_all):
    """later apply_patch anchors that sit inside a deleted span and were never shown."""
    n = 0
    for e in ev:
        if e['kind'] != 'result':
            continue
        ek = edit_kind('codex', e)
        if not ek:
            continue
        for (fp, anchor, hdr, raw) in anchors_of('codex', e, ek):
            gl = golden_lines(gold, fp, cache)
            if not gl:
                continue
            for a in anchor:
                s = a.strip()
                if len(s) < 8:
                    continue
                if s in shown_all:
                    continue
                pos = [i + 1 for i, l in enumerate(gl) if l.strip() == s]
                if not pos:
                    continue
                for (sf, lo, hi, ci) in spans:
                    if same_file(sf, fp) and any(lo <= p <= hi for p in pos):
                        n += 1
                        break
    return n


def dump(per, cases):
    o = {}
    for k, S in per.items():
        d = {kk: vv for kk, vv in S.items()
             if kk not in ('fu_rollouts', 'blind_edit_rollouts', 'edit_in_gap_rollouts')}
        d['by_class'] = dict(S['by_class'])
        d['touch'] = dict(S['touch'])
        d['shape'] = dict(S['shape'])
        d['file_known'] = {str(a): b for a, b in S['file_known'].items()}
        d['span_how'] = dict(S['span_how'])
        d['fu'] = dict(S['fu'])
        d['fu_rollouts'] = {a: len(b) for a, b in S['fu_rollouts'].items()}
        d['solved_by_bucket'] = dict(S['solved_by_bucket'])
        d['n_by_bucket'] = dict(S['n_by_bucket'])
        d['blind_edit_rollouts'] = len(S['blind_edit_rollouts'])
        o[k] = d
    json.dump({'per_cell': o, 'cases': cases}, open(os.path.join(OUT, 'census.json'), 'w'), indent=1)
    print(json.dumps(o, indent=1)[:12000])
    print('\ncases:', len(cases))


if __name__ == '__main__':
    main()
