// Content-shape detector for minified / bundled files.
//
// A committed bundle (`.github/actions/*/dist/index.js`, `dist/js/app.js`, a webpack
// or ncc output) is git-TRACKED — so "git tracks it" cannot separate it from real
// source kept under build-output dirs (Boost.Build's `src/build/*.jam`, a repo's
// `cmd/agent/dist/checks/*.py` package). The signal that separates them is content
// SHAPE: a minified file is one or a few enormous lines and is unreadable noise in
// BOTH the vector and the grep index, so it is skipped from indexing entirely.
//
// Rules and thresholds are ported from battle-tested sources (2026 research pass,
// eval/task-completion-bench/handoffs/improve/INDEX-HYGIENE-RESEARCH-2026-08-28.md):
//   M1 median line length > 200        — is-minified-code (github.com/MartinKolarik/is-minified-code)
//   M2 one non-empty line, file >=1KB   — is-minified-code
//   M3 mean line length > 110 (js/css)  — GitHub Linguist generated.rb `minified_files?`
//   M4 >= 2 lines over 4096 bytes        — GitHub code search long-line rule
//   M5 source-map trailer                — Linguist `has_source_map?`
//   M6 bundler banner in the head        — webpack/ncc/parcel/systemjs output shape
// The median (M1) is the workhorse: real hand-written source has a median line length
// of roughly 20-60 bytes and essentially never exceeds 200, so false positives are rare.

// JS/CSS comment strip (best-effort; harmless on other languages — median still holds).
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\/\r?\n?|\/\/.{0,200}?(?:\r?\n|$)/g;
const SOURCE_MAP = /^\/[*/][#@] source(?:Mapping)?URL|sourceURL=/;
const BUNDLER_BANNER = /webpackBootstrap|__webpack_require__|parcelRequire|System\.register|\(function\s*\(modules\)|\/\*+\/ ?\(\(\) ?=> ?\{/;

// Extensions where a mean-line-length rule is safe to apply (Linguist scopes M3 to these).
const MINIFIABLE_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.css', '.scss', '.less']);

// Doc/data/markup extensions where long lines are normal (a big JSON blob, an SVG, a
// minified HTML page). We do NOT apply the aggressive median rule to these — they are
// handled by their own chunkers and are rarely a bundle we must exclude. StarCoder2's
// pipeline likewise exempts HTML/JSON/Markdown from its line-length filter.
const DATA_DOC_EXT = new Set(['.json', '.jsonc', '.json5', '.md', '.mdx', '.markdown', '.rst', '.txt', '.html', '.htm', '.xhtml', '.xml', '.svg', '.csv', '.yaml', '.yml', '.map']);

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {string} headText  first ~32 KiB of the file (enough for median / single-line / banner).
 * @param {object} [opts]
 * @param {string} [opts.ext]       lower-cased extension incl. dot, e.g. ".js".
 * @param {string} [opts.tailText]  last ~4 KiB (only needed to catch a source-map trailer).
 * @param {number} [opts.totalBytes] full file size, if known (defaults to headText length).
 * @returns {false | {rule: string}}  a rule object when the file looks minified, else false.
 */
export function looksMinified(headText, { ext = '', tailText = '', totalBytes } = {}) {
  if (!headText) return false;
  const e = String(ext).toLowerCase();
  const bytes = typeof totalBytes === 'number' ? totalBytes : headText.length;

  // M5 — source-map trailer. Highest precision, catches pretty-printed bundles the
  // median misses. Check the tail if we have it, else the head's last lines.
  const tail = tailText || headText;
  const tailLines = tail.split('\n').slice(-2);
  if (tailLines.some((l) => SOURCE_MAP.test(l))) return { rule: 'source-map-trailer' };

  // M6 — bundler banner in the first 4 KiB.
  if (BUNDLER_BANNER.test(headText.slice(0, 4096))) return { rule: 'bundler-banner' };

  // Below 1 KiB a file is too small to be a problematic bundle; the fuzzy
  // line-length rules would only risk a false positive on a short one-liner.
  // (The high-precision source-map / banner rules above still apply at any size.)
  if (bytes < 1024) return false;

  // Data/doc/markup: long lines are normal; skip the line-length rules for them.
  if (DATA_DOC_EXT.has(e)) return false;

  const stripped = headText.replace(COMMENT_PATTERN, '');
  const lens = stripped.split('\n').map((l) => l.length).filter((l) => l > 0);

  // M2 — a single enormous line (the classic single-line bundle). Guard on size so a
  // short one-liner source file is never caught.
  if (lens.length <= 1 && bytes >= 1024) return { rule: 'single-line' };

  // M1 — median line length. The workhorse, language-agnostic.
  if (median(lens) > 200) return { rule: 'median-gt-200' };

  // M3 — mean line length, JS/CSS only (Linguist's exact rule).
  if (MINIFIABLE_EXT.has(e)) {
    const mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
    if (mean > 110) return { rule: 'mean-gt-110' };
  }

  // M4 — two or more absurdly long lines.
  if (lens.filter((l) => l > 4096).length >= 2) return { rule: 'long-lines' };

  return false;
}

export const _internal = { median, COMMENT_PATTERN, SOURCE_MAP, BUNDLER_BANNER, MINIFIABLE_EXT, DATA_DOC_EXT };
