#!/usr/bin/env python3
"""E1 items 1, 2 and 4 — edit-mechanism census over the 12 fresh-pool runs.

Per (harness, arm, gutter form): edit calls by mechanism, failures, failure classes,
retry linkage, the priced turn span of every failure+retry pair, gutter residue in every
failed anchor, and the provenance (last tool output that showed the region + its gutter
form) of every failed anchor.

Read-only. Writes /tmp/fp-inv/e1/census.json and prints tables.
"""
import json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import (R, cells, transcripts, PARSERS, turn_costs, edit_kind, cmd_of,
                       classify_failure, anchors_of, ANCHOR_FAIL, gutter_form, strip_gutter,
                       strip_naive, strip_digits, carry_signature, surface_of, golden_for,
                       resolve_path, G_ANY, G_TAB, G_PIPE, G_COLON, PRICE, rep_of_stream,
                       resolution_index, assign_reps)

OUT = '/tmp/fp-inv/e1'
os.makedirs(OUT, exist_ok=True)


def indent_of(s):
    return re.match(r'^[ \t]*', s).group(0)


def classify_anchor(anchor, disk_lines, prov):
    """Return (class, detail). Uses the base file when available, else the shown bytes."""
    A = [x for x in anchor]
    while A and A[-1] == '':
        A = A[:-1]
    if not A:
        return 'empty-anchor', {}
    first = next((x for x in A if x.strip()), None)
    if first is None:
        return 'blank-anchor', {}
    det = {}
    # 1. gutter residue
    residue = [x for x in A if G_ANY.match(x)]
    if residue:
        det['residue_bytes'] = residue[:3]
        return 'gutter-residue', det
    if disk_lines is not None:
        src = '\n'.join(disk_lines)
        if '\n'.join(A) in src:
            return 'text-exists-in-base', det        # hunk order / ambiguity / already applied
        cands = [i for i, l in enumerate(disk_lines) if l.strip() == first.strip()]
        if not cands:
            key = re.sub(r'\s+', '', first)[:24]
            if key:
                cands = [i for i, l in enumerate(disk_lines) if key in re.sub(r'\s+', '', l)]
        if not cands:
            return 'absent-from-base', det
        off = A.index(first)
        best = None
        for i in cands:
            s = i - off
            if s < 0:
                continue
            win = disk_lines[s:s + len(A)]
            nd = sum(1 for k in range(len(A)) if (win[k] if k < len(win) else None) != A[k])
            if best is None or nd < best[1]:
                best = (s, nd)
        if best is None:
            return 'absent-from-base', det
        s, nd = best
        win = disk_lines[s:s + len(A)]
        deltas = collections.Counter()
        body = 0
        ex = None
        for k in range(len(A)):
            b = win[k] if k < len(win) else ''
            if A[k] == b:
                continue
            if ex is None:
                ex = (k, A[k], b)
            ia, ib = indent_of(A[k]), indent_of(b)
            if A[k].strip() != b.strip():
                body += 1
            elif ia != ib:
                if ('\t' in ia) != ('\t' in ib):
                    deltas['tab<->space'] += 1
                else:
                    deltas[len(ia) - len(ib)] += 1
            else:
                deltas['trailing'] += 1
        det['base_line'] = s + 1
        det['n_diff'] = nd
        det['indent_deltas'] = {str(k): v for k, v in deltas.items()}
        det['first_diff'] = ex
        if body:
            det['body_lines'] = body
            return 'body-text-differs', det
        if deltas:
            keys = [k for k in deltas if isinstance(k, int)]
            if keys and set(keys) == {1}:
                return 'whitespace+1', det
            if keys and set(keys) == {2}:
                return 'whitespace+2', det
            return 'whitespace-other', det
        return 'no-diff-found', det
    # no base file
    if prov and prov.get('faithful_copy') is False and prov.get('indent_delta'):
        d = prov['indent_delta']
        return ('whitespace+1' if d == 1 else 'whitespace+2' if d == 2 else 'whitespace-other'), det
    return 'unclassified', det


