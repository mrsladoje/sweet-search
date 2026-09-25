#!/usr/bin/env python3
"""OFF v ON comparison of the opencode sweet-arm trim captures (OC_HARNESS_TRIM).

  python3 compare_oc_trim.py
Reads captures/opencode-1.18.4-request-sweet-trim-{off,on}-<family>.json.
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
C = os.path.join(HERE, '..', 'captures')
T = os.path.normpath(os.path.join(HERE, '../../../../harness/trim'))
STEER = {
    'glob-grep-first (gpt prompt)': 'prefer using Glob and Grep',
    'task-for-file-search (prompt)': 'When doing file search, prefer to use the Task tool',
    'task-CRITICAL (prompt)': 'CRITICAL that you use the Task tool',
    'proactive-task (prompt)': 'proactively use the Task tool',
    'read-not-cat (prompt)': 'Read for reading files instead of cat',
    'bash-exclusively (prompt)': 'Reserve bash tools exclusively',
    'grep+glob example (prompt)': 'uses grep and glob search tools',
    'bash: not for file ops': 'DO NOT use it for file operations',
    'bash: avoid find/grep/cat': '`find`, `grep`, `cat`',
    'bash: Use Grep': 'Use Grep (NOT grep or rg)',
    'bash: Use Read': 'Use Read (NOT cat/head/tail)',
    'bash: or Grep': 'or Grep to search the full content',
    'read: use grep tool': 'Use the grep tool',
    'read: use glob tool': 'use the glob tool',
    'glob/grep: use Task instead': 'use the Task tool instead',
    'task: use Grep tool instead': 'use the Grep tool instead',
    'task: use Read or Glob': 'use the Read or Glob tool instead',
}


# Operator markers for the unjailed capture, built from NAMES ONLY (never file contents):
# skill folders under ~/.agents/skills and ~/.claude/skills, agent files under ~/.claude/agents,
# plus the two home config dirs. Printed as a count and the matching names, so nothing else of
# the operator's setup is copied anywhere.
HOME = os.path.expanduser('~')
def _names(sub, strip=''):
    try: return [n[:-len(strip)] if strip and n.endswith(strip) else n for n in os.listdir(os.path.join(HOME, sub)) if not n.startswith('.')]
    except OSError: return []
OPERATOR_MARKERS = sorted({n for n in _names('.agents/skills') + _names('.claude/skills') + _names('.claude/agents', '.md')
                           if len(n) >= 6} | {'/.claude/', '/.agents/', '/.config/opencode', '/.opencode/', HOME})
def operator_leaks(text):
    return [m for m in OPERATOR_MARKERS if re.search(r'(?<![\w-])' + re.escape(m) + r'(?![\w-])', text)]


def load(path):
    d = json.load(open(path))
    c = d['messages'][0]['content']
    return d, (c if isinstance(c, str) else ''.join(x['text'] for x in c))


# gpt-luna-unjailed: openai/gpt-5.6-luna with the operator's REAL $HOME (SS_ISOLATION=0 shape).
for fam in ['default', 'muse', 'gpt', 'claude', 'gpt-luna-unjailed']:
    for state in ['off', 'on']:
        d, s = load(os.path.join(C, f'opencode-1.18.4-request-sweet-trim-{state}-{fam}.json'))
        every = s + json.dumps(d.get('tools', []), ensure_ascii=False)
        tools = [(t['function']['name'], len(json.dumps(t))) for t in d['tools']]
        print(f"{fam:8s} {state:3s} model={d['model']:26s} system={len(s):6d} "
              f"tools={sum(n for _, n in tools):6d} ({len(tools)}) body={len(json.dumps(d)):6d}")
        print('   tools:', ' '.join(f'{a}:{b}' for a, b in tools))
        print('   steering present:', [k for k, v in STEER.items() if v in every])
        if fam.endswith('unjailed'):
            print('   operator markers found:', operator_leaks(json.dumps(d, ensure_ascii=False)), f'of {len(OPERATOR_MARKERS)}')
    prompt = open(os.path.join(T, f"opencode-1.18.4-prompt-{fam.split('-')[0]}.txt")).read()
    _, s = load(os.path.join(C, f'opencode-1.18.4-request-sweet-trim-on-{fam}.json'))
    print('   ON system begins with the trimmed prompt file:', s.startswith(prompt),
          '| then:', repr(s[len(prompt):len(prompt) + 28]))
