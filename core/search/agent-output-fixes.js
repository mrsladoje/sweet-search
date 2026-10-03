/**
 * Agent-facing output of the ss-* tools: the compact ss-search / ss-find blocks, the ss-trace
 * rendering, the ss-grep regex repair and hit text. These ARE the shipped ss-* tools
 * (package.json "files"); the wrapper (eval/agent-read-workflows/bin/_ss-helpers.mjs) wires them
 * to the printers. The functions are pure (no I/O, no process state), so they can be unit-tested.
 *
 * Every output choice is fixed; no environment switch changes it. The decided switches (SS_FIX_A
 * and its parts, SS_FIX_GREP_FULLLINE, SS_VARIANT_GREP_BROAD, the ss-grep allocation arms, the
 * semantic ranges, the trace mode budget) were deleted on 2026-10-03 with their losing code
 * paths; old bench rows are reproduced from their git commit.
 *
 * ss-read output is NOT changed here (owner decision 2026-10-01).
 */

// --- test-file detection --------------------------------------------------------------

const TEST_DIR_RE = /(^|\/)(__tests__|__mocks__|tests?|specs?|testdata|test_data|fixtures?|e2e|mocks?|testing|integration[-_]tests?)(\/|$)/i;
const TEST_FILE_RES = [
  /_test\.[a-z0-9]+$/i,                       // Go, Python style foo_test.py
  /(^|\/)test_[^/]+\.[a-z0-9]+$/i,            // Python test_foo.py
  /[-_.](test|spec)\.[cm]?[jt]sx?$/i,         // JS/TS foo.test.ts, foo.spec.js
  /_spec\.[a-z0-9]+$/i,                       // Ruby foo_spec.rb
  // FooTest.java, FooTests.swift: the basename ends so. Written without a leading
  // `(^|\/)[^/]*` (always satisfiable, as the suffix holds no slash): same answers, and the
  // engine does not retry `[^/]*` from every slash (~8x faster; ss-grep weighs every file).
  /Tests?\.(java|kt|kts|scala|cs|swift|m|mm|php)$/,
  /(^|\/)conftest\.py$/i,
];

// The rules above, folded once at load: every case-insensitive rule into one alternation
// (`test` of A|B is A or B), the one case-sensitive rule kept apart. Same answers in one or
// two regex passes instead of seven, no closure per call: ss-grep weighs every matching file.
const TEST_PATH_CI_RE = new RegExp(
  [TEST_DIR_RE, ...TEST_FILE_RES.filter((re) => re.flags.includes('i'))].map((re) => `(?:${re.source})`).join('|'),
  'i',
);
const TEST_PATH_CS_RES = TEST_FILE_RES.filter((re) => !re.flags.includes('i'));

/** Test, spec, fixture or mock file by path shape only. */
export function isTestLikePath(file) {
  let p = String(file || '');
  if (!p) return false;
  if (p.includes('\\')) p = p.replace(/\\/g, '/');
  if (TEST_PATH_CI_RE.test(p)) return true;
  for (let i = 0; i < TEST_PATH_CS_RES.length; i++) if (TEST_PATH_CS_RES[i].test(p)) return true;
  return false;
}

// --- ss-search / ss-find entry selection ---------------------------------------------

/** A summary-only entry: no code was packed for it. */
export function isSummaryOnly(r) {
  return !!r && !r.code && (r.presentation === 'summary' || !!r.summary);
}

const RESTATING_SUMMARY_RE = /^\S+:\d+ — .+ \([^)]*\)$/;

/** True when the summary text only restates the entry header (`file:line — symbol (kind)`). */
export function summaryRestatesHeader(summary) {
  return RESTATING_SUMMARY_RE.test(String(summary ?? '').trim());
}

/**
 * The source lines an entry's code block shows in full, as `{start, end}`, or null. The entry's
 * `startLine..endLine` can be wider than what the agent sees: a packed body cut at the token cap
 * (`// ... (N more lines)`), a sandwich (middle elided), a preview (signature + snippet). The
 * packer stamps `shownStartLine` / `shownEndLine` on full, non-sandwich agent bodies; without
 * them, only a full body whose line count equals the span counts as shown.
 */
