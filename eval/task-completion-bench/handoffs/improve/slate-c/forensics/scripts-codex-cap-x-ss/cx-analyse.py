#!/usr/bin/env python3
"""codex-cap-x-ss — tables over cx-census.json (output of cx-census.py, run on the box).
Usage: python3 cx-analyse.py <path-to-cx-census.json>
"""
import json, sys, collections, statistics
J = json.load(open(sys.argv[1]))
rep, cases, ptrs = J['report'], J['cases'], J['pointers']
PRICE = rep['meta']['price']
PUBLISHED_CELL = {'sweet': 0.8138, 'native': 0.8110}   # FRESH-POOL-RESULTS.md cell totals


def pct(a, b):
    return f'{a}/{b} = {100.0 * a / b:.1f}%' if b else f'{a}/0'


def med(xs):
    return statistics.median(xs) if xs else None


print('=' * 78)
print('A. CELL SUMMARY (fp-codex-tab-20260826)')
for arm in ('native', 'sweet'):
    c = rep['cells'][arm]
    print(f"[{arm}] rollouts={c['rollouts']} requests={c['requests']} ({c['requests']/c['rollouts']:.2f}/rollout) "
          f"tool-results={c['calls']} ({c['calls']/c['rollouts']:.2f}/rollout) multi-call-requests={c['multi_call_requests']} "
          f"async-cell-outputs={c['async_cell_outputs']}")
    print(f"       tools={c['tools']}")
    print(f"       ss-grep calls={c['ss_grep_calls']} envelopes={c['ss_grep_envelopes']} truncations-attributed-to-ss-grep={c['trunc_ss_grep_class']}")
    print(f"       truncated outputs={c['trunc_calls']} by_class={c['by_class']}")
    print(f"       request price: mean=${c['req_usd_mean']:.6f} median=${c['req_usd_median']:.6f}; mean resident in={c['req_in_mean']:.0f} "
          f"mean new-in={c['req_newin_mean']:.0f} mean out={c['req_out_mean']:.0f}; cell cost (ideal reconstruction)=${c['cell_cost']:.5f} "
          f"vs published ${PUBLISHED_CELL[arm]:.4f} ({100*(c['cell_cost']/PUBLISHED_CELL[arm]-1):+.2f}%)")

