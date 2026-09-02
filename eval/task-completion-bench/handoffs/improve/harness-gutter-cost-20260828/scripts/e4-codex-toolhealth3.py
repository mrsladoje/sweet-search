#!/usr/bin/env python3
"""E4 step 3 (final) -- codex tool-health table.

Per ss-* tool: calls, zero results, error lines, codex-cap truncation, wall time.
Plus product-defect counters:
  index-blind      a zero result whose text the same rollout read from a file in scope
  stale-index      a zero result for text the agent itself added earlier
  reread-omitted   ss-read suppressed an unchanged reread
  force-retry      the agent spent another call with --force
  enoent           ss-read stat failed (agent path guess)
  loader-noise     BinaryHNSW / LateInteraction diagnostics in agent-visible output
  nonzero-exit     the exec envelope exited non-zero with an ss-* call in it
  native-fallback  sed/cat/grep/rg on a file an earlier ss-* call had returned
Every counter is reported as calls AND rollouts-with (denominator 66 per arm).
"""
import json, os, re, sys, collections, statistics

IN = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fp-inv/e4-codex/all.jsonl"
OUTJ = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fp-inv/e4-codex/toolhealth3.json"

SS = ("ss-search", "ss-grep", "ss-find", "ss-semantic", "ss-trace", "ss-read")
BANNER = re.compile(r"^# (ss-[a-z]+)\b", re.M)
RE_TRUNC = re.compile(r"Warning: truncated output \(original token count: (\d+)\)")
RE_GREP0 = re.compile(r"^# ss-grep: 0 total match")
RE_RES0 = re.compile(r"results=0\b")
RE_SPANS0 = re.compile(r"spans=0\b")
RE_ERR = re.compile(r"^\[(ss-[a-z]+)\] error: (.*)$", re.M)
RE_OMIT = re.compile(r"\[unchanged reread omitted; these exact source lines were already shown (\d+) sweet-search call")
RE_LOADER = re.compile(r"^(BinaryHNSW: |LateInteraction: |\[LateInteraction\])", re.M)
RE_READHDR = re.compile(r"^# ss-read (\S+) \(lines")
RE_HIT = re.compile(r"^## #\d+ ([^\s:]+):", re.M)
RE_GLINE = re.compile(r"^([\w][\w./-]*):(\d+):", re.M)


def segs(cmd):
    c = re.sub(r"<<-?\s*'?\"?(\w+)'?\"?\n.*?\n\1", " <<HEREDOC ", cmd, flags=re.S)
    for part in re.split(r"&&|\|\||;|\n|(?<!\|)\|(?!\|)", c):
        s = part.strip()
        if not s:
            continue
        s2 = re.sub(r"^\(\s*", "", s)
        while re.match(r"^[A-Za-z_][A-Za-z0-9_]*=\S*\s+", s2):
            s2 = re.sub(r"^[A-Za-z_][A-Za-z0-9_]*=\S*\s+", "", s2)
        m = re.match(r"^([\w./-]+)", s2)
        yield (m.group(1).rsplit("/", 1)[-1] if m else ""), s2


def sections(body):
    hits = list(BANNER.finditer(body))
    return [(m.group(1), body[m.start(): (hits[i + 1].start() if i + 1 < len(hits) else len(body))])
            for i, m in enumerate(hits)]


