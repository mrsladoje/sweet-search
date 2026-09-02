#!/usr/bin/env python3
"""Print one truncated tool output with its cut context and the next three calls.
Usage: python3 cx-exhibit.py <arm> <task> <transcript-basename-prefix> <call_index> [context_lines]
Read-only. Never prints grading logs."""
import sys, re, os
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import R, transcripts, events_codex
arm, task, tb, ci = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
ctx = int(sys.argv[5]) if len(sys.argv) > 5 else 3
run = 'fp-codex-tab-20260826'
paths = [p for p, _ in transcripts(run, 'codex', f'{task}-{arm}') if os.path.basename(p).startswith(tb)]
assert len(paths) == 1, paths
ev, turns = events_codex(paths[0])
results = [e for e in ev if e['kind'] == 'result']
e = results[ci]
out = e.get('output') or ''
print('transcript:', os.path.basename(paths[0]))
print('call_index:', ci, 'turn:', e['turn'], 'tool:', e['tool'])
print('cmd :', str((e.get('input') or {}).get('cmd') or '')[:400])
hdr = out.split('Output:\n')[0]
print('---- codex header ----'); print(hdr[:600])
body = out.split('Output:\n', 1)[1] if 'Output:\n' in out else out
lines = body.split('\n')
print('---- block headers / trailers in the delivered body ----')
for i, l in enumerate(lines):
    if re.match(r'^(# ss-read |# ss-search:|## #\d+ |# unread below|route=|shown-full:|# ss-find|# ss-trace|\d+ results:)', l):
        print(f'{i:4d}: {l[:160]}')
print('---- around each cut marker ----')
for i, l in enumerate(lines):
    if '…' in l and 'tokens truncated' in l:
        for j in range(max(0, i - ctx), min(len(lines), i + ctx + 1)):
            print(f'{j:4d}{"*" if j == i else " "}: {lines[j][:200]}')
        print('   ...')
print('---- next 3 calls ----')
for k in range(1, 4):
    if ci + k < len(results):
        f = results[ci + k]
        fo = f.get('output') or ''
        tr = 'TRUNCATED' if 'Warning: truncated output' in fo else ''
        print(f'k={k} turn={f["turn"]} {tr} cmd={str((f.get("input") or {}).get("cmd") or "")[:220]!r}')
