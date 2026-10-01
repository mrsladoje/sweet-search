#!/usr/bin/env python3
"""ss_parse - character-exact parsers for the output of the ss-* tools.

The printers live in eval/agent-read-workflows/bin/_ss-helpers.mjs (cmdAgentSearch, cmdFind, cmdRead,
cmdGrep, cmdSemantic, cmdTrace). Every character of an output is assigned to exactly ONE bucket, so the
buckets of a call sum to len(output).

parse_search_like(text)  ss-search / ss-find   -> {buckets, entries, shown (code spans), ok}
parse_read(text)         ss-read               -> {buckets, shown}
parse_grep(text)         ss-grep               -> {buckets}
parse_semantic(text)     ss-semantic           -> {buckets, shown}
"""
import re

RANK_RE = re.compile(
    r'^(## #(\d+) )(.+?):(\d+)-(\d+)( \[.*\])? (\(([a-z_]+)( kind=\w+)?( STALE)?\)) (score=-?\d+(?:\.\d+)?)$')
SYM_RE = re.compile(r'^ \[([^\]:]*): (.*)\]$')
SUMMARY_RE = re.compile(r'^(\S+):(\d+) — (.+) \(([^)]*)\)$')
ROUTE_RE = re.compile(r'^(?:route=\S+ confidence=|<<SS_ROUTE_META>>)')
GUT_TAB = re.compile(r'^(\d+)\t')
GUT_COL = re.compile(r'^(\d+):')
CODE_ENDERS = re.compile(r'^(## |### |# |shown-full:|route=|<<SS_ROUTE|<<SS_TRACE|```)')


def _lines(text):
    """-> list of (line_without_newline, chars_including_newline)."""
    parts = text.split('\n')
    out = []
    for i, p in enumerate(parts):
        last = i == len(parts) - 1
        if last and p == '':
            break
        out.append((p, len(p) + (0 if last else 1)))
    return out


def _closes(lines, idx):
    """Is lines[idx] (== ``` ) the CLOSING fence? It is when what follows looks like structure."""
    if idx + 1 >= len(lines):
        return True
    nxt = lines[idx + 1][0]
    if nxt == '':
        if idx + 2 >= len(lines):
            return True
        return bool(CODE_ENDERS.match(lines[idx + 2][0]))
    return bool(CODE_ENDERS.match(nxt))


def detect_gutter(content, start_line=None):
    """content: list of line strings of one fenced block. -> ('tab'|'colon'|None, [gutter_len per line], [lineno per line or None])"""
    if not content:
        return None, [], []
    n = len(content)
    tab = [GUT_TAB.match(l) for l in content]
    col = [GUT_COL.match(l) for l in content]
    def seq_ok(ms):
        nums = [int(m.group(1)) if m else None for m in ms]
        pairs = [(a, b) for a, b in zip(nums, nums[1:]) if a is not None and b is not None]
        if not pairs:
            return nums[0] is not None and (start_line is None or nums[0] == start_line)
        good = sum(1 for a, b in pairs if b == a + 1)
        return good / len(pairs) >= 0.7
    if sum(1 for m in tab if m) / n >= 0.8 and seq_ok(tab):
        return 'tab', [len(m.group(0)) if m else 0 for m in tab], [int(m.group(1)) if m else None for m in tab]
    if sum(1 for m in col if m) / n >= 0.8 and seq_ok(col):
        return 'colon', [len(m.group(0)) if m else 0 for m in col], [int(m.group(1)) if m else None for m in col]
    return None, [0] * n, [None] * n


def _fill_numbers(nums, start):
    """Line numbers for a block: use detected ones, interpolate gaps, else sequential from start."""
    out = []
    cur = (start - 1) if start is not None else None
    for k, v in enumerate(nums):
        if v is not None:
            cur = v
        elif cur is not None:
            cur += 1
        out.append(cur)
    return out