for arm in ('sweet', 'native'):
    C = [x for x in cases if x['cell'] == arm]
    N = rep['cells'][arm]['rollouts']
    print('\n' + '=' * 78)
    print(f'B. TRUNCATION VOLUME [{arm}]: {len(C)} truncated outputs in {len(set((x["task"],x["rep"]) for x in C))}/{N} rollouts; '
          f'{len(C)/N:.2f}/rollout; deleted tokens={sum(x["deleted_tokens"] for x in C):,} '
          f'(mean {sum(x["deleted_tokens"] for x in C)/len(C):.0f}/output, median {med([x["deleted_tokens"] for x in C]):.0f})')
    later = [x['later_requests'] for x in C]
    print(f'   later requests after a truncation: mean {statistics.mean(later):.1f} median {med(later)}')
    markers = [m for x in C for m in x['markers']]
    print(f'   markers={len(markers)} shapes={dict(collections.Counter(m["shape"] for m in markers))}')
    if arm == 'sweet':
        print('\nC. SECTION-LOSS ANATOMY [sweet]')
        rd = [m for m in markers if m['class'] == 'ss-read']
        print(f' C1 ss-read markers: {len(rd)}; shapes={dict(collections.Counter(m["shape"] for m in rd))}; how={dict(collections.Counter(m["how"] for m in rd))}')
        tr = [m['ssread_trailer'] for m in rd if m.get('ssread_trailer')]
        exp = [t for t in tr if t['expected']]
        print(f'    ss-read block before the cut declared a range short of EOF (trailer expected): {len(exp)}/{len(tr)} with a header; '
              f'trailer SURVIVED: {pct(sum(1 for t in exp if t["survived"]), len(exp))}')
        by_shape = collections.defaultdict(lambda: [0, 0])
        for m in rd:
            t = m.get('ssread_trailer')
            if t and t['expected']:
                by_shape[m['shape']][1] += 1
                by_shape[m['shape']][0] += int(bool(t['survived']))
        print(f'    trailer survival by cut shape: ' + ', '.join(f'{k}: {v[0]}/{v[1]}' for k, v in by_shape.items()))
        gg = [m for m in rd if m.get('gap_lines')]
        print(f'    resolved within-block gaps (gutter): {len(gg)}; gap lines total={sum(m["gap_lines"] for m in gg)} median={med([m["gap_lines"] for m in gg])}; '
              f'gaps holding >=1 definition line: {pct(sum(1 for m in gg if m["gap_def_lines"]), len(gg))}; definition lines lost total={sum(m["gap_def_lines"] or 0 for m in gg)}')
        pk = [x for x in C if x.get('pack')]
        print(f' C2 packs cut (ss-search/ss-find/ss-trace): {len(pk)}; by class={dict(collections.Counter(x["markers"][0]["class"] for x in pk))}')
        lost = collections.Counter(tuple(x['pack']['lost_ranks']) if x['pack']['lost_ranks'] is not None else ('?',) for x in pk)
        print(f'    lost-rank sets: {dict(lost)}')
        r2 = sum(1 for x in pk if x['pack']['lost_ranks'] and 2 in x['pack']['lost_ranks'])
        r1 = sum(1 for x in pk if x['pack']['lost_ranks'] and 1 in x['pack']['lost_ranks'])
        nlost = [len(x['pack']['lost_ranks']) for x in pk if x['pack']['lost_ranks'] is not None]
        print(f'    rank 2 lost in {pct(r2, len(pk))}; rank 1 lost in {pct(r1, len(pk))}; ranks lost per pack: mean {statistics.mean(nlost):.2f} median {med(nlost)}; '
              f'results_n median={med([x["pack"]["results_n"] for x in pk if x["pack"]["results_n"]])}')
        print(f'    head ranks (fully before cut) median={med([len(x["pack"]["ranks_head"]) for x in pk])}; tail ranks after cut median={med([x["pack"]["tail_symbols_n"] for x in pk])}')
        print(f'    sufficient= line survived: {pct(sum(1 for x in pk if x["pack"]["sufficient_survived"]), len(pk))}; values={dict(collections.Counter(x["pack"]["sufficient_value"] for x in pk))}')
        print(f'    route= trailer survived: {pct(sum(1 for x in pk if x["pack"]["route_survived"]), len(pk))}; shown-full: {pct(sum(1 for x in pk if x["pack"]["shown_full_survived"]), len(pk))}; '
              f'# unread below in tail: {pct(sum(1 for x in pk if x["pack"]["unread_below_survived"]), len(pk))}')
        print(f'    graph-edge lines surviving in tails: {sum(x["pack"]["graph_edges_in_tail"] for x in pk)}')
        hs = collections.Counter(s.split(':')[0] for x in pk for s in x['pack']['head_symbols'] if s)
        print(f'    surviving head-rank kinds: {dict(hs)}')

    print(f'\nD. FOLLOW-UPS [{arm}]')
    fu = collections.Counter()
    for x in C:
        for f in x['followups']:
            fu[(f['k'], f['cls'])] += 1
    for k in (1, 2, 3):
        print(f'   k={k}: ' + ', '.join(f'{cls}={fu[(k, cls)]}' for cls in ('a-reread-gap', 'b-samefile-nonoverlap', 'c-gap-symbol-search', 'd-unrelated', 'e-ended')))
    a3 = sum(1 for x in C if x['any_a_calls3']); c3 = sum(1 for x in C if x['any_c_calls3'])
    a3r = sum(1 for x in C if x['any_a_req3']); c3r = sum(1 for x in C if x['any_c_req3'])
    print(f'   truncations with a class-(a) re-read within 3 CALLS: {pct(a3, len(C))}; within 3 REQUESTS: {pct(a3r, len(C))}')
    print(f'   truncations with a class-(c) gap-symbol search within 3 CALLS: {pct(c3, len(C))}; within 3 REQUESTS: {pct(c3r, len(C))}')
    print(f'   window calls per truncation (3 requests): {dict(collections.Counter(x["window_calls"] for x in C))}')
    ever = [x['ever_reread_k'] for x in C if x['ever_reread_k'] is not None]
    print(f'   class-(a) re-read EVER later in the rollout: {pct(len(ever), len(C))}; call distance distribution: {dict(sorted(collections.Counter(ever).items()))}')
    casc = collections.Counter((f['cls'], f['truncated_again']) for x in C for f in x['followups'] if f['cls'] in ('a-reread-gap', 'b-samefile-nonoverlap'))
    print(f'   CASCADE (re-read itself truncated again): ' + ', '.join(f'{k[0]} truncated_again={k[1]}: {v}' for k, v in sorted(casc.items())))
    A_usd = sum(x['a_usd_calls3'] for x in C); A_req = sum(x['a_req_calls3'] for x in C)
    Cc_usd = sum(x['c_usd_calls3'] for x in C)
    Ar_usd = sum(x['a_usd_req3'] for x in C); Ar_req = sum(x['a_req_req3'] for x in C)
    Cr_usd = sum(x['c_usd_req3'] for x in C); Cr_req = sum(x['c_req_req3'] for x in C)
    print(f'   PRICE call-window: (a) {A_req} requests ${A_usd:.5f}; (c) ${Cc_usd:.5f}; total ${A_usd+Cc_usd:.5f} = {100*(A_usd+Cc_usd)/PUBLISHED_CELL[arm]:.2f}% of cell, ${(A_usd+Cc_usd)/N:.6f}/rollout, {(A_req + sum(1 for x in C for f in x["followups"] if f["cls"]=="c-gap-symbol-search"))/N:.3f} requests/rollout')
    print(f'   PRICE request-window: (a) {Ar_req} requests ${Ar_usd:.5f}; (c) {Cr_req} requests ${Cr_usd:.5f}; total ${Ar_usd+Cr_usd:.5f} = {100*(Ar_usd+Cr_usd)/PUBLISHED_CELL[arm]:.2f}% of cell, ${(Ar_usd+Cr_usd)/N:.6f}/rollout, {(Ar_req+Cr_req)/N:.3f} requests/rollout')
    # over-fetch
    of = [(x, f) for x in C for f in x['followups'] if f['cls'] == 'a-reread-gap']
    print(f'\n   OVER-FETCH in class-(a) re-reads (n={len(of)} follow-up events):')
    ln = [(f['reread_req_lines'], f['gap_lines']) for x, f in of if f.get('reread_req_lines') and f.get('gap_lines')]
    if ln:
        print(f'     lines: re-read requested Σ={sum(a for a,b in ln)} vs gap Σ={sum(b for a,b in ln)} → ratio {sum(a for a,b in ln)/sum(b for a,b in ln):.2f}× (n={len(ln)} with both known); per-event median ratio {med([a/b for a,b in ln]):.2f}')
    tk = [(f['reread_tokens'], f['gap_tokens'], x['n_requests'] - (f['turn'] or 0) - 1, f['reread_tokens_how']) for x, f in of if f.get('reread_tokens') is not None and f.get('gap_tokens')]
    if tk:
        over = [max(0, a - b) for a, b, l, h in tk]
        save = sum(max(0, a - b) * (PRICE['in'] + PRICE['cache'] * l) / 1e6 for a, b, l, h in tk)
        print(f'     tokens: re-read delivered Σ={sum(a for a,b,l,h in tk):,} vs gap Σ={sum(b for a,b,l,h in tk):,}; over-fetch Σ={sum(over):,} tokens; how={dict(collections.Counter(h for a,b,l,h in tk))}')
        print(f'     $ if each re-read had fetched exactly the gap (ingest 0.10 + re-send 0.01×later requests): ${save:.5f} = {100*save/PUBLISHED_CELL[arm]:.3f}% of cell = ${save/N:.7f}/rollout')
    for x, f in sorted(of, key=lambda t: -(t[1].get('reread_tokens') or 0))[:6]:
        print(f'     e.g. {x["task"]} rep{x["rep"]} resolved={x["resolved"]} call#{x["call_index"]}→k={f["k"]}: gap {f.get("gap_lines")} lines/{f.get("gap_tokens")} tok; re-read {f.get("reread_req_lines")} lines/{f.get("reread_tokens")} tok; cmd={f["cmd"][:90]!r}  [{x["transcript"][:40]}]')
    # outcome (confounded)
    ra = [x for x in C if x['any_a_calls3']]; rd_ = [x for x in C if not x['any_a_calls3']]
    print(f'\n   OUTCOME (confounded by difficulty; do not read as causal): truncations followed by (a) → resolved {pct(sum(1 for x in ra if x["resolved"]), len(ra))}; '
          f'not followed → resolved {pct(sum(1 for x in rd_ if x["resolved"]), len(rd_))}')

