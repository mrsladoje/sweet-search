#!/usr/bin/env python3
"""E4 -- codex edit census: apply_patch calls, failures, anchor shape, and the
silent-misplacement signature (a hunk applied, then reverted and re-applied).

codex edits are `apply_patch <<'PATCH' ... PATCH` heredocs inside exec_command.
Success string: "Success. Updated the following files:".
Failure strings: "Failed to find context", "Failed to find expected lines",
"Unexpected line found", "apply_patch verification failed".
"""
import json, re, sys, collections

IN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/all.jsonl"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fp-inv/e4-codex/editcensus.json"

OKRE = re.compile(r"Success\. Updated the following files")
FAILRE = re.compile(r"Failed to find (?:context|expected lines)|Unexpected line found|"
                    r"apply_patch verification failed|invalid patch|Invalid Context")
HD = re.compile(r"<<-?\s*'?\"?(\w+)'?\"?\n(.*?)\n\1", re.S)


def patches(cmd):
    return [m.group(2) for m in HD.finditer(cmd)]


def hunks(body):
    """[(locator, [lines])] for each @@ section of one *** Update File block."""
    out, cur, loc = [], None, None
    for l in body.splitlines():
        if l.startswith("@@"):
            if cur is not None:
                out.append((loc, cur))
            loc = l[2:].strip()
            cur = []
        elif cur is not None:
            cur.append(l)
    if cur is not None:
        out.append((loc, cur))
    return out


def main():
    ev = collections.defaultdict(collections.Counter)
    rw = collections.defaultdict(lambda: collections.defaultdict(set))
    quotes = collections.defaultdict(list)
    for line in open(IN):
        rec = json.loads(line)
        arm, tr = rec["arm"], rec.get("trace")
        if not tr:
            continue
        tag = f"{rec['task']}/{arm}/rep{rec['rep']}"
        applied = []          # normalised '+' blocks already applied
        for i, c in enumerate(tr["calls"]):
            if c.get("name") != "exec_command" or not c.get("isEdit"):
                continue
            cmd = c.get("cmd", "")
            body = (c.get("out") or {}).get("body") or ""
            ok, bad = bool(OKRE.search(body)), bool(FAILRE.search(body))
            ev[arm]["edit_calls"] += 1
            rw[arm]["edit_calls"].add(tag)
            if bad:
                ev[arm]["edit_failed"] += 1
                rw[arm]["edit_failed"].add(tag)
                m = re.search(r"(Failed to find [^\n]*|Unexpected line[^\n]*|[^\n]*verification failed[^\n]*)", body)
                if len(quotes["edit_failed"]) < 6:
                    quotes["edit_failed"].append([tag, (m.group(1) if m else body[:150])[:190]])
            elif ok:
                ev[arm]["edit_ok"] += 1
            for p in patches(cmd):
                for loc, ls in hunks(p):
                    ev[arm]["hunks"] += 1
                    if not loc:
                        ev[arm]["hunk_bare_@@"] += 1
                    else:
                        ev[arm]["hunk_located_@@"] += 1
                    ctx = [l[1:] for l in ls if l.startswith(" ")]
                    if ctx and len([x for x in ctx if x.strip()]) <= 2:
                        ev[arm]["hunk_ctx<=2_nonblank"] += 1
                        if len(quotes["thin_anchor"]) < 6:
                            quotes["thin_anchor"].append([tag, " / ".join(x.strip() for x in ctx if x.strip())[:150]])
                    # revert signature: this hunk deletes lines a previous hunk added
                    minus = [l[1:].strip() for l in ls if l.startswith("-") and l[1:].strip()]
                    plus = [l[1:].strip() for l in ls if l.startswith("+") and l[1:].strip()]
                    if minus and any(tuple(minus) == a for a in applied):
                        ev[arm]["revert_of_own_hunk"] += 1
                        rw[arm]["revert_of_own_hunk"].add(tag)
                        if len(quotes["revert_of_own_hunk"]) < 6:
                            quotes["revert_of_own_hunk"].append([tag, " / ".join(minus)[:150]])
                    if plus and ok:
                        applied.append(tuple(plus))
    arms = ["native", "TAB", "NONE", "PIPE"]
    keys = sorted(set(k for a in arms for k in ev[a]))
    print(f"{'metric':28s} " + " ".join(f"{a:>14s}" for a in arms))
    for k in keys:
        print(f"{k:28s} " + " ".join(f"{ev[a][k]:6d} |{len(rw[a].get(k, ())):4d}" for a in arms))
    print()
    for k, v in quotes.items():
        print(k)
        for tag, q in v[:4]:
            print(f"   {tag}  {q}")
    json.dump({"events": {a: dict(ev[a]) for a in arms},
               "rolloutsWith": {a: {k: sorted(v) for k, v in rw[a].items()} for a in arms},
               "quotes": quotes}, open(OUT, "w"), indent=1)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
