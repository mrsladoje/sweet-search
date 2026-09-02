#!/usr/bin/env python3
"""tail_census.py -- per-request census of the post-edit tail for the three production-form
fresh-pool runs (fp-codex-tab, fp-opencode-tab (+ rp-oc-tab repair pass), fp-claudecode-tab).

Read-only over /root/sweet-search-private/eval/task-completion-bench/results. Writes ONE JSON
file (--out) with one record per rollout and one sub-record per billed request:
  request = {i, cls, calls[], in, cached, cw, out, usd, text, ss (state_summary), is_edit, ...}

Alignment rules (re-derived from e2-harvest.mjs / e4-*-parse and verified on raw traces):
  codex     : every response_item function_call between two event_msg token_count events belongs
              to the LATER token_count (the request that emitted the call). One call per request.
              Tool output is the exec_command wrapper (Chunk ID / Wall time / Process ... / Output:).
              Async exec: "Process running with session ID N" -> later write_stdin(session_id=N)
              polls carry the real stdout. apply_patch rides inside exec_command heredocs.
  opencode  : step_start ... (tool_use|text)* ... step_finish; step_finish.tokens is the request.
              Several tool_use parts in one step = parallel calls in ONE request.
  claude    : one request = one message.id (2-3 records share it); usage from the record with the
              largest in+out; tool_use blocks deduped by id; tool_result matched by tool_use_id.
              Main thread only; subagents/*.jsonl are counted separately as sidechain.

Price vector (registered): $0.10/M new input, $0.01/M cached input, $0.60/M output(+reasoning);
claude cache-write premium 1.25x as in e2-harvest.mjs (cacheWritePremium for claude only).
"""
import json, os, re, sys, collections

R = '/root/sweet-search-private/eval/task-completion-bench/results'
ROOT = os.path.dirname(R)
PRICE = dict(inp=0.10, cache=0.01, out=0.60)
REPAIR = set(l.strip() for l in open('/root/fresh-run/repair-tasks.txt') if l.strip())

RUNS = [
    dict(run='fp-codex-tab-20260826', harness='codex'),
    dict(run='fp-opencode-tab-20260826', harness='opencode'),
    dict(run='rp-oc-tab-20260827', harness='opencode', repair=True),
    dict(run='fp-claudecode-tab-20260826', harness='claude-code'),
]

SS_TOOLS = ('ss-search', 'ss-semantic', 'ss-grep', 'ss-find', 'ss-trace', 'ss-read', 'ss-files', 'ss-edit', 'ss-batch')
NATIVE_READ = ('sed', 'cat', 'nl', 'head', 'tail', 'less', 'more', 'awk', 'bat')
NATIVE_FIND = ('grep', 'rg', 'find', 'ls', 'fd', 'ack', 'ag', 'tree', 'wc')
TEST_RUNNERS = re.compile(r'\b(pytest|python -m pytest|npm test|npm run test|npx jest|jest|mocha|vitest|mix test|go test|cargo test|dotnet test|mvn |gradle|gradlew|phpunit|vendor/bin/phpunit|rspec|bundle exec|make test|make check|ctest|b2 |\./b2|Rscript|testthat|devtools::test|tox|nosetests|unittest|deno test|bun test|lein test|rebar3|sbt |stack test|cabal test|swift test|zig test|nim c|dune test|elixir|npx tsc|tsc\b|eslint|flake8|mypy|ruff|black --check|prettier --check|luacheck|busted)')
EDIT_FAIL_RE = re.compile(r'Failed to find context|Failed to find expected lines|Unexpected line found in update hunk|apply_patch verification failed|String to replace not found in file|Found \d+ matches of the string to replace|Invalid patch|patch does not apply|Could not find oldString|oldString not found|Found multiple matches|Refusing replacement|File has not been read yet|has been modified since read|No changes to make', re.I)
EDIT_OK_RE = re.compile(r'Success\. Updated the following files|has been updated successfully|File created successfully|Applied \d+ edits?|has been updated\.|Wrote file|The file .* has been updated', re.I)
SS_RE = re.compile(r'<state_summary>', re.I)
RUNDIR_RE = re.compile(r'^/root/\.ss-eval/(?:runs/)?r\d+-\d+/')


