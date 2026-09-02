#!/usr/bin/env python3
"""classify_calls.py -- classify every tool call of the production-form fresh-pool runs by
capability and price it in o200k_base tokens.

  venv/bin/python classify_calls.py events-<h>.jsonl.gz ... -o calls-classified.jsonl.gz

Input: records written by extract-events.py (one per tool call).
Output: one record per call with
  ops        list of operations (one per shell statement, or one for a structured tool):
             {cap, sub, tags, prog, via, pattern, paths, text}
  cap        primary capability of the whole call (first op by precedence)
  tokIn/tokOut  o200k_base tokens of the call input and of the delivered result

Capability vocabulary (cap):
  grep.literal grep.regex   content search      (grep/rg/ag/git grep, harness grep, ss-grep, ss-find --regex)
  search.semantic           ranked semantic search (ss-search, ss-find query) -- sweet only
  read.range read.whole     file reading         (sed -n/head/tail/awk/cat/nl, Read tool, ss-read, ss-semantic)
  glob                      filename discovery   (find -name, fd, ls <glob>, git ls-files | grep, glob tool)
  list                      directory listing    (ls dir, tree, find -type d, list tool)
  git.history git.state git.other
  test build runtime deps symbol edit plan poll delegate web misc
via: native | harness | ss   (how the capability was performed)
"""
import sys, os, re, json, gzip, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shellsplit import statements, tokens, program

import tiktoken
ENC = tiktoken.get_encoding("o200k_base")
def ntok(s):
    if not s:
        return 0
    try:
        return len(ENC.encode(s, disallowed_special=()))
    except Exception:
        return len(s) // 4

SS_TOOLS = {"ss-search", "ss-grep", "ss-find", "ss-semantic", "ss-trace", "ss-read", "ss-batch", "ss-files", "ss-edit"}
GREP_PROGS = {"grep", "egrep", "fgrep", "rg", "ag", "ack"}
READ_PROGS = {"cat", "sed", "head", "tail", "nl", "awk", "less", "more", "bat", "tac", "cut"}
LIST_PROGS = {"ls", "tree", "find", "fd", "fdfind", "exa", "eza"}
TEST_PROGS = {"run_tests", "pytest", "py.test", "jest", "mocha", "vitest", "ava", "tap", "tape", "rspec", "phpunit", "busted", "nosetests", "tox", "nox"}
TEST_SUBCMDS = {("npm", "test"), ("npm", "t"), ("yarn", "test"), ("pnpm", "test"), ("go", "test"), ("cargo", "test"), ("dotnet", "test"), ("mix", "test"), ("mvn", "test"), ("gradle", "test"), ("gradlew", "test"), ("make", "test"), ("make", "check"), ("bundle", "exec"), ("dart", "test"), ("flutter", "test"), ("swift", "test"), ("rake", "test"), ("rake", "spec"), ("composer", "test"), ("b2", "test"), ("hatch", "test"), ("poetry", "run"), ("uv", "run"), ("python", "-m"), ("python3", "-m"), ("node", "--test"), ("deno", "test"), ("bun", "test"), ("stack", "test"), ("cabal", "test"), ("lein", "test"), ("sbt", "test"), ("ctest", None)}
BUILD_PROGS = {"tsc", "gofmt", "goimports", "eslint", "prettier", "black", "ruff", "flake8", "mypy", "pyright", "pylint", "isort", "webpack", "rollup", "esbuild", "babel", "cmake", "ninja", "gcc", "g++", "clang", "clang++", "javac", "rustc", "rustfmt", "cargo-fmt", "b2", "bjam", "ncc", "make", "mvn", "gradle", "gradlew", "msbuild", "nuget", "solhint", "shellcheck", "elm", "swiftc", "dartfmt", "stylua", "luacheck", "clippy", "vet", "credo", "dialyzer", "standard", "xo", "tslint", "stylelint", "biome", "oxlint"}
BUILD_SUBCMDS = {("npm", "run"), ("npm", "install"), ("npm", "ci"), ("npm", "i"), ("npm", "link"), ("npm", "pack"), ("npm", "prune"), ("yarn", "install"), ("yarn", "build"), ("yarn", "lint"), ("pnpm", "install"), ("pnpm", "build"), ("go", "build"), ("go", "vet"), ("go", "fmt"), ("go", "generate"), ("go", "mod"), ("go", "get"), ("go", "install"), ("cargo", "build"), ("cargo", "check"), ("cargo", "clippy"), ("cargo", "fmt"), ("dotnet", "build"), ("dotnet", "restore"), ("dotnet", "format"), ("dotnet", "pack"), ("mix", "compile"), ("mix", "format"), ("mix", "deps.get"), ("mix", "deps.compile"), ("mix", "credo"), ("mix", "dialyzer"), ("mix", "xref"), ("pip", "install"), ("pip3", "install"), ("uv", "pip"), ("uv", "sync"), ("poetry", "install"), ("bundle", "install"), ("gem", "install"), ("composer", "install"), ("composer", "dump-autoload"), ("dart", "pub"), ("dart", "format"), ("dart", "analyze"), ("flutter", "pub"), ("swift", "build"), ("stack", "build"), ("cabal", "build"), ("gradle", "build"), ("mvn", "compile"), ("mvn", "package"), ("mvn", "install"), ("apt-get", None), ("apt", None), ("brew", None), ("npx", "tsc"), ("npx", "eslint"), ("npx", "prettier"), ("npx", "ncc"), ("npx", "webpack"), ("npx", "rollup"), ("npx", "esbuild"), ("npx", "babel"), ("npx", "solhint"), ("npx", "biome")}
RUNTIME_PROGS = {"python", "python3", "python2", "node", "nodejs", "ruby", "elixir", "iex", "erl", "Rscript", "R", "deno", "bun", "php", "lua", "lua5.1", "lua5.3", "lua5.4", "luajit", "perl", "ghci", "runghc", "swift", "dart", "julia", "tsx", "ts-node", "dotnet", "go", "java", "jshell", "scala", "kotlinc", "irb", "pry", "ipython", "jq", "yq"}
DEPS_QUERY = {("pip", "show"), ("pip", "list"), ("pip", "freeze"), ("pip3", "show"), ("pip3", "list"), ("pip3", "freeze"), ("pip", "download"), ("npm", "ls"), ("npm", "list"), ("npm", "view"), ("npm", "info"), ("npm", "explain"), ("npm", "why"), ("npm", "outdated"), ("npm", "show"), ("yarn", "why"), ("yarn", "list"), ("yarn", "info"), ("pnpm", "ls"), ("pnpm", "why"), ("pnpm", "list"), ("go", "list"), ("go", "doc"), ("go", "env"), ("go", "version"), ("cargo", "tree"), ("cargo", "metadata"), ("dotnet", "list"), ("dotnet", "nuget"), ("dotnet", "--info"), ("dotnet", "--version"), ("mix", "deps"), ("mix", "hex.info"), ("mix", "hex.outdated"), ("bundle", "show"), ("bundle", "list"), ("bundle", "info"), ("gem", "list"), ("gem", "which"), ("gem", "contents"), ("gem", "spec"), ("composer", "show"), ("mvn", "dependency:tree"), ("gradle", "dependencies"), ("nuget", "list"), ("pub", "deps"), ("dart", "pub"), ("node", "--version"), ("node", "-v"), ("python", "--version"), ("python3", "--version"), ("elixir", "--version"), ("mix", "--version"), ("go", "version"), ("java", "-version"), ("npm", "--version"), ("npm", "-v"), ("ruby", "--version"), ("ruby", "-v")}
DEP_PATH = re.compile(r"(?:^|/)(?:node_modules|site-packages|dist-packages|vendor|deps|_build|\.cargo|\.m2|\.nuget|\.venv|venv|\.gem|gems|\.hex|\.mix|\.pub-cache|dart-sdk|\.local/lib/python[\d.]*|go/pkg/mod|pkg/mod|\.deno|\.bun|\.npm|\.yarn|\.pnpm-store|\.dotnet|\.rustup|\.stack|\.cabal|\.ghcup|R/library|\.tox|\.nox|__pycache__)(?:/|$)|^/usr/(?:local/)?lib/(?:python|node|R|ruby|go)|^/opt/|/lib/python\d")
MANIFEST = re.compile(r"(?:^|/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.mod|go\.sum|mix\.exs|mix\.lock|Cargo\.toml|Cargo\.lock|pyproject\.toml|setup\.py|setup\.cfg|requirements[\w.-]*\.txt|Pipfile|poetry\.lock|Gemfile|Gemfile\.lock|[\w.-]+\.(?:csproj|fsproj|vbproj|sln|props|targets|nuspec)|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|pubspec\.yaml|pubspec\.lock|composer\.json|composer\.lock|Jamroot(?:\.jam)?|Jamfile(?:\.v2|\.jam)?|tsconfig[\w.]*\.json|jest\.config\.\w+|vitest\.config\.\w+|\.eslintrc[\w.]*|tox\.ini|Makefile|CMakeLists\.txt|Rakefile|\.mocharc[\w.]*|babel\.config\.\w+|\.babelrc|rollup\.config\.\w+|webpack\.config\.\w+|codecov\.yml|\.github/workflows/[\w.-]+\.ya?ml|action\.ya?ml|DESCRIPTION|NAMESPACE)$")
REGEX_META = re.compile(r"(?<!\\)[.*+?\[\](){}|^$]")
DEFN_PAT = re.compile(r"^\^?\s*(?:(?:export\s+)?(?:async\s+)?(?:def|class|function|func|fn|struct|interface|type|trait|enum|module|defmodule|defp?|impl|record|protocol|extension|rule|macro|proc|sub|const|let|var|val|public|private|protected|static|abstract|override|virtual)\b|@\w+)|\b(?:def|class|function|func|fn|struct|interface|type|enum|module|defmodule|rule)\s+[\\\[\w(\s|]*$")

