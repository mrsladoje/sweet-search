#!/usr/bin/env python3
"""E4 - ss-grep / ss-find regex crash census, plus the BRE alternation bug."""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse, ss_tools

crash = []
usage = []
zero = []
tot = collections.Counter()
for t, arm, rep, row, run, rd in rollouts():
    if arm == "native": continue
    ev = parse(ndjson_path(row, rd))
    for e in ev:
        if e["k"] != "tool" or e["tool"] != "bash": continue
        cmd = e.get("cmd") or ""
        tl = ss_tools(cmd)
        if not tl: continue
        out = e.get("output") or ""
        for tool in set(tl): tot[tool] += 1
        if "[ss-*] crash" in out:
            m = re.search(r"\[ss-\*\] crash: (.*?)\n(?:\s{4}(.*)\n)?", out, re.S)
            crash.append({"task": t, "arm": arm, "rep": rep, "cmd": cmd, "err": out[out.index("[ss-*] crash"):][:420],
                          "bre": r"\|" in cmd})
        if "argument(s) not consumed" in out or "unrecognised option" in out:
            usage.append({"task": t, "arm": arm, "rep": rep, "cmd": cmd, "out": out[:260]})
# zero-hit ss-grep: successful call whose body has no path:line lines
zero_ct = 0; zero_ex = []
zero_roll = set()
for t, arm, rep, row, run, rd in rollouts():
    if arm == "native": continue
    ev = parse(ndjson_path(row, rd))
    for e in ev:
        if e["k"] != "tool" or e["tool"] != "bash": continue
        cmd = e.get("cmd") or ""
        if "ss-grep" not in cmd: continue
        out = (e.get("output") or "")
        exitc = (e.get("meta") or {}).get("exit")
        if str(exitc) != "0": continue
        body = out
        if re.search(r"(?m)^\s*(#|##)?\s*\S+:\d+", body): continue
        if re.search(r"(?m)^\d+\s", body): continue
        if re.search(r"matches|results|hits", body, re.I) and re.search(r"[1-9]", body): pass
        zero_ct += 1; zero_roll.add((t, arm, rep))
        if len(zero_ex) < 6: zero_ex.append({"task": t, "arm": arm, "rep": rep, "cmd": cmd[:200], "out": out[:400]})
print("ss-* call totals:", dict(tot))
print("\nENGINE CRASH (ripgrep/other) calls:", len(crash), " rollouts:", len(set((c['task'],c['arm'],c['rep']) for c in crash)))
print("  of which the pattern used POSIX BRE alternation \\|:", sum(1 for c in crash if c["bre"]))
for c in crash:
    print("   %-42s %-5s rep%s bre=%s :: %s" % (c["task"], c["arm"], c["rep"], c["bre"], c["cmd"][:120]))
print("\nCLI USAGE REJECTIONS:", len(usage), "rollouts:", len(set((c['task'],c['arm'],c['rep']) for c in usage)))
for c in usage: print("   %-42s %-5s rep%s :: %s" % (c["task"], c["arm"], c["rep"], c["cmd"][:130]))
print("\nZERO-HIT ss-grep (exit 0, no path:line body):", zero_ct, "in", len(zero_roll), "rollouts")
for e in zero_ex: print("   ", e["task"], e["arm"], "rep%s" % e["rep"], "::", e["cmd"], "->", repr(e["out"][:150]))
json.dump({"crash": crash, "usage": usage, "zero": zero_ex}, open("/tmp/fp-inv/e4-opencode/grepcrash.json", "w"), indent=1)