def jl(f):
    out = []
    with open(f, encoding='utf8', errors='replace') as fh:
        for l in fh:
            l = l.strip()
            if not l or l[0] != '{':
                continue
            try:
                out.append(json.loads(l))
            except Exception:
                pass
    return out


def walk(d):
    for root, dirs, files in os.walk(d):
        for f in files:
            yield os.path.join(root, f)


def norm_path(p):
    p = str(p or '').strip().strip('"\'')
    p = RUNDIR_RE.sub('', p)
    p = re.sub(r'^\./', '', p)
    return p


# ---------------- shell command analysis ----------------
def split_segments(cmd):
    cmd = cmd if isinstance(cmd, str) else json.dumps(cmd)
    heredocs = []

    def _strip(m):
        heredocs.append(m.group(0))
        return ' <<HEREDOC_STRIPPED '
    cmd2 = re.sub(r"<<-?\s*'?\"?(\w+)'?\"?\n.*?\n\1", _strip, cmd, flags=re.S)
    parts = re.split(r'&&|\|\||;|\n|(?<!\|)\|(?!\|)', cmd2)
    return [p.strip() for p in parts if p.strip()], heredocs


def program_of(seg):
    seg = seg.strip()
    seg = re.sub(r'^\(+\s*', '', seg)
    seg = re.sub(r'^(?:timeout\s+\S+\s+|time\s+|nice\s+|sudo\s+|env\s+)', '', seg)
    while re.match(r'^[A-Za-z_][A-Za-z0-9_]*=\S*\s+', seg):
        seg = re.sub(r'^[A-Za-z_][A-Za-z0-9_]*=\S*\s+', '', seg)
    m = re.match(r'^([\w./-]+)', seg)
    return (m.group(1) if m else ''), seg


def first_path_arg(seg):
    """first non-flag token after the program that looks like a path"""
    toks = seg.split()
    for t in toks[1:]:
        if t.startswith('-'):
            continue
        if re.match(r'^\d+$', t):
            continue
        if t in ('-n', '-e'):
            continue
        return norm_path(t)
    return ''


def shell_kinds(cmd):
    """return list of (kind, path) for a shell command. kinds: ss-read/ss-search/.../run_tests/
    apply_patch/shell_write/script_write/git_diff/git_status/git_revert/git_other/native_read/
    native_find/direct_test/plan/other"""
    segs, heredocs = split_segments(cmd)
    kinds = []
    for s in segs:
        p, seg = program_of(s)
        base = p.rsplit('/', 1)[-1]
        if base in SS_TOOLS:
            kinds.append((base, first_path_arg(seg) if base == 'ss-read' else ''))
        elif base == 'apply_patch':
            kinds.append(('apply_patch', ''))
        elif base == 'run_tests':
            kinds.append(('run_tests', ''))
        elif base == 'git':
            sub = re.match(r'^git\s+(?:-C\s+\S+\s+|--no-pager\s+)?(\S+)', seg)
            sub = sub.group(1) if sub else ''
            if sub == 'diff':
                kinds.append(('git_diff', ''))
            elif sub == 'status':
                kinds.append(('git_status', ''))
            elif sub in ('checkout', 'stash', 'restore', 'reset', 'clean'):
                kinds.append(('git_revert', ''))
            elif sub == 'apply':
                kinds.append(('git_apply', ''))
            else:
                kinds.append(('git_other', sub))
        elif base in ('sed', 'perl') and re.search(r'\s-[a-zA-Z]*i', seg):
            kinds.append(('shell_write', first_path_arg(re.sub(r"\s-[a-zA-Z]*i\S*(\s+'[^']*'|\s+\"[^\"]*\"|\s+\S+)?", ' ', seg, count=1))))
        elif base in NATIVE_READ:
            kinds.append(('native_read', first_path_arg(seg)))
        elif base in NATIVE_FIND:
            kinds.append(('native_find', ''))
        elif base == 'tee':
            kinds.append(('shell_write', first_path_arg(seg)))
        elif base in ('python', 'python3', 'node', 'ruby', 'php') and re.search(r'\b(open\([^)]*[\'"]w|write_text|writeFileSync|writeFile\(|File\.write|file_put_contents)', cmd):
            kinds.append(('script_write', ''))
        elif base in ('update_plan', 'todowrite'):
            kinds.append(('plan', ''))
        elif base in ('printf', 'echo', 'true', 'cd', 'pwd', 'sort', 'uniq', 'xargs', 'tr', 'cut', 'test', '[', 'export', 'set', 'mkdir', 'sleep', 'which', 'command', 'type', 'basename', 'dirname', 'date', 'HEREDOC_STRIPPED'):
            kinds.append(('shell_misc', base))
        elif base:
            if TEST_RUNNERS.search(seg):
                kinds.append(('direct_test', base))
            else:
                kinds.append(('other', base))
    # redirections to repo files (cat > f, printf > f) ; ignore /dev/null, /tmp, fd dupes
    for m in re.finditer(r'(?<![0-9&<])>{1,2}\s*(?!&)([\w./-]+)', re.sub(r"<<-?\s*'?\"?(\w+)'?\"?\n.*?\n\1", ' ', cmd, flags=re.S)):
        tgt = m.group(1)
        if tgt.startswith('/dev/') or tgt.startswith('/tmp') or tgt in ('&1', '&2'):
            continue
        kinds.append(('shell_write', norm_path(tgt)))
    if 'apply_patch' in cmd and not any(k == 'apply_patch' for k, _ in kinds):
        kinds.append(('apply_patch', ''))
    if TEST_RUNNERS.search(cmd) and not any(k in ('run_tests', 'direct_test') for k, _ in kinds):
        kinds.append(('direct_test', ''))
    return kinds, heredocs


