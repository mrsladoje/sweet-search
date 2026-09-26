"""Per-rollout integrity + behaviour parser for Claude Code harness-trim runs.
Usage: parse.py > rollouts.json   (reads the run list below)"""
import glob, hashlib, json, os, re, sys
R = '/Users/admin/Projects/sweet-search-private/eval/task-completion-bench/results'
RUNS = [
    # (run dir, backbone, leg label, contaminated)
    ('trim-smoke-claudecode-20260925-1915-asnow-r1', 'opus', 'S0-asnow-r1', True),
    ('trim-smoke-claudecode-20260925-1915-trim-r1', 'opus', 'S0-trim-r1', True),
    ('trim-smoke-claudecode-20260925-1915-trim-r2', 'opus', 'S0-trim-r2', True),
    ('trim-smoke-claudecode-20260925-1915-asnow-r2', 'opus', 'S0-asnow-r2', True),
] + [(f'hsmoke-claudecode-20260926-0031-L{i}', 'opus', f'S1-L{i}', False) for i in range(1, 5)] \
  + [(f'hsmoke-claudecode-20260926-0343-L{i}', 'opus', f'C1-L{i}', False) for i in range(1, 5)] \
  + [(f'hsmoke-claudecode-20260926-0907-L{i}', 'opus', f'C2-L{i}', False) for i in range(1, 3)] \
  + [(f'hsmoke-claudecode-luna-20260925-2153-L{i}', 'luna', f'LS1-L{i}', False) for i in range(1, 5)] \
  + [(f'hsmoke-claudecode-luna-20260926-0227-L{i}', 'luna', f'LS2-L{i}', False) for i in range(1, 3)] \
  + [(f'hsmoke-claudecode-luna-20260926-1000-L{i}', 'luna', f'LC1-L{i}', False) for i in range(1, 5)] \
  + [(f'hsmoke-claudecode-luna-20260926-1525-L{i}', 'luna', f'LC2-L{i}', False) for i in range(1, 3)]

sys.path.insert(0, os.path.dirname(__file__))
from prompts import EXPECT  # expected system block 0 per mode

SS = re.compile(r'^(ss[-_](search|grep|find|read|semantic|trace|files)|sweet-search)\b')
SEARCH = re.compile(r'^(rg|grep|egrep|fgrep|ag|ack|find|fd|ls|tree|git (grep|ls-files))\b')
READ = re.compile(r'^(cat|head|tail|nl|less|more|awk|sed -n|sed\s+-n|git show|bat|wc)\b')
HEREDOC = re.compile(r"<<-?\s*['\"]?(\w+)['\"]?")

def strip_heredocs(cmd):
    out, lines, i = [], cmd.split('\n'), 0
    bodies = []
    while i < len(lines):
        ln = lines[i]; out.append(ln); m = HEREDOC.search(ln)
        if m:
            term = m.group(1); body = []; i += 1
            while i < len(lines) and lines[i].strip() != term:
                body.append(lines[i]); i += 1
            bodies.append('\n'.join(body))
        i += 1
    return '\n'.join(out), bodies

def segments(cmd):
    head, bodies = strip_heredocs(cmd)
    segs = [s.strip() for s in re.split(r'\n|&&|\|\||;|\|', head) if s.strip()]
    segs = [re.sub(r'^(\(|\{|then |do |else |time |timeout \d+ )+', '', s).strip() for s in segs]
    return segs, bodies

def shell_edit(cmd, segs, bodies):
    if re.search(r'\bsed\s+(-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-z]*i|\bapply_patch\b|\bgit apply\b|\bpatch\s+-p', cmd):
        return True
    for b in bodies:
        if re.search(r"write_text|writeFileSync|open\([^)]*['\"]w|\.write\(|replace\(", b) and re.search(r'python|node', cmd):
            return True
    for s in segs:
        if re.match(r'^(node|python3?|ruby|perl)\s+-[ec]\b', s): continue
        for m in re.finditer(r'(?:^|\s)(?:\d)?>>?\s*([^\s&|;<>]+)', s):
            tgt = m.group(1)
            if tgt.startswith(('/dev/', '/tmp', '&')) or tgt in ('/dev/null',): continue
            if re.search(r'[\w-]+\.\w+$|/', tgt): return True
        if re.match(r'^tee\b', s): return True
    return False

