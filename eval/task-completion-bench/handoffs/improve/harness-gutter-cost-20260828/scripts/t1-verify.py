#!/usr/bin/env python3
"""Numeric sweep: re-sum every figure quoted in 12-truncation-census.md from the data."""
import json, re, collections, os
J = json.load(open('12-truncation-census.json'))
T = J['tables']; C = J['cases']; B = J['blind_edit_check']; P = J['per_cell_raw']
CELLS = ['native', 'sweet TAB', 'sweet NONE', 'sweet PIPE']
KEY = {'native': 'codex|native|-', 'sweet TAB': 'codex|sweet|tab',
       'sweet NONE': 'codex|sweet|none', 'sweet PIPE': 'codex|sweet|pipe'}
ok = fail = 0
def chk(label, got, want, tol=0):
    global ok, fail
    good = (abs(got - want) <= tol) if isinstance(want, (int, float)) else (got == want)
    print('%-4s %-58s got=%s want=%s' % ('OK' if good else 'FAIL', label, got, want))
    ok, fail = ok + good, fail + (not good)

chk('truncated outputs', len(C), 563)
chk('follow-up calls classified', sum(len(c['followups']) for c in C), 563 * 3)
chk('rollouts', sum(P[KEY[c]]['rollouts'] for c in CELLS), 264)
chk('cells with >3 transcripts', sum(P[KEY[c]]['cells_over_3'] for c in CELLS), 0)
chk('edit calls total', sum(B[c]['edits'] for c in CELLS), 480)
chk('anchor lines total', sum(B[c]['anchor_lines'] for c in CELLS), 2922)
chk('never-shown anchor lines', sum(B[c]['never_shown'] for c in CELLS), 255)
chk('never-shown absent from base', sum(B[c]['never_shown_absent_from_base'] for c in CELLS), 248)
chk('never-shown in base outside span', sum(B[c]['never_shown_in_base_not_in_span'] for c in CELLS), 7)
chk('never-shown INSIDE a span', sum(B[c]['never_shown_IN_DELETED_SPAN'] for c in CELLS), 0)
for c in CELLS:
    v = T['t1_volume'][c]
    chk('%s delivered == 2500 x calls' % c, v['delivered_tokens'], 2500 * v['trunc_calls'])
g = T['t2b_gutter_test']
chk('gutted re-read k1', '%d/%d' % tuple(g['gutted']), '68/213')
chk('NONE re-read k1', '%d/%d' % tuple(g['none']), '23/98')
chk('gutter fisher p', round(g['fisher_p'], 3), 0.034)
print('  gutted %.1f%%  none %.1f%%' % (100*g['gutted'][0]/g['gutted'][1], 100*g['none'][0]/g['none'][1]))
# ss-read + ss-search share of sweet cuts
for c in ('sweet TAB', 'sweet NONE', 'sweet PIPE'):
    b = T['t1b_class'][c]; tot = T['t1_volume'][c]['trunc_calls']
    print('     %-11s ss-read+ss-search = %d/%d = %.1f%%' %
          (c, b.get('ss-read',0)+b.get('ss-search',0), tot,
           100.0*(b.get('ss-read',0)+b.get('ss-search',0))/tot))
# (d) share at k=1
for c in CELLS:
    d = T['t2_followups'][c]['k1']['d-unrelated']['events']; tot = T['t1_volume'][c]['trunc_calls']
    print('     %-11s k1 proceeded = %d/%d = %.1f%%' % (c, d, tot, 100.0*d/tot))
# span-level range
sl = [100.0*T['t2c_spanlevel'][c]['a_within_3']/max(1,T['t2c_spanlevel'][c]['resolved_span_truncations']) for c in CELLS]
print('     span-level (a) rate range: %.1f%% .. %.1f%%' % (min(sl), max(sl)))
# cost reconstruction gap
for c in CELLS:
    r, p = P[KEY[c]]['cost'], T['t3_followup_cost'][c]['cell_total_usd']
    print('     %-11s cost recon %.4f vs %.4f = %.2f%% low' % (c, r, p, 100.0*(p-r)/p))
# counterfactual: resend share
for c in CELLS:
    t = T['t4_counterfactual'][c]
    print('     %-11s resend share of cf = %.1f%%  ratio %.1fx  cf $%.5f fu $%.5f' %
          (c, 100.0*t['resend_usd']/t['counterfactual_usd'], t['ratio'],
           t['counterfactual_usd'], t['followup_usd']))
# reclassified spans (measured directly): within-block-gap now vs gutter-resolved markers
for c in CELLS:
    sh = P[KEY[c]]['shape']
    print('     %-11s within-block %d  cross-block %d  unnumbered %d  half %d' %
          (c, sh.get('within-block-gap',0), sh.get('cross-block-cut',0),
           sh.get('unnumbered',0), sh.get('half-numbered',0)))
# compound envelopes: >1 read-class sub-command
RC = ('ss-read','ss-search','ss-find','ss-grep','ss-trace','ss-semantic','sed','cat','nl','rg','head')
comp = collections.Counter(); tot = collections.Counter()
for c in C:
    subs = [s.strip() for s in re.split(r'&&|\|\||;|\n', c['cmd']) if s.strip()]
    n = sum(1 for s in subs if os.path.basename(s.split()[0].strip('\'"')) in RC) if subs else 0
    tot[c['cell']] += 1
    if n > 1:
        comp[c['cell']] += 1
for c in CELLS:
    print('     %-11s compound (>1 read sub-cmd) = %d/%d = %.0f%%' %
          (c, comp[KEY[c]], tot[KEY[c]], 100.0*comp[KEY[c]]/max(1,tot[KEY[c]])))
# ss-read requested range sizes and lines-per-2500-tokens
sizes = []
for c in C:
    for m in c['markers']:
        if str(m.get('class','')).startswith('ss-read') and m.get('lo') is not None and m.get('hi') is not None:
            for r in c['requested']:
                if r[1] and r[2] and os.path.basename(str(r[0]))==os.path.basename(str(m['file'])):
                    sizes.append(r[2]-r[1]+1)
sizes.sort()
if sizes:
    print('     ss-read requested range (cut cases): min %d p25 %d med %d p75 %d max %d' %
          (sizes[0], sizes[len(sizes)//4], sizes[len(sizes)//2], sizes[3*len(sizes)//4], sizes[-1]))
tpl = []
for c in C:
    for m in c['markers']:
        if m.get('lo') is not None and m.get('hi') is not None:
            tpl.append(m['deleted_tokens']/max(1,(m['hi']-m['lo']+1)))
tpl.sort()
if tpl:
    med = tpl[len(tpl)//2]
    print('     tokens/line median %.1f  -> 2500-token cap fits ~%d lines' % (med, int(2500/med)))
print('\n%d ok, %d FAIL' % (ok, fail))
