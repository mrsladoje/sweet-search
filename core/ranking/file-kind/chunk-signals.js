// Per-chunk size, density and reference-count signals: anomalous-chunk, mega-chunk, doc-comment, body-density
// and reference-count rules.

import { hasAblation, inferLineCount, normalizeType, resolveResultName, resolveResultText, resolveResultType } from './result-fields.js';
import { resolveEntityKindInfo } from './entity-kind.js';
import { classifyFileKindIntent } from './query-analysis.js';
import { envFloatRange } from './env-tuning.js';

// Declarative / doc-string-heavy chunk demotion (added 2026-05-05).
//
// Three narrow, independent content-shape triggers — each catches a specific
// failure shape observed in the May-05 novel-probe analysis:
//
//   T1. Declarative-entity demotion. When the chunk's primary entity type is
//       `namespace`, `interface`, or `typeAlias`, the chunk is by definition
//       a declaration block — signatures / property decls without behaviour.
//       Such chunks should not outrank `function`/`impl` chunks for
//       procedural queries. Catches the .d.ts namespace / interface case.
//
//   T2. Raw-string-dominant impl. When > 50 % of an `impl` chunk's non-blank
//       characters live inside Rust raw-string literals (`r#"..."#`,
//       `r"..."`), the chunk is mostly documentation. Catches clap-style
//       flag impls whose `doc_long()` returns a 30-line description (e.g.
//       `impl Flag for SearchZip`).
//
//   T3. Stub-impl. Multiple `fn` definitions in an `impl` chunk with avg
//       body line count < 4. Catches clap-style impls whose individual
//       `doc_long()` is small enough to escape T2 but whose methods are
//       still mostly 1-line literal returns (e.g. `impl Flag for
//       CaseSensitive`).
//
// All three triggers are intent-gated to `implementation` queries, so a
// phrasing like "what is the FastifyInstance interface" — which legitimately
// wants a declaration — is unaffected. T2/T3 are also restricted to chunks
// whose primary entity type is `impl` to avoid touching anything outside
// the Rust idiom we're targeting.
//
// Defaults are conservative. An earlier "execution density" heuristic
// (penalise any chunk with low control-flow ratio) over-fired on data-
// declaration chunks like `lib/errors.js` constant tables, which are the
// genuinely-correct answer for "how does Fastify handle errors". The
// triggers here are shape-specific instead of density-specific.
//
// Disable everything with `ablations: 'no-body-density'` or
// SWEET_SEARCH_BODY_DENSITY=0; per-trigger overrides via
// SWEET_SEARCH_DECLARATIVE_FACTOR / SWEET_SEARCH_RAWSTRING_FACTOR /
// SWEET_SEARCH_STUB_FACTOR.
const DECLARATIVE_ENTITY_TYPES = new Set(['namespace', 'interface', 'typealias']);

/**
 * Detect whether a Rust `impl` chunk is a "stub impl" — fn definitions with
 * no real body. Catches two patterns:
 *
 *  (A) MULTI-METHOD stubs (original ac280d4 case): clap-style flag-arg impls
 *      where every method is a 1-line literal return (e.g. `impl Flag for
 *      CaseSensitive` whose 6 methods total ~6 body lines), independent of
 *      whether `doc_long` carries a big raw-string description.
 *
 *  (B) SINGLE-METHOD trivial-body stubs (added 2026-05-07 — FreshStack uv
 *      UV-FLOW-8 diagnosis): derive-equivalent impls like
 *      `impl Clone for X { fn clone(&self) -> Self { Self {...} } }` with a
 *      body of < 2 substantive lines. The original rule required ≥2 fns and
 *      missed these single-method derive-style impls. Worth being conservative
 *      here — Display::fmt is usually 3+ lines, From::from sometimes IS 1
 *      line and is genuinely trivial. The 1.5-line cutoff fires only on
 *      truly stub-grade single-fns (closer to derive macros than real impls).
 *
 * Returns the estimated average body line count, or `Infinity` if the chunk
 * contains no fn definitions. Lower = more stub-like.
 */