export function shownCodeSpan(r) {
  if (!r?.code) return null;
  if (r.expansionKind === 'sandwich' || r.sandwich) {
    // A sandwich covers its span only when its stamp says nothing was elided.
    const s = r.sandwich;
    if (!s || s.elidedHead !== 0 || s.elidedTail !== 0 || s.elisionMarkers !== 0) return null;
  }
  if (Number.isInteger(r.shownStartLine) && Number.isInteger(r.shownEndLine)) {
    return r.shownEndLine >= r.shownStartLine ? { start: r.shownStartLine, end: r.shownEndLine } : null;
  }
  if (r.presentation !== 'full' || !Number.isInteger(r.startLine) || !Number.isInteger(r.endLine)) return null;
  const lines = String(r.code).replace(/\r?\n$/, '').split('\n').length;
  return lines === r.endLine - r.startLine + 1 ? { start: r.startLine, end: r.endLine } : null;
}

/**
 * Entry selection for ss-search / ss-find: dedupe of covered summary entries (A2). Rank order is
 * kept; ranks are never renumbered.
 *
 * A summary-only entry is dropped only when an earlier entry has the IDENTICAL span, or an
 * earlier entry's code SHOWS all of its lines (shownCodeSpan: a cut, sandwiched or preview body
 * covers only what it prints). No same-symbol rule (overloads, `String()` on two receivers,
 * generic names), and a large summary span (a class) never swallows its methods.
 *
 * @param {Array} results   response.results
 * @returns {{entries: Array<{r:object, index:number}>, hiddenCode:boolean}}
 *   hiddenCode: true when an entry that carries code (or a continuation) is not printed.
 */
export function selectEntries(results) {
  const input = (Array.isArray(results) ? results : []).map((r, index) => ({ r, index }));
  const seen = [];
  const list = input.filter(({ r }) => {
    const covered = isSummaryOnly(r) && seen.some((x) => x.file === r.file
      && ((x.start === r.startLine && x.end === r.endLine)
        || (x.shown && r.startLine >= x.shown.start && r.endLine <= x.shown.end)));
    if (!covered) seen.push({ file: r.file, start: r.startLine, end: r.endLine, shown: shownCodeSpan(r) });
    return !covered;
  });
  const printed = new Set(list.map((e) => e.index));
  const hiddenCode = input.some((e) => !printed.has(e.index) && (!!e.r.code || !!e.r.continuation?.code));
  return { entries: list, hiddenCode };
}

/** `path:start-end symbol (kind)` — the whole summary entry on one line (A2). */
export function renderSummaryLine(r) {
  const span = r.endLine && r.endLine !== r.startLine ? `${r.startLine}-${r.endLine}` : `${r.startLine}`;
  const sym = r.symbol ? ` ${r.symbol}` : '';
  const kind = r.symbolType ? ` (${r.symbolType})` : '';
  const stale = r.stale ? ' STALE' : '';
  return `${r.file}:${span}${sym}${kind}${stale}`;
}

/**
 * The original ` sufficient=<verdict>[ (<reason>)]` fragment of the confidence line (the ss-*
 * wrappers' renderSufficiency; _ss-argparse.mjs re-exports this one).
 */
export function renderSufficiencyFragment(response) {
  const verdict = response.sufficiencyVerdict
    ? (response.sufficiencyVerdict === 'yes' ? 'YES' : response.sufficiencyVerdict)
    : (response.sufficient ? 'YES' : 'no');
  const why = response.sufficiencyReason ? ` (${response.sufficiencyReason})` : '';
  return ` sufficient=${verdict}${why}`;
}

/**
 * A1 one-line header: `# <tool>: N results for "<query>"` (ss-find adds ` /<regex>/`). It
 * replaces the routed / budget / used / subMode header.
 */
export function renderCompactHeader(tool, count, query, { regex = null } = {}) {
  const n = Number(count) || 0;
  const rx = regex == null ? '' : ` /${regex}/`;
  return `# ${tool}: ${n} result${n === 1 ? '' : 's'} for "${query ?? ''}"${rx}\n`;
}

/**
 * A1 keeps a compact sufficiency token: `# sufficient=YES` only when the verdict is YES, and
 * only together with a confidence verdict. `sufficiencyText` is the ` sufficient=...` fragment.
 */
export function renderCompactSufficiency(response, sufficiencyText) {
  if (!response?.confidence) return '';
  return /^ sufficient=YES\b/.test(String(sufficiencyText ?? '')) ? '# sufficient=YES\n' : '';
}

