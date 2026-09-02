#!/usr/bin/env python3
"""codex-cap-x-ss — which ss-search budget tier and which ss-read range sizes meet codex's cap.
Walks every sweet TAB tool output in fp-codex-tab-20260826 (same 3-dearest transcript selection).
Read-only; prints tables only."""
import re, sys, collections, statistics
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import pool, transcripts, events_codex, turn_costs, resolution_index, assign_reps
from importlib.machinery import SourceFileLoader
t1 = SourceFileLoader('t1c', '/tmp/fp-inv/trunc/t1-census.py').load_module()
RUN = 'fp-codex-tab-20260826'
HDR = re.compile(r'^# ss-search: routed=(\S+) conf=(\S+) budget=(\d+) used=(\d+) results=(\d+) subMode=(\S+)', re.M)
TRUNC = t1.TRUNC_WARN
tiers = collections.defaultdict(lambda: [0, 0, []])   # budget -> [n, truncated, used]
ssread = collections.defaultdict(lambda: [0, 0])      # range bucket -> [n calls, n in truncated envelope]
ssread_single = collections.defaultdict(lambda: [0, 0])  # single-command envelopes only
grep_env = [0, 0]
k_flags = collections.Counter()
byrep, bycell, bypath = resolution_index(RUN)
for task in pool():
    tl = transcripts(RUN, 'codex', f'{task}-sweet')
    parsed = []
    for mp, _ in tl:
        ev, turns = events_codex(mp)
        parsed.append((sum(x['usd'] for x in turn_costs(turns)), ev))
    parsed.sort(key=lambda x: -x[0])
    for _, ev in parsed[:3]:
        for e in ev:
            if e['kind'] != 'result':
                continue
            out = e.get('output') or ''
            cmd = str((e.get('input') or {}).get('cmd') or '')
            tr = bool(TRUNC.search(out))
            subs = t1.split_subcmds(cmd)
            for h in HDR.finditer(out):
                b, u = int(h.group(3)), int(h.group(4))
                tiers[b][0] += 1; tiers[b][1] += int(tr); tiers[b][2].append(u)
            if re.search(r'(?:^|[\s;&|(])ss-grep(?=\s|$)', cmd):
                grep_env[0] += 1; grep_env[1] += int(tr)
            for m in t1.SSREAD_CALL.finditer(cmd):
                a = t1.parse_ssread_args(m.group(1))
                if not a:
                    continue
                f, s, en = a
                if s is None or en is None:
                    bucket = 'whole/default'
                else:
                    n = en - s + 1
                    bucket = '<=100' if n <= 100 else ('101-200' if n <= 200 else ('201-250' if n <= 250 else ('251-400' if n <= 400 else '>400')))
                ssread[bucket][0] += 1; ssread[bucket][1] += int(tr)
                if len(subs) == 1:
                    ssread_single[bucket][0] += 1; ssread_single[bucket][1] += int(tr)
            for m in re.finditer(r'ss-search\s[^&;|\n]*', cmd):
                k_flags['--full' if '--full' in m.group(0) else ('--xl' if '--xl' in m.group(0) else 'auto')] += 1
print('ss-search packs by budget tier (auto-tier picks 3k/8k/12k):')
for b in sorted(tiers):
    n, t, us = tiers[b]
    print(f'  budget={b}: packs={n} truncated={t} ({100*t/n:.0f}%) used tokens median={statistics.median(us):.0f} max={max(us)} share used>2400: {sum(1 for u in us if u>2400)}/{n}')
print('ss-search flags:', dict(k_flags))
print('ss-read invocations by requested range (all envelopes) [n, in a truncated envelope]:', {k: v for k, v in sorted(ssread.items())})
print('ss-read invocations, SINGLE-command envelopes only [n, truncated]:', {k: v for k, v in sorted(ssread_single.items())})
print('envelopes containing ss-grep: total', grep_env[0], 'truncated', grep_env[1])
