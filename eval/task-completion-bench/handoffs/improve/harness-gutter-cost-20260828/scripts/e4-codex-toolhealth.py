#!/usr/bin/env python3
"""E4 step 3 -- tool-health scan over every codex sweet rollout (198) + native ref (66).

Counts per ss-* tool: calls, non-zero exit, empty/no-match results, truncation,
yields/timeouts, wall time. Detects native-tool fallback after an ss-* call that
named the same file or symbol.
"""
import json, os, re, sys, collections

IN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/all.jsonl"
OUTJ = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fp-inv/e4-codex/toolhealth.json"

SS = ("ss-search", "ss-grep", "ss-find", "ss-semantic", "ss-trace", "ss-read", "ss-files", "ss-edit")

# ---- markers observed in ss-* output bodies
RE_RESULTS0 = re.compile(r"results=0\b")
RE_NOMATCH = re.compile(r"no matches|No matches|no results|No results|not found|No such file", re.I)
RE_TRUNC = re.compile(r"Warning: truncated output \(original token count: (\d+)\)")
RE_YIELD = re.compile(r"yield|still running|timed out|timeout", re.I)
RE_SSHEADER = re.compile(r"^# (ss-\w+):", re.M)
RE_SSPATH = re.compile(r"(?:^|\s)([\w./-]+\.[A-Za-z0-9_]{1,6}):(\d+)")


def segments_with_prog(cmd):
    """Yield (program, segment) for each top-level segment, heredocs stripped."""
    heredocs = []
    def _strip(m):
        heredocs.append(m.group(0)); return " <<HEREDOC "
    c = re.sub(r"<<-?\s*'?\"?(\w+)'?\"?\n.*?\n\1", _strip, cmd, flags=re.S)
    for part in re.split(r"&&|\|\||;|\n|(?<!\|)\|(?!\|)", c):
        s = part.strip()
        if not s:
            continue
        s2 = re.sub(r"^\(\s*", "", s)
        while re.match(r"^[A-Za-z_][A-Za-z0-9_]*=\S*\s+", s2):
            s2 = re.sub(r"^[A-Za-z_][A-Za-z0-9_]*=\S*\s+", "", s2)
        m = re.match(r"^([\w./-]+)", s2)
        yield (m.group(1).rsplit("/", 1)[-1] if m else ""), s2


def file_tokens(s):
    """Filenames mentioned in a command segment."""
    return set(re.findall(r"[\w./-]*[\w-]+\.[A-Za-z0-9_]{1,6}", s))