def classify_bash(cmd):
    segs, bodies = segments(cmd)
    heads = [re.sub(r'^cd\s+\S+\s*', '', s) for s in segs]
    heads = [h for h in heads if h and not h.startswith('cd ')]
    cls = set()
    for h in heads:
        if h.startswith('run_tests'): cls.add('run_tests')
        elif SS.match(h): cls.add('ss')
        elif SEARCH.match(h): cls.add('shell_search')
        elif READ.match(h): cls.add('shell_read')
        elif re.match(r'^git add\b', h): cls.add('git_add')
        elif re.match(r'^git\b', h): cls.add('git')
    if shell_edit(cmd, segs, bodies): cls.add('shell_edit')
    # primary class for counting
    for p in ('shell_edit', 'run_tests', 'ss', 'shell_search', 'shell_read', 'git_add', 'git'):
        if p in cls: return p, cls
    return 'shell_other', cls

def text_of(content):
    if isinstance(content, str): return content
    return '\n'.join(x.get('text', '') for x in content if isinstance(x, dict))

VERD = re.compile(r'\[run_tests verdict\] status=(\w+)(?: scope=(\w+))?(?: exit=(-?\d+))?')
BD = re.compile(r'introduced_failures=(\d+)')
GUID = re.compile(r'\[run_tests guidance\][^\n]*action=([\w-]+)')

def load(f):
    out = []
    for l in open(f):
        try: out.append(json.loads(l))
        except Exception: pass
    return out

def parse_session(recs):
    info = {'sys0': None, 'sysN': None, 'attach': {}, 'instr': [], 'agentTypes': None, 'autoMode': None,
            'gitStatus': None, 'memorySection': False, 'totalTokens': False}
    calls, uses, results, turns, texts = [], {}, {}, set(), []
    order = []  # sequence of events: ('call', idx) or ('text', str)
    for r in recs:
        t = r.get('type')
        if t == 'attachment':
            a = r['attachment']; info['attach'][a['type']] = info['attach'].get(a['type'], 0) + 1
            if a['type'] == 'prompt_snapshot' and info['sys0'] is None:
                sp = a['systemPrompt']; info['sys0'] = sp[0]; info['sysN'] = len(sp); info['sysAll'] = sp
                info['memorySection'] = any(s.startswith('# Memory') for s in sp)
                info['totalTokens'] = any('<total_tokens>' in s for s in sp)
            elif a['type'] == 'instructions':
                info['instr'] += [(x['path'], hashlib.sha256(x['content'].encode()).hexdigest()[:12], len(x['content'])) for x in a['files']]
            elif a['type'] == 'agent_listing_delta' and info['agentTypes'] is None:
                info['agentTypes'] = a.get('addedTypes'); info['agentLines'] = a.get('addedLines')
            elif a['type'] == 'auto_mode':
                info['autoMode'] = {k: a.get(k) for k in ('bashFirst', 'bashFirstSteer', 'bypass')}
            elif a['type'] == 'session_context':
                info['gitStatus'] = bool((a.get('context') or {}).get('gitStatus'))
            continue
        m = r.get('message') or {}
        c = m.get('content')
        if m.get('role') == 'assistant':
            if m.get('id'): turns.add(m['id'])
            if isinstance(c, list):
                for b in c:
                    if b.get('type') == 'tool_use':
                        calls.append({'id': b['id'], 'name': b['name'], 'input': b.get('input', {})})
                        order.append(('call', len(calls) - 1))
                    elif b.get('type') == 'text' and b.get('text', '').strip():
                        order.append(('text', b['text'])); texts.append(b['text'])
        elif m.get('role') == 'user' and isinstance(c, list):
            for b in c:
                if b.get('type') == 'tool_result':
                    results[b.get('tool_use_id')] = (text_of(b.get('content', '')), bool(b.get('is_error')))
    return info, calls, results, len(turns), order, texts