// --- A7: imports block that the entry's code already shows -----------------------------

function contentLines(text) {
  return String(text).split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
}

/**
 * A7. The `### imports` block repeats the top of the file. When the entry's own code block
 * already shows those lines, they are dropped:
 *   - every import line is inside the code (as one contiguous run) → '' (no block);
 *   - the last import lines are the first lines of the code → those lines are cut.
 * Otherwise the block is returned unchanged (no partial edits in the middle of a block).
 */
export function dedupeImports(headerContext, code) {
  if (typeof headerContext !== 'string' || !headerContext) return headerContext;
  if (typeof code !== 'string' || !code) return headerContext;
  const head = contentLines(headerContext);
  const body = contentLines(code);
  if (head.length === 0 || body.length === 0) return headerContext;

  // Whole block inside the code, as one contiguous run.
  for (let i = 0; i + head.length <= body.length; i++) {
    let all = true;
    for (let j = 0; j < head.length; j++) if (body[i + j] !== head[j]) { all = false; break; }
    if (all) return '';
  }

  // The tail of the imports is the head of the code: cut that tail.
  let overlap = 0;
  for (let m = Math.min(head.length - 1, body.length); m >= 1; m--) {
    let same = true;
    for (let j = 0; j < m; j++) if (head[head.length - m + j] !== body[j]) { same = false; break; }
    if (same) { overlap = m; break; }
  }
  if (overlap === 0 || !head.slice(head.length - overlap).some((l) => /[A-Za-z]/.test(l))) return headerContext;
  const raw = headerContext.split('\n');
  let toCut = overlap;
  let end = raw.length;
  while (end > 0 && toCut > 0) {
    end--;
    if (raw[end].trim().length > 0) toCut--;
  }
  const kept = raw.slice(0, end);
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept.join('\n');
}

// --- result blocks -------------------------------------------------------------------

/**
 * The ss-search / ss-find result blocks (and the daemon's agent text): A1 rank header without
 * presentation / kind tag and score, A2 one-line summary entries, A7 imports dedupe.
 *
 * @param {Array} results
 * @param {{entries:Array}} plan  selectEntries() output
 * @param {object} o
 * @param {(code:string, startLine:number)=>string} [o.gutter]
 * @returns {string}
 */
export function renderFixedBlocks(results, plan, { gutter = (code) => code } = {}) {
  const parts = [];
  const out = (text) => parts.push(text);
  let wroteAny = false;
  let inSummaryRun = false;
  const lead = () => (wroteAny ? '\n' : '');
  for (const { r } of plan.entries) {
    const stale = r.stale ? ' STALE' : '';
    if (isSummaryOnly(r)) {
      out(`${inSummaryRun ? '' : lead()}${renderSummaryLine(r)}\n`);
      if (r.summary && !summaryRestatesHeader(r.summary)) out(`${r.summary}\n`);
      inSummaryRun = true;
      wroteAny = true;
      continue;
    }
    inSummaryRun = false;
    const sym = r.symbol ? ` [${r.symbolType || 'code'}: ${r.symbol}]` : '';
    out(`${lead()}## #${r.rank} ${r.file}:${r.startLine}-${r.endLine}${sym}${stale}\n`);
    wroteAny = true;
    if (r.headerContext) {
      const imports = r.code ? dedupeImports(r.headerContext, r.code) : r.headerContext;
      if (imports) out(`### imports\n\`\`\`\n${imports}\n\`\`\`\n`);
    }
    if (r.code) {
      out(`\`\`\`\n${gutter(r.code, r.startLine)}\n\`\`\`\n`);
    } else if (r.summary) {
      out(`${r.summary}\n`);
    }
    if (r.neighbors && r.neighbors.rendered) {
      out(`### related (1-hop graph, ~${r.neighbors.tokens} tok)\n${r.neighbors.rendered}\n`);
    }
    if (r.sameFile && r.sameFile.rendered) out(`${r.sameFile.rendered}\n`);
    if (r.siblingLine?.rendered) out(`${r.siblingLine.rendered}\n`);
    if (r.continuation?.rendered) {
      out(`${r.continuation.rendered}\n`);
      if (r.continuation.kind === 'symbol' && r.continuation.code) {
        out(`\`\`\`\n${r.continuation.code}\n\`\`\`\n`);
      }
    }
    if (r.familyManifest?.rendered) out(`${r.familyManifest.rendered}\n`);
  }
  if (!results || results.length === 0) out('(no matches)\n');
  return parts.join('');
}

