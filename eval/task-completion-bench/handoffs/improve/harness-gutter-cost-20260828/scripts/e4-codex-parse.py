#!/usr/bin/env python3
"""E4 codex trace normaliser.

Walks every rollout named by rows.json in the three fp-codex runs and emits one
JSON record per rollout with a normalised call list.

Codex-on-OpenRouter records:
  response_item/function_call        payload.name, payload.arguments (JSON), call_id
  response_item/function_call_output payload.call_id, payload.output (wrapped)
  event_msg/token_count              payload.info.last_token_usage
  event_msg/agent_message            payload.message
The exec_command wrapper is:
  Chunk ID: <hex>\nWall time: <s> seconds\nProcess exited with code <n>\n
  [Original token count: <n>\n]Output:\n<body>
"""
import json, os, re, sys, collections

BASE = "/root/sweet-search-private/eval/task-completion-bench/results"
RUNS = {"TAB": "fp-codex-tab-20260826", "NONE": "fp-codex-none-20260826", "PIPE": "fp-codex-pipe-20260826"}

WRAP = re.compile(
    r"^Chunk ID: (?P<chunk>\S+)\nWall time: (?P<wall>[\d.]+) seconds\n"
    r"Process exited with code (?P<code>-?\d+)\n"
    r"(?:Original token count: (?P<tok>\d+)\n)?"
    r"(?:Output:\n)?(?P<body>.*)$", re.S)

# recognise the leading program of a shell segment
SS_TOOLS = ("ss-search", "ss-grep", "ss-find", "ss-semantic", "ss-trace", "ss-read", "ss-files", "ss-edit")
NATIVE_READ = ("sed", "cat", "nl", "head", "tail", "less", "awk")
NATIVE_FIND = ("grep", "rg", "find", "ls", "fd", "ack")


def as_cmd_string(cmd):
    if isinstance(cmd, list):
        return " ".join(str(c) for c in cmd)
    return cmd if isinstance(cmd, str) else json.dumps(cmd)


def split_segments(cmd):
    """Split a shell command into top-level segments on && || ; | and newlines.

    Heredoc bodies are stripped first so their contents never look like commands.
    """
    cmd = as_cmd_string(cmd)
    # strip heredoc bodies:  <<'TAG' ... TAG
    heredocs = []
    def _strip(m):
        heredocs.append(m.group(0))
        return " <<HEREDOC_STRIPPED "
    cmd2 = re.sub(r"<<-?\s*'?\"?(\w+)'?\"?\n.*?\n\1", _strip, cmd, flags=re.S)
    parts = re.split(r"&&|\|\||;|\n|(?<!\|)\|(?!\|)", cmd2)
    return [p.strip() for p in parts if p.strip()], heredocs


def program_of(seg):
    seg = seg.strip()
    seg = re.sub(r"^\(\s*", "", seg)
    # skip env assignments
    while re.match(r"^[A-Za-z_][A-Za-z0-9_]*=\S*\s+", seg):
        seg = re.sub(r"^[A-Za-z_][A-Za-z0-9_]*=\S*\s+", "", seg)
    m = re.match(r"^([\w./-]+)", seg)
    return m.group(1) if m else ""


def classify_cmd(cmd):
    segs, heredocs = split_segments(cmd)
    kinds = []
    for s in segs:
        p = program_of(s)
        base = p.rsplit("/", 1)[-1]
        if base in SS_TOOLS:
            kinds.append(base)
        elif base == "apply_patch":
            kinds.append("apply_patch")
        elif base == "run_tests":
            kinds.append("run_tests")
        elif base in NATIVE_READ:
            kinds.append("native:" + base)
        elif base in NATIVE_FIND:
            kinds.append("native:" + base)
        elif base in ("git",):
            kinds.append("git")
        elif base in ("printf", "echo", "true", "cd", "pwd", "wc", "sort", "uniq", "xargs", "tr", "cut", "test", "["):
            kinds.append("shell:" + base)
        elif base:
            kinds.append("other:" + base)
    return kinds, heredocs