export function avgFnBodyLines(text) {
  if (typeof text !== 'string' || text.length === 0) return Infinity;
  const fnRe = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|const\s+|unsafe\s+)*fn\s+\w+/gm;
  const matches = [];
  let m;
  while ((m = fnRe.exec(text)) !== null) matches.push(m.index);
  if (matches.length === 0) return Infinity;
  let totalBodyLines = 0;
  let counted = 0;
  for (const startIdx of matches) {
    // Find the opening `{` after this fn signature.
    const openIdx = text.indexOf('{', startIdx);
    if (openIdx === -1) continue;
    // Walk braces to find the matching close.
    let depth = 1;
    let j = openIdx + 1;
    let inString = false;
    let stringTerm = null;
    while (j < text.length && depth > 0) {
      const ch = text[j];
      if (inString) {
        if (ch === '\\') { j += 2; continue; }
        if (ch === stringTerm) inString = false;
      } else {
        if (ch === '"' || ch === "'") { inString = true; stringTerm = ch; }
        else if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      j++;
    }
    if (depth !== 0) continue;
    const body = text.slice(openIdx + 1, j - 1);
    const bodyLines = body.split('\n').filter(l => l.trim().length > 0).length;
    totalBodyLines += bodyLines;
    counted++;
  }
  if (counted === 0) return Infinity;
  // Single-fn impls with ≤1.5 substantive body lines (1 trivial line plus
  // the closing brace, or a 1-line `Self { ... }` body) are derive-equivalent
  // stubs (UV-FLOW-8 case: `impl Clone for X { fn clone(&self) -> Self { Self {...} } }`).
  // Multi-fn impls keep the original average-body rule.
  if (counted === 1) {
    return totalBodyLines <= 1.5 ? totalBodyLines : Infinity;
  }
  return totalBodyLines / counted;
}

/**
 * Estimate the fraction of a chunk's characters that live inside Rust
 * raw-string literals. Returns a number in [0, 1].
 *
 * Heuristic: scan the text once tracking entry into `r#"`/`r"` regions and
 * exit at the matching `"#`/`"`. Counts only the inner payload chars.
 */
export function rawStringDensity(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  let i = 0;
  let inside = 0;
  let total = 0;
  const len = text.length;
  while (i < len) {
    if (!/\s/.test(text[i])) total++;
    // Detect `r#*"` opener.
    if (text[i] === 'r' && (text[i + 1] === '"' || text[i + 1] === '#')) {
      let j = i + 1;
      let hashCount = 0;
      while (text[j] === '#') { hashCount++; j++; }
      if (text[j] === '"') {
        // We're inside a raw string. Find the matching close.
        const closeNeedle = '"' + '#'.repeat(hashCount);
        const closeAt = text.indexOf(closeNeedle, j + 1);
        if (closeAt === -1) {
          // unterminated — count rest of file as inside
          for (let k = j + 1; k < len; k++) {
            if (!/\s/.test(text[k])) { inside++; total++; }
          }
          return total === 0 ? 0 : inside / total;
        }
        for (let k = j + 1; k < closeAt; k++) {
          if (!/\s/.test(text[k])) { inside++; total++; }
        }
        i = closeAt + closeNeedle.length;
        continue;
      }
    }
    i++;
  }
  return total === 0 ? 0 : inside / total;
}

/**
 * Demote anomalous chunks: anonymous (symbol==null) AND symbolType==='code',
 * AND ANY of:
 *   (a) file-header — startLine===1 (e.g. file-imports leak)
 *   (b) tiny span    — endLine-startLine<5 (e.g. bare impl-header text)
 *   (c) preprocessor-dense — mid-file anonymous chunk where >50% of non-blank
 *       lines are preprocessor directives (#include/#define/#ifdef/etc.) and
 *       no real declaration appears. Covers C/C++ "include cluster" + "macro
 *       wall" chunks that the (a)/(b) predicates miss because they sit in the
 *       middle of a header and span 10-100 lines (CPP-002 / CPP-003 / CPP-008
 *       root cause: anonymous code chunks dominated by HWY_ATTAINABLE_*,
 *       HWY_HAVE_RUNTIME_DISPATCH_*, #include "hwy/base.h" etc., winning
 *       NL queries on token density).
 *
 * These chunks bypass the entity DB (sparse/grep fallback or chunker leak)
 * and shouldn't surface as top-1.
 *
 * Predicate (a)+(b) verified 2026-05-07 against live probe + FreshStack
 * PARTIALs: legitimate symbol-mislabel cases (S3-Q2, S4-Q1, S6-Q4, S3-Q8)
 * all have span >20 lines and startLine deep in file — they pass through
 * unaffected by (a)+(b). Predicate (c) is narrower: requires zero real
 * declarations AND ≥50% preprocessor lines, so a real code chunk with a
 * couple of #includes at the top is NOT affected.
 *
 * Demote (×0.10) rather than filter so a single-anomalous-result fallback
 * still surfaces the chunk if nothing else matches.
 */
