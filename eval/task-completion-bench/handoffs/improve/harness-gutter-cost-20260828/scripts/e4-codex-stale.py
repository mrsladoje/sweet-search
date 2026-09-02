#!/usr/bin/env python3
"""E4 -- does ss-grep see the agent's own in-session edits?

For every ss-grep that printed 0 matches, test whether its regex matches any line
the agent ADDED in an earlier successful apply_patch in the same rollout. A hit
means the index is stale against the working tree.
Also counts, for contrast, the same test on ss-search/ss-find zero results.
"""
import json, re, sys, collections

IN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/all.jsonl"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fp-inv/e4-codex/stale.json"
RE_ZERO = re.compile(r"^# ss-grep: 0 total match\(es\) for /(.*?)/(?: \(scope: (\S+.*?)\))?\s*$", re.M)
RE_OK = re.compile(r"Success\. Updated the following files")


def added_lines(cmd):
    """+ lines inside an apply_patch heredoc."""
    out = []
    for m in re.finditer(r"<<-?\s*'?\"?(\w+)'?\"?\n(.*?)\n\1", cmd, re.S):
        for l in m.group(2).splitlines():
            if l.startswith("+") and not l.startswith("+++"):
                out.append(l[1:])
    return out


def main():
    counts = collections.Counter()
    findings = []
    for line in open(IN):
        rec = json.loads(line)
        tr = rec.get("trace")
        if not tr or rec["arm"] == "native":
            continue
        tag = f"{rec['task']}/{rec['arm']}/rep{rec['rep']}"
        added = []          # (callIdx, text)
        for i, c in enumerate(tr["calls"]):
            if c.get("name") != "exec_command":
                continue
            body = (c.get("out") or {}).get("body") or ""
            cmd = c.get("cmd", "")
            for m in RE_ZERO.finditer(body):
                counts["zero"] += 1
                pat = m.group(1)
                try:
                    rx = re.compile(pat)
                except re.error:
                    counts["bad_regex"] += 1
                    continue
                hit = None
                for j, txt in added:
                    if j < i and rx.search(txt):
                        hit = (j, txt)
                        break
                if hit:
                    counts["stale_vs_own_edit"] += 1
                    findings.append({"rollout": tag, "task": rec["task"], "arm": rec["arm"],
                                     "pattern": pat, "grepCall": i, "editCall": hit[0],
                                     "addedLine": hit[1][:150], "cmd": cmd[:170]})
            if c.get("isEdit") and RE_OK.search(body):
                for l in added_lines(cmd):
                    added.append((i, l))
    print(counts)
    print("by task:", collections.Counter(f["task"] for f in findings).most_common())
    print("by arm:", collections.Counter(f["arm"] for f in findings))
    print("rollouts affected:", len(set(f["rollout"] for f in findings)))
    for f in findings[:20]:
        print(f"  {f['rollout']}  /{f['pattern']}/ grep@{f['grepCall']} edit@{f['editCall']}")
        print(f"      added: {f['addedLine']!r}")
        print(f"      cmd:   {f['cmd']!r}")
    json.dump({"counts": dict(counts), "findings": findings}, open(OUT, "w"), indent=1)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
