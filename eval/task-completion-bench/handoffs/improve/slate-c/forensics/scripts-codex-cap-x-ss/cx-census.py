#!/usr/bin/env python3
"""codex-cap-x-ss — extension of the 08-28 truncation census (t1-census.py) on
fp-codex-tab-20260826, native + sweet TAB only.

NEW against 12-truncation-census.md:
  1. section-loss anatomy per truncated ss-* output: which ranks died, whether the
     `sufficient=` line, the `route=` trailer, `shown-full:` and the ss-read
     `# unread below … — continue:` pointer survived (separately, not as one regex);
     definition lines inside resolved ss-read gaps (from the golden file).
  2. request-window (not call-window) re-fetch: any class (a)/(c) call in the next
     THREE MODEL REQUESTS; calls-per-request in the window.
  3. cascade: is the re-fetch itself truncated again?
  4. over-fetch: lines/tokens the class-(a) re-read delivered vs lines/tokens the gap held.
  5. pointer follow-rate: for EVERY `# unread below … — continue: ss-read F A B` line the
     wrapper emitted (truncated output or not), did a later ss-read of F overlap [A,B]
     within 1/2/3 calls, 3 requests, or ever?
  6. per-request price statistics of the cell (mean/median $ per request, mean resident
     prefix, mean output) to price one added continuation request.
  7. ss-grep call and truncation counts (the census table had no ss-grep column).

Read-only. Writes only under /tmp/wf-slatec/codex-cap-x-ss/.
Reuses: /tmp/fp-inv/e1/e1_common.py and /tmp/fp-inv/trunc/t1-census.py (imported).
"""
import json, os, re, sys, collections, statistics
from importlib.machinery import SourceFileLoader
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import (R, pool, transcripts, events_codex, turn_costs, golden_for,
                       resolve_path, resolution_index, assign_reps, strip_gutter, PRICE)
t1 = SourceFileLoader('t1c', '/tmp/fp-inv/trunc/t1-census.py').load_module()

OUT = '/tmp/wf-slatec/codex-cap-x-ss'
os.makedirs(OUT, exist_ok=True)
RUN = 'fp-codex-tab-20260826'
CELLS = [('native', RUN), ('sweet', RUN)]

TRUNC_WARN = t1.TRUNC_WARN
ORIG_TOK = t1.ORIG_TOK
MARK = t1.MARK
H_SSREAD = t1.H_SSREAD
H_RANK_FULL = re.compile(r'^## #(\d+) (\S+?):(\d+)-(\d+)(?: \[([^\]]*)\])? \(([^)]*)\)', re.M)
POINTER = re.compile(r'^# unread below \((\d+)-(\d+)\)(?::([^\n]*?))? — continue: ss-read (\S+) (\d+) (\d+)\s*$', re.M)
RESULTS_N = re.compile(r'\bresults=(\d+)')
DEF_RX = re.compile(r'^\s*(?:export\s+)?(?:async\s+)?(?:def |class |function\b|func |fn |pub fn |public |private |protected |static |module |defmodule |defp? |sub |proc |type \w+ struct|interface |impl |const \w+ = (?:async )?\(|let \w+ = (?:async )?\(|\w[\w<>\[\], ]* \w+\s*\([^;]*\)\s*\{?\s*$)')
BYTES_PER_TOK = 3.99   # measured 08-28 (logs/p1-capreplay.txt)


def est_tokens(s):
    m = ORIG_TOK.search(s or '')
    if m:
        return int(m.group(1)), 'codex-count'
    body = s or ''
    i = body.find('Output:\n')
    if i >= 0:
        body = body[i + 8:]
    return int(round(len(body.encode('utf8')) / BYTES_PER_TOK)), 'bytes/3.99'


def block_after(out, pos):
    """text from pos up to the next block header (or end)."""
    m = re.search(r'\n(# ss-read |# ss-search:|## #\d+ |# ss-grep|# ss-find|# ss-trace|# ss-semantic)', out[pos:])
    return out[pos: pos + m.start()] if m else out[pos:]


def golden_lines(gold, fp, cache):
    return t1.golden_lines(gold, fp, cache)


