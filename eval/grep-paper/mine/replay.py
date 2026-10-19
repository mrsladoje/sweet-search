"""Dev replay harness (GREP_PAPER_PLAN.md §3.2-3.3, §6 design rule, step S2).

Input: candidates-dev.jsonl from census.py (eligible calls: before the first edit, searching several
files, the only grep of their command; dev repositories only). This script replays the SWE-rebench-V2
calls on a clean shallow checkout of the task's base commit, one checkout per (repo, commit), and
deletes the checkout after use (except trees listed in --keep-trees-from).

Per call it runs the grep argv twice, never the shell line:
  original   the agent's argv (GNU grep 3.12 for grep/egrep/fgrep): exact output lines, used for the
             agreement with the visible output and for rendering;
  canonical  the same argv with -H -n -Z added (rg: -H -n --null; git grep: -n -z), which gives the path
             and line number of every output line without parsing ambiguity. The two outputs are zipped
             line by line; a length or text mismatch is recorded (zip_ok false).
Calls with file-level output (-l, -L, -c) take their records from the original output.

Frozen record per call (records-<kind>.jsonl.gz): the call, its visible output, the full candidate set C
as source records {p: repo path, l: line, t: m(atch)/c(ontext)/f(ile), o: original output line, and the
L1 flags F (file), L (line), D (definition)}, the indices of the records the agent saw, the fidelity tier,
and provenance (repo, commit, grep version, filesystem, harness commit).

Fidelity tiers (§3.2), order-independent:
  F   uncut, and the visible lines equal the replayed lines as sets (and the line count agrees);
  O+  cut, every visible line is in the replay, and an independent count from the same trajectory
      (`| wc -l` or `-c`, before the first edit) equals the replayed count;
  O   cut, and every visible line is in the replay (the last visible line may be clipped);
  X   anything else, with the reason.

L1 labels (§3.3) from the gold patch, mapped at the base revision. Files the patch creates are excluded.
  file        the record's path is a file the patch modifies or deletes;
  line        the record's line is a line the patch removes or replaces (strict);
  definition  the record's line lies in the innermost definition that encloses a changed line of a hunk.
              Spans: Python `ast` for .py; a brace matcher for C-family/JS/TS/Go/Rust/Java/PHP/...;
              an `end` matcher for Ruby; else no definition. A hunk outside any definition uses its own
              line range (anchor). labels-dev.jsonl records the method of every hunk, and
              gold-files-dev.jsonl.gz keeps the base-revision text of every gold file, so the labels can
              be recomputed offline (for example with tree-sitter or the ss-grep code graph).

Usage:
  python replay.py --candidates FILE --tasks task_index.json --patches FILE --counts FILE --work DIR
    --out DIR [--kind cut|uncut|all] [--limit N] [--jobs 4] [--keep-trees-from states.jsonl]
"""

import argparse
import ast
import collections
import concurrent.futures
import datetime as dt
import gzip
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time

from replay_sample import ROOT, agreement, call_root as _call_root, checkout, expand_globs, remap

HERE = os.path.dirname(os.path.abspath(__file__))
TIMEOUT = 60
MAX_RECORDS = 100_000
MIN_FREE = 30e9
ANSI = re.compile(r"\x1b\[[0-9;]*[mK]")
FILE_LEVEL = {"-l", "-L", "-c", "--files-with-matches", "--files-without-match", "--count"}
NUM_LINE = re.compile(r"^(\d+)([:\-=])(.*)$", re.S)


# ---------------------------------------------------------------- gold patch and definition spans