CAP_PREC = ["edit", "test", "build", "runtime", "deps", "grep.literal", "grep.regex", "search.semantic", "symbol", "read.range", "read.whole", "glob", "list", "git.history", "git.state", "git.other", "web", "poll", "plan", "delegate", "misc"]
def prec(cap):
    return CAP_PREC.index(cap) if cap in CAP_PREC else len(CAP_PREC)

GREP_VALUE_FLAGS = {"-e", "--regexp", "-f", "--file", "-m", "--max-count", "-A", "-B", "-C", "--context", "--after-context", "--before-context", "--include", "--exclude", "--exclude-dir", "-g", "--glob", "--iglob", "-t", "--type", "-T", "--type-not", "--max-depth", "-d", "--color", "--colour", "-E_", "--replace", "-r_", "--max-filesize", "--sort", "--sortr", "-j", "--threads", "--pre", "--encoding"}
def parse_grep(argv, prog):
    """Return (pattern, paths, flags:set, ctx:int|None, includes:list, patterns:list)."""
    flags, paths, pats, includes = set(), [], [], []
    ctx = None
    i = 0
    dashdash = False
    while i < len(argv):
        a = argv[i]
        if dashdash or not a.startswith("-") or a == "-":
            if pats or "-e" in flags:
                paths.append(a)
            else:
                pats.append(a)
            i += 1; continue
        if a == "--":
            dashdash = True; i += 1; continue
        if a.startswith("--"):
            name, eq, val = a.partition("=")
            flags.add(name)
            if name in ("--include", "--glob", "--iglob", "--type", "--exclude", "--exclude-dir", "--type-not"):
                if not eq:
                    val = argv[i + 1] if i + 1 < len(argv) else ""; i += 1
                if name in ("--include", "--glob", "--iglob", "--type"):
                    includes.append(val)
            elif name in ("--regexp",):
                if not eq:
                    val = argv[i + 1] if i + 1 < len(argv) else ""; i += 1
                pats.append(val); flags.add("-e")
            elif name in ("--context", "--after-context", "--before-context", "--max-count", "--max-depth", "--file", "--replace", "--sort", "--sortr", "--threads", "--pre", "--encoding", "--max-filesize", "--color", "--colour"):
                if not eq:
                    i += 1
                if name in ("--context", "--after-context", "--before-context"):
                    try: ctx = max(ctx or 0, int(val or argv[i]))
                    except Exception: ctx = ctx or 1
            i += 1; continue
        # short flags, possibly bundled, possibly with attached value (-A5, -C3, -k20, -m1, -e pat, -g glob)
        j = 1
        while j < len(a):
            ch = a[j]
            f = "-" + ch
            if ch in "ABCmgtTfedj" or (ch == "r" and prog == "rg" and False):
                rest = a[j + 1:]
                if ch in "ABC":
                    flags.add(f)
                    val = rest if rest else (argv[i + 1] if i + 1 < len(argv) else "")
                    if not rest: i += 1
                    try: ctx = max(ctx or 0, int(val))
                    except Exception: ctx = ctx or 1
                elif ch == "e":
                    flags.add("-e")
                    val = rest if rest else (argv[i + 1] if i + 1 < len(argv) else "")
                    if not rest: i += 1
                    pats.append(val)
                elif ch in "gt":
                    flags.add(f)
                    val = rest if rest else (argv[i + 1] if i + 1 < len(argv) else "")
                    if not rest: i += 1
                    includes.append(val)
                else:
                    flags.add(f)
                    if not rest: i += 1
                break
            flags.add(f)
            j += 1
        i += 1
    pattern = pats[0] if pats else ""
    return pattern, paths, flags, ctx, includes, pats