/**
 * The results whose spans go into the shown-span ledger (Codex ss-read omission): the full
 * result list, unless A2 hid an entry that carries code (a continuation): then only the printed
 * entries, so ss-read never says "already shown" about lines the agent never saw.
 */
export function resultsForOriginalLedger(results, plan) {
  if (!plan?.hiddenCode) return results;
  return plan.entries.map((e) => e.r);
}

// --- ss-trace ---------------------------------------------------------------------------

const EXTERNAL_PATH_RE = /\(external\)/;

function isExternalItem(item) {
  return item?.type === 'external' || !item?.file;
}

/**
 * Compact ss-trace rendering (A4). One row per caller / callee, no bodies, no answer-cue
 * lines, no budget / latency line. Only the requested section prints when `mode` is set.
 * External (not in the repository) callees are filtered; one line says how many.
 */
export function formatTraceCompact(result, { mode = null, notes = [] } = {}) {
  if (!result.target) return `No indexed symbol found for "${result.symbol}".`;
  const t = result.target;
  const show = (section) => mode === null || mode === section;
  const lines = [];
  const provenance = result.sections.callers.provenance || { stored: 0, sameFileFallback: 0 };
  lines.push(`# trace ${t.name} [${t.type}] ${t.filePath}:${t.startLine}-${t.endLine}`);
  lines.push(`fan-in=${t.fanIn} fan-out=${t.fanOut}`);
  if (provenance.sameFileFallback > 0 && provenance.stored === 0) {
    lines.push('note: callers below come from a same-file source scan (no stored cross-file edges).');
  } else if (provenance.sameFileFallback > 0) {
    lines.push(`note: caller sources are mixed — ${provenance.stored} from stored call edges, ${provenance.sameFileFallback} from a same-file source scan.`);
  } else if (t.fanIn === 0 && t.fanOut === 0 && !result.sections.callers.total && !result.sections.callees.total) {
    lines.push('no stored call edges for this symbol — map its sites with one broad ss-grep of the symbol stem instead.');
  }
  for (const n of notes) lines.push(n);
  if (result.disambiguation?.length) {
    lines.push(`ambiguous: using first match; alternatives: ${result.disambiguation.slice(0, 5).map((a) => `${a.owner ? `${a.owner}.` : ''}${a.name} ${a.file}:${a.startLine}`).join(', ')}`);
  }

  const listed = new Set(); // `file:line` of every caller / callee row printed below
  for (const [title, section] of [['callers', result.sections.callers], ['callees', result.sections.callees]]) {
    if (!show(title)) continue;
    const internal = section.items.filter((i) => !isExternalItem(i));
    const external = section.items.length - internal.length;
    // Same count as the full trace (structural-context-format.js): every row, and the distinct
    // callers / callees when they differ, so the heading and fan-in / fan-out read as one set.
    // External rows are counted here and named in the `(+N external ...)` line below.
    const total = section.total || 0;
    const noun = title === 'callers' ? 'caller' : 'callee';
    const count = section.distinct != null && section.distinct !== total
      ? `${total} ${section.siteNoun || 'call sites'}, ${section.distinct} distinct ${noun}${section.distinct === 1 ? '' : 's'}`
      : `${total}`;
    lines.push(`\n## ${title} (${count})`);
    for (const item of internal) {
      lines.push(item.summary);
      listed.add(`${item.file}:${item.startLine || '?'}`);
    }
    if (!internal.length) lines.push('(none)');
    if (external > 0) lines.push(`(+${external} external/unresolved ${title} not listed)`);
  }

  if (show('impact')) {
    // Without a mode word, a one-hop path whose other end is already a printed caller /
    // callee row adds nothing and is dropped. With `impact` asked for, every path prints.
    // Paths that end in an external (not in the repository) symbol are always filtered.
    const oneHopRepeats = (p) => {
      const segs = String(p.path).split(' -> ');
      if (segs.length !== 2) return false;
      const other = p.direction === 'upstream' ? segs[0] : segs[1];
      const loc = other.match(/\(([^()]*)\)$/);
      return !!loc && listed.has(loc[1]);
    };
    const paths = result.sections.impact.paths
      .filter((p) => !EXTERNAL_PATH_RE.test(String(p.path)))
      .filter((p) => mode === 'impact' || !oneHopRepeats(p));
    lines.push(`\n## impact paths (${paths.length}, depth <= ${result.maxDepth})`);
    if (!paths.length) lines.push('(none)');
    paths.forEach((p, i) => lines.push(`${i + 1}. ${p.direction} ${p.path}`));
  }
  return lines.join('\n');
}