print('\n' + '=' * 78)
print('E. POINTER FOLLOW-RATE [sweet] — every `# unread below (A-B) … — continue: ss-read F A B` line')
P = [p for p in ptrs if p['cell'] == 'sweet']
N = rep['cells']['sweet']['rollouts']
print(f'   pointer lines={len(P)} in {len(set((p["task"],p["rep"],p["call_index"]) for p in P))} outputs, {len(set((p["task"],p["rep"]) for p in P))}/{N} rollouts; {len(P)/N:.2f} pointers/rollout')
def rate(ps, label):
    k3 = sum(1 for p in ps if p['followed_k'] is not None and p['followed_k'] <= 3)
    r3 = sum(1 for p in ps if p['followed_req_dist'] is not None and p['followed_req_dist'] <= 3)
    ev = sum(1 for p in ps if p['followed_k'] is not None)
    print(f'   {label}: n={len(ps)}; followed within 3 calls {pct(k3, len(ps))}; within 3 requests {pct(r3, len(ps))}; ever {pct(ev, len(ps))}; '
          f'how={dict(collections.Counter(p["how"] for p in ps if p["how"]))}')
rate(P, 'ALL')
rate([p for p in P if p['later_calls'] >= 3], 'with >=3 later calls (uncensored)')
rate([p for p in P if p['output_truncated']], 'pointer inside a TRUNCATED output')
rate([p for p in P if not p['output_truncated']], 'pointer inside an untruncated output')
rate([p for p in P if p['has_names']], 'pointer names symbols')
rate([p for p in P if not p['has_names']], 'pointer without symbol names')
for lo, hi in ((1, 50), (51, 200), (201, 1000), (1001, 10 ** 9)):
    rate([p for p in P if lo <= p['span_lines'] <= hi], f'unread span {lo}-{hi} lines')