def is_literal_pattern(pat, flags):
    if "-F" in flags or "--fixed-strings" in flags:
        return True
    if not pat:
        return True
    # a pattern whose only metacharacters are escaped ( \( \. \[ ) is literal-intent
    return REGEX_META.search(pat) is None

def path_tags(paths):
    tags = set()
    for p in paths:
        if DEP_PATH.search(p): tags.add("dep-path")
        if MANIFEST.search(p): tags.add("manifest")
        if re.search(r"(?:^|/)(?:test|tests|spec|specs|__tests__|test_\w+|\w+_test\.\w+|\w+\.test\.\w+|\w+_spec\.\w+|\w+Tests?\.\w+)(?:/|$)", p): tags.add("test-path")
        if re.search(r"(?:^|/)(?:dist|build|out|target|bin|obj|_build|coverage)(?:/|$)", p): tags.add("build-path")
    return tags

def op(cap, sub=None, tags=(), prog="", via="native", pattern=None, paths=(), text="", extra=None):
    d = {"cap": cap, "sub": sub, "tags": sorted(set(tags)), "prog": prog, "via": via, "pattern": pattern, "paths": list(paths), "text": text[:300]}
    if extra:
        d.update(extra)
    return d

def classify_stage(stage, heredocs):
    """Classify ONE pipeline stage. Returns op dict or None for trivial stages."""
    toks = tokens(stage)
    prog, argv = program(toks)
    text = stage
    if not prog:
        return None
    hd = "<<HEREDOC:" in stage
    # ---------------- ss-* tools
    if prog in SS_TOOLS:
        args = argv
        flags = set(a for a in args if a.startswith("-"))
        pos = []
        scopes = []
        regex_opt = None
        i = 0
        while i < len(args):
            a = args[i]
            if a in ("--in", "--file"):
                scopes.append(args[i + 1] if i + 1 < len(args) else ""); i += 2; continue
            if a == "--regex":
                regex_opt = args[i + 1] if i + 1 < len(args) else ""; i += 2; continue
            if a in ("-k", "--top", "--mode", "--max-tokens", "--query", "--hint", "--depth", "--budget"):
                i += 2; continue
            if a.startswith("-k") and len(a) > 2 and a[2:].isdigit():
                i += 1; continue
            if a.startswith("-"):
                i += 1; continue
            pos.append(a); i += 1
        if prog == "ss-grep":
            pat = pos[0] if pos else ""
            lit = is_literal_pattern(pat, {"-F"} if ("-F" in flags or "--fixed-strings" in flags) else set())
            tags = set(path_tags(scopes + pos[1:]))
            if scopes: tags.add("scoped")
            if pos[1:]: tags.add("positional-path")
            if "-i" in flags or "--ignore-case" in flags: tags.add("icase")
            if "-w" in flags or "--word-regexp" in flags: tags.add("word")
            if DEFN_PAT.search(pat or ""): tags.add("defn")
            return op("grep.literal" if lit else "grep.regex", "ss-grep", tags, prog, "ss", pat, scopes + pos[1:], text)
        if prog == "ss-find":
            q = pos[0] if pos else ""
            tags = set(path_tags(scopes))
            if scopes: tags.add("scoped")
            if regex_opt is not None:
                lit = is_literal_pattern(regex_opt, set())
                tags.add("with-query")
                return op("grep.literal" if lit else "grep.regex", "ss-find", tags, prog, "ss", regex_opt, scopes, text, {"query": q})
            return op("search.semantic", "ss-find", tags, prog, "ss", q, scopes, text)
        if prog == "ss-search":
            return op("search.semantic", "ss-search", set(), prog, "ss", pos[0] if pos else "", [], text)
        if prog == "ss-read":
            f = pos[0] if pos else ""
            tags = set(path_tags([f]))
            if "--force" in flags: tags.add("force")
            if len(pos) >= 2 or (len(pos) == 1 and re.search(r"\d+[-:,]\d+$", f)):
                if len(pos) == 2 and not re.search(r"[-:,]", pos[1]):
                    tags.add("single-line")
                return op("read.range", "ss-read", tags, prog, "ss", None, [f], text)
            return op("read.whole", "ss-read", tags, prog, "ss", None, [f], text)
        if prog == "ss-semantic":
            f = pos[0] if pos else ""
            return op("read.range", "ss-semantic", {"semantic"} | path_tags([f]), prog, "ss", pos[1] if len(pos) > 1 else "", [f], text)
        if prog == "ss-trace":
            return op("symbol", "ss-trace", {"scoped"} if scopes else set(), prog, "ss", pos[0] if pos else "", scopes, text)
        return op("misc", prog, set(), prog, "ss", None, [], text)
    # ---------------- edits
    if prog == "apply_patch" or (hd and prog in ("apply_patch",)):
        return op("edit", "apply_patch", set(), prog, "native", None, [], text)
    if prog == "sed" and any(a in ("-i", "-i.bak", "--in-place") or a.startswith("-i") for a in argv):
        return op("edit", "sed-i", set(), prog, "native", None, [a for a in argv if not a.startswith("-") and "/" in a or "." in a][-1:], text)
    if prog in ("cat", "tee") and re.search(r"\s>\s*\S|\s>>\s*\S", stage) and (hd or prog == "tee"):
        return op("edit", "heredoc-write", set(), prog, "native", None, [], text)
    if prog in ("cp", "mv", "rm", "mkdir", "touch", "chmod", "ln", "rmdir"):
        return op("misc", "fs-mutate", set(), prog, "native", None, argv, text)
    # ---------------- tests
    if prog in TEST_PROGS:
        return op("test", "shim" if prog == "run_tests" else "direct", set(), prog, "native", None, [], text)
    sub1 = argv[0] if argv else None
    if (prog, sub1) in TEST_SUBCMDS or (prog, None) in TEST_SUBCMDS:
        if (prog, sub1) in (("python", "-m"), ("python3", "-m")):
            mod = argv[1] if len(argv) > 1 else ""
            if mod in ("pytest", "unittest", "nose", "nose2", "tox", "doctest"):
                return op("test", "direct", set(), prog, "native", None, [], text)
            if mod in ("py_compile", "compileall", "mypy", "flake8", "black", "ruff", "pyflakes", "pylint"):
                return op("build", "syntax-check" if mod in ("py_compile", "compileall") else "lint", set(), prog, "native", None, [], text)
            if mod in ("pip",):
                return op("deps" if len(argv) > 2 and argv[2] in ("show", "list", "freeze") else "build", "pip", set(), prog, "native", None, [], text)
            return op("runtime", "module", {mod}, prog, "native", None, [], text)
        if (prog, sub1) in (("poetry", "run"), ("uv", "run"), ("bundle", "exec"), ("npx", None)):
            inner = argv[1] if len(argv) > 1 else ""
            if inner in TEST_PROGS or inner in ("rspec", "pytest", "jest", "mocha", "vitest"):
                return op("test", "direct", set(), prog, "native", None, [], text)
            return op("runtime", "wrapped", set(), prog, "native", None, [], text)
        if (prog, sub1) == ("node", "--test") or (prog, sub1) == ("make", "check"):
            return op("test", "direct", set(), prog, "native", None, [], text)
        return op("test", "direct", set(), prog, "native", None, [], text)
    if prog == "npx" and sub1 in ("jest", "mocha", "vitest", "ava", "tap", "tape", "c8", "nyc", "playwright", "cypress"):
        return op("test", "direct", set(), prog, "native", None, [], text)
    # ---------------- deps queries
    if (prog, sub1) in DEPS_QUERY or (prog in ("which", "command", "type", "whereis") and prog != "type" or (prog == "command" and sub1 == "-v")):
        if prog in ("which", "command", "whereis"):
            return op("misc", "probe-tool", set(), prog, "native", None, argv, text)
        return op("deps", "query", set(), prog, "native", None, [], text)
    # ---------------- build / lint / install
    if prog in BUILD_PROGS or (prog, sub1) in BUILD_SUBCMDS or (prog, None) in BUILD_SUBCMDS:
        sub = "install" if sub1 in ("install", "ci", "i", "restore", "deps.get", "get", "sync", "pub") or prog in ("apt-get", "apt", "brew") else ("syntax-check" if prog in ("node",) else "build")
        if prog == "node" and sub1 == "--check":
            sub = "syntax-check"
        if prog in ("eslint", "prettier", "black", "ruff", "flake8", "mypy", "pyright", "pylint", "isort", "solhint", "shellcheck", "gofmt", "goimports", "rustfmt", "credo", "stylelint", "biome", "oxlint", "luacheck", "stylua") or sub1 in ("lint", "fmt", "format", "vet", "clippy", "credo", "dialyzer", "analyze", "xref"):
            sub = "lint-format"
        return op("build", sub, set(), prog, "native", None, [], text)
    if prog == "node" and sub1 == "--check":
        return op("build", "syntax-check", set(), prog, "native", None, argv[1:], text)
    # ---------------- runtime probes
    if prog in RUNTIME_PROGS:
        tags = set()
        joined = " ".join(argv) + " " + " ".join(heredocs)
        inline = hd or any(a in ("-c", "-e", "-p", "--eval", "--print", "-r", "--input-type=module", "-") for a in argv[:3])
        if re.search(r"__file__|__version__|require\.resolve|require\(['\"][\w@/.-]+/package\.json|importlib\.metadata|pkg_resources|\.version\b|Mix\.Project|Application\.spec|:application|Assembly\.Load", joined):
            tags.add("dep-resolve")
        if re.search(r"^\s*import\s|\bimport\s+\w+|require\(|from\s+\w+\s+import", joined):
            tags.add("imports")
        if re.search(r"new RegExp|re\.compile|/\^|\.exec\(|\.test\(|re\.(?:match|search|sub|findall)|Regex\(", joined):
            tags.add("regex-probe")
        if re.search(r"ast\.parse|py_compile|compile\(", joined):
            tags.add("syntax-check")
        if prog in ("jq", "yq"):
            tags.add("json-query")
        if "--version" in argv or "-v" in argv[:1] or "-version" in argv:
            return op("deps", "query", {"version"}, prog, "native", None, [], text)
        if prog in ("dotnet", "go", "swift", "dart", "java") and sub1 not in ("run", "script", "fsi", "eval", "-e"):
            # dotnet/go/etc. other subcommands: treat as build unless run
            return op("build", sub1 or "other", set(), prog, "native", None, [], text)
        sub = "inline" if inline else ("script-file" if argv and not argv[0].startswith("-") else "repl")
        if "dep-resolve" in tags:
            return op("deps", "resolve", tags, prog, "native", None, [], text)
        return op("runtime", sub, tags, prog, "native", None, [], text)
    # ---------------- git
    if prog == "git":
        g = sub1 or ""
        if g == "grep":
            pat, paths, flags, ctx, incl, pats = parse_grep(argv[1:], "grep")
            tags = path_tags(paths) | {"git-grep"}
            if ctx: tags.add(f"ctx")
            if "-l" in flags: tags.add("files-only")
            if "-c" in flags: tags.add("count")
            if "-i" in flags: tags.add("icase")
            if "-w" in flags: tags.add("word")
            if DEFN_PAT.search(pat or ""): tags.add("defn")
            lit = is_literal_pattern(pat, flags)
            return op("grep.literal" if lit else "grep.regex", "git-grep", tags, prog, "native", pat, paths, text, {"ctx": ctx})
        if g == "ls-files":
            tags = set()
            if any(not a.startswith("-") for a in argv[1:]): tags.add("pattern")
            return op("glob" if tags else "list", "git-ls-files", tags, prog, "native", " ".join(a for a in argv[1:] if not a.startswith("-")), [], text)
        if g in ("log", "blame", "show", "rev-list", "describe", "tag", "shortlog", "reflog", "cherry", "bisect"):
            return op("git.history", g, set(), prog, "native", None, [], text)
        if g in ("status", "diff", "stash", "diff-tree", "diff-index", "diff-files", "rev-parse", "branch", "remote", "config", "check-attr", "check-ignore", "cat-file", "ls-tree", "worktree", "symbolic-ref", "var", "count-objects"):
            return op("git.state", g, set(), prog, "native", None, [], text)
        return op("git.other", g, set(), prog, "native", None, [], text)
    # ---------------- content grep
    if prog in GREP_PROGS:
        pat, paths, flags, ctx, incl, pats = parse_grep(argv, prog)
        tags = path_tags(paths)
        if ctx: tags.add("ctx")
        if "-l" in flags or "--files-with-matches" in flags or "-L" in flags: tags.add("files-only")
        if "-c" in flags or "--count" in flags: tags.add("count")
        if "-v" in flags or "--invert-match" in flags: tags.add("invert")
        if "-i" in flags or "--ignore-case" in flags or "-S" in flags or "--smart-case" in flags: tags.add("icase")
        if "-w" in flags or "--word-regexp" in flags: tags.add("word")
        if "-o" in flags or "--only-matching" in flags: tags.add("only-matching")
        if "-m" in flags or "--max-count" in flags: tags.add("max-count")
        if "-h" in flags or "--no-filename" in flags: tags.add("no-filename")
        if incl: tags.add("type-filter")
        if len(pats) > 1 or (pat and re.search(r"(?<!\\)\|", pat)) or (pat and "\\|" in pat and prog in ("grep", "egrep")): tags.add("multi-pattern")
        if "-E" in flags or "--extended-regexp" in flags or prog == "egrep": tags.add("ere")
        if "-P" in flags or "--perl-regexp" in flags: tags.add("pcre")
        if "-U" in flags or "--multiline" in flags: tags.add("multiline")
        if paths: tags.add("scoped")
        if DEFN_PAT.search(pat or ""): tags.add("defn")
        if "--files" in flags:
            return op("glob", "rg-files", tags | {"rg-files"}, prog, "native", pat, paths, text)
        lit = is_literal_pattern(pat, flags)
        return op("grep.literal" if lit else "grep.regex", prog, tags, prog, "native", pat, paths, text, {"ctx": ctx})
    # ---------------- reads
    if prog in READ_PROGS:
        files = [a for a in argv if not a.startswith("-") and not (prog == "sed" and re.match(r"^[\d,$/].*p$|^-?n$|^=$|^\d+q$|^'", a))]
        if prog in ("head", "tail"):
            files = [a for a in files if not re.match(r"^[+-]?\d+[kKmM]?$", a)]
        tags = path_tags(files)
        if prog == "sed":
            script = " ".join(a for a in argv if not a.startswith("-") and a not in files)
            if re.search(r"\d+,\$\s*p|\d+,\$p", script) or re.search(r"^\d+,\$", script): tags.add("open-ended")
            if re.search(r"/.*/\s*,\s*/.*/\s*p|/.*/,\s*\+?\d*p|/.*/p", script): tags.add("by-pattern")
            if "=" in script or "-n" not in argv and "=" in script: tags.add("numbered")
            if re.search(r"^\d+(?:,\d+)?p$|\d+,\d+p", script) or re.search(r"\d+p", script):
                return op("read.range", "sed-n", tags, prog, "native", None, files, text)
            if "open-ended" in tags or "by-pattern" in tags:
                return op("read.range", "sed-n", tags, prog, "native", None, files, text)
            return op("read.whole" if files else "misc", "sed-filter", tags | ({"filter"} if not files else set()), prog, "native", None, files, text)
        if prog == "head":
            n = None
            for i, a in enumerate(argv):
                m = re.match(r"^-n?(\d+)$", a) or (re.match(r"^-n$", a) and i + 1 < len(argv) and re.match(r"^(\d+)$", argv[i + 1]))
                if m: n = int(m.group(1)) if hasattr(m, "group") else None
            if "-c" in argv: tags.add("bytes")
            tags.add("prefix")
            return op("read.range", "head", tags, prog, "native", None, files, text) if files else op("misc", "filter", tags, prog, "native", None, [], text)
        if prog == "tail":
            if any(re.match(r"^-n?\+\d+$", a) or a == "-n" and False for a in argv) or any(a.startswith("+") for a in argv) or any(re.match(r"^-n$", a) and i + 1 < len(argv) and argv[i + 1].startswith("+") for i, a in enumerate(argv)):
                tags.add("open-ended")
            else:
                tags.add("suffix")
            if "-f" in argv or "-F" in argv: tags.add("follow")
            return op("read.range", "tail", tags, prog, "native", None, files, text) if files else op("misc", "filter", tags, prog, "native", None, [], text)
        if prog == "awk":
            script = " ".join(a for a in argv if a not in files and not a.startswith("-"))
            files2 = [f for f in files if not re.search(r"[{}$]", f)]
            if re.search(r"NR\s*[><=]", script):
                return op("read.range", "awk-NR", tags | {"awk"}, prog, "native", None, files2, text) if files2 else op("misc", "filter", tags, prog, "native", None, [], text)
            if re.search(r"/.*/", script) and files2:
                return op("grep.regex", "awk", tags | {"awk"}, prog, "native", None, files2, text)
            return op("read.whole", "awk", tags | {"awk"}, prog, "native", None, files2, text) if files2 else op("misc", "filter", tags | {"awk"}, prog, "native", None, [], text)
        if prog in ("cat", "nl", "bat", "less", "more", "tac"):
            if "-n" in argv or prog == "nl" or "-b" in argv: tags.add("numbered")
            if len(files) > 1: tags.add("multi-file")
            if any(re.search(r"[*?\[]", f) for f in files): tags.add("glob-arg")
            return op("read.whole", prog, tags, prog, "native", None, files, text) if files else op("misc", "filter", tags, prog, "native", None, [], text)
        if prog == "cut":
            return op("misc", "filter", set(), prog, "native", None, [], text)
    # ---------------- listing / globbing
    if prog in LIST_PROGS:
        if prog in ("find", "fd", "fdfind"):
            j = " ".join(argv)
            tags = path_tags([a for a in argv if not a.startswith("-")])
            if prog == "find":
                if re.search(r"-i?name|-i?path|-i?regex|-newer|-samefile", j):
                    if re.search(r"-type\s+d", j): tags.add("dirs")
                    if re.search(r"-maxdepth", j): tags.add("maxdepth")
                    if re.search(r"-exec\s+(grep|rg)|-exec\s+cat|-exec\s+sed", j): tags.add("exec-grep" if "grep" in j or "rg" in j else "exec-read")
                    return op("glob", "find-name", tags, prog, "native", re.search(r"-i?name\s+(\S+)", j).group(1) if re.search(r"-i?name\s+(\S+)", j) else None, [a for a in argv if not a.startswith("-") and not a.startswith("*")][:2], text)
                if re.search(r"-type\s+d", j): tags.add("dirs")
                if re.search(r"-maxdepth", j): tags.add("maxdepth")
                if re.search(r"-newer|-mmin|-mtime", j): tags.add("mtime")
                return op("list", "find-enumerate", tags, prog, "native", None, [a for a in argv if not a.startswith("-") and not re.match(r"^\d+$", a) and a not in ("d", "f", "l")][:2], text)
            return op("glob", "fd", tags, prog, "native", argv[0] if argv else None, argv[1:2], text)
        if prog == "tree":
            return op("list", "tree", set(), prog, "native", None, [a for a in argv if not a.startswith("-")], text)
        # ls
        targets = [a for a in argv if not a.startswith("-")]
        tags = path_tags(targets)
        if "-R" in argv or "--recursive" in argv: tags.add("recursive")
        if any(re.search(r"[*?\[]", t) for t in targets): tags.add("glob-arg")
        if targets and all(re.search(r"\.[A-Za-z0-9]{1,6}$", t) and "*" not in t for t in targets): tags.add("exists-check")
        if "glob-arg" in tags or "exists-check" in tags:
            return op("glob", "ls", tags, prog, "native", None, targets, text)
        return op("list", "ls", tags, prog, "native", None, targets, text)
    # ---------------- web / misc
    if prog in ("curl", "wget"):
        return op("web", prog, set(), prog, "native", None, [], text)
    if prog == "wc":
        files = [a for a in argv if not a.startswith("-")]
        return op("misc", "count", path_tags(files) | ({"line-count"} if "-l" in argv else set()), prog, "native", None, files, text) if files else op("misc", "filter", {"count"}, prog, "native", None, [], text)
    if prog in ("stat", "file", "du", "df", "realpath", "readlink", "basename", "dirname", "test", "[", "[["):
        files = [a for a in argv if not a.startswith("-")]
        return op("misc", "fs-probe", path_tags(files), prog, "native", None, files, text)
    if prog in ("diff", "cmp", "patch", "comm"):
        return op("misc", "diff", set(), prog, "native", None, [a for a in argv if not a.startswith("-")], text)
    if prog in ("sort", "uniq", "tr", "xargs", "tee", "rev", "column", "fold", "paste", "join", "expand", "unexpand", "strings", "od", "xxd", "hexdump", "base64", "md5sum", "sha256sum", "sha1sum", "grep_placeholder"):
        return op("misc", "filter", set(), prog, "native", None, [], text)
    if prog in ("echo", "printf", "pwd", "cd", "true", "false", "exit", "return", "export", "set", "unset", "source", ".", "sleep", "date", "env", "printenv", "clear", "history", "alias", "hash", "shift", "read", "local", "declare", "eval", "trap", "wait", "kill", "jobs", "bg", "fg", "ulimit", "umask", "seq", "yes", "whoami", "id", "uname", "hostname", "nproc", "free", "uptime", "ps", "top", "lsof", "pgrep", "pkill", "type"):
        if prog == "sleep": return op("poll", "sleep", set(), prog, "native", None, [], text)
        if prog == "type": return op("misc", "probe-tool", set(), prog, "native", None, argv, text)
        return op("misc", "shell", set(), prog, "native", None, [], text)
    if prog.endswith(".sh") or prog.endswith(".py") or prog.endswith(".js") or prog.endswith(".mjs") or prog.endswith(".exs") or prog.endswith(".rb"):
        return op("runtime", "script-file", set(), prog, "native", None, [], text)
    return op("misc", "unknown", set(), prog, "native", None, argv[:3], text)