def main():
    per_tool = collections.defaultdict(lambda: collections.Counter())
    per_tool_wall = collections.defaultdict(list)
    per_tool_tok = collections.defaultdict(list)
    defects = collections.defaultdict(list)   # defect -> [(rollout, quote)]
    rollout_ss = collections.Counter()
    fallback_rows = []
    per_arm = collections.defaultdict(lambda: collections.Counter())
    nrollouts = collections.Counter()
    empty_ss_rollouts = collections.Counter()

    for line in open(IN):
        rec = json.loads(line)
        arm = rec["arm"]
        tr = rec.get("trace")
        tag = f"{rec['run']}/{rec['task']}/{arm}/rep{rec['rep']}"
        nrollouts[arm] += 1
        if not tr:
            defects["trace-missing"].append((tag, "rolloutFile absent"))
            continue
        calls = tr["calls"]
        # index of ss-produced file references so far in this rollout
        ss_seen_files = {}    # filename -> last call index that returned it
        rollout_has_ss_empty = False
        for i, c in enumerate(calls):
            if c.get("name") != "exec_command":
                per_arm[arm]["nonexec:" + str(c.get("name"))] += 1
                continue
            cmd = c.get("cmd", "")
            out = c.get("out") or {}
            body = out.get("body") or ""
            exitc = out.get("exit")
            progs = list(segments_with_prog(cmd))
            kinds = [p for p, _ in progs]
            per_arm[arm]["exec"] += 1
            ss_here = [(p, s) for p, s in progs if p in SS]
            for p, seg in ss_here:
                per_tool[p]["calls"] += 1
                rollout_ss[p] += 1
                if out.get("wall") is not None:
                    per_tool_wall[p].append(out["wall"])
                if out.get("tok") is not None:
                    per_tool_tok[p].append(out["tok"])
            # per-call level signals (attributed to every ss tool in the envelope)
            if ss_here:
                if exitc not in (0, None):
                    for p, seg in ss_here:
                        per_tool[p]["nonzero_exit_envelope"] += 1
                    defects["nonzero-exit-envelope"].append((tag, f"exit={exitc} cmd={cmd[:200]} body={body[:300]}"))
                if RE_TRUNC.search(body):
                    n = RE_TRUNC.search(body).group(1)
                    for p, seg in ss_here:
                        per_tool[p]["truncated"] += 1
                    defects["codex-truncated-ss-output"].append((tag, f"tok={n} cmd={cmd[:160]}"))
            # per-tool result inspection: split body by ss headers
            for p, seg in ss_here:
                # find that tool's section in the body
                sec = body
                mm = re.search(r"^# " + re.escape(p) + r":.*?$", body, re.M)
                if mm:
                    nxt = RE_SSHEADER.search(body, mm.end())
                    sec = body[mm.start(): nxt.start() if nxt else len(body)]
                if p in ("ss-search", "ss-semantic", "ss-find") and RE_RESULTS0.search(sec):
                    per_tool[p]["zero_results"] += 1
                    rollout_has_ss_empty = True
                    defects["ss-zero-results"].append((tag, f"cmd={seg[:160]} :: {sec.splitlines()[0][:200] if sec.strip() else '(empty)'}"))
                elif p in ("ss-grep",) and (not sec.strip() or RE_NOMATCH.search(sec[:400])):
                    per_tool[p]["zero_results"] += 1
                    rollout_has_ss_empty = True
                    defects["ss-grep-empty"].append((tag, f"cmd={seg[:160]} :: {sec[:200]!r}"))
                elif p == "ss-read" and ("Error" in sec[:200] or "error" in sec[:120]):
                    per_tool[p]["error_text"] += 1
                    defects["ss-read-error"].append((tag, f"cmd={seg[:160]} :: {sec[:250]!r}"))
                # collect files this ss call surfaced
                for fn, ln in RE_SSPATH.findall(sec):
                    ss_seen_files.setdefault(fn.split("/")[-1], i)
                for fm in re.findall(r"^# ss-read ([\w./-]+)", sec, re.M):
                    ss_seen_files.setdefault(fm.split("/")[-1], i)
            # native fallback detection: a native read/grep segment naming a file an
            # earlier ss-* call returned
            for p, seg in progs:
                if p in ("sed", "cat", "nl", "head", "tail", "grep", "rg", "awk", "find"):
                    for f in file_tokens(seg):
                        base = f.split("/")[-1]
                        if base in ss_seen_files and ss_seen_files[base] < i:
                            fallback_rows.append({"rollout": tag, "arm": arm, "prog": p,
                                                  "file": base, "seg": seg[:160],
                                                  "ssCallIdx": ss_seen_files[base], "idx": i})
                            per_arm[arm]["fallback_after_ss"] += 1
                            break
        if rollout_has_ss_empty:
            empty_ss_rollouts[arm] += 1

    print("rollouts per arm:", dict(nrollouts))
    print()
    print(f"{'tool':12s} {'calls':>7s} {'zeroRes':>8s} {'trunc':>7s} {'nz-exit':>8s} {'errTxt':>7s} {'medWall':>8s} {'medTok':>8s}")
    for p in SS:
        c = per_tool[p]
        w = sorted(per_tool_wall[p]); t = sorted(per_tool_tok[p])
        mw = w[len(w)//2] if w else float('nan')
        mt = t[len(t)//2] if t else float('nan')
        if c["calls"]:
            print(f"{p:12s} {c['calls']:7d} {c['zero_results']:8d} {c['truncated']:7d} "
                  f"{c['nonzero_exit_envelope']:8d} {c['error_text']:7d} {mw:8.3f} {mt:8.0f}")
    print()
    print("defect classes:")
    for k, v in sorted(defects.items(), key=lambda kv: -len(kv[1])):
        print(f"  {k:34s} {len(v)}")
    print()
    print("rollouts with >=1 empty ss result:", dict(empty_ss_rollouts))
    print("native fallback after ss (call events):", dict(per_arm))
    json.dump({
        "perTool": {p: dict(per_tool[p]) for p in SS},
        "wall": {p: per_tool_wall[p] for p in SS},
        "tok": {p: per_tool_tok[p] for p in SS},
        "defects": {k: v for k, v in defects.items()},
        "fallbacks": fallback_rows,
        "perArm": {k: dict(v) for k, v in per_arm.items()},
        "emptySsRollouts": dict(empty_ss_rollouts),
        "nRollouts": dict(nrollouts),
    }, open(OUTJ, "w"), indent=1)
    print("wrote", OUTJ)


if __name__ == "__main__":
    main()
