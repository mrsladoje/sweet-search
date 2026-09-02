#!/usr/bin/env python3
"""E1 supporting measurements.

(a) codex's own token count for the SAME `ss-read <file> <start> <end>` command run under
    two or three gutter forms — the price of the delimiter in this run's own data.
(b) indentation exposure: how much of each pool repo is tab-indented (the TAB carry can
    only fire where the file's own indent is a tab, because then nothing marks the
    boundary between the gutter tab and the content tabs).
(c) codex never-shown failed anchors vs middle-out truncated spans.

Read-only. Writes /tmp/fp-inv/e1/extras.json.
"""
import json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import (R, GOLDEN, cells, transcripts, PARSERS, turn_costs, edit_kind, cmd_of,
                       surface_of, golden_for, pool)

OUT = '/tmp/fp-inv/e1'
SSREAD_EXACT = re.compile(r"^\s*ss-read\s+(\S+)\s+(\d+)\s+(\d+)\s*$")
TOKCOUNT = re.compile(r'Original token count: (\d+)')
CODE_EXT = ('.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.go', '.java', '.rb', '.cs',
            '.php', '.cpp', '.cc', '.c', '.h', '.hpp', '.ex', '.exs', '.jam', '.kt', '.rs',
            '.scala', '.swift', '.R', '.r', '.sol', '.m', '.el')


def token_cost_by_form():
    """cmd -> {form: min reported token count}"""
    tok = collections.defaultdict(dict)
    for c in cells():
        if c['harness'] != 'codex' or c['arm'] != 'sweet':
            continue
        for main, _ in transcripts(c['run'], 'codex', c['cell']):
            ev, _t = PARSERS['codex'](main)
            for e in ev:
                if e['kind'] != 'result':
                    continue
                cmd = cmd_of('codex', e)
                m = SSREAD_EXACT.match(cmd)
                if not m:
                    continue
                mt = TOKCOUNT.search(e.get('output') or '')
                if not mt:
                    continue
                key = c['task'] + ' :: ' + cmd.strip()
                prev = tok[key].get(c['form'])
                v = int(mt.group(1))
                tok[key][c['form']] = v if prev is None else min(prev, v)
    return tok


def indent_exposure():
    out = {}
    for t in pool():
        g = golden_for(t)
        if not g:
            out[t] = None
            continue
        tabs = spaces = files = 0
        for root, dirs, files_ in os.walk(g):
            dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', 'vendor', 'dist', 'build')]
            for f in files_:
                if not f.endswith(CODE_EXT):
                    continue
                p = os.path.join(root, f)
                try:
                    txt = open(p, encoding='utf8', errors='replace').read(200000)
                except Exception:
                    continue
                files += 1
                for ln in txt.split('\n'):
                    if ln[:1] == '\t':
                        tabs += 1
                    elif ln[:1] == ' ':
                        spaces += 1
        out[t] = {'files': files, 'tab_indented_lines': tabs, 'space_indented_lines': spaces,
                  'tab_share': round(tabs / max(1, tabs + spaces), 4)}
    return out


def never_shown_vs_truncation():
    """codex: does a failed anchor the trace never showed sit inside a middle-out gap?"""
    rows = []
    cen = json.load(open(os.path.join(OUT, 'census.json')))
    ns = [c for c in cen['cases'] if c['harness'] == 'codex' and not c.get('prov')]
    by = collections.defaultdict(list)
    for c in ns:
        by[c['transcript']].append(c)
    for tpath, group in by.items():
        full = os.path.join(R, tpath)
        if not os.path.isfile(full):
            continue
        ev, _t = PARSERS['codex'](full)
        gaps = []
        for e in ev:
            if e['kind'] != 'result':
                continue
            out = e.get('output') or ''
            if 'tokens truncated' not in out:
                continue
            nums = [int(x) for x in re.findall(r'^\s*(\d+)\t', out, re.M)]
            if len(nums) >= 2:
                prev = nums[0]
                for n in nums[1:]:
                    if n > prev + 1:
                        gaps.append((surface_of('codex', e), prev, n))
                    prev = n
        for c in group:
            rows.append({'transcript': tpath, 'task': c['task'], 'arm': c['arm'], 'form': c['form'],
                         'anchor': c['anchor_head'][:1], 'gaps_in_this_rollout': len(gaps),
                         'gap_sample': gaps[:3]})
    return rows


def main():
    tok = token_cost_by_form()
    multi = {k: v for k, v in tok.items() if len(v) >= 2}
    print(f'== (a) identical ss-read commands seen under >=2 forms: {len(multi)} of {len(tok)}')
    ratios = collections.defaultdict(list)
    for k, v in sorted(multi.items()):
        print('  ' + '  '.join(f'{f}={v[f]}' for f in sorted(v)) + '   ' + k[:110])
        if 'none' in v:
            for f in ('tab', 'pipe'):
                if f in v:
                    ratios[f].append(v[f] / max(1, v['none']))
        if 'tab' in v and 'pipe' in v:
            ratios['pipe/tab'].append(v['pipe'] / max(1, v['tab']))
    for f, vals in ratios.items():
        print(f'  mean ratio {f} over n={len(vals)}: {sum(vals)/len(vals):.4f}')

    ind = indent_exposure()
    print('\n== (b) tab-indentation exposure per pool repo (golden checkout)')
    for t, v in sorted(ind.items(), key=lambda x: -(x[1]['tab_share'] if x[1] else 0)):
        if not v:
            print(f'  {t:45s} NO GOLDEN')
            continue
        print(f"  {t:45s} files={v['files']:5d} tab-indented-lines={v['tab_indented_lines']:7d} "
              f"space={v['space_indented_lines']:7d} tab-share={v['tab_share']:.3f}")

    ns = never_shown_vs_truncation()
    print(f'\n== (c) codex never-shown failed anchors: {len(ns)}')
    for r in ns:
        print(f"  {r['form']:5s} {r['task']:42s} gaps-in-this-rollout={r['gaps_in_this_rollout']:3d} "
              f"anchor={str(r['anchor'])[:90]}")
    json.dump({'token_by_form': {k: v for k, v in multi.items()}, 'indent': ind,
               'never_shown': ns}, open(os.path.join(OUT, 'extras.json'), 'w'), default=str)
    print('\nwrote', os.path.join(OUT, 'extras.json'))


if __name__ == '__main__':
    main()