def parse_search_like(text):
    lines = _lines(text)
    B = {}
    def add(b, n):
        B[b] = B.get(b, 0) + n
    entries = []
    cur = None
    pending_blank = 0
    pending_role = None
    in_related = False
    shown = []
    i = 0
    seen_rank = False
    while i < len(lines):
        line, n = lines[i]
        # ------------- fenced block
        if line.startswith('```'):
            role = pending_role or 'code'
            pending_role = None if role != 'imports' else None
            # find the closing fence
            j = i + 1
            while j < len(lines) and not (lines[j][0] == '```' and _closes(lines, j)):
                j += 1
            content = [lines[k][0] for k in range(i + 1, min(j, len(lines)))]
            clens = [lines[k][1] for k in range(i + 1, min(j, len(lines)))]
            close_n = lines[j][1] if j < len(lines) else 0
            if pending_blank:
                add('blank', pending_blank)
                if cur:
                    cur['chars'] += pending_blank
                pending_blank = 0
            blk_chars = n + sum(clens) + close_n
            if cur:
                cur['chars'] += blk_chars
            if role == 'imports':
                add('imports', blk_chars)
            elif role == 'continuation':
                add('continuation_code', blk_chars)
            else:
                add('code_fence_markers', n + close_n)
                style, glens, nums = detect_gutter(content, cur['start'] if cur else None)
                gsum = sum(glens)
                tsum = sum(clens) - gsum
                add('code_gutter', gsum)
                add('code_text', tsum)
                if cur is not None:
                    cur['has_code'] = True
                    cur['code_chars'] += n + sum(clens) + close_n
                    cur['gutter'] = style
                    cur['code_text_chars'] = cur.get('code_text_chars', 0) + tsum
                    cur['gutter_chars'] = cur.get('gutter_chars', 0) + gsum
                    full = _fill_numbers(nums, cur['start'])
                    shown.append({'file': cur['file'], 'start': cur['start'], 'end': cur['end'], 'tool': 'entry',
                                  'lines': [(full[k], clens[k] - glens[k]) for k in range(len(content)) if full[k] is not None],
                                  'rank': cur['rank'], 'presentation': cur['presentation']})
            i = j + 1
            continue
        # ------------- blank
        if line == '':
            pending_blank += n
            i += 1
            continue
        # ------------- rank header
        m = RANK_RE.match(line)
        if m:
            entry = {'rank': int(m.group(2)), 'file': m.group(3), 'start': int(m.group(4)), 'end': int(m.group(5)),
                     'symbol': None, 'symtype': None, 'presentation': m.group(8), 'kind': (m.group(9) or '').strip(),
                     'chars': 0, 'has_code': False, 'code_chars': 0, 'summary_line': None, 'summary_chars': 0, 'header_chars': n, 'gutter': None}
            if m.group(6):
                sm = SYM_RE.match(m.group(6))
                if sm:
                    entry['symtype'], entry['symbol'] = sm.group(1), sm.group(2)
            entries.append(entry)
            cur = entry
            seen_rank = True
            add('blank', pending_blank)
            entry['chars'] += pending_blank + n
            pending_blank = 0
            add('rank_overhead', len(m.group(1)) + 1)
            add('rank_path_range', len(m.group(3)) + 1 + len(m.group(4)) + 1 + len(m.group(5)))
            add('rank_symbol', len(m.group(6) or ''))
            add('rank_presentation', 1 + len(m.group(7)))
            add('rank_score', 1 + len(m.group(11)))
            # sanity: the pieces plus the newline add to n
            accounted = len(m.group(1)) + 1 + len(m.group(3)) + 1 + len(m.group(4)) + 1 + len(m.group(5)) + len(m.group(6) or '') + 1 + len(m.group(7)) + 1 + len(m.group(11))
            if n - accounted:
                add('rank_overhead', n - accounted)
            in_related = False
            pending_role = None
            i += 1
            continue
        # ------------- everything else: attribute pending blank first
        trailer = bool(re.match(r'shown-full: ', line)) or bool(ROUTE_RE.match(line))
        if pending_blank:
            add('blank', pending_blank)
            if cur and not trailer:
                cur['chars'] += pending_blank
            pending_blank = 0
        def put(bucket, count=n):
            add(bucket, count)
            if cur and not trailer:
                cur['chars'] += count
        if line.startswith('# ss-search:') or line.startswith('# ss-find:'):
            put('header_meta')
        elif line.startswith('# confidence='):
            put('header_confidence')
        elif line.startswith('# variant-sentinel'):
            put('header_other')
        elif line == '### imports':
            put('imports')
            pending_role = 'imports'
            in_related = False
        elif line.startswith('### related'):
            put('related')
            in_related = True
        elif in_related and line.startswith('- '):
            put('related')
        elif line.startswith('# same file: '):
            put('same_file_map')
            in_related = False
        elif line.startswith('# same file (siblings of '):
            put('sibling_line')
            in_related = False
        elif line.startswith('# indexed family:'):
            put('family_manifest')
            in_related = False
        elif line.startswith('# continues at '):
            put('continuation_line')
            pending_role = 'continuation'
            in_related = False
        elif line.startswith('shown-full: '):
            put('shown_full')
            cur = None
        elif ROUTE_RE.match(line):
            put('route_trailer')
            cur = None
        elif cur is not None and cur['presentation'] == 'summary' and cur['summary_line'] is None and not line.startswith('#'):
            put('summary_lines')
            cur['summary_line'] = line
            cur['summary_chars'] = n
            in_related = False
        else:
            put('other')
            in_related = False
        i += 1
    if pending_blank:
        add('blank', pending_blank)
    total = sum(B.values())
    return {'buckets': B, 'entries': entries, 'shown': shown, 'total': total, 'ok': total == len(text) and seen_rank or (not entries)}


