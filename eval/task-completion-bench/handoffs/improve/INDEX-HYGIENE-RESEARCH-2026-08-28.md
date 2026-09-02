# Index Hygiene: What To Index And What To Skip

**Date:** 2026-08-28
**Scope:** file-level admission for the sweet-search code index (vector + grep)
**Question:** we re-admitted git-tracked files under `build/dist/out/target` and started
indexing committed bundles (`.github/actions/*/dist/index.js`, `dist/js/app.js`). What is
the correct 2026 signal set?

---

## 0. Verdict in one paragraph

**"Git tracks it" is the wrong last word. Make it the second-to-last word.** Git-tracking
answers "is this in the repository", not "did a human write this". The committed GitHub
Action bundle is tracked *by design* — GitHub Actions run straight from repository source,
so `dist/index.js` **must** be committed
([cardinalby, JS action packing](https://cardinalby.github.io/blog/post/github-actions/js-action-packing-and-releasing/);
[glebbahmutov](https://glebbahmutov.com/blog/trying-github-actions/)). The signal that
separates the Boost.Build `.jam` file from the ncc bundle is **content shape**, not git
status. Add a cheap content classifier after the git-tracked re-admission, plus
`.gitattributes` as an explicit two-way override. That is exactly what GitHub itself does,
and exactly what the largest public code corpus (The Stack v2) does.

---

## A. Ranked recommendation

Priority order. Each item states the exact rule, the threshold, and why.

### A1 — `.gitattributes` override, both directions (HIGHEST priority, ~40 lines of code)

**Rule.** Before any heuristic runs, batch-resolve `linguist-generated`,
`linguist-vendored`, and `linguist-documentation` for every candidate path. If an attribute
is `set`, classify the file that way and stop. If it is `unset` (written `-linguist-generated`
or `linguist-generated=false`), **force-admit** the file and stop. If `unspecified`, fall
through to heuristics.

**How.** One subprocess per index run:

```
git check-attr --stdin -z linguist-generated linguist-vendored linguist-documentation
```

Verified locally. Input is NUL-separated paths; output is NUL-separated
`path, attr, value` triples where value is `set` / `unset` / `unspecified` / a string.
Flags confirmed by `git check-attr -h`:
`git check-attr [-a | --all | <attr>...] [--] <pathname>...` and
`git check-attr --stdin [-z] [-a | --all | <attr>...]`.

**Why this is first.** This is the mechanism repositories already use, and GitHub documents
it as *the* fix for our precise problem — a real source directory sitting under an
excluded-by-default build path. From
[GitHub Docs, "Finding files on GitHub"](https://docs.github.com/en/search-github/searching-on-github/finding-files-on-github):
default excluded directories are "`.git`, `.hg`, `.sass-cache`, `.svn`, `build`, `dot_git`,
`log`, `tmp`, `vendor`", and the documented override is literally

```
build/** linguist-generated=false
```

with the note that "more complex overrides of subdirectories within excluded-by-default
directories are not supported". So the *repository* tells us `src/build/` is real. We should
listen. Conversely a repository that commits a bundle and marks it
`dist/** linguist-generated` is telling us to skip it — today we ignore that.

Precedence copied verbatim from Linguist's own implementation
([`lib/linguist/lazy_blob.rb`](https://github.com/github-linguist/linguist/blob/main/lib/linguist/lazy_blob.rb)):

```ruby
GIT_ATTR = ['linguist-documentation', 'linguist-language', 'linguist-vendored',
            'linguist-generated', 'linguist-detectable', 'filter']

def generated?
  if not git_attributes['linguist-generated'].nil?
    boolean_attribute(git_attributes['linguist-generated'])
  else
    super          # <- falls back to the heuristics in generated.rb
  end
end

# Returns true if the attribute is present and not the string "false" and not the false boolean.
def boolean_attribute(attribute)
  attribute != "false" && attribute != false
end
```

Attribute meanings, from
[Linguist `docs/overrides.md`](https://github.com/github-linguist/linguist/blob/main/docs/overrides.md):
`linguist-generated` = "Excluded from stats, hidden in diffs"; `linguist-vendored` =
"Excluded from stats"; `linguist-documentation` = "Excluded from stats"; `linguist-detectable`
= "Included in stats, even if language's type is `data` or `prose`". Negation uses a leading
hyphen (`-linguist-vendored`) or `=false`. The attributes take effect only once
`.gitattributes` is committed.

**Cost.** One `git check-attr` call per index run. Most repositories set no linguist
attributes, so the result is almost always all-`unspecified` and nothing changes.

---

### A2 — Content-based "unreadable output" detector (HIGHEST value for our actual bug)

This is the rule that kills `dist/index.js` and `dist/css/app.css` while keeping
`src/build/*.jam`. Run it on the first 256 KiB of the file. Classify **MINIFIED** if any
sub-rule fires.

| # | Rule | Threshold | Source |
|---|---|---|---|
| M1 | Strip comments, drop empty lines, take the **median** line length | `median > 200` bytes | [`is-minified-code`](https://github.com/MartinKolarik/is-minified-code) |
| M2 | Non-empty line count after comment-strip | `<= 1` **and** file `>= 1024` bytes | same |
| M3 | Mean line length, for `.js .mjs .cjs .css .scss` only | `mean > 110` | [Linguist `generated.rb#minified_files?`](https://github.com/github-linguist/linguist/blob/main/lib/linguist/generated.rb) |
| M4 | Count of lines longer than 4096 bytes | `>= 2` | [GitHub Docs, About code search](https://docs.github.com/en/search-github/github-code-search/about-github-code-search) |
| M5 | Either of the last two lines matches a source-map reference | `/^\/[*\/][#@] source(?:Mapping)?URL\|sourceURL=/` | Linguist `has_source_map?` |
| M6 | Bundler banner in first 4 KiB | `webpackBootstrap`, `__webpack_require__`, `/******/ (() => {`, `parcelRequire`, `System.register` | ncc/webpack output shape |

**M1 is the workhorse.** A median beats a mean because one 60,000-character bundled line
does not have to drag a mean over a threshold that a comment-heavy real file might also
cross. Real hand-written source essentially never has a median line length above 200 bytes.

**M5 is the highest-precision rule and costs nothing.** Every webpack, rollup, esbuild and
ncc bundle emits a `//# sourceMappingURL=` trailer. It catches pretty-printed bundles that
M1 misses.

**Calibration against the largest public code corpus.** The Stack v2 / StarCoder2 pipeline
([arXiv:2402.19173](https://arxiv.org/html/2402.19173v1)) removes files with average line
length above 100 characters or maximum line length above 1,000, and removes files above
100,000 lines; it exempts HTML/JSON/Markdown, dropping those only when the longest line
exceeds 100,000 characters. Their thresholds are stricter than ours because they are
building training data and can afford recall loss. For a search index we want the opposite
bias, so use median-200 as the primary gate and treat StarCoder2's mean-100 as the
aggressive alternative.

**Two-tier disposition.** Not everything generated deserves the same fate:

- **Tier 1 — hard skip, both indexes.** Minified/bundled files, source maps, lock files,
  path-vendored files. A 60,000-character line is not readable in grep output either; it is
  pure noise in both retrieval channels. This is where our new bug lives.
- **Tier 2 — vector-skip, grep-keep, truncate lines at 1024 bytes.** Marker-generated but
  *readable* source: `*.pb.go`, generated GraphQL types, `*_grpc.py`. "Where is
  `FooRequest` defined?" legitimately resolves to a `.pb.go` file. GitHub truncates lines
  over 1,024 characters rather than dropping the file, per the same docs page.

**GitHub does exactly this two-tier split, and it is worth reading their two statements
together.** The overview page says "Vendored and generated code is excluded"
([About GitHub Code Search](https://docs.github.com/en/search-github/github-code-search/about-github-code-search)),
yet the syntax page documents an `is:` qualifier taking `vendored` and `generated`, which
"restricts the search to content detected as generated", invertible with `NOT`
([Understanding GitHub Code Search syntax](https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax)).
So the content is **in the index and hidden from default results** — a demotion with an
opt-in escape hatch, not a deletion. Adopt that shape for Tier 2. Our existing
  `chunkLooksGenerated` behaviour is already Tier 2 and is correct — leave it.

---

### A3 — Port Linguist's **path** rules for generated and vendored

Adopt the pattern sets in §B below. Highest-value entries for our situation, in order:

1. `(\.|-)min\.(js|css)$` — we have this.
2. `(^|/)dist/` — Linguist marks **all** `dist/` as vendored. Our re-admission is broader
   than the canon here; keep re-admission but force it through A2.
3. `(^|/)\.github/` — Linguist marks the **entire** `.github` directory vendored. This one
   rule alone removes `.github/actions/*/dist/index.js`.
4. `(^|/)node_modules/`, `(^|/)vendors?/`, `(3rd|[Tt]hird)[-_]?[Pp]arty/`, `^deps/`,
   `(^|/)bower_components/`, `(^|/)Godeps/_workspace/`, `(^|/)testdata/`.
5. `(.*?)\.d\.ts$` — TypeScript declaration files are vendored in Linguist. Worth a
   deliberate decision; they are often the best answer to "what is this API".
6. `__generated__/` (Relay/GraphQL), `\.designer\.(cs|vb)$`, `\.feature\.cs$`,
   `_tlb\.pas$`, `\.zep\.(c|h|php)$`, `(?:^|\/)\.sqlx\/query-[a-f\d]{64}\.json$`.
7. The full lock-file family (§B.2) — cheap, unambiguous, high volume.

**Do not blanket-adopt `(^|/)cache/`, `^[Ee]xamples/`, `^[Dd]emos?/`, `^[Ss]amples?/`,
`(^|/)[Tt]ests?/fixtures/`.** Linguist excludes those from *language statistics*, a
different goal. Examples and samples are frequently the best retrieval target for an
agent-mode query.

---

### A4 — Adopt Qodo's committed-codegen glob list

Qodo Merge ships a dedicated list for exactly this problem
([`generated_code_ignore.toml`](https://github.com/qodo-ai/pr-agent/blob/main/pr_agent/settings/generated_code_ignore.toml)),
selected by `ignore_language_framework`. It is short, and it covers the checked-in codegen
that Linguist's content markers miss:

```toml
protobuf = ["**/*.pb.go","**/*.pb.cc","**/*_pb2.py","**/*.pb.swift","**/*.pb.rb","**/*.pb.php","**/*.pb.h"]
openapi  = ["**/__generated__/**","**/openapi_client/**","**/openapi_server/**"]
swagger  = ["**/swagger.json","**/swagger.yaml"]
graphql  = ["**/*.graphql.ts","**/*.generated.ts","**/*.graphql.js"]
grpc_python = ["**/*_grpc.py"];  grpc_java = ["**/*Grpc.java"]
grpc_csharp = ["**/*Grpc.cs"];   grpc_typescript = ["**/*_grpc.ts","**/*_grpc.js"]
go_gen   = ["**/*_gen.go","**/*generated.go"]
```

Route these to **Tier 2** (vector-skip, grep-keep), not Tier 1. They are readable.

---

### A5 — Widen the marker scan window and match Go's official regex

Our `chunkLooksGenerated` reads the **first 500 characters**. Two upgrades:

1. Go's own convention is `^// Code generated .* DO NOT EDIT\.$`, and the specification
   says the line "may appear anywhere in the file"
   ([golang/go#41196](https://github.com/golang/go/issues/41196)). Linguist scans the
   **first 40 lines** for `.go`. Widen to first 40 lines or 4 KiB, whichever is smaller.
2. Add the .NET / ReSharper marker `<auto-generated`
   ([JetBrains Rider docs](https://www.jetbrains.com/help/rider/Reference__Options__Code_Inspection__Generated_Code.html))
   and the phrases The Stack v2 uses: "auto-generated" and "automatically generated" in the
   first 5 lines (arXiv:2402.19173).

---

### A6 — Size and encoding floor (cheap parity with the field)

| Signal | Our value | Field values |
|---|---|---|
| Max file size | 1 MB | Zoekt default **2 MiB** (`o.SizeMax = 2 << 20`); GitLab configures Zoekt to **1 MB**; GitHub code search **350 KiB**; Linguist `LazyBlob::MAX_SIZE` **128 KiB** |
| Empty files | — | GitHub: "Empty files ... are excluded" |
| Encoding | — | GitHub: "Only UTF-8 encoded files are included" |
| Distinct trigrams | — | Zoekt: `o.TrigramMax = 20000` |

Sources: [zoekt `index/builder.go`](https://github.com/sourcegraph/zoekt/blob/main/index/builder.go),
[GitLab Zoekt docs](https://docs.gitlab.com/integration/zoekt/),
[GitHub Docs](https://docs.github.com/en/search-github/github-code-search/about-github-code-search).

**Recommendation:** keep 1 MB, add an empty-file skip, add a NUL-byte binary check over the
first **8,000** bytes — git's own heuristic, copied verbatim by enry as
`const binSniffLen = 8000` with `bytes.IndexByte(data, byte(0)) == -1`
([`go-enry/utils.go` `IsBinary`](https://github.com/go-enry/go-enry/blob/master/utils.go),
citing `git/xdiff-interface.c`). **Do not** adopt a trigram cap; sweet-search is not a
trigram engine.

---

### A7 — Near-duplicate suppression (already partly built, worth extending)

We already run SimHash + MinHash-LSH for dedup. Extend it to treat **generated-code
near-duplicates** as one document. Committed bundles are the worst offender: the same
vendored library appears in twenty `dist/` directories across a monorepo.

Evidence that this matters is in §F.

---

## B. The actual Linguist patterns, quoted

Source files: [`lib/linguist/generated.rb`](https://github.com/github-linguist/linguist/blob/main/lib/linguist/generated.rb),
[`lib/linguist/vendor.yml`](https://github.com/github-linguist/linguist/blob/main/lib/linguist/vendor.yml),
[`lib/linguist/documentation.yml`](https://github.com/github-linguist/linguist/blob/main/lib/linguist/documentation.yml).
Fetched 2026-08-28 from `main`. `generated.rb` is 997 lines; `vendor.yml` is 396 lines holding **168** regexes; `documentation.yml` holds 18.

### B.1 The `generated?` decision (top of `generated.rb`)

`generated?` is a flat OR over **74** predicates. The full list, in file order:

```
xcode_file? || intellij_file? || cocoapods? || carthage_build? ||
generated_graphql_relay? || generated_net_designer_file? ||
generated_net_specflow_feature_file? || composer_lock? || cargo_lock? || cargo_orig? ||
deno_lock? || flake_lock? || bazel_lock? || node_modules? || go_vendor? || go_lock? ||
package_resolved? || poetry_lock? || pdm_lock? || uv_lock? || pixi_lock? || esy_lock? ||
npm_shrinkwrap_or_package_lock? || pnpm_lock? || bun_lock? || terraform_lock? ||
generated_yarn_plugnplay? || godeps? || generated_by_zephir? || htmlcov? ||
minified_files? || has_source_map? || source_map? || compiled_coffeescript? ||
generated_parser? || generated_net_docfile? || generated_postscript? ||
compiled_cython_file? || pipenv_lock? || gradle_wrapper? || maven_wrapper? ||
mise_lock? || secrets_baseline? || julia_manifest? || generated_go? ||
generated_protocol_buffer_from_go? || generated_protocol_buffer? ||
generated_javascript_protocol_buffer? || generated_typescript_protocol_buffer? ||
generated_twirp_ruby? || generated_apache_thrift? || generated_jni_header? ||
vcr_cassette? || generated_antlr? || generated_module? || generated_unity3d_meta? ||
generated_racc? || generated_jflex? || generated_grammarkit? || generated_roxygen2? ||
generated_html? || generated_jison? || generated_grpc_cpp? || generated_dart? ||
generated_perl_ppport_header? || generated_gamemakerstudio? || generated_gimp? ||
generated_visualstudio6? || generated_haxe? || generated_jooq? || generated_pascal_tlb? ||
generated_sorbet_rbi? || generated_mysql_view_definition_format? || generated_sqlx_query?
```

### B.2 Pure path rules (port these directly — zero I/O)

```ruby
xcode_file?          ['.nib', '.xcworkspacedata', '.xcuserstate'].include?(extname)
intellij_file?       /(?:^|\/)\.idea\//
cocoapods?           /(^Pods|\/Pods)\//
carthage_build?      /(^|\/)Carthage\/Build\//
node_modules?        /node_modules\//
go_vendor?           /vendor\/((?!-)[-0-9A-Za-z]+(?<!-)\.)+(com|edu|gov|in|me|net|org|fm|io)/
godeps?              /Godeps\//
htmlcov?             /(?:^|\/)htmlcov\//
generated_graphql_relay?          /__generated__\//
generated_net_designer_file?      /\.designer\.(cs|vb)$/i
generated_net_specflow_feature_file?  /\.feature\.cs$/i
generated_by_zephir?              /.\.zep\.(?:c|h|php)$/
generated_yarn_plugnplay?         /(^|\/)\.pnp\..*$/
generated_pascal_tlb?             /_tlb\.pas$/i
generated_sqlx_query?             /(?:^|\/)\.sqlx\/query-[a-f\d]{64}\.json$/
gradle_wrapper?      /(?:^|\/)gradlew(?:\.bat)?$/i
maven_wrapper?       /(?:^|\/)mvnw(?:\.cmd)?$/i
secrets_baseline?    /(?:^|\/)\.secrets\.baseline$/
julia_manifest?      /(?:^|\/)(Julia)?Manifest(-v\d+\.\d+)?\.toml$/

# lock files
composer_lock?  /composer\.lock/          cargo_lock?  /Cargo\.lock/
cargo_orig?     /Cargo\.toml\.orig/       deno_lock?   /deno\.lock/
flake_lock?     /(^|\/)flake\.lock$/      bazel_lock?  /(^|\/)MODULE\.bazel\.lock$/
go_lock?        /(Gopkg|glide)\.lock/     package_resolved? /Package\.resolved/
poetry_lock?    /poetry\.lock/            pdm_lock?    /pdm\.lock/
uv_lock?        /uv\.lock/                pixi_lock?   /pixi\.lock/
esy_lock?       /(^|\/)(\w+\.)?esy.lock$/ pipenv_lock? /Pipfile\.lock/
pnpm_lock?      /pnpm-lock\.yaml/         bun_lock?    /(?:^|\/)bun\.lockb?$/
npm_shrinkwrap_or_package_lock?  /npm-shrinkwrap\.json/ or /package-lock\.json/
terraform_lock? /(?:^|\/)\.terraform\.lock\.hcl$/
mise_lock?      /(?:^|\/)mise(?:\.[^\/]+)?\.lock$/
```

### B.3 The content rules that matter for our bug

```ruby
# minified: average line length > 110, JS and CSS only
def maybe_minified?
  ['.js', '.css'].include? extname.downcase
end

def minified_files?
  if maybe_minified? and lines.any?
    (lines.inject(0) { |n, l| n += l.length } / lines.length) > 110
  else
    false
  end
end

# a source-map trailer in either of the last two lines
def has_source_map?
  return false unless maybe_minified?
  lines.last(2).any? { |l| l.match(/^\/[*\/][\#@] source(?:Mapping)?URL|sourceURL=/) }
end

# the .map file itself
def source_map?
  return false unless extname.downcase == '.map'
  return true if name =~ /(\.css|\.js)\.map$/i ||
    lines[0] =~ /^{"version":\d+,/ ||
    lines[0] =~ /^\/\*\* Begin line maps\. \*\*\/{/
  false
end
```

Marker-style content rules, with their exact scan windows:

```ruby
generated_go?                        extname == '.go',  lines.first(40) =~ %r{^// Code generated .*}
generated_protocol_buffer?           ext in [.py .java .h .cc .cpp .m .rb .php],
                                     lines.first(3) include "Generated by the protocol buffer compiler.  DO NOT EDIT!"
generated_javascript_protocol_buffer? ext == '.js', lines[5] include "GENERATED CODE -- DO NOT EDIT!"
generated_typescript_protocol_buffer? ext == '.ts', lines[0] include "Code generated by protoc-gen-ts_proto. DO NOT EDIT."
generated_twirp_ruby?                ext == '.rb', lines.first(3) include "Code generated by protoc-gen-twirp_ruby" AND "DO NOT EDIT."
generated_protocol_buffer_from_go?   ext == '.proto', lines.first(20) include "This file was autogenerated by go-to-protobuf"
generated_apache_thrift?             ext in [.rb .py .go .js .m .java .h .cc .cpp .php],
                                     lines.first(6) include "Autogenerated by Thrift Compiler"
generated_grpc_cpp?                  ext in [.cpp .hpp .h .cc], lines[0] starts_with "// Generated by the gRPC"
generated_jni_header?                ext == '.h', lines[0] include "/* DO NOT EDIT THIS FILE - it is machine generated */" AND lines[1] include "#include <jni.h>"
generated_dart?                      ext == '.dart', lines.first(3) =~ /generated code\W{2,3}do not modify/i
generated_racc?                      ext == '.rb', lines[2] starts_with "# This file is automatically generated by Racc"
generated_jflex?                     ext == '.java', lines[0] starts_with "/* The following code was generated by JFlex "
generated_grammarkit?                ext == '.java', lines[0] starts_with "// This is a generated file. Not intended for manual editing."
generated_jooq?                      ext == '.java', lines.first(2) include 'This file is generated by jOOQ.'
generated_roxygen2?                  ext == '.Rd', lines[0] include "% Generated by roxygen2: do not edit by hand"
generated_haxe?                      ext in [.js .py .lua .cpp .h .java .cs .php], lines.first(3) include "Generated by Haxe"
compiled_cython_file?                ext in [.c .cpp], lines[0] include "Generated by Cython"
generated_parser?                    ext == '.js', lines[0..4] =~ /Generated by PEG.js/
generated_jison?                     ext == '.js', lines[0] starts_with "/* parser generated by jison " or "/* generated by jison-lex "
generated_sorbet_rbi?                ext == '.rbi', lines[0] =~ /^# typed:/ AND lines[2] include "DO NOT EDIT MANUALLY"
                                       AND lines[4] =~ /^# Please (run|instead update this file by running) `bin\/tapioca/
vcr_cassette?                        ext == '.yml', lines[-2] include "recorded_with: VCR"
generated_unity3d_meta?              ext == '.meta', lines[0] include "fileFormatVersion: "
generated_html?                      ext in [.html .htm .xhtml]; pkgdown / mandoc / Doxygen banners,
                                       or <meta name="generator" content="org mode|latex2html|groff|makeinfo|texi2html|ronn">
```

`compiled_coffeescript?` is worth reading as a design pattern: it does not rely on a marker.
It checks the module-closure shape and then **scores** Coffee-specific identifiers,
requiring a score of 3. That is the template for a "committed bundle" scorer if the simple
rules in §A2 prove insufficient.

### B.4 `vendor.yml` — the path patterns (regexes matched against the pathname)

Highest-value subset for us, quoted verbatim:

```yaml
# Caches
- (^|/)cache/
# Dependencies
- ^[Dd]ependencies/
# Distributions
- (^|/)dist/
# C deps
- ^deps/
- (^|/)configure$
- (^|/)config\.guess$
- (^|/)config\.sub$
# autoconf
- (^|/)aclocal\.m4
- (^|/)libtool\.m4
- (^|/)ltoptions\.m4
- (^|/)ltsugar\.m4
- (^|/)ltversion\.m4
- (^|/)lt~obsolete\.m4
# Node dependencies
- (^|/)node_modules/
# Yarn 2
- (^|/)\.yarn/releases/
- (^|/)\.yarn/plugins/
- (^|/)\.yarn/sdks/
- (^|/)\.yarn/versions/
- (^|/)\.yarn/unplugged/
# Bower
- (^|/)bower_components/
# Go
- (^|/)Godeps/_workspace/
- (^|/)testdata/
# Minified JavaScript and CSS
- (\.|-)min\.(js|css)$
# Stylesheets imported from packages
- ([^\s]*)import\.(css|less|scss|styl)$
# Vendored dependencies
- (3rd|[Tt]hird)[-_]?[Pp]arty/
- (^|/)vendors?/
- (^|/)[Ee]xtern(als?)?/
- (^|/)[Vv]+endor/
# Debian packaging
- ^debian/
# Typescript definition files
- (.*?)\.d\.ts$
# Sphinx
- (^|/)docs?/_?(build|themes?|templates?|static)/
# Carthage / Xcode
- (^|/)Carthage/
- \.xctemplate/
- \.imageset/
# git config files
- (^|/)\.gitattributes$
- (^|/)\.gitignore$
- (^|/)\.gitmodules$
# Gradle / Maven wrappers
- (^|/)gradlew$
- (^|/)gradlew\.bat$
- (^|/)gradle/wrapper/
- (^|/)mvnw$
- (^|/)mvnw\.cmd$
- (^|/)\.mvn/wrapper/
# NuGet
- (^|/)[Pp]ackages\/.+\.\d+\/
# Test fixtures
- (^|/)[Tt]ests?/fixtures/
- (^|/)[Ss]pecs?/fixtures/
# IDE / CI / platform config
- (^|/)\.vscode/
- (^|/)\.github/
- (^|/)\.teamcity/
- (^|/)\.obsidian/
- (^|/)\.gitpod\.Dockerfile$
- (^|/)Jenkinsfile$
- (^|/)Vagrantfile$
- (^|/)\.[Dd][Ss]_[Ss]tore$
```

The remainder of `vendor.yml` is a long tail of bundled JavaScript libraries by filename
(jQuery, jQuery UI, Bootstrap, Font Awesome, Normalize, Animate, Materialize, Select2,
Bulma, Prototype, MooTools, Dojo, MochiKit, YUI, CKEditor, TinyMCE, Ace, MathJax, Chart.js,
CodeMirror, SyntaxHighlighter, AngularJS, D3, React, Modernizr, Knockout, ExtJS, Leaflet
plugins, PhoneGap/Cordova, html5shiv, Octicons). Port the whole file as data; do not
hand-transcribe it.

**Do not blanket-port these** (they exclude from *language statistics*, not from search):
`(^|/)cache/`, `^[Ee]xamples/`, `^[Dd]emos?/`, `^[Ss]amples?/`, `(^|/)[Tt]ests?/fixtures/`,
`(.*?)\.d\.ts$`. Each needs a held-out retrieval check first.

### B.5 `documentation.yml` (full file, 18 patterns)

```yaml
- ^[Dd]ocs?/
- (^|/)[Dd]ocumentation/
- (^|/)[Gg]roovydoc/
- (^|/)[Jj]avadoc/
- ^[Mm]an/
- ^[Ee]xamples/
- ^[Dd]emos?/
- (^|/)inst/doc/
- (^|/)CITATION(\.cff|(S)?(\.(bib|md))?)$
- (^|/)CHANGE(S|LOG)?(\.|$)
- (^|/)CONTRIBUTING(\.|$)
- (^|/)COPYING(\.|$)
- (^|/)INSTALL(\.|$)
- (^|/)LICEN[CS]E(\.|$)
- (^|/)[Ll]icen[cs]e(\.|$)
- (^|/)README(\.|$)
- (^|/)[Rr]eadme(\.|$)
- ^[Ss]amples?/
```

**Ignore this file for our purposes.** For agent-mode retrieval, `docs/` and `README` are
frequently the answer.

### B.6 Is there a CLI or library to shell out to?

| Option | Verdict |
|---|---|
| **`github-linguist` gem** ([README](https://github.com/github-linguist/linguist/blob/main/README.md)) | Two modes: repository and single-file. Needs Ruby + `charlock_holmes` (ICU, cmake, pkg-config) + `rugged` (libgit2). **Reject** — an ICU/libgit2 toolchain is not shippable in an npm package. |
| **`go-enry` / `enry`** ([repo](https://github.com/go-enry/go-enry)) | Go port, synced to Linguist v9.5.0, ~2x faster. Public API: `IsBinary`, `IsVendor`, `IsConfiguration`, `IsDocumentation`, `IsDotFile`, `IsImage`, `IsTest`, `IsGenerated(path string, content []byte) bool`. Bindings for Python, Java (JNI), Rust (`rs-enry`). **No JavaScript/WASM binding.** A separate CLI lives at `go-enry/enry`. **This is what The Stack v2 uses for its autogenerated filter.** Viable if we are willing to add a Go/CGO artifact — we are not. |
| **`linguist-js` (Nixinova/LinguistJS) v3.0.3** ([npm](https://www.npmjs.com/package/linguist-js)) | Pure JS, no native deps. Parses `.gitattributes` correctly including `-attr` and `=false` (`src/program/parsing/parseGitattributes.ts`). **But two disqualifiers:** (1) it **fetches Linguist data files over HTTPS at runtime** from `raw.githubusercontent.com` with a bundled fallback (`src/program/data/loadDataFiles.ts`); (2) it reduces `generated.rb` to **only the path regexes**, via `fileContent.match(/(?<=name\.match\(\/).+?(?=(?<!\\)\/)/gm)` — **every content-based rule is dropped**, including `minified_files?` and `has_source_map?`, which are the two we need most. |
| **`hyperpolyglot`** (Rust, crates.io v0.1.7, ~78k downloads) | Language detection only; no generated/vendored classification. |

**Decision: port, do not depend.** Vendor `vendor.yml` and `documentation.yml` as data
files (they are plain YAML lists of regexes — a build step can refresh them), and
hand-implement the ~15 content rules that matter. Note that Ruby regexes in these files use
constructs RE2 rejects; go-enry documents divergences for exactly this reason. JavaScript's
regex engine handles them, so a JS port is lower-risk than a Rust/RE2 port.

---

## C. Content-based minification thresholds, with numbers

| Implementation | Method | Threshold | Scope |
|---|---|---|---|
| **Linguist `minified_files?`** | mean line length | `> 110` chars | `.js`, `.css` only |
| **Linguist `has_source_map?`** | regex on last 2 lines | `/^\/[*\/][#@] source(?:Mapping)?URL\|sourceURL=/` | `.js`, `.css` only |
| **`is-minified-code` v2.0.0** | strip comments, drop empty lines, **median** line length | `median > 200`, **or** `lines <= 1` | any |
| **GitHub code search** | long-line count | file excluded when **>1 line over 4,096 bytes**; lines over **1,024 chars truncated**; files over **350 KiB** excluded; empty files excluded; UTF-8 only | any |
| **The Stack v2 / StarCoder2** | mean and max line length | mean `> 100` **or** max `> 1,000` → drop; HTML/JSON/MD exempt unless max `> 100,000`; files `> 100,000` lines dropped | any |
| **The Stack v2 alpha filter** | alphabetic character ratio | `< 25%` alphabetic → drop | any |
| **The Stack v2 encoded-data filter** | base64 / hex / unicode runs | matched substrings `> 1,024` chars **or** `> 50%` of file → drop | any |
| **Zoekt** | file size / distinct trigrams | `SizeMax = 2 << 20` (2 MiB), `TrigramMax = 20000`; skip reasons `TooLarge`, `TooSmall`, `Binary`, `TooManyTrigrams` | any |
| **git / enry `IsBinary`** | NUL byte scan | first **8,000** bytes | any |

The exact `is-minified-code` implementation, for direct porting:

```js
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\/\r?\n?|\/\/.{0,200}?(?:\r?\n|$)/g;
const TRAILING_LF_PATTERN = /\r?\n$/;

module.exports = function (code) {
	code = code.replace(COMMENT_PATTERN, '').replace(TRAILING_LF_PATTERN, '');
	let lines = code.split('\n').map(l => l.length).filter(l => l);
	return lines.length <= 1 || median(lines) > 200;
};
```

**Our recommended composite** (rules M1–M6 in §A2) is: `median > 200` **or**
(`lines <= 1` and `bytes >= 1024`) **or** (`mean > 110` for JS/CSS) **or**
(`count(lines > 4096 bytes) >= 2`) **or** source-map trailer **or** bundler banner.

---

## D. Per-tool table: how the field scopes indexing in 2025–2026

| Tool | `.gitignore` | `.gitattributes` / Linguist | Extra ignore file | Size limit | Skips generated / minified / vendored — how | Indexes build output |
|---|---|---|---|---|---|---|
| **GitHub code search (Blackbird)** | n/a (git blobs) | **Yes** — files marked `linguist-generated`/`linguist-vendored` are omitted; `build/** linguist-generated=false` re-includes | — | **350 KiB**; empty excluded; UTF-8 only; lines >1024 chars truncated; file excluded if >1 line over 4096 bytes | **Yes** — "Vendored and generated code is excluded", via Linguist. **But it is a default-hidden filter, not a delete:** `is:` supports `vendored` and `generated`, and `NOT is:generated` inverts it | No (default excludes `build`, `vendor`, `log`, `tmp`) |
| **Zoekt / Sourcegraph search** | via `.sourcegraph/ignore` (glob, `**` implicit) | **No** — no reference to gitattributes or linguist found in `gitindex/` or `index/builder.go` | `.sourcegraph/ignore` | `SizeMax` default **2 MiB**; GitLab sets **1 MB** | **Only structurally**: `SkipReasonTooLarge / TooSmall / Binary / TooManyTrigrams` (`TrigramMax = 20000`). No semantic generated/vendored rule. `LargeFiles` globs opt individual files past the size cap | Yes, if committed and under limits |
| **Sourcegraph Cody embeddings** | — | No | site config `fileFilters` | `MaxFileSizeBytes` (configurable) | Glob `excludedFilePathPatterns`, default `[".*ignore", ".gitattributes", ".mailmap", "*.csv", "*.svg", "*.xml", "__fixtures__/", "node_modules/", "testdata/", "mocks/", "vendor/"]`, plus `isEmbeddableFileContent()` | Yes unless globbed out |
| **Cursor** | **Yes**, automatically | No | `.cursorignore` (all AI features) and `.cursorindexingignore` (indexing only); `!` re-includes gitignored files | Not documented | Default list beyond gitignore: lock files (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `composer.lock`, `Gemfile.lock`, `bun.lockb`), `.env*`, `.git/ .svn/ .hg/`, archives, media, fonts, `node_modules/ __pycache__/ .venv/ .gradle/`, `.next/ .nuxt/ .cache/ .pytest_cache/ .mypy_cache/` | Partly — framework build caches denied by name, generic `dist/` not listed |
| **Continue.dev** | **Yes** | No | `.continueignore`, plus global `~/.continue/.continueignore` | — | Hard directory ban: `.git/ .svn/ node_modules/ dist/ build/ Build/ target/ out/ bin/ .pytest_cache/ .vscode-test/ __pycache__/ site-packages/ .gradle/ .mvn/ .cache/ gems/ vendor/ .venv/ venv/ .vscode/ .idea/ .vs/`. Files: `*-lock.json`, `*.lock`, `go.sum`, `*.log`, binaries/media, `*.jsonl`, `*.csv`. Separate `DEFAULT_SECURITY_IGNORE_FILETYPES` for secrets | **No** — blanket ban, no re-admission |
| **Tabby** | — | No | `.tabbyignore` (git-style syntax, `!` negation) | — | User-driven only; recommends indexing subdirectories for large monorepos | Yes unless ignored |
| **Aider (repo map)** | **Yes** | No | `.aiderignore` (gitignore syntax) | token budget on the map, not per-file | User-driven only. Tree-sitter extracts definitions; generated `.pb.go`, OpenAPI stubs and GraphQL types land in the map unless ignored | Yes unless ignored |
| **Cline** | Yes (discussion) | No | `.clineignore` — blocks read **and** write | — | User-driven only | Yes unless ignored |
| **Windsurf / Devin Desktop** | **Yes** | No | `.codeiumignore` / `.devinignore`, repo-level and global `~/.codeium/` | "Max Workspace Size (File Count)"; ~10 GB RAM ⇒ ≤10,000 files | Default: gitignored paths, `node_modules`, **all hidden paths starting with `.`**. Known bug: `.codeiumignore` `!` exceptions do not override `.gitignore` | Yes unless ignored |
| **Augment** | **Yes** | No | `.augmentignore`, must sit at the source root; `!node_modules` re-includes gitignored paths | — | User-driven; ignored paths also dropped from the filesystem watcher | Yes unless ignored |
| **Qodo Merge** | — | No | `ignore_language_framework` selecting `generated_code_ignore.toml` | — | **Explicit committed-codegen glob list** — see §A4 | n/a (diff-scoped) |
| **JetBrains AI Assistant** | — | No | `.aiignore` (gitignore syntax) | — | User-driven; docs suggest `target/`, `out/`, `.mvn/`, `.idea/`, `*.iml`, `*.class` | No, if the suggested `.aiignore` is used |
| **Claude Context (Zilliz MCP)** | **Yes** | No | `.contextignore`, global `~/.context/.contextignore`, `CUSTOM_IGNORE_PATTERNS` | — | Formula: `Final = (supported extensions) − (ignore patterns)`. Defaults include `node_modules/** dist/** build/** out/** target/** coverage/**` and explicitly **`*.min.js, *.min.css, *.bundle.js, *.chunk.js`** | **No** |
| **The Stack v2 / StarCoder2** (corpus, not a tool) | n/a | n/a | n/a | 100,000 lines | **`go-enry`'s `is_generated`**, plus "auto-generated"/"automatically generated" in first 5 lines, long-line filter, alpha filter, encoded-data filter, MinHash-LSH near-dedup | No |

**Two conclusions from the table.**

1. **Exactly one production system honours `.gitattributes` for indexing: GitHub.** Everybody
   else offers a hand-written ignore file. That is an opportunity, not a warning — honouring
   `linguist-generated` costs one subprocess and makes us correct on repositories that already
   did the work.
2. **Everyone else who solved this solved it by banning `dist/`, `build/`, `out/`, `target/`
   outright** (Continue, Claude Context, JetBrains' suggested `.aiignore`). We deliberately
   went the other way to fix a real blind spot. That is defensible — but it means we own the
   discrimination problem that the blanket-ban crowd never has to face, and content
   classification is the only tool that solves it.

---

## E. The git-tracked build-output question — explicit guidance

### E.1 Is "git-tracked ⇒ index it" the right signal?

**No. It is necessary but not sufficient, and it fails on the exact class of file that
motivated this report.**

- Committed GitHub Action bundles are tracked **because the platform requires it**. GitHub
  Actions are fetched straight from repository source, so `dist/index.js` must be committed
  and kept in sync; teams commonly add a CI step that re-runs `ncc build` and fails the job
  if `dist/` changed
  ([cardinalby](https://cardinalby.github.io/blog/post/github-actions/js-action-packing-and-releasing/)).
  Git-tracking here is a *deployment* fact, not an authorship fact.
- The same holds for committed `dist/js/app.js`, vendored web assets, and generated protobuf
  stubs. The industry norm is to commit them.

**Keep git-tracking as the gate that opens the door, then run the content test.** Concretely,
in `core/indexing/admission-policy.js`, change `isBuildOutputOnly(r) && trackedFiles().has(r)`
to:

```
readmit(rel) =
      isBuildOutputOnly(rel)
  &&  trackedFiles().has(rel)
  &&  gitAttr(rel) !== 'generated'  &&  gitAttr(rel) !== 'vendored'
  &&  !looksVendoredByPath(rel)                  // §B.4
  &&  !looksGeneratedByPath(rel)                 // §B.2, §A4
  &&  !looksMinifiedByContent(head(rel, 256KiB)) // §A2
```

`gitAttr(rel) === 'generated:false'` short-circuits to **admit**, before every other clause.

Ordering matters and costs almost nothing: the first four predicates are string operations
on a path. Only files that survive all of them pay a 256 KiB read — and those files were
going to be read and chunked anyway.

### E.2 Sanity check against the three real repositories

| File | Tracked | Path-vendored | Path-generated | Content-minified | Result |
|---|---|---|---|---|---|
| `src/build/*.jam` (Boost.Build) | yes | no | no | no | **INDEX** ✅ |
| `src/scikit_build_core/build/*.py` | yes | no | no | no | **INDEX** ✅ |
| `include/.../target/*.h` | yes | no | no | no | **INDEX** ✅ |
| `.github/actions/x/dist/index.js` | yes | **yes** — `(^\|/)\.github/` **and** `(^\|/)dist/` | no | **yes** — M1/M5/M6 | **SKIP** ✅ |
| `dist/js/app.js` | yes | **yes** — `(^\|/)dist/` | no | **yes** — M1/M5 | **SKIP** ✅ |
| `dist/css/app.css` | yes | **yes** — `(^\|/)dist/` | no | **yes** — M1/M3 | **SKIP** ✅ |
| build test snapshots | yes | maybe `testdata/` | no | usually not | **Tier 2** — grep-keep, vector-skip |

Every one of the six is decided correctly, and four of them are decided by a path rule
before any file is read.

### E.3 Should we honour `.gitattributes`? — Yes, and it is the single highest-leverage item

**Reasons.**

1. **It is the intended mechanism.** GitHub's own documentation prescribes
   `build/** linguist-generated=false` as the fix for "real source lives in an
   excluded-by-default directory" — our exact problem, solved from the repository side.
2. **It is the mechanism repositories that commit bundles already use** to mark them
   (`dist/** linguist-generated`), and today we ignore that signal entirely.
3. **It is a two-way override**, so it doubles as our escape hatch for both false positives
   and false negatives, at zero maintenance cost to us.
4. **It is cheap and exact.** One `git check-attr --stdin -z` per index run, using git's own
   path-matching rules, including nested `.gitattributes` files. No glob engine of our own
   to get subtly wrong.
5. **It costs nothing when unused.** Most repositories set no linguist attributes; the call
   returns `unspecified` for every path and the heuristics run exactly as before.

**Caveats to encode.**

- Attributes only take effect once `.gitattributes` is **committed** (Linguist docs). Use
  `git check-attr` without `--cached` so the working tree is consulted — this matches
  sweet-search's documented "tracks the WORKING TREE" semantics.
- Trust the attribute over the heuristic in **both** directions, matching Linguist's
  `lazy_blob.rb` precedence exactly. A repository saying "this is source" outranks our
  guess.
- One caution worth logging: GitHub's vendored path rules produce real false positives — a
  directory named `external/` trips `(^|/)[Ee]xtern(als?)?/` and silently disappears from
  code search
  ([community discussion #84737](https://github.com/orgs/community/discussions/84737)).
  Prefer the two-way override over an ever-growing pattern list, and emit a per-run
  "skipped, and why" report so the failure mode is visible rather than silent.

### E.4 Signals we considered and rejected

| Rejected signal | Why |
|---|---|
| `git log` churn shape (generated files change in lockstep, huge diffs, few authors) | Requires per-file history. Cost is orders of magnitude above a 256 KiB read, for a weaker signal. |
| "Is there a source twin?" (`dist/app.js` next to `src/app.js`) | Too many layouts. Fails on `.github/actions/*/dist/`, where the source is `src/` one level up but the mapping is not general. |
| Blanket-ban `dist/` `build/` `out/` `target/` (Continue, Claude Context) | This is the regression we just fixed. Do not go back. |
| Trigram-count cap (Zoekt) | Sweet-search is not a trigram engine; the cap has no analogue in our index. |
| Depending on `linguist-js` at runtime | Fetches data files over the network at runtime, and drops **every** content-based rule, including the two we need most. See §B.6. |

---

## F. Evidence: does index hygiene measurably help retrieval?

The honest answer: **the direct experiment — "index generated files vs. do not, measure code
retrieval MRR" — does not appear in the 2025–2026 literature.** What exists is strong
indirect evidence from three directions.

**1. Near-duplicates measurably degrade retrieval.** The TREC 2024 RAG track's Ragnarök
framework ([arXiv:2406.16828](https://arxiv.org/abs/2406.16828)) deduplicated MS MARCO V2
with **MinHash LSH over 9-gram shingles**, removing **8.35%** of documents. The stated
rationale: left intact, near-duplicates "degrade the downstream retrieval accuracy and
reduce the diversity of the collected documents, potentially impacting the effectiveness of
RAG systems". Committed bundles are the most extreme near-duplicate class in a code
repository — the same library, byte-for-byte, in many `dist/` directories.

**2. Precision, not recall, is the binding constraint in code localization.** SWE-Fixer
([ACL Findings 2025](https://aclanthology.org/2025.findings-acl.62.pdf)) reports BM25 Top-1
at **39.6% precision / 43.6% recall**, collapsing to **3.4% precision / 87.7% recall** at
Top-30, and notes that raising context size raises recall but *lowers* end-task performance
because models are ineffective at localizing within noise. Adding unreadable bundles to the
candidate pool moves us along exactly the wrong axis. This aligns with our own
`resolution-floor` finding that wrong-fix behaviour is arm-universal and bounds retrieval
levers.

**3. The largest code corpora treat generated-file removal as mandatory.** The Stack v2 /
StarCoder2 pipeline ([arXiv:2402.19173](https://arxiv.org/html/2402.19173v1)) removes
autogenerated files **using `go-enry`'s `is_generated`** — that is, Linguist's rules —
alongside long-line, alpha-ratio and encoded-data filters, then near-dedups with MinHash LSH
at **5-grams, Jaccard 0.7**. GitHub's own index does the same at production scale: content
deduplication and delta indexing take **115 TB of code down to ~28 TB of unique content**
across **15.5 billion documents**
([GitHub Engineering Blog](https://github.blog/engineering/architecture-optimization/the-technology-behind-githubs-new-code-search/)).

**What to measure ourselves.** The rules in §A2 are cheap enough to ship behind a flag. Run
the standing held-out protocol: index a repository pool with and without the content
classifier, report aggregate MRR/Recall on the held-out split only, and count skipped files
by rule so any recall loss is attributable to a named rule.

---

## G. The single recommended design

One classifier, five inputs, three outcomes. Ordered; first match wins.

```
classify(path, headBytes) →  ADMIT | TIER2 | SKIP

 1.  .gitattributes    linguist-generated=false / -linguist-generated       → ADMIT
                       linguist-vendored=false  / -linguist-vendored        → ADMIT
 2.  .gitattributes    linguist-generated set                               → TIER2
                       linguist-vendored  set                               → SKIP
 3.  .gitignore        gitignored                                           → SKIP      (unchanged)
 4.  deny-list         our dirs/exts, minus build-output dirs               → SKIP      (unchanged)
 5.  path-vendored     vendor.yml regexes  (§B.4)                           → SKIP
 6.  path-generated    generated.rb path rules + lock files  (§B.2)         → SKIP
 7.  size / encoding   >1 MB, empty, NUL byte in first 8000 bytes           → SKIP
 8.  content-minified  M1–M6  (§A2)                                         → SKIP
 9.  path-codegen      Qodo globs  (§A4)                                    → TIER2
10.  content-marker    widened marker scan, 40 lines / 4 KiB  (§A5)         → TIER2
11.  build-output dir  AND git-tracked                                      → ADMIT
12.  build-output dir  AND NOT git-tracked                                  → SKIP
13.  allowlist         ~90 extension globs                                  → ADMIT
14.  otherwise                                                              → SKIP
```

- **ADMIT** = vector index + grep index (today's behaviour).
- **TIER2** = grep index only, lines truncated at 1,024 bytes, demoted in ranking. This is
  what `chunkLooksGenerated` already does; keep it and widen its input.
- **SKIP** = neither index.

**Note the ordering that fixes our bug:** rules 5, 6 and 8 all sit **above** rule 11. The
git-tracked re-admission still exists, but it can no longer let a bundle through, because
the bundle was already classified two steps earlier.

**Ship order, by value per line of code.**

1. **Rule 5 alone fixes both reported cases today.** `(^|/)\.github/` and `(^|/)dist/` from
   `vendor.yml` catch `.github/actions/*/dist/index.js`, `dist/js/app.js` and
   `dist/css/app.css`. That is one YAML file and one regex union. Ship it first.
2. **Rule 8 (M1 + M5)** — the general fix, ~40 lines, catches committed bundles anywhere,
   including paths we have never seen.
3. **Rules 1 and 2** — `git check-attr`, ~40 lines, one subprocess, and the correctness
   argument is unanswerable.
4. **Rule 6 + rule 9** — data-file ports; mechanical.
5. **Rule 5 full port + rule 7 + rule 10 widening** — long tail.

**Instrument it.** Emit a per-run skip census: `{rule, count, sample paths}`. The failure
mode of every system in §D is *silent* over-exclusion — GitHub's `external/` bug is the
canonical example. Make ours loud.

---

## Sources

Linguist and its ports
- https://github.com/github-linguist/linguist/blob/main/lib/linguist/generated.rb
- https://github.com/github-linguist/linguist/blob/main/lib/linguist/vendor.yml
- https://github.com/github-linguist/linguist/blob/main/lib/linguist/documentation.yml
- https://github.com/github-linguist/linguist/blob/main/lib/linguist/lazy_blob.rb
- https://github.com/github-linguist/linguist/blob/main/lib/linguist/blob_helper.rb
- https://github.com/github-linguist/linguist/blob/main/docs/overrides.md
- https://github.com/github-linguist/linguist/blob/main/docs/troubleshooting.md
- https://github.com/github-linguist/linguist/blob/main/README.md
- https://github.com/go-enry/go-enry
- https://github.com/go-enry/go-enry/blob/master/utils.go
- https://www.npmjs.com/package/linguist-js
- https://github.com/Nixinova/LinguistJS
- https://crates.io/crates/hyperpolyglot

GitHub code search
- https://docs.github.com/en/search-github/github-code-search/about-github-code-search
- https://docs.github.com/en/search-github/searching-on-github/finding-files-on-github
- https://docs.github.com/en/repositories/working-with-files/managing-files/customizing-how-changed-files-appear-on-github
- https://github.blog/engineering/architecture-optimization/the-technology-behind-githubs-new-code-search/
- https://github.com/orgs/community/discussions/84737

Zoekt / Sourcegraph
- https://github.com/sourcegraph/zoekt/blob/main/index/builder.go
- https://github.com/sourcegraph/zoekt/blob/main/index/document.go
- https://github.com/sourcegraph/zoekt/blob/main/ignore/ignore.go
- https://docs.gitlab.com/integration/zoekt/
- https://sourcegraph.com/docs/admin/search
- https://docs.sourcegraph.com/cody/explanations/code_graph_context

Minification detection
- https://github.com/MartinKolarik/is-minified-code
- https://www.npmjs.com/package/is-minified-code

Other tools
- https://cursor.com/docs/reference/ignore-file
- https://cursor.com/help/customization/ignore-files
- https://github.com/continuedev/continue/blob/main/core/indexing/ignore.ts
- https://docs.continue.dev/customize/context/codebase
- https://www.tabbyml.com/blog/repository-context-for-code-completion
- https://github.com/TabbyML/tabby/discussions/1218
- https://aider.chat/2023/10/22/repomap.html
- https://www.iamraghuveer.com/posts/aider-aiderignore/
- https://docs.devin.ai/desktop/context-awareness/windsurf-ignore
- https://docs.augmentcode.com/setup-augment/workspace-indexing
- https://github.com/qodo-ai/pr-agent/blob/main/pr_agent/settings/generated_code_ignore.toml
- https://www.jetbrains.com/help/rider/Reference__Options__Code_Inspection__Generated_Code.html
- https://youtrack.jetbrains.com/articles/SUPPORT-A-702/AI-Assistant-how-to-exclude-specific-folders-files-and-file-name-patterns-from-being-processed-shared-with-LLM

Committed build output
- https://cardinalby.github.io/blog/post/github-actions/js-action-packing-and-releasing/
- https://glebbahmutov.com/blog/trying-github-actions/
- https://github.com/vercel/ncc/issues/586
- https://github.com/golang/go/issues/41196

Corpora, papers, benchmarks
- https://arxiv.org/html/2402.19173v1  (StarCoder2 / The Stack v2)
- https://arxiv.org/abs/2406.16828     (Ragnarök, TREC 2024 RAG)
- https://aclanthology.org/2025.findings-acl.62.pdf  (SWE-Fixer)
- https://arxiv.org/abs/2510.20609     (Practical Code RAG at Scale)
