"""Trace parsing for the grep paper (GREP_PAPER_PLAN.md, step S1).

Turns one Open-SWE-Traces row into a list of grep-family calls with the facts the yield check
needs: harness, whether the call runs before the first edit, whether it searches files (not a
stdin filter), whether its visible output was cut, and whether a gold-patch file is visible.

Harness output formats (checked on rows of v1.1/v1.2, 2026-10-19):
  minisweagent  tool content is JSON {"returncode", "output"} or the text form
                "<returncode>N</returncode>\n<output>...</output>"; a cut output has
                output_head / output_tail / elided_chars instead of output, in either form.
  sweagent      tool content starts with "OBSERVATION:\n"; a cut has "<response clipped>".
  openhands     tool content ends with "[The command completed ...]" / "[Current working
                directory: ...]" lines; a cut has "[... Observation truncated due to length ...]".
"""

import json
import re
import shlex

GREP_TOOLS = {"grep", "egrep", "fgrep", "rg"}
BASH_TOOLS = {"bash", "execute_bash"}
EDIT_COMMANDS = {"create", "str_replace", "insert"}

OPENHANDS_TAIL = re.compile(r"\n?\[(The command completed|Current working directory|Python interpreter"
                            r"|Command finished)[^\n]*\]", re.S)
# Shell edits. Heuristic; the plan requires validating it on a hand-checked sample.
SHELL_EDIT = re.compile(
    r"(\bsed\s+(-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i|\bpatch\b|\bgit\s+apply\b|\btee\s+[^|&;]*\.\w+"
    r"|(?<![0-9&])>>?\s*(?!/dev/|/tmp/|&)[\w./-]+\.\w+|open\((?!['\"]/tmp/)[^)]*['\"][wa]['\"])")
HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n(.*?)(?:\n\s*\2\s*(?:\n|$)|$)", re.S)
QUIET = {"cd", "export", "source", "set", "true", "pushd", "popd", "unset", "alias"}
OPENHANDS_CWD = re.compile(r"\[Current working directory: ([^\]\n]+)\]")
GOLD_FILE = re.compile(r"^diff --git a/(\S+) b/(\S+)", re.M)


def _loads(value):
    return json.loads(value) if isinstance(value, str) else value


def gold_files(metadata):
    patch = (_loads(metadata) or {}).get("reference_patch") or {}
    patch = patch.get("patch") or ""
    return sorted({b for _, b in GOLD_FILE.findall(patch)})


def normalize_output(harness, content):
    """Return (text, harness_cut)."""
    if not isinstance(content, str):
        content = json.dumps(content)
    if harness == "minisweagent":
        if content.lstrip().startswith("<returncode>"):
            m = re.search(r"<output>\n?(.*?)\n?</output>", content, re.S)
            if m:
                return m.group(1), False
            head = re.search(r"<output_head>\n?(.*?)\n?</output_head>", content, re.S)
            tail = re.search(r"<output_tail>\n?(.*?)\n?</output_tail>", content, re.S)
            if head:
                return head.group(1) + "\n" + (tail.group(1) if tail else ""), True
            return content, False
        try:
            obj = json.loads(content)
        except ValueError:
            return content, False
        if isinstance(obj, dict):
            if "output" in obj:
                return obj["output"] or "", False
            if "output_head" in obj:
                return (obj.get("output_head") or "") + "\n" + (obj.get("output_tail") or ""), True
        return content, False
    if harness == "sweagent":
        cut = "<response clipped>" in content or "characters were elided" in content
        if content.startswith("OBSERVATION:\n"):
            content = content[len("OBSERVATION:\n"):]
        return content, cut
    cut = "Observation truncated due to length" in content
    return OPENHANDS_TAIL.sub("", content), cut


def strip_heredocs(command):
    """Drop here-document bodies, so code inside them is not read as shell commands."""
    return HEREDOC.sub(lambda m: m.group(0).split("\n", 1)[0] + "\n", command)