def parse_read(text):
    lines = _lines(text)
    B = {}
    def add(b, n):
        B[b] = B.get(b, 0) + n
    shown = []
    hdr = lines[0][0] if lines else ''
    m = re.match(r'^# ss-read (.+?)(?: \(lines (\d+)-(\d+) of (\d+)\)| \((\d+) lines\))?$', hdr)
    file = m.group(1) if m else None
    if m and m.group(2):
        a, b_, tot = int(m.group(2)), int(m.group(3)), int(m.group(4))
    elif m and m.group(5):
        a, b_, tot = 1, int(m.group(5)), int(m.group(5))
    else:
        a = b_ = tot = None
    i = 0
    if lines:
        add('header_meta', lines[0][1])
        i = 1
    while i < len(lines):
        line, n = lines[i]
        if line.startswith('```'):
            j = i + 1
            while j < len(lines) and not (lines[j][0] == '```' and (j + 1 >= len(lines) or True)):
                j += 1
            # the closing fence of a read is the LAST bare fence line (code may contain ``` lines)
            last = max([k for k in range(i + 1, len(lines)) if lines[k][0] == '```'] or [len(lines) - 1])
            j = last
            content = [lines[k][0] for k in range(i + 1, j)]
            clens = [lines[k][1] for k in range(i + 1, j)]
            add('code_fence_markers', n + (lines[j][1] if j < len(lines) else 0))
            style, glens, nums = detect_gutter(content, a)
            add('code_gutter', sum(glens))
            add('code_text', sum(clens) - sum(glens))
            full = _fill_numbers(nums, a)
            shown.append({'file': file, 'start': a, 'end': b_, 'tool': 'read',
                          'lines': [(full[k], clens[k] - glens[k]) for k in range(len(content)) if full[k] is not None], 'gutter': style})
            i = j + 1
            continue
        if line.startswith('#') or line.startswith('(') or line.startswith('…') or line.startswith('...'):
            add('read_notes', n)
        elif line == '':
            add('blank', n)
        else:
            add('other', n)
        i += 1
    return {'buckets': B, 'shown': shown, 'total': sum(B.values()), 'ok': sum(B.values()) == len(text)}


