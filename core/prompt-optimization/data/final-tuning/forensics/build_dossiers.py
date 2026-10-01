#!/usr/bin/env python3
"""build_dossiers.py - extract every ss-* call (full output, agent text before/after) from the task-bench runs.

  python3 build_dossiers.py [--limit N] [--only RUNSUBSTR]

Inputs  (read-only): rows.json + agent-state/<task>-<arm>/ of the run folders listed by fx_lib.discover_runs().
Outputs (gitignored): core/prompt-optimization/data/results/final-tuning-forensics/
    dossiers.jsonl      one record per call segment: ss-* calls in full, native/edit/test/other calls light
    trajectories.jsonl  one record per rollout
    units.jsonl         one record per model tool call (Bash command / native call): output chars, ss part, rest
    extract-report.json counts and extraction anomalies
"""
import argparse
import json
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fx_lib as fx  # noqa: E402

WT = os.path.abspath(os.path.join(HERE, '../../../../..'))
OUT_DIR = os.path.join(WT, 'core/prompt-optimization/data/results/final-tuning-forensics')

BEFORE_MAX = 3000
AFTER_MAX = 6000
HEAD_MAX = 400


def est_tokens(n):
    return int(math.ceil(n / 4)) if n else 0


def clip(s, n):
    s = s or ''
    return s if len(s) <= n else s[:n]


def date_of(run):
    m = re.search(r'(\d{8})-(\d{4})', run)
    if not m:
        return None
    d = m.group(1)
    return f'{d[:4]}-{d[4:6]}-{d[6:]}T{m.group(2)[:2]}:{m.group(2)[2:]}'


def variant_of(run, row, role):
    if run.startswith('tg-'):
        c = row.get('ccRulesInPrompt')
        if c is True:
            v = 'V1-rules-in-prompt'
        elif c:
            v = 'V1b-' + str(c)
        else:
            v = 'base-2.8.2'
        return v
    trim = row.get('harnessTrim') or 'baseline'
    pl = row.get('sweetRulesPlacement')
    return trim + (f'|rules={pl}' if pl else '')


def parse_flags(tool, args_text):
    """flags used on an ss-* call (not the positional query)."""
    try:
        import shlex
        ws = shlex.split(args_text, posix=True)
    except Exception:
        ws = args_text.split()
    # drop wrappers / tool name
    flags = []
    skip = False
    for w in ws:
        if w.startswith('-') and len(w) > 1 and not re.fullmatch(r'-\d+', w):
            flags.append(w.split('=')[0])
        elif w in ('callers', 'callees', 'impact') and tool == 'ss-trace':
            flags.append('mode:' + w)
    return flags


KNOWN_BOUNDARIES = {'exact', 'single', 'trimmed', 'heuristic', 'ambiguous', 'single-nomarker', 'piped-filtered', 'ambiguous-error'}


def output_kind(tool, text, boundary, never_collected=False, redirected=False):
    t = text or ''
    head = t.lstrip()[:200]
    if boundary == 'substitution':
        return 'substituted'
    if never_collected:
        return 'not-collected'
    if redirected and not t.strip():
        return 'redirected'
    if boundary in ('unmatched', 'piped-unknown'):
        return 'unknown'
    if not t.strip():
        return 'empty-output'
    if boundary in ('single-nomarker', 'ambiguous-error'):
        if re.search(r'^\[ss-|crash:|Usage:|not ready|No such file|command not found|refusing', t, re.M):
            return 'error'
        return 'no-marker'
    if re.match(r'\[ss-\w+\]|Usage:', head):
        return 'error'
    if tool == 'ss-grep':
        if re.search(r'^# ss-grep: 0 total', t, re.M) or '(no matches)' in t:
            return 'empty'
    elif tool in ('ss-search', 'ss-find'):
        if re.search(r'results=0\b|^# ss-find: ColGrep 0 ', t, re.M) or '(no matches)' in t.split('\n', 6)[-1][:40]:
            return 'empty'
        if re.search(r'^# ss-find: ColGrep 0 ', t, re.M):
            return 'empty'
    elif tool == 'ss-semantic':
        if re.search(r'spans=0\b', t.split('\n', 1)[0]):
            return 'empty'
    elif tool == 'ss-trace':
        if t.startswith('No indexed symbol found'):
            return 'empty'
    return 'ok'