FILTER_PROGS = {"head", "tail", "sort", "uniq", "wc", "cut", "tr", "awk", "sed", "grep", "rg", "egrep", "fgrep", "xargs", "tee", "cat", "nl", "column", "fold", "rev", "less", "more", "tac", "jq", "yq", "python3", "python", "node", "paste", "strings"}
SOURCE_CAPS = {"glob", "list", "git.history", "git.state", "git.other", "read.whole", "read.range", "grep.literal", "grep.regex", "search.semantic", "symbol", "test", "build", "runtime", "deps", "edit", "web", "misc"}

def classify_pipeline(stages, heredocs):
    """Reduce a pipeline to one operation."""
    ops = [classify_stage(s, heredocs) for s in stages]
    ops = [(s, o) for s, o in zip(stages, ops) if o]
    if not ops:
        return None
    if len(ops) == 1:
        return ops[0][1]
    first_stage, first = ops[0]
    # filters after a source stage: a grep/head/tail... with no file operands
    rest = []
    for s, o in ops[1:]:
        toks = tokens(s)
        prog, argv = program(toks)
        has_file = bool(o.get("paths")) and o["cap"] not in ("misc",)
        lead = next((t for t in toks if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t)), "")
        if lead.rsplit("/", 1)[-1] == "xargs":
            rest.append((s, o, "xargs"))
        elif prog in FILTER_PROGS and not has_file:
            rest.append((s, o, "filter"))
        else:
            rest.append((s, o, "cmd"))
    # xargs grep after a listing → content grep over a glob set
    for s, o, kind in rest:
        if kind == "xargs" and o["cap"].startswith("grep"):
            o = dict(o); o["tags"] = sorted(set(o["tags"]) | {"over-glob"}); o["text"] = " | ".join(stages)[:300]
            return o
        if kind == "xargs" and o["cap"].startswith("read"):
            o = dict(o); o["tags"] = sorted(set(o["tags"]) | {"over-glob"}); o["text"] = " | ".join(stages)[:300]
            return o
    primary = dict(first)
    tags = set(primary["tags"])
    for s, o, kind in rest:
        if kind != "filter":
            # an independent command later in the pipeline (rare) -- keep precedence
            if prec(o["cap"]) < prec(primary["cap"]):
                primary = dict(o); tags = set(primary["tags"])
            continue
        prog, _ = program(tokens(s))
        if prog in ("grep", "rg", "egrep", "fgrep"):
            if first["cap"] in ("read.whole", "read.range"):
                # cat file | grep pat  → content grep of that file
                g = classify_stage(s, heredocs)
                g = dict(g); g["paths"] = first["paths"]; g["tags"] = sorted(set(g["tags"]) | {"piped-from-read", "scoped"} | set(first["tags"]))
                g["text"] = " | ".join(stages)[:300]
                primary = g; tags = set(g["tags"])
            elif first["cap"] in ("glob", "list") or first.get("sub") == "git-ls-files":
                tags.add("name-filter"); primary["cap"] = "glob"
                g = classify_stage(s, heredocs)
                if g and g.get("pattern"): primary["pattern"] = g["pattern"]
            elif first["cap"] in ("git.history", "git.state", "test", "build", "runtime", "deps", "misc"):
                tags.add("grep-filtered")
            elif first["cap"].startswith("grep"):
                tags.add("grep-chain")
        elif prog in ("head", "tail"):
            if first["cap"].startswith("read"):
                primary["cap"] = "read.range"; tags.add("piped-" + prog)
            else:
                tags.add(prog + "-limited")
        elif prog == "sed":
            if first["cap"].startswith("read"):
                primary["cap"] = "read.range"; tags.add("piped-sed")
            else:
                tags.add("sed-filtered")
        elif prog in ("wc",):
            tags.add("counted")
        elif prog in ("sort", "uniq", "cut", "tr", "awk", "column", "jq", "python3", "python", "node", "tee", "xargs", "cat", "nl", "paste", "strings"):
            tags.add("post-filter")
    primary["tags"] = sorted(tags)
    primary["text"] = " | ".join(stages)[:300]
    return primary