def parse_patch(patch):
    """{old_path: {"status", "removed": set(old lines), "hunks": [(start, end, changed lines)]}} for
    files that exist at the base revision."""
    files, cur, o = {}, None, 0
    for line in patch.split("\n"):
        if line.startswith("diff --git "):
            cur = None
            m = re.match(r"^diff --git a/(\S+) b/(\S+)", line)
            if m:
                cur = {"old": m.group(1), "status": "modified", "removed": set(), "hunks": []}
                files[m.group(1)] = cur
            continue
        if cur is None:
            continue
        if line.startswith("--- "):
            if line.strip() == "--- /dev/null":
                cur["status"] = "added"
            continue
        if line.startswith("+++ "):
            if line.strip() == "+++ /dev/null":
                cur["status"] = "deleted"
            continue
        m = re.match(r"^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@", line)
        if m:
            start, length = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
            cur["hunks"].append([start, start + max(length, 1) - 1, set()])
            o = start
            continue
        if not cur["hunks"] or line.startswith("\\"):
            continue
        h = cur["hunks"][-1]
        if line.startswith("-"):
            cur["removed"].add(o)
            h[2].add(o)
            o += 1
        elif line.startswith("+"):
            h[2].update({max(o - 1, 1), o})  # an insertion: the lines around it
        else:
            o += 1
    return {k: v for k, v in files.items() if v["status"] != "added"}


BRACE_EXT = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".java", ".go", ".rs", ".c", ".h", ".cc", ".cpp",
             ".cxx", ".hpp", ".hh", ".cs", ".php", ".kt", ".kts", ".scala", ".swift", ".dart", ".groovy", ".m",
             ".mm", ".vue", ".svelte", ".sol", ".zig"}
KEYWORDS = {"if", "for", "while", "switch", "catch", "return", "else", "new", "do", "try", "sizeof", "with",
            "foreach", "using", "lock", "until", "match", "await", "throw", "case", "elif", "assert"}
DEF_BRACE = [
    re.compile(r"^\s*(export\s+)?(default\s+)?(async\s+)?function\b"),
    re.compile(r"^\s*((export|public|private|protected|internal|abstract|final|sealed|static|data|open|pub(\([^)]*\))?"
               r"|partial|declare|unsafe|inline)\s+)*(class|interface|enum|struct|trait|impl|object|record|namespace"
               r"|module|union|protocol|extension|mod)\b"),
    re.compile(r"^\s*((public|private|protected|internal|static|final|abstract|override|virtual|async|synchronized"
               r"|open|suspend|inline|unsafe|pub(\([^)]*\))?|export|const|extern|default|operator|tailrec)\s+)*"
               r"(fn|func|fun|def|sub|function)\b"),
    re.compile(r"^type\s+\w+(\[[^\]]*\])?\s+(struct|interface)\b"),
    re.compile(r"^\s*(export\s+)?(const|let|var)\s+[\w$]+\s*(:[^=]+)?=\s*(async\s*)?(\([^)]*\)|[\w$]+)\s*(:[^=]+)?=>"),
    re.compile(r"^\s*((public|private|protected|internal|static|final|abstract|override|virtual|async|synchronized"
               r"|readonly|extern|inline|constexpr|explicit|unsafe|get|set)\s+)*"
               r"[\w$<>\[\],.?*&:~]+(\s+[\w$<>\[\],.?*&:~]+)*\s*\(([^;]*)$"),
]
RUBY_DEF = re.compile(r"^(\s*)(def|class|module)\b")
PY_DEF = re.compile(r"^(\s*)(async\s+def|def|class)\b")


def _strip_code(text):
    """Blank out string literals and comments in one pass (newlines kept), so braces inside them are not
    counted. A single quote opens a character literal only if it closes within 6 characters (Rust
    lifetimes, apostrophes); `#` comments are not handled (brace languages only)."""
    out, i, n = list(text), 0, len(text)
    while i < n:
        ch = text[i]
        two = text[i:i + 2]
        if two == "//":
            j = text.find("\n", i)
            j = n if j < 0 else j
        elif two == "/*":
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
        elif ch in "\"`":
            j = i + 1
            while j < n and text[j] != ch and (ch == "`" or text[j] != "\n"):
                j += 2 if text[j] == "\\" else 1
            j = min(n, j + 1)
        elif ch == "'":
            m = re.match(r"'(\\.[^']{0,4}|[^'\\\n])'", text[i:i + 8])
            if not m:
                i += 1
                continue
            j = i + m.end()
        else:
            i += 1
            continue
        for k in range(i, j):
            if out[k] != "\n":
                out[k] = " "
        i = j
    return "".join(out)


