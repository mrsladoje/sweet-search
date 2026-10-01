#!/usr/bin/env python3
"""validate.py - checks of the extraction against the raw sources (read-only).

  python3 validate.py            # prints a report; automatic checks over ALL rollouts
  python3 validate.py show <dossier-id-prefix> [n]   # print dossiers next to the raw transcript (hand check)

Automatic checks
  V1  header/args alignment: the header printed by an ss-* tool must name the file / regex / query of the
      command segment the output was assigned to. A mismatch means the output split is wrong.
  V2  independent call count: a plain regex over the raw command text counts ss-* tokens that start a command;
      compare with the number of ss segments the parser found, per rollout.
  V3  amplification: turnsRemaining of every call lies in [0, turnsTotal-1].
"""
import json
import os
import re
import shlex
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fx_lib as fx  # noqa: E402
import ss_parse as P  # noqa: E402

WT = os.path.abspath(os.path.join(HERE, '../../../../..'))
DATA = os.path.join(WT, 'core/prompt-optimization/data/results/final-tuning-forensics')


def load_dossiers():
    out = []
    with open(os.path.join(DATA, 'dossiers.jsonl')) as fh:
        for ln in fh:
            out.append(json.loads(ln))
    return out


def args_words(args):
    try:
        return shlex.split(args, posix=True)
    except ValueError:
        return args.split()


def v1_alignment(D):
    res = defaultdict(Counter)
    bad = []
    for d in D:
        if d['class'] != 'ss' or not d['outputKnown'] or d['outputKind'] not in ('ok', 'empty'):
            continue
        t, o = d['tool'], d['output'] or ''
        hdr = o.split('\n', 1)[0]
        ws = args_words(d['args'])
        pos = [w for w in ws[1:] if not w.startswith('-')]
        ok = None
        if t == 'ss-read' and pos:
            f = pos[0].split('/')[-1]
            ok = f in hdr
        elif t == 'ss-grep' and pos:
            ok = pos[0] in hdr or pos[0].replace('\\\\', '\\') in hdr or re.sub(r'\s+', '', pos[0]) in re.sub(r'\s+', '', hdr)
        elif t == 'ss-find' and pos:
            ok = pos[0] in hdr
        elif t == 'ss-semantic' and pos:
            ok = pos[0].split('/')[-1] in hdr
        elif t == 'ss-search' and pos:
            ok = hdr.startswith('# ss-search:')  # the header does not echo the query
        elif t == 'ss-trace' and pos:
            ok = pos[0].split('.')[-1] in o[:300] or pos[0] in o[:300]
        if ok is None:
            continue
        res[(d['harness'], t)][(d['boundary'], ok)] += 1
        if not ok and len(bad) < 12:
            bad.append((d['id'], d['boundary'], d['args'][:90], hdr[:110]))
    return res, bad


RAW_TOKEN = re.compile(r'(?:^|[;&|(\n]|\bdo\b|\bthen\b)\s*(?:cd\s+\S+\s*(?:&&|;)\s*)?(?:timeout\s+\d+\s+)?(?:\S*/)?(ss-(?:search|find|grep|read|trace|semantic|batch))(?=\s|$)')


def v2_independent_count(D):
    """regex count over the raw command strings vs parser count, per rollout."""
    # raw command strings per rollout come from the dossiers' own unit commands is circular; re-read raw sources instead
    T = [json.loads(l) for l in open(os.path.join(DATA, 'trajectories.jsonl'))]
    per = defaultdict(Counter)
    for d in D:
        if d['class'] == 'ss':
            per[(d['run'], d['task'], d['rep'])][d['tool']] += 1
    agree = Counter()
    diffs = []
    for t in T:
        key = (t['run'], t['task'], t['rep'])
        raw = Counter()
        sp = t['rawSession']
        h = t['harness']
        if h == 'claudecode':
            ths = fx.read_claude(sp)
            cmds = [c for th in ths for r in th['requests'] for u in r['units'] for c in (u.get('commands') or [])]
        elif h == 'codex':
            ths = fx.read_codex(sp)
            cmds = [c for th in ths for r in th['requests'] for u in r['units'] for c in (u.get('commands') or [])]
        else:
            ths = fx.read_opencode(os.path.dirname(sp))
            ths = [x for x in ths if x['requests']]
            keep = []
            main = next((x for x in ths if x['thread'] == 'main'), None)
            cmds = [c for th in ths for r in th['requests'] for u in r['units'] for c in (u.get('commands') or [])]
        for c in cmds:
            body = fx.strip_heredocs(c)
            for m in RAW_TOKEN.finditer(body):
                raw[m.group(1)] += 1
        mine = per[key]
        same = raw == mine
        agree[(h, same)] += 1
        if not same and len(diffs) < 12:
            diffs.append((t['id'], dict(raw), dict(mine)))
    return agree, diffs


def v3_amp(D):
    bad = 0
    for d in D:
        if not (0 <= d['turnsRemaining'] <= d['turnsTotal'] - 1):
            bad += 1
    return bad


def show(prefix, n=6):
    D = load_dossiers()
    sel = [d for d in D if d['id'].startswith(prefix)]
    sel.sort(key=lambda d: (d['thread'], d['callIndex']))
    print(f'{len(sel)} records for {prefix}')
    for d in sel[:n]:
        print('=' * 100)
        print(d['id'], d['class'], d['tool'], 'turn', d['turnIndex'], 'of', d['turnsTotal'], 'remaining', d['turnsRemaining'], 'unit', d['unitId'], 'seg', d['unitSeg'], '/', d['unitSegCount'])
        print('ARGS:', d['args'][:300])
        if d['class'] == 'ss':
            print('BOUNDARY:', d['boundary'], 'KIND:', d['outputKind'], 'CHARS:', d['outputChars'], 'TOK~', d['outputTokensEst'])
            print('OUTPUT HEAD:', repr(d['output'][:300]))
            print('OUTPUT TAIL:', repr(d['output'][-200:]))
            print('BEFORE text:', repr((d['before']['assistantText'] or '')[:250]), '| thinking:', repr((d['before']['thinking'] or '')[:120]))
            print('AFTER text:', repr((d['after']['assistantText'] or '')[:300]), '| stopped at turn', d['after']['stoppedAtTurn'])
            print('NEXT:', [(c['tool'], c['args'][:60], c['sameResponse']) for c in d['after']['nextCalls']])


def main():
    if len(sys.argv) > 1 and sys.argv[1] == 'show':
        show(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 6)
        return
    D = load_dossiers()
    for d in D:
        pass
    res, bad = v1_alignment(D)
    print('V1 header/args alignment (boundary, aligned) per harness x tool:')
    tot = Counter()
    for k in sorted(res):
        row = res[k]
        a = sum(v for (b, ok), v in row.items() if ok)
        n = sum(row.values())
        tot['ok'] += a
        tot['n'] += n
        print('  ', k, f'{a}/{n}', {f'{b}:{ok}': v for (b, ok), v in sorted(row.items())})
    print('  overall', tot['ok'], '/', tot['n'])
    byb = Counter()
    for k, row in res.items():
        for (b, ok), v in row.items():
            byb[(b, ok)] += v
    print('  by boundary:', {f'{b}:{ok}': v for (b, ok), v in sorted(byb.items())})
    for b in bad:
        print('   MISALIGNED', b)
    agree, diffs = v2_independent_count(D)
    print('V2 independent regex count == parser count per rollout:', dict(agree))
    for x in diffs:
        print('   DIFF', x)
    print('V3 turnsRemaining out of range:', v3_amp(D))


if __name__ == '__main__':
    main()
