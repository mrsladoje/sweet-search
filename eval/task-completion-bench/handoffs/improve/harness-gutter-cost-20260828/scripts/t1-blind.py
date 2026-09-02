#!/usr/bin/env python3
"""Verify the blind-edit null: how many edits/anchors were actually tested against a
deleted span, and how many anchors were never shown at all?"""
import json, os, re, sys, collections
sys.path.insert(0, '/tmp/fp-inv/e1')
sys.path.insert(0, '/tmp/fp-inv/trunc')
from e1_common import (R, pool, transcripts, events_codex, edit_kind, anchors_of,
                       golden_for, resolve_path, strip_gutter)
from t1_shim import CELLS
import importlib.util
spec = importlib.util.spec_from_file_location('t1c', '/tmp/fp-inv/trunc/t1-census.py')
t1c = importlib.util.module_from_spec(spec); spec.loader.exec_module(t1c)

cnt = collections.Counter()
cache = {}
P = pool()
for arm, form, run in CELLS:
    key = f'{arm}|{form}'
    for task in P:
        gold = golden_for(task)
        parsed = []
        for p, _ in transcripts(run, 'codex', f'{task}-{arm}'):
            ev, turns = events_codex(p)
            parsed.append((sum(x['usd'] for x in t1c.turn_costs(turns)), p, ev))
        parsed.sort(key=lambda x: -x[0])
        for _c, p, ev in parsed[:3]:
            results = [e for e in ev if e['kind'] == 'result']
            shown = set()
            for e in results:
                for l in (e.get('output') or '').split('\n'):
                    s = strip_gutter(l).strip()
                    if s:
                        shown.add(s)
            spans = []
            for i, e in enumerate(results):
                out = e.get('output') or ''
                if not t1c.TRUNC_WARN.search(out):
                    continue
                cands = [t[0] for t in t1c.read_targets(str((e.get('input') or {}).get('cmd') or ''))]
                for m in t1c.MARK.finditer(out):
                    r = t1c.resolve_marker(out, m, gold, cache, cands)
                    if r.get('file') and r.get('lo') is not None and r.get('hi') is not None:
                        spans.append((r['file'], r['lo'], r['hi']))
            cnt[key + ':spans'] += len(spans)
            for e in ev:
                if e['kind'] != 'result':
                    continue
                ek = edit_kind('codex', e)
                if not ek:
                    continue
                cnt[key + ':edits'] += 1
                for (fp, anchor, hdr, raw) in anchors_of('codex', e, ek):
                    gl = t1c.golden_lines(gold, fp, cache)
                    cnt[key + ':anchors'] += 1
                    if not gl:
                        cnt[key + ':anchors-no-golden'] += 1
                        continue
                    for a in anchor:
                        s = a.strip()
                        if len(s) < 8:
                            continue
                        cnt[key + ':anchor-lines'] += 1
                        if s in shown:
                            continue
                        cnt[key + ':anchor-lines-NEVER-SHOWN'] += 1
                        pos = [i + 1 for i, l in enumerate(gl) if l.strip() == s]
                        if not pos:
                            cnt[key + ':never-shown-absent-from-golden'] += 1
                            continue
                        hit = any(t1c.same_file(sf, fp) and any(lo <= q <= hi for q in pos)
                                  for (sf, lo, hi) in spans)
                        cnt[key + (':never-shown-IN-DELETED-SPAN' if hit
                                   else ':never-shown-not-in-span')] += 1
for k in sorted(cnt):
    print('%6d  %s' % (cnt[k], k))
