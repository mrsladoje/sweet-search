#!/usr/bin/env python3
"""E4 step 3 (v2) -- tool-health scan over every codex rollout.

Fixes v1's section splitting: ss-* outputs are separated by their own banner
lines, which differ per tool:
  # ss-search: routed=... results=N
  # ss-grep: N total match(es) for /re/
  # ss-find: ColGrep N for "..."
  # ss-semantic <path> | "query" | spans=N | ~tokens=N
  # ss-read <path> (lines A-B of C)
  # ss-trace ...
Sections are zipped with the ss-* segments of the envelope in order.
"""
import json, os, re, sys, collections

IN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/all.jsonl"
OUTJ = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fp-inv/e4-codex/toolhealth2.json"

SS = ("ss-search", "ss-grep", "ss-find", "ss-semantic", "ss-trace", "ss-read", "ss-files", "ss-edit")
BANNER = re.compile(r"^# (ss-[a-z]+)\b(.*)$", re.M)
RE_TRUNC = re.compile(r"Warning: truncated output \(original token count: (\d+)\)")
RE_READ_HDR = re.compile(r"^# ss-read (\S+) \(lines (\d+)-(\d+) of (\d+)\)", re.M)
RE_GREP_HDR = re.compile(r"^# ss-grep: (\d+) total match")
RE_RESULTS = re.compile(r"results=(\d+)")
RE_SPANS = re.compile(r"spans=(\d+)")
RE_ERRLINE = re.compile(r"^\[(ss-[a-z]+)\] error: (.*)$", re.M)
RE_LOADER = re.compile(r"^(BinaryHNSW: |LateInteraction: |\[LateInteraction\]|Loaded |Streaming load )", re.M)
RE_SSPATH = re.compile(r"(?:^|[\s`])([\w][\w./-]*\.[A-Za-z0-9_]{1,6}):(\d+)")


def segments(cmd):
    heredocs = []
    def _strip(m):
        heredocs.append(m.group(0)); return " <<HEREDOC "
    c = re.sub(r"<<-?\s*'?\"?(\w+)'?\"?\n.*?\n\1", _strip, cmd, flags=re.S)
    # keep the joining operator so we can tell && chains from ;
    toks = re.split(r"(&&|\|\||;|\n|(?<!\|)\|(?!\|))", c)
    out = []
    op = "start"
    for tok in toks:
        if tok in ("&&", "||", ";", "\n", "|"):
            op = tok
            continue
        s = tok.strip()
        if not s:
            continue
        s2 = re.sub(r"^\(\s*", "", s)
        while re.match(r"^[A-Za-z_][A-Za-z0-9_]*=\S*\s+", s2):
            s2 = re.sub(r"^[A-Za-z_][A-Za-z0-9_]*=\S*\s+", "", s2)
        m = re.match(r"^([\w./-]+)", s2)
        prog = m.group(1).rsplit("/", 1)[-1] if m else ""
        out.append({"prog": prog, "seg": s2, "op": op})
        op = "next"
    return out, heredocs


def split_sections(body):
    """[(tool, sectionText)] in order of appearance."""
    hits = list(BANNER.finditer(body))
    secs = []
    for i, m in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(body)
        secs.append((m.group(1), body[m.start():end]))
    return secs


