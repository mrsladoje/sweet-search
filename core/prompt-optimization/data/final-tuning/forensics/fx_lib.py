#!/usr/bin/env python3
"""fx_lib - shared extraction library for the ss-* tool forensics (final-tuning, 2026-10-01).

READ-ONLY on every source. No network, no model call.

Layers
  1. shell parsing        parse_command(): one Bash/exec command -> segments (pipelines) with a tool class.
  2. output splitting     split_output(): the combined stdout of a compound command -> one text per ss-* segment.
  3. harness readers      read_claude / read_codex / read_opencode -> Thread{requests[{calls[]}]} (one request = one model response).
  4. run discovery        discover_runs(): rows.json + agent-state folders of the run dirs we study.

Tool naming rule (FINAL_TUNING.md 2.2, trace/SCHEMA.md): the tool of a call is the BASENAME of the executable.
The path of the shims contains `.ss-eval`; a substring match on `ss-` would be wrong and is never used.
"""
import glob
import json
import os
import re
import shlex
import shutil
import sqlite3
import tempfile
from collections import OrderedDict

SS_TOOLS = ('ss-search', 'ss-find', 'ss-grep', 'ss-read', 'ss-trace', 'ss-semantic', 'ss-batch')
SS_SET = set(SS_TOOLS)

# ----------------------------------------------------------------------------------------------
# 1. shell parsing
# ----------------------------------------------------------------------------------------------
_HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def strip_heredocs(cmd):
    """Drop heredoc bodies (they hold file contents / scripts, not commands). Keeps the command lines."""
    out, pending = [], []
    for ln in cmd.split('\n'):
        if pending:
            if ln.strip() == pending[0]:
                pending.pop(0)
            continue
        out.append(ln)
        for m in _HEREDOC_RE.finditer(ln):
            pending.append(m.group(2))
    return '\n'.join(out)


def split_top(cmd):
    """Split a shell string at top-level separators.

    Returns a list of pipelines; each pipeline is a list of stage strings. Separators: ; && || newline &
    (a lone `&` that is not part of a redirect). `|` joins stages of one pipeline. Quote and
    $( ) ( ) { } ` aware.
    """
    pipelines, stages, cur = [], [], []
    q = None
    depth = 0
    i, n = 0, len(cmd)

    def end_stage():
        s = ''.join(cur).strip()
        cur.clear()
        if s:
            stages.append(s)

    def end_pipe():
        nonlocal stages
        end_stage()
        if stages:
            pipelines.append(stages)
        stages = []

    while i < n:
        c = cmd[i]
        if q:
            cur.append(c)
            if c == '\\' and q == '"' and i + 1 < n:
                cur.append(cmd[i + 1])
                i += 2
                continue
            if c == q:
                q = None
            i += 1
            continue
        if c == '\\' and i + 1 < n:
            if cmd[i + 1] == '\n':  # line continuation
                i += 2
                continue
            cur.append(c)
            cur.append(cmd[i + 1])
            i += 2
            continue
        if c in ('"', "'"):
            q = c
            cur.append(c)
            i += 1
            continue
        if c == '`':
            # backtick substitution: copy through the closing backtick
            j = cmd.find('`', i + 1)
            j = n - 1 if j < 0 else j
            cur.append(cmd[i:j + 1])
            i = j + 1
            continue
        if c == '$' and i + 1 < n and cmd[i + 1] == '(':
            depth += 1
            cur.append('$(')
            i += 2
            continue
        if c in '({':
            cur.append(c)
            i += 1
            continue
        if c in ')}':
            if c == ')' and depth > 0:
                depth -= 1
                cur.append(c)
            elif c == '}':
                cur.append(c)
            # an unmatched ')' closes a subshell group: dropped from the stage text
            i += 1
            continue
        if depth == 0:
            two = cmd[i:i + 2]
            if two in ('&&', '||'):
                end_pipe()
                i += 2
                continue
            if c == ';' or c == '\n':
                end_pipe()
                i += 1
                continue
            if c == '|':
                end_stage()
                i += 1
                continue
            if c == '&':
                prev = cmd[i - 1] if i else ''
                nxt = cmd[i + 1] if i + 1 < n else ''
                if prev in ('>', '<') or nxt == '>' or nxt.isdigit() and prev in ('>', '<'):
                    cur.append(c)
                    i += 1
                    continue
                end_pipe()
                i += 1
                continue
        cur.append(c)
        i += 1
    end_pipe()
    return pipelines


_KEYWORDS = {'do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', 'time', '{', '(', 'then;', 'do;'}
_WRAPPERS = {'timeout', 'env', 'nohup', 'command', 'exec', 'nice', 'stdbuf', 'builtin', 'sudo', 'gtimeout'}
_ENV_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*=')


def _words(stage):
    try:
        return shlex.split(stage, posix=True)
    except ValueError:
        return stage.split()