GARBAGE = re.compile(r'[-˿̀-ͯЀ-῿ -⯿ऀ-෿︀-️\U0001F300-\U0001FAFF]')


def main():
    per = collections.defaultdict(lambda: {
        'rollouts': 0, 'mech': collections.Counter(), 'mech_fail': collections.Counter(),
        'edits': 0, 'fails': 0, 'rollouts_with_fail': 0, 'anchor_fails': 0,
        'rollouts_with_anchor_fail': 0, 'classes': collections.Counter(),
        'anchor_classes': collections.Counter(), 'retry_yes': 0, 'retry_ok': 0, 'retry_no': 0,
        'prov': collections.Counter(), 'residue': 0, 'fail_usd_span': 0.0, 'fail_usd_marg': 0.0,
        'fail_tok_out': 0, 'fail_tok_newin': 0, 'fail_tok_resent': 0,
        'rollout_usd': 0.0, 'turns': 0, 'carry': collections.Counter(),
        'fail_in_solved': 0, 'fail_in_unsolved': 0, 'resolved': 0, 'rep_known': 0,
        'fail_usd_oneturn': 0.0, 'fail_turns_between': 0,
    })
    cases = []
    missing = []
    for c in cells():
        h, arm, form, task, run, cell = c['harness'], c['arm'], c['form'], c['task'], c['run'], c['cell']
        key = f'{h}|{arm}|{form}'
        tl = transcripts(run, h, cell)
        if not tl:
            missing.append(c)
            continue
        parsed = []
        for main_p, subs in tl:
            ev, turns = PARSERS[h](main_p)
            tc = turn_costs(turns)
            cost = sum(x['usd'] for x in tc)
            subdat = []
            for s in subs:
                sev, stu = PARSERS[h](s)
                stc = turn_costs(stu)
                cost += sum(x['usd'] for x in stc)
                subdat.append((s, sev, stc))
            parsed.append({'path': main_p, 'ev': ev, 'tc': tc, 'cost': cost, 'subs': subdat})
        parsed.sort(key=lambda x: -x['cost'])
        parsed = parsed[:3]                      # trap 5: the 3 dearest per cell
        gold = golden_for(task)
        byrep, bycell, bypath = resolution_index(run)
        reps = assign_reps([x['path'] for x in parsed], [x['ev'] for x in parsed], bypath)
        for pi, p in enumerate(parsed):
            S = per[key]
            S['rollouts'] += 1
            S['rollout_usd'] += p['cost']
            S['turns'] += len(p['tc'])
            rep = reps[pi]
            solved = byrep.get((task, arm, rep))
            if solved is not None:
                S['rep_known'] += 1
                S['resolved'] += 1 if solved else 0
            streams = [(p['path'], p['ev'], p['tc'], 'main')] + [(sp, se, st, 'sub') for sp, se, st in p['subs']]
            rollout_failed = False
            rollout_anchor_failed = False
            for path, ev, tc, which in streams:
                shown = []          # (idx, surface, gform, lines)
                edit_events = []    # (idx, file, ok)
                disk_cache = {}
                for idx, e in enumerate(ev):
                    if e['kind'] == 'patch_apply_end':
                        continue
                    if e['kind'] != 'result':
                        continue
                    out = e.get('output') or ''
                    surf = surface_of(h, e)
                    ek = edit_kind(h, e)
                    if out and not ek:
                        ls = out.split('\n')
                        gf = collections.Counter(gutter_form(x) for x in ls if x.strip())
                        shown.append((idx, surf, gf.most_common(1)[0][0] if gf else 'none', ls))
                    if not ek:
                        continue
                    S['mech'][ek] += 1
                    S['edits'] += 1
                    tags, failed = classify_failure(h, e, ek)
                    fpaths = [a[0] for a in anchors_of(h, e, ek)]
                    fmain = fpaths[0] if fpaths else (str((e.get('input') or {}).get('file_path') or
                                                          (e.get('input') or {}).get('filePath') or ''))
                    edit_events.append({'idx': idx, 'file': os.path.basename(fmain), 'ok': not failed,
                                        'turn': e.get('turn', 0), 'kind': ek})
                    if not failed:
                        continue
                    S['mech_fail'][ek] += 1
                    S['fails'] += 1
                    rollout_failed = True
                    for t in (tags or ['unclassified']):
                        S['classes'][t] += 1
                    if any(t in ANCHOR_FAIL for t in tags):
                        S['anchor_fails'] += 1
                        rollout_anchor_failed = True
                    if solved is True:
                        S['fail_in_solved'] += 1
                    elif solved is False:
                        S['fail_in_unsolved'] += 1
                    # ---- per-failed-anchor forensics
                    anchors = anchors_of(h, e, ek)
                    errout = e.get('output') or ''
                    quoted = None
                    mm = re.search(r'Failed to find (?:expected lines|context) (?:in )?(\S+?):?\n(.*)', errout, re.S)
                    if mm:
                        quoted = mm.group(2).split('\n')
                    picked = anchors
                    if quoted and anchors:
                        q = [x for x in quoted if x.strip()][:3]
                        for a in anchors:
                            aa = [x for x in a[1] if x.strip()][:3]
                            if aa and q and aa[0].strip() == q[0].strip():
                                picked = [a]
                                break
                    for (fp, anchor, hdr, raw) in picked[:4]:
                        first = next((x for x in anchor if x.strip()), '')
                        prov = None
                        if first:
                            for (sidx, surf2, gf2, ls) in reversed(shown):
                                if sidx >= idx:
                                    continue
                                hit = None
                                for k, l in enumerate(ls):
                                    if l.strip() == first.strip() or strip_gutter(l).strip() == first.strip():
                                        hit = k
                                        break
                                if hit is None:
                                    continue
                                l = ls[hit]
                                g = gutter_form(l)
                                seg = ls[hit:hit + len(anchor)]
                                win = [strip_gutter(x) for x in seg]
                                naive = [strip_naive(x) if strip_naive(x) is not None else strip_gutter(x)
                                         for x in seg]
                                digs = [strip_digits(x) if strip_digits(x) is not None else strip_gutter(x)
                                        for x in seg]
                                # a mis-strip only COUNTS when it actually differs from the
                                # clean strip — otherwise an un-gutted block matches all three
                                if naive == win:
                                    naive = None
                                if digs == win:
                                    digs = None
                                shown_line = strip_gutter(l)
                                d = len(indent_of(first)) - len(indent_of(shown_line))
                                sig = carry_signature(l, first)
                                prov = {'surface': surf2, 'gutter': g, 'shown_bytes': l[:160],
                                        'faithful_copy': win[:len(anchor)] == anchor,
                                        'matches_naive_strip': bool(naive) and naive[:len(anchor)] == anchor,
                                        'matches_digits_only_strip': bool(digs) and digs[:len(anchor)] == anchor,
                                        'carry_signature_first_line': sig,
                                        'indent_delta': d}
                                break
                        disk_lines = None
                        rp = resolve_path(gold, fp)
                        if rp:
                            if rp not in disk_cache:
                                try:
                                    disk_cache[rp] = open(rp, encoding='utf8', errors='replace').read().split('\n')
                                except Exception:
                                    disk_cache[rp] = None
                            disk_lines = disk_cache[rp]
                        acls, det = classify_anchor(anchor, disk_lines, prov)
                        if acls == 'gutter-residue':
                            S['residue'] += 1
                        if any(GARBAGE.search(x) for x in anchor[:20]):
                            acls = 'decoding-garbage' if acls in ('absent-from-base', 'body-text-differs', 'unclassified') else acls
                        S['anchor_classes'][acls] += 1
                        S['prov'][(prov or {}).get('surface', 'never-shown') + '/' + (prov or {}).get('gutter', '-')] += 1
                        if prov:
                            if prov.get('faithful_copy'):
                                S['carry']['clean strip — anchor is a faithful copy'] += 1
                            elif prov.get('matches_digits_only_strip'):
                                S['carry']['CARRY whole anchor: digits stripped, DELIMITER kept'] += 1
                            elif prov.get('matches_naive_strip'):
                                S['carry']['CARRY whole anchor: digits+glyph stripped, SPACE kept'] += 1
                            elif prov.get('carry_signature_first_line') == 'clean-strip':
                                S['carry']['first line clean, later lines diverge'] += 1
                            elif prov.get('carry_signature_first_line'):
                                S['carry']['CARRY first line: ' + prov['carry_signature_first_line']] += 1
                            else:
                                S['carry']['no carry signature'] += 1
                        else:
                            S['carry']['never shown'] += 1
                        # ---- retry linkage + price
                        ft = e.get('turn', 0)
                        rtn = None
                        rok = None
                        for later in ev[idx + 1:]:
                            if later['kind'] != 'result':
                                continue
                            lk = edit_kind(h, later)
                            if not lk:
                                continue
                            lpaths = [a[0] for a in anchors_of(h, later, lk)]
                            lm = os.path.basename(lpaths[0]) if lpaths else ''
                            if lm and lm != os.path.basename(fp):
                                continue
                            _, lfailed = classify_failure(h, later, lk)
                            rtn = later.get('turn', ft)
                            rok = not lfailed
                            break
                        span = marg = one = 0.0
                        nturns = 0
                        tok = {'newIn': 0, 'resent': 0, 'out': 0}
                        if rtn is not None:
                            lo, hi = min(ft, rtn), max(ft, rtn)
                            for i in range(lo, min(hi, len(tc) - 1) + 1):
                                span += tc[i]['usd']
                                tok['newIn'] += tc[i]['newIn']
                                tok['resent'] += tc[i]['resent']
                                tok['out'] += tc[i]['out']
                            for i in range(lo + 1, min(hi, len(tc) - 1) + 1):
                                marg += tc[i]['usd']
                                nturns += 1
                            if hi < len(tc):
                                one = tc[hi]['usd']     # the ONE extra request the retry cost
                            S['retry_yes'] += 1
                            S['fail_usd_oneturn'] += one
                            S['fail_turns_between'] += nturns
                            S['retry_ok'] += 1 if rok else 0
                        else:
                            S['retry_no'] += 1
                            if ft < len(tc):
                                span = marg = one = tc[ft]['usd']
                                tok = {'newIn': tc[ft]['newIn'], 'resent': tc[ft]['resent'], 'out': tc[ft]['out']}
                                S['fail_usd_oneturn'] += one
                        S['fail_usd_span'] += span
                        S['fail_usd_marg'] += marg
                        S['fail_tok_out'] += tok['out']
                        S['fail_tok_newin'] += tok['newIn']
                        S['fail_tok_resent'] += tok['resent']
                        cases.append({
                            'harness': h, 'arm': arm, 'form': form, 'task': task, 'run': run,
                            'transcript': path.replace(R + '/', ''), 'stream': which,
                            'call_id': e.get('id'), 'mech': ek, 'tags': tags, 'anchor_class': acls,
                            'file': fp, 'n_anchor': len(anchor), 'hunk_hdr': hdr,
                            'anchor_head': anchor[:6], 'detail': det, 'prov': prov,
                            'err_head': errout[:400], 'fail_turn': ft, 'retry_turn': rtn,
                            'retry_ok': rok, 'usd_span': round(span, 8), 'usd_marginal': round(marg, 8),
                            'tokens': tok, 'rep': rep, 'resolved': solved,
                            'usd_one_extra_request': round(one, 8), 'turns_between': nturns,
                        })
            if rollout_failed:
                per[key]['rollouts_with_fail'] += 1
            if rollout_anchor_failed:
                per[key]['rollouts_with_anchor_fail'] += 1
    # ---------------------------------------------------------------- report
    print(f'MISSING CELLS: {len(missing)}')
    for m in missing[:20]:
        print('   ', m)
    hdr = (f"{'cell':26s} {'roll':>4s} {'edits':>6s} {'ed/roll':>7s} {'fail':>5s} {'fail%':>6s} "
           f"{'anch':>5s} {'r≥1f':>5s} {'r≥1a':>5s} {'retry':>5s} {'rOK':>4s} {'$span':>9s} {'$marg':>9s} {'solved':>7s}")
    print('\n' + hdr)
    print('-' * len(hdr))
    for key in sorted(per):
        S = per[key]
        r = S['rollouts']
        print(f"{key:26s} {r:4d} {S['edits']:6d} {S['edits']/max(1,r):7.2f} {S['fails']:5d} "
              f"{100*S['fails']/max(1,S['edits']):5.1f}% {S['anchor_fails']:5d} {S['rollouts_with_fail']:5d} "
              f"{S['rollouts_with_anchor_fail']:5d} "
              f"{S['retry_yes']:5d} {S['retry_ok']:4d} {S['fail_usd_span']:9.5f} {S['fail_usd_marg']:9.5f} "
              f"{S['resolved']:3d}/{S['rep_known']:<3d}")
    print('\n== price of the failure -> retry episode (lower bound = the ONE extra request)')
    for key in sorted(per):
        S = per[key]
        tot = max(1e-9, S['rollout_usd'])
        print(f"  {key:26s} fails={S['fails']:3d} one-extra-request=${S['fail_usd_oneturn']:.5f} "
              f"({100*S['fail_usd_oneturn']/tot:5.2f}% of cell) whole-episode=${S['fail_usd_span']:.5f} "
              f"({100*S['fail_usd_span']/tot:5.2f}%) turns-between(sum)={S['fail_turns_between']}")
    print('\n== gutter carry signature on failed anchors (does the anchor equal the SHOWN line mis-stripped?)')
    for key in sorted(per):
        print(f"  {key:26s} {dict(per[key]['carry'].most_common())}")
    print('\n== failures by rollout outcome')
    for key in sorted(per):
        S = per[key]
        print(f"  {key:26s} in-solved={S['fail_in_solved']} in-unsolved={S['fail_in_unsolved']}")
    print('\n== mechanisms')
    for key in sorted(per):
        S = per[key]
        print(f"  {key:26s} {dict(S['mech'].most_common())}")
        if S['mech_fail']:
            print(f"  {'':26s} FAILED: {dict(S['mech_fail'].most_common())}")
    print('\n== failure classes (harness error strings)')
    for key in sorted(per):
        print(f"  {key:26s} {dict(per[key]['classes'].most_common())}")
    print('\n== anchor classes (forensic, vs the base file)')
    for key in sorted(per):
        print(f"  {key:26s} residue={per[key]['residue']} {dict(per[key]['anchor_classes'].most_common())}")
    print('\n== provenance of failed anchors (surface/gutter)')
    for key in sorted(per):
        print(f"  {key:26s} {dict(per[key]['prov'].most_common())}")
    print('\n== rollout cost check ($/rollout, ideal, sidechain-inclusive on claude)')
    for key in sorted(per):
        S = per[key]
        print(f"  {key:26s} n={S['rollouts']:3d} total=${S['rollout_usd']:.6f} per=${S['rollout_usd']/max(1,S['rollouts']):.6f} turns/roll={S['turns']/max(1,S['rollouts']):.1f}")
    json.dump({'per': {k: {kk: (dict(vv) if isinstance(vv, collections.Counter) else vv)
                           for kk, vv in v.items()} for k, v in per.items()},
               'cases': cases,
               'missing': missing,
               'price': PRICE},
              open(os.path.join(OUT, 'census.json'), 'w'), default=str)
    print(f"\nwrote {os.path.join(OUT,'census.json')}  cases={len(cases)}")


if __name__ == '__main__':
    main()
