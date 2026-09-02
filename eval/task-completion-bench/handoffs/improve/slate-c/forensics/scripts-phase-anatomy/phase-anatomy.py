#!/usr/bin/env python3
"""phase-anatomy.py -- segment every request of the solved-everywhere rollouts into phases.

Read-only over the evidence box. Runs ON the box (python3), writes only under
/tmp/wf-slatec/phase-anatomy/.

Runs used (production form, N<TAB> gutter):
  codex        fp-codex-tab-20260826
  opencode     fp-opencode-tab-20260826  (+ rp-oc-tab-20260827 for the sweet rows of the
                                          11 repair tasks, the canonical fresh-pool composition
                                          used by e4-opencode-lib.py / p3-ops-per-envelope.mjs)
  claude-code  fp-claudecode-tab-20260826

Per-request usage is rebuilt from the RAW trace (never from turns/, which overwrites reps):
  codex        event_msg/token_count payload.info.last_token_usage, one per request
  opencode     step_finish part.tokens (in = input + cache.read + cache.write)
  claude-code  one usage-bearing record per assistant message.id (max in+out record)

Phase rule (per request index i, 0-based):
  localize    i < first request with a READ-class call on a file that the final patch edits
  understand  first_read <= i < first request carrying an EDIT-class call
  edit        i >= first_edit and the request carries an EDIT-class call
  verify      i >= first_edit, carries a tool call, no edit call
  finalize    text-only request after the last request that carried any tool call
  narrate     text-only request after first_edit that is not terminal
A rollout that never reads the edited file has every pre-edit request in `localize` and is
flagged never_read. A rollout with a non-empty patch but no detected edit call is flagged
edit_undetected and its post-first-read requests stay in `understand`.

Request CLASS (priority order): edit > test > exec > delegate > read > search > git > poll >
plan > other > text.
"""
import json, os, re, sys, glob, collections

R = '/root/sweet-search-private/eval/task-completion-bench/results'
ROOT = '/root/sweet-search-private/eval/task-completion-bench'
OUT = '/tmp/wf-slatec/phase-anatomy'
PRICE = {'in': 0.10, 'cache': 0.01, 'out': 0.60}
HARN = {
    'codex': {'run': 'fp-codex-tab-20260826'},
    'opencode': {'run': 'fp-opencode-tab-20260826', 'repair': 'rp-oc-tab-20260827',
                 'repair_tasks': '/root/fresh-run/repair-tasks.txt'},
    'claude-code': {'run': 'fp-claudecode-tab-20260826'},
}
PHASES = ['localize', 'understand', 'edit', 'verify', 'narrate', 'finalize']
CLASSES = ['edit', 'test', 'exec', 'delegate', 'read', 'search', 'git', 'poll', 'plan', 'other', 'text']
ONLY_SOLVED_EVERYWHERE = '--all-tasks' not in sys.argv

# ------------------------------------------------------------------ helpers
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