def parse_output(out):
    if not isinstance(out, str):
        out = json.dumps(out)
    m = WRAP.match(out)
    if not m:
        return {"wrapped": False, "exit": None, "wall": None, "tok": None, "body": out}
    return {"wrapped": True, "exit": int(m.group("code")), "wall": float(m.group("wall")),
            "tok": int(m.group("tok")) if m.group("tok") else None, "body": m.group("body")}


def parse_rollout(path):
    calls = {}
    order = []
    usage = []
    messages = []
    patch_events = []
    if not os.path.exists(path):
        return None
    for line in open(path, errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        p = o.get("payload") or {}
        t = p.get("type")
        if t == "function_call":
            try:
                args = json.loads(p.get("arguments") or "{}")
            except Exception:
                args = {"_raw": p.get("arguments")}
            cid = p.get("call_id")
            rec = {"call_id": cid, "name": p.get("name"), "args": args, "ts": o.get("timestamp")}
            if p.get("name") == "exec_command":
                cmd = as_cmd_string(args.get("cmd") or "")
                kinds, heredocs = classify_cmd(cmd)
                rec["cmd"] = cmd
                rec["kinds"] = kinds
                rec["nHeredoc"] = len(heredocs)
                rec["isEdit"] = ("apply_patch" in kinds) or ("apply_patch" in cmd and "<<" in cmd)
                rec["yield_ms"] = args.get("yield_time_ms")
                rec["max_out_tok"] = args.get("max_output_tokens")
            calls[cid] = rec
            order.append(cid)
        elif t == "function_call_output":
            cid = p.get("call_id")
            po = parse_output(p.get("output"))
            if cid in calls:
                calls[cid]["out"] = po
            else:
                calls[cid] = {"call_id": cid, "name": "?", "out": po}
                order.append(cid)
        elif t == "token_count":
            info = p.get("info") or {}
            usage.append(info.get("last_token_usage"))
        elif t == "agent_message":
            messages.append(p.get("message"))
        elif t in ("patch_apply_end", "patch_apply_begin"):
            patch_events.append({k: v for k, v in p.items() if k != "type"} | {"type": t})
    return {"calls": [calls[c] for c in order if c in calls], "usage": usage,
            "messages": messages, "patchEvents": patch_events}


def main():
    outp = sys.argv[1]
    only = sys.argv[2] if len(sys.argv) > 2 else None
    with open(outp, "w") as fo:
        for form, run in RUNS.items():
            rows = json.load(open(os.path.join(BASE, run, "rows.json")))
            for r in rows:
                arm = "native" if r["arm"] == "native" else form
                if only and only not in r["taskId"]:
                    continue
                rf = r.get("rolloutFile")
                parsed = parse_rollout(rf) if rf else None
                rec = {
                    "run": run, "form": form, "arm": arm, "task": r["taskId"], "rep": r["rep"],
                    "resolved": r.get("resolved"), "f2pFrac": r.get("f2pFrac"),
                    "calls": r.get("calls"), "toolCounts": r.get("toolCounts"),
                    "patchHunks": r.get("patchHunks"), "patchFiles": r.get("patchFiles"),
                    "exitReason": r.get("exitReason"), "rolloutFile": rf,
                    "idealCostUsd": r.get("idealCostUsd"),
                    "rtVerdicts": r.get("rtVerdicts"), "rtNoVerdict": r.get("rtNoVerdict"),
                    "rtEndedUnverified": r.get("rtEndedUnverified"),
                    "codexErrors": r.get("codexErrors"),
                    "traceMissing": parsed is None,
                    "trace": parsed,
                }
                fo.write(json.dumps(rec) + "\n")
    print("done ->", outp)


if __name__ == "__main__":
    main()