rate([p for p in P if p['resolved']], 'in resolved rollouts')
rate([p for p in P if p['resolved'] is False], 'in unresolved rollouts')
kd = collections.Counter(p['followed_k'] for p in P if p['followed_k'] is not None)
print(f'   call-distance of the first follow: {dict(sorted(kd.items()))}')
# per-rollout: any pointer followed
byr = collections.defaultdict(list)
for p in P:
    byr[(p['task'], p['rep'])].append(p)
print(f'   rollouts with >=1 pointer: {len(byr)}; with >=1 pointer followed ever: {sum(1 for v in byr.values() if any(p["followed_k"] is not None for p in v))}')

print('\n' + '=' * 78)
print('F. CEILING ARITHMETIC for a codex-only <=2,400-token budget with an addressable continue span [sweet]')
C = [x for x in cases if x['cell'] == 'sweet']
c = rep['cells']['sweet']
n_tr = len(C)
a_cases = [x for x in C if x['any_a_calls3']]
proceeded = [x for x in C if not x['any_a_calls3']]
r_all = sum(1 for p in P if p['followed_k'] is not None and p['followed_k'] <= 3) / len(P)
r_unc = sum(1 for p in P if p['later_calls'] >= 3 and p['followed_k'] is not None and p['followed_k'] <= 3) / max(1, sum(1 for p in P if p['later_calls'] >= 3))
mean_deleted = statistics.mean(x['deleted_tokens'] for x in C)
mean_later = statistics.mean(x['later_requests'] for x in C)
marginal = (c['req_in_mean'] * PRICE['cache'] + mean_deleted * PRICE['in'] + c['req_out_mean'] * PRICE['out'] + mean_deleted * PRICE['cache'] * mean_later) / 1e6
print(f'   truncated ss-* outputs: {n_tr}; with a class-(a) re-read within 3 calls: {len(a_cases)}; proceeded without one: {len(proceeded)}')
print(f'   marginal price of ONE added continuation request = resident {c["req_in_mean"]:.0f}×0.01 + gap {mean_deleted:.0f}×0.10 + out {c["req_out_mean"]:.0f}×0.60 + gap re-sent on {mean_later:.1f} later requests ×0.01 = ${marginal:.6f}')
of = [(x, f) for x in C for f in x['followups'] if f['cls'] == 'a-reread-gap']
tk = [(f['reread_tokens'], f['gap_tokens'], x['n_requests'] - (f['turn'] or 0) - 1) for x, f in of if f.get('reread_tokens') is not None and f.get('gap_tokens')]
save_over = sum(max(0, a - b) * (PRICE['in'] + PRICE['cache'] * l) / 1e6 for a, b, l in tk)
c_usd = sum(x['c_usd_calls3'] for x in C); c_req = sum(1 for x in C for f in x['followups'] if f['cls'] == 'c-gap-symbol-search')
a_usd = sum(x['a_usd_calls3'] for x in C); a_req = sum(x['a_req_calls3'] for x in C)
print(f'   TODAY attributable to truncation (call window): (a) {a_req} req ${a_usd:.5f} + (c) {c_req} req ${c_usd:.5f} = ${a_usd+c_usd:.5f} ({100*(a_usd+c_usd)/PUBLISHED_CELL["sweet"]:.2f}% of cell), {(a_req+c_req)/N:.3f} req/rollout, ${(a_usd+c_usd)/N:.6f}/rollout')
print(f'   component 1 — over-fetch removed (re-read fetches exactly the gap): −${save_over:.5f} ({100*save_over/PUBLISHED_CELL["sweet"]:.3f}%), 0 requests')
print(f'   component 2 — class-(c) gap searches avoided: −{c_req} requests, −${c_usd:.5f} ({100*c_usd/PUBLISHED_CELL["sweet"]:.3f}%)')
for label, r in (('r=0 (nobody follows the pointer)', 0.0), (f'r=measured pointer follow-rate within 3 calls ({r_all:.3f})', r_all), (f'r=uncensored follow-rate ({r_unc:.3f})', r_unc), ('r=1 (every gap fetched)', 1.0)):
    add_req = len(proceeded) * r
    add_usd = add_req * marginal
    net = save_over + c_usd - add_usd
    print(f'   component 3 @ {label}: +{add_req:.1f} requests, +${add_usd:.5f}; NET = {"−" if net>=0 else "+"}${abs(net):.5f} ({-100*net/PUBLISHED_CELL["sweet"]:+.3f}% of cell), {(-c_req+add_req)/N:+.3f} requests/rollout, ${-net/N:+.7f}/rollout')
