#!/usr/bin/env python3
"""analyze_stats.py - deterministic statistics over the ss-* tool dossiers -> STATS.md

  python3 build_dossiers.py          # first: writes dossiers.jsonl, trajectories.jsonl, units.jsonl
  python3 analyze_stats.py           # then: writes STATS.md (+ first-call-ids.md, data/first-call-success.json)

No randomness. Every number is a count or a ratio of counts; the only estimate is tokens = ceil(chars / 4).
"""
import json
import math
import os
import re
import shlex
import sys
from collections import Counter, defaultdict, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ss_parse as P  # noqa: E402

WT = os.path.abspath(os.path.join(HERE, '../../../../..'))
DATA = os.path.join(WT, 'core/prompt-optimization/data/results/final-tuning-forensics')
OUT_MD = os.path.join(HERE, 'STATS.md')
OUT_IDS = os.path.join(HERE, 'first-call-ids.md')
VALIDATION_MD = os.path.join(HERE, 'VALIDATION-NOTES.md')


def tok(chars):
    return int(math.ceil(chars / 4)) if chars else 0


def pct(a, b, nd=1):
    return f'{100.0 * a / b:.{nd}f}%' if b else 'n/a'


def pctn(a, b):
    return 100.0 * a / b if b else 0.0


def nearest_rank(xs, p):
    if not xs:
        return 0
    s = sorted(xs)
    k = max(0, min(len(s) - 1, int(math.ceil(p * len(s))) - 1))
    return s[k]