def patch_files(text):
    files = []
    for m in re.finditer(r'^\*\*\* (?:Update|Add|Delete) File: (.+)$', str(text or ''), re.M):
        files.append(norm_path(m.group(1)))
    return files


# ---------------- per-harness parsers -> list of requests ----------------
def new_req(i):
    return dict(i=i, calls=[], inp=0, cached=0, cw=0, out=0, text='', ss=False)


def mk_call(tool, cmd, kinds, out_text, err, paths, edit_kind=None):
    fail = bool(err) or bool(EDIT_FAIL_RE.search(out_text or ''))
    ok = bool(EDIT_OK_RE.search(out_text or ''))
    return dict(tool=tool, cmd=(cmd or '')[:240], kinds=kinds, err=bool(err), out_len=len(out_text or ''),
                out_head=(out_text or '')[:160], paths=paths, edit_kind=edit_kind,
                edit_fail=(edit_kind is not None and fail and not ok), edit_ok=(edit_kind is not None and (ok or (not fail))),
                rt_verdict=('Authoritative test result' in (out_text or '')),
                rt_running=('[run_tests] RUNNING' in (out_text or '') and 'Authoritative test result' not in (out_text or '')),
                truncated=('truncated output (original token count' in (out_text or '')) or ('lines truncated' in (out_text or '')))


CODEX_WRAP = re.compile(r'^Chunk ID: (?P<chunk>\S+)\nWall time: (?P<wall>[\d.]+) seconds\n(?:Process exited with code (?P<code>-?\d+)|Process running with session ID (?P<sid>\d+)|Script running with cell ID (?P<cell>\d+))\n(?:Original token count: (?P<tok>\d+)\n)?(?:Output:\n)?(?P<body>.*)$', re.S)


def shell_call(tool, cmd, out_text, err):
    kinds, heredocs = shell_kinds(cmd)
    paths = []
    edit_kind = None
    for k, pth in kinds:
        if k == 'apply_patch':
            edit_kind = 'apply_patch'
            paths += patch_files(cmd)
        elif k in ('shell_write', 'script_write', 'git_apply'):
            edit_kind = edit_kind or k
            if pth:
                paths.append(pth)
        elif k == 'git_revert':
            edit_kind = edit_kind or 'git_revert'
    if edit_kind == 'apply_patch':
        for m in re.finditer(r'^[MAD] (.+)$', out_text or '', re.M):
            paths.append(norm_path(m.group(1)))
    return mk_call(tool, cmd, [k for k, _ in kinds], out_text, err, sorted(set(p for p in paths if p)), edit_kind), kinds


