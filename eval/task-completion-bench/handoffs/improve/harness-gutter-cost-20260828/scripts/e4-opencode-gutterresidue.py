#!/usr/bin/env python3
"""E4 - gutter residue and +1-space carry in opencode apply_patch hunks (264 rollouts)."""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse
from bundle import spec

GOLD = "/root/.ss-eval/golden"
RESIDUE = [ (re.compile(r"(?m)^[ +-]\s*\d+\t"), "N<TAB> residue"),
            (re.compile(r"(?m)^[ +-]\s*\d+\| "), "N| residue"),
            (re.compile(r"(?m)^[ +-]\s*\d+: "), "N: residue") ]
edits = 0; fails = 0; residue = collections.Counter(); failrolls = collections.defaultdict(set)
plus1 = collections.Counter(); ex = []
failex = []
for t, arm, rep, row, run, rd in rollouts():
    s = spec(t)
    gd = os.path.join(GOLD, s["repo"].replace("/", "__") + "@" + s["base_commit"])
    for e in parse(ndjson_path(row, rd)):
        if e["k"] != "tool" or e["tool"] != "apply_patch": continue
        pt = (e.get("input") or {}).get("patchText") or ""
        out = e.get("output") or ""
        edits += 1
        for rx, name in RESIDUE:
            if rx.search(pt): residue[(name, arm)] += 1
        bad = e["status"] != "completed" or "Success" not in out
        if not bad: continue
        fails += 1; failrolls[arm].add((t, arm, rep))
        # for a failed hunk: does the same text with one fewer leading space exist in base?
        m = re.search(r"\*\*\* Update File: (\S+)", pt)
        rel = re.sub(r"^.*?/runs/[^/]+/", "", m.group(1)) if m else None
        fp = os.path.join(gd, rel) if rel else None
        base = open(fp, errors="replace").read() if fp and os.path.exists(fp) else None
        kind = "unknown"
        if base:
            ctx = [l[1:] for l in pt.split("\n") if l[:1] in (" ", "-") and l[1:].strip()]
            if ctx:
                first = ctx[0]
                if first in base: kind = "text-present(order/ambiguity)"
                elif first.lstrip() and (" " + first) in base: kind = "MINUS-1-space"
                elif first.startswith(" ") and first[1:] in base: kind = "PLUS-1-space"
                elif first.strip() and first.strip() in base: kind = "whitespace-other"
                else: kind = "text-absent(paraphrase/own-insert)"
        plus1[(kind, arm)] += 1
        if len(failex) < 14:
            failex.append({"task": t, "arm": arm, "rep": rep, "kind": kind,
                           "err": out[:220], "firstCtx": repr((ctx[0] if base and ctx else ""))[:120]})
print("apply_patch calls:", edits, " failed:", fails)
print("gutter residue inside a patch body:", dict(residue) or "NONE")
print("\nfailed-edit classification (kind, arm) -> count:")
for k, v in sorted(plus1.items(), key=lambda x: -x[1]): print("  %-38s %-6s %d" % (k[0], k[1], v))
print("\nrollouts with >=1 failed edit:", {a: len(v) for a, v in failrolls.items()})
for e in failex: print("  ", json.dumps(e)[:400])