# ----------------------------------------------------------------------------------------------
# flatten threads -> call list
# ----------------------------------------------------------------------------------------------
NOOUT_TOOLS = {'cd', 'export', 'set', 'true', ':', 'unset', 'mkdir', 'rm', 'mv', 'cp', 'touch', 'chmod', 'sleep', 'trap'}


def flatten_thread(harness, th):
    """-> (calls, units). calls: dict per segment/native call in order; units: dict per tool call."""
    calls, units = [], []
    reqs = th['requests']
    for ti, rq in enumerate(reqs, start=1):
        for ui, u in enumerate(rq['units']):
            uid = u['id']
            out = u.get('output')
            dt = u.get('deliveredTurn') or ti
            if u.get('neverCollected'):
                dt = len(reqs)
            base_unit = {'unitId': uid, 'turnIndex': ti, 'deliveredTurn': dt, 'harnessTool': u['harnessTool'], 'unitOutputChars': len(out) if out is not None else None, 'persisted': bool(u.get('persisted')),
                         'isError': bool(u.get('isError'))}
            if 'native' in u:
                kind, tool, argt = u['native']
                c = {'cls': kind, 'tool': tool, 'args': argt, 'output': out, 'outputChars': len(out) if out is not None else None,
                     'turnIndex': ti, 'unitId': uid, 'unitSeg': 0, 'unitSegCount': 1, 'boundary': 'native', 'piped': False, 'redirected': False,
                     'compound': False, 'isError': bool(u.get('isError')), 'ssChars': 0, 'deliveredTurn': ti}
                calls.append(c)
                units.append({**base_unit, 'bucket': kind, 'ssChars': 0, 'segments': 1, 'ssSegments': 0})
                continue
            if u.get('noCmd'):
                js = u.get('jsSource') or ''
                kind = 'edit' if 'apply_patch' in js else 'other'
                tool = 'apply_patch' if kind == 'edit' else 'exec-js'
                c = {'cls': kind, 'tool': tool, 'args': js[:600], 'output': out, 'outputChars': len(out) if out is not None else None,
                     'turnIndex': ti, 'unitId': uid, 'unitSeg': 0, 'unitSegCount': 1, 'boundary': 'native', 'piped': False, 'redirected': False,
                     'compound': False, 'isError': bool(u.get('isError')), 'ssChars': 0, 'deliveredTurn': u.get('deliveredTurn') or ti}
                calls.append(c)
                units.append({**base_unit, 'bucket': kind, 'ssChars': 0, 'segments': 1, 'ssSegments': 0, 'deliveredTurn': u.get('deliveredTurn') or ti})
                continue
            cmds = u.get('commands') or []
            per = u.get('perCmdOutputs')
            all_segments = []
            seg_outputs = []
            ss_chars = 0
            if per:
                for cmd, o in zip(cmds, per):
                    segs = fx.parse_command(cmd)
                    sp = fx.split_output(segs, o)
                    all_segments.append((segs, sp, o))
            else:
                segs = []
                for cmd in cmds:
                    segs.extend(fx.parse_command(cmd))
                sp = fx.split_output(segs, out or '')
                all_segments.append((segs, sp, out or ''))
            TRIVIAL = {'cd', 'export', 'set', 'unset', 'true', ':', 'sleep', 'trap', 'echo', 'printf'}
            flat = []
            for segs, sp, o in all_segments:
                for i, s in enumerate(segs):
                    if s['kind'] not in ('ss', 'ss-sub') and s['tool'] in TRIVIAL and not s['redirected']:
                        continue  # shell plumbing: not a tool call
                    flat.append((s, sp[i], o, segs))
            n_seg = len(flat)
            ss_total = sum(len(x[1]['text']) for x in flat if x[1] is not None and x[0]['kind'] == 'ss')
            rest_chars = (len(out) - ss_total) if out is not None else None
            out_bearing = [k for k, x in enumerate(flat) if x[0]['kind'] not in ('ss', 'ss-sub') and not (x[0]['tool'] in NOOUT_TOOLS) and x[0]['kind'] != 'none']
            full_cmd = '\n'.join(cmds)
            for k, (s, sp_i, o, segs) in enumerate(flat):
                if s['kind'] == 'none':
                    continue
                c = {'turnIndex': ti, 'unitId': uid, 'unitSeg': k, 'unitSegCount': n_seg, 'compound': n_seg > 1,
                     'args': s['text'], 'tool': s['tool'], 'piped': s['piped'], 'pipeTail': s['pipeTail'], 'redirected': s['redirected'],
                     'isError': bool(u.get('isError')), 'unitCommand': full_cmd if n_seg > 1 else None, 'viaCli': s.get('viaCli', False),
                     'neverCollected': bool(u.get('neverCollected')), 'persisted': bool(u.get('persisted')), 'persistedPath': u.get('persistedPath')}
                if s['kind'] == 'ss-sub':
                    c['cls'] = 'ss'
                    c['output'] = ''
                    c['outputChars'] = 0
                    c['boundary'] = 'substitution'
                    c['substitution'] = True
                elif s['kind'] == 'ss':
                    c['cls'] = 'ss'
                    c['output'] = sp_i['text']
                    c['outputChars'] = len(sp_i['text'])
                    c['boundary'] = sp_i['boundary']
                else:
                    c['cls'] = s['kind'] if s['kind'] in ('native-search', 'native-read', 'edit', 'test') else 'other'
                    c['boundary'] = 'n/a'
                    if s['tool'] in NOOUT_TOOLS:
                        c['output'], c['outputChars'] = None, 0
                    elif len(out_bearing) == 1 and rest_chars is not None:
                        c['output'] = None  # kept light; the head is attached below
                        c['outputChars'] = max(rest_chars, 0)
                        c['_restText'] = True
                    else:
                        c['output'], c['outputChars'] = None, None
                        c['sharedOutput'] = True
                c['_unitOut'] = out
                c['deliveredTurn'] = dt
                calls.append(c)
            bucket_set = {c['cls'] for c in calls if c['unitId'] == uid and c['cls'] != 'ss'}
            n_ss = sum(1 for c in calls if c['unitId'] == uid and c['cls'] == 'ss')
            units.append({**base_unit, 'bucket': 'mixed' if (n_ss and bucket_set) else ('ss' if n_ss else (next(iter(bucket_set)) if len(bucket_set) == 1 else ('mixed-native' if bucket_set else 'other'))),
                          'ssChars': ss_total, 'segments': n_seg, 'ssSegments': n_ss, 'restChars': rest_chars})
    return calls, units


