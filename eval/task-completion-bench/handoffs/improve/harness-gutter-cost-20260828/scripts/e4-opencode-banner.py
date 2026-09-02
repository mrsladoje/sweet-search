#!/usr/bin/env python3
"""E4 - measure the cold-start engine banner leak into agent tool output."""
import sys, json, os, re, collections
sys.path.insert(0, "/tmp/fp-inv/e4-opencode")
from lib import rollouts, ndjson_path, parse, ss_tools

BAN = re.compile(r"(BinaryHNSW: Loaded|LateInteraction: (Loaded|Streaming load)|\[LateInteraction\] Loading|Warming up embedding service|Local model loaded in|Warmup complete in|✓ Local embedding model loaded|\[ORT\] Direct session)")
BLOCK = re.compile(r"(?s)(BinaryHNSW: Loaded.*?(?:Warmup complete in \d+ms|Local embedding model loaded)\n?)")

tot_calls = 0
ban_calls = 0
ban_roll = set()
ban_bytes = 0
per_roll = collections.Counter()
first_only = collections.Counter()
ex = []
per_arm = collections.Counter()
for t, arm, rep, row, run, rd in rollouts():
    if arm == "native": continue
    ev = parse(ndjson_path(row, rd))
    idx = 0
    for e in ev:
        if e["k"] != "tool" or e["tool"] != "bash": continue
        if not ss_tools(e.get("cmd") or ""): continue
        idx += 1
        tot_calls += 1
        out = e.get("output") or ""
        if BAN.search(out):
            ban_calls += 1
            ban_roll.add((t, arm, rep))
            per_roll[(t, arm, rep)] += 1
            first_only[idx] += 1
            per_arm[arm] += 1
            b = 0
            for m in BAN.finditer(out): pass
            mm = BLOCK.search(out)
            if mm: b = len(mm.group(1)); ban_bytes += b
            else:
                # count the banner lines individually
                b = sum(len(l) + 1 for l in out.split("\n") if BAN.search(l)); ban_bytes += b
            if len(ex) < 3:
                ex.append({"task": t, "arm": arm, "rep": rep, "callIdx": idx, "bytes": b,
                           "cmd": (e.get("cmd") or "")[:120], "exit": (e.get("meta") or {}).get("exit"),
                           "snippet": out[:200]})
print("ss-* calls:", tot_calls, " calls carrying an engine banner:", ban_calls)
print("rollouts affected:", len(ban_roll), "of 198")
print("banner bytes total:", ban_bytes, " mean per affected call:", round(ban_bytes / max(1, ban_calls), 1))
print("banner occurrences by ss-call index within rollout:", dict(sorted(first_only.items())))
print("by arm:", dict(per_arm))
print("max banners in one rollout:", max(per_roll.values()) if per_roll else 0)
print("distribution of banners per affected rollout:", collections.Counter(per_roll.values()))
for e in ex: print(json.dumps(e)[:600])
