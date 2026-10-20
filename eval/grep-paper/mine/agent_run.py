"""Agent check runner (GREP_PAPER_PLAN.md E5d): resume or start DeepSeek-V4-Flash OpenHands runs
in a read-only sandbox, with native or ranked grep output, and log turns, tokens and dollars.

Design 1, resume:  messages[:anchor] from the trace, then the anchor grep response in one of two
                   arms, then the model continues.
                     asseen  the exact tool message the agent saw in the trace;
                     ranked  the first N lines of the ranked full output (ranker.py), N = the
                             agent's own head -N, with the trace's OpenHands footer.
                   Later greps are plain GNU grep in both arms (one response changed).
Design 2, fresh:   messages[:2] (system prompt and issue) from the same trajectory; every grep
                   in the run goes through grep_shim.py, native or ranked.

A run stops at the first edit attempt (its target is the run's localization answer), at
`finish`, or at the turn cap. Commands run under sandbox-exec: no network, no writes outside
/private/tmp, no reads under the home directory except the checkout and this code.

Spending: every API call reserves its worst-case cost in a ledger with a hard cap (--cap-usd) before
it is sent, and settles the real cost after; the ledger is locked, so the cap holds with parallel
jobs. Without --live the runner makes no API call and prints what it would send.

Jobs (state x arm x repeat) are shuffled with seed 42 and run on --jobs threads. Each job has its own
sandbox profile and cwd file. A cap hit or an API error stops every job at its next call.

Usage:
  python agent_run.py --states FILE --design resume|fresh --n-states 10 --reps 2 --out DIR
    [--turns 8] [--cap-usd 5] [--jobs 8] [--provider openrouter|deepseek] [--live]
"""

import argparse
import concurrent.futures
import datetime as dt
import itertools
import json
import os
import random
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

import pyarrow.parquet as pq

from ranker import ranked
from traces import SHELL_EDIT

HERE = os.path.dirname(os.path.abspath(__file__))
# Provider of DeepSeek-V4-Flash. OpenRouter has no DeepSeek first-party endpoint (2026-10-20), so the
# request is pinned to fp8 providers (no fp4); the cost is OpenRouter's own usage.cost.
PROVIDERS = {
    "deepseek": {"api": "https://api.deepseek.com/v1/chat/completions", "model": "deepseek-v4-flash",
                 "key": "DEEPSEEK_API_KEY"},
    "openrouter": {"api": "https://openrouter.ai/api/v1/chat/completions", "model": "deepseek/deepseek-v4-flash",
                   "key": "OPENROUTER_API_KEY"},
}
PROVIDER = PROVIDERS["openrouter"] | {"name": "openrouter"}
# USD per 1M tokens, deepseek-flash, from https://api-docs.deepseek.com/quick_start/pricing (2026-10-19).
# The worst-case reservation always uses the DeepSeek peak price, which is above every fp8 OpenRouter
# endpoint's price (2026-10-20).
PRICE = {"peak": {"hit": 0.006, "miss": 0.30, "out": 1.20}, "offpeak": {"hit": 0.003, "miss": 0.15, "out": 0.60}}
TMP = "/private/tmp/ssgrep-agent"
OH_CAP = 30000  # OpenHands MAX_CMD_OUTPUT_SIZE


