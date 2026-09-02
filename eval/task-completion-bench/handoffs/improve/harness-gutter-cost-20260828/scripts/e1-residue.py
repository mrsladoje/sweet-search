#!/usr/bin/env python3
"""E1 item 2 — gutter residue over EVERY edit payload (not only the failed ones), and the
carry-rate denominators split by the indentation style of the repo being edited.

Residue = a line inside an old_string / apply_patch hunk that still begins with a line
number and a delimiter: ^\\d+\\t, ^\\d+\\| , ^\\d+: .

Read-only. Writes /tmp/fp-inv/e1/residue.json.
"""
import json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, '/tmp/fp-inv/e1')
from e1_common import (R, cells, transcripts, PARSERS, turn_costs, edit_kind, anchors_of,
                       classify_failure, golden_for, pool)

OUT = '/tmp/fp-inv/e1'
RES_TAB = re.compile(r'^\s*\d+\t')
RES_PIPE = re.compile(r'^\s*\d+\| ')
RES_COLON = re.compile(r'^\s*\d+: ')
TAB_REPOS = {'celestiaorg__nmt-192', 'apigee__registry-961', 'devlooped__moq-1262'}


def main():
    per = collections.defaultdict(lambda: collections.Counter())
    hits = []
    for c in cells():
        h, arm, form, task, run, cell = c['harness'], c['arm'], c['form'], c['task'], c['run'], c['cell']
        key = f'{h}|{arm}|{form}'
        tl = transcripts(run, h, cell)
        if not tl:
            continue
        parsed = []
        for main_p, subs in tl:
            ev, turns = PARSERS[h](main_p)
            cost = sum(x['usd'] for x in turn_costs(turns))
            allev = list(ev)
            for s in subs:
                se, st = PARSERS[h](s)
                cost += sum(x['usd'] for x in turn_costs(st))
                allev += se
            parsed.append((cost, allev, main_p))
        parsed.sort(key=lambda x: -x[0])
        for cost, ev, path in parsed[:3]:
            for e in ev:
                if e['kind'] != 'result':
                    continue
                ek = edit_kind(h, e)
                if not ek:
                    continue
                tags, failed = classify_failure(h, e, ek)
                bucket = 'tab-indented-repo' if task in TAB_REPOS else 'space-indented-repo'
                per[key]['edits'] += 1
                per[key]['edits@' + bucket] += 1
                if failed:
                    per[key]['failed'] += 1
                    per[key]['failed@' + bucket] += 1
                for (fp, anchor, hdr, raw) in anchors_of(h, e, ek):
                    per[key]['anchors'] += 1
                    per[key]['anchor_lines'] += len(anchor)
                    for ln in anchor:
                        if RES_TAB.match(ln):
                            per[key]['residue:^N<TAB>'] += 1
                            hits.append({'k': key, 'task': task, 'file': fp, 'line': ln[:160],
                                         'failed': failed, 'transcript': path.replace(R + '/', '')})
                        elif RES_PIPE.match(ln):
                            per[key]['residue:^N| '] += 1
                            hits.append({'k': key, 'task': task, 'file': fp, 'line': ln[:160],
                                         'failed': failed, 'transcript': path.replace(R + '/', '')})
                        elif RES_COLON.match(ln):
                            per[key]['residue:^N: '] += 1
                            hits.append({'k': key, 'task': task, 'file': fp, 'line': ln[:160],
                                         'failed': failed, 'transcript': path.replace(R + '/', '')})
    print(f"{'cell':26s} {'edits':>6s} {'anchors':>8s} {'anchorLines':>12s} {'^N<TAB>':>8s} {'^N| ':>7s} {'^N: ':>7s}")
    for k in sorted(per):
        S = per[k]
        print(f"{k:26s} {S['edits']:6d} {S['anchors']:8d} {S['anchor_lines']:12d} "
              f"{S['residue:^N<TAB>']:8d} {S['residue:^N| ']:7d} {S['residue:^N: ']:7d}")
    print('\n== edits and failures split by the indentation style of the repo')
    for k in sorted(per):
        S = per[k]
        print(f"  {k:26s} tab-repos {S['failed@tab-indented-repo']}/{S['edits@tab-indented-repo']}   "
              f"space-repos {S['failed@space-indented-repo']}/{S['edits@space-indented-repo']}")
    print(f'\n== residue hits: {len(hits)}')
    for x in hits[:40]:
        print('  ', x)
    json.dump({'per': {k: dict(v) for k, v in per.items()}, 'hits': hits},
              open(os.path.join(OUT, 'residue.json'), 'w'), default=str)
    print('\nwrote', os.path.join(OUT, 'residue.json'))


if __name__ == '__main__':
    main()
