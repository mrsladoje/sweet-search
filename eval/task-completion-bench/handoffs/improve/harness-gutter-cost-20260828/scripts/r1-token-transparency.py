#!/usr/bin/env python3
"""r1 — token transparency of gutter forms (task R1c, boundary-safety half).

A gutter form is TOKEN-TRANSPARENT on a line when the token sequence covering
the file's own text is byte-identical to the tokenisation of that line with no
gutter at all. When it is not transparent, the interesting failure is the
AMBIGUOUS SPACE RUN: the delimiter's trailing space fuses with the code's
leading indentation into one pure-space token, so nothing inside the token
marks where the gutter stops and the content starts. That is the mechanical
candidate for the "+1 space carry".

Usage: /tmp/tk/bin/python r1-token-transparency.py <fixture-dir>
"""
import sys, os, json
import tiktoken

ENC = tiktoken.get_encoding("o200k_base")

FORMS = {
    "none":        lambda n, l: l,
    "tab":         lambda n, l: f"{n}\t{l}",
    "pipe":        lambda n, l: f"{n}| {l}",
    "colon_space": lambda n, l: f"{n}: {l}",
    "colon":       lambda n, l: f"{n}:{l}",
    "space":       lambda n, l: f"{n} {l}",
    "pad5_tab":    lambda n, l: f"{n:5d}\t{l}",
    "pad5_2sp":    lambda n, l: f"{n:5d}  {l}",
    # candidates implied by primary sources:
    #  opencode PR #12030 moved the space BEFORE the pipe: "%05d |content"
    "sp_pipe":     lambda n, l: f"{n} |{l}",
    "pad05_sp_pipe": lambda n, l: f"{n:05d} |{l}",
    "pipe_nosp":   lambda n, l: f"{n}|{l}",
    "arrow":       lambda n, l: f"{n}\u2502{l}",
}
ORDER = list(FORMS)


def toks(s):
    return [ENC.decode_single_token_bytes(t) for t in ENC.encode(s)]


def classify(n, line, fn):
    """Return (transparent, ambiguous_space_run) for one rendered line.

    Rendered in context as "\n" + rendered so the leading-space merge that
    happens mid-block is reproduced.
    """
    bare = toks("\n" + line)
    rend = toks("\n" + fn(n, line))
    pref = fn(n, "").encode()          # the gutter prefix bytes
    # strip the tokens that are wholly inside the gutter prefix
    acc, i = b"", 0
    while i < len(rend) and len(acc) + len(rend[i]) <= len(pref) + 1:  # +1 = the "\n"
        acc += rend[i]
        i += 1
    # acc now covers "\n" + as much of the prefix as fits on token boundaries
    consumed = len(acc) - 1            # prefix bytes consumed on a boundary
    if consumed == len(pref):
        tail = rend[i:]
        transparent = tail == bare[1:]
        ambiguous = False
    else:
        # the token straddles the prefix/content boundary
        straddle = rend[i] if i < len(rend) else b""
        transparent = False
        # ambiguous iff the straddling token is a pure run of spaces
        ambiguous = len(straddle) > 0 and set(straddle) == {0x20}
    return transparent, ambiguous


def main():
    fixtures = sys.argv[1]
    files = sorted(os.listdir(fixtures))
    tot = {k: [0, 0, 0] for k in ORDER}     # transparent, ambiguous, lines
    print("=" * 92)
    print("TOKEN TRANSPARENCY — share of lines whose CONTENT tokens survive the gutter [M]")
    print("  transparent%% = content token sequence identical to the no-gutter tokenisation")
    print("  ambiguous%%   = gutter's trailing space fused into a pure-space token (+1 hazard)")
    print("=" * 92)
    per_file = {}
    for f in files:
        lines = open(os.path.join(fixtures, f), encoding="utf-8").read().split("\n")
        if lines and lines[-1] == "":
            lines = lines[:-1]
        print(f"\n{f}  ({len(lines)} lines)")
        print(f"  {'form':<13} {'transparent':>12} {'ambiguous':>12}")
        per_file[f] = {}
        for k in ORDER:
            tr = am = 0
            for i, l in enumerate(lines):
                t, a = classify(i + 1, l, FORMS[k])
                tr += t
                am += a
            n = len(lines)
            print(f"  {k:<13} {tr:>6}/{n:<5} {100*tr/n:5.1f}%"
                  f"  {am:>6}/{n:<5} {100*am/n:5.1f}%".replace("%  ", "% "))
            tot[k][0] += tr
            tot[k][1] += am
            tot[k][2] += n
            per_file[f][k] = {"transparent": tr, "ambiguous": am, "lines": n}

    print("\n" + "=" * 92)
    print("AGGREGATE [M]")
    print("=" * 92)
    print(f"  {'form':<13} {'transparent':>18} {'ambiguous space run':>24}")
    for k in ORDER:
        tr, am, n = tot[k]
        print(f"  {k:<13} {tr:>8}/{n:<6} {100*tr/n:5.1f}%   "
              f"{am:>8}/{n:<6} {100*am/n:5.1f}%")
    print("\nnote: lines that are empty or start at column 0 are transparent under every")
    print("      form, so the ambiguous share is bounded by the indented-line share.")
    ind = 0
    alln = 0
    for f in files:
        ls = open(os.path.join(fixtures, f), encoding="utf-8").read().split("\n")
        if ls and ls[-1] == "":
            ls = ls[:-1]
        alln += len(ls)
        ind += sum(1 for l in ls if l.startswith(" "))
    print(f"      space-indented lines in this corpus: {ind}/{alln} = {100*ind/alln:.1f}%")


if __name__ == "__main__":
    main()