def parse_codex(f):
    reqs = []
    cur = new_req(0)
    pend = {}
    rt_sessions = set()
    for d in jl(f):
        p = d.get('payload') or {}
        t = d.get('type')
        pt = p.get('type')
        if t == 'event_msg' and pt == 'agent_message':
            cur['text'] += (str(p.get('message') or '') + '\n')
        elif t == 'response_item' and pt in ('function_call', 'custom_tool_call'):
            name = p.get('name')
            try:
                args = json.loads(p.get('arguments') or '{}') if pt == 'function_call' else {'raw': p.get('input')}
            except Exception:
                args = {'raw': p.get('arguments')}
            rec = dict(name=name, args=args, out='', call_id=p.get('call_id'))
            pend[p.get('call_id')] = rec
            cur['calls'].append(rec)
        elif t == 'response_item' and pt in ('function_call_output', 'custom_tool_call_output'):
            rec = pend.get(p.get('call_id'))
            o = p.get('output')
            o = o if isinstance(o, str) else json.dumps(o)
            if rec is not None:
                rec['out'] = o
        elif t == 'event_msg' and pt == 'token_count':
            u = (p.get('info') or {}).get('last_token_usage')
            if not u:
                continue
            cur['inp'] = u.get('input_tokens') or 0
            cur['cached'] = u.get('cached_input_tokens') or 0
            cur['cw'] = u.get('cache_write_input_tokens') or 0
            cur['out'] = (u.get('output_tokens') or 0) + (u.get('reasoning_output_tokens') or 0)
            # finalize calls
            calls = []
            for rec in cur['calls']:
                name = rec['name']
                m = CODEX_WRAP.match(rec['out'] or '')
                body = m.group('body') if m else (rec['out'] or '')
                code = int(m.group('code')) if (m and m.group('code') is not None) else None
                sid = m.group('sid') if m else None
                if name == 'exec_command':
                    cmd = rec['args'].get('cmd') or ''
                    cmd = cmd if isinstance(cmd, str) else ' '.join(map(str, cmd))
                    c, kinds = shell_call('exec_command', cmd, body, err=(code not in (None, 0)))
                    if sid and any(k == 'run_tests' for k, _ in kinds):
                        rt_sessions.add(sid)
                    c['async_sid'] = sid
                    c['exit'] = code
                    c['orig_tok'] = int(m.group('tok')) if (m and m.group('tok')) else None
                elif name == 'write_stdin':
                    sid2 = str(rec['args'].get('session_id'))
                    c = mk_call('write_stdin', 'write_stdin session=%s' % sid2, ['rt_poll' if sid2 in rt_sessions else 'poll'], body, False, [], None)
                    c['exit'] = code
                elif name == 'update_plan':
                    c = mk_call('update_plan', 'update_plan', ['plan'], body, False, [], None)
                else:
                    c = mk_call(name or 'tool', json.dumps(rec['args'])[:200], ['other'], body, False, [], None)
                calls.append(c)
            cur['calls'] = calls
            cur['ss'] = bool(SS_RE.search(cur['text']))
            reqs.append(cur)
            cur = new_req(len(reqs))
    return reqs