GREP_MATCH = re.compile(r'^([^\s:][^:\n]*):(\d+): (.*)$')


def parse_grep(text):
    lines = _lines(text)
    B = {}
    def add(b, n):
        B[b] = B.get(b, 0) + n
    for line, n in lines:
        if line.startswith('# ss-grep:'):
            add('header_meta', n)
        elif line.startswith('# (+N more'):
            add('truncation_note', n)
        elif line.startswith('# same file (siblings of '):
            add('sibling_line', n)
        elif line.startswith('# indexed family:'):
            add('family_manifest', n)
        elif line == '(no matches)':
            add('no_matches', n)
        elif GREP_MATCH.match(line):
            m = GREP_MATCH.match(line)
            add('match_path', len(m.group(1)))
            add('match_lineno_sep', n - len(m.group(1)) - len(m.group(3)))
            add('match_text', len(m.group(3)))
        elif line.startswith('(+') or line.startswith('(scope'):
            add('hidden_or_scope_note', n)
        elif line == '':
            add('blank', n)
        else:
            add('other', n)
    return {'buckets': B, 'total': sum(B.values()), 'ok': sum(B.values()) == len(text)}


SEM_HDR = re.compile(r'^### (.+?):(\d+)-(\d+)(?: \[(.*)\])?$')


def parse_semantic(text):
    lines = _lines(text)
    B = {}
    def add(b, n):
        B[b] = B.get(b, 0) + n
    shown = []
    i = 0
    cur = None
    while i < len(lines):
        line, n = lines[i]
        if line.startswith('# ss-semantic'):
            add('header_meta', n)
            i += 1
            continue
        m = SEM_HDR.match(line)
        if m:
            add('span_header', n)
            cur = {'file': m.group(1), 'start': int(m.group(2)), 'end': int(m.group(3))}
            i += 1
            continue
        if line.startswith('```'):
            j = i + 1
            while j < len(lines) and lines[j][0] != '```':
                j += 1
            content = [lines[k][0] for k in range(i + 1, j)]
            clens = [lines[k][1] for k in range(i + 1, j)]
            add('code_fence_markers', n + (lines[j][1] if j < len(lines) else 0))
            style, glens, nums = detect_gutter(content, cur['start'] if cur else None)
            add('code_gutter', sum(glens))
            add('code_text', sum(clens) - sum(glens))
            if cur:
                full = _fill_numbers(nums, cur['start'])
                shown.append({'file': cur['file'], 'start': cur['start'], 'end': cur['end'], 'tool': 'semantic',
                              'lines': [(full[k], clens[k] - glens[k]) for k in range(len(content)) if full[k] is not None], 'gutter': style})
            i = j + 1
            continue
        if line.startswith('shown-full: '):
            add('shown_full', n)
        elif line == '':
            add('blank', n)
        else:
            add('other', n)
        i += 1
    return {'buckets': B, 'shown': shown, 'total': sum(B.values()), 'ok': sum(B.values()) == len(text)}


def result_paths(text):
    """Paths named by rank headers of a search/find output (strict set)."""
    out = []
    for line in text.split('\n'):
        m = RANK_RE.match(line)
        if m:
            out.append(m.group(3))
    return out


PATH_TOKEN = re.compile(r'(?<![\w./-])((?:[\w@.-]+/)+[\w@.-]+\.[A-Za-z0-9]{1,8}|[\w@-]+\.[A-Za-z]{1,8})(?=[:\s,)\]\'"`]|$)')


def loose_paths(text):
    """Every path-like token of an output (loose set)."""
    return set(m.group(1) for m in PATH_TOKEN.finditer(text))