print(f'   upper bound if ALL (a)+(c) follow-up requests vanished (census framing; not achievable, the continue IS a request): −${a_usd+c_usd:.5f} = −{100*(a_usd+c_usd)/PUBLISHED_CELL["sweet"]:.2f}%, −{(a_req+c_req)/N:.3f} req/rollout')
print(f'   requests per rollout, sweet cell: {c["requests"]/N:.2f}; native: {rep["cells"]["native"]["requests"]/rep["cells"]["native"]["rollouts"]:.2f}')

print('\n' + '=' * 78)
print('G. REFINEMENTS')
for arm in ('sweet', 'native'):
    C = [x for x in cases if x['cell'] == arm]
    N = rep['cells'][arm]['rollouts']
    # G1 unique requests (a request within 3 of TWO truncations was counted twice in the census)
    ua = set(); uc = set()
    for x in C:
        for f in x['followups']:
            if f['cls'] == 'a-reread-gap' and f['turn'] is not None:
                ua.add((x['task'], x['rep'], f['turn']))
            elif f['cls'] == 'c-gap-symbol-search' and f['turn'] is not None:
                uc.add((x['task'], x['rep'], f['turn']))
    uc -= ua
    # price unique requests with the case's stored per-request price: rebuild from a_usd per case is not unique; approximate by mean request price of the cell
    c = rep['cells'][arm]
    print(f' G1 [{arm}] UNIQUE follow-up requests: (a) {len(ua)} (census counted {sum(x["a_req_calls3"] for x in C)}), (c) {len(uc)}; '
          f'total {len(ua)+len(uc)} = {(len(ua)+len(uc))/N:.3f} requests/rollout = {100*(len(ua)+len(uc))/c["requests"]:.2f}% of the cell\'s requests; '
          f'at the cell mean request price ${c["req_usd_mean"]:.6f} → ${(len(ua)+len(uc))*c["req_usd_mean"]:.5f} ({100*(len(ua)+len(uc))*c["req_usd_mean"]/PUBLISHED_CELL[arm]:.2f}% of cell)')
    # G2 block-level over-fetch
    of = [(x, f) for x in C for f in x['followups'] if f['cls'] == 'a-reread-gap']
    bl = [(f['reread_block_tokens'], f['gap_tokens'], x['n_requests'] - (f['turn'] or 0) - 1, f['subcmds']) for x, f in of if f.get('reread_block_tokens') and f.get('gap_tokens')]
    if bl:
        save = sum(max(0, a - b) * (PRICE['in'] + PRICE['cache'] * l) / 1e6 for a, b, l, s in bl)
        print(f' G2 [{arm}] BLOCK-level over-fetch (only the ss-read block of the same file, bytes/3.99): n={len(bl)}/{len(of)}; delivered Σ={sum(a for a,b,l,s in bl):,} vs gap Σ={sum(b for a,b,l,s in bl):,}; '
              f'over-fetch Σ={sum(max(0,a-b) for a,b,l,s in bl):,} tokens; $ saved if exact = ${save:.5f} ({100*save/PUBLISHED_CELL[arm]:.3f}% of cell, ${save/N:.7f}/rollout); '
              f'follow-up envelopes with >1 sub-command: {sum(1 for a,b,l,s in bl if s>1)}/{len(bl)}')
    else:
        print(f' G2 [{arm}] block-level over-fetch: no ss-read blocks (native uses sed/cat; envelope-level only)')
    # G3 cascade for (a) specifically, with ids
    casc = [(x, f) for x, f in of if f.get('truncated_again')]
    print(f' G3 [{arm}] class-(a) re-reads truncated AGAIN: {len(casc)}/{len(of)}; ' + '; '.join(f'{x["task"]} rep{x["rep"]} call#{x["call_index"]}→k{f["k"]}' for x, f in casc[:12]))
    if arm == 'sweet':
        # G4 ss-search-only pack anatomy
        pk = [x for x in C if x.get('pack') and x['markers'][0]['class'] == 'ss-search']
        print(f' G4 ss-search packs cut: {len(pk)}; compound envelopes (>1 sub-command): {sum(1 for x in pk if x["pack"]["subcmds"]>1)}/{len(pk)}')
        print(f'    sufficient= in tail: {pct(sum(1 for x in pk if x["pack"]["sufficient_survived"]), len(pk))}; sufficient= ANYWHERE in the delivered output: {pct(sum(1 for x in pk if x["pack"]["sufficient_anywhere"]), len(pk))}; '
              f'lost & compound: {sum(1 for x in pk if not x["pack"]["sufficient_anywhere"] and x["pack"]["subcmds"]>1)}; lost & single-command: {sum(1 for x in pk if not x["pack"]["sufficient_anywhere"] and x["pack"]["subcmds"]==1)}')
        print(f'    route= tail survived: {pct(sum(1 for x in pk if x["pack"]["route_survived"]), len(pk))}; shown-full: {pct(sum(1 for x in pk if x["pack"]["shown_full_survived"]), len(pk))}')
        cir = collections.Counter((x['pack']['cut_in_rank'], x['pack']['cut_in_rank_presentation']) for x in pk)
        print(f'    cut begins inside rank (rank, presentation): {dict(cir)}')
        lost = collections.Counter(tuple(x['pack']['lost_ranks']) if x['pack']['lost_ranks'] is not None else ('?',) for x in pk)
        print(f'    lost-rank HEADER sets (ss-search only): {dict(lost)}; results_n values: {sorted(collections.Counter(x["pack"]["results_n"] for x in pk).items(), key=lambda t: (t[0] is None, t[0]))}')
        others = [x for x in C if x.get('pack') and x['markers'][0]['class'] != 'ss-search']
        print(f'    non-ss-search pack-shaped cases: {dict(collections.Counter(x["markers"][0]["class"] for x in others))} (ss-find/ss-trace render no rank headers or sufficiency line)')
        # G5 pointer-follow cascade
        P = [p for p in ptrs if p['cell'] == 'sweet' and p['followed_k'] is not None]
        print(f' G5 pointer follows that were themselves truncated: {pct(sum(1 for p in P if p["followed_truncated"]), len(P))}; follow-read lines: median {med([p["followed_lines"] for p in P if p["followed_lines"]])} vs pointed span median {med([p["span_lines"] for p in P])}')
        ex = [p for p in P if p['how'] == 'exact']
        print(f'    EXACT continue commands issued: {len(ex)}: ' + '; '.join(f'{p["task"]} rep{p["rep"]} call#{p["call_index"]} → k{p["followed_k"]} {p["followed_cmd"][:70]!r}' for p in ex))
        # G6 component 0 + break-even
        c = rep['cells']['sweet']
        n_tr = len(C)
        proceeded = [x for x in C if not x['any_a_calls3']]
        mean_deleted = statistics.mean(x['deleted_tokens'] for x in C)
        mean_later = statistics.mean(x['later_requests'] for x in C)
        marginal = (c['req_in_mean'] * PRICE['cache'] + mean_deleted * PRICE['in'] + c['req_out_mean'] * PRICE['out'] + mean_deleted * PRICE['cache'] * mean_later) / 1e6
        comp0 = n_tr * 100 * (PRICE['in'] + PRICE['cache'] * mean_later) / 1e6
        save_over_blk = sum(max(0, a - b) * (PRICE['in'] + PRICE['cache'] * l) / 1e6 for a, b, l, s in bl) if bl else 0
        c_usd = sum(x['c_usd_calls3'] for x in C)
        base_save = comp0 + save_over_blk + c_usd
        be = base_save / (len(proceeded) * marginal)
        print(f' G6 component 0 — 100 fewer delivered tokens per formerly-truncated output (2,430 vs 2,530 incl. warning lines): −${comp0:.5f} ({100*comp0/PUBLISHED_CELL["sweet"]:.3f}%)')
        print(f'    best-case saving (block-level over-fetch + (c) + component 0) = ${base_save:.5f} ({100*base_save/PUBLISHED_CELL["sweet"]:.3f}% of cell, ${base_save/66:.7f}/rollout, −3 requests)')
        print(f'    BREAK-EVEN pointer follow-rate r* = {be:.3f} ({100*be:.1f}% of the {len(proceeded)} newly addressable gaps); measured r = 0.236 (all) / 0.253 (uncensored) / 0.275 (pointers inside truncated outputs)')
        for r in (0.236, 0.275, 0.5):
            add = len(proceeded) * r
            net = base_save - add * marginal
            print(f'    r={r}: +{add:.1f} requests (+{add/66:.3f}/rollout), NET {"−" if net>=0 else "+"}${abs(net):.5f} ({-100*net/PUBLISHED_CELL["sweet"]:+.3f}% of cell), {(-3+add)/66:+.3f} requests/rollout')