const PREPROC_LINE_RE = /^\s*#\s*(?:include|define|undef|ifdef|ifndef|if|else|elif|endif|pragma|error|warning|line)\b/;

function isPreprocDenseAnonymousChunk(result, opts) {
  const text = resolveResultText(result, opts);
  if (!text || text.length < 50) return false;
  const lines = text.split(/\r?\n/);
  let nonBlank = 0;
  let preproc = 0;
  let hasDecl = false;
  // A `#define` (or `#pragma`/etc.) that ends in `\` is a multi-line
  // continuation. Lines participating in the continuation are functionally
  // part of the preprocessor directive and should count as preproc, not as
  // "real code". Without this, a long multi-line macro definition like
  // `#define HWY_BASELINE_TARGETS (FLAG_A | FLAG_B | \\` ... `FLAG_Z)`
  // dilutes the density below 50% even though the entire span is one macro.
  let inContinuation = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      inContinuation = false;
      continue;
    }
    nonBlank++;
    const isPreproc = PREPROC_LINE_RE.test(line) || inContinuation;
    if (isPreproc) {
      preproc++;
    } else if (DECL_KEYWORD_RE.test(trimmed)) {
      hasDecl = true;
      break;
    }
    // Track continuation for the next line: a preproc line (or an existing
    // continuation line) that ends in `\` continues the directive.
    inContinuation = isPreproc && line.replace(/\s+$/, '').endsWith('\\');
  }
  if (hasDecl) return false;
  if (nonBlank < 5) return false;
  return (preproc / nonBlank) >= 0.5;
}

export function anomalousChunkDemotion(result, opts = {}) {
  if (process.env.SWEET_SEARCH_NO_ANOMALOUS_CHUNK_DEMOTION === '1') return 1.0;
  if (hasAblation(opts.ablations, 'no-anomalous-chunk-demotion')) return 1.0;
  // Format-gated: GCSN-style NL queries hit many file-start anonymous code
  // chunks that are actually correct answers; ungated, this demotion drops
  // GCSN dev MRR by ~27pp. Agent-format queries (probes/FreshStack) don't
  // expect file-header content as the answer.
  if (!opts._isAgentFormat) return 1.0;
  const meta = result?.metadata ?? {};
  const symbolType = result?.symbolType ?? result?.type ?? meta.type ?? null;
  const startLine = Number(result?.startLine ?? meta.startLine ?? meta.line_start);
  const endLine = Number(result?.endLine ?? meta.endLine ?? meta.line_end);
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return 1.0;
  const span = endLine - startLine;

  // PATH 1 — Anonymous code chunks (symbol==null, type='code'):
  //   demote on file-header (startLine===1) OR tiny-span (<5 lines) OR
  //   preprocessor-density >=50% with no declarations.
  const sym = result?.symbol ?? meta.symbol ?? meta.name ?? null;
  const isAnonymousCode = (sym === null || sym === '' || sym === undefined) && symbolType === 'code';
  if (isAnonymousCode) {
    const isFileHeader = startLine === 1;
    const isTinySpan = span < 5;
    const isPreprocDense = (!isFileHeader && !isTinySpan)
      ? isPreprocDenseAnonymousChunk(result, opts)
      : false;
    if (isFileHeader || isTinySpan || isPreprocDense) {
      return opts.anomalousChunkFactor ?? 0.10;
    }
    return 1.0;
  }

  // PATH 2 — Macro-wall chunks (symbolType='macro', span>=5, preprocessor-dense):
  //   adopted from the entity DB during search, these chunks have a non-null
  //   `symbol` like HWY_BASELINE_TARGETS even though their underlying chunk
  //   metadata is anonymous-code. Functionally identical to PATH 1: a wall of
  //   #defines that happens to include one extractable macro entity. Single
  //   small macros (span<5) are NOT demoted — they may be the correct answer
  //   for a query targeting that macro.
  if (symbolType === 'macro' && span >= 5 && isPreprocDenseAnonymousChunk(result, opts)) {
    return opts.anomalousChunkFactor ?? 0.10;
  }

  return 1.0;
}