def parse_opencode(f):
    reqs = []
    cur = new_req(0)
    for d in jl(f):
        t = d.get('type')
        p = d.get('part') or {}
        if t == 'text':
            cur['text'] += (str(p.get('text') or '') + '\n')
        elif t == 'tool_use':
            st = p.get('state') or {}
            inp = st.get('input') or {}
            tool = p.get('tool')
            out = st.get('output')
            out = out if isinstance(out, str) else json.dumps(out or '')
            if st.get('status') == 'error':
                out = (str(st.get('error') or '') + '\n' + out)
            err = st.get('status') == 'error'
            if tool == 'bash':
                c, _ = shell_call('bash', inp.get('command') or '', out, err)
            elif tool == 'read':
                c = mk_call('read', 'read %s' % inp.get('filePath', ''), ['native_read'], out, err, [norm_path(inp.get('filePath', ''))], None)
            elif tool in ('grep', 'glob', 'list'):
                c = mk_call(tool, '%s %s' % (tool, json.dumps(inp)[:120]), ['native_find'], out, err, [], None)
            elif tool == 'apply_patch':
                pt = inp.get('patchText') or ''
                c = mk_call('apply_patch', 'apply_patch', ['apply_patch'], out, err, patch_files(pt), 'apply_patch')
            elif tool in ('edit', 'write', 'patch', 'multiedit'):
                c = mk_call(tool, tool, [tool], out, err, [norm_path(inp.get('filePath', ''))], tool)
            elif tool in ('todowrite', 'todoread'):
                c = mk_call(tool, tool, ['plan'], out, err, [], None)
            elif tool == 'task':
                c = mk_call(tool, 'task', ['delegate'], out, err, [], None)
            else:
                c = mk_call(tool or 'tool', json.dumps(inp)[:120], ['other'], out, err, [], None)
            cur['calls'].append(c)
        elif t == 'step_finish':
            tk = p.get('tokens') or {}
            cache = tk.get('cache') or {}
            cur['inp'] = (tk.get('input') or 0) + (cache.get('read') or 0) + (cache.get('write') or 0)
            cur['cached'] = cache.get('read') or 0
            cur['cw'] = cache.get('write') or 0
            cur['out'] = (tk.get('output') or 0) + (tk.get('reasoning') or 0)
            cur['ss'] = bool(SS_RE.search(cur['text']))
            cur['reason'] = p.get('reason')
            reqs.append(cur)
            cur = new_req(len(reqs))
    return reqs


def parse_claude(f):
    """returns (requests, usage_agg) ; main thread of one transcript"""
    order = []
    byid = {}
    results = {}
    for d in jl(f):
        m = d.get('message')
        if not m:
            continue
        if m.get('role') == 'user':
            c = m.get('content')
            if isinstance(c, list):
                for b in c:
                    if isinstance(b, dict) and b.get('type') == 'tool_result':
                        cc = b.get('content')
                        s = cc if isinstance(cc, str) else (' '.join((x.get('text') or '') if isinstance(x, dict) else str(x) for x in cc) if isinstance(cc, list) else json.dumps(cc or ''))
                        results[b.get('tool_use_id')] = (s, bool(b.get('is_error')))
            continue
        if m.get('role') != 'assistant' or not m.get('id'):
            continue
        g = byid.get(m['id'])
        if g is None:
            g = dict(blocks=[], seen=set(), usage=None, best=-1, texts=[])
            byid[m['id']] = g
            order.append(m['id'])
        for b in (m.get('content') or []):
            if not isinstance(b, dict):
                continue
            if b.get('type') == 'tool_use':
                if b.get('id') in g['seen']:
                    continue
                g['seen'].add(b.get('id'))
                g['blocks'].append(b)
            elif b.get('type') == 'text':
                key = 'text:' + str(b.get('text') or '')[:200]
                if key in g['seen']:
                    continue
                g['seen'].add(key)
                g['texts'].append(str(b.get('text') or ''))
        u = m.get('usage')
        if u:
            cached = u.get('cache_read_input_tokens') or 0
            cw = u.get('cache_creation_input_tokens') or 0
            IN = (u.get('input_tokens') or 0) + cached + cw
            out = u.get('output_tokens') or 0
            if IN + out > g['best']:
                g['best'] = IN + out
                g['usage'] = dict(inp=IN, cached=cached, cw=cw, out=out)
    reqs = []
    agg = dict(out=0, cr=0)
    for mid in order:
        g = byid[mid]
        if not g['usage']:
            continue
        r = new_req(len(reqs))
        r.update(g['usage'])
        r['text'] = '\n'.join(g['texts'])
        r['ss'] = bool(SS_RE.search(r['text']))
        r['mid'] = mid
        agg['out'] += r['out']
        agg['cr'] += r['cached']
        for b in g['blocks']:
            inp = b.get('input') or {}
            name = b.get('name')
            out, err = results.get(b.get('id'), ('', False))
            if name in ('Bash',):
                c, _ = shell_call('Bash', inp.get('command') or '', out, err)
            elif name in ('Read', 'NotebookRead'):
                c = mk_call(name, 'Read %s' % inp.get('file_path', ''), ['native_read'], out, err, [norm_path(inp.get('file_path', ''))], None)
            elif name in ('Grep', 'Glob', 'LS'):
                c = mk_call(name, '%s %s' % (name, json.dumps(inp)[:120]), ['native_find'], out, err, [], None)
            elif name in ('Edit', 'MultiEdit', 'Write', 'NotebookEdit'):
                c = mk_call(name, name, [name], out, err, [norm_path(inp.get('file_path', ''))], name)
            elif name in ('TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskView', 'TodoRead', 'TaskList'):
                c = mk_call(name, name, ['plan'], out, err, [], None)
            elif name in ('Task', 'Agent'):
                c = mk_call(name, 'Task %s' % str(inp.get('description') or '')[:80], ['delegate'], out, err, [], None)
            elif name in ('BashOutput', 'TaskOutput', 'KillShell', 'KillBash'):
                c = mk_call(name, name, ['poll'], out, err, [], None)
            else:
                c = mk_call(name or 'tool', json.dumps(inp)[:120], ['other'], out, err, [], None)
            r['calls'].append(c)
        reqs.append(r)
    return reqs, agg


