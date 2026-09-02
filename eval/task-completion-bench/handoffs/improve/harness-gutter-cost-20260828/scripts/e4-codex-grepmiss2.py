#!/usr/bin/env python3
"""E4 -- scoped within-trace falsifier for ss-grep zero-match results.

For every ss-grep that printed "0 total match(es)", look for the same regex in
file content the SAME rollout saw through another surface, and require the file
to be inside the ss-grep scope (--in PATH) when one was given.

File-attributed fragments come from:
  ss-read sections           "# ss-read <path> (lines A-B of C)"
  ss-semantic sections       "# ss-semantic <path> | ..."
  native sed/cat/head/tail   the path named on the command line
"""
import json, re, sys, collections

IN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/all.jsonl"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fp-inv/e4-codex/grepmiss2.json"

RE_GREP_ZERO = re.compile(r"^# ss-grep: 0 total match\(es\) for /(.*?)/(?: \(scope: --in (\S+)\))?\s*$", re.M)
RE_FRAG = re.compile(r"^# (ss-read|ss-semantic) (\S+)", re.M)
BANNER = re.compile(r"^# (ss-[a-z]+)\b", re.M)


def fragments(cmd, body):
    """[(path, text)] for content whose file is known."""
    out = []
    hits = list(BANNER.finditer(body))
    for i, m in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(body)
        sec = body[m.start():end]
        fm = RE_FRAG.match(sec)
        if fm:
            out.append((fm.group(2), sec))
    # native reads: sed -n '..p' FILE / cat FILE / head FILE
    for seg in re.split(r"&&|\|\||;|\n", cmd):
        m = re.match(r"\s*(sed|cat|head|tail|nl)\b(.*)", seg.strip())
        if m:
            for f in re.findall(r"[\w./-]*[\w-]+\.[A-Za-z0-9_]{1,6}", m.group(2)):
                out.append((f, body))
    return out


def in_scope(path, scope):
    if not scope:
        return True
    scope = scope.rstrip("/")
    if scope in (".", "./"):
        return True
    return path == scope or path.startswith(scope + "/") or path.endswith("/" + scope)


def main():
    findings = []
    counts = collections.Counter()
    for line in open(IN):
        rec = json.loads(line)
        tr = rec.get("trace")
        if not tr or rec["arm"] == "native":
            continue
        tag = f"{rec['task']}/{rec['arm']}/rep{rec['rep']}"
        frags = []
        zeros = []
        for i, c in enumerate(tr["calls"]):
            if c.get("name") != "exec_command":
                continue
            body = (c.get("out") or {}).get("body") or ""
            cmd = c.get("cmd", "")
            frags.append((i, cmd, fragments(cmd, body)))
            for m in RE_GREP_ZERO.finditer(body):
                zeros.append((i, cmd, m.group(1), m.group(2)))
        for i, cmd, pat, scope in zeros:
            counts["zero"] += 1
            try:
                rx = re.compile(pat)
            except re.error:
                counts["bad_regex"] += 1
                continue
            hit = None
            for j, cmd2, fl in frags:
                if j == i:
                    continue
                for path, text in fl:
                    if not in_scope(path, scope):
                        continue
                    for mm in rx.finditer(text):
                        ln = text.count("\n", 0, mm.start())
                        lt = text.splitlines()[ln] if ln < len(text.splitlines()) else ""
                        if lt.startswith("# ss-") or pat in cmd2:
                            continue
                        hit = {"callIdx": j, "path": path, "line": lt[:170], "cmd": cmd2[:110]}
                        break
                    if hit:
                        break
                if hit:
                    break
            if hit:
                counts["contradicted"] += 1
                findings.append({"rollout": tag, "task": rec["task"], "arm": rec["arm"],
                                 "pattern": pat, "scope": scope, "evidence": hit,
                                 "grepCallIdx": i})
            else:
                counts["unconfirmed"] += 1
    print(counts)
    print("contradicted by task:", collections.Counter(f["task"] for f in findings).most_common())
    print("scoped vs unscoped:", collections.Counter("scoped" if f["scope"] else "unscoped" for f in findings))
    seen = set()
    for f in findings:
        k = (f["task"], f["pattern"], f["scope"])
        if k in seen:
            continue
        seen.add(k)
        print(f"  {f['rollout']}  /{f['pattern']}/ scope={f['scope']}")
        print(f"      {f['evidence']['path']} :: {f['evidence']['line']!r}  (via {f['evidence']['cmd'][:70]})")
    json.dump({"counts": dict(counts), "findings": findings}, open(OUT, "w"), indent=1)
    print("wrote", OUT, len(findings))


if __name__ == "__main__":
    main()
