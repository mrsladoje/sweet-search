#!/usr/bin/env python3
"""shellsplit.py -- quote-aware splitting of an agent shell command into statements and
pipeline stages, plus heredoc capture. Pure functions, no I/O.

  statements(cmd) -> [ {"text": str, "stages": [str, ...], "heredocs": [str, ...]} ]

A statement is what sits between && || ; or a newline at quote depth zero. Its stages are
the pipeline members split on a single | at depth zero. Heredoc bodies (<<'EOF' ... EOF)
are removed from the text and returned separately so their contents never look like
commands (the mistake the first naive pass made on quoted regex alternations).
"""
import re, shlex

_WRAPPERS = {"timeout", "env", "nice", "time", "sudo", "nohup", "stdbuf", "exec", "command"}
# `command -v X` is a probe, not a wrapper; handled by the caller.


def _find_heredocs(cmd):
    """Return (text_without_heredoc_bodies, [bodies]). Delimiter forms: <<EOF <<'EOF' <<"EOF" <<-EOF."""
    bodies = []
    out_lines = []
    lines = cmd.split("\n")
    i = 0
    while i < len(lines):
        ln = lines[i]
        m = re.search(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1", ln)
        if not m:
            out_lines.append(ln)
            i += 1
            continue
        delim = m.group(2)
        out_lines.append(ln[:m.start()] + f" <<HEREDOC:{delim} " + ln[m.end():])
        j = i + 1
        body = []
        while j < len(lines) and lines[j].strip() != delim:
            body.append(lines[j])
            j += 1
        bodies.append("\n".join(body))
        i = j + 1
    return "\n".join(out_lines), bodies


def _split_top(text, seps):
    """Split text on any of the separator strings at quote depth zero."""
    parts, buf = [], []
    i, n = 0, len(text)
    sq = dq = bt = False
    depth = 0  # $( ) and ( ) depth
    while i < n:
        c = text[i]
        if sq:
            buf.append(c)
            if c == "'":
                sq = False
            i += 1
            continue
        if c == "\\" and i + 1 < n:
            buf.append(c); buf.append(text[i + 1]); i += 2
            continue
        if dq:
            buf.append(c)
            if c == '"':
                dq = False
            i += 1
            continue
        if bt:
            buf.append(c)
            if c == "`":
                bt = False
            i += 1
            continue
        if c == "'":
            sq = True; buf.append(c); i += 1; continue
        if c == '"':
            dq = True; buf.append(c); i += 1; continue
        if c == "`":
            bt = True; buf.append(c); i += 1; continue
        if c == "(":
            depth += 1; buf.append(c); i += 1; continue
        if c == ")":
            depth = max(0, depth - 1); buf.append(c); i += 1; continue
        if depth == 0:
            hit = None
            for s in seps:
                if text.startswith(s, i):
                    hit = s
                    break
            if hit is not None:
                # a single | must not match inside ||, and ; must not be part of ;;
                if hit == "|" and (text.startswith("||", i) or (i > 0 and text[i - 1] == "|")):
                    buf.append(c); i += 1; continue
                if hit == "|" and i + 1 < n and text[i + 1] == "&":
                    # |& (pipe stderr too) -- treat as a pipe
                    parts.append("".join(buf)); buf = []; i += 2; continue
                parts.append("".join(buf)); buf = []
                i += len(hit)
                continue
        buf.append(c)
        i += 1
    parts.append("".join(buf))
    return [p.strip() for p in parts if p.strip()]


_REDIR = re.compile(r"(?:^|\s)(?:\d?>>?|<|&>|\d>&\d|2>&1)\s*\S*")


def strip_redirections(stage):
    # keep `<<HEREDOC:X` markers, drop file redirections
    s = re.sub(r"(?<!<)<<HEREDOC:(\w+)", r" @@HEREDOC:\1 ", stage)
    s = re.sub(r"\s2>&1|\s\d?>>?\s*\S+|\s&>\s*\S+|\s<\s*\S+", " ", s)
    return s.replace("@@HEREDOC:", "<<HEREDOC:").strip()


def tokens(stage):
    """shlex tokens of a stage with redirections removed; falls back to a whitespace split."""
    s = strip_redirections(stage)
    try:
        return shlex.split(s, posix=True)
    except ValueError:
        try:
            return shlex.split(s.replace("'", "").replace('"', ""), posix=True)
        except ValueError:
            return s.split()


def program(toks):
    """(program_basename, argv_after_program) after skipping env assignments and wrappers."""
    i = 0
    while i < len(toks):
        t = toks[i]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t):
            i += 1; continue
        base = t.rsplit("/", 1)[-1]
        if base in ("(", "{", "!"):
            i += 1; continue
        if base == "timeout":
            i += 1
            while i < len(toks) and (toks[i].startswith("-") or re.match(r"^\d+[smhd]?$", toks[i])):
                i += 1
            continue
        if base == "xargs":
            i += 1
            while i < len(toks) and toks[i].startswith("-"):
                if toks[i] in ("-I", "-n", "-P", "-L", "-d", "-s"):
                    i += 2
                else:
                    i += 1
            return program(toks[i:]) if i < len(toks) else ("xargs", [])
        if base in ("env", "nice", "time", "sudo", "nohup", "stdbuf", "exec"):
            i += 1
            while i < len(toks) and toks[i].startswith("-"):
                i += 1
            continue
        if base == "command" and i + 1 < len(toks) and toks[i + 1] != "-v":
            i += 1; continue
        return base, toks[i + 1:]
    return "", []


def statements(cmd):
    text, bodies = _find_heredocs(cmd or "")
    out = []
    # attach heredoc bodies in order of appearance
    body_iter = iter(bodies)
    for st in _split_top(text, ["&&", "||", ";", "\n"]):
        st = st.strip()
        if not st or st in ("then", "else", "fi", "do", "done", "{", "}"):
            continue
        st = re.sub(r"^(?:if|then|else|elif|do|while|until|for\s+\w+\s+in|\{)\s+", "", st)
        stages = _split_top(st, ["|"])
        hd = []
        for _ in range(st.count("<<HEREDOC:")):
            try:
                hd.append(next(body_iter))
            except StopIteration:
                break
        out.append({"text": st, "stages": stages, "heredocs": hd})
    return out


if __name__ == "__main__":
    import sys, json
    for s in statements(sys.stdin.read()):
        print(json.dumps({"stages": s["stages"], "progs": [program(tokens(x))[0] for x in s["stages"]], "hd": [h[:40] for h in s["heredocs"]]}))