def main():
    calls = collections.defaultdict(collections.Counter)      # arm -> tool -> n
    zero = collections.defaultdict(collections.Counter)
    walls = collections.defaultdict(list)
    toks = collections.defaultdict(list)
    ev = collections.defaultdict(collections.Counter)          # arm -> event -> n
    rw = collections.defaultdict(lambda: collections.defaultdict(set))  # arm -> event -> rollouts
    quotes = collections.defaultdict(list)
    nroll = collections.Counter()

    for line in open(IN):
        rec = json.loads(line)
        arm = rec["arm"]
        tag = f"{rec['task']}/{arm}/rep{rec['rep']}"
        nroll[arm] += 1
        tr = rec.get("trace")
        if not tr:
            ev[arm]["trace-missing"] += 1
            continue
        ss_files = {}
        pending_omit = {}       # (file) -> call index of the omission
        for i, c in enumerate(tr["calls"]):
            if c.get("name") != "exec_command":
                continue
            cmd, out = c.get("cmd", ""), (c.get("out") or {})
            body, exitc = out.get("body") or "", out.get("exit")
            sl = list(segs(cmd))
            ss_here = [(p, s) for p, s in sl if p in SS]
            if ss_here:
                ev[arm]["ss_envelopes"] += 1
                if out.get("wall") is not None:
                    walls[arm].append(out["wall"])
                if out.get("tok") is not None:
                    toks[arm].append(out["tok"])
                m = RE_TRUNC.search(body)
                if m:
                    ev[arm]["codex_cap_truncation"] += 1
                    rw[arm]["codex_cap_truncation"].add(tag)
                    if len(quotes["codex_cap_truncation"]) < 4:
                        quotes["codex_cap_truncation"].append([tag, f"orig {m.group(1)} tokens :: {cmd[:130]}"])
                if RE_LOADER.search(body):
                    ev[arm]["loader_noise"] += 1
                    rw[arm]["loader_noise"].add(tag)
                    q = RE_LOADER.search(body)
                    if len(quotes["loader_noise"]) < 4:
                        quotes["loader_noise"].append([tag, body[q.start():q.start() + 200].replace("\n", " | ")])
                if exitc not in (0, None):
                    ev[arm]["envelope_nonzero_exit"] += 1
                    rw[arm]["envelope_nonzero_exit"].add(tag)
                    if len(quotes["envelope_nonzero_exit"]) < 4:
                        quotes["envelope_nonzero_exit"].append([tag, f"exit={exitc} :: {cmd[:150]}"])
            for p, _s in ss_here:
                calls[arm][p] += 1
            secs = sections(body)
            si = 0
            for p, s in ss_here:
                sec = ""
                while si < len(secs) and secs[si][0] != p:
                    si += 1
                if si < len(secs):
                    sec = secs[si][1]; si += 1
                if not sec:
                    ev[arm]["no_section_for_call"] += 1
                    continue
                if p == "ss-grep" and RE_GREP0.search(sec):
                    zero[arm][p] += 1; rw[arm]["ss_grep_zero"].add(tag)
                if p in ("ss-search", "ss-find") and RE_RES0.search(sec):
                    zero[arm][p] += 1; rw[arm]["ss_search_zero"].add(tag)
                if p == "ss-semantic" and RE_SPANS0.search(sec):
                    zero[arm][p] += 1
                mo = RE_OMIT.search(sec)
                if mo:
                    ev[arm]["reread_omitted"] += 1
                    rw[arm]["reread_omitted"].add(tag)
                    if len(quotes["reread_omitted"]) < 4:
                        quotes["reread_omitted"].append([tag, sec[:230].replace("\n", " | ")])
                for em in RE_ERR.finditer(sec):
                    kind = em.group(2).split(":")[0][:40]
                    ev[arm]["error:" + kind] += 1
                    rw[arm]["ss_error"].add(tag)
                    rw[arm]["errkind:" + kind].add(tag)
                    if len(quotes["error:" + kind]) < 3:
                        quotes["error:" + kind].append([tag, f"{_s[:110]} :: [{em.group(1)}] error: {em.group(2)[:130]}"])
                r = RE_READHDR.match(sec)
                if r:
                    ss_files.setdefault(r.group(1).split("/")[-1], i)
                for f in RE_HIT.findall(sec):
                    ss_files.setdefault(f.split("/")[-1], i)
                for f, _ln in RE_GLINE.findall(sec):
                    ss_files.setdefault(f.split("/")[-1], i)
            if re.search(r"ss-read\s+--force", cmd):
                ev[arm]["force_retry"] += 1
                rw[arm]["force_retry"].add(tag)
                if len(quotes["force_retry"]) < 4:
                    quotes["force_retry"].append([tag, cmd[:150]])
            for p, s in sl:
                if p in ("sed", "cat", "nl", "head", "tail", "grep", "rg", "awk"):
                    for f in re.findall(r"[\w./-]*[\w-]+\.[A-Za-z0-9_]{1,6}", s):
                        b = f.split("/")[-1]
                        if b in ss_files and ss_files[b] < i:
                            ev[arm]["native_fallback"] += 1
                            rw[arm]["native_fallback"].add(tag)
                            if len(quotes["native_fallback"]) < 4:
                                quotes["native_fallback"].append([tag, s[:150]])
                            break

    arms = ["native", "TAB", "NONE", "PIPE"]
    print("rollouts:", {a: nroll[a] for a in arms})
    print()
    print("ss-* CALLS (sweet arms only; native never calls ss-*)")
    print(f"{'tool':12s} " + " ".join(f"{a:>8s}" for a in arms[1:]) + "   sweet total   zero-result")
    for p in SS:
        tot = sum(calls[a][p] for a in arms[1:])
        z = sum(zero[a][p] for a in arms[1:])
        print(f"{p:12s} " + " ".join(f"{calls[a][p]:8d}" for a in arms[1:]) + f"   {tot:11d}   {z} ({(100.0*z/tot if tot else 0):.1f}%)")
    print()
    print("EVENTS  (calls | rollouts-with, /66)")
    keys = sorted(set(k for a in arms for k in ev[a]))
    print(f"{'event':38s} " + " ".join(f"{a:>16s}" for a in arms))
    for k in keys:
        row = []
        for a in arms:
            n = ev[a][k]
            r = len(rw[a].get("ss_error" if k.startswith("error:") else k, ()))
            row.append(f"{n:6d} |{r:4d}")
        print(f"{k:38s} " + " ".join(f"{c:>16s}" for c in row))
    print()
    for a in arms[1:]:
        w = sorted(walls[a]); t = sorted(toks[a])
        if w:
            print(f"{a}: ss envelope wall median {statistics.median(w):.3f}s p90 {w[int(.9*len(w))]:.3f}s ; "
                  f"codex-reported output tokens median {statistics.median(t):.0f} p90 {t[int(.9*len(t))]:.0f}")
    print()
    print("QUOTES")
    for k, v in quotes.items():
        print(" ", k)
        for tag, q in v[:2]:
            print(f"    {tag}  {q[:230]}")
    json.dump({"calls": {a: dict(calls[a]) for a in arms}, "zero": {a: dict(zero[a]) for a in arms},
               "events": {a: dict(ev[a]) for a in arms},
               "rolloutsWith": {a: {k: sorted(v) for k, v in rw[a].items()} for a in arms},
               "quotes": quotes, "nRollouts": dict(nroll)}, open(OUTJ, "w"), indent=1)
    print("wrote", OUTJ)


if __name__ == "__main__":
    main()