/**
 * A4: after the trace switched from a test definition to a non-test one, the alternatives
 * list must still name the test definition (the re-run trace has none of its own).
 */
export function alternativesAfterSwitch(original, chosenFile, chosenLine) {
  const t = original?.target;
  const first = t ? [{ name: t.name, type: t.type, file: t.filePath, startLine: t.startLine }] : [];
  const rest = (original?.disambiguation || []).filter((a) => !(a.file === chosenFile && a.startLine === chosenLine));
  return [...first, ...rest];
}

// --- ss-grep: A5 regex repair -----------------------------------------------------------

/** A regex the engine could not parse (ripgrep / Rust regex), as opposed to a real failure. */
export function isRegexParseError(err) {
  const msg = String(err?.message || err || '');
  return /regex parse error|error parsing regex|unclosed group|unclosed character class|unopened group|unrecognized escape|repetition operator missing|invalid regex|look-?around|backreferences? (are )?not supported/i.test(msg);
}

/**
 * Approximate "does the Rust regex engine accept this?" in JavaScript. Used only to choose
 * which alternatives of a pattern the engine ALREADY rejected need escaping; the engine
 * itself decides afterwards. Rust-only syntax is mapped first (inline flags, \A \z, \pL);
 * Rust-unsupported syntax (look-around, back-references) counts as invalid.
 */
