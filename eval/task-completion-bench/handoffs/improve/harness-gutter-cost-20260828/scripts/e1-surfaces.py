#!/usr/bin/env python3
"""E1 item 3 — read surfaces per harness x arm x gutter form on the fresh pool.

Counts every read call by surface, its output bytes, the ss-read requested range against
the delivered line count, whole-file reads, re-reads of the same file / overlapping
region, and codex middle-out truncations with the size of the deleted span.

Read-only. Writes /tmp/fp-inv/e1/surfaces.json.
"""
import json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import (R, cells, transcripts, PARSERS, turn_costs, surface_of, edit_kind,
                       cmd_of, gutter_form, resolution_index, assign_reps)

OUT = '/tmp/fp-inv/e1'
os.makedirs(OUT, exist_ok=True)

SSREAD_CALL = re.compile(r'(?:^|[\s;&|(])ss-read\s+((?:(?!&&|\|\||;|\n).)*)')
SSREAD_HDR = re.compile(r'^# ss-read (\S+) \((?:lines (\d+)-(\d+) of (\d+)|(\d+) lines?)\)', re.M)
SED_N = re.compile(r"sed\s+-n\s+'?(\d+),(\d+)p'?\s+(\S+)")
TRUNC_WARN = re.compile(r'Warning: truncated output \(original token count: (\d+)\)')
TRUNC_INLINE = re.compile(r'(\d[\d,]*)\s*tokens truncated')
CC_TRUNC = re.compile(r'\[(\d+) lines truncated\]|<response clipped>', re.I)


def parse_ssread_args(argstr):
    """-> (file, start, end) with the wrapper's own arg rules (single line, range token,
    start+count fallback)."""
    parts = [p for p in argstr.strip().split() if not p.startswith('--')]
    if not parts:
        return None
    f = parts[0]
    if len(parts) == 1:
        return (f, None, None)
    m = re.fullmatch(r'(\d+)[-:,](\d+)', parts[1])
    if m and len(parts) == 2:
        return (f, int(m.group(1)), int(m.group(2)))
    try:
        s = int(parts[1])
    except ValueError:
        return (f, None, None)
    if len(parts) == 2:
        return (f, s, s)
    try:
        e = int(parts[2])
    except ValueError:
        return (f, s, s)
    if e < s:                      # (start, COUNT) fallback the wrapper honours
        e = s + e - 1
    return (f, s, e)


def overlap(a, b):
    if a[0] != b[0]:
        return False
    s1, e1 = a[1] or 1, a[2] or 10 ** 9
    s2, e2 = b[1] or 1, b[2] or 10 ** 9
    return not (e1 < s2 or e2 < s1)