def classify_shell(cmd):
    ops = []
    for st in statements(cmd):
        o = classify_pipeline(st["stages"], st["heredocs"])
        if o:
            ops.append(o)
    return ops

def classify_structured(h, tool, inp):
    """Harness structured tools (opencode read/grep/glob/list, claude Read/Grep/Glob, and the
    planning/delegation tools). Returns [op]."""
    inp = inp if isinstance(inp, dict) else {}
    if h == "opencode":
        if tool == "read":
            f = inp.get("filePath") or inp.get("path") or ""
            rng = ("offset" in inp) or ("limit" in inp)
            tags = path_tags([f])
            if "offset" in inp and "limit" not in inp: tags.add("open-ended")
            return [op("read.range" if rng else "read.whole", "read-tool", tags, "read", "harness", None, [f], f"read {f} {inp.get('offset','')} {inp.get('limit','')}")]
        if tool == "grep":
            pat = inp.get("pattern") or ""
            paths = [inp.get("path")] if inp.get("path") else []
            tags = path_tags(paths) | ({"type-filter"} if inp.get("include") else set()) | ({"scoped"} if paths and not paths[0].rstrip("/").endswith(("runs", "r0-", "r1-", "r2-")) and not re.search(r"/runs/r\d-\d+/?$", paths[0]) else set())
            if DEFN_PAT.search(pat): tags.add("defn")
            return [op("grep.literal" if is_literal_pattern(pat, set()) else "grep.regex", "grep-tool", tags, "grep", "harness", pat, paths, f"grep {pat} {inp.get('path','')} {inp.get('include','')}")]
        if tool == "glob":
            pat = inp.get("pattern") or ""
            tags = set()
            if pat in ("**/*", "**", "*", "**/*.*"): tags.add("enumerate")
            return [op("list" if "enumerate" in tags else "glob", "glob-tool", tags, "glob", "harness", pat, [inp.get("path")] if inp.get("path") else [], f"glob {pat} {inp.get('path','')}")]
        if tool == "list":
            return [op("list", "list-tool", set(), "list", "harness", None, [inp.get("path")] if inp.get("path") else [], f"list {inp.get('path','')}")]
        if tool == "apply_patch":
            return [op("edit", "apply_patch", set(), "apply_patch", "harness", None, [], "apply_patch")]
        if tool in ("edit", "write", "patch", "multiedit"):
            return [op("edit", tool, set(), tool, "harness", None, [inp.get("filePath") or ""], tool)]
        if tool in ("todowrite", "todoread"):
            return [op("plan", tool, set(), tool, "harness", None, [], tool)]
        if tool in ("webfetch", "websearch"):
            return [op("web", tool, set(), tool, "harness", None, [], tool)]
        if tool == "task":
            return [op("delegate", tool, set(), tool, "harness", None, [], tool)]
        return [op("misc", tool, {"unknown-tool"}, tool, "harness", None, [], tool)]
    if h == "claude-code":
        if tool in ("Read", "NotebookRead"):
            f = inp.get("file_path") or inp.get("notebook_path") or ""
            rng = ("offset" in inp) or ("limit" in inp)
            tags = path_tags([f])
            if "offset" in inp and "limit" not in inp: tags.add("open-ended")
            return [op("read.range" if rng else "read.whole", "Read-tool", tags, tool, "harness", None, [f], f"Read {f} {inp.get('offset','')} {inp.get('limit','')}")]
        if tool == "Grep":
            pat = inp.get("pattern") or ""
            paths = [inp.get("path")] if inp.get("path") else []
            tags = path_tags(paths) | ({"type-filter"} if inp.get("glob") or inp.get("type") else set()) | ({"scoped"} if paths else set())
            if inp.get("-A") or inp.get("-B") or inp.get("-C"): tags.add("ctx")
            if inp.get("output_mode") == "files_with_matches": tags.add("files-only")
            if inp.get("output_mode") == "count": tags.add("count")
            if DEFN_PAT.search(pat): tags.add("defn")
            return [op("grep.literal" if is_literal_pattern(pat, set()) else "grep.regex", "Grep-tool", tags, tool, "harness", pat, paths, f"Grep {pat}")]
        if tool == "Glob":
            pat = inp.get("pattern") or ""
            return [op("glob", "Glob-tool", set(), tool, "harness", pat, [inp.get("path")] if inp.get("path") else [], f"Glob {pat}")]
        if tool in ("Edit", "MultiEdit", "Write", "NotebookEdit"):
            return [op("edit", tool, set(), tool, "harness", None, [inp.get("file_path") or ""], tool)]
        if tool in ("TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskOutput", "TaskStop", "TodoWrite"):
            return [op("plan", tool, set(), tool, "harness", None, [], tool)]
        if tool in ("Agent", "Task", "SendMessage"):
            return [op("delegate", tool, set(), tool, "harness", None, [], tool)]
        if tool in ("WebSearch", "WebFetch"):
            return [op("web", tool, set(), tool, "harness", None, [], tool)]
        if tool == "Skill":
            return [op("misc", tool, set(), tool, "harness", None, [], tool)]
        return [op("misc", tool, {"unknown-tool"}, tool, "harness", None, [], tool)]
    if h == "codex":
        if tool == "update_plan":
            return [op("plan", tool, set(), tool, "harness", None, [], tool)]
        if tool == "write_stdin":
            return [op("poll", tool, set(), tool, "harness", None, [], tool)]
        return [op("misc", tool, {"unknown-tool"}, tool, "harness", None, [], tool)]
    return [op("misc", tool, {"unknown-tool"}, tool, "harness", None, [], tool)]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args()
    n = 0
    with gzip.open(a.out, "wt", encoding="utf8") as fo:
        for inp in a.inputs:
            for line in gzip.open(inp, "rt", encoding="utf8"):
                e = json.loads(line)
                h = e["h"]
                if "cmd" in e and e["tool"] in ("exec_command", "bash", "Bash"):
                    ops = classify_shell(e["cmd"])
                    if not ops:
                        ops = [op("misc", "empty", set(), "", "native", None, [], e["cmd"][:300])]
                    tok_in = ntok(e["cmd"])
                else:
                    ops = classify_structured(h, e["tool"], e.get("in"))
                    tok_in = ntok(json.dumps(e.get("in"), ensure_ascii=False))
                ops.sort(key=lambda o: prec(o["cap"]))
                primary = ops[0]
                rec = {k: e[k] for k in ("h", "run", "task", "arm", "rep", "canon", "resolved", "cost", "reqs", "rowCalls", "rowNativeGrep", "i", "req", "side", "tool", "err", "exit")}
                rec["meta"] = e.get("meta") or {}
                rec["cmd"] = e.get("cmd")
                rec["in"] = e.get("in") if "cmd" not in e else None
                rec["ops"] = ops
                rec["cap"] = primary["cap"]
                rec["via"] = "ss" if any(o["via"] == "ss" for o in ops) and all(o["via"] in ("ss",) or o["cap"] in ("misc", "test", "edit", "git.state", "git.other", "git.history", "plan", "build") for o in ops) else ("mixed" if any(o["via"] == "ss" for o in ops) else primary["via"])
                rec["tokIn"] = tok_in
                rec["tokOut"] = ntok(e.get("out") or "")
                rec["out"] = e.get("out") or ""
                fo.write(json.dumps(rec, ensure_ascii=False) + "\n")
                n += 1
    print("classified", n, "->", a.out)

if __name__ == "__main__":
    main()
