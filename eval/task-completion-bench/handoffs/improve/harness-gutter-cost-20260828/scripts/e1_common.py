#!/usr/bin/env python3
"""E1 common: fresh-pool (epoch C) run map, per-harness trace parsing WITH turn indexing
and per-turn usage, edit detection for all three harnesses, failure classification, and
the gutter regexes. Read-only; nothing under results/ is written.

Adapted from /tmp/gutter-inv/{census,forensics,provenance}.py (written for the 2026-08-25
runs). Changes: fp-*/rp-* run ids, the opencode repair-pass substitution, codex
function_call/function_call_output records (the 08-11 custom_tool_call shape is still
accepted), turn indices + per-turn token usage on every event, shell-edit mechanisms
beyond apply_patch (sed -i, python rewrite, cat > file, git apply), and the third gutter
regex `^\\d+: `.
"""
import json, os, re, sys, collections

R = '/root/sweet-search-private/eval/task-completion-bench/results'
GOLDEN = '/root/.ss-eval/golden'
TASKS = '/root/sweet-search-private/eval/task-completion-bench/select/.cache/tasks_full_heldout.json'
POOL = '/root/fresh-run/pool.txt'
REPAIR = '/root/fresh-run/repair-tasks.txt'

# harness -> form -> run id holding the SWEET arm
SWEET_RUNS = {
    'codex':    {'tab': 'fp-codex-tab-20260826',   'none': 'fp-codex-none-20260826',   'pipe': 'fp-codex-pipe-20260826'},
    'opencode': {'tab': 'fp-opencode-tab-20260826','none': 'fp-opencode-none-20260826','pipe': 'fp-opencode-pipe-20260826'},
    'claude':   {'tab': 'fp-claudecode-tab-20260826','none':'fp-claudecode-none-20260826','pipe':'fp-claudecode-pipe-20260826'},
}
# opencode SWEET rows for the 11 repair tasks come from the CONCURRENCY=1 repair pass
REPAIR_RUNS = {'tab': 'rp-oc-tab-20260827', 'none': 'rp-oc-none-20260827', 'pipe': 'rp-oc-pipe-20260827'}
# the native arm only exists in the *-tab-* runs (native never calls ss-read, so it is
# form-independent: one native cell per harness)
NATIVE_RUNS = {'codex': 'fp-codex-tab-20260826', 'opencode': 'fp-opencode-tab-20260826',
               'claude': 'fp-claudecode-tab-20260826'}
FORMS = ('tab', 'none', 'pipe')
HARNESSES = ('codex', 'opencode', 'claude')

PRICE = {'in': 0.10, 'cache': 0.01, 'out': 0.60}   # $/M, openai/gpt-5.6-luna via OpenRouter


def pool():
    return [l.strip() for l in open(POOL) if l.strip()]


def repair_tasks():
    return set(l.strip() for l in open(REPAIR) if l.strip())


def cells():
    """yield dicts describing every (harness, arm, form, task) cell of the fresh pool.
    arm='native' is emitted once per harness with form='-'."""
    P, RP = pool(), repair_tasks()
    for h in HARNESSES:
        for t in P:
            yield {'harness': h, 'arm': 'native', 'form': '-', 'task': t,
                   'run': NATIVE_RUNS[h], 'cell': f'{t}-native'}
        for form in FORMS:
            for t in P:
                run = REPAIR_RUNS[form] if (h == 'opencode' and t in RP) else SWEET_RUNS[h][form]
                yield {'harness': h, 'arm': 'sweet', 'form': form, 'task': t,
                       'run': run, 'cell': f'{t}-sweet'}


# --------------------------------------------------------------------------- io
def jsonl(path):
    with open(path, encoding='utf8', errors='replace') as fh:
        for line in fh:
            line = line.strip()
            if not line or line[0] != '{':
                continue
            try:
                yield json.loads(line)
            except Exception:
                continue


