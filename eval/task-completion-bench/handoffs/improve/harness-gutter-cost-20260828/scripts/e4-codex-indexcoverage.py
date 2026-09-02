#!/usr/bin/env python3
"""E4 -- is the ss index blind to files the agent can still read?

Per task, collect
  A = files any ss-search / ss-grep / ss-find / ss-semantic result ever cited
  B = files ss-read successfully returned content for
Files in B \\ A that were also *searched for* (a zero-match ss-grep whose scope or
pattern names them) are index-coverage suspects.
Also reports every '--force' ss-read and every 'not indexed' error line.
"""
import json, re, sys, collections

IN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/all.jsonl"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fp-inv/e4-codex/indexcov.json"

BANNER = re.compile(r"^# (ss-[a-z]+)\b(.*)$", re.M)
RE_READ = re.compile(r"^# ss-read (\S+) \(lines")
RE_HIT = re.compile(r"^## #\d+ ([^\s:]+):", re.M)
RE_GREPLINE = re.compile(r"^([\w][\w./-]*):(\d+):", re.M)
RE_NOTIDX = re.compile(r"not indexed[^\n]*", re.I)


def main():
    per_task = collections.defaultdict(lambda: {"searched": set(), "read": set(),
                                                "force": collections.Counter(),
                                                "notidx": collections.Counter(),
                                                "rollouts": 0})
    for line in open(IN):
        rec = json.loads(line)
        if rec["arm"] == "native" or not rec.get("trace"):
            continue
        d = per_task[rec["task"]]
        d["rollouts"] += 1
        for c in rec["trace"]["calls"]:
            if c.get("name") != "exec_command":
                continue
            cmd = c.get("cmd", "")
            body = (c.get("out") or {}).get("body") or ""
            for m in re.finditer(r"ss-read\s+--force\s+(\S+)", cmd):
                d["force"][m.group(1)] += 1
            for m in RE_NOTIDX.finditer(body):
                d["notidx"][m.group(0)[:90]] += 1
            hits = list(BANNER.finditer(body))
            for i, mm in enumerate(hits):
                end = hits[i + 1].start() if i + 1 < len(hits) else len(body)
                sec = body[mm.start():end]
                tool = mm.group(1)
                if tool == "ss-read":
                    r = RE_READ.match(sec)
                    if r:
                        d["read"].add(r.group(1))
                elif tool in ("ss-search", "ss-find", "ss-semantic", "ss-grep"):
                    for f in RE_HIT.findall(sec):
                        d["searched"].add(f)
                    for f, _ln in RE_GREPLINE.findall(sec):
                        d["searched"].add(f)
                    m2 = re.match(r"^# ss-semantic (\S+)", sec)
                    if m2:
                        d["searched"].add(m2.group(1))
    out = {}
    print(f"{'task':46s} {'roll':>4s} {'searched':>8s} {'read':>5s} {'read-only':>9s}  force / notIndexed")
    for t, d in sorted(per_task.items()):
        only = sorted(d["read"] - d["searched"])
        out[t] = {"searched": sorted(d["searched"]), "read": sorted(d["read"]),
                  "readOnly": only, "force": dict(d["force"]), "notIndexed": dict(d["notidx"])}
        print(f"{t:46s} {d['rollouts']:4d} {len(d['searched']):8d} {len(d['read']):5d} {len(only):9d}"
              f"  force={sum(d['force'].values())} notIdx={sum(d['notidx'].values())}")
        if only:
            print("      read-but-never-searched:", ", ".join(only[:8]) + (" ..." if len(only) > 8 else ""))
        if d["force"]:
            print("      --force:", dict(list(d["force"].items())[:6]))
        if d["notidx"]:
            print("      notIndexed:", list(d["notidx"].items())[:3])
    json.dump(out, open(OUT, "w"), indent=1)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