/**
 * Mega-entity penalty (F1, 2026-05-07): when a chunk's enclosing entity
 * (e.g. function fastify @ 735 lines, Flask App class @ 1516 lines) exceeds
 * a configurable cap, demote the chunk's score. The fix targets the post-
 * retrieval envelope-bloat pattern from the taxonomy: small chunks score
 * highly because they're packed with token-dense surfaces from a mega-fn,
 * and presentation later expands them into a 700+ line envelope.
 *
 * Format-gated (agent only): GCSN single-function NL queries shouldn't
 * be affected by entity envelope sizes.
 *
 * Off by default (Infinity); calibrated via SWEET_SEARCH_MAX_ENVELOPE_LINES
 * env var or opts.maxEnvelopeLines.
 */
// Loop-invariant resolution of the env-controlled envelope cap. Computed
// once per applyResultDemotions call (see ruleOpts setup) and stashed on
// opts._megaEnvelopeMax to avoid the env+parseInt+default lookup per
// result. Resolver returns -1 to mean "skip the rule entirely" (when the
// env var is set to a non-positive/non-finite value).
export function resolveMaxEnvelopeLines(opts) {
  if (typeof opts._megaEnvelopeMax === 'number') return opts._megaEnvelopeMax;
  const raw = process.env.SWEET_SEARCH_MAX_ENVELOPE_LINES;
  if (raw != null && raw !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
    return -1;
  }
  // Default 500: calibrated 2026-05-07 on 60-probe + FreshStack uv + GCSN dev/held-out.
  // Cap=500 yields +1 PASS on probes (S5-Q9 Flask Scaffold) and +1 FAIL→PARTIAL on
  // FreshStack uv (UV-NL-2 do_lock) with zero regression on GCSN. Smaller caps
  // regressed FreshStack; larger caps yielded no further gain.
  return opts.maxEnvelopeLines ?? 500;
}

export function megaEntityPenalty(result, opts = {}) {
  if (!opts._isAgentFormat) return 1.0;
  if (hasAblation(opts.ablations, 'no-mega-entity-penalty')) return 1.0;
  const maxEnvelopeLines = resolveMaxEnvelopeLines(opts);
  if (maxEnvelopeLines <= 0 || !Number.isFinite(maxEnvelopeLines)) return 1.0;
  if (!opts.codeGraphRepo || typeof opts.codeGraphRepo.findEnclosingEntity !== 'function') {
    return 1.0;
  }
  // Route through resolveEntityKindInfo so we hit the search-scoped
  // _entityKindCache instead of going to SQLite again. The cached entity
  // carries startLine/endLine which is all this rule needs.
  const entity = resolveEntityKindInfo(result, opts);
  if (!entity || !Number.isFinite(entity.startLine) || !Number.isFinite(entity.endLine)) return 1.0;
  const entityLines = (entity.endLine - entity.startLine) + 1;
  if (entityLines <= maxEnvelopeLines) return 1.0;
  const factor = opts.megaEntityFactor ?? 0.85;
  return factor;
}

