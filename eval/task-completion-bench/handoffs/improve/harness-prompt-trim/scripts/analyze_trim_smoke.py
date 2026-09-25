#!/usr/bin/env python3
"""Step D report for the CC_HARNESS_TRIM smoke: sweet as now (trim=None) v sweet + TRIM.

    analyze_trim_smoke.py results/<run1> results/<run2> ...

Per condition and per task: solves, realized and ideal cost (harness columns), first-request
tokens, cache-write tokens, retrieval-phase v fix-phase cost (split at the first edit, as in
phase_split.py), and calls before the first edit: ss-*, shell search, shell read, Read tool,
subagent requests. 12 rollouts give a direction, not a finding.
"""
import collections, glob, json, re, statistics as st, sys

P = {'in': 4.0, 'cr': 0.20, 'cw': 5.0, 'out': 20.0}  # Opus 5.5 list, cache write 1.25x
EDIT_TOOLS = {'Edit', 'Write', 'MultiEdit', 'NotebookEdit'}
EDIT_BASH = re.compile(r"sed\s+-i|perl\s+-p?i|\btee\b|cat\s*>|>\s*[\w./-]+\.\w+\s*<<|<<\s*'?EOF'?\s*>|\bpatch\b|git\s+apply|python3?\s+-\s*<<|\.write\(|open\([^)]*['\"]w")
SS = re.compile(r"(^|[\s;&|(])(ss[-_](search|grep|find|read|semantic|trace|batch)|sweet-search)\b")
SEARCH = re.compile(r"(^|[\s;&|(])(rg|grep|egrep|find|fd|ag|ack|git\s+grep|ls)\b")
READ = re.compile(r"(^|[\s;&|(])(cat|head|tail|sed\s+-n|nl|less|more|awk)\b")


def transcript_split(run, label):
    files = [f for f in glob.glob(f'{run}/agent-state/{label}/claude-home/projects/*/*.jsonl')]
    if not files:
        return None
    main = max(files, key=lambda f: sum(1 for _ in open(f)))  # the session, not a sidechain
    seen, pre, post, edited = set(), 0.0, 0.0, False
    c = collections.Counter()
    first_in = None
    for line in open(main):
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get('type') != 'assistant':
            continue
        m = r.get('message') or {}
        mid = m.get('id') or r.get('requestId')
        is_edit = False
        for b in m.get('content') if isinstance(m.get('content'), list) else []:
            if b.get('type') != 'tool_use':
                continue
            inp = b.get('input') or {}
            cmd = str(inp.get('command', ''))
            name = b.get('name')
            if not edited:
                if name == 'Bash':
                    if SS.search(cmd): c['ss'] += 1
                    elif SEARCH.search(cmd): c['shellSearch'] += 1
                    elif READ.search(cmd): c['shellRead'] += 1
                    else: c['bashOther'] += 1
                elif name == 'Read': c['readTool'] += 1
                elif name in ('Agent', 'Task'): c['subagent'] += 1
                else: c[f'tool:{name}'] += 1
            if name in EDIT_TOOLS or (name == 'Bash' and EDIT_BASH.search(cmd)):
                is_edit = True
        if mid and mid in seen:
            if is_edit: edited = True
            continue
        if mid: seen.add(mid)
        u = m.get('usage') or {}
        if first_in is None:
            first_in = u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0)
        cost = (u.get('input_tokens', 0) * P['in'] + u.get('cache_read_input_tokens', 0) * P['cr']
                + u.get('cache_creation_input_tokens', 0) * P['cw'] + u.get('output_tokens', 0) * P['out']) / 1e6
        if edited: post += cost
        else: pre += cost
        if is_edit: edited = True
    subagent_files = len(files) - 1
    return dict(pre=pre, post=post, firstIn=first_in, calls=c, sidechainFiles=subagent_files)


CMD_IN_JS = re.compile(r'cmd:\s*"((?:[^"\\]|\\.)*)"')


def codex_split(run, label):
    """Codex session log: shell commands per call, before the first edit. Luna runs Codex in
    "code mode", where every call is JavaScript inside one `exec` tool, so rows.toolCounts
    counts ss-* as 0; read the commands out of the call bodies instead."""
    files = sorted(glob.glob(f'{run}/agent-state/{label}/codex-home/sessions/**/*.jsonl', recursive=True))
    if not files:
        return None
    c, edited = collections.Counter(), False
    for f in files:
        for line in open(f):
            if not line.strip():
                continue
            p = json.loads(line).get('payload') or {}
            if p.get('type') not in ('function_call', 'custom_tool_call'):
                continue
            body = str(p.get('arguments') or p.get('input') or '')
            if 'apply_patch' in body or '*** Begin Patch' in body:
                edited = True
                continue
            cmds = [bytes(m, 'utf8').decode('unicode_escape') for m in CMD_IN_JS.findall(body)]
            if not cmds:
                try: cmds = [json.loads(body).get('cmd', '')]
                except Exception: cmds = []
            if edited:
                continue
            for cmd in cmds:
                if not cmd: continue
                if SS.search(cmd): c['ss'] += 1
                elif re.search(r'(^|\s)run_tests\b', cmd): c['runTests'] += 1
                elif SEARCH.search(cmd): c['shellSearch'] += 1
                elif READ.search(cmd): c['shellRead'] += 1
                else: c['bashOther'] += 1
    return dict(pre=0.0, post=0.0, firstIn=None, calls=c, sidechainFiles=0)