def attach_context(calls, reqs):
    """before/after text, nextCalls, amplification.

    k  = turn that issued the call; kd = turn after which the model SEES the output (k, or the later wait turn of a codex cell).
    turnsRemaining = later model requests that carry the output in their context = N - kd.
    """
    n_req = len(reqs)
    for i, c in enumerate(calls):
        k = c['turnIndex']
        kd = c.get('deliveredTurn') or k
        rq = reqs[k - 1]
        c['before'] = {'assistantText': clip(rq.get('text'), BEFORE_MAX), 'thinking': clip(rq.get('thinking'), BEFORE_MAX)}
        at, th = [], []
        used_t = used_h = 0
        stop_k = None
        for kk in range(kd + 1, n_req + 1):
            r2 = reqs[kk - 1]
            if r2.get('text') and used_t < AFTER_MAX:
                piece = clip(r2['text'], AFTER_MAX - used_t)
                at.append(f'[turn {kk}] ' + piece)
                used_t += len(piece)
            if r2.get('thinking') and used_h < AFTER_MAX:
                piece = clip(r2['thinking'], AFTER_MAX - used_h)
                th.append(f'[turn {kk}] ' + piece)
                used_h += len(piece)
            has_retrieval = any(cc['turnIndex'] == kk and (cc['cls'] in ('ss', 'native-search', 'native-read')) for cc in calls)
            if has_retrieval:
                stop_k = kk
                break
        nxt = []
        for cc in calls[i + 1:i + 5]:
            head = ''
            if cc.get('output'):
                head = clip(cc['output'], HEAD_MAX)
            elif cc.get('_restText') and cc.get('_unitOut'):
                head = clip(cc['_unitOut'], HEAD_MAX)
            nxt.append({'tool': cc['tool'], 'cls': cc['cls'], 'args': clip(cc['args'], 600), 'turnIndex': cc['turnIndex'],
                        'sameResponse': cc['turnIndex'] == k, 'outputHead': head})
        c['after'] = {'assistantText': '\n\n'.join(at), 'thinking': '\n\n'.join(th), 'nextCalls': nxt, 'stoppedAtTurn': stop_k}
        c['turnsTotal'] = n_req
        c['issuedTurn'] = k
        c['deliveredTurn'] = kd
        c['turnsRemaining'] = max(n_req - kd, 0)
        c['amplification'] = c['turnsRemaining']


