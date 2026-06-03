/**
 * USD — tool-response Usefulness/Signal-Density metric (Metric Forge, Phase 4-5).
 *
 * Implements `core/prompt-optimization/data/metric-forge/final-spec.md` (the
 * Phase-3 hardened spec). USD is an INTRINSIC 0-1 score on the RAW TOOL RESPONSE
 * (the bytes a ss-* or native rg/grep/read episode emits *before* the agent
 * reasons), NOT the agent's final prose answer. It is designed to be hard to game
 * by verbosity/format and SYMMETRIC across the ss-* and native arms.
 *
 * The whole function (spec §2):
 *   FLOOR     g  = grounding(R, gold) ∈ {0,1}            wrong/empty ⇒ USD := 0
 *   CONTENT   D1..D5 ∈ {0,1} (panel-median); content = mean(D1..D5)
 *   PURITY    C  = signal_purity ∈ {0,1} (panel-median)
 *   DENSITY   purity_ratio = used_tokens_AST / total_tokens ∈ (0,1]   PROGRAMMATIC, gold/AST-snapped
 *   standard: USD = g·C·content · (φ + (1−φ)·purity_ratio^α)          φ=0.25, α=2
 *   no-match: USD = g · max(0, 1 − total_tokens/τ)                    τ=400
 *
 * The DIV-4 fix (the crux, spec §5a): the density NUMERATOR is computed
 * PROGRAMMATICALLY from boundary-snapped spans — the judge cites spans for the
 * v=1 decision and audit, but CANNOT size the denominator. Padding inflates
 * `total_tokens` but never `used_tokens_AST`, so `purity_ratio` (and USD) falls.
 *
 * Symmetric token accounting (spec §5d, B3): both arms are scored on the SAME
 * post-strip+filter bytes `R_judge`; `total_tokens = estimateTokens(R_judge)`;
 * the same artifact filter runs on both arms; native code is NEVER dropped.
 *
 * Dependency-light by design (mirrors variant-loader.mjs): reuses `estimateTokens`
 * + `clip` + `hashContent` from the existing harness; the AST snap is a
 * lightweight brace/indent-balanced node finder (spec §5a clause (b)/(c) — the
 * deterministic floor that also covers the 5 OOD grammars without loading 18
 * tree-sitter parsers, which the vitest config flags as an OOM risk). No judge
 * network calls live here; the panel is injected (clone of judgePanelScore).
 */

import { estimateTokens } from './variant-loader.mjs';
import { clip, hashContent } from './p7-shared.mjs';

// ─── pre-committed parameters (spec §5c — locked in rubricHash) ──────────────

export const USD_PARAMS = Object.freeze({
  phi: 0.25, // density-shaper floor (multiplier ∈ [φ,1])
  alpha: 2, // density-shaper exponent
  tau: 400, // no-match token budget
  caliper: 0.2, // natural-log token caliper for §5b matching
  minCommonSupport: 0.4, // min fraction of either arm on common support
  thetaFloor: 0.5, // grounding panel-median threshold
  d2BodyFraction: 0.7, // §4 D2 ≥70%-of-body gate
});

export const USD_CRITERIA = Object.freeze([
  'answer_grounding', // D1
  'workable_code', // D2
  'navigability', // D3
  'edit_locality', // D4
  'sufficiency', // D5
  'signal_purity', // C
]);

// ─── §9.2 the rubric (verbatim, hashed + frozen) ─────────────────────────────