def median(xs):
    if not xs:
        return 0
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def wilson(k, n, z=1.96):
    if not n:
        return (0, 0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (100 * (c - h), 100 * (c + h))


def hk_of(rec):
    """harness key = harness + short model name (claudecode-opus, codex-luna, ...)."""
    h = rec['harness']
    m = (rec.get('model') or '').lower()
    for key in ('opus', 'sonnet', 'luna', 'sol', 'flash', 'deepseek', 'haiku'):
        if key in m:
            return f'{h}-{key}'
    return h + '-' + (re.sub(r'[^a-z0-9]+', '', m.split('/')[-1]) or 'unknown')


HK_ORDER = ['claudecode-opus', 'claudecode-luna', 'codex-luna', 'opencode-luna', 'claudecode-sonnet', 'codex-sol', 'opencode-sol']


def order_hks(T):
    present = sorted({t['hk'] for t in T}, key=lambda k: (HK_ORDER.index(k) if k in HK_ORDER else 99, k))
    return present


def md_table(headers, rows):
    out = ['| ' + ' | '.join(headers) + ' |', '|' + '|'.join(['---'] * len(headers)) + '|']
    for r in rows:
        out.append('| ' + ' | '.join(str(x) for x in r) + ' |')
    return '\n'.join(out)


# ----------------------------------------------------------------------------------------------
# load
# ----------------------------------------------------------------------------------------------
def load():
    D, U, T = [], [], []
    with open(os.path.join(DATA, 'dossiers.jsonl')) as fh:
        for ln in fh:
            D.append(json.loads(ln))
    with open(os.path.join(DATA, 'units.jsonl')) as fh:
        for ln in fh:
            U.append(json.loads(ln))
    with open(os.path.join(DATA, 'trajectories.jsonl')) as fh:
        for ln in fh:
            T.append(json.loads(ln))
    for r in D:
        r['hk'] = hk_of(r)
    for r in U:
        r['hk'] = hk_of(r)
    for r in T:
        r['hk'] = hk_of(r)
    return D, U, T


# ----------------------------------------------------------------------------------------------
# section A: per harness x tool
# ----------------------------------------------------------------------------------------------
def section_a(D, U, T, hks):
    lines = []
    ss = [d for d in D if d['class'] == 'ss']
    # all-tool amplified tokens, from units (one record per model tool call)
    all_amp = Counter()
    ss_amp_all = Counter()
    for u in U:
        if u['unitOutputChars'] is None:
            continue
        rem = max(u['turnsTotal'] - u.get('deliveredTurn', u['turnIndex']), 0)
        all_amp[u['hk']] += tok(u['unitOutputChars']) * (1 + rem)
    for d in ss:
        if d['outputKnown']:
            ss_amp_all[d['hk']] += d['outputTokensEst'] * (1 + d['turnsRemaining'])
    ncalls_all = Counter(d['hk'] for d in D)
    rows = []
    for hk in hks:
        tools = Counter(d['tool'] for d in ss if d['hk'] == hk)
        nss = sum(tools.values())
        for tool in ('ss-search', 'ss-find', 'ss-grep', 'ss-read', 'ss-trace', 'ss-semantic', 'ss-batch'):
            sel = [d for d in ss if d['hk'] == hk and d['tool'] == tool]
            if not sel:
                rows.append([hk, tool, 0, '-', '-', '-', '-', '-', '-', '-', '-'])
                continue
            known = [d for d in sel if d['outputKnown']]
            tk = [d['outputTokensEst'] for d in known]
            amp = sum(d['outputTokensEst'] * (1 + d['turnsRemaining']) for d in known)
            rows.append([hk, tool, len(sel), pct(len(sel), nss), pct(len(sel), ncalls_all[hk]),
                         int(median(tk)), nearest_rank(tk, 0.9), sum(tk), amp,
                         pct(amp, all_amp[hk]), pct(amp, ss_amp_all[hk])])
        # native classes (calls and sizes where the output belongs to the call alone)
        for cls in ('native-search', 'native-read', 'edit', 'test', 'other'):
            sel = [d for d in D if d['hk'] == hk and d['class'] == cls]
            known = [d for d in sel if d.get('outputTokensEst') is not None and not d.get('sharedOutput')]
            tk = [d['outputTokensEst'] for d in known]
            amp = sum(d['outputTokensEst'] * (1 + d['turnsRemaining']) for d in known)
            rows.append([hk, '(' + cls + ')', len(sel), '-', pct(len(sel), ncalls_all[hk]), int(median(tk)) if tk else '-',
                         nearest_rank(tk, 0.9) if tk else '-', sum(tk), amp, pct(amp, all_amp[hk]), '-'])
        rows.append([hk, '**all tool outputs (units)**', ncalls_all[hk], '-', '100%', '-', '-', '-', all_amp[hk], '100%', '-'])
    lines.append(md_table(['harness', 'tool', 'calls', '% of ss calls', '% of all calls', 'out tok median', 'out tok p90', 'out tok sum', 'amplified tok', 'share of ALL amplified', 'share of ss amplified'], rows))
    return '\n'.join(lines)


# ----------------------------------------------------------------------------------------------
# section B / D: composition of ss-search / ss-find
# ----------------------------------------------------------------------------------------------
SEARCH_BUCKET_ORDER = [
    ('header_meta', 'header line (`# ss-search: ...` or `# ss-find: ...`)'), ('header_confidence', 'header line `# confidence=...`'), ('header_other', 'header other'),
    ('rank_overhead', 'rank header: `## #N ` and newline'), ('rank_path_range', 'rank header: path:range'), ('rank_symbol', 'rank header: [kind: symbol]'),
    ('rank_presentation', 'rank header: (presentation kind=...)'), ('rank_score', 'rank header: score=...'),
    ('imports', '`### imports` blocks (heading + fences + lines)'), ('code_text', 'code inside fences: code chars'), ('code_gutter', 'code inside fences: line-gutter chars'),
    ('code_fence_markers', 'code fence marker lines'), ('summary_lines', 'summary lines (entries without code)'), ('related', '`### related` blocks'),
    ('same_file_map', '`# same file:` lines'), ('sibling_line', '`# same file (siblings of ...)` lines'), ('family_manifest', '`# indexed family:` lines'),
    ('continuation_line', '`# continues at` lines'), ('continuation_code', 'continuation code blocks'), ('shown_full', '`shown-full:` trailer'),
    ('route_trailer', '`route=...` trailer'), ('blank', 'blank lines'), ('other', 'other'),
]


def comp_search(D, tool, hks, label):
    sel = [d for d in D if d['class'] == 'ss' and d['tool'] == tool and d['outputKind'] == 'ok' and d['outputKnown'] and not d['piped']]
    res = {}
    for hk in hks + ['ALL']:
        agg = Counter()
        n = 0
        tot = 0
        for d in sel:
            if hk != 'ALL' and d['hk'] != hk:
                continue
            r = P.parse_search_like(d['output'])
            for k, v in r['buckets'].items():
                agg[k] += v
            n += 1
            tot += len(d['output'])
        res[hk] = (n, tot, agg)
    hdr = ['part'] + [f'{hk} (n={res[hk][0]})' for hk in hks + ['ALL']]
    rows = []
    for key, name in SEARCH_BUCKET_ORDER:
        rows.append([name] + [(f"{res[hk][2].get(key, 0):,} ({pct(res[hk][2].get(key, 0), res[hk][1])})" if res[hk][1] else '-') for hk in hks + ['ALL']])
    rows.append(['**total chars**'] + [f'{res[hk][1]:,}' for hk in hks + ['ALL']])
    # derived
    def share(hk, keys):
        return sum(res[hk][2].get(k, 0) for k in keys)
    drows = []
    groups = [
        ('code lines (code + gutter + fence markers)', ['code_text', 'code_gutter', 'code_fence_markers']),
        ('of which gutter / (code + gutter)', None),
        ('rank header lines (all 5 parts)', ['rank_overhead', 'rank_path_range', 'rank_symbol', 'rank_presentation', 'rank_score']),
        ('header lines (`# ...`) + route/shown trailers', ['header_meta', 'header_confidence', 'header_other', 'route_trailer', 'shown_full']),
        ('summary lines + related + same file + sibling + family + continuation line', ['summary_lines', 'related', 'same_file_map', 'sibling_line', 'family_manifest', 'continuation_line']),
        ('everything that is NOT code/imports/continuation code', None),
    ]
    for name, keys in groups:
        cells = []
        for hk in hks + ['ALL']:
            if not res[hk][1]:
                cells.append('-')
                continue
            if name.startswith('of which gutter'):
                cells.append(pct(res[hk][2].get('code_gutter', 0), res[hk][2].get('code_gutter', 0) + res[hk][2].get('code_text', 0)))
            elif name.startswith('everything'):
                nc = res[hk][1] - share(hk, ['code_text', 'code_gutter', 'code_fence_markers', 'imports', 'continuation_code'])
                cells.append(pct(nc, res[hk][1]))
            else:
                cells.append(pct(share(hk, keys), res[hk][1]))
        drows.append([name] + cells)
    return md_table(hdr, rows) + '\n\nDerived shares of total chars:\n\n' + md_table(['group'] + [f'{hk}' for hk in hks + ['ALL']], drows), res


def comp_weighted(D, tool, hks):
    """composition weighted by (1 + turnsRemaining): where the re-read cost of ss-search output sits."""
    sel = [d for d in D if d['class'] == 'ss' and d['tool'] == tool and d['outputKind'] == 'ok' and d['outputKnown'] and not d['piped']]
    groups = OrderedDict([
        ('code + gutter + fence markers', ['code_text', 'code_gutter', 'code_fence_markers']),
        ('imports blocks', ['imports']),
        ('continuation code + line', ['continuation_code', 'continuation_line']),
        ('rank header lines', ['rank_overhead', 'rank_path_range', 'rank_symbol', 'rank_presentation', 'rank_score']),
        ('summary lines', ['summary_lines']),
        ('related + same file + sibling + family', ['related', 'same_file_map', 'sibling_line', 'family_manifest']),
        ('header + route + shown-full trailers', ['header_meta', 'header_confidence', 'header_other', 'route_trailer', 'shown_full']),
        ('blank + other', ['blank', 'other']),
    ])
    cols = hks + ['ALL']
    acc = {hk: Counter() for hk in cols}
    for d in sel:
        w = 1 + d['turnsRemaining']
        r = P.parse_search_like(d['output'])
        for hk in (d['hk'], 'ALL'):
            for g, keys in groups.items():
                acc[hk][g] += w * sum(r['buckets'].get(k, 0) for k in keys)
    rows = []
    for g in groups:
        rows.append([g] + [pct(acc[hk][g], sum(acc[hk].values())) for hk in cols])
    rows.append(['**weighted chars (millions)**'] + [f'{sum(acc[hk].values()) / 1e6:.1f}' for hk in cols])
    return md_table(['part (weighted by 1 + turnsRemaining)'] + cols, rows)


def by_k(D, tool='ss-search'):
    """composition by the -k value the agent asked for (default k=5 for ss-search, 6 for ss-find)."""
    dflt = 5 if tool == 'ss-search' else 6
    sel = [d for d in D if d['class'] == 'ss' and d['tool'] == tool and d['outputKind'] == 'ok' and d['outputKnown'] and not d['piped']]
    rows = []
    groups = defaultdict(list)
    for d in sel:
        try:
            ws = shlex.split(d['args'], posix=True)
        except ValueError:
            ws = d['args'].split()
        k = dflt
        for i, x in enumerate(ws):
            if x in ('-k', '--top') and i + 1 < len(ws) and ws[i + 1].isdigit():
                k = int(ws[i + 1])
        groups[k].append(d)
    for k in sorted(groups):
        ds = groups[k]
        if len(ds) < 5:
            continue
        tot = code = nent = nsum = 0
        tk = []
        for d in ds:
            r = P.parse_search_like(d['output'])
            b = r['buckets']
            tot += len(d['output'])
            code += sum(b.get(x, 0) for x in ('code_text', 'code_gutter', 'code_fence_markers', 'imports', 'continuation_code'))
            nent += len(r['entries'])
            nsum += sum(1 for e in r['entries'] if e['presentation'] == 'summary')
            tk.append(d['outputTokensEst'])
        rows.append([k, len(ds), f'{nent / len(ds):.1f}', f'{nsum / len(ds):.1f}', int(median(tk)), nearest_rank(tk, 0.9), pct(tot - code, tot)])
    return md_table([f'-k asked ({tool}; default {dflt})', 'outputs', 'mean entries', 'mean summary entries', 'out tok median', 'out tok p90', 'non-code share of chars'], rows)


def headline(D, U):
    h = {}
    sel = [d for d in D if d['class'] == 'ss' and d['tool'] == 'ss-search' and d['outputKind'] == 'ok' and d['outputKnown'] and not d['piped']]
    tot = ent = dup = summ = ddrop = rest_chars = summ_chars = 0
    for d in sel:
        r = P.parse_search_like(d['output'])
        es = r['entries']
        fl = entries_dup(es)
        tot += len(d['output'])
        ent += len(es)
        dup += sum(1 for f in fl if f['dup'])
        for e, f in zip(es, fl):
            if e['presentation'] == 'summary':
                summ += 1
                st, lo = summary_restates(e)
                if lo:
                    rest_chars += e['summary_chars']
                ddrop += e['chars'] if f['dup'] else (e['summary_chars'] if lo else 0)
    h.update({'ss_search_outputs': len(sel), 'ss_search_chars': tot, 'entries': ent, 'dup_entries': dup, 'summary_entries': summ, 'restate_chars': rest_chars, 'dedupe_drop': ddrop})
    # amplified shares (ss tools of ALL harnesses)
    amp = Counter()
    for d in D:
        if d['class'] == 'ss' and d['outputKnown']:
            amp[d['tool']] += d['outputTokensEst'] * (1 + d['turnsRemaining'])
    h['amp'] = amp
    allamp = sum(max(u['turnsTotal'] - u.get('deliveredTurn', u['turnIndex']), 0) * 0 + tok(u['unitOutputChars']) * (1 + max(u['turnsTotal'] - u.get('deliveredTurn', u['turnIndex']), 0)) for u in U if u['unitOutputChars'] is not None)
    h['allamp'] = allamp
    return h


def stability(D, first_all):
    """Key numbers by source group, to show that pooling the groups does not hide a difference."""
    rows = []
    for gname, gs in (('tg + hc (2026-09-29 .. 10-01)', ('tg', 'hc')), ('hsmoke (2026-09-25/26)', ('hsmoke',))):
        for hk in sorted({d['hk'] for d in D}, key=lambda k: (HK_ORDER.index(k) if k in HK_ORDER else 99, k)):
            sub = [d for d in D if d['group'] in gs and d['hk'] == hk]
            if not any(d['tool'] == 'ss-search' for d in sub):
                continue
            sel = [d for d in sub if d['class'] == 'ss' and d['tool'] == 'ss-search' and d['outputKind'] == 'ok' and d['outputKnown'] and not d['piped']]
            tot = code = ent = dup = ddrop = 0
            for d in sel:
                r = P.parse_search_like(d['output'])
                b = r['buckets']
                tot += len(d['output'])
                code += sum(b.get(k, 0) for k in ('code_text', 'code_gutter', 'code_fence_markers', 'imports', 'continuation_code'))
                es = r['entries']
                fl = entries_dup(es)
                ent += len(es)
                dup += sum(1 for f in fl if f['dup'])
                for e, f in zip(es, fl):
                    if e['presentation'] == 'summary':
                        st, lo = summary_restates(e)
                        if f['dup']:
                            ddrop += e['chars']
                        elif lo:
                            ddrop += e['summary_chars']
            fr = [r for r in first_all if r['group'] in gs and r['hk'] == hk and r['outcome'] != 'result-has-no-paths']
            ks = sum(1 for r in fr if r['success'])
            rows.append([gname, hk, len(sel), pct(tot - code, tot), pct(dup, ent), pct(ddrop, tot), f'{ks}/{len(fr)} ({pct(ks, len(fr))})'])
    return md_table(['source group', 'harness', 'ss-search outputs', 'non-code share of chars', 'dup entries', 'DEDUPE would drop (chars)', 'first-call success'], rows)


# ----------------------------------------------------------------------------------------------
# section C / D: duplication inside ss-search / ss-find outputs
# ----------------------------------------------------------------------------------------------
def entries_dup(entries):
    """flag entries that repeat information of an earlier entry in the same output."""
    flags = []
    for j, e in enumerate(entries):
        inside = same_sym = covered_by_code = False
        for i in range(j):
            x = entries[i]
            if x['file'] != e['file']:
                continue
            if e['start'] >= x['start'] and e['end'] <= x['end']:
                inside = True
                if x['has_code']:
                    covered_by_code = True
            if e['symbol'] and x['symbol'] == e['symbol']:
                same_sym = True
        flags.append({'inside': inside, 'same_sym': same_sym, 'covered_by_code': covered_by_code, 'dup': inside or same_sym})
    return flags


def summary_restates(e):
    """-> (strict, loose). A summary line restating its own header `file:line — symbol (kind)`."""
    sl = e.get('summary_line')
    if not sl:
        return False, False
    m = P.SUMMARY_RE.match(sl.strip())
    if not m:
        return False, False
    loose = True
    strict = (m.group(1) == e['file'] and int(m.group(2)) == e['start'] and (e['symbol'] is None or m.group(3) == e['symbol']))
    return strict, loose


def dup_search(D, tool, hks):
    sel = [d for d in D if d['class'] == 'ss' and d['tool'] == tool and d['outputKind'] == 'ok' and d['outputKnown'] and not d['piped']]
    rows = []
    for hk in hks + ['ALL']:
        n = ent = dup = inside = same_sym = 0
        chars_total = dup_chars = 0
        summ = summ_dup = restate_strict = restate_loose = 0
        restate_loose_chars = restate_strict_chars = 0
        dedupe_chars = 0  # what SS_VARIANT_SEARCH_DEDUPE=1 would drop
        dup_summary_chars = 0
        outs_with_dup = 0
        multi_same_span = 0
        for d in sel:
            if hk != 'ALL' and d['hk'] != hk:
                continue
            r = P.parse_search_like(d['output'])
            es = r['entries']
            fl = entries_dup(es)
            n += 1
            chars_total += len(d['output'])
            ent += len(es)
            any_dup = False
            for e, f in zip(es, fl):
                if f['dup']:
                    dup += 1
                    dup_chars += e['chars']
                    any_dup = True
                if f['inside']:
                    inside += 1
                if f['same_sym'] and not f['inside']:
                    same_sym += 1
                if e['presentation'] == 'summary':
                    summ += 1
                    st, lo = summary_restates(e)
                    if lo:
                        restate_loose += 1
                        restate_loose_chars += e['summary_chars']
                    if st:
                        restate_strict += 1
                        restate_strict_chars += e['summary_chars']
                    if f['dup']:
                        summ_dup += 1
                        dup_summary_chars += e['chars']
                    # DEDUPE variant: drop covered summary entries; else drop restating summary line
                    covered = f['inside'] or f['same_sym']
                    if covered:
                        dedupe_chars += e['chars']
                    elif lo:
                        dedupe_chars += e['summary_chars']
            if any_dup:
                outs_with_dup += 1
        rows.append([hk, n, ent, f'{dup} ({pct(dup, ent)})', f'{inside} ({pct(inside, ent)})', f'{same_sym} ({pct(same_sym, ent)})',
                     f'{dup_chars:,} ({pct(dup_chars, chars_total)})', f'{summ} ({pct(summ, ent)})', f'{summ_dup} ({pct(summ_dup, summ)})',
                     f'{restate_loose} ({pct(restate_loose, summ)})', f'{restate_strict} ({pct(restate_strict, summ)})',
                     f'{restate_loose_chars:,} ({pct(restate_loose_chars, chars_total)})', f'{dedupe_chars:,} ({pct(dedupe_chars, chars_total)})',
                     pct(outs_with_dup, n)])
    hdr = ['harness', 'outputs', 'entries', 'dup entries (span inside earlier OR same file+symbol)', 'span inside earlier', 'same file+symbol only',
           'chars in dup entries (% of all chars)', 'summary entries (% of entries)', 'summary entries that are dup', 'summary lines restating header (loose regex)',
           'restating header (strict: same file, line, symbol)', 'chars in restating summary lines', 'chars the DEDUPE variant would drop', 'outputs with >=1 dup']
    return md_table(hdr, rows)


# ----------------------------------------------------------------------------------------------
# cross-call duplication
# ----------------------------------------------------------------------------------------------
def shown_blocks(d):
    """code blocks an ss-* output showed: list of dict(file, tool, lines[(no, chars)])."""
    t = d['tool']
    o = d['output'] or ''
    if t in ('ss-search', 'ss-find'):
        r = P.parse_search_like(o)
        return [{'file': s['file'], 'lines': s['lines'], 'src': t} for s in r['shown'] if s['lines']]
    if t == 'ss-read':
        r = P.parse_read(o)
        return [{'file': s['file'], 'lines': s['lines'], 'src': t} for s in r['shown'] if s['lines'] and s['file']]
    if t == 'ss-semantic':
        r = P.parse_semantic(o)
        return [{'file': s['file'], 'lines': s['lines'], 'src': t} for s in r['shown'] if s['lines']]
    return []


def norm_path(p):
    p = p.strip()
    p = re.sub(r'^.*/\.ss-eval/runs/r0-\d+/', '', p)
    p = re.sub(r'^\./', '', p)
    return p


def cross_dup(D, hks):
    by = defaultdict(list)
    for d in D:
        if d['class'] == 'ss' and d['thread'] == 'main' and d['tool'] in ('ss-search', 'ss-find', 'ss-read', 'ss-semantic') and d['outputKind'] == 'ok' and d['outputKnown'] and not d['piped']:
            by[(d['run'], d['task'], d['rep'])].append(d)
    agg = {hk: Counter() for hk in hks + ['ALL']}
    pair = {hk: Counter() for hk in hks + ['ALL']}
    pair_n = {hk: Counter() for hk in hks + ['ALL']}
    trajs = {hk: [0, 0] for hk in hks + ['ALL']}
    for key, ds in by.items():
        ds.sort(key=lambda x: x['callIndex'])
        seen = defaultdict(dict)  # file -> {line: src}
        any_reshow = False
        for d in ds:
            hk = d['hk']
            blocks = shown_blocks(d)
            call_new = defaultdict(dict)
            for b in blocks:
                f = norm_path(b['file'])
                for (ln, ch) in b['lines']:
                    agg[hk][('code_chars', d['tool'])] += ch
                    agg['ALL'][('code_chars', d['tool'])] += ch
                    if ln in seen[f]:
                        agg[hk][('reshown', d['tool'])] += ch
                        agg['ALL'][('reshown', d['tool'])] += ch
                        pair[hk][(seen[f][ln], d['tool'])] += ch
                        pair['ALL'][(seen[f][ln], d['tool'])] += ch
                        any_reshow = True
                    call_new[f].setdefault(ln, d['tool'])
            for f, m in call_new.items():
                for ln, src in m.items():
                    seen[f].setdefault(ln, src)
        h = ds[0]['hk']
        trajs[h][0] += 1
        trajs[h][1] += 1 if any_reshow else 0
        trajs['ALL'][0] += 1
        trajs['ALL'][1] += 1 if any_reshow else 0
    rows = []
    for hk in hks + ['ALL']:
        for tool in ('ss-search', 'ss-find', 'ss-read', 'ss-semantic'):
            cc, rs = agg[hk][('code_chars', tool)], agg[hk][('reshown', tool)]
            if cc:
                rows.append([hk, tool, f'{cc:,}', f'{rs:,}', pct(rs, cc)])
        cc = sum(v for (k, t), v in agg[hk].items() if k == 'code_chars')
        rs = sum(v for (k, t), v in agg[hk].items() if k == 'reshown')
        rows.append([hk, '**all code-showing tools**', f'{cc:,}', f'{rs:,}', pct(rs, cc)])
    t1 = md_table(['harness', 'later call', 'code chars shown (code only, no gutter)', 'of which already shown by an EARLIER ss-* call in the same rollout', 'share'], rows)
    prow = []
    for hk in hks + ['ALL']:
        tot = sum(pair[hk].values())
        for (a, b), v in sorted(pair[hk].items(), key=lambda x: -x[1]):
            prow.append([hk, a, b, f'{v:,}', pct(v, tot)])
    t2 = md_table(['harness', 'earlier call', 'later call (re-shows)', 're-shown chars', 'share of re-shown chars'], prow)
    t3 = md_table(['harness', 'rollouts with >=1 ss code-showing call', 'rollouts with any re-shown span', 'share'],
                  [[hk, trajs[hk][0], trajs[hk][1], pct(trajs[hk][1], trajs[hk][0])] for hk in hks + ['ALL']])
    return t1, t2, t3


# ----------------------------------------------------------------------------------------------
# extra: ss-read / ss-grep composition
# ----------------------------------------------------------------------------------------------
def comp_simple(D, tool, parser, hks, order):
    sel = [d for d in D if d['class'] == 'ss' and d['tool'] == tool and d['outputKind'] == 'ok' and d['outputKnown'] and not d['piped']]
    res = {}
    for hk in hks + ['ALL']:
        agg = Counter()
        n = tot = 0
        for d in sel:
            if hk != 'ALL' and d['hk'] != hk:
                continue
            r = parser(d['output'])
            for k, v in r['buckets'].items():
                agg[k] += v
            n += 1
            tot += len(d['output'])
        res[hk] = (n, tot, agg)
    rows = [[name] + [(f"{res[hk][2].get(key, 0):,} ({pct(res[hk][2].get(key, 0), res[hk][1])})" if res[hk][1] else '-') for hk in hks + ['ALL']] for key, name in order]
    rows.append(['**total chars**'] + [f'{res[hk][1]:,}' for hk in hks + ['ALL']])
    extra = md_table(['gutter chars / (gutter + code chars)'] + hks + ['ALL'],
                     [['share'] + [pct(res[hk][2].get('code_gutter', 0), res[hk][2].get('code_gutter', 0) + res[hk][2].get('code_text', 0)) for hk in hks + ['ALL']]])
    return md_table(['part'] + [f'{hk} (n={res[hk][0]})' for hk in hks + ['ALL']], rows) + ('\n\n' + extra if tool != 'ss-grep' else '')


# ----------------------------------------------------------------------------------------------
# section E: first-call success
# ----------------------------------------------------------------------------------------------
def words_of(args):
    try:
        return shlex.split(args, posix=True)
    except ValueError:
        return args.split()


def call_paths(c):
    """paths a call touches (best effort)."""
    out = set()
    cls, tool, args = c['class'], c['tool'], c.get('args') or ''
    if tool in ('ss-read', 'ss-semantic'):
        ws = words_of(args)
        for w in ws[1:]:
            if not w.startswith('-') and not re.fullmatch(r'[\d,:-]+', w):
                out.add(norm_path(w))
                break
    elif cls in ('native-read', 'edit', 'native-search') or tool in ('Read', 'Edit', 'Write', 'read', 'edit', 'write', 'apply_patch'):
        for w in re.findall(r'[\w@./+-]+\.[A-Za-z0-9]{1,8}', args):
            out.add(norm_path(w))
        for w in re.findall(r'\*\*\* (?:Update|Add|Delete) File: (\S+)', args):
            out.add(norm_path(w))
    return {p for p in out if p}


def path_match(a, p):
    if a == p:
        return True
    if '/' in p and a.endswith('/' + p):
        return True
    if p.endswith('/' + a) and '.' in a:
        return True
    return False


def first_call_study(D):
    by = defaultdict(list)
    for d in D:
        if d['thread'] == 'main':
            by[(d['run'], d['task'], d['rep'])].append(d)
    rows = []
    for key, ds in by.items():
        ds.sort(key=lambda x: x['callIndex'])
        idx = next((i for i, d in enumerate(ds) if d['class'] == 'ss' and d['tool'] == 'ss-search'), None)
        if idx is None:
            continue
        d0 = ds[idx]
        strict = {norm_path(p) for p in P.result_paths(d0['output'] or '')}
        loose = {norm_path(p) for p in P.loose_paths(d0['output'] or '')}
        prior_retrieval = any(x['class'] in ('ss', 'native-search', 'native-read') for x in ds[:idx])
        outcome, nxt = None, None
        t0 = d0['turnIndex']
        same_turn_search = any(c['turnIndex'] == t0 and c is not d0 and ((c['class'] == 'ss' and c['tool'] in ('ss-search', 'ss-find', 'ss-grep', 'ss-trace')) or c['class'] == 'native-search') for c in ds)
        if not strict:
            outcome = 'result-has-no-paths'
        # informed actions only: calls of LATER model requests (the model has seen the result there)
        for c in (ds[idx + 1:] if outcome is None else []):
            if c['turnIndex'] <= t0:
                continue
            cls, tool = c['class'], c['tool']
            if cls == 'ss' and tool in ('ss-search', 'ss-find', 'ss-grep', 'ss-trace'):
                outcome, nxt = 'searched-again-first', c
                break
            if cls == 'native-search':
                outcome, nxt = 'searched-again-first', c
                break
            if tool in ('ss-read', 'ss-semantic') or cls in ('native-read', 'edit'):
                ps = call_paths(c)
                if any(path_match(a, p) for a in ps for p in strict):
                    outcome, nxt = 'used-result-path', c
                elif any(path_match(a, p) for a in ps for p in loose):
                    outcome, nxt = 'used-loose-path-only', c
                else:
                    outcome, nxt = ('read-other-path-first' if cls != 'edit' else 'edited-other-path-first'), c
                break
        if outcome is None:
            final = (d0['after'].get('assistantText') or '')
            cites = any(p in final or p.split('/')[-1] in final for p in strict if len(p.split('/')[-1]) > 3)
            outcome = 'no-follow-up-cited-in-final' if cites else 'no-follow-up-no-cite'
        rows.append({'id': d0['id'], 'run': d0['run'], 'hk': d0['hk'], 'harness': d0['harness'], 'task': d0['task'], 'solved': d0['solved'], 'outcome': outcome,
                     'success': outcome in ('used-result-path', 'no-follow-up-cited-in-final'), 'sameTurnSearch': same_turn_search,
                     'successLoose': outcome in ('used-result-path', 'used-loose-path-only', 'no-follow-up-cited-in-final'),
                     'firstRetrieval': not prior_retrieval, 'nextCall': (nxt['tool'] + ' ' + (nxt['args'] or '')[:120]) if nxt else None,
                     'resultPaths': sorted(strict)[:8], 'nResults': len(strict), 'group': d0['group'], 'confidenceLine': (d0['output'] or '').split('\n')[1][:90] if len((d0['output'] or '').split('\n')) > 1 else ''})
    return rows


# ----------------------------------------------------------------------------------------------
# section F: trace / semantic / find usage
# ----------------------------------------------------------------------------------------------
def section_f(D, hks):
    rows = []
    flagrows = []
    for tool in ('ss-trace', 'ss-semantic', 'ss-find'):
        for hk in hks + ['ALL']:
            sel = [d for d in D if d['class'] == 'ss' and d['tool'] == tool and (hk == 'ALL' or d['hk'] == hk)]
            if not sel:
                continue
            kinds = Counter(d['outputKind'] for d in sel)
            known = [d for d in sel if d['outputKnown']]
            tk = [d['outputTokensEst'] for d in known]
            rows.append([tool, hk, len(sel), f"{kinds['empty']} ({pct(kinds['empty'], len(sel))})", f"{kinds['error'] + kinds['no-marker']} ({pct(kinds['error'] + kinds['no-marker'], len(sel))})",
                         f"{kinds['not-collected'] + kinds['unknown'] + kinds['empty-output'] + kinds['redirected']} ({pct(kinds['not-collected'] + kinds['unknown'] + kinds['empty-output'] + kinds['redirected'], len(sel))})",
                         int(median(tk)) if tk else '-', nearest_rank(tk, 0.9) if tk else '-', sum(tk)])
            fl = Counter()
            for d in sel:
                for f in set(d['flags']):
                    fl[f] += 1
            flagrows.append([tool, hk, len(sel), ', '.join(f'`{k}` {v}' for k, v in fl.most_common(8)) or '(none)'])
    # ss-trace outputs with no edges at all
    tr = [d for d in D if d['class'] == 'ss' and d['tool'] == 'ss-trace' and d['outputKind'] == 'ok']
    noedge = sum(1 for d in tr if 'fan-in=0 fan-out=0' in d['output'] or 'no stored call edges' in d['output'])
    f_extra = f'ss-trace outputs that found the symbol but hold no stored call edge ("fan-in=0 fan-out=0" or "no stored call edges"): {noedge} of {len(tr)} ({pct(noedge, len(tr))}).'
    return (f_extra + '\n\n' + md_table(['tool', 'harness', 'calls', 'empty result', 'error / no marker', 'no output seen (not collected, unknown, redirected, empty)', 'out tok median', 'out tok p90', 'out tok sum'], rows),
            md_table(['tool', 'harness', 'calls', 'flags used (calls with the flag)'], flagrows))


# ----------------------------------------------------------------------------------------------
# dataset summary
# ----------------------------------------------------------------------------------------------
def dataset_tables(D, T):
    out = []
    # harness x tool counts
    ss = [d for d in D if d['class'] == 'ss']
    tools = ('ss-search', 'ss-find', 'ss-grep', 'ss-read', 'ss-trace', 'ss-semantic', 'ss-batch')
    hks = order_hks(T)
    rows = []
    for hk in hks:
        ts = [t for t in T if t['hk'] == hk]
        c = Counter(d['tool'] for d in ss if d['hk'] == hk)
        solved = sum(1 for t in ts if t['solved'] is True)
        graded = sum(1 for t in ts if t['solved'] is not None)
        rows.append([hk, len(ts), f'{solved}/{graded}', sum(t['turns'] or 0 for t in ts), sum(c.values())] + [c[t] for t in tools])
    rows.append(['**all**', len(T), f"{sum(1 for t in T if t['solved'] is True)}/{sum(1 for t in T if t['solved'] is not None)}", sum(t['turns'] or 0 for t in T), len(ss)] + [sum(1 for d in ss if d['tool'] == t) for t in tools])
    out.append(md_table(['harness (model)', 'rollouts', 'solved', 'model turns (main thread)', 'ss-* calls'] + list(tools), rows))
    rows = []
    for hk in hks:
        ts = [t for t in T if t['hk'] == hk]
        rows.append([hk, len(ts)] + [pct(sum(1 for t in ts if t['ssCalls'].get(tool)), len(ts)) for tool in tools] + [pct(sum(1 for t in ts if t['ssCallsTotal'] == 0), len(ts))])
    out.append('Share of rollouts that call the tool at least once:\n\n' + md_table(['harness (model)', 'rollouts'] + list(tools) + ['no ss-* call at all'], rows))
    # group split
    rows = []
    for g in sorted({t['group'] for t in T}, key=lambda x: ['tg', 'hc', 'hsmoke'].index(x) if x in ('tg', 'hc', 'hsmoke') else 9):
        for hk in hks:
            ts = [t for t in T if t['hk'] == hk and t['group'] == g]
            if not ts:
                continue
            c = Counter(d['tool'] for d in ss if d['hk'] == hk and d['group'] == g)
            runs = len({t['run'] for t in ts})
            dates = sorted({(t['date'] or '')[:10] for t in ts})
            rows.append([g, hk, runs, len(ts), sum(c.values()), c['ss-search'], c['ss-find'], c['ss-grep'], c['ss-read'], c['ss-trace'], c['ss-semantic'], f'{dates[0]}..{dates[-1]}'])
    out.append(md_table(['group', 'harness (model)', 'run folders', 'rollouts', 'ss-* calls', 'search', 'find', 'grep', 'read', 'trace', 'semantic', 'dates'], rows))
    # variants
    rows = []
    vc = defaultdict(lambda: [0, 0, 0, Counter()])
    for t in T:
        k = (t['hk'], t['group'], t['variant'])
        vc[k][0] += 1
        vc[k][1] += 1 if t['solved'] is True else 0
        vc[k][2] += 1 if t['solved'] is not None else 0
        vc[k][3].update(t['ssCalls'])
    for k in sorted(vc, key=lambda k: (HK_ORDER.index(k[0]) if k[0] in HK_ORDER else 99, k[1], k[2])):
        n, s, g, c = vc[k]
        rows.append([k[0], k[1], f'`{k[2]}`', n, f'{s}/{g}', sum(c.values()), c['ss-search'], c['ss-find'], c['ss-grep'], c['ss-read'], c['ss-trace'], c['ss-semantic']])
    out.append(md_table(['harness (model)', 'group', 'variant (hc/hsmoke: harnessTrim [+rules placement]; tg: base / V1 / V1b)', 'rollouts', 'solved', 'ss-* calls', 'search', 'find', 'grep', 'read', 'trace', 'semantic'], rows))
    return out


# ----------------------------------------------------------------------------------------------
def main():
    D, U, T = load()
    hks = order_hks(T)
    first = first_call_study(D)
    os.makedirs(DATA, exist_ok=True)
    json.dump(first, open(os.path.join(DATA, 'first-call-success.json'), 'w'), indent=0)

    md = []
    w = md.append
    ds_tabs = dataset_tables(D, T)

    # headline numbers computed once, quoted in the conclusion
    ss = [d for d in D if d['class'] == 'ss']
    nss = len(ss)
    comp_s, res_s = comp_search(D, 'ss-search', hks, 'ss-search')
    comp_f, res_f = comp_search(D, 'ss-find', hks, 'ss-find')
    allres = res_s['ALL']
    code_pct = pctn(allres[2]['code_text'] + allres[2]['code_gutter'] + allres[2]['code_fence_markers'], allres[1])
    nocode_pct = pctn(allres[1] - sum(allres[2].get(k, 0) for k in ['code_text', 'code_gutter', 'code_fence_markers', 'imports', 'continuation_code']), allres[1])

    first_all = first
    first = [r for r in first_all if r['outcome'] != 'result-has-no-paths']
    n_first = len(first)
    n_succ = sum(1 for r in first if r['success'])
    lo, hi = wilson(n_succ, n_first)

    w('# ss-* tool forensics: STATS\n')
    w('Generated by `analyze_stats.py` from `build_dossiers.py` output. Every number is a count or ratio of counts. Do not edit by hand.\n')
    w('## Conclusion\n')
    w(f'- The data set holds {len(T)} rollouts and {nss:,} ss-* calls. Every call has its full output, the agent text around it, and the number of later model requests that re-read it.')
    hl = headline(D, U)
    ssamp = sum(hl['amp'].values())
    per_hk = ', '.join(f"{hk} {pctn(res_s[hk][1] - sum(res_s[hk][2].get(k, 0) for k in ['code_text', 'code_gutter', 'code_fence_markers', 'imports', 'continuation_code']), res_s[hk][1]):.1f}% (n={res_s[hk][0]})" for hk in hks if res_s[hk][1])
    w(f'- Non-code text is {nocode_pct:.1f}% of all ss-search output characters, pooled (headers, rank lines, summaries, related, same-file and trailer lines). Code lines are {code_pct:.1f}%. Per harness key: {per_hk}. Opus calls ss-search rarely, with the default or -k 5 (3.4 entries per output, 0.8 of them summaries). The other keys mostly ask for -k 8 or -k 10. Section B3 shows the effect of -k. See section B.')
    w(f"- {pct(hl['summary_entries'], hl['entries'])} of ss-search entries are summaries without code. Their summary line only restates the rank header, in {pct(hl['restate_chars'], hl['ss_search_chars'])} of all ss-search characters. See section C1.")
    w(f"- {pct(hl['dup_entries'], hl['entries'])} of ss-search entries repeat an earlier entry of the same output. The existing DEDUPE variant would remove {pct(hl['dedupe_drop'], hl['ss_search_chars'])} of the characters.")
    w(f"- Pooled over all harness keys, ss-read puts {pct(hl['amp']['ss-read'], hl['allamp'])} of all amplified tool-output tokens into the context, ss-search {pct(hl['amp']['ss-search'], hl['allamp'])}, ss-grep {pct(hl['amp']['ss-grep'], hl['allamp'])}, ss-find {pct(hl['amp']['ss-find'], hl['allamp'])}. See section A.")
    w(f'- The first ss-search call led to a read, edit or cite of one of its result paths, with no other search first, in {n_succ} of {n_first} rollouts ({100 * n_succ / max(n_first, 1):.1f}%, 95% interval {lo:.1f} to {hi:.1f}). See section E.')
    w('- Section A shows which tool puts the most amplified tokens into the context. Sections C and D show how much of ss-search and ss-find output repeats information.\n')
    w('Definitions used everywhere:\n')
    w('- `turnsRemaining` = number of later model requests in the same thread. Each of them re-reads the output from the cache.')
    w('- Tokens = ceil(chars / 4). Amplified tokens = tokens x (1 + turnsRemaining), as the brief defines it. The true count of re-reads is `turnsRemaining`, so this slightly over-counts the first read.')
    w('- A call is one ss-* command segment. One Bash command with `a; b` holds two calls. The output of the command is split by the printed header of each tool. Calls whose output cannot be split are flagged `outputKnown=false` and are left out of every size statistic.')
    w('- Scope: all rollouts of the sources listed in section 1 (tonight tg runs, hc runs of 2026-09-29/30, hsmoke runs of 2026-09-25/26). The hsmoke runs print the same output format (checked, see the validation notes).')
    w('- Harness keys: `claudecode-opus` = Claude Code + Opus 5.5. `claudecode-luna` = Claude Code with model gpt-5.6-luna (hsmoke only). `codex-luna` and `opencode-luna` = gpt-5.6-luna.\n')

    w('## 1. Data set\n')
    for t in ds_tabs:
        w(t + '\n')
    w('Notes: `solved` counts `resolved == true` of rows.json (graded rows only). Rollouts re-run after a degenerate result keep only the session that matches the final row (table `trajectories.jsonl`, field `notes`).\n')

    w('## A. Per harness x tool: calls, output size, amplified tokens\n')
    w(section_a(D, U, T, hks) + '\n')
    w('Rows in brackets are non-ss calls. Their size is exact only when the command held one output-producing segment. "all tool outputs (units)" sums every tool result of the harness (one record per model tool call) and is the denominator of "share of ALL amplified".\n')

    w('## B. ss-search output composition (characters)\n')
    w('Every character of each output is in exactly one row. Outputs used: ss-search, header found, output known, not piped through a filter.\n')
    w(comp_s + '\n')

    w('### B2. Same composition, weighted by the re-read count\n')
    w('Each output is weighted by 1 + turnsRemaining, so the table shows where the cache-read cost of ss-search output sits.\n')
    w(comp_weighted(D, 'ss-search', hks) + '\n')
    w('### B3. Composition by the -k the agent asked for (all harnesses pooled)\n')
    w(by_k(D, 'ss-search') + '\n')
    w('### B4. Do the source groups agree?\n')
    w(stability(D, first_all) + '\n')

    w('## C. Duplication inside ss-search outputs and across calls\n')
    w('### C1. Inside one ss-search output\n')
    w('"Dup entry" = a rank entry whose span lies inside an earlier entry of the same file, or that repeats an earlier entry\'s file and symbol. "DEDUPE variant" = what `SS_VARIANT_SEARCH_DEDUPE=1` removes: summary entries covered by an earlier entry, and summary lines that restate their header.\n')
    w(dup_search(D, 'ss-search', hks) + '\n')
    w('### C2. Across calls of one rollout (any ss-* tool that shows code)\n')
    t1, t2, t3 = cross_dup(D, hks)
    w(t1 + '\n')
    w('Pairs (which earlier call showed the lines that a later call shows again):\n')
    w(t2 + '\n')
    w(t3 + '\n')

    w('## D. ss-find output (same analysis)\n')
    w('The printer of ss-find (`cmdFind`) uses the same entry format as ss-search with the header `# ss-find: ColGrep N for "q" /regex/ ...` and no route trailer.\n')
    w(comp_f + '\n')
    w('Duplication inside ss-find outputs:\n')
    w(dup_search(D, 'ss-find', hks) + '\n')

    w('## E. First-call success of ss-search\n')
    w('For the first ss-search call of each rollout (main thread): did the next retrieval or edit action use a path from the result, without another search first?\n')
    w('- Success = the next read/edit call (ss-read, ss-semantic, Read, cat/sed, Edit, apply_patch) touches a path named in a rank header of the result, with no search call (ss-search, ss-find, ss-grep, ss-trace, native grep/find/Glob) before it. A rollout that ends with no further call is a success when its final text names a result path.')
    w('- "Loose" also accepts any path-like token of the result output (related lines, same-file lines).\n')
    oc = Counter(r['outcome'] for r in first_all)
    rows = [[k, v, pct(v, n_first) if k != 'result-has-no-paths' else '(excluded from the rates)'] for k, v in sorted(oc.items(), key=lambda x: -x[1])]
    w(f'Rollouts with a first ss-search: {len(first_all)}. Of them {len(first_all) - n_first} had a result with no rank-header path (empty result or error); the rates below use the other {n_first}.\n')
    w(md_table(['outcome', 'rollouts', 'share'], rows) + '\n')
    stp = sum(1 for r in first if r['sameTurnSearch'])
    w(f'In {stp} of {n_first} rollouts ({pct(stp, n_first)}) the first ss-search was issued in the same model response as another search call. Those searches are not informed by its result; they are not counted as "searched again": only calls of LATER model responses count.\n')
    rows = []
    for hk in hks + ['ALL']:
        sel = [r for r in first if hk == 'ALL' or r['hk'] == hk]
        if not sel:
            continue
        k = sum(1 for r in sel if r['success'])
        kl = sum(1 for r in sel if r['successLoose'])
        lo, hi = wilson(k, len(sel))
        fr = [r for r in sel if r['firstRetrieval']]
        kf = sum(1 for r in fr if r['success'])
        sv = [r for r in sel if r['solved'] is True]
        ns = [r for r in sel if r['solved'] is False]
        rows.append([hk, len(sel), f'{k} ({pct(k, len(sel))})', f'{lo:.1f}-{hi:.1f}', f'{kl} ({pct(kl, len(sel))})', f'{kf}/{len(fr)} ({pct(kf, len(fr))})',
                     f"{sum(1 for r in sv if r['success'])}/{len(sv)} ({pct(sum(1 for r in sv if r['success']), len(sv))})",
                     f"{sum(1 for r in ns if r['success'])}/{len(ns)} ({pct(sum(1 for r in ns if r['success']), len(ns))})"])
    w(md_table(['harness', 'rollouts with an ss-search', 'success (strict)', '95% Wilson interval (%)', 'success (loose)', 'success when it was also the first retrieval call', 'success in solved rollouts', 'success in unsolved rollouts'], rows) + '\n')
    w(f'All ids with their outcome are in `first-call-ids.md` (same folder) and `data/results/final-tuning-forensics/first-call-success.json` (also holds the next call and the result paths) for the verification swarm.\n')

    w('## F. ss-trace, ss-semantic, ss-find: use, empty results, flags, size\n')
    ft, ff = section_f(D, hks)
    w(ft + '\n')
    w('Flags used:\n')
    w(ff + '\n')

    w('## G. Extra: ss-read and ss-grep composition\n')
    w('### ss-read (gutter is printed only for reads of 15 lines or more; codex prints none)\n')
    w(comp_simple(D, 'ss-read', P.parse_read, hks, [('header_meta', 'header `# ss-read file (lines a-b of N)`'), ('code_fence_markers', 'fence marker lines'), ('code_gutter', 'line-gutter chars'), ('code_text', 'code chars'), ('read_notes', 'unread above/below notes'), ('blank', 'blank'), ('other', 'other')]) + '\n')
    w('### ss-grep\n')
    w(comp_simple(D, 'ss-grep', P.parse_grep, hks, [('header_meta', 'header `# ss-grep:`'), ('truncation_note', 'truncation note'), ('hidden_files_note', '`# +N more file(s)` note'), ('regex_note', '`regex note:` line'), ('match_path', 'match lines: path'), ('match_lineno_sep', 'match lines: `:line: ` separator'), ('match_text', 'match lines: matched text'), ('sibling_line', '`# same file (siblings of ...)`'), ('family_manifest', '`# indexed family:`'), ('no_matches', '`(no matches)`'), ('hidden_or_scope_note', 'hidden / scope notes'), ('blank', 'blank'), ('other', 'other')]) + '\n')

    # validation: automatic checks + hand notes
    w('## Validation\n')
    chk = Counter()
    for t in T:
        chk[(t['harness'], 'turns == turns-file meta', t['turnsMatchMeta'])] += 1
        chk[(t['harness'], 'units == rows.calls', (t['cmdsCount'] if t['harness'] == 'codex' else t['units']) == t['rowCalls'])] += 1
    rows = []
    for h in ('claudecode', 'codex', 'opencode'):
        a, b = chk[(h, 'turns == turns-file meta', True)], chk[(h, 'turns == turns-file meta', False)]
        c, d_ = chk[(h, 'units == rows.calls', True)], chk[(h, 'units == rows.calls', False)]
        rows.append([h, f'{a}/{a + b}', f'{c}/{c + d_}'])
    w(md_table(['harness', 'my request count == turns file `turns`', 'my tool-call count == rows.json `calls` (codex: count of exec_command commands)'], rows) + '\n')
    bc = Counter()
    for d in ss:
        bc[(d['hk'], d['boundary'])] += 1
    rows = []
    for hk in hks:
        n = sum(v for (h, b), v in bc.items() if h == hk)
        rows.append([hk, n] + [f"{bc[(hk, b)]} ({pct(bc[(hk, b)], n)})" for b in ('exact', 'trimmed', 'heuristic', 'ambiguous', 'single-nomarker', 'piped-filtered', 'ambiguous-error', 'piped-unknown', 'unmatched')])
    w('Output split quality of ss-* calls (`exact` = the markers of all ss tools of the command matched in order; `trimmed` = tail of the last ss tool cut at its known end because other commands followed; `ambiguous` = markers did not align one to one; `unmatched` / `piped-unknown` = the output of the call cannot be found and is excluded from size statistics):\n')
    w(md_table(['harness', 'ss calls', 'exact', 'trimmed', 'heuristic', 'ambiguous', 'single, no marker (error text)', 'piped-filtered', 'ambiguous-error', 'piped-unknown', 'unmatched'], rows) + '\n')
    try:
        import validate as V
        res1, bad1 = V.v1_alignment(D)
        n1 = sum(sum(r.values()) for r in res1.values())
        ok1 = sum(v for r in res1.values() for (b, okk), v in r.items() if okk)
        by_b = Counter()
        for r in res1.values():
            for (b, okk), v in r.items():
                by_b[(b, okk)] += v
        agree, diffs = V.v2_independent_count(D)
        w('Automatic checks against the raw sources (`validate.py`, rerun on every build):\n')
        w(f"- V1, header/args alignment: the header an ss-* tool prints names the file, pattern or query of the command it was assigned to. {ok1} of {n1} calls pass ({pct(ok1, n1)}). By split quality: " + ', '.join(f'{b} {by_b[(b, True)]}/{by_b[(b, True)] + by_b[(b, False)]}' for b in ('exact', 'trimmed', 'heuristic', 'ambiguous', 'piped-filtered') if by_b[(b, True)] + by_b[(b, False)]) + '. The failures of `exact` are command arguments the check cannot read (a shell variable `$F`, a flag before the pattern). The failures of `piped-filtered` are expected: a pipe removed the header.')
        w(f"- V2, independent call count: a plain regex over the raw command text counts the ss-* tokens that start a command. It equals the parser count for every ss tool in {sum(v for (h, s), v in agree.items() if s)} of {sum(agree.values())} rollouts.")
        w(f"- V3, `turnsRemaining` lies in [0, turnsTotal - 1] for every record: {V.v3_amp(D)} violations.\n")
    except Exception as e:  # keep the report building even if the raw sources moved
        w(f'(automatic checks V1 to V3 could not run: {e})\n')
    if os.path.exists(VALIDATION_MD):
        w(open(VALIDATION_MD).read() + '\n')
    else:
        w('(VALIDATION-NOTES.md not written yet)\n')

    open(OUT_MD, 'w').write('\n'.join(md))

    # ids file
    L = ['# First ss-search call of each rollout: outcome and id (for the verification swarm)\n',
         'Generated by `analyze_stats.py`. `success` = next read/edit used a rank-header path with no other search first (see STATS.md section E).\n']
    for outc in sorted(oc, key=lambda k: -oc[k]):
        L.append(f'\n## {outc} ({oc[outc]})\n')
        for r in sorted((r for r in first_all if r['outcome'] == outc), key=lambda r: r['id']):
            L.append(f"- `{r['id']}` [{r['hk']}] solved={r['solved']} results={r['nResults']} next={'`' + r['nextCall'] + '`' if r['nextCall'] else '-'}")
    open(OUT_IDS, 'w').write('\n'.join(L) + '\n')
    print('wrote', OUT_MD, OUT_IDS, file=sys.stderr)


if __name__ == '__main__':
    main()