print('\n' + '=' * 78)
print('H. EXHIBIT CANDIDATES')
C = [x for x in cases if x['cell'] == 'sweet']
cands = [x for x in C if any((m.get('ssread_trailer') or {}).get('expected') and not (m.get('ssread_trailer') or {}).get('survived') and m['shape'] == 'cross-block-cut' for m in x['markers'])]
print(' ss-read trailer died in a cross-block cut:', [(x['task'], x['rep'], x['transcript'][:30], x['call_index']) for x in cands[:4]])
cands = [x for x in C if x.get('pack') and x['markers'][0]['class'] == 'ss-search' and not x['pack']['sufficient_anywhere']]
print(' ss-search sufficient= lost:', [(x['task'], x['rep'], x['transcript'][:30], x['call_index'], x['pack']['subcmds']) for x in cands[:4]])
cands = [x for x in C if x.get('pack') and x['markers'][0]['class'] == 'ss-search' and x['pack']['lost_ranks'] and len(x['pack']['lost_ranks']) >= 2]
print(' ss-search >=2 rank headers lost:', [(x['task'], x['rep'], x['transcript'][:30], x['call_index'], x['pack']['lost_ranks']) for x in cands[:4]])
cands = [x for x in C if any(f['cls'] == 'a-reread-gap' and f.get('truncated_again') for f in x['followups'])]
print(' (a) re-read truncated again:', [(x['task'], x['rep'], x['transcript'][:30], x['call_index']) for x in cands[:4]])
P = [p for p in ptrs if p['cell'] == 'sweet' and p['how'] == 'exact']
print(' exact continue follows:', [(p['task'], p['rep'], p['transcript'][:30], p['call_index'], p['followed_k']) for p in P])