export const JUDGE_USD_SYSTEM_PROMPT =
  'You are a strict, evidence-anchored grader of a CODE-SEARCH TOOL RESPONSE. ' +
  'You are NOT grading prose quality, length, or formatting. You are judging ' +
  'whether the returned code/context carries the signal an engineer needs to act ' +
  'on the query. A LONGER RESPONSE IS NOT BETTER; a longer response that buries ' +
  'the answer is WORSE. Score CONTENT, never length or style. For every criterion ' +
  'you mark 1, you MUST first quote the smallest verbatim span of the response ' +
  'that proves it — do NOT quote an enclosing block when a tighter span proves the ' +
  'criterion, and do NOT quote the whole response. If you cannot quote a span, the ' +
  'criterion is 0.\n\n' +
  'You are given: the QUERY; the GOLD (the minimal code spans / expected ' +
  'files+symbols+facts that answer it, or "no match expected"); and the RESPONSE ' +
  '(raw tool output, tool chrome removed). Judge the RESPONSE against the GOLD.\n\n' +
  'Score each criterion 0 or 1, citing the smallest verbatim span before each 1:\n' +
  '1. answer_grounding — Does the RESPONSE contain the SPECIFIC code or fact that ' +
  'ANSWERS the query (the gold answer span itself), not merely something near it or ' +
  'a pointer to it? (1 only if the answering code/fact is literally present.)\n' +
  '2. workable_code — Is EDIT-READY code present — a complete or near-complete ' +
  '(signature + body) runnable symbol, not only a file:line pointer or a bare name? ' +
  'A span ending in a truncation marker like "// …(N more lines)" is NOT edit-ready. ' +
  '(1 only if you can quote a runnable code block.)\n' +
  '3. navigability — Does the RESPONSE make the RELEVANT NEIGHBORS reachable ' +
  '(callers, callees, related types, or the stated relation) well enough to ' +
  'understand the change site WITHOUT issuing another search? (1 only if you can ' +
  'quote the neighbor reference.)\n' +
  '4. edit_locality — Does the RESPONSE pin the SPECIFIC site (the function/region ' +
  'AND file) where an edit would go, not just the file? (1 only if you can quote a ' +
  'span that names the specific region.)\n' +
  '5. sufficiency — Could a competent engineer ACT NOW on this RESPONSE without ' +
  'searching again, judged against the GOLD (NOT against any self-reported ' +
  '"sufficient" flag in the response)? (1 only if the gold answer is fully covered.)\n' +
  '6. signal_purity — Is the RESPONSE FREE of content not needed for this query — ' +
  'no irrelevant code blocks, no unmarked false-positive matches, no duplicated or ' +
  'boilerplate filler? Dock this to 0 if the response pads, repeats, or includes ' +
  'matches that do not concern the query. This criterion penalizes BOTH a bloated ' +
  'multi-block dump AND an unfiltered match list full of unrelated hits. (1 only if ' +
  'essentially all of the response is on-target.)\n\n' +
  'Output ONLY this JSON: ' +
  '{"answer_grounding":{"span":"<verbatim>","v":0|1},"workable_code":{"span":"...","v":0|1},' +
  '"navigability":{"span":"...","v":0|1},"edit_locality":{"span":"...","v":0|1},' +
  '"sufficiency":{"span":"...","v":0|1},"signal_purity":{"span":"...","v":0|1}}. ' +
  'Use "span":"" for any criterion you score 0.';

/**
 * The locked rubric bundle hash (spec §9.5). Any edit to the rubric string, the
 * criteria list, or any pre-committed parameter changes this hash → forces a new
 * run-id. Scores carry their `rubricHash`; no re-judging under an edited rubric.
 */
export function computeRubricHash(params = USD_PARAMS) {
  return hashContent(
    [
      JUDGE_USD_SYSTEM_PROMPT,
      USD_CRITERIA.join(','),
      `phi=${params.phi}`,
      `alpha=${params.alpha}`,
      `tau=${params.tau}`,
      `caliper=${params.caliper}`,
      `thetaFloor=${params.thetaFloor}`,
      `d2BodyFraction=${params.d2BodyFraction}`,
    ].join('\n'),
  );
}

// ─── §5d  stripChrome + artifactFilter → R_judge (symmetric, pure) ───────────

