#!/usr/bin/env python3
"""`grep` for the agent check: GNU grep, plus ranked order in the "ranked" arm.

Installed as `grep` (and `egrep`, `fgrep`) first on the sandbox PATH. Both arms get GNU grep
(macOS ships BSD grep). With GREP_ARM=ranked, a multi-file search without context, count,
quiet or only-matching flags prints its lines in the ranked order of ranker.py. Everything else
passes through unchanged, with grep's own exit code and stderr.
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

PASS_FLAGS = set("ABCcqLoZzvh")  # context, count, quiet, files-without-match, only-matching, NUL, invert, no-filename


def wants_ranking(argv):
    recursive, operands, pattern_given, skip = False, [], False, False
    takes_value = {"-e", "-f", "-m", "-A", "-B", "-C", "--include", "--exclude", "--exclude-dir", "--max-count"}
    for i, a in enumerate(argv):
        if skip:
            skip = False
            continue
        if a.startswith("--"):
            name = a.split("=", 1)[0]
            if name in ("--context", "--after-context", "--before-context", "--count", "--quiet", "--silent",
                        "--files-without-match", "--only-matching", "--null", "--invert-match", "--no-filename"):
                return False
            recursive |= name in ("--recursive", "--dereference-recursive")
            pattern_given |= name in ("--regexp", "--file")
            skip = a in takes_value
            continue
        if a.startswith("-") and len(a) > 1:
            letters = a[1:]
            if any(ch in PASS_FLAGS for ch in letters):
                return False
            recursive |= "r" in letters or "R" in letters
            pattern_given |= "e" in letters or "f" in letters
            skip = a in takes_value or letters[-1] in "efm" and len(letters) == 1
            continue
        operands.append(a)
    paths = operands if pattern_given else operands[1:]
    return recursive or len(paths) > 1


def main():
    name = os.path.basename(sys.argv[0])
    argv = sys.argv[1:]
    extra = {"egrep": ["-E"], "fgrep": ["-F"]}.get(name, [])
    real = os.environ.get("GREP_REAL", "ggrep")
    if os.environ.get("GREP_ARM") != "ranked" or not wants_ranking(argv):
        os.execvp(real, [real] + extra + argv)
    from ranker import ranked
    r = subprocess.run([real] + extra + argv, capture_output=True)
    sys.stderr.buffer.write(r.stderr)
    if r.returncode != 0 or not r.stdout:
        sys.stdout.buffer.write(r.stdout)
        sys.exit(r.returncode)
    text = r.stdout.decode("utf-8", errors="surrogateescape")
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    numbered = any(a == "-n" or (a.startswith("-") and not a.startswith("--") and "n" in a[1:]) or a == "--line-number"
                   for a in argv)
    out = ranked(lines, numbered, header=os.environ.get("GREP_HEADER", "1") == "1")
    try:
        sys.stdout.buffer.write(("\n".join(out) + "\n").encode("utf-8", errors="surrogateescape"))
        sys.stdout.flush()
    except BrokenPipeError:  # `| head` closed the pipe, as with real grep
        os._exit(0)
    sys.exit(0)


if __name__ == "__main__":
    main()