def pick_session(harness, row, state_dir, turns_meta):
    """-> (threads, path, note). Choose the session of the FINAL attempt when a rollout was re-run."""
    note = []
    if harness == 'claudecode':
        files = sorted(__import__('glob').glob(os.path.join(state_dir, 'claude-home/projects/*/*.jsonl')))
        if not files:
            return None, None, ['no session file']
        cands = []
        for f in files:
            th = fx.read_claude(f)
            main = next((t for t in th if t['thread'] == 'main'), None)
            if not main or not main['requests']:
                continue
            nunits = sum(len(r['units']) for t in th for r in t['requests'])
            cands.append((f, th, len(main['requests']), nunits, main['requests'][0]['ts'] or ''))
        if not cands:
            return None, None, ['no assistant messages']
        if len(cands) > 1:
            note.append(f'{len(cands)} sessions in agent-state (rerun)')
        def score(c):
            return ((c[3] == row.get('calls')) * 2 + (c[2] == turns_meta), c[4])
        best = max(cands, key=score)
        if len(cands) > 1:
            note.append('picked session %s (turns %s vs meta %s, units %s vs row.calls %s)' % (os.path.basename(best[0])[:8], best[2], turns_meta, best[3], row.get('calls')))
        return best[1], best[0], note
    if harness == 'codex':
        files = sorted(__import__('glob').glob(os.path.join(state_dir, 'codex-home/sessions/**/rollout-*.jsonl'), recursive=True))
        if not files:
            return None, None, ['no rollout file']
        cands = []
        for f in files:
            th = fx.read_codex(f)
            cands.append((f, th, len(th[0]['requests']), th[0]['requests'][0]['ts'] if th[0]['requests'] else ''))
        if len(cands) > 1:
            note.append(f'{len(cands)} rollout files in agent-state (rerun)')
        best = [c for c in cands if c[2] == turns_meta] or [max(cands, key=lambda c: c[3] or '')]
        return best[-1][1], best[-1][0], note
    if harness == 'opencode':
        d = os.path.join(state_dir, 'opencode-data')
        if not os.path.exists(os.path.join(d, 'opencode.db')):
            return None, None, ['no opencode.db']
        th = fx.read_opencode(d)
        th = [t for t in th if t['requests']]
        if not th:
            return None, None, ['opencode.db has no assistant messages']
        roots = [t for t in th if t['thread'] == 'main']
        if len(roots) > 1:
            note.append(f'{len(roots)} root sessions in db; took the one matching turns meta or the latest')
            m = [t for t in roots if len(t['requests']) == turns_meta]
            keep = (m or [roots[-1]])[-1]
            th = [keep] + [t for t in th if t['thread'] != 'main']
        return th, os.path.join(d, 'opencode.db'), note
    return None, None, ['unknown harness']