// ss-* machine chrome we strip BEFORE judging (and exclude from total_tokens).
// ONLY true chrome: the route-meta header line, the confidence/sufficient
// self-report line, the per-result rank/tier LABEL tokens. The `file:line`
// locator and the 1-hop graph references are CONTENT and are KEPT (spec §5d.3).
const SS_ROUTE_META_RE = /^#\s*ss-(search|find|semantic|trace|grep|read):.*$/gim;
const SS_CONFIDENCE_RE = /^#\s*confidence=.*$/gim;
// "## #1 path:117-445 [namespace: x86] (full kind=chunk) score=0.368"
// → keep "## path:117-445" (the locator is content); strip rank#, the
//   [namespace:…]/(kind=…) tier labels, and score=. The path:line stays.
const SS_RESULT_HEADER_RE = /^(#{1,6})\s*#\d+\s+(\S+?)\s+(?:\[[^\]]*\]\s*)*(?:\([^)]*\)\s*)*(?:score=[-\d.]+\s*)*$/gim;
// ss SERVER-LIFECYCLE boot noise that cold-start leaks into the first tool
// result (model + HNSW/LateInteraction index loading, embedding warmup, the
// trailing `exit 0`). This is machine chrome, NOT code content; native has no
// equivalent server, so leaving it in would inflate ss's total_tokens denominator
// and feed boot noise to the judge — an arm-ASYMMETRIC pollution (the B3 class).
// Discovered in real run-v1 data: 100% of ss captures carried it, 0% of native.
// Each pattern matches a whole machine log LINE only; no code line matches these.
const SS_SERVER_NOISE_RE = new RegExp(
  '^\\s*(?:' + [
    'BinaryHNSW:.*',
    'HNSW:\\s*(?:Mapped|Loaded).*',
    'LateInteraction:.*',
    '\\[LateInteraction\\].*',
    'Warming up embedding.*',
    'Loading local model:.*',
    'Provider:\\s*local.*',
    'Prewarm(?:ing)?\\b.*',
    'Embedding service.*',
    'Server (?:ready|listening|started).*',
    'exit\\s+\\d+',
  ].join('|') + ')\\s*$',
  'gim',
);

export function stripChrome(text, arm) {
  if (typeof text !== 'string') return '';
  if (arm !== 'ss') return text; // native stdout carries no ss chrome
  return text
    .replace(SS_ROUTE_META_RE, '')
    .replace(SS_CONFIDENCE_RE, '')
    .replace(SS_SERVER_NOISE_RE, '')
    .replace(SS_RESULT_HEADER_RE, (_m, hashes, locator) => `${hashes} ${locator}`);
}

// Symmetric artifact filter (spec §5d.2): drop true non-content artifacts on
// BOTH arms (binary-match notices) and dedup identical lines; NEVER drop a line
// that is genuine content (code / match line). Idempotent.
const BINARY_MATCH_RE = /^Binary file .* matches\s*$/i;

export function artifactFilter(text) {
  if (typeof text !== 'string') return '';
  const seen = new Set();
  const out = [];
  for (const line of text.split('\n')) {
    if (BINARY_MATCH_RE.test(line.trim())) continue; // non-content artifact, both arms
    // Dedup EXACT-duplicate non-blank lines (boilerplate/repeat filler). Blank
    // lines and unique lines pass through so real code structure is preserved.
    const key = line.trim();
    if (key.length > 0) {
      if (seen.has(line)) continue;
      seen.add(line);
    }
    out.push(line);
  }
  // Collapse 3+ consecutive blanks to 1; trim trailing whitespace lines.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim();
}

/** The single canonical scored object: post-strip + post-filter bytes (spec §5d.4). */
export function toRJudge(rawResponse, arm) {
  return artifactFilter(stripChrome(rawResponse, arm));
}

// ─── §5a  snapSpan — the PROGRAMMATIC, gold/AST-snapped density numerator ─────

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

function expectedTokenSet(gold) {
  const set = new Set();
  for (const s of gold?.expectedSymbols ?? []) {
    if (typeof s === 'string') for (const m of s.matchAll(IDENT_RE)) set.add(m[0]);
  }
  for (const f of gold?.expectedFacts ?? []) {
    if (typeof f === 'string') for (const m of f.matchAll(IDENT_RE)) set.add(m[0]);
  }
  return set;
}

/**
 * Lightweight balanced-node snap around an anchor line: starting from the line
 * that contains the matched expected token, expand to the smallest brace- or
 * indent-balanced region that begins at/above the anchor and closes after it.
 * This is the spec §5a clause-(b) AST approximation: it bounds the numerator by
 * the ANSWERING node, not by what the judge quoted, WITHOUT loading tree-sitter
 * grammars (covers OOD languages via the same path). If no balanced region is
 * found, returns just the anchor line(s) (clause (c), the line-level floor).
 *
 * @param {string[]} lines      lines of R_judge
 * @param {number} anchorIdx    0-based index of the anchor line
 * @returns {{start:number, end:number}} inclusive 0-based line range
 */
export function balancedNodeRange(lines, anchorIdx) {
  const n = lines.length;
  // 1) Brace-balanced: find an open '{' at/above the anchor whose matching '}'
  //    is at/below it. Scan upward for a line that increases brace depth.
  let openIdx = -1;
  let depthAtAnchor = 0;
  for (let i = anchorIdx; i >= 0 && i >= anchorIdx - 200; i--) {
    const opens = (lines[i].match(/\{/g) || []).length;
    const closes = (lines[i].match(/\}/g) || []).length;
    depthAtAnchor += opens - closes;
    if (depthAtAnchor > 0) { openIdx = i; break; }
  }
  if (openIdx >= 0) {
    let depth = 0;
    for (let i = openIdx; i < n && i <= openIdx + 400; i++) {
      depth += (lines[i].match(/\{/g) || []).length;
      depth -= (lines[i].match(/\}/g) || []).length;
      if (i >= anchorIdx && depth <= 0) return { start: openIdx, end: i };
    }
  }
  // 2) Indent-balanced (Python/Ruby-ish): a header line (lower indent ending in
  //    ':' or 'def'/'function') above the anchor, body = lines more-indented.
  const indentOf = (s) => (s.match(/^[ \t]*/)?.[0].length ?? 0);
  for (let i = anchorIdx; i >= 0 && i >= anchorIdx - 200; i--) {
    const isHeader = /(\bdef\b|\bfunction\b|\bclass\b|\bfn\b).*[:({]?\s*$/.test(lines[i]) || /:\s*$/.test(lines[i]);
    if (isHeader && lines[i].trim().length) {
      const baseIndent = indentOf(lines[i]);
      let end = i;
      for (let j = i + 1; j < n && j <= i + 400; j++) {
        if (lines[j].trim().length === 0) { end = j; continue; }
        if (indentOf(lines[j]) > baseIndent) end = j;
        else break;
      }
      // accept a real enclosing node: header above the anchor, body reaching it.
      if (end >= anchorIdx && i < anchorIdx) return { start: i, end };
    }
  }
  // 3) Line-level floor (clause c): just the anchor line.
  return { start: anchorIdx, end: anchorIdx };
}

/**
 * Snap a raw cited span to a bounded answering span (spec §5a):
 *   (a) clip to the C^G gold range it overlaps, if any; ELSE
 *   (b) the balanced node containing the matched expectedSymbol / cited identifier; ELSE
 *   (c) the physical line(s) lexically overlapping an expectedSymbol/expectedFact token.
 * A span citing no gold, no resolvable node, and no expected token contributes 0.
 *
 * @returns {string} the snapped substring of R_judge (may be '')
 */
export function snapSpan(rawSpan, { rJudge, gold }) {
  if (typeof rJudge !== 'string' || !rJudge) return '';
  if (typeof rawSpan !== 'string' || !rawSpan.trim()) return '';
  // Span-citation integrity: the cited span must be a verbatim substring of R_judge.
  const at = rJudge.indexOf(rawSpan);
  if (at < 0) return '';

  const lines = rJudge.split('\n');
  const expTokens = expectedTokenSet(gold);
  const goldSpans = Array.isArray(gold?.contextSpans) ? gold.contextSpans : [];

  // Map the cited span's char range to a line range.
  const before = rJudge.slice(0, at);
  const startLine = before.split('\n').length - 1; // 0-based
  const endLine = startLine + rawSpan.split('\n').length - 1;

  // (a) gold-range clip: if R_judge carries explicit "path:start-end" locators
  //     and a C^G span overlaps the cited region, clip to the gold lines.
  //     (C^G is a {file,startLine,endLine}; we use it as a *length cap* on the
  //     answering region — the snap can never exceed the gold's line count.)
  let goldCap = Infinity;
  for (const g of goldSpans) {
    if (Number.isFinite(g?.startLine) && Number.isFinite(g?.endLine)) {
      goldCap = Math.min(goldCap, Math.max(1, g.endLine - g.startLine + 1));
    }
  }

  // Find the anchor: the first line in [startLine,endLine] that contains an
  // expected token; else the first cited line. This is what the node snaps around.
  let anchorIdx = -1;
  for (let i = startLine; i <= endLine && i < lines.length; i++) {
    if (expTokens.size === 0) { anchorIdx = i; break; }
    for (const t of expTokens) {
      if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lines[i])) { anchorIdx = i; break; }
    }
    if (anchorIdx >= 0) break;
  }
  // (c) floor: no expected token anywhere in the cited span AND we have gold
  //     tokens to require ⇒ contributes 0 (a span citing no gold/expected token).
  if (anchorIdx < 0) {
    if (expTokens.size > 0) return '';
    anchorIdx = clip(startLine, 0, lines.length - 1);
  }

  // (b) balanced node around the anchor.
  let { start, end } = balancedNodeRange(lines, anchorIdx);
  // gold cap: never let the answering node exceed the gold's minimal line count
  // by more than 1.5× (keeps a generous AST node from re-inflating the numerator).
  if (Number.isFinite(goldCap)) {
    const cap = Math.ceil(goldCap * 1.5);
    if (end - start + 1 > cap) end = start + cap - 1;
  }
  start = clip(start, 0, lines.length - 1);
  end = clip(end, start, lines.length - 1);
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Compute programmatic density from R_judge + the panel-majority-cited spans.
 * `used_tokens_AST` = estimateTokens of the dedup-union of snapped spans.
 *
 * @returns {{ total_tokens, used_tokens_AST, purity_ratio, snappedSpans }}
 */
export function computeDensity({ rJudge, citedSpans, gold }) {
  const total = estimateTokens(rJudge);
  const snapped = [];
  for (const raw of citedSpans ?? []) {
    const s = snapSpan(raw, { rJudge, gold });
    if (s) snapped.push(s);
  }
  // dedup-union: merge overlapping/identical snapped spans by char offset.
  const ranges = [];
  for (const s of snapped) {
    const at = rJudge.indexOf(s);
    if (at < 0) continue;
    ranges.push([at, at + s.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [lo, hi] of ranges) {
    if (merged.length && lo <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], hi);
    } else merged.push([lo, hi]);
  }
  const usedText = merged.map(([lo, hi]) => rJudge.slice(lo, hi)).join('\n');
  const used = estimateTokens(usedText);
  const purity_ratio = total > 0 ? clip(used / total, 0, 1) : 0;
  return { total_tokens: total, used_tokens_AST: used, purity_ratio, snappedSpans: snapped };
}

// ─── §5a density shaper + §2 scalar composition ──────────────────────────────

export function densityMultiplier(purity_ratio, params = USD_PARAMS) {
  return params.phi + (1 - params.phi) * Math.pow(clip(purity_ratio, 0, 1), params.alpha);
}

/**
 * Compose the final USD scalar (standard / match probes), spec §2.
 *   USD_raw = g · C · content;  USD = USD_raw · (φ + (1−φ)·pr^α)
 */
export function composeUSD({ g, signalPurity, content, purity_ratio }, params = USD_PARAMS) {
  const usdRaw = g * signalPurity * content;
  return clip(usdRaw * densityMultiplier(purity_ratio, params), 0, 1);
}

// ─── §3 grounding floor (programmatic pre-check, judge confirms) ─────────────

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Programmatic grounding pre-check (necessary, not sufficient): R_judge contains
 * a path matching some expectedFiles[i] (suffix, case-insensitive) OR a token
 * matching some expectedSymbols[j] (word-boundary). Inverted for no-match.
 *
 * @returns {boolean}
 */
export function groundingPrecheck(rJudge, gold) {
  const text = String(rJudge || '');
  const low = text.toLowerCase();
  const fileHit = (gold?.expectedFiles ?? []).some((f) => {
    if (typeof f !== 'string') return false;
    const base = f.split('/').pop().toLowerCase();
    return low.includes(f.toLowerCase()) || (base && low.includes(base));
  });
  const symHit = (gold?.expectedSymbols ?? []).some(
    (s) => typeof s === 'string' && new RegExp(`\\b${escapeRe(s)}\\b`).test(text),
  );
  return fileHit || symHit;
}

// ─── §3.1 no-match scoring ───────────────────────────────────────────────────

const NO_MATCH_PHRASE_RE = /\b(no (confident )?match(es)?|no results?|not found|0 (results?|matches?|hits?)|no relevant (hits?|matches?|results?)|nothing (found|relevant))\b/i;

/**
 * Score a no-match probe (spec §3.1). A *correct* no-match response is near-empty
 * or a canonical "no match" statement; a verbose dump is NOT useful.
 *   g = 1 iff (no confident match asserted) AND (no fabricated-symbol code block
 *            presented as an answer) AND the panel agrees correctness.
 *   USD = g · max(0, 1 − total_tokens/τ).
 *
 * @returns {{ USD, grounding, total_tokens, confidentFalsePositive }}
 */
export function scoreNoMatch({ rJudge, gold, panelCorrectness, params = USD_PARAMS }) {
  const total = estimateTokens(rJudge);
  // confident-false-positive: a code block (fenced or a symbol def) that names a
  // fabricated expected symbol AS an answer is a confident wrong answer.
  const fabricated = gold?.expectedSymbols ?? [];
  const hasCodeBlock = /```|^\s*\d+\t/m.test(rJudge);
  const namesFabricated = fabricated.some(
    (s) => typeof s === 'string' && new RegExp(`\\b${escapeRe(s)}\\b`).test(rJudge),
  );
  const confidentFalsePositive = hasCodeBlock && namesFabricated;
  const assertsNoMatch = NO_MATCH_PHRASE_RE.test(rJudge) || total <= 5;
  const panelAgrees = typeof panelCorrectness !== 'number' || panelCorrectness >= params.thetaFloor;
  const g = assertsNoMatch && !confidentFalsePositive && panelAgrees ? 1 : 0;
  const USD = g * Math.max(0, 1 - total / params.tau);
  return { USD: clip(USD, 0, 1), grounding: g, total_tokens: total, confidentFalsePositive };
}

// ─── §4 / §2  full per-(probe,arm) scorer ─────────────────────────────────────

/** Median of a binary verdict array (majority vote ∈ {0,1}); empty ⇒ 0. */
export function medianBinary(verdicts) {
  const v = (verdicts ?? []).filter((x) => x === 0 || x === 1).slice().sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/**
 * Aggregate a panel of per-criterion verdict objects into:
 *   - per-criterion panel-median verdict ∈ {0,1}
 *   - per-criterion panel-MAJORITY cited spans (only spans from panelists who
 *     voted v=1, used for the density numerator and verbatim-substring-checked)
 *
 * @param {Array<{verdictByCriterion:Object}>} panel  one entry per judge
 * @param {string} rJudge
 * @returns {{ verdicts:Object, citedSpansByCriterion:Object }}
 */
export function aggregatePanel(panel, rJudge) {
  const verdicts = {};
  const citedSpansByCriterion = {};
  for (const crit of USD_CRITERIA) {
    const votes = [];
    const spans = [];
    for (const j of panel ?? []) {
      const cell = j?.verdictByCriterion?.[crit];
      if (!cell) { votes.push(0); continue; }
      // span-before-score (§9.3): a v:1 whose span is NOT a verbatim substring of
      // R_judge is DEMOTED to 0 — both the vote and the cited span are dropped.
      const validSpan = cell.v === 1 && typeof cell.span === 'string' && cell.span && rJudge.includes(cell.span);
      votes.push(validSpan ? 1 : 0);
      if (validSpan) spans.push(cell.span);
    }
    verdicts[crit] = medianBinary(votes);
    citedSpansByCriterion[crit] = spans;
  }
  return { verdicts, citedSpansByCriterion };
}

/**
 * Score one retrieval episode (one probe, one arm) → the spec §7.2 object.
 * Pure given the panel verdicts (which the caller obtains from `usdPanelScore`).
 *
 * @param {object} args
 * @param {object} args.probe              vault probe (gold lives on it)
 * @param {string} args.rawResponse        the raw tool-response bytes
 * @param {'ss'|'native'} args.arm
 * @param {Array} args.panel               per-judge {verdictByCriterion}
 * @param {number} [args.panelCorrectness] panel-median correctness in [0,1] (floor judge)
 * @param {object} [args.params]
 * @param {string} [args.rubricHash]
 * @returns {object} the §7.2 score object
 */
export function scoreUSD({ probe, rawResponse, arm, panel, panelCorrectness, params = USD_PARAMS, rubricHash }) {
  const gold = {
    expectedFiles: probe?.expectedFiles ?? [],
    expectedSymbols: probe?.expectedSymbols ?? [],
    expectedFacts: probe?.expectedFacts ?? [],
    contextSpans: probe?.contextSpans ?? [], // C^G (optional; line-floor without it)
  };
  const rJudge = toRJudge(rawResponse, arm);
  const isNoMatch = !!probe?.expectedNoMatch;
  const base = {
    probeId: probe?.id,
    arm,
    rubricHash: rubricHash ?? computeRubricHash(params),
    isNoMatch,
  };

  if (isNoMatch) {
    const nm = scoreNoMatch({ rJudge, gold, panelCorrectness, params });
    return {
      ...base,
      USD: nm.USD,
      grounding: nm.grounding,
      D1: 0, D2: 0, D3: 0, D4: 0, D5: 0,
      signal_purity: 0,
      content: 0,
      content_noD3: 0,
      purity_ratio: 1, // by definition for the no-match formula (not used in USD)
      total_tokens: nm.total_tokens,
      used_tokens_AST: 0,
      programmatic: { confidentFalsePositive: nm.confidentFalsePositive },
    };
  }

  // grounding floor: programmatic pre-check AND panel correctness ≥ θ_floor.
  const precheck = groundingPrecheck(rJudge, gold);
  const panelOk = typeof panelCorrectness !== 'number' || panelCorrectness >= params.thetaFloor;
  const g = precheck && panelOk ? 1 : 0;

  const { verdicts, citedSpansByCriterion } = aggregatePanel(panel, rJudge);
  const D1 = verdicts.answer_grounding;
  const D2 = verdicts.workable_code;
  const D3 = verdicts.navigability;
  const D4 = verdicts.edit_locality;
  const D5 = verdicts.sufficiency;
  const C = verdicts.signal_purity;
  const content = (D1 + D2 + D3 + D4 + D5) / 5;
  const content_noD3 = (D1 + D2 + D4 + D5) / 4;

  // density: union of ALL v=1-cited spans, snapped programmatically.
  const allSpans = USD_CRITERIA.flatMap((c) => citedSpansByCriterion[c] ?? []);
  const { total_tokens, used_tokens_AST, purity_ratio, snappedSpans } = computeDensity({
    rJudge, citedSpans: allSpans, gold,
  });

  const USD = composeUSD({ g, signalPurity: C, content, purity_ratio }, params);

  return {
    ...base,
    USD,
    grounding: g,
    D1, D2, D3, D4, D5,
    signal_purity: C,
    content,
    content_noD3,
    purity_ratio,
    total_tokens,
    used_tokens_AST,
    citedSpans: citedSpansByCriterion,
    snappedSpans,
    programmatic: { precheck, panelOk },
  };
}

// ─── §5b  caliper-matched paired Δ on common token support (the HEADLINE) ─────

/**
 * Caliper-match ss vs native responses by log(total_tokens) within a strict
 * caliper, report the matched paired Δ with a paired bootstrap 95% CI, GATED on
 * a common-support diagnostic. If supports don't overlap enough, the comparative
 * claim is WITHHELD ("not length-matchable") — an honest, reportable outcome.
 *
 * @param {Array<{probeId,total_tokens, metrics:{[k]:number}}>} ssArm
 * @param {Array<{probeId,total_tokens, metrics:{[k]:number}}>} nativeArm
 * @param {object} opts  { params, metricKeys, B }
 * @returns {object}
 */
export function caliperMatchedDelta(ssArm, nativeArm, { params = USD_PARAMS, metricKeys = ['content_noD3', 'content', 'USD'], B = 20000, rng = Math.random } = {}) {
  const lg = (t) => Math.log(Math.max(1, t));
  const ss = ssArm.filter((x) => Number.isFinite(x.total_tokens));
  const nat = nativeArm.filter((x) => Number.isFinite(x.total_tokens));

  // common-support diagnostic: fraction of each arm with ≥1 partner in caliper.
  const hasPartner = (x, other) => other.some((y) => Math.abs(lg(x.total_tokens) - lg(y.total_tokens)) <= params.caliper);
  const ssOnSupport = ss.filter((x) => hasPartner(x, nat));
  const natOnSupport = nat.filter((y) => hasPartner(y, ss));
  const ssSupportFrac = ss.length ? ssOnSupport.length / ss.length : 0;
  const natSupportFrac = nat.length ? natOnSupport.length / nat.length : 0;
  const lengthMatchable = ssSupportFrac >= params.minCommonSupport || natSupportFrac >= params.minCommonSupport;

  if (!lengthMatchable) {
    return {
      lengthMatchable: false,
      ssSupportFrac, natSupportFrac,
      reason: 'not length-matchable — arms lack common token support',
      matchedPairs: 0,
      deltas: {},
    };
  }

  // For each ss response on support, pick the nearest in-caliper native partner
  // (1:1 nearest-neighbour). Pair the within-probe metric values.
  const natByProbe = new Map();
  for (const y of nat) {
    if (!natByProbe.has(y.probeId)) natByProbe.set(y.probeId, []);
    natByProbe.get(y.probeId).push(y);
  }
  const pairs = [];
  for (const x of ssOnSupport) {
    // prefer a same-probe native partner; else any in-caliper native.
    const candidates = nat.filter((y) => Math.abs(lg(x.total_tokens) - lg(y.total_tokens)) <= params.caliper);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => Math.abs(lg(a.total_tokens) - lg(x.total_tokens)) - Math.abs(lg(b.total_tokens) - lg(x.total_tokens)));
    const samProbe = candidates.find((y) => y.probeId === x.probeId);
    pairs.push({ ss: x, native: samProbe ?? candidates[0] });
  }

  const deltas = {};
  for (const key of metricKeys) {
    const d = pairs.map((p) => (p.ss.metrics?.[key] ?? 0) - (p.native.metrics?.[key] ?? 0));
    const m = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
    const [lo, hi] = pairedBootstrapCI(d, B, rng);
    deltas[key] = { mean: m, ci: [lo, hi], excludesZero: lo > 0 || hi < 0, n: d.length };
  }
  return { lengthMatchable: true, ssSupportFrac, natSupportFrac, matchedPairs: pairs.length, deltas };
}

/** Paired bootstrap 95% CI over a vector of per-pair deltas. */
export function pairedBootstrapCI(vals, B = 20000, rng = Math.random) {
  const n = vals.length;
  if (n === 0) return [0, 0];
  const out = new Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += vals[(rng() * n) | 0];
    out[b] = s / n;
  }
  out.sort((a, b) => a - b);
  return [out[Math.floor(0.025 * B)], out[Math.floor(0.975 * B)]];
}

// ─── §9.1/§9.2  the 6-criterion judge panel (clone of judgePanelScore) ───────

/** Build the USD judge user prompt (arm-blind: the judge sees only R_judge). */
export function buildUsdJudgePrompt({ probe, rJudge }) {
  const gold = probe?.expectedNoMatch
    ? 'EXPECTED: no match exists in this repository.'
    : `EXPECTED FILES: ${JSON.stringify(probe?.expectedFiles ?? [])}\n` +
      `EXPECTED SYMBOLS: ${JSON.stringify(probe?.expectedSymbols ?? [])}\n` +
      `EXPECTED FACTS: ${JSON.stringify(probe?.expectedFacts ?? [])}` +
      (Array.isArray(probe?.contextSpans) && probe.contextSpans.length
        ? `\nGOLD SPANS (minimal sufficient context): ${JSON.stringify(probe.contextSpans)}`
        : '');
  return `## Query\n${probe?.query ?? ''}\n\n## Gold\n${gold}\n\n## Response (tool output, chrome removed)\n${rJudge || '(empty)'}\n\nScore:`;
}

/**
 * Parse the 6-criterion JSON verdict out of a judge reply. Returns
 * `{ verdictByCriterion: { <crit>: {span, v} } }` or null on unparseable text.
 * Robust to fenced code blocks and trailing prose.
 */
export function parseUsdVerdict(text) {
  if (typeof text !== 'string' || !text) return null;
  // try every {...} object that mentions answer_grounding, last-first.
  const candidates = [...text.matchAll(/\{[\s\S]*?\}\s*(?=\}|$)/g)].map((m) => m[0]);
  // also try a greedy whole-object match.
  const greedy = text.match(/\{[\s\S]*\}/);
  if (greedy) candidates.push(greedy[0]);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(candidates[i]);
      if (obj && typeof obj === 'object' && USD_CRITERIA.every((c) => c in obj)) {
        const verdictByCriterion = {};
        for (const c of USD_CRITERIA) {
          const cell = obj[c] || {};
          verdictByCriterion[c] = {
            span: typeof cell.span === 'string' ? cell.span : '',
            v: cell.v === 1 || cell.v === '1' ? 1 : 0,
          };
        }
        return { verdictByCriterion };
      }
    } catch { /* try previous candidate */ }
  }
  return null;
}

