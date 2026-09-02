#!/usr/bin/env python3
"""E4 - zero-hit ss-grep: how many are caused by POSIX BRE alternation, and does the hint fire?"""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse

tot = 0; zero = 0; bre_zero = 0; hint = 0; hint_zero = 0; bre_all = 0
rz = set(); rb = set()
ex = []
harn = collections.Counter()
for t, arm, rep, row, run, rd in rollouts():
    ev = parse(ndjson_path(row, rd))
    for e in ev:
        if e["k"] != "tool": continue
        if arm != "native" and e["tool"] in ("read", "grep", "glob", "list"):
            harn[e["tool"]] += 1
        if e["tool"] != "bash": continue
        cmd = e.get("cmd") or ""
        if "ss-grep" not in cmd: continue
        out = e.get("output") or ""
        for m in re.finditer(r"# ss-grep: (\d+) total match\(es\) for /(.*?)/", out):
            tot += 1
            n = int(m.group(1)); pat = m.group(2)
            isbre = r"\|" in pat
            if isbre: bre_all += 1
            if n == 0:
                zero += 1; rz.add((t, arm, rep))
                if isbre:
                    bre_zero += 1; rb.add((t, arm, rep))
                    if len(ex) < 6: ex.append({"task": t, "arm": arm, "rep": rep, "pat": pat[:130],
                                               "hint": "regex note" in out, "out": out[:260]})
            if "regex note" in out: hint += 1
print("ss-grep result headers parsed:", tot)
print("zero-hit:", zero, "(%.1f%%)" % (100*zero/max(1,tot)), " in", len(rz), "rollouts")
print("patterns using POSIX BRE alternation \\| :", bre_all, "  of which zero-hit:", bre_zero, " in", len(rb), "rollouts")
print("outputs carrying the dialect hint:", hint)
print("sweet-arm harness-native tool calls:", dict(harn))
for e in ex: print("  ", json.dumps(e)[:400])
