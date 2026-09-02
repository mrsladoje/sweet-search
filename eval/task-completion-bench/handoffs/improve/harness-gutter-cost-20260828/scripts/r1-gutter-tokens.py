#!/usr/bin/env python3
"""r1 — gutter tokenisation micro-study (task R1c).

Measures, with tiktoken o200k_base (the public GPT-5-family encoding; the exact
tokenizer of openai/gpt-5.6-luna is NOT public), the per-line token cost of ten
line-number gutter forms over real source files, and shows exactly where the
token boundaries fall for lines indented with 0 / 2 / 4 / 8 spaces and a tab.

Usage:  /tmp/tk/bin/python r1-gutter-tokens.py <fixture-dir> [--json out.json]

Every number this prints is [M] measured.
"""
import sys, os, json, re, argparse
import tiktoken

ENC = tiktoken.get_encoding("o200k_base")

# ---------------------------------------------------------------- gutter forms
def f_none(n, line):      return line
def f_tab(n, line):       return f"{n}\t{line}"
def f_pipe(n, line):      return f"{n}| {line}"
def f_colon_sp(n, line):  return f"{n}: {line}"
def f_colon(n, line):     return f"{n}:{line}"
def f_space(n, line):     return f"{n} {line}"
def f_pad5_tab(n, line):  return f"{n:5d}\t{line}"
def f_pad5_2sp(n, line):  return f"{n:5d}  {line}"

DENSE_FORMS = [
    ("none",          f_none,      "no gutter"),
    ("tab",           f_tab,       "N<TAB>   (shipped)"),
    ("pipe",          f_pipe,      "N| "),
    ("colon_space",   f_colon_sp,  "N:       (opencode's own)".replace("N: ", "N: ")),
    ("colon",         f_colon,     "N:       no trailing space"),
    ("space",         f_space,     "N        single space"),
    ("pad5_tab",      f_pad5_tab,  "%5d<TAB> right-padded"),
    ("pad5_2sp",      f_pad5_2sp,  "%5d__    padded, cat -n style"),
    ("sp_pipe",       lambda n, l: f"{n} |{l}",     "N_|      space BEFORE pipe (opencode PR 12030)"),
    ("pad05_sp_pipe", lambda n, l: f"{n:05d} |{l}", "%05d_|   opencode PR 12030 exact"),
    ("pipe_nosp",     lambda n, l: f"{n}|{l}",      "N|       no trailing space"),
]

# landmark = "line begins a symbol": function / class / def / method / const-fn
LANDMARK_RE = re.compile(
    r"^\s*("
    r"(export\s+)?(async\s+)?function\b"          # js/ts
    r"|(export\s+)?(default\s+)?class\b"
    r"|def\s+\w+\s*\("                            # python
    r"|class\s+\w+"
    r"|func\s+(\([^)]*\)\s*)?\w+\s*\("            # go
    r"|type\s+\w+\s+(struct|interface)\b"
    r"|\w[\w.]*\s*(<-|=)\s*function\s*\("         # R
    r"|(var|const|let)\s+\w+\s*=\s*(async\s+)?(function|\()"
    r"|\w+\s*:\s*function\s*\("
    r"|@\w+"                                      # decorators
    r")"
)


def render(lines, form_fn):
    return "\n".join(form_fn(i + 1, l) for i, l in enumerate(lines))


def render_sparse(lines, every):
    out = []
    for i, l in enumerate(lines):
        n = i + 1
        out.append(f"{n}\t{l}" if n % every == 0 else l)
    return "\n".join(out)


def render_landmark(lines):
    out, hits = [], 0
    for i, l in enumerate(lines):
        n = i + 1
        if LANDMARK_RE.match(l):
            out.append(f"{n}\t{l}")
            hits += 1
        else:
            out.append(l)
    return "\n".join(out), hits


# --------------------------------------------------------------- token offsets
def token_spans(text):
    """[(token_id, decoded_str, char_start, char_end)] over `text`."""
    ids = ENC.encode(text)
    spans, pos, buf = [], 0, b""
    # decode incrementally in bytes so multi-byte pieces line up
    raws = [ENC.decode_single_token_bytes(t) for t in ids]
    btext = text.encode("utf-8")
    bpos = 0
    for t, raw in zip(ids, raws):
        start = bpos
        bpos += len(raw)
        spans.append((t, raw.decode("utf-8", "replace"), start, bpos))
    assert bpos == len(btext), f"offset drift {bpos} != {len(btext)}"
    return spans