/**
 * Run the 6-criterion USD panel over one R_judge. Mirrors `judgePanelScore`:
 * median over disjoint families per criterion, per-judge usage normalized,
 * span-before-score machine-checked (a v:1 with a non-substring span is demoted
 * to 0). Throws `AllJudgesFailedError` if every panelist errors.
 *
 * NOTE: arm-blind — the prompt never carries the arm label.
 *
 * @param {object} args
 * @param {object} args.probe
 * @param {string} args.rJudge          the post-strip+filter bytes (toRJudge output)
 * @param {Array<{lineage,model}>} args.panel
 * @param {Function} args.runJudgeFn    runJudge-compatible ({lineage,model,systemPrompt,userPrompt})→{text,isError,raw}
 * @param {Function} args.normalizeUsageFn  (raw.usage)→{input_tokens,output_tokens}
 * @param {Function} args.AllJudgesFailedError  ctor (injected to avoid a circular import)
 * @param {{acquire:Function}} [args.judgeBucket]
 * @returns {Promise<{ panel:Array, anyValid:boolean }>}
 */
export async function usdPanelScore({ probe, rJudge, panel, runJudgeFn, normalizeUsageFn, AllJudgesFailedError, judgeBucket }) {
  const userPrompt = buildUsdJudgePrompt({ probe, rJudge });
  const results = await Promise.all(
    panel.map(async ({ lineage, model }) => {
      if (judgeBucket && typeof judgeBucket.acquire === 'function') {
        await judgeBucket.acquire({ target: `${lineage}:${model}` });
      }
      const r = await runJudgeFn({ lineage, model, systemPrompt: JUDGE_USD_SYSTEM_PROMPT, userPrompt });
      const usage = normalizeUsageFn ? normalizeUsageFn(r.raw?.usage) : { input_tokens: null, output_tokens: null };
      const parsed = r.isError ? null : parseUsdVerdict(r.text);
      // span-before-score: demote any v:1 whose span is not a verbatim substring.
      let verdictByCriterion = null;
      if (parsed) {
        verdictByCriterion = {};
        for (const c of USD_CRITERIA) {
          const cell = parsed.verdictByCriterion[c];
          const validSpan = cell.v === 1 && cell.span && rJudge.includes(cell.span);
          verdictByCriterion[c] = { span: cell.span, v: validSpan ? 1 : 0 };
        }
      }
      return {
        lineage, model,
        verdictByCriterion,
        isError: !!r.isError || !parsed,
        error: r.isError ? (r.error || 'judge-error') : (!parsed ? 'unparseable-verdict' : undefined),
        usage,
      };
    }),
  );
  const valid = results.filter((j) => j.verdictByCriterion);
  if (valid.length === 0) {
    if (typeof AllJudgesFailedError === 'function') {
      throw new AllJudgesFailedError(results.map((j) => ({ model: j.model, lineage: j.lineage, error: j.error || 'judge-error' })));
    }
    throw new Error(`all ${results.length} USD judge(s) failed`);
  }
  return { panel: results.map((j) => ({ model: j.model, lineage: j.lineage, verdictByCriterion: j.verdictByCriterion, input_tokens: j.usage.input_tokens, output_tokens: j.usage.output_tokens, isError: j.isError })), anyValid: true };
}