def _drop_redirects(argv):
    out, i = [], 0
    while i < len(argv):
        a = argv[i]
        if a and set(a) <= set("<>&") and a != "&":
            if out and out[-1].isdigit():
                out.pop()
            i += 2
            continue
        out.append(a)
        i += 1
    return out


def split_commands(command):
    """Split a shell line into pipelines (lists of argv). Returns None if it does not parse."""
    command = strip_heredocs(command).replace("\\\n", " ").replace("\n", " ; ")
    try:
        lex = shlex.shlex(command, posix=True, punctuation_chars=";&|<>()")
        lex.whitespace_split = True
        tokens = list(lex)
    except ValueError:
        return None
    pipelines, pipeline, argv = [], [], []
    for tok in tokens:
        if tok in ("&&", "||", ";", "&", ";;", "(", ")"):
            if argv:
                pipeline.append(argv)
            if pipeline:
                pipelines.append(pipeline)
            pipeline, argv = [], []
        elif tok in ("|", "|&"):
            if argv:
                pipeline.append(argv)
            argv = []
        else:
            argv.append(tok)
    if argv:
        pipeline.append(argv)
    if pipeline:
        pipelines.append(pipeline)
    return [[_drop_redirects(argv) for argv in p] for p in pipelines]


def _strip_prefix(argv):
    """Drop env assignments, `command`, `timeout N`, `xargs [opts]` before the tool name."""
    i, via_xargs = 0, False
    while i < len(argv):
        a = argv[i]
        if re.match(r"^\w+=", a) or a in ("command", "nice", "sudo"):
            i += 1
        elif a == "timeout":
            i += 2
        elif a == "xargs":
            via_xargs = True
            i += 1
            while i < len(argv) and argv[i].startswith("-"):
                i += 2 if argv[i] in ("-I", "-n", "-P", "-d", "-L") else 1
        else:
            break
    return argv[i:], via_xargs


def grep_operands(argv):
    """Pattern-less operands of a GNU grep or rg argv (rough: options that take a value are skipped)."""
    takes_value = {"-e", "-f", "-m", "-A", "-B", "-C", "--include", "--exclude", "--exclude-dir",
                   "-g", "--glob", "-t", "--type", "-T", "--max-count", "--context"}
    operands, pattern_given, recursive, i = [], False, False, 1
    while i < len(argv):
        a = argv[i]
        if a == "--":
            operands.extend(argv[i + 1:])
            break
        if a.startswith("-") and len(a) > 1:
            if a in ("-e", "--regexp", "-f"):
                pattern_given = True
            if a in takes_value:
                i += 2
                continue
            if a.startswith("--"):
                recursive |= a in ("--recursive", "--dereference-recursive")
            else:
                recursive |= "r" in a[1:] or "R" in a[1:]
            i += 1
            continue
        operands.append(a)
        i += 1
    if not pattern_given and operands:
        operands = operands[1:]
    return operands, recursive


def head_limit(rest):
    """Line limit of the first head/tail after the grep in a pipeline, or None."""
    for argv in rest:
        if not argv:
            continue
        if argv[0] in ("head", "tail"):
            n = 10
            for j, a in enumerate(argv[1:], 1):
                m = re.match(r"^-n?(\d+)$", a)
                if m:
                    n = int(m.group(1))
                elif a == "-n" and j + 1 < len(argv) and argv[j + 1].isdigit():
                    n = int(argv[j + 1])
            return argv[0], n
        if argv[0] in ("wc", "sort", "uniq", "cut", "awk", "sed", "grep", "egrep"):
            continue
    return None