def brace_spans(text):
    raw_lines = text.split("\n")
    clean = _strip_code(text).split("\n")
    spans = []
    for i, ln in enumerate(raw_lines):
        if not any(r.match(ln) for r in DEF_BRACE):
            continue
        first = re.match(r"^\s*([\w$]+)", ln)
        if first and first.group(1) in KEYWORDS:
            continue
        # The opening brace must come within 6 lines, before a ';' that ends a declaration.
        depth, opened, end = 0, False, None
        for j in range(i, min(len(clean), i + 6)) if True else []:
            seg = clean[j]
            for ch in seg:
                if ch == ";" and not opened:
                    break
                if ch == "{":
                    depth += 1
                    opened = True
                elif ch == "}" and opened:
                    depth -= 1
            else:
                if opened:
                    break
                continue
            break
        if not opened:
            continue
        for j in range(j + 1 if depth > 0 else j, len(clean)) if depth > 0 else []:
            for ch in clean[j]:
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
            if depth <= 0:
                end = j
                break
        if depth <= 0 and end is None:
            end = j
        if end is not None:
            spans.append((i + 1, end + 1))
    return spans


def python_spans(text):
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return None
    spans = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            start = min([node.lineno] + [d.lineno for d in node.decorator_list])
            spans.append((start, node.end_lineno))
    return spans


def indent_spans(lines, pattern, end_word=None):
    """Python fallback (indentation) and Ruby (`end` at the same indentation)."""
    spans = []
    for i, ln in enumerate(lines):
        m = pattern.match(ln)
        if not m:
            continue
        ind = len(m.group(1).expandtabs())
        end = len(lines)
        for j in range(i + 1, len(lines)):
            s = lines[j]
            if not s.strip():
                continue
            k = len(s) - len(s.lstrip())
            if end_word:
                if k == ind and s.strip().startswith(end_word):
                    end = j + 1
                    break
            elif k <= ind:
                end = j
                break
        spans.append((i + 1, end))
    return spans


def definition_spans(path, text):
    """(spans, method) for one file at the base revision."""
    ext = os.path.splitext(path)[1].lower()
    if ext in (".py", ".pyi"):
        spans = python_spans(text)
        if spans is not None:
            return spans, "ast"
        return indent_spans(text.split("\n"), PY_DEF), "indent"
    if ext in (".rb", ".rake"):
        return indent_spans(text.split("\n"), RUBY_DEF, "end"), "ruby-end"
    if ext in BRACE_EXT:
        return brace_spans(text), "brace"
    return [], "none"


def gold_labels(patch, tree, texts=None):
    """Per gold file: removed lines, definition/anchor spans, and the method of each hunk. The base-revision
    text of each gold file goes into `texts` (so the labels can be recomputed without a checkout)."""
    out = {}
    for path, f in parse_patch(patch).items():
        local = os.path.join(tree, path)
        try:
            text = open(local, encoding="utf-8", errors="replace").read()
        except OSError:
            text = None
        if texts is not None:
            texts[path] = text
        spans, method = (definition_spans(path, text) if text is not None else ([], "no-file"))
        ev, hunks = [], []
        for start, end, changed in f["hunks"]:
            chosen, hm = set(), method
            for ln in sorted(changed) or [start]:
                inner = [s for s in spans if s[0] <= ln <= s[1]]
                if inner:
                    chosen.add(min(inner, key=lambda s: s[1] - s[0]))
            if not chosen:
                chosen, hm = {(start, end)}, "anchor"
            ev.extend(chosen)
            hunks.append({"range": [start, end], "spans": sorted(chosen), "method": hm})
        out[path] = {"removed": sorted(f["removed"]), "def_spans": sorted(set(ev)), "hunks": hunks,
                     "status": f["status"]}
    return out


# ---------------------------------------------------------------- running and parsing

def grep_version():
    r = subprocess.run(["ggrep", "--version"], capture_output=True, text=True)
    return r.stdout.split("\n")[0]


