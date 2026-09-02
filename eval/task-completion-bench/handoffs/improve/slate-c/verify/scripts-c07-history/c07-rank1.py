#!/usr/bin/env python3
"""c07-history: does a COMPLETE top-1 body fit c07's ~4,800-character head?
Read-only over fp-codex-tab-20260826 sweet TAB. Writes only /tmp/wf-slatec/c07-history/."""
import json, os, re, sys, collections, statistics
from importlib.machinery import SourceFileLoader
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import pool, transcripts, events_codex, cmd_of
t1 = SourceFileLoader('t1c', '/tmp/fp-inv/trunc/t1-census.py').load_module()

OUT = '/tmp/wf-slatec/c07-history'; os.makedirs(OUT, exist_ok=True)
RUN = 'fp-codex-tab-20260826'
MARK = t1.MARK
H_RANK = re.compile(r'^## #(\d+) (\S+?):(\d+)-(\d+)(?: \[([^\]]*)\])? \(([^)]*)\)', re.M)
GUT = re.compile(r'^\s*(\d+)\t', re.M)

rows = []; n_trunc_env = 0; n_files = 0
for task in pool():
    for path, _subs in transcripts(RUN, 'codex', f'{task}-sweet'):
        n_files += 1
        ev, _turns = events_codex(path)
        results = [e for e in ev if e.get('kind') == 'result']
        for i, e in enumerate(results):
            out = e.get('output') or ''
            ms = list(MARK.finditer(out))
            if not ms: continue
            n_trunc_env += 1
            cmd = cmd_of('codex', e)
            if 'ss-search' not in cmd: continue
            first = ms[0].start(); head = out[:first]
            hs = list(H_RANK.finditer(head))
            if not hs: continue
            last = hs[-1]
            rank = int(last.group(1)); f = last.group(2)
            lo = int(last.group(3)); hi = int(last.group(4)); pres = last.group(6)
            blk = head[last.start():]
            gl = [int(x.group(1)) for x in GUT.finditer(blk)]
            before_n = gl[-1] if gl else None
            decl = hi - lo + 1
            dl = est = None
            if before_n is not None and lo <= before_n:
                dl = before_n - lo + 1
                if dl > 0: est = int(round(len(blk) * decl / dl))
            rows.append(dict(task=task, transcript=os.path.basename(path), call=i,
                subcmds=len(t1.split_subcmds(cmd)), rank=rank, file=f, lo=lo, hi=hi, pres=pres,
                head_chars=len(head), preamble_chars=last.start(), blk_delivered_chars=len(blk),
                before_n=before_n, declared_lines=decl, delivered_lines=dl,
                body_complete_at_cut=(before_n is not None and before_n >= hi),
                est_full_block_chars=est))
json.dump(rows, open(os.path.join(OUT, 'c07-rank1.json'), 'w'), indent=1)
print('sweet transcripts scanned: %d   truncated envelopes: %d   ss-search-bearing rows: %d'
      % (n_files, n_trunc_env, len(rows)))

def show(sel, label):
    print('\n== %s : n=%d' % (label, len(sel)))
    if not sel: return
    hc = sorted(r['head_chars'] for r in sel)
    print('  head chars   median %d  min %d  max %d' % (statistics.median(hc), hc[0], hc[-1]))
    pc = sorted(r['preamble_chars'] for r in sel)
    print('  chars before the last head rank header  median %d  min %d  max %d' % (statistics.median(pc), pc[0], pc[-1]))
    print('  rank at cut:', dict(collections.Counter(r['rank'] for r in sel)))
    print('  presentation:', dict(collections.Counter(r['pres'] for r in sel)))
    bc = [r for r in sel if r['body_complete_at_cut']]
    print('  cut fell AFTER that rank body ended: %d/%d' % (len(bc), len(sel)))
    inb = [r for r in sel if not r['body_complete_at_cut'] and r['est_full_block_chars']]
    nog = [r for r in sel if not r['body_complete_at_cut'] and not r['est_full_block_chars']]
    print('  cut fell INSIDE that rank body: %d (estimable %d, no gutter line %d)' % (len(sel)-len(bc), len(inb), len(nog)))
    if inb:
        e = sorted(r['est_full_block_chars'] for r in inb)
        print('   est COMPLETE block chars  median %d  p10 %d  p90 %d  max %d' % (
            statistics.median(e), e[int(.1*(len(e)-1))], e[int(.9*(len(e)-1))], e[-1]))
        for cap in (4800, 5190):
            print('   est complete block > %d chars: %d of %d' % (cap, sum(1 for x in e if x > cap), len(e)))
        d = sorted(r['declared_lines'] for r in inb)
        print('   declared span lines  median %d  max %d' % (statistics.median(d), d[-1]))
    # delivered fraction
    fr = [r['delivered_lines']/r['declared_lines'] for r in sel if r['delivered_lines']]
    if fr: print('  delivered fraction of the declared span  median %.2f' % statistics.median(fr))

show(rows, 'ALL truncated envelopes carrying ss-search (rank header present in head)')
show([r for r in rows if r['subcmds'] == 1], 'SINGLE-COMMAND envelopes (c07 addressable set)')
show([r for r in rows if r['rank'] == 1], 'cut inside RANK 1 block')
show([r for r in rows if r['rank'] == 1 and r['subcmds'] == 1], 'RANK 1 and single command')