def main():
    per_tool = collections.defaultdict(collections.Counter)
    wall = collections.defaultdict(list)
    tok = collections.defaultdict(list)
    defects = collections.defaultdict(list)
    per_arm = collections.defaultdict(collections.Counter)
    rollouts_with = collections.defaultdict(lambda: collections.defaultdict(set))
    nroll = collections.Counter()
    fallbacks = []
    envelopes = collections.Counter()

    for line in open(IN):
        rec = json.loads(line)
        arm = rec["arm"]
        tag = f"{rec['task']}/{arm}/rep{rec['rep']}"
        nroll[arm] += 1
        tr = rec.get("trace")
        if not tr:
            defects["trace-missing"].append([tag, "no rolloutFile"]); continue
        ss_seen = {}   # basename -> call index that surfaced it
        for i, c in enumerate(tr["calls"]):
            if c.get("name") != "exec_command":
                continue
            cmd = c.get("cmd", "")
            out = c.get("out") or {}
            body = out.get("body") or ""
            exitc = out.get("exit")
            segs, _ = segments(cmd)
            ssegs = [s for s in segs if s["prog"] in SS]
            envelopes[arm] += 1
            if ssegs:
                per_arm[arm]["ss_envelopes"] += 1
                if out.get("wall") is not None:
                    wall["envelope"].append(out["wall"])
                if RE_TRUNC.search(body):
                    n = int(RE_TRUNC.search(body).group(1))
                    per_arm[arm]["truncated_ss_envelope"] += 1
                    rollouts_with[arm]["truncated"].add(tag)
                    defects["codex-2500-token-cap-on-ss-output"].append(
                        [tag, f"tok={n} cmd={cmd[:150]}"])
                if RE_LOADER.search(body):
                    per_arm[arm]["loader_noise"] += 1
                    rollouts_with[arm]["loader_noise"].add(tag)
                    q = RE_LOADER.search(body)
                    defects["loader-diagnostics-in-agent-output"].append(
                        [tag, f"cmd={cmd[:110]} :: " + body[q.start():q.start() + 220].replace("\n", " | ")])
            secs = split_sections(body)
            # zip sections onto ss segments where the tool names line up
            si = 0
            for s in ssegs:
                p = s["prog"]
                per_tool[p]["calls"] += 1
                per_arm[arm]["call:" + p] += 1
                sec = ""
                while si < len(secs) and secs[si][0] != p:
                    si += 1
                if si < len(secs):
                    sec = secs[si][1]; si += 1
                if not sec:
                    per_tool[p]["no_section"] += 1
                    continue
                st = out.get("tok")
                if st is not None:
                    tok[p].append(st)
                if p == "ss-grep":
                    m = RE_GREP_HDR.search(sec)
                    if m and int(m.group(1)) == 0:
                        per_tool[p]["zero"] += 1
                        rollouts_with[arm]["ss_grep_zero"].add(tag)
                        defects["ss-grep-zero-matches"].append([tag, s["seg"][:170] + " :: " + sec.splitlines()[0][:160]])
                elif p in ("ss-search", "ss-find"):
                    m = RE_RESULTS.search(sec)
                    if m and int(m.group(1)) == 0:
                        per_tool[p]["zero"] += 1
                        rollouts_with[arm]["ss_search_zero"].add(tag)
                        defects[p + "-zero-results"].append([tag, s["seg"][:170] + " :: " + sec.splitlines()[0][:160]])
                elif p == "ss-semantic":
                    m = RE_SPANS.search(sec)
                    if m and int(m.group(1)) == 0:
                        per_tool[p]["zero"] += 1
                        defects["ss-semantic-zero-spans"].append([tag, s["seg"][:170]])
                elif p == "ss-read":
                    m = RE_READ_HDR.search(sec)
                    want = re.findall(r"\s(\d+)\s+(\d+)\s*$", s["seg"])
                    if m and want:
                        a, b = int(want[0][0]), int(want[0][1])
                        ga, gb, tot = int(m.group(2)), int(m.group(3)), int(m.group(4))
                        clamped = (gb != b and gb == tot and ga == a)
                        if (ga, gb) != (a, b) and not clamped:
                            per_tool[p]["range_mismatch"] += 1
                            defects["ss-read-range-differs-from-request"].append(
                                [tag, f"asked {a}-{b} got {ga}-{gb} :: {s['seg'][:140]}"])
                for em in RE_ERRLINE.finditer(sec):
                    per_tool[em.group(1)]["error_line"] += 1
                    rollouts_with[arm]["ss_error_line"].add(tag)
                    defects["ss-error-line:" + em.group(2).split(":")[0][:40]].append(
                        [tag, f"cmd={s['seg'][:120]} :: [{em.group(1)}] error: {em.group(2)[:160]}"])
                for fn, ln in RE_SSPATH.findall(sec):
                    ss_seen.setdefault(fn.split("/")[-1], i)
                for fm in re.findall(r"^# ss-read (\S+)", sec, re.M):
                    ss_seen.setdefault(fm.split("/")[-1], i)
                for fm in re.findall(r"^## #\d+ (\S+?):", sec, re.M):
                    ss_seen.setdefault(fm.split("/")[-1], i)
            # error lines that fell outside any recognised section
            for em in RE_ERRLINE.finditer(body):
                pass
            # && chain break: envelope exit!=0 and a non-final ss segment
            if exitc not in (0, None) and ssegs:
                per_arm[arm]["ss_envelope_nonzero_exit"] += 1
                rollouts_with[arm]["nonzero_exit"].add(tag)
                # did an && follow an ss segment that produced zero output?
                idxs = [k for k, s in enumerate(segs) if s["prog"] in SS]
                if idxs and idxs[-1] < len(segs) - 1 and segs[idxs[-1] + 1]["op"] == "&&":
                    per_arm[arm]["possible_chain_break"] += 1
                    defects["nonzero-ss-exit-breaks-&&-chain"].append([tag, f"exit={exitc} cmd={cmd[:220]}"])
                else:
                    defects["ss-envelope-nonzero-exit"].append([tag, f"exit={exitc} cmd={cmd[:180]}"])
            # native fallback naming a file an earlier ss call surfaced
            for s in segs:
                if s["prog"] in ("sed", "cat", "nl", "head", "tail", "grep", "rg", "awk", "find"):
                    for f in re.findall(r"[\w./-]*[\w-]+\.[A-Za-z0-9_]{1,6}", s["seg"]):
                        b = f.split("/")[-1]
                        if b in ss_seen and ss_seen[b] < i:
                            fallbacks.append({"rollout": tag, "arm": arm, "prog": s["prog"],
                                              "file": b, "seg": s["seg"][:160]})
                            per_arm[arm]["fallback_after_ss"] += 1
                            rollouts_with[arm]["fallback"].add(tag)
                            break

    print("rollouts:", dict(nroll))
    print()
    hdr = f"{'tool':12s} {'calls':>6s} {'zero':>6s} {'errLine':>8s} {'rangeMism':>10s} {'noSection':>10s} {'medTok':>7s}"
    print(hdr)
    for p in SS:
        c = per_tool[p]
        if not c["calls"] and not c["error_line"]:
            continue
        t = sorted(tok[p]); mt = t[len(t) // 2] if t else -1
        print(f"{p:12s} {c['calls']:6d} {c['zero']:6d} {c['error_line']:8d} {c['range_mismatch']:10d} {c['no_section']:10d} {mt:7d}")
    print()
    print("per arm:")
    for a in ("native", "TAB", "NONE", "PIPE"):
        print(" ", a, dict(per_arm[a]))
    print()
    print("rollouts-with (unit = rollout, /66):")
    for a in ("native", "TAB", "NONE", "PIPE"):
        print(" ", a, {k: len(v) for k, v in rollouts_with[a].items()})
    print()
    print("defect classes:")
    for k, v in sorted(defects.items(), key=lambda kv: -len(kv[1])):
        print(f"  {k:46s} {len(v)}")
    json.dump({"perTool": {p: dict(per_tool[p]) for p in SS},
               "perArm": {a: dict(per_arm[a]) for a in per_arm},
               "rolloutsWith": {a: {k: sorted(v) for k, v in d.items()} for a, d in rollouts_with.items()},
               "defects": dict(defects), "fallbacks": fallbacks,
               "tok": {p: tok[p] for p in SS}, "nRollouts": dict(nroll)},
              open(OUTJ, "w"), indent=1)
    print("wrote", OUTJ)


if __name__ == "__main__":
    main()
