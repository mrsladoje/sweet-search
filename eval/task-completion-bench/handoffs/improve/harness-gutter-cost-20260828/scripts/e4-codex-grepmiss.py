#!/usr/bin/env python3
"""E4 -- did an ss-grep zero-match hide text the repo actually contains?

Within-trace falsifier: for every ss-grep that reported 0 matches, look at every
OTHER tool output in the same rollout (ss-read, ss-search, native cat/sed/grep)
and test whether the same pattern matches there. A hit proves the text existed
and ss-grep failed to return it.
"""
import json, re, sys, collections

IN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/all.jsonl"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fp-inv/e4-codex/grepmiss.json"

RE_GREP_ZERO = re.compile(r"^# ss-grep: 0 total match\(es\) for /(.*?)/(?: \(scope: (.*?)\))?$", re.M)
BANNER = re.compile(r"^# (ss-[a-z]+)\b(.*)$", re.M)


def segments(cmd):
    c = re.sub(r"<<-?\s*'?\"?(\w+)'?\"?\n.*?\n\1", " <<HEREDOC ", cmd, flags=re.S)
    for part in re.split(r"&&|\|\||;|\n|(?<!\|)\|(?!\|)", c):
        s = part.strip()
        if s:
            yield s


def main():
    findings = []
    counts = collections.Counter()
    for line in open(IN):
        rec = json.loads(line)
        tr = rec.get("trace")
        if not tr or rec["arm"] == "native":
            continue
        tag = f"{rec['task']}/{rec['arm']}/rep{rec['rep']}"
        # all bodies in the rollout, with the call index
        bodies = []
        for i, c in enumerate(tr["calls"]):
            if c.get("name") != "exec_command":
                continue
            b = (c.get("out") or {}).get("body") or ""
            bodies.append((i, c.get("cmd", ""), b))
        for i, cmd, b in bodies:
            for m in RE_GREP_ZERO.finditer(b):
                pat, scope = m.group(1), m.group(2) or ""
                counts["zero"] += 1
                try:
                    rx = re.compile(pat)
                except re.error:
                    counts["bad_regex"] += 1
                    continue
                # where else does this pattern appear?
                hits = []
                for j, cmd2, b2 in bodies:
                    if j == i:
                        continue
                    # do not credit the agent's own echo of the pattern
                    for mm in rx.finditer(b2):
                        ln = b2[:mm.start()].count("\n")
                        line_txt = b2.splitlines()[ln] if ln < len(b2.splitlines()) else ""
                        if line_txt.startswith("# ss-") or line_txt.startswith("$") or pat in cmd2:
                            continue
                        hits.append({"callIdx": j, "cmd": cmd2[:110], "line": line_txt[:180]})
                        break
                if hits:
                    counts["contradicted"] += 1
                    findings.append({"rollout": tag, "task": rec["task"], "arm": rec["arm"],
                                     "pattern": pat, "scope": scope, "grepCmd": cmd[:160],
                                     "evidence": hits[:3]})
                else:
                    counts["uncontradicted"] += 1
    print(counts)
    bytask = collections.Counter(f["task"] for f in findings)
    print("contradicted by task:", bytask.most_common())
    byscope = collections.Counter(("scoped" if f["scope"] else "unscoped") for f in findings)
    print("scope split:", byscope)
    for f in findings[:25]:
        print(f"  {f['rollout']}  /{f['pattern']}/  scope={f['scope']!r}")
        print(f"      seen at call {f['evidence'][0]['callIdx']} via {f['evidence'][0]['cmd']}")
        print(f"      {f['evidence'][0]['line']!r}")
    json.dump({"counts": dict(counts), "findings": findings}, open(OUT, "w"), indent=1)
    print("wrote", OUT, len(findings))


if __name__ == "__main__":
    main()