# ---------------- request classification ----------------
PRIORITY = ['run_tests', 'rt_poll', 'direct_test', 'edit', 'git_revert', 'git_diff_status', 'git_other',
            'reread_edited', 'ss_read_other', 'ss_search', 'native_read', 'native_find', 'delegate',
            'poll', 'plan', 'other', 'text_only']


def call_class(c, edited_so_far):
    ks = c['kinds']
    if c['edit_kind'] in ('apply_patch', 'shell_write', 'script_write', 'git_apply', 'edit', 'write', 'patch', 'multiedit', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'):
        return 'edit'
    if c['edit_kind'] == 'git_revert':
        return 'git_revert'
    if 'run_tests' in ks:
        return 'run_tests'
    if 'rt_poll' in ks:
        return 'rt_poll'
    if 'direct_test' in ks:
        return 'direct_test'
    if 'git_diff' in ks or 'git_status' in ks:
        return 'git_diff_status'
    if any(k.startswith('git_') for k in ks):
        return 'git_other'
    reads = [p for p in c['paths'] if p]
    is_read = ('ss-read' in ks) or ('native_read' in ks)
    if is_read and reads and any(p in edited_so_far or any(e.endswith('/' + p) or p.endswith('/' + e) for e in edited_so_far) for p in reads):
        return 'reread_edited'
    if 'ss-read' in ks:
        return 'ss_read_other'
    if any(k in ('ss-search', 'ss-semantic', 'ss-grep', 'ss-find', 'ss-trace', 'ss-files', 'ss-batch') for k in ks):
        return 'ss_search'
    if 'native_read' in ks:
        return 'native_read'
    if 'native_find' in ks:
        return 'native_find'
    if 'delegate' in ks:
        return 'delegate'
    if 'poll' in ks:
        return 'poll'
    if 'plan' in ks:
        return 'plan'
    return 'other'


def usd_of(r, claude):
    IN, cached, cw, out = r['inp'], r['cached'], r['cw'], r['out']
    if claude:
        cw2 = max(0, min(cw, IN - cached))
        return ((IN - cached - cw2) * PRICE['inp'] + cw2 * PRICE['inp'] * 1.25 + cached * PRICE['cache'] + out * PRICE['out']) / 1e6
    return ((IN - cached) * PRICE['inp'] + cached * PRICE['cache'] + out * PRICE['out']) / 1e6


def annotate(reqs, claude):
    edited = set()
    last_edit = None
    last_ok_edit = None
    prev_in = 0
    for r in reqs:
        r['usd'] = usd_of(r, claude)
        new_in = max(0, r['inp'] - prev_in)
        r['ideal_usd'] = (new_in * PRICE['inp'] + (r['inp'] - new_in) * PRICE['cache'] + r['out'] * PRICE['out']) / 1e6
        prev_in = r['inp']
        classes = []
        r['is_edit'] = False
        r['edit_fail'] = False
        r['edit_ok'] = False
        for c in r['calls']:
            c['cls'] = call_class(c, edited)
            classes.append(c['cls'])
            if c['cls'] == 'edit':
                r['is_edit'] = True
                if c['edit_fail']:
                    r['edit_fail'] = True
                else:
                    r['edit_ok'] = True
        # edited files become "edited" AFTER this request
        for c in r['calls']:
            if c['cls'] == 'edit' and not c['edit_fail']:
                for p in c['paths']:
                    edited.add(p)
        if not r['calls']:
            r['cls'] = 'text_only'
        else:
            r['cls'] = next((k for k in PRIORITY if k in classes), 'other')
        if r['is_edit']:
            last_edit = r['i']
            if r['edit_ok']:
                last_ok_edit = r['i']
        r['text_len'] = len(r['text'])
        r['text_head'] = r['text'][:120]
        del r['text']
    return reqs, sorted(edited), last_edit, last_ok_edit


# ---------------- locate transcripts ----------------
def opencode_file(row):
    a = row.get('openCodeRawAttempts') or []
    if not a:
        return None
    p = a[0].get('stdout')
    if not p:
        return None
    return p if p.startswith('/') else os.path.join(ROOT, p)


def claude_cell(run, row):
    base = os.path.join(R, run, 'agent-state', '%s-%s' % (row['taskId'], row['arm']), 'claude-home', 'projects')
    if not os.path.isdir(base):
        return None, [], 0
    dirs = [d for d in os.listdir(base) if re.search(r'-r%d-\d+$' % row['rep'], d)]
    cands = []
    for d in dirs:
        pd = os.path.join(base, d)
        for f in os.listdir(pd):
            if f.endswith('.jsonl'):
                sid = f[:-6]
                subdir = os.path.join(pd, sid, 'subagents')
                subs = sorted(os.path.join(subdir, x) for x in os.listdir(subdir) if x.endswith('.jsonl')) if os.path.isdir(subdir) else []
                cands.append((os.path.join(pd, f), subs))
    if not cands:
        return None, [], 0
    if len(cands) == 1:
        return cands[0][0], cands[0][1], 0
    ru = row.get('usage') or {}
    best = None
    bd = None
    for f, subs in cands:
        _, agg = parse_claude(f)
        dist = abs(agg['out'] - (ru.get('output_tokens') or 0)) + abs(agg['cr'] - (ru.get('cache_read_input_tokens') or 0)) / 100.0
        if bd is None or dist < bd:
            bd = dist
            best = (f, subs)
    return best[0], best[1], len(cands) - 1


def patches_for(run, arm, rep):
    p = os.path.join(R, run, arm, '' if rep == 0 else 'rep-%d' % rep, 'patches.json')
    try:
        return {x['instance_id']: (x.get('patch') or '') for x in json.load(open(p))}
    except Exception:
        return {}


def main():
    out_path = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else '/tmp/wf-slatec/verify-tail/tail-census.json'
    rollouts = []
    problems = []
    for cfg in RUNS:
        run, harness = cfg['run'], cfg['harness']
        rows = json.load(open(os.path.join(R, run, 'rows.json')))
        pcache = {}
        for row in rows:
            task, arm, rep = row['taskId'], row['arm'], row['rep']
            # opencode canonical set: fp sweet rows only for non-repair tasks; rp rows for repair tasks
            if harness == 'opencode':
                if cfg.get('repair'):
                    if task not in REPAIR or arm != 'sweet':
                        continue
                elif arm == 'sweet' and task in REPAIR:
                    continue
            rid = '%s/%s/%s/r%d' % (run, task, arm, rep)
            key = (arm, rep)
            if key not in pcache:
                pcache[key] = patches_for(run, arm, rep)
            patch = pcache[key].get(task, '')
            rec = dict(rid=rid, run=run, harness=harness, arm=arm, task=task, rep=rep,
                       resolved=(row.get('resolved') is True), f2pFrac=row.get('f2pFrac'), gradeable=row.get('gradeable'),
                       patch_len=len(patch.strip()), patch_empty=(not patch.strip()), patchHunks=row.get('patchHunks'),
                       row_calls=row.get('calls'), row_cost=row.get('costRealizedUsd'), row_cost_main=row.get('costRealizedMainOnlyUsd'),
                       row_ideal=row.get('idealCostUsd'), row_sidechain_usd=row.get('costSidechainUsd'), row_sidechain_count=row.get('sidechainCount'),
                       row_idealTurns=row.get('idealTurns'), exitReason=row.get('exitReason'), toolCounts=row.get('toolCounts'),
                       rtVerdicts=row.get('rtVerdicts'), rtEndedUnverified=row.get('rtEndedUnverified'),
                       finalAssistantText=(row.get('finalAssistantText') or '')[:200])
            reqs = None
            claude = harness == 'claude-code'
            try:
                if harness == 'codex':
                    f = row.get('rolloutFile')
                    rec['transcript'] = f
                    reqs = parse_codex(f) if f and os.path.exists(f) else None
                elif harness == 'opencode':
                    f = opencode_file(row)
                    rec['transcript'] = f
                    reqs = parse_opencode(f) if f and os.path.exists(f) else None
                else:
                    f, subs, extra = claude_cell(run, row)
                    rec['transcript'] = f
                    rec['abandoned_attempts'] = extra
                    if f:
                        reqs, _ = parse_claude(f)
                        sc = dict(files=len(subs), requests=0, usd=0.0, no_usage=0, edits=0, edit_files=[])
                        for s in subs:
                            sr, _ = parse_claude(s)
                            if not sr:
                                sc['no_usage'] += 1
                                continue
                            sr, sedited, _, _ = annotate(sr, True)
                            sc['requests'] += len(sr)
                            sc['usd'] += sum(x['usd'] for x in sr)
                            sc['edits'] += sum(1 for x in sr if x['is_edit'])
                            sc['edit_files'] += sedited
                        rec['sidechain'] = sc
            except Exception as e:
                problems.append('%s: %r' % (rid, e))
                reqs = None
            if not reqs:
                rec['ok'] = False
                problems.append('%s: no requests' % rid)
                rollouts.append(rec)
                continue
            reqs, edited, last_edit, last_ok_edit = annotate(reqs, claude)
            rec['ok'] = True
            rec['n_req'] = len(reqs)
            rec['n_calls'] = sum(len(r['calls']) for r in reqs)
            rec['usd'] = sum(r['usd'] for r in reqs)
            rec['ideal_usd'] = sum(r['ideal_usd'] for r in reqs)
            rec['edited_files'] = edited
            rec['last_edit'] = last_edit
            rec['last_ok_edit'] = last_ok_edit
            rec['n_edit_req'] = sum(1 for r in reqs if r['is_edit'])
            rec['n_edit_fail_req'] = sum(1 for r in reqs if r['edit_fail'] and not r['edit_ok'])
            texts = [r for r in reqs if r['text_len'] > 0]
            rec['last_text_ss'] = bool(texts and texts[-1]['ss'])
            rec['last_text_head'] = texts[-1]['text_head'] if texts else ''
            rec['last_req_cls'] = reqs[-1]['cls']
            rec['requests'] = reqs
            rollouts.append(rec)
        sys.stderr.write('done %s\n' % run)
    json.dump(dict(price=PRICE, problems=problems, rollouts=rollouts), open(out_path, 'w'))
    sys.stderr.write('rollouts=%d problems=%d -> %s\n' % (len(rollouts), len(problems), out_path))
    for p in problems[:40]:
        sys.stderr.write('  ' + p + '\n')


if __name__ == '__main__':
    main()