def text_of(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return '\n'.join((x.get('text') or '') if isinstance(x, dict) else str(x) for x in c)
    if c is None:
        return ''
    return json.dumps(c)


RUNS_PREFIX = re.compile(r'^(?:/root/\.ss-eval/runs/r\d+-\d+/|\./)+')


def norm_path(p):
    p = str(p or '').strip().strip('\'"')
    p = RUNS_PREFIX.sub('', p)
    return p.lstrip('/') if p.startswith('/root/.ss-eval') else p


def patch_files(patch):
    files = set()
    for m in re.finditer(r'^diff --git a/(\S+) b/(\S+)', patch or '', re.M):
        files.add(m.group(2))
    for m in re.finditer(r'^\+\+\+ b/(\S+)', patch or '', re.M):
        files.add(m.group(1))
    return sorted(files)


def path_hits(text, edited):
    """Return the edited files whose relative path (or its last two components) appears in text."""
    hits = []
    if not text:
        return hits
    for f in edited:
        cands = [f]
        parts = f.split('/')
        if len(parts) >= 2:
            cands.append('/'.join(parts[-2:]))
        else:
            cands.append(f)
        for c in cands:
            if re.search(r'(?<![\w.\-/])' + re.escape(c) + r'(?![\w])', text):
                hits.append(f)
                break
    return hits


# ---------------------------------------------------- shell command classification
READ_PROGS = {'cat', 'sed', 'head', 'tail', 'nl', 'awk', 'less', 'more', 'bat', 'ss-read'}
SEARCH_PROGS = {'grep', 'rg', 'ag', 'ack', 'find', 'fd', 'ls', 'tree', 'locate', 'which', 'wc',
                'ss-search', 'ss-semantic', 'ss-grep', 'ss-find', 'ss-trace', 'ss-files', 'ss-batch'}
EXEC_PROGS = {'pytest', 'npm', 'npx', 'yarn', 'pnpm', 'go', 'mix', 'dotnet', 'cargo', 'mvn', 'gradle',
              'gradlew', 'make', 'python', 'python3', 'node', 'bundle', 'rspec', 'rake', 'php', 'phpunit',
              'composer', 'Rscript', 'R', 'julia', 'lua', 'luarocks', 'busted', 'swift', 'stack', 'cabal',
              'elixir', 'ruby', 'deno', 'bun', 'jest', 'mocha', 'tsc', 'ctest', 'cmake', 'ninja', 'b2',
              'bootstrap.sh', 'bash', 'sh', 'timeout', 'env', 'iex', 'perl', 'ghc', 'runghc', 'tsx', 'ts-node',
              'nim', 'zig', 'gcc', 'g++', 'clang', 'javac', 'java', 'kotlinc', 'gradle.bat', 'sbt', 'scala',
              'flutter', 'dart', 'pub', 'pip', 'pip3', 'poetry', 'pdm', 'hatch', 'tox', 'nox', 'uv', 'curl', 'wget'}
GIT_PROGS = {'git'}
EDIT_FAIL_RE = re.compile(r'Failed to find context|Failed to find expected lines|Unexpected line found in update hunk|'
                          r'apply_patch verification failed|String to replace not found in file|'
                          r'Found \d+ matches of the string to replace|Invalid patch|patch does not apply|'
                          r'has not been read yet|old_string and new_string are identical', re.I)


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
    seg = re.sub(r'^\(\s*', '', seg)
    while re.match(r'^[A-Za-z_][A-Za-z0-9_]*=\S*\s+', seg):
        seg = re.sub(r'^[A-Za-z_][A-Za-z0-9_]*=\S*\s+', '', seg)
    m = re.match(r'^([\w./+-]+)', seg)
    return m.group(1) if m else ''


def classify_shell(cmd, edited):
    """-> dict(kinds=set, read_hits=set(edited files read), edit_paths=set, tools=list of programs)"""
    segs, heredocs = split_segments(cmd or '')
    kinds, read_hits, edit_paths, progs = set(), set(), set(), []
    for s in segs:
        p = program_of(s)
        base = p.rsplit('/', 1)[-1]
        progs.append(base)
        if base == 'apply_patch' or 'apply_patch' in s.split()[:2]:
            kinds.add('edit')
        elif base == 'run_tests':
            kinds.add('test')
        elif base in READ_PROGS:
            if base == 'sed' and re.search(r'\s-[a-zA-Z]*i', s):
                kinds.add('edit')
                edit_paths.update(norm_path(t) for t in path_hits(norm_path(s), edited))
            else:
                kinds.add('read')
                read_hits.update(path_hits(norm_path(s), edited))
        elif base in SEARCH_PROGS:
            kinds.add('search')
        elif base in GIT_PROGS:
            if re.search(r'\bgit\s+(apply|checkout\s+--|stash|reset|commit|add|mv|rm)\b', s):
                kinds.add('edit')
            else:
                kinds.add('git')
        elif base in ('perl',) and re.search(r'\s-[a-zA-Z]*i', s):
            kinds.add('edit')
        elif base in ('tee', 'mv', 'cp', 'rm', 'mkdir', 'touch', 'chmod', 'ln'):
            kinds.add('edit')
        elif base in EXEC_PROGS:
            kinds.add('exec')
        elif base in ('printf', 'echo', 'true', 'cd', 'pwd', 'sort', 'uniq', 'xargs', 'tr', 'cut', 'test', '[', 'export', 'set', 'exit', 'sleep', 'date', 'cmp', 'diff', 'stat', 'file', 'du', 'jq', 'base64', 'md5sum', 'sha256sum'):
            kinds.add('other')
        elif base:
            kinds.add('other')
        # redirect to a file inside the repo = a write
        if re.search(r'(?<![<>&\d])>{1,2}\s*(?!/dev/null|&)[\w./-]+', s) and base not in ('git',):
            kinds.add('edit')
    for h in heredocs:
        if '*** Begin Patch' in h or '*** Update File:' in h or '*** Add File:' in h:
            kinds.add('edit')
            for m in re.finditer(r'\*\*\* (?:Update|Add|Delete) File: (\S+)', h):
                edit_paths.add(norm_path(m.group(1)))
        if re.search(r"open\([^)]*['\"]w", h) or 'write_text(' in h or 'writeFileSync' in h:
            kinds.add('edit')
    return {'kinds': kinds, 'read_hits': read_hits, 'edit_paths': edit_paths, 'progs': progs}


def klass_of(kinds, has_text):
    for k in CLASSES:
        if k in kinds:
            return k
    return 'text' if has_text or not kinds else 'other'


def usage_rec(IN, cached, cw, out, reasoning=0):
    return {'in': int(IN or 0), 'cached': int(cached or 0), 'cw': int(cw or 0), 'out': int(out or 0),
            'reasoning': int(reasoning or 0)}


# ------------------------------------------------------------------ parsers
# Each parser returns a list of requests:
#  {'usage': {...}|None, 'calls': [ {tool, kinds:set, read_hits:set, edit_paths:set, err:bool, summary, out_hits:set} ],
#   'has_text': bool, 'text': str}

def parse_codex(f, edited):
    reqs = []
    cur = {'calls': [], 'has_text': False, 'text': ''}
    pend = {}
    for d in jl(f):
        p = d.get('payload') or {}
        t = p.get('type') or d.get('type')
        if t == 'function_call':
            try:
                a = json.loads(p.get('arguments') or '{}')
            except Exception:
                a = {'raw': p.get('arguments')}
            name = p.get('name')
            rec = {'tool': name, 'kinds': set(), 'read_hits': set(), 'edit_paths': set(), 'err': False,
                   'summary': '', 'out_hits': set(), 'out_bytes': 0, 'edit_fail': False}
            if name == 'exec_command':
                cmd = a.get('cmd') or ''
                cmd = cmd if isinstance(cmd, str) else ' '.join(map(str, cmd))
                c = classify_shell(cmd, edited)
                rec.update({'kinds': c['kinds'], 'read_hits': c['read_hits'], 'edit_paths': c['edit_paths']})
                rec['summary'] = cmd.replace('\n', '\\n')[:220]
            elif name == 'write_stdin':
                rec['kinds'] = {'poll'}
                rec['summary'] = 'write_stdin ' + json.dumps(a)[:100]
            elif name == 'update_plan':
                rec['kinds'] = {'plan'}
                rec['summary'] = 'update_plan ' + (a.get('explanation') or '')[:150]
            elif name == 'apply_patch':
                rec['kinds'] = {'edit'}
                for m in re.finditer(r'\*\*\* (?:Update|Add|Delete) File: (\S+)', json.dumps(a)):
                    rec['edit_paths'].add(norm_path(m.group(1)))
                rec['summary'] = 'apply_patch'
            else:
                rec['kinds'] = {'other'}
                rec['summary'] = name + ' ' + json.dumps(a)[:150]
            cur['calls'].append(rec)
            if p.get('call_id'):
                pend[p['call_id']] = rec
        elif t == 'function_call_output':
            rec = pend.get(p.get('call_id'))
            out = p.get('output')
            out = out if isinstance(out, str) else json.dumps(out or '')
            if rec is not None:
                rec['out_bytes'] = len(out.encode('utf8', 'replace'))
                rec['out_hits'] = set(path_hits(out, edited))
                rec['err'] = bool(re.search(r'Process exited with code [1-9]', out)) or bool(EDIT_FAIL_RE.search(out))
                rec['edit_fail'] = 'edit' in rec['kinds'] and (bool(EDIT_FAIL_RE.search(out)) or bool(re.search(r'Process exited with code [1-9]', out)))
        elif t == 'message' and d.get('type') == 'response_item' and p.get('role') == 'assistant':
            txt = ''.join((c.get('text') or '') for c in (p.get('content') or []) if isinstance(c, dict))
            if txt.strip():
                cur['has_text'] = True
                cur['text'] += txt[:400]
        elif t == 'token_count':
            u = (p.get('info') or {}).get('last_token_usage')
            if not u:
                continue
            cur['usage'] = usage_rec(u.get('input_tokens'), u.get('cached_input_tokens'), u.get('cache_write_input_tokens'),
                                     (u.get('output_tokens') or 0) + 0, u.get('reasoning_output_tokens'))
            # codex output_tokens already includes reasoning (total_tokens = input + output)
            reqs.append(cur)
            cur = {'calls': [], 'has_text': False, 'text': ''}
    if cur['calls'] or cur['has_text']:
        cur['usage'] = None
        reqs.append(cur)
    return reqs


def classify_structured(tool, inp, edited, harness):
    """Structured (non-shell) tool call -> (kinds, read_hits, edit_paths, summary)."""
    inp = inp if isinstance(inp, dict) else {}
    kinds, read_hits, edit_paths = set(), set(), set()
    summary = tool + ' ' + json.dumps(inp)[:180].replace('\\n', ' ')
    tl = tool.lower()
    if tl in ('read', 'notebookread'):
        kinds.add('read')
        fp = norm_path(inp.get('filePath') or inp.get('file_path') or inp.get('path') or '')
        read_hits.update(path_hits(fp, edited))
        summary = f"{tool} {fp} {inp.get('offset', '')}+{inp.get('limit', '')}"
    elif tl in ('grep', 'glob', 'list', 'ls', 'websearch', 'webfetch'):
        kinds.add('search')
    elif tl in ('apply_patch',):
        kinds.add('edit')
        for m in re.finditer(r'\*\*\* (?:Update|Add|Delete) File: (\S+)', inp.get('patchText') or ''):
            edit_paths.add(norm_path(m.group(1)))
        summary = 'apply_patch ' + ','.join(sorted(edit_paths))
    elif tl in ('edit', 'multiedit', 'write', 'notebookedit'):
        kinds.add('edit')
        fp = norm_path(inp.get('filePath') or inp.get('file_path') or inp.get('notebook_path') or '')
        if fp:
            edit_paths.add(fp)
        summary = f"{tool} {fp}"
    elif tl in ('todowrite', 'todoread', 'update_plan', 'taskcreate', 'taskupdate', 'tasklist', 'taskget', 'taskview', 'todo', 'exitplanmode', 'enterplanmode'):
        kinds.add('plan')
        summary = tool
    elif tl in ('task', 'agent'):
        kinds.add('delegate')
        summary = f"{tool} {str(inp.get('description') or inp.get('prompt') or '')[:120]}"
    elif tl in ('bashoutput', 'taskoutput', 'taskstop', 'killshell'):
        kinds.add('poll')
        summary = tool
    elif tl in ('sendmessage', 'skill', 'askuserquestion'):
        kinds.add('other')
    else:
        kinds.add('other')
    return kinds, read_hits, edit_paths, summary


def parse_opencode(files, edited):
    reqs = []
    for f in files:
        cur = {'calls': [], 'has_text': False, 'text': ''}
        for d in jl(f):
            t = d.get('type')
            p = d.get('part') or {}
            if t == 'tool_use':
                st = p.get('state') or {}
                inp = st.get('input') or {}
                tool = p.get('tool') or 'tool'
                out = text_of(st.get('output')) if st.get('status') != 'error' else text_of(st.get('error') or st.get('output'))
                rec = {'tool': tool, 'kinds': set(), 'read_hits': set(), 'edit_paths': set(), 'err': st.get('status') == 'error',
                       'summary': '', 'out_hits': set(path_hits(out, edited)), 'out_bytes': len(out.encode('utf8', 'replace')), 'edit_fail': False}
                if tool == 'bash':
                    c = classify_shell(inp.get('command') or '', edited)
                    rec.update({'kinds': c['kinds'], 'read_hits': c['read_hits'], 'edit_paths': c['edit_paths']})
                    rec['summary'] = str(inp.get('command') or '').replace('\n', '\\n')[:220]
                else:
                    k, rh, ep, sm = classify_structured(tool, inp, edited, 'opencode')
                    rec.update({'kinds': k, 'read_hits': rh, 'edit_paths': ep, 'summary': sm})
                if 'edit' in rec['kinds'] and (rec['err'] or EDIT_FAIL_RE.search(out)):
                    rec['edit_fail'] = True
                cur['calls'].append(rec)
            elif t == 'text':
                txt = p.get('text') or d.get('text') or ''
                if str(txt).strip():
                    cur['has_text'] = True
                    cur['text'] += str(txt)[:400]
            elif t in ('step_finish', 'step-finish'):
                tk = p.get('tokens') or {}
                cache = tk.get('cache') or {}
                cr, cw = cache.get('read') or 0, cache.get('write') or 0
                cur['usage'] = usage_rec((tk.get('input') or 0) + cr + cw, cr, cw, (tk.get('output') or 0) + (tk.get('reasoning') or 0), tk.get('reasoning') or 0)
                reqs.append(cur)
                cur = {'calls': [], 'has_text': False, 'text': ''}
        if cur['calls'] or cur['has_text']:
            cur['usage'] = None
            reqs.append(cur)
    return reqs


def parse_claude(f, edited):
    """Return (requests, results_by_tool_use_id). Requests grouped by assistant message.id."""
    order, groups = [], {}
    results = {}
    for d in jl(f):
        m = d.get('message')
        if not m:
            continue
        if m.get('role') == 'user':
            for b in (m.get('content') if isinstance(m.get('content'), list) else []):
                if b.get('type') == 'tool_result':
                    s = text_of(b.get('content'))
                    results[b.get('tool_use_id')] = {'text': s, 'err': bool(b.get('is_error'))}
            continue
        if m.get('role') != 'assistant' or not m.get('id'):
            continue
        mid = m['id']
        g = groups.get(mid)
        if g is None:
            g = {'blocks': [], 'ids': set(), 'usage': None, 'best': -1, 'texts': set()}
            groups[mid] = g
            order.append(mid)
        for b in (m.get('content') or []):
            if b.get('type') == 'tool_use':
                if b.get('id') in g['ids']:
                    continue
                g['ids'].add(b.get('id'))
                g['blocks'].append(b)
            elif b.get('type') == 'text':
                key = str(b.get('text') or '')[:200]
                if key.strip() and key not in g['texts']:
                    g['texts'].add(key)
                    g['blocks'].append(b)
        u = m.get('usage')
        if u:
            cached = u.get('cache_read_input_tokens') or 0
            cw = u.get('cache_creation_input_tokens') or 0
            IN = (u.get('input_tokens') or 0) + cached + cw
            out = u.get('output_tokens') or 0
            if IN + out > g['best']:
                g['best'] = IN + out
                g['usage'] = usage_rec(IN, cached, cw, out, 0)
    reqs = []
    for mid in order:
        g = groups[mid]
        cur = {'calls': [], 'has_text': False, 'text': '', 'usage': g['usage'], 'mid': mid}
        for b in g['blocks']:
            if b.get('type') == 'text':
                cur['has_text'] = True
                cur['text'] += str(b.get('text') or '')[:400]
                continue
            inp = b.get('input') or {}
            tool = b.get('name') or 'tool'
            res = results.get(b.get('id')) or {'text': '', 'err': False}
            rec = {'tool': tool, 'kinds': set(), 'read_hits': set(), 'edit_paths': set(), 'err': res['err'],
                   'summary': '', 'out_hits': set(path_hits(res['text'], edited)), 'out_bytes': len(res['text'].encode('utf8', 'replace')),
                   'edit_fail': False, 'tool_use_id': b.get('id')}
            if tool in ('Bash',):
                c = classify_shell(inp.get('command') or '', edited)
                rec.update({'kinds': c['kinds'], 'read_hits': c['read_hits'], 'edit_paths': c['edit_paths']})
                rec['summary'] = str(inp.get('command') or '').replace('\n', '\\n')[:220]
            else:
                k, rh, ep, sm = classify_structured(tool, inp, edited, 'claude-code')
                rec.update({'kinds': k, 'read_hits': rh, 'edit_paths': ep, 'summary': sm})
            if 'edit' in rec['kinds'] and (rec['err'] or EDIT_FAIL_RE.search(res['text'])):
                rec['edit_fail'] = True
            cur['calls'].append(rec)
        reqs.append(cur)
    return reqs


# ------------------------------------------------------------ transcript location
def codex_file(row):
    rf = row.get('rolloutFile')
    return rf if rf and os.path.exists(rf) else None


def opencode_files(row):
    out = []
    for a in row.get('openCodeRawAttempts') or []:
        p = a.get('stdout')
        if not p:
            continue
        p = p if p.startswith('/') else os.path.join(ROOT, p)
        if os.path.exists(p):
            out.append(p)
    return out


def claude_cell(run, row):
    base = os.path.join(R, run, 'agent-state', f"{row['taskId']}-{row['arm']}", 'claude-home', 'projects')
    if not os.path.isdir(base):
        return None
    cands = []
    for d in os.listdir(base):
        m = re.search(r'(?:^|-)r(\d+)-+\d+$', d)
        if not m or int(m.group(1)) != row['rep']:
            continue
        for f in os.listdir(os.path.join(base, d)):
            if not f.endswith('.jsonl'):
                continue
            main = os.path.join(base, d, f)
            sid = f[:-6]
            subdir = os.path.join(base, d, sid, 'subagents')
            subs = sorted(glob.glob(os.path.join(subdir, 'agent-*.jsonl')))
            cands.append({'main': main, 'subs': subs})
    if not cands:
        return None
    if len(cands) == 1:
        return cands[0]
    # more than one invocation for this rep: pick the one whose aggregate usage matches the row
    ru = row.get('usage') or {}
    best, bd = None, float('inf')
    for c in cands:
        reqs = parse_claude(c['main'], [])
        out = sum((r['usage'] or {}).get('out', 0) for r in reqs)
        cr = sum((r['usage'] or {}).get('cached', 0) for r in reqs)
        d = abs(out - (ru.get('output_tokens') or 0)) + abs(cr - (ru.get('cache_read_input_tokens') or 0)) / 100
        if d < bd:
            bd, best = d, c
    best = dict(best)
    best['abandoned'] = len(cands) - 1
    return best


def load_patch(run, arm, rep, task):
    p = os.path.join(R, run, arm, 'patches.json') if rep == 0 else os.path.join(R, run, arm, f'rep-{rep}', 'patches.json')
    try:
        for e in json.load(open(p)):
            if e.get('instance_id') == task:
                return e.get('patch') or ''
    except Exception:
        return None
    return ''


# ------------------------------------------------------------------ segmentation
def segment(reqs, edited):
    n = len(reqs)
    first_read = first_sight = first_edit = last_tool = None
    for i, r in enumerate(reqs):
        has_tool = bool(r['calls'])
        if has_tool:
            last_tool = i
        for c in r['calls']:
            if first_read is None and 'read' in c['kinds'] and c['read_hits']:
                first_read = i
            if first_sight is None and (c['out_hits'] or c['read_hits'] or c['edit_paths']):
                first_sight = i
            if first_edit is None and 'edit' in c['kinds']:
                first_edit = i
    phases = []
    for i, r in enumerate(reqs):
        has_tool = bool(r['calls'])
        has_edit = any('edit' in c['kinds'] for c in r['calls'])
        fr = first_read if first_read is not None else (first_edit if first_edit is not None else n)
        if first_edit is not None and i >= first_edit:
            if has_edit:
                ph = 'edit'
            elif has_tool:
                ph = 'verify'
            else:
                ph = 'finalize' if (last_tool is None or i > last_tool) else 'narrate'
        else:
            if i < fr:
                ph = 'localize'
            else:
                ph = 'understand'
            if not has_tool and (last_tool is None or i > last_tool):
                ph = 'finalize'
        phases.append(ph)
    return phases, {'first_read': first_read, 'first_sight': first_sight, 'first_edit': first_edit, 'last_tool': last_tool}


def price(reqs):
    """Attach per-request newIn/resent/cost. Ingest = tokens that entered context this request."""
    prev = 0
    for r in reqs:
        u = r.get('usage')
        if not u:
            r['newIn'] = r['resent'] = 0
            r['cost'] = r['realized'] = 0.0
            continue
        IN = u['in']
        newIn = max(0, IN - prev)
        resent = IN - newIn
        r['newIn'], r['resent'] = newIn, resent
        r['cost'] = (newIn * PRICE['in'] + resent * PRICE['cache'] + u['out'] * PRICE['out']) / 1e6
        r['realized'] = ((IN - u['cached']) * PRICE['in'] + u['cached'] * PRICE['cache'] + u['out'] * PRICE['out']) / 1e6
        prev = IN


def analyse_rollout(harness, run, row, transcript_info):
    task, arm, rep = row['taskId'], row['arm'], row['rep']
    patch = load_patch(run, arm, rep, task)
    edited = patch_files(patch) if patch else []
    if harness == 'codex':
        reqs = parse_codex(transcript_info['file'], edited)
        transcript = transcript_info['file']
    elif harness == 'opencode':
        reqs = parse_opencode(transcript_info['files'], edited)
        transcript = transcript_info['files'][0] if transcript_info['files'] else None
    else:
        reqs = parse_claude(transcript_info['main'], edited)
        transcript = transcript_info['main']
    price(reqs)
    phases, marks = segment(reqs, edited)
    # sidechains (claude): attribute to the parent's phase
    side = {ph: {'req': 0, 'newIn': 0, 'resent': 0, 'out': 0, 'cost': 0.0, 'no_usage': 0, 'calls': 0} for ph in PHASES}
    side_files = 0
    if harness == 'claude-code':
        tu_to_idx = {}
        for i, r in enumerate(reqs):
            for c in r['calls']:
                if c.get('tool_use_id'):
                    tu_to_idx[c['tool_use_id']] = i
        for sf in transcript_info.get('subs') or []:
            side_files += 1
            meta = {}
            try:
                meta = json.load(open(sf[:-6] + '.meta.json'))
            except Exception:
                pass
            pidx = tu_to_idx.get(meta.get('toolUseId'))
            ph = phases[pidx] if pidx is not None else ('localize' if marks['first_edit'] is None else 'verify')
            sreqs = parse_claude(sf, edited)
            price(sreqs)
            for sr in sreqs:
                side[ph]['req'] += 1
                side[ph]['calls'] += len(sr['calls'])
                if not sr.get('usage'):
                    side[ph]['no_usage'] += 1
                    continue
                side[ph]['newIn'] += sr['newIn']
                side[ph]['resent'] += sr['resent']
                side[ph]['out'] += sr['usage']['out']
                side[ph]['cost'] += sr['cost']
    per_phase = {ph: {'req': 0, 'newIn': 0, 'resent': 0, 'out': 0, 'reasoning': 0, 'cost': 0.0, 'realized': 0.0, 'calls': 0,
                      'classes': collections.Counter(), 'edit_fails': 0, 'err_calls': 0, 'out_bytes': 0} for ph in PHASES}
    req_rows = []
    for i, (r, ph) in enumerate(zip(reqs, phases)):
        kinds = set()
        for c in r['calls']:
            kinds |= c['kinds']
        k = klass_of(kinds, r['has_text'])
        u = r.get('usage') or {}
        pp = per_phase[ph]
        pp['req'] += 1
        pp['newIn'] += r['newIn']
        pp['resent'] += r['resent']
        pp['out'] += u.get('out', 0)
        pp['reasoning'] += u.get('reasoning', 0)
        pp['cost'] += r['cost']
        pp['realized'] += r['realized']
        pp['calls'] += len(r['calls'])
        pp['classes'][k] += 1
        pp['edit_fails'] += sum(1 for c in r['calls'] if c.get('edit_fail'))
        pp['err_calls'] += sum(1 for c in r['calls'] if c.get('err'))
        pp['out_bytes'] += sum(c.get('out_bytes', 0) for c in r['calls'])
        req_rows.append({'i': i, 'phase': ph, 'class': k, 'n_calls': len(r['calls']),
                         'tools': [c['tool'] for c in r['calls']],
                         'call_kinds': [sorted(c['kinds']) for c in r['calls']],
                         'call_err': [bool(c['err']) for c in r['calls']],
                         'call_bytes': [c.get('out_bytes', 0) for c in r['calls']],
                         'summ': [c['summary'] for c in r['calls']][:4],
                         'read_hits': sorted(set().union(*[c['read_hits'] for c in r['calls']]) if r['calls'] else set()),
                         'edit_paths': sorted(set().union(*[c['edit_paths'] for c in r['calls']]) if r['calls'] else set()),
                         'err': any(c['err'] for c in r['calls']), 'edit_fail': any(c.get('edit_fail') for c in r['calls']),
                         'in': u.get('in', 0), 'cached': u.get('cached', 0), 'out': u.get('out', 0), 'reasoning': u.get('reasoning', 0),
                         'newIn': r['newIn'], 'resent': r['resent'], 'cost': round(r['cost'], 7),
                         'text': (r['text'] or '')[:160]})
    for ph in PHASES:
        per_phase[ph]['classes'] = dict(per_phase[ph]['classes'])
    no_usage = sum(1 for r in reqs if not r.get('usage'))
    return {'harness': harness, 'run': run, 'task': task, 'arm': arm, 'rep': rep, 'resolved': row.get('resolved') is True,
            'rid': f"{harness}/{task}/{arm}/rep{rep}", 'transcript': transcript, 'abandoned': transcript_info.get('abandoned', 0),
            'edited': edited, 'patch_nonempty': bool(patch), 'never_read': marks['first_read'] is None and bool(edited),
            'edit_undetected': marks['first_edit'] is None and bool(patch),
            'marks': marks, 'n_req': len(reqs), 'n_req_no_usage': no_usage,
            'n_calls': sum(len(r['calls']) for r in reqs),
            'row_calls': row.get('calls'), 'row_idealTurns': row.get('idealTurns'), 'row_cost': row.get('costRealizedUsd'),
            'row_ideal': row.get('idealCostUsd'), 'tot_in': sum((r.get('usage') or {}).get('in', 0) for r in reqs),
            'tot_out': sum((r.get('usage') or {}).get('out', 0) for r in reqs),
            'tot_newIn': sum(r['newIn'] for r in reqs), 'tot_resent': sum(r['resent'] for r in reqs),
            'tot_cost': sum(r['cost'] for r in reqs), 'tot_realized': sum(r['realized'] for r in reqs),
            'first_req_in': (reqs[0].get('usage') or {}).get('in', 0) if reqs else 0,
            'per_phase': per_phase, 'side': side, 'side_files': side_files, 'requests': req_rows}


# ------------------------------------------------------------------ main
def load_rows(harness):
    cfg = HARN[harness]
    rows = json.load(open(os.path.join(R, cfg['run'], 'rows.json')))
    for r in rows:
        r['_run'] = cfg['run']
    note = None
    if 'repair' in cfg:
        rep_tasks = set(l.strip() for l in open(cfg['repair_tasks']) if l.strip())
        before = len(rows)
        rows = [r for r in rows if not (r['arm'] == 'sweet' and r['taskId'] in rep_tasks)]
        rrows = json.load(open(os.path.join(R, cfg['repair'], 'rows.json')))
        for r in rrows:
            if r['arm'] == 'sweet' and r['taskId'] in rep_tasks:
                r['_run'] = cfg['repair']
                rows.append(r)
        note = f"opencode: replaced {before - len([r for r in rows if r['_run'] == cfg['run']])} fp sweet rows of {len(rep_tasks)} repair tasks with {len([r for r in rows if r['_run'] == cfg['repair']])} rp-oc-tab sweet rows"
    return rows, note


def main():
    os.makedirs(OUT, exist_ok=True)
    result = {'harnesses': {}, 'notes': []}
    for harness in HARN:
        rows, note = load_rows(harness)
        if note:
            result['notes'].append(note)
        by = collections.defaultdict(list)
        for r in rows:
            by[(r['taskId'], r['arm'])].append(r)
        tasks = sorted(set(r['taskId'] for r in rows))
        matrix = {}
        for t in tasks:
            n = by.get((t, 'native'), [])
            s = by.get((t, 'sweet'), [])
            matrix[t] = {'native': (sum(1 for r in n if r['resolved'] is True), len(n)),
                         'sweet': (sum(1 for r in s if r['resolved'] is True), len(s))}
        solved_everywhere = [t for t in tasks if matrix[t]['native'] == (3, 3) and matrix[t]['sweet'] == (3, 3)]
        sel = solved_everywhere if ONLY_SOLVED_EVERYWHERE else tasks
        rollouts, problems = [], []
        for t in sel:
            for arm in ('native', 'sweet'):
                for row in sorted(by[(t, arm)], key=lambda r: r['rep']):
                    run = row['_run']
                    if harness == 'codex':
                        f = codex_file(row)
                        info = {'file': f} if f else None
                    elif harness == 'opencode':
                        fl = opencode_files(row)
                        info = {'files': fl} if fl else None
                    else:
                        info = claude_cell(run, row)
                    if not info:
                        problems.append(f"{harness} {t} {arm} rep{row['rep']}: transcript not found")
                        continue
                    try:
                        rollouts.append(analyse_rollout(harness, run, row, info))
                    except Exception as e:
                        problems.append(f"{harness} {t} {arm} rep{row['rep']}: {type(e).__name__} {e}")
        result['harnesses'][harness] = {'runs': HARN[harness], 'n_rows': len(rows), 'tasks': tasks, 'matrix': matrix,
                                        'solved_everywhere': solved_everywhere, 'selected': sel,
                                        'problems': problems, 'rollouts': rollouts}
        sys.stderr.write(f"{harness}: rows={len(rows)} tasks={len(tasks)} solved_everywhere={len(solved_everywhere)} rollouts={len(rollouts)} problems={len(problems)}\n")
    suffix = '' if ONLY_SOLVED_EVERYWHERE else '-alltasks'
    with open(os.path.join(OUT, f'anatomy{suffix}.json'), 'w') as fo:
        json.dump(result, fo)
    sys.stderr.write(f"wrote {OUT}/anatomy{suffix}.json\n")


if __name__ == '__main__':
    main()
