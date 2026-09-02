#!/usr/bin/env python3
"""T1 analysis: per-cell tables for the truncation census, an unbiased follow-up
comparison, the ss-read and ss-search detail, the counterfactual and the outcome
correlation. Reads /tmp/fp-inv/trunc/census.json; writes report.json."""
import json, os, collections, math, sys

D = json.load(open('/tmp/fp-inv/trunc/census.json'))
CASES = D['cases']
PER = D['per_cell']
ORDER = ['codex|native|-', 'codex|sweet|tab', 'codex|sweet|none', 'codex|sweet|pipe']
NAME = {'codex|native|-': 'native', 'codex|sweet|tab': 'sweet TAB',
        'codex|sweet|none': 'sweet NONE', 'codex|sweet|pipe': 'sweet PIPE'}
PUB = {'codex|native|-': 0.8110, 'codex|sweet|tab': 0.8138,
       'codex|sweet|none': 0.8131, 'codex|sweet|pipe': 0.8418}
bycell = collections.defaultdict(list)
for c in CASES:
    bycell[c['cell']].append(c)

out = {}


def fisher(a, b, c, d):
    """two-sided Fisher exact on [[a,b],[c,d]]."""
    def lf(n):
        return math.lgamma(n + 1)
    n = a + b + c + d
    def p(a_):
        b_, c_, d_ = a + b - a_, a + c - a_, d - (a_ - a)
        if min(b_, c_, d_) < 0:
            return 0.0
        return math.exp(lf(a + b) + lf(c + d) + lf(a + c) + lf(b + d)
                        - lf(n) - lf(a_) - lf(b_) - lf(c_) - lf(d_))
    p0 = p(a)
    tot = 0.0
    for a_ in range(0, min(a + b, a + c) + 1):
        q = p(a_)
        if q <= p0 * (1 + 1e-9):
            tot += q
    return min(1.0, tot)


print('=' * 96)
print('TABLE 1 — truncation volume, what was cut, and the shape of the cut')
print('=' * 96)
print('%-11s %6s %8s %8s %9s %9s %9s %7s' %
      ('cell', 'trunc', 'roll>=1', 'orig tok', 'deleted', 'delivered', 'del/call', 'med del'))