def stage_words(stage):
    """Words of a stage after keywords, env assignments and wrapper prefixes. Returns (cmd_words, wrappers)."""
    s = stage.strip()
    while s[:1] in '({' and s[:1]:
        s = s[1:].lstrip()
    ws = _words(s)
    wrappers = []
    k = 0
    while k < len(ws):
        w = ws[k]
        if w in _KEYWORDS or _ENV_RE.match(w):
            k += 1
            continue
        if w in _WRAPPERS:
            wrappers.append(w)
            k += 1
            # skip option / duration arguments of the wrapper (timeout 20, env -i, nice -n 5)
            while k < len(ws) and (ws[k].startswith('-') or re.fullmatch(r'\d+[smhd]?', ws[k]) or _ENV_RE.match(ws[k])):
                k += 1
            continue
        break
    return ws[k:], wrappers


def _writes_to_file(stage):
    """True when the stage redirects STDOUT to a file (not /dev/null, not an fd dup)."""
    bare = re.sub(r"'[^']*'|\"(?:[^\"\\]|\\.)*\"", "''", stage)
    for m in re.finditer(r'(\d*)(>>?|&>)\s*(\S+)', bare):
        fd, _, tgt = m.groups()
        if fd not in ('', '1'):
            continue
        if tgt.startswith('&') or tgt == '/dev/null':
            continue
        return True
    return False