def classify_call(c):
    n = c['name']
    if n == 'Bash':
        p, cls = classify_bash(c['input'].get('command', ''))
        return p, cls
    if n in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit'): return 'edit_tool', {'edit_tool'}
    if n == 'Read': return 'read_tool', {'read_tool'}
    if n in ('Agent', 'Task'): return 'subagent', {'subagent'}
    return 'tool_' + n, {n}

def rollout(run, backbone, leg, contaminated, row, cell):
    mains = sorted(glob.glob(f'{cell}/claude-home/projects/*/*.jsonl'), key=os.path.getmtime)
    if not mains: return None
    kept = mains[-1]
    info, calls, results, nturns, order, texts = parse_session(load(kept))
    sid = os.path.basename(kept)[:-6]
    subdir = os.path.join(os.path.dirname(kept), sid, 'subagents')
    subs = []
    for sf in sorted(glob.glob(subdir + '/*.jsonl')):
        meta = {}
        mf = sf[:-6] + '.meta.json'
        if os.path.exists(mf): meta = json.load(open(mf))
        si, sc, sr, sturns, _, _ = parse_session(load(sf))
        prim = {}
        for c in sc:
            p, _ = classify_call(c); prim[p] = prim.get(p, 0) + 1
        subs.append({'agentType': meta.get('agentType'), 'model': meta.get('model'), 'desc': meta.get('description'),
                     'worktree': bool(meta.get('spawnedWithWorktree')), 'shape': meta.get('requestShape'),
                     'turns': sturns, 'calls': len(sc), 'callClasses': prim, 'sys0': (si['sys0'] or '')[:80],
                     'sysN': si['sysN'], 'instr': [p for p, _, _ in si['instr']], 'edits': sum(1 for c in sc if classify_call(c)[0] in ('edit_tool', 'shell_edit'))})
    # behaviour
    cls_seq = [classify_call(c) for c in calls]
    first_edit = next((i for i, (p, s) in enumerate(cls_seq) if p in ('edit_tool', 'shell_edit') or 'shell_edit' in s), None)
    before, after = {}, {}
    for i, (p, s) in enumerate(cls_seq):
        d = before if first_edit is None or i < first_edit else after
        d[p] = d.get(p, 0) + 1
    # run_tests verdicts
    rts = []
    for i, c in enumerate(calls):
        if c['name'] == 'Bash' and 'run_tests' in cls_seq[i][1]:
            txt = results.get(c['id'], ('', False))[0]
            v = VERD.findall(txt); bd = BD.findall(txt); g = GUID.findall(txt)
            cmd = c['input'].get('command', '')
            rts.append({'i': i, 'cmd': cmd[:160], 'status': v[-1][0] if v else ('BG' if c['input'].get('run_in_background') else 'NONE'),
                        'scope': v[-1][1] if v else None, 'exit': v[-1][2] if v else None,
                        'introduced': int(bd[-1]) if bd else None, 'action': g[-1] if g else None,
                        'bg': bool(c['input'].get('run_in_background')), 'zeroTests': bool(re.search(r'Tests:\s+\d+ skipped, \d+ total|Tests:\s+0 total|no tests ran|No tests found|0 passing|ran 0 tests|testing: warning: no tests to run', txt))})
    # what came right after each FAIL verdict
    after_fail = []
    for rt in rts:
        if rt['status'] != 'FAIL': continue
        pos = next(k for k, e in enumerate(order) if e == ('call', rt['i']))
        nxt = order[pos + 1] if pos + 1 < len(order) else ('end', None)
        if nxt[0] == 'text':
            nxt2 = order[pos + 2] if pos + 2 < len(order) else ('end', None)
            after_fail.append('text->end' if nxt2[0] == 'end' else 'text->call')
        else:
            after_fail.append(nxt[0])
    last_full = [r for r in rts if r['scope'] == 'full']
    # new files: Write results saying "created"
    created = []
    for c in calls:
        if c['name'] == 'Write':
            res = results.get(c['id'], ('', False))[0]
            if re.search(r'File created successfully|created successfully', res):
                created.append(c['input'].get('file_path'))
    # shell-created files (heredoc cat > new) are not detected; note git add usage
    git_adds = [c['input'].get('command', '')[:120] for c in calls if c['name'] == 'Bash' and re.search(r'\bgit add\b', c['input'].get('command', ''))]
    rundir_m = re.search(r'/\.ss-eval/runs/[^/]+', kept.replace('-Users-admin--ss-eval-runs-', '/.ss-eval/runs/'))
    patch = ''
    pf = f'{R}/{run}/preds-sweet.jsonl'
    if os.path.exists(pf):
        for l in open(pf):
            p = json.loads(l)
            if p.get('instance_id') == row.get('taskId'): patch = p.get('model_patch') or ''
    patch_files = re.findall(r'^diff --git a/(\S+)', patch, re.M)
    created_rel = [re.sub(r'^.*?/\.ss-eval/runs/r[^/]+/', '', x or '') for x in created]
    lost = [x for x in created_rel if x and x not in patch_files and not x.startswith(('/', '.claude', 'CLAUDE'))]
    final = next((e[1] for e in reversed(order) if e[0] == 'text'), '')
    return {
        'run': run, 'leg': leg, 'backbone': backbone, 'contaminated': contaminated,
        'task': row.get('taskId'), 'trim': row.get('harnessTrim'), 'resolved': (None if row.get('resolved') is None else bool(row.get('resolved'))),
        'resolveStatus': row.get('resolveStatus'), 'exitReason': row.get('exitReason'),
        'degenReran': row.get('degenReran'), 'degenerate': row.get('degenerate'), 'startRetried': row.get('startRetried'),
        'wallMin': round((row.get('wallMs') or 0) / 60000, 1), 'attempts': len(mains),
        'claudeConfigDir': bool(row.get('claudeConfigDir')),
        'costRealized': row.get('costRealizedUsd'), 'costIdeal': row.get('idealCostUsd'),
        'costRealizedMain': row.get('costRealizedMainOnlyUsd'), 'sidechainTurns': row.get('sidechainTurns'),
        'sidechainCount': row.get('sidechainCount'), 'sidechainAccountingComplete': row.get('sidechainAccountingComplete'),
        'turns': nturns, 'calls': len(calls), 'firstEdit': first_edit, 'before': before, 'after': after,
        'rts': rts, 'afterFail': after_fail, 'lastFull': last_full[-1]['status'] if last_full else None,
        'lastRt': rts[-1]['status'] if rts else None, 'created': created_rel, 'lostNewFiles': lost, 'gitAdds': git_adds,
        'patchFiles': patch_files, 'final': final[-600:],
        'sys0sha': hashlib.sha256((info['sys0'] or '').encode()).hexdigest()[:12], 'sys0head': (info['sys0'] or '')[:60],
        'sysMode': EXPECT.get(hashlib.sha256((info['sys0'] or '').encode()).hexdigest(), 'ANTHROPIC' if (info['sys0'] or '').lstrip().startswith('You are an interactive agent') else 'UNKNOWN'),
        'sysN': info['sysN'], 'memorySection': info['memorySection'], 'totalTokensSys': info['totalTokens'],
        'attach': info['attach'], 'autoMode': info['autoMode'], 'gitStatus': info['gitStatus'],
        'agentTypes': info['agentTypes'], 'instr': info['instr'],
        'toolsUsed': sorted({c['name'] for c in calls}),
        'agentCalls': [{k: c['input'].get(k) for k in ('subagent_type', 'run_in_background', 'isolation', 'model', 'description')} for c in calls if c['name'] in ('Agent', 'Task')],
        'subs': subs,
    }

def main():
  out = []
  for run, bb, leg, cont in RUNS:
      rf = f'{R}/{run}/rows.json'
      if run.endswith('0343-L1'): rf = f'{R}/{run}/rows.json'  # regraded rows live here (orig kept aside)
      rows = {r['taskId']: r for r in json.load(open(rf))}
      for cell in sorted(glob.glob(f'{R}/{run}/agent-state/*-sweet')):
          task = os.path.basename(cell)[:-6]
          if task not in rows: continue  # rollout still in progress
          x = rollout(run, bb, leg, cont, rows[task], cell)
          if x: out.append(x)
  json.dump(out, sys.stdout, indent=1)

if __name__ == '__main__': main()