def main():
    per = collections.defaultdict(lambda: {
        'rollouts': 0, 'calls': collections.Counter(), 'bytes': collections.Counter(),
        'ssread_calls': 0, 'ssread_wholefile': 0, 'ssread_ranged': 0,
        'req_lines': 0, 'delivered_lines': 0, 'delivered_blocks': 0, 'sub15_blocks': 0,
        'gutter_blocks': collections.Counter(), 'rereads_same_file': 0, 'rereads_overlap': 0,
        'read_targets': 0, 'trunc_calls': 0, 'trunc_tokens': 0, 'trunc_spans': [],
        'trunc_by_surface': collections.Counter(), 'cc_trunc': 0,
        'hdr_range_lines': 0, 'hdr_ranged': 0, 'hdr_whole': 0, 'hdr_whole_lines': 0,
        'delivered_short': 0,
        'code_lines_by_surface_gutter': collections.Counter(),
    })
    for c in cells():
        h, arm, form, task, run, cell = c['harness'], c['arm'], c['form'], c['task'], c['run'], c['cell']
        key = f'{h}|{arm}|{form}'
        tl = transcripts(run, h, cell)
        if not tl:
            continue
        parsed = []
        for main_p, subs in tl:
            ev, turns = PARSERS[h](main_p)
            tc = turn_costs(turns)
            cost = sum(x['usd'] for x in tc)
            sd = []
            for s in subs:
                sev, stu = PARSERS[h](s)
                stc = turn_costs(stu)
                cost += sum(x['usd'] for x in stc)
                sd.append((s, sev))
            parsed.append({'path': main_p, 'ev': ev, 'cost': cost, 'subs': sd})
        parsed.sort(key=lambda x: -x['cost'])
        for p in parsed[:3]:
            S = per[key]
            S['rollouts'] += 1
            seen = []
            for path, ev in [(p['path'], p['ev'])] + p['subs']:
                for e in ev:
                    if e['kind'] != 'result':
                        continue
                    if edit_kind(h, e):
                        continue
                    out = e.get('output') or ''
                    surf = surface_of(h, e)
                    cmd = cmd_of(h, e)
                    S['calls'][surf] += 1
                    S['bytes'][surf] += len(out)
                    # ---- codex truncation
                    mw = TRUNC_WARN.search(out)
                    if mw:
                        S['trunc_calls'] += 1
                        S['trunc_tokens'] += int(mw.group(1))
                        S['trunc_by_surface'][surf] += 1
                        for mi in TRUNC_INLINE.finditer(out):
                            S['trunc_spans'].append(int(mi.group(1).replace(',', '')))
                    if h == 'claude' and CC_TRUNC.search(out):
                        S['cc_trunc'] += 1
                    # ---- ss-read requested range vs delivered
                    for m in SSREAD_CALL.finditer(cmd):
                        a = parse_ssread_args(m.group(1))
                        if not a:
                            continue
                        S['ssread_calls'] += 1
                        if a[1] is None:
                            S['ssread_wholefile'] += 1
                        else:
                            S['ssread_ranged'] += 1
                            S['req_lines'] += (a[2] - a[1] + 1)
                        S['read_targets'] += 1
                        if any(x[0] == a[0] for x in seen):
                            S['rereads_same_file'] += 1
                        if any(overlap(x, a) for x in seen):
                            S['rereads_overlap'] += 1
                        seen.append(a)
                    if h == 'claude' and (e.get('tool') == 'Read'):
                        inp = e.get('input') or {}
                        a = (str(inp.get('file_path', '')), inp.get('offset'), None)
                        if a[1] is not None and inp.get('limit'):
                            a = (a[0], int(inp['offset']), int(inp['offset']) + int(inp['limit']) - 1)
                        S['read_targets'] += 1
                        if any(x[0] == a[0] for x in seen):
                            S['rereads_same_file'] += 1
                        if any(overlap(x, a) for x in seen):
                            S['rereads_overlap'] += 1
                        seen.append(a)
                    if h == 'opencode' and e.get('tool') == 'read':
                        inp = e.get('input') or {}
                        a = (str(inp.get('filePath', '')), inp.get('offset'), None)
                        S['read_targets'] += 1
                        if any(x[0] == a[0] for x in seen):
                            S['rereads_same_file'] += 1
                        seen.append(a)
                    for m in SED_N.finditer(cmd):
                        a = (m.group(3), int(m.group(1)), int(m.group(2)))
                        S['read_targets'] += 1
                        if any(x[0] == a[0] for x in seen):
                            S['rereads_same_file'] += 1
                        if any(overlap(x, a) for x in seen):
                            S['rereads_overlap'] += 1
                        seen.append(a)
                    # ---- delivered ss-read blocks
                    for m in SSREAD_HDR.finditer(out):
                        tail = out[m.end():]
                        body = []
                        started = False
                        for ln in tail.split('\n')[:6000]:
                            if ln.startswith('```'):
                                if started:
                                    break
                                started = True
                                continue
                            if started:
                                body.append(ln)
                        S['delivered_blocks'] += 1
                        S['delivered_lines'] += len(body)
                        if len(body) < 15:
                            S['sub15_blocks'] += 1
                        g = gutter_form(body[0]) if body else 'none'
                        S['gutter_blocks'][g] += 1
                        if m.group(2):
                            want = int(m.group(3)) - int(m.group(2)) + 1
                            S['hdr_range_lines'] += want
                            S['hdr_ranged'] += 1
                            if len(body) < want:
                                S['delivered_short'] += 1
                        else:
                            S['hdr_whole'] += 1
                            S['hdr_whole_lines'] += len(body)
                    # ---- code lines by surface and gutter form (fenced blocks)
                    if surf.startswith('ss-') or surf in ('native-Read', 'native-read'):
                        lines = out.split('\n')
                        i = 0
                        while i < len(lines):
                            if lines[i].startswith('```'):
                                j = i + 1
                                blk = []
                                while j < len(lines) and not lines[j].startswith('```'):
                                    blk.append(lines[j])
                                    j += 1
                                if blk:
                                    g = gutter_form(blk[0])
                                    S['code_lines_by_surface_gutter'][f'{surf}/{g}'] += len(blk)
                                i = j + 1
                            else:
                                i += 1
                        if surf in ('native-Read', 'native-read'):
                            g = collections.Counter(gutter_form(x) for x in lines if x.strip())
                            gg = g.most_common(1)[0][0] if g else 'none'
                            S['code_lines_by_surface_gutter'][f'{surf}/{gg}'] += sum(
                                1 for x in lines if gutter_form(x) == gg)
    # ------------------------------------------------------------- report
    print(f"{'cell':26s} {'roll':>4s} | read calls per rollout by surface")
    for key in sorted(per):
        S = per[key]
        r = max(1, S['rollouts'])
        reads = {k: round(v / r, 2) for k, v in S['calls'].most_common()
                 if k.startswith('ss-') or k.startswith('native-') or k.startswith('shell:')}
        print(f"{key:26s} {S['rollouts']:4d} | {reads}")
    print('\n== bytes per call by surface')
    for key in sorted(per):
        S = per[key]
        row = {k: (round(S['bytes'][k] / max(1, v)), v) for k, v in S['calls'].most_common(8)}
        print(f"  {key:26s} " + '  '.join(f'{k}={b}B/call n={n}' for k, (b, n) in row.items()))
    print('\n== ss-read: requested range vs delivered')
    for key in sorted(per):
        S = per[key]
        r = max(1, S['rollouts'])
        print(f"  {key:26s} calls={S['ssread_calls']:4d} ({S['ssread_calls']/r:.2f}/roll) "
              f"whole-file={S['ssread_wholefile']:4d} ranged={S['ssread_ranged']:4d} "
              f"req_lines={S['req_lines']:6d} delivered_blocks={S['delivered_blocks']:4d} "
              f"delivered_lines={S['delivered_lines']:6d} sub15={S['sub15_blocks']:3d} "
              f"gutter={dict(S['gutter_blocks'])}")
        print(f"  {'':26s}   headers: ranged={S['hdr_ranged']} asked={S['hdr_range_lines']} "
              f"short-delivered={S['delivered_short']} whole-file-headers={S['hdr_whole']} "
              f"whole-file-lines={S['hdr_whole_lines']}")
    print('\n== re-reads')
    for key in sorted(per):
        S = per[key]
        print(f"  {key:26s} read-targets={S['read_targets']:5d} same-file-again={S['rereads_same_file']:5d} "
              f"overlapping-range={S['rereads_overlap']:5d}")
    print('\n== truncation')
    for key in sorted(per):
        S = per[key]
        sp = sorted(S['trunc_spans'])
        med = sp[len(sp) // 2] if sp else 0
        print(f"  {key:26s} codex-truncated-calls={S['trunc_calls']:4d} "
              f"tokens-before-trunc(sum)={S['trunc_tokens']:7d} spans n={len(sp)} "
              f"median={med} max={sp[-1] if sp else 0} by-surface={dict(S['trunc_by_surface'])} "
              f"claude-clipped={S['cc_trunc']}")
    print('\n== delivered code lines by surface / gutter form')
    for key in sorted(per):
        print(f"  {key:26s} {dict(per[key]['code_lines_by_surface_gutter'].most_common(10))}")
    json.dump({k: {kk: (dict(vv) if isinstance(vv, collections.Counter) else vv)
                   for kk, vv in v.items()} for k, v in per.items()},
              open(os.path.join(OUT, 'surfaces.json'), 'w'), default=str)
    print('\nwrote', os.path.join(OUT, 'surfaces.json'))


if __name__ == '__main__':
    main()