print('\n' + '=' * 78)
print('I. ADDRESSABLE POPULATION — a per-command budget cannot see the rest of a `&&` envelope')
C = [x for x in cases if x['cell'] == 'sweet']
single = [x for x in C if x.get('subcmds') == 1]
multi = [x for x in C if x.get('subcmds', 2) > 1]
print(f'   sweet truncations in SINGLE-command envelopes: {len(single)}/{len(C)} = {100*len(single)/len(C):.0f}%; in compound envelopes: {len(multi)} ({100*len(multi)/len(C):.0f}%)')
print(f'   single-command by class: {dict(collections.Counter(x["markers"][0]["class"] for x in single))}; compound by class: {dict(collections.Counter(x["markers"][0]["class"] for x in multi))}')
print(f'   single-command: deleted tokens Σ={sum(x["deleted_tokens"] for x in single):,} (median {med([x["deleted_tokens"] for x in single])}); compound: Σ={sum(x["deleted_tokens"] for x in multi):,}')
sa = [x for x in single if x['any_a_calls3']]; sc = [x for x in single if x['any_c_calls3']]
print(f'   single-command truncations followed by (a) within 3: {len(sa)}; by (c): {len(sc)}; proceeded: {len(single)-len(sa)}')
of = [(x, f) for x in single for f in x['followups'] if f['cls'] == 'a-reread-gap']
bl = [(f['reread_block_tokens'], f['gap_tokens'], x['n_requests'] - (f['turn'] or 0) - 1) for x, f in of if f.get('reread_block_tokens') and f.get('gap_tokens')]
save_over = sum(max(0, a - b) * (PRICE['in'] + PRICE['cache'] * l) / 1e6 for a, b, l in bl)
c_usd = sum(x['c_usd_calls3'] for x in single); c_req = sum(1 for x in single for f in x['followups'] if f['cls'] == 'c-gap-symbol-search')
mean_later = statistics.mean(x['later_requests'] for x in single) if single else 0
comp0 = len(single) * 100 * (PRICE['in'] + PRICE['cache'] * mean_later) / 1e6
best = save_over + c_usd + comp0
cc = rep['cells']['sweet']
mean_deleted = statistics.mean(x['deleted_tokens'] for x in single) if single else 0
marginal = (cc['req_in_mean'] * PRICE['cache'] + mean_deleted * PRICE['in'] + cc['req_out_mean'] * PRICE['out'] + mean_deleted * PRICE['cache'] * mean_later) / 1e6
proceeded = len(single) - len(sa)
print(f'   ADDRESSABLE best case (r=0): component0 ${comp0:.5f} + over-fetch ${save_over:.5f} + (c) ${c_usd:.5f} ({c_req} requests) = ${best:.5f} = {100*best/PUBLISHED_CELL["sweet"]:.3f}% of cell = ${best/66:.7f}/rollout; requests −{c_req/66:.3f}/rollout')
print(f'   marginal continuation request on these: ${marginal:.6f}; break-even r* = {best/(proceeded*marginal) if proceeded else float("nan"):.3f}')
for r in (0.236, 0.275):
    add = proceeded * r
    net = best - add * marginal
    print(f'   r={r}: +{add:.1f} requests, NET {"−" if net>=0 else "+"}${abs(net):.5f} ({-100*net/PUBLISHED_CELL["sweet"]:+.3f}% of cell), {(-c_req+add)/66:+.3f} requests/rollout, ${-net/66:+.7f}/rollout')
# ss-read single-command truncations: requested range sizes
rs = []
for x in single:
    for t in t1_read_targets(x['cmd']) if False else []:
        pass
print(f'   single-command ss-read truncations, requested lines: ' + ', '.join(str(x['cmd'][:60]) for x in single if x['markers'][0]['class']=='ss-read')[:600])