export function rustRegexLooksValid(pattern) {
  const p = String(pattern ?? '');
  if (!p) return false;
  if (/\(\?<?[=!]/.test(p)) return false;            // look-around
  if (/(^|[^\\])(\\\\)*\\[1-9]/.test(p)) return false; // back-reference
  let q = p
    .replace(/\(\?[a-zA-Z-]+\)/g, '')                  // (?i) (?s-m)
    .replace(/\(\?[a-zA-Z-]+:/g, '(?:')                // (?i:...)
    .replace(/\(\?P<([A-Za-z_]\w*)>/g, '(?<$1>')       // (?P<name>...)
    .replace(/\\([^A-Za-z0-9\s])/g, (_m, c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .replace(/\\[Az]/g, '')
    .replace(/\\([pP])([A-Za-z])/g, '\\$1{$2}');
  try {
    new RegExp(q, 'u');
    return true;
  } catch {
    return false;
  }
}

/**
 * Split on top-level alternation: an unescaped `|`, or the GNU `\|`, outside any group and
 * any character class. An unclosed `(` keeps the rest in one branch.
 */
export function splitTopLevelAlternation(pattern) {
  const p = String(pattern ?? '');
  const branches = [];
  let cur = '';
  let depth = 0;
  let inClass = false;
  let classStart = -1;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\' && i + 1 < p.length) {
      const next = p[i + 1];
      if (!inClass && depth === 0 && next === '|') { branches.push(cur); cur = ''; i++; continue; }
      cur += ch + next;
      i++;
      continue;
    }
    if (inClass) {
      cur += ch;
      if (ch === ']' && i > classStart + 1 && !(i === classStart + 2 && p[classStart + 1] === '^')) inClass = false;
      continue;
    }
    if (ch === '[') { inClass = true; classStart = i; cur += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    if (ch === '|' && depth === 0) { branches.push(cur); cur = ''; continue; }
    cur += ch;
  }
  branches.push(cur);
  return branches;
}

/**
 * The characters the engine's GNU-dialect retry rewrites when written with a backslash (`\(` `\)`
 * `\|` `\+` `\{m,n\}`; regex-dialect.js). On a zero-hit search it would turn an escape that THIS
 * repair added back into an operator (`functio\(n\)` was searched as `functio(n)` and printed every
 * `function` under a "searched it as literal text" note), so the repair writes these characters as
 * one-character classes (`[(]`), which that retry never rewrites. `?` and `}` use the same form.
 */
const GNU_OPERATOR_CHARS = new Set(['(', ')', '{', '}', '+', '?', '|']);

/** One character as literal text, in a form the GNU-dialect retry leaves alone. */
function literalChar(ch) {
  return GNU_OPERATOR_CHARS.has(ch) ? `[${ch}]` : `\\${ch}`;
}

/** Escape only the parts of one branch that cannot parse: lone `(` `)` `[` `{` `}` and a leading quantifier. */
function escapeBrokenParts(branch) {
  const tokens = [];
  const open = [];
  for (let i = 0; i < branch.length; i++) {
    const ch = branch[i];
    if (ch === '\\' && i + 1 < branch.length) { tokens.push(ch + branch[i + 1]); i++; continue; }
    if (ch === '[') {
      let j = i + 1;
      if (branch[j] === '^') j++;
      if (branch[j] === ']') j++;
      for (; j < branch.length; j++) {
        if (branch[j] === '\\') { j++; continue; }
        if (branch[j] === ']') break;
      }
      if (j < branch.length) { tokens.push(branch.slice(i, j + 1)); i = j; } else tokens.push('\\[');
      continue;
    }
    if (ch === '(') { open.push(tokens.length); tokens.push('('); continue; }
    if (ch === ')') { if (open.length) { open.pop(); tokens.push(')'); } else tokens.push(literalChar(')')); continue; }
    if (ch === '{') {
      const q = /^\{\d+(,\d*)?\}/.exec(branch.slice(i));
      const prev = tokens[tokens.length - 1];
      if (q && prev && prev !== '(' && prev !== '|' && !/^[*+?]$/.test(prev)) { tokens.push(q[0]); i += q[0].length - 1; } else tokens.push(literalChar('{'));
      continue;
    }
    if (ch === '}') { tokens.push(literalChar('}')); continue; }
    if (/[*+?]/.test(ch)) {
      const prev = tokens[tokens.length - 1];
      if (!prev || prev === '(' || prev === '|') { tokens.push(literalChar(ch)); continue; }
    }
    tokens.push(ch);
  }
  for (const at of open) {
    tokens[at] = literalChar('(');
    // A `|` the author wrote INSIDE this group (`app.(get|post`) must not become a top-level
    // alternative once the `(` is literal: that would search for any `post`. The `|` tokens at
    // the group's own depth become a literal pipe, written `[|]` (see GNU_OPERATOR_CHARS);
    // `|` inside a closed nested group keeps its meaning.
    let depth = 0;
    for (let i = at + 1; i < tokens.length; i++) {
      if (tokens[i] === '(') depth++;
      else if (tokens[i] === ')') depth--;
      else if (tokens[i] === '|' && depth === 0) tokens[i] = literalChar('|');
    }
  }
  return tokens.join('');
}

/** A branch as plain literal text: a punctuation escape (`\(`) is the literal character. */
function literalBranch(branch) {
  return String(branch).replace(/\\([^A-Za-z0-9])/g, '$1').replace(/[.*+?^${}()|[\]\\]/g, literalChar);
}

/**
 * A5. Repair a pattern the engine rejected, alternative by alternative: an alternative that
 * parses is kept as it is; a broken one gets only its broken parts escaped, or (if that
 * still does not parse) is searched as literal text. `|` alternatives are never merged into
 * one literal string.
 *
 * @returns {{pattern:string, wholeLiteral:boolean, repairedBranches:number}}
 */
export function repairRegexBranches(raw) {
  const branches = splitTopLevelAlternation(raw);
  let repairedBranches = 0;
  const fixed = branches.map((b) => {
    if (rustRegexLooksValid(b)) return b;
    repairedBranches++;
    // Look-around / back-references have no Rust form; escaping a part would change the meaning.
    if (/\(\?<?[=!]/.test(b) || /(^|[^\\])(\\\\)*\\[1-9]/.test(b)) return literalBranch(b);
    const partial = escapeBrokenParts(b);
    if (partial !== b && rustRegexLooksValid(partial)) return partial;
    return literalBranch(b);
  });
  if (repairedBranches === 0) {
    // Every alternative looks valid to JavaScript but the engine rejected the whole: search
    // each alternative as literal text, still as alternatives.
    return { pattern: branches.map(literalBranch).join('|'), wholeLiteral: branches.length === 1, repairedBranches: branches.length };
  }
  return {
    pattern: fixed.join('|'),
    // One alternative, and what is searched is plain literal text (no regex left).
    wholeLiteral: branches.length === 1 && fixed[0] === literalBranch(branches[0]),
    repairedBranches,
  };
}

// --- ss-grep: hit text ----------------------------------------------------------------

export const GREP_HIT_TEXT_MAX = 140;

/**
 * A broad ss-grep (at least GREP_BROAD_MIN_HITS total matches) prints each hit line in a window of
 * at most GREP_BROAD_HIT_CHARS chars instead of GREP_HIT_TEXT_MAX. Decided by the 2026-10-03 diet1
 * A/B (core/prompt-optimization/data/obs-loop/TRACES-diet1.md): 18 broad greps saved ~256 chars
 * each, with no re-grep, no extra read and no misread.
 */
export const GREP_BROAD_MIN_HITS = 50;
export const GREP_BROAD_HIT_CHARS = 60;

/**
 * The grepHitText `max` for a grep with `total` matches (undefined = the default window).
 * The thresholds are parameters so a unit test can use a small fixture.
 */
export function grepBroadHitMax(total, minHits = GREP_BROAD_MIN_HITS, chars = GREP_BROAD_HIT_CHARS) {
  return total >= minHits ? chars : undefined;
}
// Chars of the line kept before the match when a long line is cut on the left.
const GREP_HIT_LEAD = 40;

/**
 * The text ss-grep prints after `file:line: ` for one hit.
 *
 * The hit's full source line (`content`), as `grep -n` prints it, whitespace collapsed. A line longer than GREP_HIT_TEXT_MAX chars shows a
 * window of at most that many chars that contains the match, with `…` at each cut side; a match
 * near the start keeps the head of the line. A hit with no line text falls back to the matched text.
 *
 * `max` (grepBroadHitMax): the window size for a full line, default GREP_HIT_TEXT_MAX.
 *
 * @param {{matchText?: string, content?: string, column?: number}} m
 * @param {{max?: number}} [opts]
 */
export function grepHitText(m, { max = GREP_HIT_TEXT_MAX } = {}) {
  const matched = String(m?.matchText || '').replace(/\s+/g, ' ').trim().slice(0, GREP_HIT_TEXT_MAX);
  const raw = typeof m?.content === 'string' ? m.content : '';
  if (!raw.trim()) return matched;

  // Collapse whitespace like .replace(/\s+/g, ' ').trim(), keeping where each raw char lands.
  let line = '';
  const at = new Array(raw.length);
  let gap = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (line) gap = true;
      at[i] = line.length + (gap ? 1 : 0);
      continue;
    }
    if (gap) { line += ' '; gap = false; }
    at[i] = line.length;
    line += ch;
  }
  if (line.length <= max) return line;
  const head = () => `${sliceWhole(line, 0, max - 1)}…`;

  // The match in the raw line: at its column when the text is there, else its first occurrence.
  // Producers trim the end of `content` but not of the match (`foo\s*`, a CRLF `\r`), so trim it too.
  const mt = String(m?.matchText || '').replace(/\s+$/, '');
  const col = Number.isInteger(m?.column) ? m.column - 1 : -1;
  const rawStart = mt && col >= 0 && raw.startsWith(mt, col) ? col : (mt ? raw.indexOf(mt) : -1);
  if (rawStart < 0) return head();
  const start = Math.min(at[rawStart], line.length);
  const end = Math.max(start, Math.min(at[rawStart + mt.length - 1] + 1, line.length));

  if (end <= max - 1) return head();
  const tailRoom = max - 1;
  if (line.length - tailRoom <= start) return `…${sliceWhole(line, line.length - tailRoom, line.length)}`;
  const room = max - 2;
  const lead = Math.min(GREP_HIT_LEAD, Math.floor(max / 3));
  const from = Math.min(start, Math.max(start - lead, end - room));
  if (from === 0) return head();
  return `…${sliceWhole(line, from, from + room)}…`;
}

/** line.slice(from, to) that never cuts a surrogate pair in half (it would print as U+FFFD). */
function sliceWhole(line, from, to) {
  if (isLowSurrogate(line.charCodeAt(from))) from++;
  if (to < line.length && isLowSurrogate(line.charCodeAt(to))) to--;
  return line.slice(from, to);
}

const isLowSurrogate = (c) => c >= 0xdc00 && c <= 0xdfff;