rows = []
for run in sys.argv[1:]:
    for r in json.load(open(f'{run}/rows.json')):
        r['_run'] = run
        rows.append(r)

by = collections.defaultdict(list)
for r in rows:
    cond = 'TRIM' if r.get('harnessTrim') else 'as-now'
    lbl = f"{r['taskId']}-{r['arm']}"
    s = transcript_split(r['_run'], lbl) if r.get('harness') == 'claudecode' else codex_split(r['_run'], lbl) if r.get('harness') == 'codex' else None
    by[cond].append((r, s))

print('# per rollout')
print('cond    task                              rep resolved  realized   ideal  firstIn  cacheW  pre$   post$  ss shS shR Read sub')
for cond in ('as-now', 'TRIM'):
    for r, s in sorted(by[cond], key=lambda x: (x[0]['taskId'], x[0]['_run'])):
        c = (s or {}).get('calls', {})
        print(f"{cond:7} {r['taskId'][:33]:33} {r['_run'][-2:]:>3} {str(r.get('resolved')):8} "
              f"{r.get('costRealizedUsd') or 0:8.4f} {r.get('idealCostUsd') or 0:7.4f} {(s or {}).get('firstIn') or 0:8} "
              f"{r.get('cacheWriteTokens') or 0:7} {(s or {}).get('pre', 0):6.3f} {(s or {}).get('post', 0):6.3f} "
              f"{c.get('ss', 0):3} {c.get('shellSearch', 0):3} {c.get('shellRead', 0):3} {c.get('readTool', 0):4} {c.get('subagent', 0):3}")

print('\n# per condition (sums over rollouts; solve count first)')
for cond in ('as-now', 'TRIM'):
    xs = by[cond]
    if not xs: continue
    tot = lambda k: sum((r.get(k) or 0) for r, _ in xs)
    cs = collections.Counter()
    for _, s in xs:
        if s: cs.update(s['calls'])
    fi = [s['firstIn'] for _, s in xs if s and s['firstIn']]
    print(f"{cond:7} n={len(xs)} solved={sum(1 for r, _ in xs if r.get('resolved'))} "
          f"realized=${tot('costRealizedUsd'):.3f} ideal=${tot('idealCostUsd'):.3f} cacheWrite={tot('cacheWriteTokens')} "
          f"firstIn(median)={st.median(fi) if fi else None} pre=${sum((s or {}).get('pre', 0) for _, s in xs):.3f} "
          f"post=${sum((s or {}).get('post', 0) for _, s in xs):.3f} | before first edit: ss={cs['ss']} "
          f"shellSearch={cs['shellSearch']} shellRead={cs['shellRead']} Read={cs['readTool']} subagent={cs['subagent']} "
          f"sidechainFiles={sum((s or {}).get('sidechainFiles', 0) for _, s in xs)}")
    # Whole-rollout counts from the rows (every harness; the only call split for codex/opencode,
    # whose transcripts this script does not parse).
    tc = collections.Counter()
    for r, _ in xs: tc.update({k: v for k, v in (r.get('toolCounts') or {}).items() if isinstance(v, (int, float))})
    print(f"        whole rollout (rows.toolCounts): {dict(tc)}  calls={tot('calls')} stepsToFirstEdit={tot('stepsToFirstEdit')}")

print('\n# solve flips per task (as-now reps -> TRIM reps)')
tasks = sorted({r['taskId'] for c in by.values() for r, _ in c})
for t in tasks:
    a = [bool(r.get('resolved')) for r, _ in by['as-now'] if r['taskId'] == t]
    b = [bool(r.get('resolved')) for r, _ in by['TRIM'] if r['taskId'] == t]
    print(f'{t:40} as-now {sum(a)}/{len(a)}  TRIM {sum(b)}/{len(b)}')
print('\nPre-registered diet-only expectation (FINDINGS-STEP-A.md §5): Claude Code TRIM about -14% realized, -21% ideal (Opus 5.5 medium).')