def grep_calls(row):
    harness = row["_harness"]
    msgs = _loads(row["messages"])
    golds = gold_files(row["metadata"])
    calls, first_edit_seen, step = [], False, 0
    pending, session_cwd = [], None
    for mi, m in enumerate(msgs):
        if m["role"] == "assistant":
            pending = list(m.get("tool_calls") or [])
            continue
        if m["role"] != "tool" or not pending:
            continue
        tc = pending.pop(0)
        step += 1
        fn = tc.get("function", {}).get("name")
        try:
            args = _loads(tc["function"].get("arguments") or "{}") or {}
        except ValueError:
            args = {}
        if fn == "str_replace_editor" and args.get("command") in EDIT_COMMANDS:
            first_edit_seen = True
            continue
        if fn not in BASH_TOOLS:
            continue
        command = args.get("command") or ""
        pipelines = split_commands(command)
        is_edit = bool(SHELL_EDIT.search(command))
        if pipelines is None:
            first_edit_seen |= is_edit
            continue
        greps = []
        for p in pipelines:
            for idx, argv in enumerate(p):
                tool_argv, via_xargs = _strip_prefix(argv)
                if not tool_argv:
                    continue
                name = tool_argv[0].rsplit("/", 1)[-1]
                if name == "git" and len(tool_argv) > 1 and tool_argv[1] == "grep":
                    name, tool_argv = "git-grep", tool_argv[1:]
                if name in GREP_TOOLS or name == "git-grep":
                    greps.append((p, idx, name, tool_argv, via_xargs))
        raw = m.get("content") if isinstance(m.get("content"), str) else json.dumps(m.get("content"))
        loud = [p for p in pipelines if p and p[0] and p[0][0] not in QUIET]
        if greps:
            text, harness_cut = normalize_output(harness, m.get("content"))
            lines = [ln for ln in text.split("\n") if ln.strip()]
            for p, idx, name, tool_argv, via_xargs in greps:
                cwd = session_cwd
                for q in pipelines:
                    if q is p:
                        break
                    if q and q[0] and q[0][0] == "cd" and len(q[0]) > 1:
                        cwd = q[0][1] if q[0][1].startswith("/") or cwd is None else cwd.rstrip("/") + "/" + q[0][1]
                operands, recursive = grep_operands(tool_argv)
                stdin_filter = idx > 0 and not via_xargs
                searches_files = not stdin_filter and (via_xargs or name in ("rg", "git-grep") or recursive
                                                       or bool(operands))
                limit = head_limit(p[idx + 1:])
                head_cut = bool(limit and len(lines) >= limit[1])
                shown = [g for g in golds if any(g in ln or ln.startswith(g.rsplit("/", 1)[-1]) for ln in lines)]
                operand_is_gold = any(o.rstrip("/").endswith(g) for o in operands for g in golds)
                calls.append({
                    "step": step,
                    "msg_index": mi,
                    "tool": name,
                    "pre_edit": not first_edit_seen,
                    "searches_files": searches_files,
                    "recursive": recursive or name in ("rg", "git-grep"),
                    "via_xargs": via_xargs,
                    "n_operands": len(operands),
                    "multi_grep_command": len(greps) > 1 or len(loud) > 1,
                    "head": limit[1] if limit else None,
                    "head_kind": limit[0] if limit else None,
                    "n_lines": len(lines),
                    "head_cut": head_cut,
                    "harness_cut": harness_cut,
                    "gold_shown": bool(shown),
                    "operand_is_gold": operand_is_gold,
                    "command": command[:400],
                    "cwd": cwd,
                    "grep_argv": tool_argv,
                    "upstream": p[:idx] if via_xargs else [],
                    "visible": lines[:400],
                })
        first_edit_seen |= is_edit
        # Session cwd: OpenHands prints it; SWE-agent keeps one shell, so a top-level cd persists.
        found = OPENHANDS_CWD.findall(raw or "")
        if found:
            session_cwd = found[-1].strip()
        elif harness == "sweagent":
            for q in pipelines:
                if q and q[0] and q[0][0] == "cd" and len(q[0]) > 1 and q[0][1].startswith("/"):
                    session_cwd = q[0][1]
    return calls, golds, step