def vis(s):
    return (s.replace("\t", "\\t").replace("\n", "\\n").replace(" ", "·"))


def tokens_for_line(text, spans, line_idx):
    """Tokens overlapping byte range of line `line_idx` (0-based) of `text`."""
    b = text.encode("utf-8")
    starts, pos = [], 0
    for ln in b.split(b"\n"):
        starts.append(pos)
        pos += len(ln) + 1
    s = starts[line_idx]
    e = s + len(b.split(b"\n")[line_idx])
    return [sp for sp in spans if sp[2] < e and sp[3] > s]


# ------------------------------------------------------------------- main body
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fixtures")
    ap.add_argument("--json", default=None)
    ap.add_argument("--window", type=int, default=0,
                    help="if >0, measure only the first N lines of each file")
    args = ap.parse_args()

    files = sorted(os.listdir(args.fixtures))
    report = {"encoding": "o200k_base", "files": {}, "aggregate": {}, "boundaries": {}}

    agg = {}   # form -> [tokens, lines]

    print("=" * 88)
    print("PART 1 — tokens per line, by gutter form, real source files (o200k_base) [M]")
    print("=" * 88)

    for fn in files:
        p = os.path.join(args.fixtures, fn)
        raw = open(p, encoding="utf-8").read()
        lines = raw.split("\n")
        if lines and lines[-1] == "":
            lines = lines[:-1]
        if args.window:
            lines = lines[: args.window]
        nl = len(lines)

        rows = []
        for key, fnc, label in DENSE_FORMS:
            txt = render(lines, fnc)
            tk = len(ENC.encode(txt))
            rows.append((key, label, tk))
            agg.setdefault(key, [0, 0])
            agg[key][0] += tk
            agg[key][1] += nl
        for every in (5, 10):
            key = f"sparse{every}"
            txt = render_sparse(lines, every)
            tk = len(ENC.encode(txt))
            rows.append((key, f"tab on every {every}th line", tk))
            agg.setdefault(key, [0, 0])
            agg[key][0] += tk
            agg[key][1] += nl
        txt, hits = render_landmark(lines)
        tk = len(ENC.encode(txt))
        rows.append(("landmark", f"tab on symbol starts ({hits}/{nl} lines)", tk))
        agg.setdefault("landmark", [0, 0])
        agg["landmark"][0] += tk
        agg["landmark"][1] += nl

        base = [r for r in rows if r[0] == "none"][0][2]
        print(f"\n{fn}  ({nl} lines, {len(raw)} bytes)")
        print(f"  {'form':<14} {'tokens':>8} {'tok/line':>9} {'+/line':>8} {'ratio':>7}")
        for key, label, tk in rows:
            print(f"  {key:<14} {tk:>8} {tk/nl:>9.3f} "
                  f"{(tk-base)/nl:>+8.3f} {tk/base:>7.4f}")
        report["files"][fn] = {
            "lines": nl, "bytes": len(raw),
            "forms": {k: {"tokens": t, "per_line": t / nl,
                          "overhead_per_line": (t - base) / nl, "ratio": t / base}
                      for k, _l, t in rows},
        }

    print("\n" + "=" * 88)
    print("AGGREGATE over all fixture files [M]")
    print("=" * 88)
    base_tok, base_lines = agg["none"]
    baseline_pl = base_tok / base_lines
    print(f"  {'form':<14} {'tokens':>9} {'tok/line':>9} {'+/line':>8} {'ratio':>7}")
    order = [k for k, _f, _l in DENSE_FORMS] + ["sparse5", "sparse10", "landmark"]
    for key in order:
        t, n = agg[key]
        print(f"  {key:<14} {t:>9} {t/n:>9.3f} {t/n - baseline_pl:>+8.3f} "
              f"{(t/n)/baseline_pl:>7.4f}")
        report["aggregate"][key] = {"tokens": t, "lines": n, "per_line": t / n,
                                    "overhead_per_line": t / n - baseline_pl,
                                    "ratio": (t / n) / baseline_pl}

    # ------------------------------------------------- PART 2: token boundaries
    print("\n" + "=" * 88)
    print("PART 2 — WHERE the boundaries fall: indentation 0/2/4/8 spaces + TAB [M]")
    print("     · = space   \\t = tab   | token separators shown as  [tok]")
    print("=" * 88)

    probes = [
        ("0sp",  "res <- detect_mistakes("),
        ("2sp",  "  res <- detect_mistakes("),
        ("4sp",  "    res <- detect_mistakes("),
        ("6sp",  "      res <- detect_mistakes("),   # the real gradethis case
        ("8sp",  "        res <- detect_mistakes("),
        ("tab",  "\tif err != nil {"),
        ("2tab", "\t\treturn nil, err"),
    ]
    N = 35

    for key, fnc, label in DENSE_FORMS:
        print(f"\n--- form {key}  ({label.strip()}) ---")
        bl = {}
        for pname, body in probes:
            # tokenise in context: a preceding rendered line + this one
            prev = fnc(N - 1, "})")
            text = prev + "\n" + fnc(N, body)
            spans = token_spans(text)
            toks = tokens_for_line(text, spans, 1)
            shown = " ".join(f"[{vis(s[1])}]" for s in toks[:9])
            print(f"  {pname:>5}: {shown}")
            bl[pname] = [s[1] for s in toks[:9]]
        report["boundaries"][key] = bl

    # focused question: does the delimiter's trailing space merge with the indent?
    print("\n" + "=" * 88)
    print("PART 3 — the merge test: is there a token boundary between the gutter")
    print("         delimiter and the code's own indentation? [M]")
    print("=" * 88)
    print(f"  {'form':<14} {'indent':>7}  {'gutter token':<16} {'next token':<16} merged?")
    merge_rows = []
    for key, fnc, label in DENSE_FORMS:
        for pname, body in [("2sp", "  x = 1"), ("4sp", "    x = 1"),
                            ("6sp", "      x = 1"), ("8sp", "        x = 1"),
                            ("tab", "\tx := 1")]:
            text = fnc(N - 1, "})") + "\n" + fnc(N, body)
            spans = token_spans(text)
            toks = [t[1] for t in tokens_for_line(text, spans, 1)]
            if key == "none":
                merged = None
                g, nx = "-", vis(toks[0]) if toks else ""
            else:
                # find the token that contains the last char of the gutter prefix
                pref = fnc(N, "")            # gutter prefix only
                plen = len(pref.encode())
                # byte offset of line start
                lstart = len((fnc(N - 1, "})") + "\n").encode())
                sp = [t for t in tokens_for_line(text, spans, 1)]
                gutter_tok = None
                for t in sp:
                    if t[2] < lstart + plen <= t[3]:
                        gutter_tok = t
                        break
                merged = bool(gutter_tok and gutter_tok[3] > lstart + plen)
                idx = sp.index(gutter_tok) if gutter_tok else -1
                g = vis(gutter_tok[1]) if gutter_tok else "?"
                nx = vis(sp[idx + 1][1]) if 0 <= idx < len(sp) - 1 else ""
            print(f"  {key:<14} {pname:>7}  {g:<16} {nx:<16} "
                  f"{'YES  <-- no boundary' if merged else ('n/a' if merged is None else 'no')}")
            merge_rows.append({"form": key, "indent": pname, "gutter_token": g,
                               "next_token": nx, "merged": merged})
    report["merge_test"] = merge_rows

    # ---------------------------------------------- PART 4: six real lines/form
    print("\n" + "=" * 88)
    print("PART 4 — six real fixture lines per form, full token strings [M]")
    print("=" * 88)
    sample_src = []
    for fn in ["detect_mistakes.R", "eth.go", "underscore.js", "traceback.py"]:
        p = os.path.join(args.fixtures, fn)
        if not os.path.exists(p):
            continue
        ls = open(p, encoding="utf-8").read().split("\n")
        for i, l in enumerate(ls):
            if l.strip() and (l.startswith("    ") or l.startswith("\t") or l.startswith("  ")):
                sample_src.append((fn, i + 1, l))
                if len([s for s in sample_src if s[0] == fn]) >= 2:
                    break
    report["samples"] = {}
    for key, fnc, label in DENSE_FORMS:
        print(f"\n--- form {key} ---")
        rows = []
        for fn, ln, body in sample_src[:6]:
            text = fnc(ln - 1, "// prev") + "\n" + fnc(ln, body)
            spans = token_spans(text)
            toks = [vis(t[1]) for t in tokens_for_line(text, spans, 1)]
            print(f"  {fn}:{ln}  n={len(toks)}")
            print(f"     " + " ".join(f"[{t}]" for t in toks[:14]))
            rows.append({"file": fn, "line": ln, "ntok": len(toks), "tokens": toks})
        report["samples"][key] = rows

    if args.json:
        json.dump(report, open(args.json, "w"), indent=1)
        print(f"\n[json] {args.json}")


if __name__ == "__main__":
    main()
