#!/usr/bin/env python3
"""Summarize captured Claude Code request bodies: system chars, tools, first user message,
and which retrieval-steering lines survive. Usage: summarize_capture.py DIR [DIR...]"""
import json, os, sys

LINES = {
    'prefer-dedicated-tools': 'Prefer the dedicated file/search tools over shell commands',
    'agent-delegate': 'delegate it and you keep the conclusion',
    'grep-tool-always': 'ALWAYS use Grep for search tasks',
    'memory-section': '# Memory',
    'ss-override': 'you MUST follow the sweet-search guidance',
    'rules-file': 'sweet-search.md',
    'bypass-grep': 'search with grep and find',
    'agent-list': 'Available agent types for the Agent tool',
    'explore-agent': 'Read-only search agent for broad fan-out searches',
    'gp-agent-search': 'When you are searching for a keyword or file',
    'skills-list': 'The following skills are available',
}


def text_of(block):
    if isinstance(block, str):
        return block
    if isinstance(block, list):
        return ''.join(b.get('text', '') for b in block if isinstance(b, dict))
    return ''


def main_request(d):
    reqs = sorted(f for f in os.listdir(d) if f.startswith('req'))
    bodies = [json.load(open(os.path.join(d, f))) for f in reqs]
    # The agent request is the one that carries tools.
    withtools = [b for b in bodies if b.get('tools')]
    return (withtools or bodies)[0], len(bodies)


for d in sys.argv[1:]:
    body, n = main_request(d)
    system = text_of(body.get('system'))
    tools = body.get('tools') or []
    tool_chars = sum(len(json.dumps(t)) for t in tools)
    msgs = body.get('messages') or []
    first_user = text_of(msgs[0]['content']) if msgs else ''
    everything = system + json.dumps(tools) + json.dumps(msgs)
    print(f'== {os.path.basename(d)}  (requests={n}, model={body.get("model")})')
    print(f'   system chars={len(system)}  tools={len(tools)} tool chars={tool_chars}  '
          f'messages={len(msgs)} first-user chars={len(first_user)}  total body chars={len(json.dumps(body))}')
    print(f'   tools: {", ".join(t.get("name", "?") for t in tools)}')
    hits = {k: everything.count(v) for k, v in LINES.items()}
    print(f'   lines: ' + '  '.join(f'{k}={v}' for k, v in hits.items()))
    for i, m in enumerate(msgs):
        blocks = m['content'] if isinstance(m['content'], list) else [{'text': m['content']}]
        print(f'   msg[{i}] {m["role"]}: ' + ' '.join(str(len(b.get('text', ''))) for b in blocks))
    sysblocks = body.get('system') if isinstance(body.get('system'), list) else []
    for i, b in enumerate(sysblocks):
        t = b.get('text', '')
        print(f'   system[{i}] chars={len(t)} cache={b.get("cache_control")} head={t[:70]!r}')