def main():
    cache = {}
    report = {'meta': {'run': RUN, 'price': PRICE, 'bytes_per_tok': BYTES_PER_TOK}}
    cells_out = {}
    all_cases = []
    all_pointers = []
    P = pool()
    byrep, bycell, bypath = resolution_index(RUN)
    for arm, run in CELLS:
        S = {'rollouts': 0, 'requests': 0, 'req_usd': [], 'req_in': [], 'req_out': [],
             'req_newin': [], 'calls': 0, 'multi_call_requests': 0,
             'ss_grep_calls': 0, 'ss_grep_envelopes': 0, 'trunc_calls': 0,
             'trunc_ss_grep_class': 0, 'by_class': collections.Counter(),
             'pointer_lines': 0, 'pointer_outputs': 0, 'tools': collections.Counter(),
             'async_cell_outputs': 0}
        for task in P:
            cell = f'{task}-{arm}'
            tl = transcripts(run, 'codex', cell)
            if not tl:
                continue
            parsed = []
            for mp, _ in tl:
                ev, turns = events_codex(mp)
                tc = turn_costs(turns)
                parsed.append({'path': mp, 'ev': ev, 'turns': turns, 'tc': tc,
                               'cost': sum(x['usd'] for x in tc)})
            parsed.sort(key=lambda x: -x['cost'])
            sel = parsed[:3]
            reps = assign_reps([p['path'] for p in sel], [p['ev'] for p in sel], bypath)
            gold = golden_for(task)
            for p, rep in zip(sel, reps):
                S['rollouts'] += 1
                ev, tc = p['ev'], p['tc']
                nturns = len(tc)
                S['requests'] += nturns
                for x in tc:
                    S['req_usd'].append(x['usd']); S['req_in'].append(x['in'])
                    S['req_out'].append(x['out']); S['req_newin'].append(x['newIn'])
                resolved = byrep.get((task, arm, rep))
                results = [e for e in ev if e['kind'] == 'result']
                S['calls'] += len(results)
                for e in results:
                    S['tools'][e.get('tool') or '?'] += 1
                    if 'Script running with cell ID' in (e.get('output') or ''):
                        S['async_cell_outputs'] += 1
                per_turn = collections.Counter(e['turn'] for e in results)
                S['multi_call_requests'] += sum(1 for v in per_turn.values() if v > 1)
                shown_all = set()
                for e in results:
                    for l in (e.get('output') or '').split('\n'):
                        s = strip_gutter(l).strip()
                        if s:
                            shown_all.add(s)
                # ss-grep census
                for e in results:
                    cmd = str((e.get('input') or {}).get('cmd') or '')
                    n = len(re.findall(r'(?:^|[\s;&|(])ss-grep(?=\s|$)', cmd))
                    if n:
                        S['ss_grep_calls'] += n
                        S['ss_grep_envelopes'] += 1
                trunc_idx = set(i for i, e in enumerate(results) if TRUNC_WARN.search(e.get('output') or ''))
                # ---- pointer follow-rate over EVERY ss-read output with a trailer
                for i, e in enumerate(results):
                    out = e.get('output') or ''
                    ptrs = list(POINTER.finditer(out))
                    if not ptrs:
                        continue
                    S['pointer_outputs'] += 1
                    for pm in ptrs:
                        S['pointer_lines'] += 1
                        A, B, names, F, cA, cB = (int(pm.group(1)), int(pm.group(2)), pm.group(3),
                                                  pm.group(4), int(pm.group(5)), int(pm.group(6)))
                        first_k = None; first_req_dist = None; how = None; f_trunc = None; f_cmd = None; f_lines = None
                        for j in range(i + 1, len(results)):
                            fcmd = str((results[j].get('input') or {}).get('cmd') or '')
                            for t in t1.read_targets(fcmd):
                                if t1.same_file(t[0], F) and t1.spans_overlap(t[1], t[2], A, B):
                                    first_k = j - i
                                    first_req_dist = (results[j]['turn'] or 0) - (e['turn'] or 0)
                                    how = 'whole-file' if (t[1] in (None, 1) and t[2] is None) else (
                                        'exact' if (t[1] == A and t[2] == B) else 'overlap')
                                    f_trunc = j in trunc_idx; f_cmd = fcmd[:160]
                                    f_lines = (t[2] - t[1] + 1) if (t[1] is not None and t[2] is not None) else None
                                    break
                            if first_k is not None:
                                break
                        all_pointers.append({
                            'cell': arm, 'task': task, 'rep': rep, 'resolved': resolved,
                            'transcript': os.path.basename(p['path']),
                            'call_index': i, 'turn': e.get('turn'), 'file': F, 'lo': A, 'hi': B,
                            'span_lines': B - A + 1, 'has_names': bool(names and names.strip()),
                            'output_truncated': i in trunc_idx, 'later_calls': len(results) - i - 1,
                            'later_requests': max(0, nturns - (e.get('turn') or 0) - 1),
                            'followed_k': first_k, 'followed_req_dist': first_req_dist, 'how': how,
                            'followed_truncated': f_trunc, 'followed_cmd': f_cmd, 'followed_lines': f_lines})
                # ---- truncations
                for i in sorted(trunc_idx):
                    e = results[i]
                    out = e.get('output') or ''
                    mw = TRUNC_WARN.search(out)
                    inp = e.get('input') or {}
                    cmd = str(inp.get('cmd') or '')
                    markers = list(MARK.finditer(out))
                    orig = int(mw.group(1))
                    deleted = sum(int(m.group(1).replace(',', '')) for m in markers)
                    S['trunc_calls'] += 1
                    cands = [t[0] for t in t1.read_targets(cmd)]
                    mrecs = []
                    for m in markers:
                        r = t1.resolve_marker(out, m, gold, cache, cands)
                        r['deleted_tokens'] = int(m.group(1).replace(',', ''))
                        r['class'] = t1.marker_class(out, m, cmd)
                        S['by_class'][r['class']] += 1
                        if r['class'].startswith('ss-grep'):
                            S['trunc_ss_grep_class'] += 1
                        # --- definition lines inside a resolved gap (golden)
                        r['gap_def_lines'] = None
                        r['gap_lines'] = None
                        if r.get('file') and r.get('lo') is not None and r.get('hi') is not None and r.get('how') == 'gutter':
                            gl = golden_lines(gold, r['file'], cache)
                            if gl:
                                lo, hi = r['lo'], min(r['hi'], len(gl))
                                seg = gl[lo - 1: hi]
                                r['gap_lines'] = hi - lo + 1
                                r['gap_def_lines'] = sum(1 for l in seg if DEF_RX.match(l))
                        # --- ss-read block trailer survival (exact numbers)
                        r['ssread_trailer'] = None
                        kind, hfile, hlo, hhi, rank = t1.preceding_block(out, m.start())
                        if kind == 'ss-read' and hfile:
                            hm = None
                            for hh in H_SSREAD.finditer(out[:m.start()]):
                                hm = hh
                            if hm and hm.group(2):
                                tot = re.search(r'\(lines \d+-\d+ of (\d+)\)', hm.group(0))
                                N = int(tot.group(1)) if tot else None
                                B = int(hm.group(3))
                                if N and B < N:
                                    expected = f'# unread below ({B + 1}-{N})'
                                    r['ssread_trailer'] = {'expected': True,
                                                           'survived': expected in out}
                                else:
                                    r['ssread_trailer'] = {'expected': False, 'survived': None}
                        mrecs.append(r)
                    # --- pack anatomy
                    pack = None
                    is_pack = any(x['class'].split('?')[0] in ('ss-search', 'ss-find', 'ss-semantic', 'ss-grep', 'ss-trace') for x in mrecs)
                    if is_pack or '# ss-search:' in out:
                        first, last = markers[0].start(), markers[-1].end()
                        head = [(int(h.group(1)), h.group(5) or '', h.group(2), h.group(6)) for h in H_RANK_FULL.finditer(out[:first])]
                        tail = [(int(h.group(1)), h.group(5) or '', h.group(2)) for h in H_RANK_FULL.finditer(out[last:])]
                        tail_txt = out[last:]
                        rn = RESULTS_N.findall(tail_txt)
                        results_n = int(rn[-1]) if rn else None
                        seen = set(h[0] for h in head) | set(h[0] for h in tail)
                        lost = None
                        if results_n:
                            lost = [k for k in range(1, results_n + 1) if k not in seen]
                        elif tail:
                            lost = [k for k in range(1, max(h[0] for h in tail) + 1) if k not in seen]
                        pack = {'sufficient_anywhere': 'sufficient=' in out, 'subcmds': len(t1.split_subcmds(cmd)),
                                'head_presentation': [h_[6] if len(h_) > 6 else None for h_ in []],
                                'cut_in_rank': (head[-1][0] if head else None),
                                'cut_in_rank_presentation': (head[-1][3] if head else None),
                                'ranks_head': [h[0] for h in head], 'ranks_tail': [h[0] for h in tail],
                                'results_n': results_n, 'lost_ranks': lost,
                                'sufficient_survived': 'sufficient=' in tail_txt,
                                'sufficient_value': (re.search(r'sufficient=(\S+)', tail_txt).group(1) if re.search(r'sufficient=(\S+)', tail_txt) else None),
                                'route_survived': bool(re.search(r'^route=', tail_txt, re.M)),
                                'shown_full_survived': bool(re.search(r'^shown-full:', tail_txt, re.M)),
                                'unread_below_survived': '# unread below' in tail_txt,
                                'head_symbols': [h[1] for h in head], 'tail_symbols_n': len(tail),
                                'graph_edges_in_tail': len(re.findall(r'^- (?:calls|called by|imports|imported by|extends|implements|uses|used by) ', tail_txt, re.M))}
                    # --- follow-ups by CALL (k=1..3) and by REQUEST window (<= +3 requests)
                    turn_i = e.get('turn') or 0
                    fus = []
                    for k in range(1, 4):
                        j = i + k
                        if j >= len(results):
                            fus.append({'k': k, 'cls': 'e-ended', 'turn': None, 'truncated_again': False})
                            continue
                        f = results[j]
                        fcmd = str((f.get('input') or {}).get('cmd') or '')
                        cls = t1.classify_followup(fcmd, mrecs, gold, cache, shown_all)
                        rec = {'k': k, 'cls': cls, 'turn': f.get('turn'), 'cmd': fcmd[:200],
                               'truncated_again': j in trunc_idx, 'call_index': j}
                        if cls == 'a-reread-gap':
                            # over-fetch: lines and tokens delivered vs gap
                            tg = t1.read_targets(fcmd)
                            req_lines = None
                            for t in tg:
                                for r in mrecs:
                                    if r.get('file') and t1.same_file(t[0], r['file']):
                                        if t[1] is not None and t[2] is not None:
                                            req_lines = (req_lines or 0) + (t[2] - t[1] + 1)
                                        else:
                                            gl = golden_lines(gold, r['file'], cache)
                                            if gl:
                                                req_lines = (req_lines or 0) + len(gl)
                                        break
                            gap_lines = sum((r['hi'] - r['lo'] + 1) for r in mrecs if r.get('lo') is not None and r.get('hi') is not None)
                            gap_tokens = sum(r['deleted_tokens'] for r in mrecs if r.get('lo') is not None and r.get('hi') is not None) or deleted
                            ftok, fhow = est_tokens(f.get('output') or '')
                            # block-level: only the ss-read block(s) of the SAME file inside the follow-up output
                            fout = f.get('output') or ''
                            blk_tok = 0; blk_n = 0
                            for hh in H_SSREAD.finditer(fout):
                                if any(r.get('file') and t1.same_file(hh.group(1), r['file']) for r in mrecs):
                                    seg = block_after(fout, hh.start())
                                    blk_tok += int(round(len(seg.encode('utf8')) / BYTES_PER_TOK)); blk_n += 1
                            rec.update({'reread_req_lines': req_lines, 'gap_lines': gap_lines or None,
                                        'reread_tokens': ftok, 'reread_tokens_how': fhow, 'gap_tokens': gap_tokens,
                                        'reread_block_tokens': blk_tok if blk_n else None, 'reread_blocks': blk_n,
                                        'subcmds': len(t1.split_subcmds(fcmd))})
                        fus.append(rec)
                    # request window
                    win = [(j, results[j]) for j in range(i + 1, len(results)) if 0 < ((results[j]['turn'] or 0) - turn_i) <= 3]
                    win_cls = []
                    for j, f in win:
                        fcmd = str((f.get('input') or {}).get('cmd') or '')
                        win_cls.append(t1.classify_followup(fcmd, mrecs, gold, cache, shown_all))
                    # any later re-read of the gap EVER (call distance)
                    ever_k = None
                    for j in range(i + 1, len(results)):
                        fcmd = str((results[j].get('input') or {}).get('cmd') or '')
                        if t1.classify_followup(fcmd, mrecs, gold, cache, shown_all) == 'a-reread-gap':
                            ever_k = j - i
                            break
                    # request prices of (a)/(c) requests within the CALL window (census def) and REQUEST window
                    def price_turns(items):
                        ts = set()
                        for it in items:
                            if it is None or it >= nturns:
                                continue
                            ts.add(it)
                        return sum(tc[t]['usd'] for t in ts), len(ts)
                    a_turns_call = [f['turn'] for f in fus if f['cls'] == 'a-reread-gap']
                    c_turns_call = [f['turn'] for f in fus if f['cls'] == 'c-gap-symbol-search']
                    a_turns_req = [f['turn'] for (j, f), c in zip(win, win_cls) if c == 'a-reread-gap']
                    c_turns_req = [f['turn'] for (j, f), c in zip(win, win_cls) if c == 'c-gap-symbol-search']
                    all_cases.append({
                        'cell': arm, 'task': task, 'rep': rep, 'resolved': resolved,
                        'transcript': os.path.basename(p['path']),
                        'call_index': i, 'turn': turn_i, 'n_requests': nturns, 'n_calls': len(results),
                        'later_requests': max(0, nturns - turn_i - 1),
                        'cmd': cmd[:300], 'subcmds': len(t1.split_subcmds(cmd)), 'orig_tokens': orig, 'deleted_tokens': deleted,
                        'markers': mrecs, 'pack': pack, 'followups': fus,
                        'window_calls': len(win), 'window_classes': win_cls,
                        'any_a_calls3': any(f['cls'] == 'a-reread-gap' for f in fus),
                        'any_c_calls3': any(f['cls'] == 'c-gap-symbol-search' for f in fus),
                        'any_a_req3': 'a-reread-gap' in win_cls,
                        'any_c_req3': 'c-gap-symbol-search' in win_cls,
                        'ever_reread_k': ever_k,
                        'a_usd_calls3': price_turns(a_turns_call)[0], 'a_req_calls3': price_turns(a_turns_call)[1],
                        'c_usd_calls3': price_turns(set(c_turns_call) - set(a_turns_call))[0],
                        'a_usd_req3': price_turns(a_turns_req)[0], 'a_req_req3': price_turns(a_turns_req)[1],
                        'c_usd_req3': price_turns(set(c_turns_req) - set(a_turns_req))[0],
                        'c_req_req3': price_turns(set(c_turns_req) - set(a_turns_req))[1],
                    })
        cells_out[arm] = {k: v for k, v in S.items() if not k.startswith('req_')}
        cells_out[arm]['by_class'] = dict(S['by_class'])
        cells_out[arm]['tools'] = dict(S['tools'])
        cells_out[arm]['req_usd_mean'] = statistics.mean(S['req_usd']) if S['req_usd'] else None
        cells_out[arm]['req_usd_median'] = statistics.median(S['req_usd']) if S['req_usd'] else None
        cells_out[arm]['req_in_mean'] = statistics.mean(S['req_in']) if S['req_in'] else None
        cells_out[arm]['req_out_mean'] = statistics.mean(S['req_out']) if S['req_out'] else None
        cells_out[arm]['req_newin_mean'] = statistics.mean(S['req_newin']) if S['req_newin'] else None
        cells_out[arm]['cell_cost'] = sum(S['req_usd'])
    report['cells'] = cells_out
    json.dump({'report': report, 'cases': all_cases, 'pointers': all_pointers},
              open(os.path.join(OUT, 'cx-census.json'), 'w'), indent=1)
    print(json.dumps(report, indent=1))
    print('cases', len(all_cases), 'pointers', len(all_pointers))


if __name__ == '__main__':
    main()
