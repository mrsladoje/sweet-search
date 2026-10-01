#!/usr/bin/env python3
"""handcheck.py <rollout-id> - print the RAW transcript (read directly, without fx_lib) and the extracted dossiers.

  python3 handcheck.py hc-opencode-20260929-0108-L1/zmap__zlint-299/r0

Left block per model request: what the raw store holds (agent text, tool call, tool result head/tail, length).
Then the dossier records of the call(s) of that request: args, boundary, output length, head, before/after text.
The reader (a human) compares the two by eye. Read-only.
"""
import glob
import json
import os
import shutil
import sqlite3
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, '../../../../..'))
DATA = os.path.join(WT, 'core/prompt-optimization/data/results/final-tuning-forensics')


def h(s, n=220):
    s = s if isinstance(s, str) else json.dumps(s)
    return repr(s[:n]) + (f' ...[{len(s)} chars]' if len(s) > n else f' [{len(s)} chars]')


def raw_claude(path):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    res = {}
    for d in rows:
        if d.get('type') == 'user' and isinstance(d['message'].get('content'), list):
            for b in d['message']['content']:
                if isinstance(b, dict) and b.get('type') == 'tool_result':
                    c = b.get('content')
                    res[b['tool_use_id']] = c if isinstance(c, str) else '\n'.join(x.get('text', '') for x in c)
    seen = []
    cur = None
    for d in rows:
        if d.get('type') != 'assistant':
            continue
        mid = d['message']['id']
        if cur is None or cur['id'] != mid:
            cur = {'id': mid, 'text': [], 'think': [], 'calls': []}
            seen.append(cur)
        for b in d['message']['content']:
            if b['type'] == 'text':
                cur['text'].append(b['text'])
            elif b['type'] == 'thinking':
                cur['think'].append(b.get('thinking', ''))
            elif b['type'] == 'tool_use':
                cur['calls'].append((b['name'], json.dumps(b['input'])[:400], res.get(b['id'])))
    return seen


def raw_codex(path):
    L = [json.loads(l) for l in open(path) if l.strip()]
    seen = []
    cur = {'id': 0, 'text': [], 'think': [], 'calls': []}
    outs = {}
    for o in L:
        p = o.get('payload') or {}
        if o['type'] == 'response_item' and p.get('type') in ('custom_tool_call_output', 'function_call_output'):
            out = p.get('output')
            outs.setdefault(p['call_id'], []).append(out if isinstance(out, str) else ' || '.join((x.get('text') or '') for x in out))
    for o in L:
        p = o.get('payload') or {}
        if o['type'] == 'response_item':
            if p.get('type') == 'message' and p.get('role') == 'assistant':
                cur['text'].append(''.join(c.get('text', '') for c in p['content']))
            elif p.get('type') == 'reasoning':
                cur['think'].append('(encrypted reasoning, summary=%s)' % (p.get('summary'),))
            elif p.get('type') == 'custom_tool_call':
                cur['calls'].append((p['name'], (p.get('input') or '')[:400], ' ##NEXT## '.join(outs.get(p['call_id'], []))))
            elif p.get('type') == 'function_call':
                cur['calls'].append((p['name'], (p.get('arguments') or '')[:200], ' ##NEXT## '.join(outs.get(p['call_id'], []))))
        elif o['type'] == 'event_msg' and p.get('type') == 'token_count' and (p.get('info') or {}).get('last_token_usage'):
            seen.append(cur)
            cur = {'id': len(seen), 'text': [], 'think': [], 'calls': []}
    return seen


def raw_opencode(dbdir):
    tmp = tempfile.mkdtemp()
    for fn in ('opencode.db', 'opencode.db-wal', 'opencode.db-shm'):
        if os.path.exists(os.path.join(dbdir, fn)):
            shutil.copy(os.path.join(dbdir, fn), os.path.join(tmp, fn))
    db = sqlite3.connect(os.path.join(tmp, 'opencode.db'))
    seen = []
    for sid, in db.execute('select id from session where parent_id is null order by time_created'):
        for mid, data in db.execute('select id,data from message where session_id=? order by time_created,id', (sid,)):
            md = json.loads(data)
            if md.get('role') != 'assistant':
                continue
            cur = {'id': mid, 'text': [], 'think': [], 'calls': []}
            for (pd,) in db.execute('select data from part where message_id=? order by time_created,id', (mid,)):
                pj = json.loads(pd)
                if pj['type'] == 'text':
                    cur['text'].append(pj['text'])
                elif pj['type'] == 'reasoning':
                    cur['think'].append(pj.get('text', ''))
                elif pj['type'] == 'tool':
                    st = pj['state']
                    cur['calls'].append((pj['tool'], json.dumps(st.get('input'))[:400], st.get('output')))
            seen.append(cur)
    shutil.rmtree(tmp, ignore_errors=True)
    return seen


def main():
    rid = sys.argv[1]
    T = [json.loads(l) for l in open(os.path.join(DATA, 'trajectories.jsonl'))]
    t = next(x for x in T if x['id'] == rid)
    D = [json.loads(l) for l in open(os.path.join(DATA, 'dossiers.jsonl'))]
    mine = [d for d in D if d['id'].startswith(rid + '#')]
    print('ROLLOUT', rid, t['harness'], t['model'], t['variant'], 'solved', t['solved'], 'turns', t['turns'], 'calls', t['calls'], 'ss', t['ssCalls'])
    print('RAW SESSION', t['rawSession'])
    if t['harness'] == 'claudecode':
        raw = raw_claude(t['rawSession'])
    elif t['harness'] == 'codex':
        raw = raw_codex(t['rawSession'])
    else:
        raw = raw_opencode(os.path.dirname(t['rawSession']))
    print('RAW requests:', len(raw), '| dossier turnsTotal:', t['turns'])
    for i, rq in enumerate(raw, start=1):
        print('-' * 110)
        print(f'REQUEST {i}  raw text: {h(" ".join(rq["text"]), 160)}  thinking: {h(" ".join(rq["think"]), 100)}')
        for (name, inp, out) in rq['calls']:
            print(f'  RAW CALL {name}: {inp[:250]}')
            if out is not None:
                print(f'    RAW RESULT {h(out, 200)}  ...tail {repr(out[-100:])}')
        for d in mine:
            if d['turnIndex'] == i:
                tag = d['class'] + '/' + d['tool']
                if d['class'] == 'ss':
                    print(f'  >> DOSSIER {d["id"].split("#")[-1]} {tag} seg {d["unitSeg"]}/{d["unitSegCount"]} boundary={d["boundary"]} kind={d["outputKind"]} chars={d["outputChars"]} remaining={d["turnsRemaining"]}')
                    print(f'     args: {d["args"][:160]}')
                    print(f'     output: {h(d["output"], 180)} tail {repr(d["output"][-80:])}')
                    print(f'     before.text: {h(d["before"]["assistantText"], 100)} | after.text: {h(d["after"]["assistantText"], 140)} | stopped@{d["after"]["stoppedAtTurn"]} | next: {[(c["tool"], c["args"][:40]) for c in d["after"]["nextCalls"]][:3]}')
                else:
                    print(f'  >> dossier(light) {d["id"].split("#")[-1]} {tag} chars={d["outputChars"]} shared={d.get("sharedOutput")} args: {d["args"][:90]}')


if __name__ == '__main__':
    main()