t1 = {}
for k in ORDER:
    S = PER[k]
    dels = sorted(m['deleted_tokens'] for c in bycell[k] for m in c['markers'])
    med = dels[len(dels) // 2] if dels else 0
    print('%-11s %6d %8s %8d %9d %9d %9.0f %7d' %
          (NAME[k], S['trunc_calls'], '%d/66' % S['rollouts_with_trunc'], S['orig_tokens'],
           S['deleted_tokens'], S['delivered_tokens'],
           S['deleted_tokens'] / max(1, S['trunc_calls']), med))
    t1[NAME[k]] = {'trunc_calls': S['trunc_calls'], 'rollouts_with_trunc': S['rollouts_with_trunc'],
                   'orig_tokens': S['orig_tokens'], 'deleted_tokens': S['deleted_tokens'],
                   'delivered_tokens': S['delivered_tokens'], 'median_deleted': med,
                   'per_rollout': S['trunc_calls'] / 66.0}
out['t1_volume'] = t1

print()
print('TABLE 1b — command class of the truncated region (per marker)')
classes = sorted({c.split('?')[0] for k in ORDER for c in PER[k]['by_class']})
print('%-11s ' % 'cell' + ' '.join('%11s' % c for c in classes))
t1b = {}
for k in ORDER:
    agg = collections.Counter()
    for c, v in PER[k]['by_class'].items():
        agg[c.split('?')[0]] += v
    print('%-11s ' % NAME[k] + ' '.join('%11d' % agg.get(c, 0) for c in classes))
    t1b[NAME[k]] = dict(agg)
out['t1b_class'] = t1b

print()
print('TABLE 1c — cut shape: can the model SEE what was deleted?')
shapes = ['within-block-gap', 'cross-block-cut', 'sub-line-cut', 'half-numbered', 'unnumbered']
print('%-11s %7s ' % ('cell', 'markers') + ' '.join('%17s' % s for s in shapes) + '  file known')
t1c = {}
for k in ORDER:
    S = PER[k]
    print('%-11s %7d ' % (NAME[k], S['markers']) +
          ' '.join('%17d' % S['shape'].get(s, 0) for s in shapes) +
          '  %d/%d' % (S['file_known'].get('True', 0), S['markers']))
    t1c[NAME[k]] = {'markers': S['markers'], 'shape': S['shape'],
                    'file_known': S['file_known'].get('True', 0),
                    'span_resolved': sum(1 for c in bycell[k] for m in c['markers']
                                         if m.get('lo') is not None and m.get('hi') is not None)}
out['t1c_shape'] = t1c

print()
print('=' * 96)
print('TABLE 2 — what the model did in the next 1 / 2 / 3 tool calls (all truncations)')
print('=' * 96)
CL = ['a-reread-gap', 'b-samefile-nonoverlap', 'c-gap-symbol-search', 'd-unrelated', 'e-ended']
t2 = {}
for k in ORDER:
    S = PER[k]
    print(' %s  (n=%d truncations, %d rollouts)' % (NAME[k], S['trunc_calls'], S['rollouts_with_trunc']))
    row = {}
    for kk in (1, 2, 3):
        line = '   k=%d ' % kk
        r = {}
        for c in CL:
            n = S['fu'].get('k%d:%s' % (kk, c), 0)
            nr = S['fu_rollouts'].get('k%d:%s' % (kk, c), 0)
            line += ' %s=%d(%dR)' % (c.split('-')[0], n, nr)
            r[c] = {'events': n, 'rollouts': nr}
        print(line)
        row['k%d' % kk] = r
    t2[NAME[k]] = row
out['t2_followups'] = t2

print()
print('TABLE 2b — UNBIASED: next call reads the SAME FILE the cut block came from')
print('   (denominator = markers whose file is known; needs no span, so all cells compare)')
print('%-11s %10s %14s %14s %14s' % ('cell', 'file known', 'k=1 re-read', 'k=2', 'k=3'))
t2b = {}
for k in ORDER:
    S = PER[k]
    fk = S['file_known'].get('True', 0)
    cells = []
    for kk in (1, 2, 3):
        r = S['touch'].get('k%d:read-same-file' % kk, 0)
        cells.append('%d/%d %5.1f%%' % (r, fk, 100.0 * r / max(1, fk)))
    print('%-11s %10d %14s %14s %14s' % (NAME[k], fk, *cells))
    t2b[NAME[k]] = {'file_known': fk}
    for kk in (1, 2, 3):
        t2b[NAME[k]]['k%d' % kk] = S['touch'].get('k%d:read-same-file' % kk, 0)
out['t2b_unbiased'] = t2b

# gutter (TAB+PIPE) vs no gutter (NONE) on the k=1 re-read rate
g = sum(PER[k]['touch'].get('k1:read-same-file', 0) for k in ('codex|sweet|tab', 'codex|sweet|pipe'))
gn = sum(PER[k]['file_known'].get('True', 0) for k in ('codex|sweet|tab', 'codex|sweet|pipe'))
n1 = PER['codex|sweet|none']['touch'].get('k1:read-same-file', 0)
nn = PER['codex|sweet|none']['file_known'].get('True', 0)
pf = fisher(g, gn - g, n1, nn - n1)
print('   gutted (TAB+PIPE) %d/%d = %.1f%%  vs  NONE %d/%d = %.1f%%   Fisher p = %.3f'
      % (g, gn, 100.0 * g / gn, n1, nn, 100.0 * n1 / nn, pf))
out['t2b_gutter_test'] = {'gutted': [g, gn], 'none': [n1, nn], 'fisher_p': pf}

print()
print('TABLE 2c — span-level (a) rate, restricted to markers with a RESOLVED span')
print('%-11s %12s %12s' % ('cell', 'spans', 'a within k<=3'))
t2c = {}
for k in ORDER:
    res = [c for c in bycell[k] if any(m.get('lo') is not None and m.get('hi') is not None
                                       for m in c['markers'])]
    a = sum(1 for c in res if any(f['cls'] == 'a-reread-gap' for f in c['followups']))
    print('%-11s %12d %8d %5.1f%%' % (NAME[k], len(res), a, 100.0 * a / max(1, len(res))))
    t2c[NAME[k]] = {'resolved_span_truncations': len(res), 'a_within_3': a}
out['t2c_spanlevel'] = t2c

print()
print('=' * 96)
print('TABLE 3 — price of the (a) re-read and (c) gap-search follow-ups')
print('=' * 96)
print('%-11s %11s %6s %11s %6s %11s %9s %11s' %
      ('cell', '(a) $', 'req', '(c) $', 'req', 'total $', '% of cell', '$/rollout'))
t3 = {}
for k in ORDER:
    S = PER[k]
    tot = S['reread_cost'] + S['gapsearch_cost']
    print('%-11s %11.5f %6d %11.5f %6d %11.5f %8.2f%% %11.6f' %
          (NAME[k], S['reread_cost'], S['reread_turns'], S['gapsearch_cost'],
           S['gapsearch_turns'], tot, 100.0 * tot / PUB[k], tot / 66.0))
    t3[NAME[k]] = {'reread_usd': S['reread_cost'], 'reread_requests': S['reread_turns'],
                   'gapsearch_usd': S['gapsearch_cost'], 'gapsearch_requests': S['gapsearch_turns'],
                   'total_usd': tot, 'share_of_cell': tot / PUB[k], 'per_rollout': tot / 66.0,
                   'cell_total_usd': PUB[k]}
out['t3_followup_cost'] = t3

print()
print('=' * 96)
print('TABLE 4 — counterfactual: deliver every truncated output IN FULL')
print('=' * 96)
print('%-11s %11s %13s %13s %11s %11s  %s' %
      ('cell', 'deleted tok', 'first ingest', 're-send', 'cf total $', 'follow-up $', 'larger'))
t4 = {}
for k in ORDER:
    S = PER[k]
    first = S['deleted_tokens'] * 0.10 / 1e6
    resend = S['cf_extra'] - first
    fu = S['reread_cost'] + S['gapsearch_cost']
    print('%-11s %11d %13.5f %13.5f %11.5f %11.5f  %s (%.1fx)' %
          (NAME[k], S['deleted_tokens'], first, resend, S['cf_extra'], fu,
           'COUNTERFACTUAL' if S['cf_extra'] > fu else 'follow-ups',
           max(S['cf_extra'], fu) / max(1e-9, min(S['cf_extra'], fu))))
    t4[NAME[k]] = {'deleted_tokens': S['deleted_tokens'], 'first_ingest_usd': first,
                   'resend_usd': resend, 'counterfactual_usd': S['cf_extra'],
                   'followup_usd': fu, 'larger': 'counterfactual' if S['cf_extra'] > fu else 'followups',
                   'ratio': max(S['cf_extra'], fu) / max(1e-9, min(S['cf_extra'], fu)),
                   'cf_share_of_cell': S['cf_extra'] / PUB[k]}
out['t4_counterfactual'] = t4

print()
print('=' * 96)
print('TABLE 5 — does truncation correlate with the outcome?')
print('=' * 96)
print('%-11s %28s %28s' % ('cell', 'rollouts by truncation count', 'solved'))
t5 = {}
B = ['0', '1', '2', '3+']
for k in ORDER:
    S = PER[k]
    n = S['n_by_bucket']
    sv = S['solved_by_bucket']
    assert not any(kk.startswith('NULL') for kk in n), 'resolved is null somewhere in ' + k
    assert sum(n.get(b, 0) for b in B) == 66, 'denominator != 66 in ' + k
    line = '%-11s ' % NAME[k]
    r = {}
    for b in B:
        line += ' %s:%2d/%-2d=%5.1f%%' % (b, sv.get(b, 0), n.get(b, 0),
                                          100.0 * sv.get(b, 0) / max(1, n.get(b, 0)))
        r[b] = {'n': n.get(b, 0), 'solved': sv.get(b, 0)}
    print(line + '   total solved %d/66' % sum(sv.values()))
    r['total_solved'] = sum(sv.values())
    t5[NAME[k]] = r
# pooled sweet: 0 truncations vs >=1
z_s = z_n = p_s = p_n = 0
for k in ('codex|sweet|tab', 'codex|sweet|none', 'codex|sweet|pipe'):
    S = PER[k]
    z_s += S['solved_by_bucket'].get('0', 0); z_n += S['n_by_bucket'].get('0', 0)
    for b in ('1', '2', '3+'):
        p_s += S['solved_by_bucket'].get(b, 0); p_n += S['n_by_bucket'].get(b, 0)
pf2 = fisher(z_s, z_n - z_s, p_s, p_n - p_s)
print('  pooled sweet: 0 truncations %d/%d = %.1f%%   >=1 truncation %d/%d = %.1f%%   Fisher p = %.4f'
      % (z_s, z_n, 100.0 * z_s / z_n, p_s, p_n, 100.0 * p_s / p_n, pf2))
S = PER['codex|native|-']
nz_s, nz_n = S['solved_by_bucket'].get('0', 0), S['n_by_bucket'].get('0', 0)
np_s = sum(S['solved_by_bucket'].get(b, 0) for b in ('1', '2', '3+'))
np_n = sum(S['n_by_bucket'].get(b, 0) for b in ('1', '2', '3+'))
print('  native:       0 truncations %d/%d = %.1f%%   >=1 truncation %d/%d = %.1f%%   Fisher p = %.4f'
      % (nz_s, nz_n, 100.0 * nz_s / nz_n, np_s, np_n, 100.0 * np_s / np_n,
         fisher(nz_s, nz_n - nz_s, np_s, np_n - np_s)))
out['t5_outcome'] = t5
out['t5_pooled_sweet'] = {'zero': [z_s, z_n], 'one_plus': [p_s, p_n], 'fisher_p': pf2}
out['t5_native'] = {'zero': [nz_s, nz_n], 'one_plus': [np_s, np_n],
                    'fisher_p': fisher(nz_s, nz_n - nz_s, np_s, np_n - np_s)}

print()
print('=' * 96)
print('TABLE 6 — ss-read: requested range vs the span that was deleted')
print('=' * 96)
t6 = {}
for k in ORDER:
    rows = []
    for c in bycell[k]:
        for m in c['markers']:
            if not str(m.get('class', '')).startswith('ss-read'):
                continue
            req = [t for t in c['requested'] if m.get('file') and
                   os.path.basename(str(t[0])) == os.path.basename(str(m['file']))]
            if m.get('lo') is not None and m.get('hi') is not None:
                rows.append({'task': c['task'], 'file': m['file'], 'req': req[0] if req else None,
                             'lo': m['lo'], 'hi': m['hi'], 'lines': m['hi'] - m['lo'] + 1,
                             'deleted_tokens': m['deleted_tokens'], 'how': m['how']})
    if rows:
        L = sorted(r['lines'] for r in rows)
        cov = [r for r in rows if r['req'] and r['req'][1] and r['req'][2]]
        frac = [(r['hi'] - r['lo'] + 1) / max(1, r['req'][2] - r['req'][1] + 1) for r in cov]
        print('%-11s  n=%3d  deleted lines: med %d  max %d   |  requested-range coverage n=%d, '
              'mean %.0f%% of the requested lines deleted'
              % (NAME[k], len(rows), L[len(L) // 2], L[-1], len(cov),
                 100.0 * sum(frac) / max(1, len(frac))))
    else:
        print('%-11s  n=0 (no ss-read marker with a resolved span)' % NAME[k])
    t6[NAME[k]] = rows
out['t6_ssread'] = {a: len(b) for a, b in t6.items()}
out['t6_ssread_rows'] = t6

print()
print('=' * 96)
print('TABLE 7 — ss-search / ss-find packs: which ranks survived, did the trailer survive?')
print('=' * 96)
print('%-11s %7s %14s %14s %16s' % ('cell', 'packs', 'ranks before', 'ranks after', 'trailer survived'))
t7 = {}
for k in ORDER:
    ps = [c['pack'] for c in bycell[k] if c.get('pack')]
    if not ps:
        print('%-11s %7d' % (NAME[k], 0)); t7[NAME[k]] = {'packs': 0}; continue
    hb = sum(len(p['ranks_head']) for p in ps) / len(ps)
    ha = sum(len(p['ranks_tail']) for p in ps) / len(ps)
    tr = sum(1 for p in ps if p['trailer_survived'])
    print('%-11s %7d %14.2f %14.2f %10d/%d %5.1f%%' %
          (NAME[k], len(ps), hb, ha, tr, len(ps), 100.0 * tr / len(ps)))
    t7[NAME[k]] = {'packs': len(ps), 'mean_ranks_before': hb, 'mean_ranks_after': ha,
                   'trailer_survived': tr, 'trailer_rate': tr / len(ps)}
out['t7_packs'] = t7

json.dump(out, open('/tmp/fp-inv/trunc/report.json', 'w'), indent=1)
print('\nwrote /tmp/fp-inv/trunc/report.json')
