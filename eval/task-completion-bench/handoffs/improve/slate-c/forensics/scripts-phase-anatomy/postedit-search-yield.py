#!/usr/bin/env python3
"""postedit-search-yield.py -- do post-first-edit SEARCH/READ requests lead anywhere? For every request after the first edit
whose class is search or read, check whether a LATER edit request in the same rollout touches a file not yet edited before
that request (the probe 'found new work') or the same file (re-edit). Solved-everywhere rollouts, both arms."""
import json, os, sys, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from aggregate import mean
d = json.load(open(os.path.join(HERE, 'data', 'anatomy.json')))
for h, H in d['harnesses'].items():
    for arm in ('native', 'sweet'):
        rs = [r for r in H['rollouts'] if r['arm'] == arm]
        n_probe = n_newfile = n_reedit = n_noedit = 0; cost = 0.0
        for r in rs:
            fe = r['marks']['first_edit']
            if fe is None:
                continue
            reqs = r['requests']
            for q in reqs:
                if q['i'] < fe or q['class'] not in ('search', 'read'):
                    continue
                n_probe += 1; cost += q['cost']
                edited_before = set()
                for p in reqs[:q['i']]:
                    edited_before |= set(p['edit_paths'])
                later_edits = [p for p in reqs[q['i'] + 1:] if p['class'] == 'edit']
                later_files = set()
                for p in later_edits:
                    later_files |= set(p['edit_paths'])
                if later_files - edited_before:
                    n_newfile += 1
                elif later_files:
                    n_reedit += 1
                else:
                    n_noedit += 1
        n = len(rs)
        print(f"{h:12s} {arm:6s}: post-first-edit search/read requests {n_probe/n:.2f}/rollout (cost {cost/n:.6f}); followed by an edit of a NEW file {n_newfile/n:.2f}, by a re-edit of an already-edited file {n_reedit/n:.2f}, by no further edit {n_noedit/n:.2f}  [{n_newfile}/{n_reedit}/{n_noedit} of {n_probe}]")