def text_of(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return '\n'.join((x.get('text') or '') if isinstance(x, dict) else str(x) for x in c)
    if c is None:
        return ''
    return json.dumps(c)


def transcripts(run, harness, cell):
    """[(main_path, [subagent paths])] for one cell, unsorted."""
    d = os.path.join(R, run, 'agent-state', cell)
    if not os.path.isdir(d):
        return []
    out = []
    if harness == 'codex':
        for root, _, files in os.walk(d):
            for f in files:
                if re.match(r'rollout-.*\.jsonl$', f):
                    out.append((os.path.join(root, f), []))
    elif harness == 'opencode':
        for root, _, files in os.walk(d):
            for f in files:
                if f == 'attempt-1.stdout.ndjson':
                    out.append((os.path.join(root, f), []))
    else:
        for root, _, files in os.walk(d):
            if '/claude-home/projects/' not in root + '/' or '/subagents' in root:
                continue
            for f in files:
                if f.endswith('.jsonl'):
                    main = os.path.join(root, f)
                    sub = os.path.join(root, f[:-6], 'subagents')
                    subs = []
                    if os.path.isdir(sub):
                        subs = [os.path.join(sub, x) for x in sorted(os.listdir(sub)) if x.endswith('.jsonl')]
                    out.append((main, subs))
    return out


# ------------------------------------------------------------------- parsing
def events_codex(path):
    """(events, turns). events carry 'turn' = index into turns of the model request that
    EMITTED the call (a token_count record closes each request)."""
    ev, turns, calls = [], [], {}
    nt = 0
    for d in jsonl(path):
        p = d.get('payload') or {}
        t = p.get('type') or d.get('type')
        if t == 'token_count':
            u = ((p.get('info') or {}).get('last_token_usage')) or {}
            turns.append({'in': u.get('input_tokens', 0) or 0,
                          'cached': u.get('cached_input_tokens', 0) or 0,
                          'out': (u.get('output_tokens', 0) or 0) + (u.get('reasoning_output_tokens', 0) or 0),
                          'outRaw': u.get('output_tokens', 0) or 0,
                          'reasoning': u.get('reasoning_output_tokens', 0) or 0})
            nt += 1
        elif t in ('function_call', 'custom_tool_call'):
            args = p.get('arguments') if 'arguments' in p else p.get('input')
            try:
                inp = json.loads(args) if isinstance(args, str) else (args or {})
            except Exception:
                inp = {'raw': args}
            if not isinstance(inp, dict):
                inp = {'raw': inp}
            cid = p.get('call_id') or p.get('id')
            calls[cid] = (p.get('name'), inp)
            ev.append({'kind': 'call', 'tool': p.get('name'), 'input': inp, 'id': cid, 'turn': nt})
        elif t in ('function_call_output', 'custom_tool_call_output'):
            cid = p.get('call_id')
            name, inp = calls.get(cid, (None, {}))
            ev.append({'kind': 'result', 'tool': name, 'input': inp, 'id': cid,
                       'output': text_of(p.get('output')), 'turn': nt})
        elif t == 'patch_apply_end':
            ev.append({'kind': 'patch_apply_end', 'id': p.get('call_id'), 'success': p.get('success'),
                       'stdout': p.get('stdout') or '', 'stderr': p.get('stderr') or '',
                       'changes': p.get('changes') or {}, 'turn': nt})
    return ev, turns


def events_opencode(path):
    ev, turns = [], []
    nt = 0
    for d in jsonl(path):
        ty = d.get('type')
        p = d.get('part') or {}
        if ty in ('step_finish', 'step-finish'):
            tk = p.get('tokens') or {}
            ca = tk.get('cache') or {}
            cr, cw = ca.get('read', 0) or 0, ca.get('write', 0) or 0
            turns.append({'in': (tk.get('input', 0) or 0) + cr + cw, 'cached': cr,
                          'out': (tk.get('output', 0) or 0) + (tk.get('reasoning', 0) or 0),
                          'outRaw': tk.get('output', 0) or 0, 'reasoning': tk.get('reasoning', 0) or 0})
            nt += 1
        elif ty == 'tool_use':
            st = p.get('state') or {}
            inp = st.get('input') or {}
            if not isinstance(inp, dict):
                inp = {'raw': inp}
            out = text_of(st.get('output'))
            if st.get('status') == 'error':
                out = text_of(st.get('error') or st.get('output'))
            ev.append({'kind': 'call', 'tool': p.get('tool'), 'input': inp, 'id': p.get('callID'), 'turn': nt})
            ev.append({'kind': 'result', 'tool': p.get('tool'), 'input': inp, 'id': p.get('callID'),
                       'output': out, 'status': st.get('status'), 'turn': nt})
    return ev, turns


def events_claude(path):
    """Dedupe by message id (one served request = many records); take the usage-bearing
    record. Blocks are UNIONED by tool_use.id / tool_result.tool_use_id."""
    order, byid = [], {}
    results = []          # (record order, tool_use_id, output, is_error)
    seen_res = set()
    for d in jsonl(path):
        m = d.get('message')
        if not m:
            continue
        if m.get('role') == 'assistant' and m.get('id'):
            g = byid.get(m['id'])
            if g is None:
                g = {'blocks': [], 'ids': set(), 'usage': None, 'best': -1}
                byid[m['id']] = g
                order.append(m['id'])
            for b in (m.get('content') if isinstance(m.get('content'), list) else []):
                if b.get('type') == 'tool_use' and b.get('id'):
                    if b['id'] in g['ids']:
                        continue
                    g['ids'].add(b['id'])
                g['blocks'].append(b)
            u = m.get('usage')
            if u:
                cached = u.get('cache_read_input_tokens', 0) or 0
                cw = u.get('cache_creation_input_tokens', 0) or 0
                inn = (u.get('input_tokens', 0) or 0) + cached + cw
                out = u.get('output_tokens', 0) or 0
                if inn + out > g['best']:
                    g['best'] = inn + out
                    g['usage'] = {'in': inn, 'cached': cached, 'cacheWrite': cw, 'out': out,
                                  'outRaw': out, 'reasoning': 0}
        elif m.get('role') == 'user':
            for b in (m.get('content') if isinstance(m.get('content'), list) else []):
                if b.get('type') == 'tool_result':
                    k = b.get('tool_use_id')
                    if k in seen_res:
                        continue
                    seen_res.add(k)
                    results.append((k, text_of(b.get('content')), bool(b.get('is_error'))))
    turns, ev = [], []
    turn_of_msg = {}
    for mid in order:
        g = byid[mid]
        u = g['usage']
        if u and (u['in'] or u['out']):
            turn_of_msg[mid] = len(turns)
            turns.append(u)
        else:
            turn_of_msg[mid] = len(turns)   # attribute to the next priced request
    uses = {}
    for mid in order:
        for b in byid[mid]['blocks']:
            if b.get('type') == 'tool_use':
                uses[b['id']] = (b.get('name'), b.get('input') or {})
                ev.append({'kind': 'call', 'tool': b.get('name'), 'input': b.get('input') or {},
                           'id': b['id'], 'turn': turn_of_msg[mid]})
    pos = {e['id']: i for i, e in enumerate(ev)}
    for k, out, err in results:
        name, inp = uses.get(k, (None, {}))
        ev.append({'kind': 'result', 'tool': name, 'input': inp, 'id': k, 'output': out,
                   'is_error': err, 'turn': ev[pos[k]]['turn'] if k in pos else 0, '_after': pos.get(k, -1)})
    # interleave results right after their call, preserving call order
    out_ev = []
    by_call = collections.defaultdict(list)
    for e in ev:
        if e['kind'] == 'result':
            by_call[e['id']].append(e)
    for e in ev:
        if e['kind'] != 'call':
            continue
        out_ev.append(e)
        out_ev.extend(by_call.get(e['id'], []))
    return out_ev, turns


PARSERS = {'codex': events_codex, 'opencode': events_opencode, 'claude': events_claude}


# ---------------------------------------------------------------------- cost
def turn_costs(turns, price=PRICE):
    """ideal (cache-normalised) $ per turn, the harness costFromTurns idealUsd formula."""
    out, prev = [], 0
    for tu in turns:
        newin = max(0, tu['in'] - prev)
        resent = tu['in'] - newin
        usd = (newin * price['in'] + resent * price['cache'] + tu['out'] * price['out']) / 1e6
        out.append({'newIn': newin, 'resent': resent, 'out': tu['out'], 'in': tu['in'], 'usd': usd})
        prev = tu['in']
    return out


# ----------------------------------------------------------- edit mechanisms
AP_HEREDOC = re.compile(r'apply_patch\s*<<')
AP_PLAIN = re.compile(r'(^|[;&|]\s*|\n\s*)apply_patch\b')
SED_I = re.compile(r'\bsed\b[^\n;&|]*?\s-i(\.\w+)?\b')
PERL_I = re.compile(r'\bperl\b[^\n;&|]*?\s-[a-zA-Z]*i')
GIT_APPLY = re.compile(r'\bgit\s+apply\b|\bpatch\s+-p\d')
PY_WRITE = re.compile(r"open\([^)]*['\"][wa]['\"]|\.write_text\(|\.writelines\(|\bf\.write\(|>\s*\S+\s*<<|sys\.stdout")
PY_CALL = re.compile(r'\bpython3?\b[^\n]*(-c|<<|-\s*$)')
CAT_WRITE = re.compile(r'\b(cat|tee|printf|echo)\b[^\n]*?>>?\s*(?!/dev/null)[\w./$~-]+')
REDIR_SRC = re.compile(r'>>?\s*(?!/dev/null|/tmp/)[\w./$~-]+\.(py|js|mjs|cjs|ts|tsx|jsx|go|java|rb|r|R|cs|php|cpp|cc|c|h|hpp|jam|json|ya?ml|sol|ex|exs|kt|swift|rs|scala|m|md|txt|xml|toml|cfg|ini)\b')
MV_CP = re.compile(r'\b(mv|cp)\s+[^\n]*\.(py|js|ts|go|java|rb|cs|php|cpp|c|h|jam|json|ya?ml)\b')


def shell_edit_kind(cmd):
    """classify a shell command as an edit mechanism, or None."""
    if not cmd:
        return None
    if AP_HEREDOC.search(cmd):
        return 'apply_patch-heredoc'
    if AP_PLAIN.search(cmd) and 'Begin Patch' in cmd:
        return 'apply_patch-inline'
    if GIT_APPLY.search(cmd):
        return 'git-apply/patch'
    if SED_I.search(cmd):
        return 'sed -i'
    if PERL_I.search(cmd):
        return 'perl -i'
    if PY_CALL.search(cmd) and PY_WRITE.search(cmd):
        return 'python-rewrite'
    if CAT_WRITE.search(cmd) and REDIR_SRC.search(cmd):
        return 'cat/tee > file'
    if REDIR_SRC.search(cmd) and not re.search(r'2>|&>', cmd):
        return 'shell-redirect > file'
    if MV_CP.search(cmd):
        return 'mv/cp'
    return None


CC_EDIT_TOOLS = {'Edit', 'MultiEdit', 'Write', 'NotebookEdit'}
OC_EDIT_TOOLS = {'apply_patch', 'edit', 'write', 'patch', 'multiedit'}


def edit_kind(harness, e):
    t = e.get('tool') or ''
    inp = e.get('input') or {}
    if harness == 'claude':
        if t in CC_EDIT_TOOLS:
            return t
        if t == 'Bash':
            return shell_edit_kind(str(inp.get('command') or ''))
        return None
    if harness == 'opencode':
        if t in OC_EDIT_TOOLS:
            return t
        if t == 'bash':
            return shell_edit_kind(str(inp.get('command') or ''))
        return None
    # codex
    if t == 'apply_patch':
        return 'apply_patch(tool)'
    if t in ('exec_command', 'shell', 'local_shell_call'):
        return shell_edit_kind(str(inp.get('cmd') or inp.get('command') or ''))
    return None


def cmd_of(harness, e):
    inp = e.get('input') or {}
    if harness == 'codex':
        return str(inp.get('cmd') or inp.get('command') or '')
    return str(inp.get('command') or inp.get('cmd') or '')


# -------------------------------------------------------- failure detection
FAIL_RX = [
    ('anchor-not-found',   re.compile(r'String to replace not found in file', re.I)),
    ('ambiguous-context',  re.compile(r'Found \d+ matches of the string to replace', re.I)),
    ('file-not-read',      re.compile(r'File has not been read yet', re.I)),
    ('modified-since-read',re.compile(r'has been modified since read', re.I)),
    ('no-op',              re.compile(r'No changes to make: old_string and new_string are exactly the same', re.I)),
    ('json-too-large',     re.compile(r'could not be parsed as JSON|InputValidationError', re.I)),
    ('ap-expected-lines',  re.compile(r'Failed to find expected lines', re.I)),
    ('ap-context',         re.compile(r'Failed to find context', re.I)),
    ('ap-verification',    re.compile(r'apply_patch verification failed', re.I)),
    ('ap-parse',           re.compile(r'Unexpected line found in update hunk|Invalid patch|Invalid hunk|Failed to parse|patch rejected', re.I)),
    ('oc-oldstring',       re.compile(r'Could not find oldString|oldString not found', re.I)),
    ('oc-multiple',        re.compile(r'Found multiple matches', re.I)),
    ('file-not-found',     re.compile(r'No such file or directory|does not exist', re.I)),
]
ANCHOR_FAIL = {'anchor-not-found', 'ap-expected-lines', 'ap-context', 'oc-oldstring', 'ap-verification'}
EXIT_RX = re.compile(r'Process exited with code (\d+)|exit code:? (\d+)')
# codex runs apply_patch inside a COMPOUND shell command; the process exit code belongs to
# the whole envelope (`rm`, `npm test`, …), not to the edit. Only these markers speak for
# the edit itself. Verified against patch_apply_end: 376/376 successes carry the Success
# line, and patch_apply_end is never emitted for a failed apply.
AP_OK = 'Success. Updated the following files'
AP_ERR = re.compile(r'apply_patch verification failed|Failed to find expected lines|'
                    r'Failed to find context|Failed to read file to update|Invalid patch|'
                    r'invalid hunk|Unexpected line found in update hunk|exec_command failed for')


def classify_failure(harness, e, ekind):
    """([class tags], is_failure). Empty tags + is_failure False means the edit stuck."""
    out = e.get('output') or ''
    tags = [k for k, rx in FAIL_RX if rx.search(out)]
    if harness == 'claude':
        if e.get('is_error') and not tags:
            tags = ['other-error']
        return tags, bool(e.get('is_error') or tags)
    if harness == 'opencode':
        if e.get('status') == 'error' and not tags:
            tags = ['other-error']
        return tags, bool(e.get('status') == 'error' or tags)
    # ---- codex
    if ekind and ekind.startswith('apply_patch'):
        fail = bool(AP_ERR.search(out))
        if not fail:
            return [], False
        tags = [k for k, rx in FAIL_RX if rx.search(out)] or ['ap-other']
        # 'file-not-found' fires on the apply_patch "No such file" wording too; keep both
        return tags, True
    m = EXIT_RX.search(out)
    code = int(m.group(1) or m.group(2)) if m else None
    fail = bool(tags) or (code not in (None, 0))
    if fail and not tags:
        tags = ['nonzero-exit']
    return tags, fail


# ------------------------------------------------------------------- anchors
def patch_chunks(patch):
    """[(file, anchor_lines, hunk_header, raw_lines)] from an apply_patch envelope."""
    out, cur = [], None
    for ln in patch.split('\n'):
        if ln.startswith('*** Update File: '):
            cur = {'file': ln[len('*** Update File: '):].strip(), 'chunks': []}
            out.append(cur)
            continue
        if ln.startswith('*** Add File: ') or ln.startswith('*** Delete File: '):
            cur = None
            continue
        if ln.startswith('*** End Patch') or ln.startswith('*** Begin Patch') or ln.startswith('*** Move to:'):
            continue
        if cur is None:
            continue
        if ln.startswith('@@'):
            cur['chunks'].append({'hdr': ln[2:].strip(), 'anchor': [], 'raw': []})
            continue
        if not cur['chunks']:
            cur['chunks'].append({'hdr': '', 'anchor': [], 'raw': []})
        ch = cur['chunks'][-1]
        if ln.startswith('*** End of File'):
            continue
        ch['raw'].append(ln)
        if ln.startswith('+'):
            pass
        elif ln.startswith('-') or ln.startswith(' '):
            ch['anchor'].append(ln[1:])
        else:
            ch['anchor'].append(ln)
    return [(o['file'], c['anchor'], c['hdr'], c['raw']) for o in out for c in o['chunks']]


BEGIN_PATCH = re.compile(r'\*\*\* Begin Patch.*?\*\*\* End Patch', re.S)


def anchors_of(harness, e, ekind):
    inp = e.get('input') or {}
    t = e.get('tool') or ''
    if harness == 'claude':
        if t == 'Edit':
            return [(str(inp.get('file_path', '')), str(inp.get('old_string', '')).split('\n'), '', None)]
        if t == 'MultiEdit':
            return [(str(inp.get('file_path', '')), str(x.get('old_string', '')).split('\n'), '', None)
                    for x in (inp.get('edits') or [])]
        if t == 'Write':
            return []
    if harness == 'opencode':
        if t == 'apply_patch':
            return patch_chunks(str(inp.get('patchText', '')))
        if t == 'edit':
            return [(str(inp.get('filePath', '')), str(inp.get('oldString', '')).split('\n'), '', None)]
    cmd = cmd_of(harness, e)
    m = BEGIN_PATCH.search(cmd)
    if m:
        return patch_chunks(m.group(0))
    return []


# -------------------------------------------------------------------- gutter
G_TAB = re.compile(r'^\s*(\d+)\t')
G_PIPE = re.compile(r'^\s*(\d+)\| ')
G_COLON = re.compile(r'^\s*(\d+): ')
G_GREP = re.compile(r'^[^\s:]+:\d+[:-]')
G_ANY = re.compile(r'^\s*\d+(\t|\| |: )')


def gutter_form(line):
    if G_TAB.match(line):
        return 'tab'
    if G_PIPE.match(line):
        return 'pipe'
    if G_COLON.match(line):
        return 'colon'
    if G_GREP.match(line):
        return 'grep'
    return 'none'


def strip_gutter(line):
    for rx, w in ((G_TAB, 1), (G_PIPE, 2), (G_COLON, 2)):
        m = rx.match(line)
        if m:
            return line[m.end():]
    m = G_GREP.match(line)
    if m:
        return line[m.end():]
    return line


def strip_digits(line):
    """remove ONLY the leading line number, keeping the whole delimiter.
    `171\\t\\t\\t\\tx` -> `\\t\\t\\t\\tx`  (the TAB +1 carry signature: the gutter tab becomes
    a fourth indent tab in a tab-indented file, and nothing marks the boundary)."""
    m = re.match(r'^\s*\d+(?=(\t|\| |: ))', line)
    return line[m.end():] if m else None


def strip_naive(line):
    """remove the digits AND the delimiter GLYPH, keeping the delimiter's trailing space:
    `35| x` -> ` x` (the PIPE/COLON +1 space carry signature). Undefined for tab, which has
    no glyph — use strip_digits there."""
    m = re.match(r'^\s*\d+(\||:)', line)
    return line[m.end():] if m else None


def carry_signature(shown_line, anchor_first):
    """which mis-strip of the gutter reproduces the attempted anchor line, if any."""
    if strip_gutter(shown_line) == anchor_first:
        return 'clean-strip'
    sd = strip_digits(shown_line)
    if sd is not None and sd == anchor_first:
        return 'digits-only (delimiter carried)'
    sn = strip_naive(shown_line)
    if sn is not None and sn == anchor_first:
        return 'digits+glyph (delimiter space carried)'
    return None


REP_RX = re.compile(r'/root/\.ss-eval/runs/r(\d+)-\d+')


def rep_of_stream(ev, path=''):
    """rep index, read from the jail working directory the tools reference."""
    m = REP_RX.search(path)
    if m:
        return int(m.group(1))
    for e in ev:
        blob = json.dumps(e.get('input') or {})[:4000] + (e.get('output') or '')[:4000]
        m = REP_RX.search(blob)
        if m:
            return int(m.group(1))
    return None


_ROWS = {}


def rows_of(run):
    if run not in _ROWS:
        p = os.path.join(R, run, 'rows.json')
        try:
            rr = json.load(open(p))
        except Exception:
            rr = []
        if isinstance(rr, dict):
            rr = rr.get('rows') or list(rr.values())
        _ROWS[run] = rr
    return _ROWS[run]


def resolution_index(run):
    """(task, arm, rep) -> resolved; (task, arm) -> [resolved,…]; rolloutFile -> rep.
    codex rows carry `rolloutFile`, which is an exact transcript join; opencode and
    claude-code rows do not, so those fall back to the jail path `runs/r<rep>-<n>`."""
    byrep, bycell, bypath = {}, collections.defaultdict(list), {}
    for r in rows_of(run):
        t = r.get('taskId') or r.get('task') or r.get('id')
        byrep[(t, r.get('arm'), r.get('rep'))] = bool(r.get('resolved'))
        bycell[(t, r.get('arm'))].append(bool(r.get('resolved')))
        rf = r.get('rolloutFile')
        if rf:
            bypath[os.path.realpath(rf)] = r.get('rep')
    return byrep, bycell, bypath


def assign_reps(paths, evs, bypath):
    """rep for each transcript of one cell: exact path join first, then the jail path in
    the trace, then fill a single remaining hole by elimination."""
    reps = []
    for p, ev in zip(paths, evs):
        r = bypath.get(os.path.realpath(p))
        if r is None:
            r = rep_of_stream(ev, p)
        reps.append(r)
    known = set(x for x in reps if x is not None)
    holes = [i for i, x in enumerate(reps) if x is None]
    free = [x for x in range(len(reps)) if x not in known]
    if len(holes) == 1 and len(free) == 1:
        reps[holes[0]] = free[0]
    return reps


# ------------------------------------------------------------------ surfaces
SS_TOOLS = ('ss-read', 'ss-grep', 'ss-search', 'ss-semantic', 'ss-find', 'ss-trace')
SHELL_READ = re.compile(r'\b(sed|cat|nl|head|tail|grep|rg|awk|less|od|xxd)\b')


def surface_of(harness, e):
    t = e.get('tool') or ''
    if harness == 'claude' and t == 'Read':
        return 'native-Read'
    if harness == 'opencode' and t == 'read':
        return 'native-read'
    if harness == 'opencode' and t in ('grep', 'glob', 'list'):
        return 'native-' + t
    cmd = cmd_of(harness, e)
    for s in SS_TOOLS:
        if re.search(r'(^|[\s;&|(])' + s + r'(\s|$)', cmd):
            return s
    m = SHELL_READ.search(cmd)
    if m and cmd:
        return 'shell:' + m.group(1)
    if t in ('exec_command', 'bash', 'Bash', 'shell'):
        return 'shell:other'
    return 'tool:' + t


# ------------------------------------------------------------------- goldens
_TASK_SPECS = None


def task_specs():
    global _TASK_SPECS
    if _TASK_SPECS is None:
        T = json.load(open(TASKS))
        if isinstance(T, dict):
            T = T.get('tasks') or list(T.values())
        _TASK_SPECS = {(t.get('instance_id') or t.get('id')): t for t in T}
    return _TASK_SPECS


_GDIRS = None


def golden_for(task):
    global _GDIRS
    if _GDIRS is None:
        _GDIRS = set(os.listdir(GOLDEN)) if os.path.isdir(GOLDEN) else set()
    t = task_specs().get(task)
    if not t:
        return None
    slug = (t.get('repo') or '').replace('/', '__') + '@' + str(t.get('base_commit'))
    return os.path.join(GOLDEN, slug) if slug in _GDIRS else None


def resolve_path(gold, fp):
    if not gold or not fp:
        return None
    rel = re.sub(r'^/root/\.ss-eval/runs/[^/]+/', '', str(fp)).lstrip('./')
    cands = [rel]
    parts = rel.split('/')
    if len(parts) > 1:
        cands.append('/'.join(parts[1:]))
    for c in cands:
        p = os.path.join(gold, c)
        if os.path.isfile(p):
            return p
    return None
