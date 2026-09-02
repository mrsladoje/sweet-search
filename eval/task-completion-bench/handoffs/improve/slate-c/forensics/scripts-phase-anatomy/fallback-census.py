#!/usr/bin/env python3
"""fallback-census.py -- ss-semantic outputs marked [FALLBACK] and ss-read/ss-semantic on excluded files, all sweet rollouts."""
import sys, os, json, re, collections, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("dc", os.path.join(HERE, "dotfile-census.py"))
# dotfile-census runs at import; reuse its loader by exec of the function defs only
src = open(os.path.join(HERE, "dotfile-census.py")).read().split("tot = collections.defaultdict")[0]
ns = {"__file__": os.path.join(HERE, "dotfile-census.py")}
exec(compile(src, "dc", "exec"), ns)
pa, load_calls = ns["pa"], ns["load_calls"]
tot = collections.Counter(); ex = []
for harness in ("codex", "opencode", "claude-code"):
    rows, _ = pa.load_rows(harness)
    for row in rows:
        if row["arm"] != "sweet":
            continue
        for c in load_calls(harness, row):
            cmd = c["in"] if harness == "codex" else (json.loads(c["in"]).get("command", "") if c["tool"] in ("bash", "Bash") else "")
            if not cmd or "ss-semantic" not in cmd:
                continue
            n_sem = len(re.findall(r"(^|[\s;&|(`])ss-semantic\b", cmd))
            tot[(harness, "ss-semantic calls")] += n_sem
            fb = len(re.findall(r"\[FALLBACK\]", c["out"]))
            if fb:
                tot[(harness, "FALLBACK outputs")] += fb
                m = re.search(r"# ss-semantic (\S+) \|", c["out"])
                spans = re.findall(r"### \S+:(\d+)-(\d+)", c["out"])
                whole = sum(1 for a, b in spans if int(a) <= 1 and int(b) - int(a) > 2000)
                tot[(harness, "FALLBACK whole-file spans (>2000 lines from line 1)")] += whole
                ex.append((harness, row["taskId"], row["rep"], m.group(1) if m else "?", len(c["out"]), spans[:2]))
print("ss-semantic census over all sweet rollouts (66 per harness):")
for k in sorted(tot):
    print(" ", k, tot[k])
print("FALLBACK examples (harness, task, rep, file, out bytes, spans):")
for e in ex[:30]:
    print(" ", e)