def build_runs(call, root, tree, canonical):
    """(cwd, list of argv batches) for one call."""
    cwd = remap([call.get("cwd") or root or ""], root, tree)[0] or tree
    if not os.path.isdir(cwd):
        cwd = tree
    argv = expand_globs(remap(call["grep_argv"], root, tree), cwd)
    tool = call["tool"]
    if tool in ("grep", "egrep", "fgrep"):
        extra = ["-H", "-n", "-Z"] if canonical else []
        argv = ["ggrep"] + ({"egrep": ["-E"], "fgrep": ["-F"]}.get(tool, [])) + extra + argv[1:]
    elif tool == "git-grep":
        argv = ["git", "grep"] + (["-n", "-z", "--no-color"] if canonical else []) + argv[1:]
    elif tool == "rg":
        argv = ["rg"] + (["-H", "-n", "--null", "--no-heading", "--color=never"] if canonical else []) + argv[1:]
    else:
        return cwd, None, "unsupported tool"
    if call["via_xargs"]:
        up = call["upstream"]
        if len(up) != 1 or up[0][0] != "find":
            return cwd, None, "unsupported upstream"
        f = subprocess.run(["gfind"] + remap(up[0], root, tree)[1:], cwd=cwd, capture_output=True, timeout=TIMEOUT)
        files = [x for x in f.stdout.decode(errors="replace").split("\n") if x]
        return cwd, [argv + files[i:i + 2000] for i in range(0, len(files), 2000)], None
    return cwd, [argv], None