NATIVE_SEARCH = {'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'fd', 'locate', 'tree', 'ls'}
NATIVE_READ = {'cat', 'head', 'tail', 'sed', 'nl', 'bat', 'less', 'more', 'awk', 'wc', 'stat', 'file', 'xxd', 'od'}
SCRIPT_CMDS = {'python', 'python3', 'node', 'perl', 'ruby', 'bash', 'sh', 'zsh', 'deno', 'bun', 'php'}


def _command_lookup(stage):
    """`command -v ss-grep` / `command -V ...` only look the tool up; they do not run it."""
    return bool(re.search(r'\bcommand\s+-[vV]\b', stage))


def classify_stage(stage):
    """-> dict(tool, kind, words). kind in ss | native-search | native-read | edit | test | other."""
    words, wrappers = stage_words(stage)
    if not words:
        return {'tool': None, 'kind': 'none', 'words': [], 'wrappers': wrappers}
    first = os.path.basename(words[0])
    rest = words[1:]
    # shell -c '<inner>' : classify the inner script instead
    if first in ('bash', 'sh', 'zsh') and any(w in ('-c', '-lc', '-ic', '-cl') for w in rest[:3]):
        k = next(i for i, w in enumerate(rest[:3]) if w in ('-c', '-lc', '-ic', '-cl'))
        inner = rest[k + 1] if k + 1 < len(rest) else ''
        return {'tool': 'sh-c', 'kind': 'inner', 'words': words, 'inner': inner, 'wrappers': wrappers}
    if wrappers and wrappers[-1] == 'command' and rest[:0] == [] and False:
        pass
    if first in SS_SET and not ('command' in wrappers and _command_lookup(stage)):
        return {'tool': first, 'kind': 'ss', 'words': words, 'wrappers': wrappers}
    if first == 'sweet-search':
        sub = rest[0] if rest else ''
        tool = {'batch': 'ss-batch', 'trace': 'ss-trace', 'search': 'ss-search', 'grep': 'ss-grep', 'find': 'ss-find', 'read': 'ss-read'}.get(sub)
        return {'tool': tool or 'sweet-search', 'kind': 'ss' if tool else 'other', 'words': words, 'viaCli': True, 'wrappers': wrappers}
    if first == 'run_tests':
        return {'tool': 'run_tests', 'kind': 'test', 'words': words, 'wrappers': wrappers}
    if first == 'git':
        sub = next((w for w in rest if not w.startswith('-')), '')
        if sub == 'grep':
            return {'tool': 'git-grep', 'kind': 'native-search', 'words': words, 'wrappers': wrappers}
        if sub == 'ls-files':
            return {'tool': 'git-ls-files', 'kind': 'native-search', 'words': words, 'wrappers': wrappers}
        if sub in ('show',):
            return {'tool': 'git-show', 'kind': 'native-read', 'words': words, 'wrappers': wrappers}
        return {'tool': 'git', 'kind': 'other', 'words': words, 'sub': sub, 'wrappers': wrappers}
    if first in NATIVE_SEARCH:
        return {'tool': first, 'kind': 'native-search', 'words': words, 'wrappers': wrappers}
    if first in ('cat', 'tee') and _writes_to_file(stage):
        return {'tool': first, 'kind': 'edit', 'words': words, 'wrappers': wrappers}
    if first == 'sed' and any(w.startswith('-i') or w == '--in-place' for w in rest):
        return {'tool': 'sed-i', 'kind': 'edit', 'words': words, 'wrappers': wrappers}
    if first in NATIVE_READ:
        return {'tool': first, 'kind': 'native-read', 'words': words, 'wrappers': wrappers}
    if first in ('apply_patch', 'patch'):
        return {'tool': first, 'kind': 'edit', 'words': words, 'wrappers': wrappers}
    return {'tool': first, 'kind': 'other', 'words': words, 'wrappers': wrappers}


def parse_command(cmd, depth=0):
    """Parse a shell command string into segments.

    segment = {tool, kind, text (the stage text), pipeTail [first words of later pipeline stages],
               piped (bool), redirected (bool), words}
    One segment per pipeline (its FIRST stage defines the tool). `cd`, `export`, `set`, `echo`, `true` etc.
    are kept (kind 'other') because they may write output or sit between ss-* segments.
    """
    body = strip_heredocs(cmd or '')
    segs = []
    for stages in split_top(body):
        first = classify_stage(stages[0])
        if first['kind'] == 'inner' and depth < 2:
            segs.extend(parse_command(first.get('inner', ''), depth + 1))
            continue
        tails = []
        for st in stages[1:]:
            w, _ = stage_words(st)
            tails.append(os.path.basename(w[0]) if w else '')
        seg = {
            'tool': first['tool'], 'kind': first['kind'], 'text': stages[0],
            'pipeTail': tails, 'piped': bool(tails),
            'redirected': _writes_to_file(stages[0]) if first['kind'] in ('ss', 'native-search', 'native-read', 'test') else False,
            'words': first['words'],
        }
        if first.get('viaCli'):
            seg['viaCli'] = True
        segs.append(seg)
        # command substitutions that run an ss-* tool: the shell captures the output, the model does not see it
        if depth < 2:
            for text in stages:
                for m in re.finditer(r'\$\(\s*((?:[^()]|\([^()]*\))*)\)|`([^`]*)`', text):
                    inner = m.group(1) if m.group(1) is not None else m.group(2)
                    for sub in parse_command(inner or '', depth + 1):
                        if sub['kind'] == 'ss':
                            sub = dict(sub)
                            sub['kind'] = 'ss-sub'
                            sub['substitution'] = True
                            segs.append(sub)
    return segs


# ----------------------------------------------------------------------------------------------
# 2. output splitting
# ----------------------------------------------------------------------------------------------
MARKERS = OrderedDict([
    ('ss-search', re.compile(r'^# ss-search: ', re.M)),
    ('ss-find', re.compile(r'^# ss-find: ', re.M)),
    ('ss-grep', re.compile(r'^# ss-grep: ', re.M)),
    ('ss-read', re.compile(r'^# ss-read ', re.M)),
    ('ss-semantic', re.compile(r'^# ss-semantic ', re.M)),
    ('ss-trace', re.compile(r'^(?:# trace \S.*\[[^\]]*\] \S+:\d+|No indexed symbol found for ")', re.M)),
    ('ss-batch', re.compile(r'^(?:# ss-batch|# batch\b|\{"operations")', re.M)),
])
_GREP_LINE = re.compile(r'^(?:# |\(no matches\)|\(scope not found|\(\+\d+ more|\(\+N more|[^\s:][^:\n]*:\d+: )')
_ROUTE_LINE = re.compile(r'^(?:route=\S+ confidence=|<<SS_ROUTE_META>>)')


def _trim_tail(tool, text):
    """The output of the LAST ss segment before foreign segments (git status, run_tests ...): cut at the
    tool's known end. Returns (text, trimmed_bool)."""
    if tool == 'ss-search':
        m = None
        for mm in re.finditer(r'^(?:route=\S+ confidence=.*|<<SS_ROUTE_META>>.*)$', text, re.M):
            m = mm
        if m:
            cut = m.end()
            return text[:cut] + ('\n' if text[cut:cut + 1] == '\n' else ''), cut < len(text.rstrip('\n'))
        return text, False
    if tool == 'ss-trace':
        m = re.search(r'^<<SS_TRACE_META>>.*$', text, re.M)
        if m:
            return text[:m.end()] + '\n', m.end() < len(text.rstrip('\n'))
        return text, False
    if tool == 'ss-grep':
        lines = text.split('\n')
        keep = []
        for k, ln in enumerate(lines):
            if k == 0 or ln == '' and False:
                keep.append(ln)
                continue
            if _GREP_LINE.match(ln):
                keep.append(ln)
                continue
            break
        res = '\n'.join(keep)
        trimmed = len(res) < len(text.rstrip('\n'))
        return (res + '\n' if trimmed or text.endswith('\n') else res), trimmed
    if tool == 'ss-read':
        m = None
        # header, optional above-line, ```fence ... closing ``` , optional one trailing remainder line
        fence = [mm.start() for mm in re.finditer(r'^```', text, re.M)]
        if len(fence) >= 2:
            close = fence[-1] if len(fence) % 2 == 0 else fence[-2]
            end = text.find('\n', close)
            end = len(text) if end < 0 else end + 1
            nxt_end = text.find('\n', end)
            nxt = text[end:nxt_end if nxt_end >= 0 else len(text)]
            if nxt.startswith('# ') or nxt.startswith('(+') or nxt.startswith('… ') or nxt.startswith('...'):
                end = (nxt_end + 1) if nxt_end >= 0 else len(text)
            return text[:end], end < len(text.rstrip('\n'))
        return text, False
    if tool in ('ss-semantic', 'ss-find'):
        m = None
        for mm in re.finditer(r'^shown-full: .*$', text, re.M):
            m = mm
        if m:
            return text[:m.end()] + '\n', m.end() < len(text.rstrip('\n'))
        fence = [mm.start() for mm in re.finditer(r'^```', text, re.M)]
        if len(fence) >= 2 and len(fence) % 2 == 0:
            end = text.find('\n', fence[-1])
            end = len(text) if end < 0 else end + 1
            return text[:end], end < len(text.rstrip('\n'))
        return text, False
    return text, False


def split_output(segs, output):
    """Attribute the combined stdout of one command to its ss segments.

    segs   segments from parse_command (all kinds, in order)
    output the tool_result text of the whole command
    Returns list aligned to `segs`: None for non-ss segments, else dict(text, boundary) with
    boundary in: exact | single | trimmed | heuristic | ambiguous | unmatched
    """
    res = [None] * len(segs)
    ss_idx = [i for i, s in enumerate(segs) if s['kind'] == 'ss']
    if not ss_idx:
        return res
    output = output or ''
    # marker positions of all types
    found = []
    for tool, rx in MARKERS.items():
        for m in rx.finditer(output):
            found.append((m.start(), tool))
    found.sort()
    exp = [segs[i]['tool'] for i in ss_idx]
    # trailing non-ss segments after the k-th ss segment => its tail may be contaminated
    def foreign_after(i):
        return any(segs[j]['kind'] not in ('ss', 'ss-sub') and segs[j]['tool'] not in ('cd', 'export', 'set', 'true', ':') for j in range(i + 1, len(segs)))
    def piped(i):
        return segs[i]['piped']
    # order-preserving alignment of the expected ss segments to the found markers (dynamic programming).
    # A pair needs the same tool; it scores 2 when the header also names the segment's file / pattern / query
    # (or the segment is not checkable) and 0.5 when it does not. A failing command (no marker) is then left
    # unmatched instead of stealing the marker of the next command of the same tool.
    def header_at(pos_):
        e = output.find('\n', pos_)
        return output[pos_:e if e >= 0 else len(output)]

    def compatible(seg, hdr):
        ws = _words(seg['text'])
        pos_args = [w for w in ws[1:] if not w.startswith('-')]
        if not pos_args or any('$' in w or '`' in w for w in pos_args[:1]):
            return True
        a0 = pos_args[0]
        t = seg['tool']
        if t in ('ss-read', 'ss-semantic'):
            return os.path.basename(a0.rstrip('/')) in hdr
        if t == 'ss-grep':
            compact = lambda x: re.sub(r'\s+', '', x)
            return compact(a0) in compact(hdr) or compact(a0.replace('\\\\', '\\')) in compact(hdr) or any(w.startswith('-F') or w == '--fixed-strings' for w in ws)
        if t == 'ss-find':
            return a0 in hdr
        return True

    NEG = -1e9
    E, M = len(exp), len(found)
    sc = [[0.0] * (M + 1) for _ in range(E + 1)]
    bk = [[None] * (M + 1) for _ in range(E + 1)]
    for i_ in range(1, E + 1):
        for j_ in range(1, M + 1):
            best, how = sc[i_ - 1][j_], 'e'          # leave expected i_ unmatched
            if sc[i_][j_ - 1] > best:
                best, how = sc[i_][j_ - 1], 'm'      # skip marker j_
            if found[j_ - 1][1] == exp[i_ - 1]:
                seg_ = segs[ss_idx[i_ - 1]]
                v = sc[i_ - 1][j_ - 1] + (2.0 if compatible(seg_, header_at(found[j_ - 1][0])) else 0.5)
                if v > best:
                    best, how = v, 'd'
            sc[i_][j_], bk[i_][j_] = best, how
    pos = [None] * E
    i_, j_ = E, M
    while i_ > 0 and j_ > 0:
        how = bk[i_][j_]
        if how == 'd':
            pos[i_ - 1] = j_ - 1
            i_ -= 1
            j_ -= 1
        elif how == 'e':
            i_ -= 1
        else:
            j_ -= 1
    ok_all = all(p_ is not None for p_ in pos)
    exact_types = [t for _, t in found] == exp and ok_all
    for k, i in enumerate(ss_idx):
        fi = pos[k]
        if fi is None:
            res[i] = {'text': '', 'boundary': 'unmatched'}
            continue
        start = found[fi][0]
        nxt = found[pos[k + 1]][0] if k + 1 < len(ss_idx) and pos[k + 1] is not None else None
        # next marker of ANY type bounds the text (a later foreign marker is another tool's output)
        any_next = found[fi + 1][0] if fi + 1 < len(found) else None
        if nxt is not None:
            end = nxt
        elif any_next is not None and not ok_all:
            end = any_next
        else:
            end = len(output)
        text = output[start:end]
        boundary = 'exact' if exact_types else ('single' if len(ss_idx) == 1 and ok_all else 'ambiguous')
        if foreign_after(i) or (piped(i) and False):
            t2, trimmed = _trim_tail(segs[i]['tool'], text)
            text = t2
            boundary = 'trimmed' if trimmed else ('heuristic' if boundary == 'exact' else boundary)
        res[i] = {'text': text, 'boundary': boundary}
    # ss segments with no marker at all: an error text, a header removed by a pipe filter, or output never produced
    for k, i in enumerate(ss_idx):
        if res[i]['boundary'] != 'unmatched':
            continue
        others = [s for s in segs if s['kind'] not in ('ss', 'ss-sub', 'none') and s['tool'] not in _NOOUT]
        err = [ln for ln in output.split('\n') if re.match(r'\[ss(?:-\w+|\*)?\] |Usage: ss-|Script error', ln)]
        if len(ss_idx) == 1:
            if segs[i]['piped']:
                res[i] = {'text': '' if others else output, 'boundary': 'piped-unknown' if others else 'piped-filtered'}
            elif others:
                res[i] = {'text': '\n'.join(err) + ('\n' if err else ''), 'boundary': 'single-nomarker' if err else 'unmatched'}
            else:
                res[i] = {'text': output, 'boundary': 'single-nomarker'}
        else:
            if err and not segs[i]['piped']:
                res[i] = {'text': '\n'.join(err) + '\n', 'boundary': 'ambiguous-error'}
                # the error lines were printed in the middle of a neighbour's span: take them out of it
                for j in ss_idx:
                    if j != i and res[j]['boundary'] != 'ambiguous-error':
                        for ln in err:
                            res[j]['text'] = res[j]['text'].replace(ln + '\n', '', 1)
    return res


_NOOUT = {'cd', 'export', 'set', 'true', ':', 'unset', 'mkdir', 'rm', 'mv', 'cp', 'touch', 'chmod', 'sleep', 'trap'}


# ----------------------------------------------------------------------------------------------
# 3. harness readers
# ----------------------------------------------------------------------------------------------
def _txt(content):
    if content is None:
        return ''
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for b in content:
            if isinstance(b, dict):
                if b.get('type') == 'text':
                    out.append(b.get('text', ''))
                elif b.get('type') in ('image',):
                    out.append('[image]')
                elif 'text' in b:
                    out.append(str(b['text']))
            else:
                out.append(str(b))
        return '\n'.join(out)
    return str(content)


def _jl(path):
    out = []
    with open(path, encoding='utf-8', errors='replace') as fh:
        for ln in fh:
            ln = ln.strip()
            if ln:
                try:
                    out.append(json.loads(ln))
                except Exception:
                    pass
    return out


def native_unit(harness, name, inp):
    """Classify a harness-native (non-Bash) tool call -> (kind, tool, argText)."""
    name_l = (name or '').lower()
    inp = inp or {}
    path = inp.get('file_path') or inp.get('filePath') or inp.get('path') or ''
    if name_l in ('read', 'notebookread'):
        extra = ''
        if inp.get('offset') is not None or inp.get('limit') is not None or inp.get('startLine') is not None:
            extra = ' ' + json.dumps({k: inp[k] for k in ('offset', 'limit', 'startLine', 'endLine') if k in inp})
        return 'native-read', name, f'{path}{extra}'
    if name_l in ('grep',):
        return 'native-search', name, json.dumps(inp, ensure_ascii=False)[:600]
    if name_l in ('glob', 'list', 'ls'):
        return 'native-search', name, json.dumps(inp, ensure_ascii=False)[:600]
    if name_l in ('edit', 'write', 'multiedit', 'notebookedit', 'apply_patch', 'patch'):
        return 'edit', name, path or json.dumps(inp, ensure_ascii=False)[:300]
    return 'other', name, json.dumps(inp, ensure_ascii=False)[:300]


def _claude_file(path, default_thread):
    rows = _jl(path)
    results = {}
    for d in rows:
        if d.get('type') == 'user' and isinstance(d.get('message', {}).get('content'), list):
            for b in d['message']['content']:
                if isinstance(b, dict) and b.get('type') == 'tool_result':
                    results[b.get('tool_use_id')] = (_txt(b.get('content')), bool(b.get('is_error')))
    reqs = OrderedDict()
    for d in rows:
        if d.get('type') != 'assistant':
            continue
        msg = d.get('message') or {}
        mid = msg.get('id')
        rq = reqs.get(mid)
        if rq is None:
            rq = reqs[mid] = {'id': mid, 'text': '', 'thinking': '', 'units': [], 'ts': d.get('timestamp'), 'model': msg.get('model')}
        for b in msg.get('content') or []:
            bt = b.get('type')
            if bt == 'text':
                rq['text'] += (('\n\n' if rq['text'] else '') + b.get('text', ''))
            elif bt == 'thinking':
                if b.get('thinking'):
                    rq['thinking'] += (('\n\n' if rq['thinking'] else '') + b['thinking'])
            elif bt == 'tool_use':
                if any(u['id'] == b['id'] for u in rq['units']):
                    continue
                out, err = results.get(b['id'], (None, False))
                name = b.get('name')
                inp = b.get('input') or {}
                persisted = bool(out) and out.lstrip().startswith('<persisted-output>')
                if name == 'Bash':
                    rq['units'].append({'id': b['id'], 'harnessTool': 'Bash', 'commands': [inp.get('command', '')], 'output': out, 'isError': err, 'perCmdOutputs': None, 'persisted': persisted})
                else:
                    kind, tool, argt = native_unit('claude', name, inp)
                    rq['units'].append({'id': b['id'], 'harnessTool': name, 'native': (kind, tool, argt), 'output': out, 'isError': err, 'persisted': persisted})
    return {'thread': default_thread, 'requests': list(reqs.values())}


def read_claude(path):
    """Claude Code session JSONL -> list of threads. One request = one assistant message.id.
    Sub-agent sessions live in <session>/subagents/agent-*.jsonl and become side threads."""
    threads = [_claude_file(path, 'main')]
    sub = os.path.join(os.path.splitext(path)[0], 'subagents')
    if os.path.isdir(sub):
        for f in sorted(glob.glob(os.path.join(sub, 'agent-*.jsonl'))):
            aid = os.path.basename(f)[len('agent-'):-len('.jsonl')]
            th = _claude_file(f, 'side:' + aid[:8])
            if th['requests']:
                meta = f[:-len('.jsonl')] + '.meta.json'
                try:
                    th['meta'] = json.load(open(meta))
                except Exception:
                    pass
                threads.append(th)
    return threads


# --- codex ------------------------------------------------------------------------------------
def _decode_js_string(lit):
    body = lit[1:-1]
    out = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch != '\\':
            out.append(ch)
            i += 1
            continue
        i += 1
        if i >= len(body):
            break
        n = body[i]
        if n == 'n':
            out.append('\n')
        elif n == 't':
            out.append('\t')
        elif n == 'r':
            out.append('\r')
        elif n == 'u':
            out.append(chr(int(body[i + 1:i + 5], 16)))
            i += 4
        elif n == 'x':
            out.append(chr(int(body[i + 1:i + 3], 16)))
            i += 2
        elif n == '\n':
            pass
        else:
            out.append(n)
        i += 1
    return ''.join(out)


def cmds_from_js(src):
    out = []
    for m in re.finditer(r'\bcmd\s*:\s*', src):
        j = m.end()
        if j >= len(src) or src[j] not in '"\'`':
            continue
        q = src[j]
        k = j + 1
        while k < len(src) and src[k] != q:
            k += 2 if src[k] == '\\' else 1
        try:
            out.append(_decode_js_string(src[j:k + 1]))
        except Exception:
            out.append(src[j + 1:k])
    return out


def _parts(output):
    """Output of custom_tool_call_output / function_call_output -> (header, [parts])."""
    if isinstance(output, str):
        if '\nOutput:\n' in output:
            h, _, rest = output.partition('\nOutput:\n')
            return h + '\nOutput:\n', [rest] if rest else []
        return output, []
    parts = [(x.get('text') if isinstance(x, dict) else str(x)) or '' for x in output or []]
    if not parts:
        return '', []
    return parts[0], parts[1:]


def read_codex(path):
    L = _jl(path)
    cells = OrderedDict()  # call_id -> cell
    waits = {}  # call_id -> (cell_id, ...)
    wait_turn = {}  # wait call_id -> 1-based turn of the request that issued the wait
    cell_by_id = {}  # 'cell ID n' -> cell
    pending = {'text': '', 'thinking': '', 'units': []}
    requests = []
    last_ts = None
    meta = {}
    for o in L:
        t = o.get('type')
        p = o.get('payload') or {}
        pt = p.get('type')
        if t == 'session_meta':
            meta = p
        if t == 'response_item':
            if pt == 'message' and p.get('role') == 'assistant':
                txt = ''.join((c.get('text') or '') for c in p.get('content') or [])
                pending['text'] += (('\n\n' if pending['text'] else '') + txt)
            elif pt == 'reasoning':
                s = ' '.join((x.get('text') or '') for x in (p.get('summary') or []) if isinstance(x, dict))
                c = p.get('content')
                if isinstance(c, list):
                    s += ' '.join((x.get('text') or '') for x in c if isinstance(x, dict))
                if s.strip():
                    pending['thinking'] += (('\n\n' if pending['thinking'] else '') + s.strip())
            elif pt == 'custom_tool_call':
                cmds = cmds_from_js(p.get('input') or '') if p.get('name') == 'exec' else []
                unit = {'id': p.get('call_id'), 'harnessTool': p.get('name'),
                        'commands': cmds if cmds else [p.get('input') or ''], 'jsSource': (p.get('input') or '')[:1500],
                        'output': None, 'isError': False, 'perCmdOutputs': None, 'headers': [], 'parts': [], 'cellIds': []}
                if not cmds:
                    unit['noCmd'] = True
                cells[p['call_id']] = unit
                pending['units'].append(unit)
            elif pt == 'custom_tool_call_output':
                u = cells.get(p.get('call_id'))
                if u is not None:
                    h, parts = _parts(p.get('output'))
                    u['headers'].append(h)
                    u['parts'].extend(parts)
                    m = re.search(r'cell ID (\d+)', h)
                    if m and 'running' in h.split('\n')[0]:
                        cell_by_id[m.group(1)] = u
                    if h.startswith('Script failed'):
                        u['isError'] = True
            elif pt == 'function_call':
                if p.get('name') == 'wait':
                    try:
                        a = json.loads(p.get('arguments') or '{}')
                    except Exception:
                        a = {}
                    waits[p.get('call_id')] = str(a.get('cell_id'))
                    wait_turn[p.get('call_id')] = len(requests) + 1
                    pending['units'].append({'id': p.get('call_id'), 'harnessTool': 'wait', 'wait': True, 'commands': [], 'output': None, 'isError': False})
                else:
                    pending['units'].append({'id': p.get('call_id'), 'harnessTool': p.get('name'), 'commands': [p.get('arguments') or ''], 'output': None, 'isError': False, 'perCmdOutputs': None, 'headers': [], 'parts': []})
                    cells[p.get('call_id')] = pending['units'][-1]
            elif pt == 'function_call_output':
                cid = waits.get(p.get('call_id'))
                h, parts = _parts(p.get('output'))
                u = cell_by_id.get(cid) if cid is not None else None
                if u is not None:
                    u['headers'].append(h)
                    if any(x.strip() for x in parts):
                        u['deliveredTurn'] = wait_turn.get(p.get('call_id'))
                    u['parts'].extend(parts)
                    if h.startswith('Script failed'):
                        u['isError'] = True
                    if 'running' not in h.split('\n')[0]:
                        cell_by_id.pop(cid, None)
                elif p.get('call_id') in cells:
                    cu = cells[p['call_id']]
                    cu['headers'].append(h)
                    cu['parts'].extend(parts)
        elif t == 'event_msg' and pt == 'token_count' and (p.get('info') or {}).get('last_token_usage'):
            u = p['info']['last_token_usage']
            requests.append({'id': 'req%d' % len(requests), 'text': pending['text'], 'thinking': pending['thinking'],
                             'units': pending['units'], 'ts': o.get('timestamp'), 'usage': u})
            pending = {'text': '', 'thinking': '', 'units': []}
    if pending['text'] or pending['units'] or pending['thinking']:
        requests.append({'id': 'req%d' % len(requests), 'text': pending['text'], 'thinking': pending['thinking'], 'units': pending['units'], 'ts': None, 'usage': None, 'tail': True})
    # finalize units: output assembly. Parts printed by the model's own text() calls (a
    # <state_summary> note, a stray `{}`) are not tool output: they are split off first.
    for rq in requests:
        for u in rq['units']:
            if u.get('wait'):
                continue
            raw = u.get('parts') or []
            parts, notes = [], []
            for ptxt in raw:
                st = ptxt.strip()
                if st in ('{}', 'undefined', 'null', ''):
                    continue
                if st.startswith('<state_summary>'):
                    m = re.match(r'(?s)\s*<state_summary>(.*?)</state_summary>(.*)$', ptxt)
                    if m:
                        notes.append(m.group(1).strip())
                        if m.group(2).strip():
                            parts.append(m.group(2))
                        continue
                parts.append(ptxt)
            cmds = u.get('commands') or []
            if len(cmds) > 1 and len(parts) == len(cmds):
                u['perCmdOutputs'] = parts
            joined = ''
            for ptxt in parts:
                joined += ('' if (not joined or joined.endswith('\n')) else '\n') + ptxt
            u['output'] = joined
            u['modelNotes'] = notes
            hs = u.get('headers') or []
            u['neverCollected'] = bool(hs) and all(h.split('\n')[0].startswith('Script running') for h in hs) and not parts
            if any(h.startswith('Script failed') for h in hs):
                u['isError'] = True
        # model-authored notes count as the agent's own text of this response
        for u in rq['units']:
            for note in u.get('modelNotes') or []:
                rq['text'] += (('\n\n' if rq['text'] else '') + '[state_summary] ' + note)
    # drop wait units from the call lists (their output is merged into the exec cell)
    for rq in requests:
        rq['units'] = [u for u in rq['units'] if not u.get('wait')]
    return [{'thread': 'main', 'requests': requests, 'meta': meta}]


# --- opencode ---------------------------------------------------------------------------------
def _copy_db(db_dir):
    tmp = tempfile.mkdtemp(prefix='ocdb')
    for fn in ('opencode.db', 'opencode.db-wal', 'opencode.db-shm'):
        s = os.path.join(db_dir, fn)
        if os.path.exists(s):
            shutil.copy(s, os.path.join(tmp, fn))
    return tmp


def read_opencode(db_dir):
    tmp = _copy_db(db_dir)
    try:
        db = sqlite3.connect(os.path.join(tmp, 'opencode.db'))
        sessions = db.execute('select id,parent_id,time_created from session order by time_created').fetchall()
        threads = []
        for sid, parent, tc in sessions:
            msgs = db.execute('select id,time_created,data from message where session_id=? order by time_created,id', (sid,)).fetchall()
            parts_by = {}
            for pid, mid, ptc, data in db.execute('select id,message_id,time_created,data from part where session_id=? order by time_created,id', (sid,)):
                try:
                    parts_by.setdefault(mid, []).append(json.loads(data))
                except Exception:
                    pass
            requests = []
            for mid, mtc, data in msgs:
                try:
                    md = json.loads(data)
                except Exception:
                    continue
                if md.get('role') != 'assistant':
                    continue
                rq = {'id': mid, 'text': '', 'thinking': '', 'units': [], 'ts': mtc, 'model': md.get('modelID'), 'tokens': md.get('tokens'), 'cost': md.get('cost'),
                      'summaryMsg': bool(md.get('summary'))}
                for pj in parts_by.get(mid, []):
                    pt = pj.get('type')
                    if pt == 'text':
                        rq['text'] += (('\n\n' if rq['text'] else '') + (pj.get('text') or ''))
                    elif pt == 'reasoning':
                        if pj.get('text'):
                            rq['thinking'] += (('\n\n' if rq['thinking'] else '') + pj['text'])
                    elif pt == 'tool':
                        st = pj.get('state') or {}
                        name = pj.get('tool')
                        inp = st.get('input') or {}
                        out = st.get('output')
                        err = st.get('status') == 'error'
                        if name == 'bash':
                            rq['units'].append({'id': pj.get('callID'), 'harnessTool': 'bash', 'commands': [inp.get('command', '')], 'output': out if isinstance(out, str) else ('' if out is None else json.dumps(out)), 'isError': err, 'perCmdOutputs': None})
                        else:
                            kind, tool, argt = native_unit('opencode', name, inp)
                            rq['units'].append({'id': pj.get('callID'), 'harnessTool': name, 'native': (kind, tool, argt), 'output': out if isinstance(out, str) else ('' if out is None else json.dumps(out)), 'isError': err})
                requests.append(rq)
            threads.append({'thread': 'main' if not parent else 'side:' + sid[-6:], 'sessionId': sid, 'parent': parent, 'requests': requests, 'tc': tc})
        db.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # root first
    threads.sort(key=lambda t: (t['thread'] != 'main', t['tc']))
    return threads


# ----------------------------------------------------------------------------------------------
# 4. run discovery
# ----------------------------------------------------------------------------------------------
PRIVATE_RESULTS = '/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/results'
WT_RESULTS = '/Users/admin/Projects/sweet-search-final-tuning/eval/task-completion-bench/results'


def _is_ho2(name, rows_text):
    s = (name + ' ' + rows_text[:20000000]).lower()
    return 'heldout2' in s or re.search(r'\bho2\b', s) is not None


def discover_runs():
    """Return list of run descriptors for the studied folders (rows.json present, agent-state present)."""
    runs = []
    skipped = []

    def add(base, group, role_by_run=None):
        for d in sorted(glob.glob(os.path.join(base, '*'))):
            if not os.path.isdir(d):
                continue
            name = os.path.basename(d)
            rj = os.path.join(d, 'rows.json')
            if not os.path.exists(rj):
                continue
            if not os.path.isdir(os.path.join(d, 'agent-state')):
                skipped.append((name, 'no agent-state'))
                continue
            txt = open(rj, encoding='utf-8').read()
            if _is_ho2(name, txt):
                skipped.append((name, 'HO2 marker'))
                continue
            runs.append({'run': name, 'dir': d, 'group': group, 'rows': json.loads(txt)})

    for pat in ('tg-20261001-0440-L*', 'tg-20261001-0657-v2-L*'):
        for d in sorted(glob.glob(os.path.join(WT_RESULTS, pat))):
            if os.path.isdir(d) and os.path.exists(os.path.join(d, 'rows.json')):
                name = os.path.basename(d)
                txt = open(os.path.join(d, 'rows.json'), encoding='utf-8').read()
                if _is_ho2(name, txt):
                    skipped.append((name, 'HO2 marker'))
                    continue
                runs.append({'run': name, 'dir': d, 'group': 'tg', 'rows': json.loads(txt)})
    for pat in ('hc-*-2026092[9]-*', 'hc-*-20260930-*'):
        for d in sorted(glob.glob(os.path.join(PRIVATE_RESULTS, pat))):
            if os.path.isdir(d) and os.path.exists(os.path.join(d, 'rows.json')):
                name = os.path.basename(d)
                txt = open(os.path.join(d, 'rows.json'), encoding='utf-8').read()
                if _is_ho2(name, txt):
                    skipped.append((name, 'HO2 marker'))
                    continue
                runs.append({'run': name, 'dir': d, 'group': 'hc', 'rows': json.loads(txt)})
    for d in sorted(glob.glob(os.path.join(PRIVATE_RESULTS, 'hsmoke-*'))):
        if not os.path.isdir(d) or not os.path.exists(os.path.join(d, 'rows.json')):
            continue
        name = os.path.basename(d)
        if not os.path.isdir(os.path.join(d, 'agent-state')):
            skipped.append((name, 'no agent-state'))
            continue
        txt = open(os.path.join(d, 'rows.json'), encoding='utf-8').read()
        if _is_ho2(name, txt):
            skipped.append((name, 'HO2 marker'))
            continue
        runs.append({'run': name, 'dir': d, 'group': 'hsmoke', 'rows': json.loads(txt)})
    return runs, skipped


def tg_roles():
    """tg manifests -> {run: (role, leg, rep)}"""
    out = {}
    for mf in glob.glob(os.path.join(WT_RESULTS, 'tg-*.manifest')):
        for ln in open(mf):
            w = ln.split()
            if len(w) >= 4:
                out[w[0]] = (w[1], w[2], w[3])
    return out