def price_band(now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.weekday() >= 5:
        return "offpeak"
    h = now.hour
    return "peak" if (1 <= h < 4 or 6 <= h < 10) else "offpeak"


def cost(usage, band):
    if PROVIDER["name"] == "openrouter":
        return float(usage.get("cost") or 0.0)
    p = PRICE[band]
    hit = usage.get("prompt_cache_hit_tokens", 0)
    miss = usage.get("prompt_cache_miss_tokens", usage.get("prompt_tokens", 0) - hit)
    out = usage.get("completion_tokens", 0)
    return (hit * p["hit"] + miss * p["miss"] + out * p["out"]) / 1e6


class Stop(Exception):
    """A cap hit or an API error: the job stops, and so does every other job at its next call."""


class Ledger:
    """Spent + reserved never exceeds the cap at reservation time. Shared by threads (locked) and by both
    designs (the file)."""

    def __init__(self, path, cap):
        self.path, self.cap = path, cap
        self.spent = sum(json.loads(x)["usd"] for x in open(path)) if os.path.exists(path) else 0.0
        self.reserved = 0.0
        self.lock = threading.Lock()
        self.halt = None  # reason, once a job hits the cap or an API error

    def reserve(self, worst):
        with self.lock:
            if self.halt:
                raise Stop(self.halt)
            if self.spent + self.reserved + worst > self.cap:
                self.halt = (f"cost cap: spent ${self.spent:.4f}, reserved ${self.reserved:.4f}, "
                             f"next call up to ${worst:.4f}, cap ${self.cap}")
                raise Stop(self.halt)
            self.reserved += worst

    def release(self, worst):
        with self.lock:
            self.reserved -= worst

    def settle(self, worst, usd, meta):
        with self.lock:
            self.reserved -= worst
            self.spent += usd
            with open(self.path, "a") as f:
                f.write(json.dumps({"usd": usd, **meta}) + "\n")

    def stop_all(self, reason):
        with self.lock:
            self.halt = self.halt or reason


def sandbox_profile(tree):
    return f"""(version 1)
(allow default)
(deny network*)
(deny file-write*)
(allow file-write* (literal "/dev/null") (literal "/dev/tty") (subpath "/private/tmp") (subpath "/private/var/folders"))
(deny file-read* (subpath "{os.path.expanduser('~')}"))
(allow file-read-metadata)
(allow file-read* (subpath "{tree}") (subpath "{HERE}") (subpath "{os.path.expanduser('~/.ss-eval/grep-paper/venv')}")
                  (subpath "{os.path.expanduser('~/.local/share/uv')}"))
"""


class Sandbox:
    """A persistent-cwd shell over one checkout, with /workspace/<dir> mapped to the tree."""

    _ids = itertools.count()

    def __init__(self, tree, root, arm_grep):
        self.tree, self.root, self.cwd = tree, root, root
        self.tag = f"{os.getpid()}-{next(Sandbox._ids)}"  # one profile and cwd file per job
        os.makedirs(TMP, exist_ok=True)
        self.profile = os.path.join(TMP, f"profile-{self.tag}.sb")
        open(self.profile, "w").write(sandbox_profile(tree))
        self.bin = os.path.join(TMP, "bin")
        os.makedirs(self.bin, exist_ok=True)
        for name in ("grep", "egrep", "fgrep"):
            link = os.path.join(self.bin, name)
            try:
                os.symlink(os.path.join(HERE, "grep_shim.py"), link)
            except FileExistsError:
                pass
        venv_py = os.path.expanduser("~/.ss-eval/grep-paper/venv/bin")
        self.env = {"PATH": f"{self.bin}:{venv_py}:/opt/homebrew/bin:/usr/bin:/bin", "HOME": TMP, "LANG": "C.UTF-8",
                    "GREP_ARM": arm_grep, "GREP_REAL": "/opt/homebrew/bin/ggrep", "GIT_PAGER": "cat", "PAGER": "cat"}

    def to_local(self, s):
        return s.replace(self.root, self.tree)

    def to_agent(self, s):
        return s.replace(self.tree, self.root)

    def bash(self, command, timeout=60):
        cwd_file = os.path.join(TMP, f"cwd-{self.tag}")
        script = (f"cd {self.to_local(self.cwd)!r} 2>/dev/null || cd {self.tree!r}\n{self.to_local(command)}\n"
                  f"__rc=$?\npwd > {cwd_file!r}\nexit $__rc\n")
        try:
            r = subprocess.run(["sandbox-exec", "-f", self.profile, "bash", "-c", script], cwd=self.tree, env=self.env,
                               capture_output=True, timeout=timeout)
            out, rc = (r.stdout + r.stderr).decode("utf-8", errors="replace"), r.returncode
        except subprocess.TimeoutExpired:
            out, rc = "", -1
        try:
            self.cwd = self.to_agent(open(cwd_file).read().strip()) or self.cwd
        except OSError:
            pass
        out = self.to_agent(out)
        if len(out) > OH_CAP:
            out = out[:OH_CAP // 2] + "\n[... Observation truncated due to length ...]\n" + out[-OH_CAP // 2:]
        if rc == -1:
            return out + "\n[The command timed out.]"
        return (f"{out.rstrip(chr(10))}\n[The command completed with exit code {rc}.]\n"
                f"[Current working directory: {self.cwd}]\n[Python interpreter: /usr/local/bin/python]\n"
                f"[Command finished with exit code {rc}]")

    def view(self, path, view_range=None):
        local = self.to_local(path)
        if os.path.isdir(local):
            r = subprocess.run(["find", local, "-maxdepth", "2", "-not", "-path", "*/.*"], capture_output=True, text=True)
            return (f"Here's the files and directories up to 2 levels deep in {path}, excluding hidden items:\n"
                    + self.to_agent(r.stdout))
        if not os.path.isfile(local):
            return f"ERROR:\nInvalid `path` parameter: {path}. The path {path} does not exist. Please provide a valid path."
        lines = open(local, errors="replace").read().split("\n")
        start, end = 1, len(lines)
        if view_range:
            start = max(1, view_range[0])
            end = len(lines) if view_range[1] == -1 else min(len(lines), view_range[1])
        body = "\n".join(f"{i:6}\t{lines[i - 1]}" for i in range(start, end + 1))
        if len(body) > 16000:
            body = body[:16000] + ("<response clipped><NOTE>Due to the max output limit, only part of this file has been "
                                   "shown to you. You should retry this tool after you have searched inside the file "
                                   "with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>")
        return f"Here's the result of running `cat -n` on {path}:\n{body}\n"


def load_trajectory(state):
    t = pq.read_table(state["shard"], columns=["messages", "tools", "metadata"]).slice(state["row"], 1).to_pylist()[0]
    msgs = json.loads(t["messages"]) if isinstance(t["messages"], str) else t["messages"]
    tools = [json.loads(x) if isinstance(x, str) else x for x in (json.loads(t["tools"]) if isinstance(t["tools"], str)
                                                                  else t["tools"])]
    return msgs, tools


def to_api_messages(msgs):
    """Trace messages -> OpenAI-format messages, giving tool results the ids of their calls."""
    out, pending = [], []
    for m in msgs:
        role = m["role"]
        if role == "assistant":
            calls = m.get("tool_calls") or []
            if isinstance(calls, str):
                calls = json.loads(calls)
            pending = [c["id"] for c in calls]
            msg = {"role": "assistant", "content": m.get("content") or ""}
            if calls:
                msg["tool_calls"] = [{"id": c["id"], "type": "function", "function": c["function"]} for c in calls]
            if m.get("reasoning_content"):
                msg["reasoning_content"] = m["reasoning_content"]
            out.append(msg)
        elif role == "tool":
            out.append({"role": "tool", "tool_call_id": pending.pop(0) if pending else "missing",
                        "content": m.get("content") or ""})
        else:
            out.append({"role": role, "content": m.get("content") or ""})
    return out


def is_numbered(command):
    g = command.split("|")[0]
    return any((t.startswith("-") and not t.startswith("--") and "n" in t[1:]) or t == "--line-number" for t in g.split())


def ranked_anchor(state, original):
    footer = original[original.find("\n[The command completed"):] if "[The command completed" in original else ""
    top = ranked(state["full"], is_numbered(state["command"]))[:state["head"]]
    return "\n".join(top) + footer


def touches_gold(text, golds):
    return [g for g in golds if g in text]


def call_api(messages, tools, max_tokens, ledger, meta, live):
    band = price_band()
    approx_in = sum(len(json.dumps(m)) for m in messages) / 2.5  # chars per token, on the low side
    worst = (approx_in * PRICE["peak"]["miss"] + max_tokens * PRICE["peak"]["out"]) / 1e6
    if PROVIDER["name"] == "openrouter":
        msgs = [{("reasoning" if k == "reasoning_content" else k): v for k, v in m.items()} for m in messages]
        body = {"model": PROVIDER["model"], "messages": msgs, "tools": tools, "max_tokens": max_tokens,
                "reasoning": {"effort": "xhigh"}, "usage": {"include": True},
                "provider": {"quantizations": ["fp8", "bf16"], "require_parameters": True}}
    else:
        body = {"model": PROVIDER["model"], "messages": messages, "tools": tools, "max_tokens": max_tokens,
                "thinking": {"type": "enabled"}, "reasoning_effort": "max"}
    if not live:
        ledger.reserve(worst)
        ledger.release(worst)
        return None, {"dry_run": True, "approx_input_tokens": int(approx_in), "worst_usd": worst}
    ledger.reserve(worst)
    try:
        resp = _post(body)
    except Stop as e:
        ledger.release(worst)
        ledger.stop_all(str(e))
        raise
    except Exception as e:
        ledger.release(worst)
        ledger.stop_all(f"harness error: {e!r}"[:300])
        raise Stop(f"harness error: {e!r}"[:300])
    usd = cost(resp.get("usage", {}), band)
    if PROVIDER["name"] == "openrouter" and resp.get("usage", {}).get("cost") is None:
        usd = worst  # no cost reported: book the worst case
    ledger.settle(worst, usd, meta | {"usage": resp.get("usage", {}), "band": band,
                                      "provider": resp.get("provider", PROVIDER["name"])})
    return resp, {"usd": usd, "usage": resp.get("usage", {})}


def _post(body):
    req = urllib.request.Request(PROVIDER["api"], data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Authorization": f"Bearer {os.environ[PROVIDER['key']]}"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                resp = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(2 ** attempt)
                continue
            raise Stop(f"API {e.code}: {e.read()[:300]}")
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(2 ** attempt)
            continue
    else:
        raise Stop("API retries exhausted")
    if resp.get("error") or not resp.get("choices"):
        raise Stop(f"API error body: {json.dumps(resp.get('error', resp))[:300]}")
    return resp


def run_one(state, design, arm, rep, turns, ledger, live, log, log_lock):
    msgs, tools = load_trajectory(state)
    if design == "resume":
        anchor = state["msg_index"]
        api_msgs = to_api_messages(msgs[:anchor + 1])
        original = api_msgs[-1]["content"]
        api_msgs[-1]["content"] = original if arm == "asseen" else ranked_anchor(state, original)
        grep_arm = "native"
    else:
        api_msgs = to_api_messages(msgs[:2])
        grep_arm = "ranked" if arm == "ranked" else "native"
    box = Sandbox(state["tree"], state["root"], grep_arm)
    golds = state["gold"]
    rec = {"instance_id": state["instance_id"], "design": design, "arm": arm, "rep": rep, "turns": [],
           "first_gold_turn": None, "edit_target": None, "stop": "turn_cap", "usd": 0.0}
    if design == "resume" and touches_gold(api_msgs[-1]["content"], golds):
        rec["first_gold_turn"] = 0
    for turn in range(1, turns + 1):
        try:
            resp, info = call_api(api_msgs, tools, 16384, ledger,
                                  {"instance_id": state["instance_id"], "design": design, "arm": arm, "rep": rep,
                                   "turn": turn}, live)
        except Stop as e:  # logged, but never analysed as a finished run
            rec["stop"], rec["stop_detail"] = "aborted", str(e)
            break
        if resp is None:
            rec["stop"] = "dry_run"
            rec["dry_run"] = info
            break
        rec["usd"] += info["usd"]
        msg = resp["choices"][0]["message"]
        if msg.get("reasoning") and not msg.get("reasoning_content"):
            msg["reasoning_content"] = msg["reasoning"]
        api_msgs.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls", "reasoning_content")})
        calls = msg.get("tool_calls") or []
        tlog = {"turn": turn, "usage": info["usage"], "calls": []}
        rec["turns"].append(tlog)
        if not calls:
            api_msgs.append({"role": "user", "content": "Please continue working on the task."})
            continue
        stop = False
        for c in calls:
            name = c["function"]["name"]
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
            except ValueError:
                args = {}
            if name == "finish":
                rec["stop"], stop, result = "finish", True, "OK"
            elif name == "think":
                result = "Your thought has been logged."
            elif name == "str_replace_editor":
                cmd, path = args.get("command"), args.get("path", "")
                if cmd in ("create", "str_replace", "insert", "undo_edit"):
                    rec["edit_target"], rec["stop"], stop = path, "edit", True
                    result = "Editing is disabled in this evaluation."
                else:
                    result = box.view(path, args.get("view_range"))
            elif name == "execute_bash":
                command = args.get("command", "")
                if SHELL_EDIT.search(command):
                    m = re.search(r"(?:sed\s+-i\S*\s+(?:'[^']*'|\"[^\"]*\"|\S+)\s+|>\s*)(\S+)", command)
                    rec["edit_target"], rec["stop"], stop = (m.group(1) if m else command[:120]), "edit", True
                result = box.bash(command)
            else:
                result = f"Unknown tool {name}"
            hit = touches_gold(json.dumps(args) + result, golds)
            if hit and rec["first_gold_turn"] is None:
                rec["first_gold_turn"] = turn
            tlog["calls"].append({"name": name, "args": json.dumps(args)[:300], "gold_hit": hit})
            api_msgs.append({"role": "tool", "tool_call_id": c["id"], "content": result})
            if stop:
                break
        if stop:
            break
    rec["edit_in_gold"] = bool(rec["edit_target"] and any(g in rec["edit_target"] for g in golds))
    with log_lock:
        log.write(json.dumps(rec) + "\n")
        log.flush()
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", required=True)
    ap.add_argument("--design", choices=["resume", "fresh"], required=True)
    ap.add_argument("--n-states", type=int, default=10)
    ap.add_argument("--reps", type=int, default=2)
    ap.add_argument("--turns", type=int, default=8)
    ap.add_argument("--cap-usd", type=float, default=5.0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--provider", choices=sorted(PROVIDERS), default="openrouter")
    a = ap.parse_args()
    global PROVIDER
    PROVIDER = PROVIDERS[a.provider] | {"name": a.provider}
    os.makedirs(a.out, exist_ok=True)
    states = [json.loads(x) for x in open(a.states)]
    if a.design == "fresh":  # one state per task is enough for a fresh run
        seen, uniq = set(), []
        for s in states:
            if s["instance_id"] not in seen:
                seen.add(s["instance_id"])
                uniq.append(s)
        states = uniq
    states = states[:a.n_states]
    ledger = Ledger(os.path.join(a.out, "ledger.jsonl"), a.cap_usd)
    jobs = [(s, arm, rep) for s in states for arm in ("asseen", "ranked") for rep in range(a.reps)]
    random.Random(42).shuffle(jobs)  # interleave arms so time-of-day effects do not line up with an arm
    log_lock = threading.Lock()
    with open(os.path.join(a.out, f"runs-{a.design}{'' if a.live else '-dry'}.jsonl"), "a") as log, \
            concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as pool:
        futures = [pool.submit(run_one, s, a.design, arm, rep, a.turns, ledger, a.live, log, log_lock)
                   for s, arm, rep in jobs]
        for f in concurrent.futures.as_completed(futures):
            r = f.result()
            print(json.dumps({k: r[k] for k in ("instance_id", "arm", "rep", "stop", "first_gold_turn", "edit_in_gold",
                                                "usd")} | ({"dry": r["dry_run"]} if "dry_run" in r else {})),
                  file=sys.stderr, flush=True)
    print(f"spent ${ledger.spent:.4f}" + (f"; stopped: {ledger.halt}" if ledger.halt else ""), file=sys.stderr)
    if ledger.halt:
        sys.exit(2)


if __name__ == "__main__":
    main()