def run(cwd, batches, errors=None):
    """stdout of all batches. Exit code 2 with output is kept (GNU grep prints the matches of the other
    operands when one is missing, and the agent saw them); the error goes to `errors`."""
    out = b""
    for b in batches:
        try:
            r = subprocess.run(b, cwd=cwd, capture_output=True, timeout=TIMEOUT, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return None, "timeout"
        except (OSError, ValueError) as e:
            return None, "exec: " + str(e)[:80]
        if r.returncode > 2 or (r.returncode == 2 and not r.stdout and errors is None):
            return None, "exit %d: %s" % (r.returncode, r.stderr.decode(errors="replace")[:120])
        if r.returncode == 2 and errors is not None:
            errors.append(r.stderr.decode(errors="replace")[:200])
        out += r.stdout
    return out, None


def repo_path(path, cwd, tree):
    full = os.path.normpath(os.path.join(cwd, path))
    if full == tree or full.startswith(tree + "/"):
        return os.path.relpath(full, tree), True
    return full, False


def parse_canonical(data, tool, cwd, tree):
    """Records from the canonical run: (path, line, type), skipping `--` group separators."""
    recs = []
    for raw in data.split(b"\n"):
        if not raw.strip() or raw == b"--":
            continue
        line = ANSI.sub("", raw.decode("utf-8", errors="replace"))
        parts = line.split("\0")
        path, rest = (parts[0], "\0".join(parts[1:])) if len(parts) > 1 else (None, line)
        lno, typ = None, "m"
        if tool == "git-grep" and len(parts) >= 3:
            lno, typ = (int(parts[1]) if parts[1].isdigit() else None), "m"
        else:
            m = NUM_LINE.match(rest)
            if m:
                lno, typ = int(m.group(1)), ("m" if m.group(2) == ":" else "c")
        rp, inside = repo_path(path, cwd, tree) if path is not None else (None, False)
        recs.append({"p": rp, "l": lno, "t": typ, "in": inside})
    return recs


def file_level_records(lines, flags, cwd, tree):
    recs = []
    count = "-c" in flags or "--count" in flags
    for ln in lines:
        path, n = (ln.rsplit(":", 1) if count and ":" in ln else (ln, None))
        rp, inside = repo_path(path, cwd, tree)
        recs.append({"p": rp, "l": None, "t": "f", "n": int(n) if n and n.isdigit() else None, "in": inside})
    return recs


def strip_n(argv):
    keep = []
    for a in argv:
        if a in ("-n", "-H", "--line-number", "--with-filename") or a.startswith("--color"):
            continue
        if re.match(r"^-[a-zA-Z]+$", a) and ("n" in a or "H" in a):
            a = "-" + a[1:].replace("n", "").replace("H", "")
            if a == "-":
                continue
        keep.append(a)
    return keep


# ---------------------------------------------------------------- one call

def replay_call(call, root, tree, labels, count_obs, gver):
    rec = {k: call.get(k) for k in ("call_id", "trajectory_id", "instance_id", "repo", "harness", "model", "stratum",
                                     "language", "step", "msg_index", "command", "cwd", "grep_argv", "upstream",
                                     "tool", "head", "head_kind", "flags", "patterns", "cut", "head_cut",
                                     "harness_cut", "n_lines", "visible", "gold", "gold_shown", "via_xargs")}
    cwd, batches, why = build_runs(call, root, tree, canonical=False)
    if why:
        return rec | {"tier": "X", "reason": why}
    errors = []
    data, why = run(cwd, batches, errors)
    if why:
        return rec | {"tier": "X", "reason": why}
    rec["grep_errors"] = errors
    raw_lines = data.decode("utf-8", errors="replace").split("\n")
    if raw_lines and raw_lines[-1] == "":
        raw_lines.pop()
    tree_s = tree
    orig = [ln.replace(tree_s, root or tree_s) for ln in raw_lines]
    nonempty = [ln for ln in orig if ln.strip()]
    records_lines = [ln for ln in nonempty if ln != "--"]
    flags = set(call.get("flags") or [])
    if flags & FILE_LEVEL:
        recs = file_level_records(records_lines, flags, cwd, tree)
        zip_ok = True
    else:
        _, cbatches, why = build_runs(call, root, tree, canonical=True)
        cdata, why = run(cwd, cbatches, []) if not why else (None, why)
        if why:
            return rec | {"tier": "X", "reason": "canonical: " + why}
        recs = parse_canonical(cdata, call["tool"], cwd, tree)
        zip_ok = len(recs) == len(records_lines)
    if zip_ok:
        for r, ln in zip(recs, records_lines):
            r["o"] = ln[:2000]
    capped = len(recs) > MAX_RECORDS
    recs = recs[:MAX_RECORDS]

    # L1 flags
    for r in recs:
        g = labels.get(r["p"]) if r.get("in") else None
        r["F"] = bool(g)
        r["L"] = bool(g and r["l"] in set(g["removed"])) if r["l"] is not None else None
        r["D"] = (bool(g and any(a <= r["l"] <= b for a, b in g["def_spans"])) if r["l"] is not None else None)

    # Shown records and tier
    visible = call["visible"]
    vis_set = set(visible)
    shown = [i for i, r in enumerate(recs) if r.get("o") is not None and r["o"] in vis_set]
    if zip_ok and visible and call["cut"]:
        last = visible[-1]
        if not any(recs[i]["o"] == last for i in shown):
            pre = [i for i, r in enumerate(recs) if r.get("o") and r["o"].startswith(last) and len(last) >= 8]
            shown += pre[:1]
    miss, checked = agreement(visible, nonempty)
    full_lines = len(nonempty)
    rec.update(records=recs, shown=sorted(set(shown)), zip_ok=zip_ok, capped=capped, full_lines=full_lines,
               raw_lines=len(orig), n_records=len(recs), visible_missing=miss, visible_checked=checked,
               n_files=len({r["p"] for r in recs}))
    if not call["cut"]:
        # The trace parser keeps at most 400 visible lines; n_lines is the full visible count.
        same = (set(visible) == set(nonempty)) if call["n_lines"] <= 400 else (miss == 0 and checked > 0)
        ok = same and call["n_lines"] == full_lines
        rec.update(tier="F" if ok else "X", reason=None if ok else "uncut mismatch")
    elif miss:
        rec.update(tier="X", reason=f"{miss} visible lines not in replay")
    else:
        tier, check = "O", None
        key = (tuple(strip_n(call["grep_argv"])), call.get("cwd"), json.dumps(call["upstream"]))
        for ob in count_obs.get(call["trajectory_id"], []):
            if (tuple(strip_n(ob["grep_argv"])), ob["cwd"], json.dumps(ob["upstream"])) != key:
                continue
            got = len(orig) if ob["kind"] == "wc_lines" else sum(r["t"] == "m" for r in recs)
            check = {"kind": ob["kind"], "observed": ob["value"], "replayed": got}
            if ob["value"] == got:
                tier = "O+"
            break
        rec.update(tier=tier, reason=None, count_check=check)
    n_limit = call["head"] if call["head_cut"] and call["head"] else len(visible)
    rec["overflow"] = full_lines > n_limit if call["cut"] else False
    for lvl in ("F", "L", "D"):
        ev = [i for i, r in enumerate(recs) if r.get(lvl)]
        rec[f"ev_{lvl}"] = len(ev)
        rec[f"ev_{lvl}_shown"] = len(set(ev) & set(rec["shown"]))
    rec["provenance"] = {"repo": call["repo"], "commit": call["base_commit"], "grep": gver, "fs": "APFS",
                         "os": "macOS", "harness_commit": HARNESS_COMMIT}
    return rec


def call_root(call):
    """replay_sample.call_root, plus: a cwd outside the repository (OpenHands starts in /workspace) does not
    matter when every path operand is absolute under one root; the call then runs from that root."""
    root, why = _call_root(call)
    cwd = call.get("cwd") or ""
    if why and cwd and not ROOT.match(cwd):
        c2 = dict(call, cwd=None)
        root2, why2 = _call_root(c2)
        ops = [a for a in call["grep_argv"][1:] if not a.startswith("-")][1:]
        if not why2 and root2 and ops and all(ROOT.match(o) for o in ops):
            call["cwd"] = root2
            return root2, None
    return root, why


# ---------------------------------------------------------------- driver

def call_id(c):
    return hashlib.sha1(f"{c['trajectory_id']}|{c['step']}|{json.dumps(c['grep_argv'])}".encode()).hexdigest()[:16]


def harness_commit():
    r = subprocess.run(["git", "-C", HERE, "rev-parse", "--short=8", "HEAD"], capture_output=True, text=True)
    return r.stdout.strip()


HARNESS_COMMIT = harness_commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--tasks", required=True)
    ap.add_argument("--patches", required=True)
    ap.add_argument("--counts", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--kind", choices=["cut", "uncut", "all"], default="cut")
    ap.add_argument("--limit", type=int, default=0, help="replay only this many calls (seed-42 sample)")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--keep-trees-from")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    sys.path.insert(0, HERE)
    from census import final_split

    tasks = json.load(open(a.tasks))
    calls = []
    for line in open(a.candidates):
        c = json.loads(line)
        if c["source"] != "swe-rebench-v2" or c["instance_id"] not in tasks:
            continue
        assert final_split(c["repo"]) == "dev", "held-out call in the dev candidate file"
        if a.kind != "all" and c["cut"] != (a.kind == "cut"):
            continue
        c["call_id"] = call_id(c)
        c["base_commit"] = tasks[c["instance_id"]]["base_commit"]
        calls.append(c)
    rng = random.Random(42)
    if a.limit:
        calls = rng.sample(calls, min(a.limit, len(calls)))
    need = {c["instance_id"] for c in calls}
    patches = {}
    for line in open(a.patches):
        p = json.loads(line)
        if p["instance_id"] in need:
            patches[p["instance_id"]] = p["patch"]
    count_obs = collections.defaultdict(list)
    for line in open(a.counts):
        o = json.loads(line)
        count_obs[o["trajectory_id"]].append(o)
    keep = set()
    if a.keep_trees_from:
        keep = {json.loads(x)["tree"] for x in open(a.keep_trees_from)}

    groups = collections.defaultdict(list)
    for c in calls:
        groups[(c["repo"], c["base_commit"])].append(c)
    order = sorted(groups)
    rng.shuffle(order)
    done_path = os.path.join(a.out, f"done-{a.kind}.txt")
    done = set(open(done_path).read().split("\n")) if os.path.exists(done_path) else set()
    todo = [g for g in order if f"{g[0]}@{g[1]}" not in done]
    log_path = os.path.join(a.out, "progress.log")
    out_path = os.path.join(a.out, f"records-{a.kind}.jsonl.gz")
    lab_path = os.path.join(a.out, "labels-dev.jsonl")
    lock = threading.Lock()
    gver = grep_version()
    stats = collections.Counter()
    t0 = time.time()
    stop = threading.Event()

    def log(msg):
        with open(log_path, "a") as f:
            f.write(f"{dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S %Z')}CEST {msg}\n")

    log(f"start kind={a.kind} calls={len(calls)} groups={len(order)} todo={len(todo)} jobs={a.jobs} "
        f"harness={HARNESS_COMMIT} grep='{gver}'")

    def do_group(g):
        if stop.is_set():
            return
        if shutil.disk_usage(a.work).free < MIN_FREE:
            stop.set()
            log("STOP: free disk below 30 GB")
            return
        repo, commit = g
        cs = groups[g]
        tree, why = checkout(a.work, repo, commit)
        out = []
        labels_by_inst, texts_by_inst = {}, {}
        for c in cs:
            root, rwhy = call_root(c)
            if rwhy or why:
                out.append({k: c.get(k) for k in ("call_id", "trajectory_id", "instance_id", "repo", "harness",
                                                  "model", "cut", "head", "command")}
                           | {"tier": "X", "reason": rwhy or ("checkout: " + why)})
                continue
            if c["instance_id"] not in labels_by_inst:
                texts_by_inst[c["instance_id"]] = {}
                labels_by_inst[c["instance_id"]] = gold_labels(patches.get(c["instance_id"], ""), tree,
                                                               texts_by_inst[c["instance_id"]])
            try:
                out.append(replay_call(c, root, tree, labels_by_inst[c["instance_id"]], count_obs, gver))
            except Exception as e:  # never lose the group for one call
                out.append({"call_id": c["call_id"], "trajectory_id": c["trajectory_id"],
                            "instance_id": c["instance_id"], "repo": repo, "cut": c["cut"], "tier": "X",
                            "reason": f"harness error: {e!r}"[:200]})
        if tree and tree not in keep:
            shutil.rmtree(tree, ignore_errors=True)
        with lock:
            with gzip.open(out_path, "at") as f:
                for r in out:
                    f.write(json.dumps(r) + "\n")
            with open(lab_path, "a") as f:
                for iid, lab in labels_by_inst.items():
                    f.write(json.dumps({"instance_id": iid, "commit": commit, "files": lab}) + "\n")
            with gzip.open(os.path.join(a.out, "gold-files-dev.jsonl.gz"), "at") as f:
                for iid, texts in texts_by_inst.items():
                    f.write(json.dumps({"instance_id": iid, "repo": repo, "commit": commit, "files": texts}) + "\n")
            with open(done_path, "a") as f:
                f.write(f"{repo}@{commit}\n")
            for r in out:
                stats["calls"] += 1
                stats["tier:" + r["tier"]] += 1
                if r.get("overflow"):
                    stats["overflow"] += 1
                    stats["ev_D_bearing"] += r.get("ev_D", 0) > 0
            stats["groups"] += 1
            if stats["groups"] % 25 == 0 or stats["groups"] == len(todo):
                el = time.time() - t0
                eta = el / stats["groups"] * (len(todo) - stats["groups"])
                log(f"groups {stats['groups']}/{len(todo)} calls {stats['calls']} "
                    + " ".join(f"{k}={v}" for k, v in sorted(stats.items()) if k.startswith(("tier", "overflow", "ev_")))
                    + f" elapsed {el / 60:.0f} min eta {eta / 60:.0f} min "
                    f"free {shutil.disk_usage(a.work).free / 1e9:.0f} GB")

    with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as pool:
        for f in concurrent.futures.as_completed([pool.submit(do_group, g) for g in todo]):
            f.result()
    log("done " + json.dumps(dict(stats)))


if __name__ == "__main__":
    main()