def read_turns_meta(run_dir, task, arm):
    p = os.path.join(run_dir, 'turns', f'{task}-{arm}.jsonl')
    if not os.path.exists(p):
        return None
    try:
        with open(p) as fh:
            m = json.loads(fh.readline())
        return m.get('turns')
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    runs, skipped = fx.discover_runs()
    roles = fx.tg_roles()
    report = {'runs': len(runs), 'skippedRuns': skipped, 'rollouts': 0, 'missing': [], 'notes': [], 'counts': {}}
    fd_d = open(os.path.join(OUT_DIR, 'dossiers.jsonl'), 'w')
    fd_t = open(os.path.join(OUT_DIR, 'trajectories.jsonl'), 'w')
    fd_u = open(os.path.join(OUT_DIR, 'units.jsonl'), 'w')
    ctr = Counter()
    t0 = time.time()
    done = 0
    for run in runs:
        if a.only and a.only not in run['run']:
            continue
        for row in run['rows']:
            if a.limit and done >= a.limit:
                break
            harness = row.get('harness')
            task, arm, rep = row['taskId'], row['arm'], row.get('rep', 0)
            state_dir = os.path.join(run['dir'], 'agent-state', f'{task}-{arm}')
            turns_meta = read_turns_meta(run['dir'], task, arm)
            if not os.path.isdir(state_dir):
                report['missing'].append(f"{run['run']}/{task}: no agent-state dir")
                continue
            try:
                threads, spath, note = pick_session(harness, row, state_dir, turns_meta)
            except Exception as e:  # keep going; record the failure
                report['missing'].append(f"{run['run']}/{task}: reader crash {type(e).__name__}: {e}")
                continue
            if not threads:
                report['missing'].append(f"{run['run']}/{task}: {note}")
                continue
            role = roles.get(run['run'])
            variant = variant_of(run['run'], row, role)
            rid = f"{run['run']}/{task}/r{rep}"
            base = {'run': run['run'], 'group': run['group'], 'harness': harness, 'model': row.get('model'), 'variant': variant,
                    'task': task, 'rep': rep, 'solved': row.get('resolved'), 'date': date_of(run['run']),
                    'leg': (role[0] if role else None), 'harnessVersion': row.get('harnessVersion'), 'reasoning': row.get('reasoning')}
            n_calls_all = 0
            ss_by_tool = Counter()
            nat_by_cls = Counter()
            main_turns = None
            n_units_all = 0
            n_cmds_all = 0
            n_units_ss = 0
            gutter_seen = Counter()
            for th in threads:
                calls, units = flatten_thread(harness, th)
                attach_context(calls, th['requests'])
                tid = '' if th['thread'] == 'main' else '@' + th['thread']
                ss_idx = 0
                for ci, c in enumerate(calls):
                    c['callIndex'] = ci
                    rec = {**base, 'id': f'{rid}{tid}#{ci}', 'thread': th['thread'], 'callIndex': ci, 'class': c['cls'], 'tool': c['tool'],
                           'turnIndex': c['turnIndex'], 'deliveredTurn': c['deliveredTurn'], 'turnsTotal': c['turnsTotal'], 'turnsRemaining': c['turnsRemaining'],
                           'unitId': c['unitId'], 'unitSeg': c['unitSeg'], 'unitSegCount': c['unitSegCount'], 'compound': c['compound'],
                           'args': c['args'], 'piped': c['piped'], 'redirected': c['redirected'], 'isError': c['isError']}
                    if c['cls'] == 'ss':
                        out = c['output'] or ''
                        rec.update({'ssCallIndex': ss_idx, 'viaCli': c.get('viaCli', False), 'flags': parse_flags(c['tool'], c['args']),
                                    'output': out, 'outputChars': len(out), 'outputTokensEst': est_tokens(len(out)), 'boundary': c['boundary'],
                                    'outputKind': output_kind(c['tool'], out, c['boundary'], c.get('neverCollected'), c.get('redirected')),
                                    'outputKnown': c['boundary'] in KNOWN_BOUNDARIES and not c.get('neverCollected'), 'pipeTail': c.get('pipeTail'),
                                    'unitCommand': c.get('unitCommand'), 'before': c['before'], 'after': c['after'], 'amplification': c['amplification']})
                        if c.get('persisted'):
                            # Claude Code replaced a long result by a 2 KB preview in the model context. `output` is what the model saw.
                            rec['persisted'] = True
                            rec['persistedPath'] = c.get('persistedPath')
                            try:
                                rec['persistedFullChars'] = len(open(c['persistedPath'], encoding='utf-8', errors='replace').read()) if c.get('persistedPath') and os.path.exists(c['persistedPath']) else None
                            except Exception:
                                rec['persistedFullChars'] = None
                        ss_idx += 1
                        ss_by_tool[c['tool']] += 1
                    else:
                        rec.update({'outputChars': c.get('outputChars'), 'outputTokensEst': est_tokens(c.get('outputChars') or 0) if c.get('outputChars') is not None else None,
                                    'sharedOutput': c.get('sharedOutput', False), 'amplification': c['amplification'],
                                    'args': clip(c['args'], 600)})
                        nat_by_cls[c['cls']] += 1
                    fd_d.write(json.dumps(rec, ensure_ascii=False) + '\n')
                    n_calls_all += 1
                n_units_all += len(units)
                n_cmds_all += sum((len(u.get('commands') or []) if (harness == 'codex' and not u.get('noCmd') and 'native' not in u) else 1) for r_ in th['requests'] for u in r_['units'] if not (harness == 'codex' and u.get('noCmd')))
                n_units_ss += sum(1 for u in units if u['ssSegments'])
                for u in units:
                    fd_u.write(json.dumps({**{k: base[k] for k in ('run', 'group', 'harness', 'model', 'variant', 'task', 'rep', 'solved')}, 'thread': th['thread'],
                                           'turnsTotal': len(th['requests']), **u}, ensure_ascii=False) + '\n')
                if th['thread'] == 'main':
                    main_turns = len(th['requests'])
            traj = {**base, 'id': rid, 'turns': main_turns, 'turnsMeta': turns_meta, 'turnsMatchMeta': (main_turns == turns_meta) if turns_meta is not None else None,
                    'calls': n_calls_all, 'units': n_units_all, 'cmdsCount': n_cmds_all, 'unitsWithSs': n_units_ss, 'rowCalls': row.get('calls'), 'rowSs': row.get('ss'), 'rowNativeGrep': row.get('nativeGrep'), 'cost': row.get('costRealizedUsd'), 'exitReason': row.get('exitReason'),
                    'ssCalls': dict(ss_by_tool), 'ssCallsTotal': sum(ss_by_tool.values()), 'nativeCalls': dict(nat_by_cls),
                    'threads': [t['thread'] for t in threads], 'rawSession': spath, 'agentState': state_dir, 'notes': note,
                    'resolveStatus': row.get('resolveStatus'), 'degenReran': row.get('degenReran'), 'wallMs': row.get('wallMs')}
            fd_t.write(json.dumps(traj, ensure_ascii=False) + '\n')
            ctr[(harness, 'rollouts')] += 1
            for tname, nn in ss_by_tool.items():
                ctr[(harness, tname)] += nn
            done += 1
            if note:
                report['notes'].append(f'{rid}: {note}')
            if done % 50 == 0:
                print(f'[{done}] {rid} ({time.time() - t0:.0f}s)', file=sys.stderr)
        if a.limit and done >= a.limit:
            break
    fd_d.close()
    fd_t.close()
    fd_u.close()
    report['rollouts'] = done
    report['counts'] = {f'{k[0]}|{k[1]}': v for k, v in sorted(ctr.items())}
    json.dump(report, open(os.path.join(OUT_DIR, 'extract-report.json'), 'w'), indent=1)
    print(json.dumps({k: report[k] for k in ('runs', 'rollouts')}), file=sys.stderr)
    print(json.dumps(report['counts'], indent=1), file=sys.stderr)
    print('missing:', len(report['missing']), 'notes:', len(report['notes']), file=sys.stderr)


if __name__ == '__main__':
    main()