/**
 * Doc-comment-only chunk demotion (F6, 2026-05-07).
 *
 * Detects chunks whose content is predominantly doc-comments without any
 * executable type/function declarations. Diagnosed from S3-Q8 ripgrep
 * (walk.rs:434-469): the chunker split WalkBuilder's 48-line docstring
 * across two chunks; the docstring-only chunk lexically matched
 * "WalkBuilder" + "directory iterator" and out-ranked the chunk that
 * actually contained the `pub struct WalkBuilder` declaration.
 *
 * Predicate: doc-comment lines / total non-blank lines > 0.85 AND no
 * declaration keywords (pub struct/fn/impl/enum/trait/class/def/function).
 *
 * Format-gated to agent: GCSN-style queries don't reliably target docs vs
 * code, and over-demoting comment-heavy chunks could regress. Format-gated
 * keeps it safe per the CLAUDE.md format-gating principle.
 */
const DOC_COMMENT_LINE_RE = /^\s*(?:\/\/[\/!]|\/\*\*?|\*\s|"""|'''|#'\s|#\s|--\s|--\|)/;
const DECL_KEYWORD_RE = /\b(?:pub\s+)?(?:struct|enum|trait|impl|mod)\b|\bfn\s+\w|\bclass\s+\w|\bdef\s+\w|\bfunction\s+\w|\binterface\s+\w|^\s*(?:export\s+)?(?:async\s+)?function\b/;
export function docCommentOnlyDemotion(result, opts = {}) {
  if (!opts._isAgentFormat) return 1.0;
  if (hasAblation(opts.ablations, 'no-doc-comment-demote')) return 1.0;
  const text = resolveResultText(result, opts);
  if (!text || text.length < 80) return 1.0;
  const lines = text.split(/\r?\n/);
  let docLines = 0;
  let nonBlankLines = 0;
  let hasDecl = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    nonBlankLines++;
    if (DOC_COMMENT_LINE_RE.test(line)) {
      docLines++;
    } else if (DECL_KEYWORD_RE.test(trimmed)) {
      hasDecl = true;
      break;
    }
  }
  if (hasDecl) return 1.0;
  if (nonBlankLines < 5) return 1.0;
  if (docLines / nonBlankLines < 0.85) return 1.0;
  return opts.docCommentOnlyFactor ?? 0.70;
}

export function megaChunkSizePenalty(result, opts = {}) {
  const floor = (() => {
    const raw = process.env.SWEET_SEARCH_MEGA_CHUNK_FLOOR;
    if (raw == null || raw === '') return opts.megaChunkFloor ?? 0.80;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : (opts.megaChunkFloor ?? 0.80);
  })();
  if (floor >= 1.0) return 1.0;  // disabled
  const cutoff = (() => {
    const raw = process.env.SWEET_SEARCH_MEGA_CHUNK_CUTOFF;
    if (raw == null || raw === '') return opts.megaChunkCutoff ?? 500;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : (opts.megaChunkCutoff ?? 500);
  })();
  const slope = (() => {
    const raw = process.env.SWEET_SEARCH_MEGA_CHUNK_SLOPE;
    if (raw == null || raw === '') return opts.megaChunkSlope ?? 0.0003;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n >= 0 && n <= 0.01 ? n : (opts.megaChunkSlope ?? 0.0003);
  })();

  const lineCount = inferLineCount(result);
  if (!Number.isFinite(lineCount) || lineCount <= cutoff) return 1.0;
  return Math.max(floor, 1.0 - slope * (lineCount - cutoff));
}

export function bodyDensityMultiplier(result, opts = {}) {
  if (process.env.SWEET_SEARCH_BODY_DENSITY === '0'
      || process.env.SWEET_SEARCH_BODY_DENSITY === 'false') {
    return 1;
  }
  // Procedural-intent gate: a query asking "what is the X interface" should
  // not penalize declaration chunks.
  const intent = opts.intent || classifyFileKindIntent(opts.query || '');
  if (intent !== 'implementation') return 1;

  // Trigger 1: declarative-entity types. Cheap — uses already-known metadata.
  const recordedType = normalizeType(resolveResultType(result));
  const inferredType = recordedType && recordedType !== 'code' && recordedType !== 'chunk'
    ? recordedType
    : normalizeType(resolveEntityKindInfo(result, opts)?.type);
  let mult = 1;
  if (DECLARATIVE_ENTITY_TYPES.has(inferredType)) {
    const declFactor = envFloatRange('SWEET_SEARCH_DECLARATIVE_FACTOR', 0.85);
    mult *= declFactor;
  }

  // Triggers 2 & 3: text-content-derived signals for `impl` chunks.
  // Both target Rust impl blocks specifically because the failure shape
  // we observed (clap-style flag-arg impls) is a Rust idiom — it doesn't
  // exist in JS/TS/Go/Python.
  //
  //   2. Raw-string-dominant — > rsThreshold of non-blank chars live inside
  //      a Rust raw-string literal. Catches impls where `doc_long()` is a
  //      large `r#"..."#` description (e.g. `impl Flag for SearchZip`).
  //
  //   3. Stub-impl — multiple fn defs with avg body line count < stubMaxLines.
  //      Catches impls where every method is a 1-line literal return
  //      (e.g. `impl Flag for CaseSensitive` whose 6 methods total ~6 body
  //      lines), independent of doc string size.
  //
  // Both apply 0.85× by default. They MAY stack on a chunk that hits both,
  // but the combined factor (~0.72) is still milder than the existing
  // doc/test demotion (0.35) so a true impl chunk that wrongly trips one
  // of these can still recover via other signals.
  if (inferredType === 'impl') {
    const text = resolveResultText(result, opts);
    if (text && text.length > 200) {
      const rsDensity = rawStringDensity(text);
      const rsThreshold = envFloatRange('SWEET_SEARCH_RAWSTRING_THRESHOLD', 0.50);
      if (rsDensity > rsThreshold) {
        const rsFactor = envFloatRange('SWEET_SEARCH_RAWSTRING_FACTOR', 0.85);
        mult *= rsFactor;
      }

      const avgBody = avgFnBodyLines(text);
      // Threshold of 4.0 catches:
      //   - CaseSensitive impl in ripgrep (avg body ≈ 2.6 incl. raw-string lines)
      //   - SearchZip impl in ripgrep      (avg body ≈ 3.8)
      //   - Other clap-style flag-arg impls with mostly 1-line literal returns
      // While leaving alone real impls — Display/Iterator/Builder typically
      // have avg body ≥ 5 lines because their core methods are non-trivial.
      const stubMax = envFloatRange('SWEET_SEARCH_STUB_MAX_LINES', 4.0);
      if (avgBody < stubMax) {
        const stubFactor = envFloatRange('SWEET_SEARCH_STUB_FACTOR', 0.85);
        mult *= stubFactor;
      }
    }
  }

  return mult;
}

// Reference-count boost (added 2026-05-05). Aider-style behavioural-graph
// signal: chunks whose primary entity is invoked from many call sites get
// a small log-scaled boost, capped low enough that it can't dominate
// embedding scores.
//
// Why this matters. The bi-encoder ranks `lib/decorate.js`'s `decorate` fn
// purely on text similarity, where doc-rich `.d.ts` namespace blocks or
// generic helpers can outrank it. The call graph encodes that `decorate`
// is invoked 41 times across the codebase while the namespace declaration
// is referenced almost exclusively from imports (4 hits). That's a strong
// behavioural signal: this entity is structurally important.
//
// Restrictions:
//   - Only fires on `function` / `method` / `impl` entities. Declarative
//     types are handled by T1 above and shouldn't compete on call count.
//   - Only fires under `intent='implementation'`. Asking "what is the
//     ConfigError type" should not promote a fn just because it's called
//     a lot.
//   - Counts `type='calls'` only — not `imports`/`uses`/`extends`. Imports
//     are noisy (every file imports a few standards) and don't reflect
//     behavioural invocation.
//   - Boost is `1 + alpha · log(1 + count)` capped at REF_BOOST_CAP. With
//     alpha=0.025 and cap=1.10, 30 calls yields ~1.085, 1000 calls hits
//     the cap. So a heavily-tested helper can't run away with the ranking.
//   - Skipped on chunks larger than REF_BOOST_LARGE_LINES (default 80) to
//     avoid worsening Cluster B (oversized parent chunks like a 700-line
//     factory function whose graph degree is naturally high).
//
// Disable with `ablations: 'no-ref-count-boost'` or
// SWEET_SEARCH_REF_BOOST_ALPHA=0. Suffix aggregation is homonym-gated in
// CodeGraphRepository (`SWEET_SEARCH_REF_SUFFIX_AGG_FANOUT_MAX`, default 12).
const REF_BOOSTABLE_TYPES = new Set(['function', 'method', 'impl']);

export function referenceCountBoost(result, refCounts, opts = {}) {
  if (!refCounts || refCounts.size === 0) return 1;
  if (process.env.SWEET_SEARCH_REF_BOOST_ALPHA === '0') return 1;

  const intent = opts.intent || classifyFileKindIntent(opts.query || '');
  if (intent !== 'implementation') return 1;

  const recordedType = normalizeType(resolveResultType(result));
  const inferredType = recordedType && recordedType !== 'code' && recordedType !== 'chunk'
    ? recordedType
    : normalizeType(resolveEntityKindInfo(result, opts)?.type);
  if (!REF_BOOSTABLE_TYPES.has(inferredType)) return 1;

  const meta = result?.metadata || {};
  const start = result?.startLine ?? meta.startLine;
  const end = result?.endLine ?? meta.endLine;
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const lineCount = Math.max(1, end - start + 1);
    const largeThresh = Number(process.env.SWEET_SEARCH_REF_BOOST_LARGE_LINES || 80);
    if (lineCount > largeThresh) return 1;
  }

  const name = resolveResultName(result) || resolveEntityKindInfo(result, opts)?.name;
  if (!name || name.length < 3) return 1;

  const count = refCounts.get(name) || 0;
  if (count <= 0) return 1;

  const alpha = envFloatRange('SWEET_SEARCH_REF_BOOST_ALPHA', 0.025);
  const cap = (() => {
    const v = process.env.SWEET_SEARCH_REF_BOOST_CAP;
    if (v == null || v === '') return 1.10;
    const n = Number(v);
    return Number.isFinite(n) && n >= 1.0 && n <= 1.5 ? n : 1.10;
  })();
  const boost = Math.min(cap, 1 + alpha * Math.log(1 + count));
  return boost;
}

// Pre-compute incoming-call counts for ALL candidate names in one DB query.
// Without this, the multiplier function would do N queries per result set
// (one per candidate), which adds 100-200 ms in practice.
export function buildRefCountMap(results, opts = {}) {
  const repo = opts.codeGraphRepo;
  if (!repo || typeof repo.countIncomingCallsByNames !== 'function') return new Map();
  const intent = opts.intent || classifyFileKindIntent(opts.query || '');
  if (intent !== 'implementation') return new Map();
  if (process.env.SWEET_SEARCH_REF_BOOST_ALPHA === '0') return new Map();

  const names = [];
  for (const r of results) {
    const recordedType = normalizeType(resolveResultType(r));
    const inferredType = recordedType && recordedType !== 'code' && recordedType !== 'chunk'
      ? recordedType
      : normalizeType(resolveEntityKindInfo(r, opts)?.type);
    if (!REF_BOOSTABLE_TYPES.has(inferredType)) continue;
    const name = resolveResultName(r) || resolveEntityKindInfo(r, opts)?.name;
    if (name && name.length >= 3) names.push(name);
  }
  if (names.length === 0) return new Map();
  try {
    // Default: skip ref-boost for the whole query when any boostable candidate
    // bare name has >12 distinct call-graph targets (dense single-fun corpora).
    // Opt out with SWEET_SEARCH_REF_BOOST_QUERY_HOMONYM_DISABLE=0; tighten for
    // eval with =2..=8 (lifts GCSN, may trim monorepo boosts — see probes).
    const rawTh = process.env.SWEET_SEARCH_REF_BOOST_QUERY_HOMONYM_DISABLE;
    const parsed = parseInt(rawTh != null && rawTh !== '' ? rawTh : '12', 10);
    const homonymCeil = rawTh === '0'
      ? Infinity
      : (Number.isFinite(parsed) && parsed > 0 ? parsed : 12);
    if (typeof repo.relationshipBareFanout === 'function'
        && homonymCeil < Infinity
        && names.some((n) => repo.relationshipBareFanout(n) > homonymCeil)) {
      return new Map();
    }
    return repo.countIncomingCallsByNames(names);
  } catch {
    return new Map();
  }
}
