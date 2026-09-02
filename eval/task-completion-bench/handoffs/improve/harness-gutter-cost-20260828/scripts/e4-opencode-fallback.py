#!/usr/bin/env python3
"""E4 item 3 - native-tool fallback after an ss-* call, on a path/symbol the ss-* call just returned."""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse, ss_tools

PATH = re.compile(r"\b([\w][\w./-]*\.[A-Za-z0-9_]{1,6})\b")
HARNESS_NATIVE = {"read", "grep", "glob", "list", "webfetch"}
SHELL_NATIVE = re.compile(r"(?:^|[;&|]\s*)(grep|rg|find|cat|sed|head|tail|nl|awk|ls)\b")

tot_ss = 0
fb_any = collections.Counter()
fb_same = collections.Counter()
rollouts_fb = set()
rollouts_fb_same = set()
ex = collections.defaultdict(list)
by_arm = collections.Counter()
by_arm_roll = collections.defaultdict(set)
after_fail = collections.Counter()

for t, arm, rep, row, run, rd in rollouts():
    if arm == "native": continue
    ev = [e for e in parse(ndjson_path(row, rd)) if e["k"] == "tool"]
    lastss = None       # (idx, tool, set(paths returned), failed?)
    for i, e in enumerate(ev):
        tool = e["tool"]
        cmd = e.get("cmd") or ""
        out = e.get("output") or ""
        exitc = (e.get("meta") or {}).get("exit")
        sst = ss_tools(cmd) if tool == "bash" else []
        if sst:
            tot_ss += 1
            paths = set(PATH.findall(out)) | set(PATH.findall(cmd))
            failed = (str(exitc) not in ("0", "None")) or e["status"] != "completed" or out.strip() == ""
            lastss = (i, sst[0], paths, failed, cmd)
            continue
        isnat = tool in HARNESS_NATIVE or (tool == "bash" and SHELL_NATIVE.search(cmd) and not sst)
        if not isnat or lastss is None: continue
        if i - lastss[0] > 2: continue      # "just returned" = within 2 tool calls
        inp = json.dumps(e.get("input") or {})
        target = set(PATH.findall(inp)) | set(PATH.findall(cmd))
        fb_any[arm] += 1; rollouts_fb.add((t, arm, rep)); by_arm[arm] += 1
        by_arm_roll[arm].add((t, arm, rep))
        if lastss[3]: after_fail[arm] += 1
        shared = target & lastss[2]
        if shared:
            fb_same[arm] += 1; rollouts_fb_same.add((t, arm, rep))
            if len(ex[arm]) < 6:
                ex[arm].append({"task": t, "rep": rep, "ssCmd": lastss[4][:150], "ssFailed": lastss[3],
                                "nativeTool": tool, "nativeInput": (cmd or inp)[:180], "shared": sorted(shared)[:4]})

print("ss-* calls (sweet only):", tot_ss)
print("native-tool call within 2 steps of an ss-* call:", dict(fb_any), " total", sum(fb_any.values()))
print("  ...of which the native call names a path the ss-* call had just named:", dict(fb_same), " total", sum(fb_same.values()))
print("  ...of which followed a FAILED/empty ss-* call:", dict(after_fail), " total", sum(after_fail.values()))
print("rollouts with any such fallback:", len(rollouts_fb), "of 198;  same-path:", len(rollouts_fb_same))
print("per-arm rollouts:", {k: len(v) for k, v in by_arm_roll.items()})
for a in ex:
    print("\n--- examples (%s)" % a)
    for e in ex[a]: print("   ", json.dumps(e)[:420])
