"""Pilot ranked order for GNU grep output (GREP_PAPER_PLAN.md §5.1, line mode).

This is the pilot stand-in for the selector library: the shipped algorithm's structure (weight =
saturation x file-kind prior, one line per file first, then Sainte-Laguë, declarations first)
applied to plain GNU grep output lines. It reorders lines; it never adds, drops or edits one.

Input lines are grep's own output for a multi-file search without context flags:
`path:line:text` (-n), `path:text`, or `path` (-l). Output: the same lines in reveal order, with
an optional one-line summary first.
"""

import re

K = 2  # saturation constant, unchanged from the shipped algorithm
PRIORS = {"source": 1.0, "test": 0.5, "generated": 0.25}

TEST = re.compile(r"(^|/)(tests?|spec|specs|__tests__|testing)/|(^|/)test_[^/]*$|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$"
                  r"|Tests?\.(java|kt|cs|scala)$|_spec\.rb$")
GENERATED = re.compile(r"(^|/)(vendor|node_modules|dist|build|target|third_party|\.git)/|\.min\.(js|css)$|\.pb\.go$"
                       r"|_pb2\.py$|\.generated\.|(^|/)generated/|\.lock$|-lock\.json$|\.map$")
DECL = re.compile(r"^\s*(export\s+)?(default\s+)?(pub(\([^)]*\))?\s+)?(async\s+)?(static\s+)?"
                  r"(def|class|func|fn|function|interface|struct|enum|trait|type|impl|module|object|record|protocol)\b")


def kind(path):
    if GENERATED.search(path):
        return "generated"
    if TEST.search(path):
        return "test"
    return "source"


def split_line(line, numbered):
    """Return (path, text) for one grep output line."""
    if numbered:
        m = re.match(r"^(.*?):(\d+):(.*)$", line)
        if m:
            return m.group(1), m.group(3)
    path, sep, text = line.partition(":")
    return (path, text) if sep else (line, "")


def reveal_order(lines, numbered):
    files, order = {}, []
    for ln in lines:
        path, text = split_line(ln, numbered)
        if path not in files:
            files[path] = []
            order.append(path)
        files[path].append((ln, bool(DECL.match(text))))
    weight = {}
    for p in order:
        h = len(files[p])
        weight[p] = h / (h + K) * PRIORS[kind(p)]
    admitted = sorted(order, key=lambda p: (-weight[p], p))
    queues = {p: [ln for ln, d in files[p] if d] + [ln for ln, d in files[p] if not d] for p in admitted}
    out = [queues[p].pop(0) for p in admitted]          # phase 1: one line per file
    taken = {p: 1 for p in admitted}
    while True:                                          # phase 2: Sainte-Laguë
        best = None
        for p in admitted:
            if queues[p]:
                q = weight[p] / (2 * taken[p] + 1)
                if best is None or q > best[0]:
                    best = (q, p)
        if best is None:
            break
        p = best[1]
        out.append(queues[p].pop(0))
        taken[p] += 1
    return out, len(order)


def ranked(lines, numbered, header=True):
    out, n_files = reveal_order(lines, numbered)
    if header and out:
        out = [f"# {len(lines)} matching lines in {n_files} files, ranked (most relevant files first, "
               f"one line per file before repeats)"] + out
    return out
