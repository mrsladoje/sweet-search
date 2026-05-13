#!/usr/bin/env node
/**
 * relaxed-grading.mjs — shared library for the relaxed_def_recall@1
 * secondary metric introduced by the 2026-05-13 cross-tool benchmark-shape
 * audit (core/prompt-optimization/data/query-shapes/cross-tool-benchmark-
 * audit-2026-05-13.md).
 *
 * The audit found that strict symbol_recall@1 systematically under-measures
 * ss-search and ss-find because the F1 chunker-label artifact dominates the
 * PARTIAL bucket: 67-83% of ss-search PARTIALs and 92-100% of ss-find
 * PARTIALs are hidden PASSes (the returned chunk DOES contain the gold's
 * definition; the chunker just labelled the chunk with a sibling symbol).
 *
 * This module is the SINGLE SOURCE OF TRUTH for the relaxed-rubric
 * regex + classification. The audit script
 * (scripts/cross-tool-audit-2026-05-13.mjs) and the aggregators
 * (aggregate-track-a.mjs, ss-find/aggregate-track-a-ss-find.mjs) all import
 * from here so they cannot drift.
 *
 * NOTHING in here is gated on opts.format or any production-code path.
 * It exclusively runs at evaluation/aggregation time over a locked
 * eval/ast-tester-probes/_repos/ tree.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const REPOS_MANIFEST = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');

// ─── Definition-keyword set (ported verbatim from
//     scripts/cross-tool-audit-spotcheck-v2.mjs:43-58 — do not edit without
//     updating the audit script and re-running the audit). ────────────────
export const DEF_KEYWORDS = Object.freeze([
  // common
  'def', 'function', 'fn', 'func', 'class', 'struct', 'interface', 'trait',
  'enum', 'type', 'module', 'object', 'extension', 'macro_rules!', 'impl',
  // visibility / modifiers
  'export', 'public', 'private', 'internal', 'protected', 'sealed', 'partial',
  'static', 'abstract', 'final', 'pub', 'crate', 'override',
  // bindings
  'const', 'let', 'var', 'val', 'final', 'lazy',
  // ruby
  'module', 'class',
  // lua/php/etc
  'local', 'function',
]);
const DEF_KEYWORD_SET = new Set(DEF_KEYWORDS);

function escapeRegex(s) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function isCommentLine(line, lang) {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith('//') || t.startsWith('///')) return true;
  if (t.startsWith('/*') || t.startsWith('*/') || t.startsWith('/**')) return true;
  if (t.startsWith('*')) return true; // /** ... * ... */ continuation
  if (t.startsWith('#') && (lang === 'python' || lang === 'ruby' || lang === 'php' || lang === 'elixir')) return true;
  if (t.startsWith('--') && (lang === 'lua' || lang === 'sql' || lang === 'haskell')) return true;
  if (t.startsWith('"""') || t.startsWith("'''")) return true; // python docstring
  return false;
}

// Stateful: detect python triple-string blocks across multiple lines.
function buildDocstringMask(lines, lang) {
  const mask = new Array(lines.length).fill(false);
  if (lang !== 'python' && lang !== 'rust' /* doc */ && lang !== 'ruby') return mask;
  if (lang === 'python') {
    let inTripleD = false, inTripleS = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      let j = 0;
      while (j < l.length) {
        if (!inTripleD && !inTripleS && l.startsWith('"""', j)) { inTripleD = true; j += 3; continue; }
        if (!inTripleD && !inTripleS && l.startsWith("'''", j)) { inTripleS = true; j += 3; continue; }
        if (inTripleD && l.startsWith('"""', j)) { inTripleD = false; j += 3; continue; }
        if (inTripleS && l.startsWith("'''", j)) { inTripleS = false; j += 3; continue; }
        j++;
      }
      if (inTripleD || inTripleS) mask[i] = true;
    }
  }
  return mask;
}

function classifyMatch(line, idx, sym, lang, inDocstring) {
  if (inDocstring) return 'comment';
  if (isCommentLine(line, lang)) return 'comment';

  const before = line.slice(0, idx);
  const afterFromSym = line.slice(idx + sym.length).trimStart();

  // C/C++/Go/Rust/Zig function definition: "Type *symbol(" or "Type symbol("
  // with NO '=' or 'return' on the line before the symbol.
  const looksLikeCFnDef = afterFromSym.startsWith('(')
    && !before.includes('=')
    && !before.match(/\breturn\b/)
    && !before.trimEnd().endsWith(',')
    && before.trim().length > 0  // must have a type before
    && (lang === 'c' || lang === 'cpp' || lang === 'go' || lang === 'rust' || lang === 'zig' || lang === 'swift');

  // Definition keyword IMMEDIATELY before the symbol (allowing modifiers).
  // E.g., "pub trait Violation:", "export const safeParse:", "class Request <"
  // But NOT "var newCache = new LoaderBlockCache(" — that's an instantiation
  // of an existing class, not a definition of LoaderBlockCache itself.
  const tokens = before.split(/[\s,;:<>(){}\[\]]+/).filter(Boolean);
  let defKwIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (DEF_KEYWORD_SET.has(tokens[i])) { defKwIdx = i; break; }
  }
  const hasDefKw = defKwIdx >= 0
    && !before.includes('=')
    && !before.match(/\bnew\b/)
    && !before.match(/\breturn\b/);

  const lineHasMacroRules = line.includes('macro_rules!');
  const dartExt = lang === 'dart' && before.match(/\bextension\b/) && !before.includes('=');

  if (hasDefKw || looksLikeCFnDef || lineHasMacroRules || dartExt) return 'definition';
  return 'reference';
}

/**
 * Classify every occurrence of `sym` in lines[startLine..endLine] (1-based,
 * inclusive). Returns `{ verdict, findings }` where:
 *   - verdict ∈ {'none', 'strong', 'weak', 'comment-only'}
 *     - 'strong'       — at least one DEFINITION-like occurrence
 *     - 'weak'         — only references (no def)
 *     - 'comment-only' — only mentioned inside comments/docstrings
 *     - 'none'         — symbol not found
 *   - findings: per-occurrence detail (line, idx, kind, snippet)
 */
export function classifyChunk(lines, startLine, endLine, sym, lang) {
  const docMask = buildDocstringMask(lines, lang);
  const findings = [];
  for (let i = startLine; i <= Math.min(endLine, lines.length); i++) {
    const line = lines[i - 1] || '';
    let m;
    const reGlobal = new RegExp(`\\b${escapeRegex(sym)}\\b`, 'g');
    while ((m = reGlobal.exec(line)) != null) {
      const kind = classifyMatch(line, m.index, sym, lang, docMask[i - 1]);
      findings.push({ line: i, idx: m.index, kind, snippet: line.trim() });
      if (reGlobal.lastIndex === m.index) reGlobal.lastIndex++;
    }
  }
  const hasDef = findings.some(f => f.kind === 'definition');
  const hasRef = findings.some(f => f.kind === 'reference');
  let verdict = 'none';
  if (findings.length === 0) verdict = 'none';
  else if (hasDef) verdict = 'strong';
  else if (hasRef) verdict = 'weak';
  else verdict = 'comment-only';
  return { verdict, findings };
}

/**
 * Canonical DEF-only relaxed-rubric check. Returns `true` iff the chunk
 * text contains the expected symbol as a *definition* (not a reference,
 * not in a comment). This is what `relaxed_def_recall_at_1` aggregates.
 *
 * Accepts either pre-split lines or a single string (which we split here).
 *
 * Convention matches the audit doc: this is the strict reading
 * ("DEF-only" — 70.0% ss-search, 84.3% ss-find on dev). The looser
 * "DEF+REF" reading is NOT exposed here because the audit recommends
 * DEF-only as the published secondary.
 */
export function computeRelaxedDefMatch({ chunkText, chunkLines, expectedSymbol, language, startLine = 1, endLine = null }) {
  if (!expectedSymbol) return false;
  let lines = chunkLines;
  if (!lines) {
    if (!chunkText) return false;
    lines = String(chunkText).split('\n');
    // when given a raw chunkText, treat it as starting at line 1
    return classifyChunk(lines, 1, lines.length, expectedSymbol, language).verdict === 'strong';
  }
  const end = endLine ?? lines.length;
  return classifyChunk(lines, startLine, end, expectedSymbol, language).verdict === 'strong';
}

// ─── Repo-aware helpers — load locked AST-tester-probes file lines so the
//     aggregator can compute relaxed_def per row. ──────────────────────────

let _reposMapCache = null;
export function loadReposMap() {
  if (_reposMapCache) return _reposMapCache;
  if (!fs.existsSync(REPOS_MANIFEST)) return new Map();
  const m = JSON.parse(fs.readFileSync(REPOS_MANIFEST, 'utf8'));
  const map = new Map();
  for (const e of m.repos || []) map.set(e.key || e.language, e);
  _reposMapCache = map;
  return map;
}

const _fileLinesCache = new Map();
export function loadFileLines(reposMap, language, file) {
  if (!language || !file) return null;
  const cacheKey = `${language}::${file}`;
  if (_fileLinesCache.has(cacheKey)) return _fileLinesCache.get(cacheKey);
  const entry = reposMap.get(language);
  if (!entry) { _fileLinesCache.set(cacheKey, null); return null; }
  const abs = path.join(REPO_ROOT, entry.localPath, file);
  let lines = null;
  try { lines = fs.readFileSync(abs, 'utf8').split('\n'); } catch { lines = null; }
  _fileLinesCache.set(cacheKey, lines);
  return lines;
}

/**
 * Per-row relaxed_def_at_1.
 *
 *   relaxed_def_at_1 = 1 iff
 *     row.fileRecallAt1 == 1  (top-1 file is one of the expected files)
 *   AND
 *     the top-1 chunk's text contains expectedSymbol with a definition anchor
 *
 * The fileRecallAt1 prefix is intentional: a relaxed rubric should not
 * upgrade rows whose top-1 returned a different file just because that other
 * file happens to define a same-named symbol elsewhere. PARTIAL = right
 * file, wrong chunker label (the F1 artifact this metric targets).
 *
 * Returns 0 / 1.  Returns null if the chunk text can't be loaded (caller
 * may choose to skip the row).
 */
export function rowRelaxedDef({ row, expectedSymbol, language, reposMap }) {
  if (!row || !expectedSymbol) return 0;
  if (!row.fileRecallAt1) return 0; // gate on file match
  const top1 = row.top1 || {};
  if (!top1.file || top1.startLine == null || top1.endLine == null) return 0;
  const lines = loadFileLines(reposMap, language, top1.file);
  if (!lines) return null;
  const verdict = classifyChunk(lines, Number(top1.startLine), Number(top1.endLine), expectedSymbol, language).verdict;
  return verdict === 'strong' ? 1 : 0;
}

/**
 * Aggregate relaxed_def_at_1 and file_recall_at_5 across rows, bucketed by
 * the caller-supplied key function.
 *
 *   computeRelaxedDefRecall({ rows, expectedSymbolOf, languageOf, perCellKeyFn })
 *
 * - rows                : raw JSONL rows
 * - expectedSymbolOf(r) : returns the expected symbol string for a row's gold
 * - languageOf(r)       : returns the canonical language key for a row
 * - perCellKeyFn(r)     : returns the cell key (e.g. row.shape or `${rCell}|${qCell}`)
 *                         — return null to exclude the row from cells (but it
 *                         still contributes to the global aggregate if you
 *                         compute one yourself)
 *
 * Returns:
 *   {
 *     perCell: { <key>: { n, relaxed_def_at_1_sum, file_recall_at_5_sum,
 *                          relaxed_def_at_1_mean, file_recall_at_5_mean } },
 *     unloadable: number  // rows whose chunk text couldn't be loaded
 *   }
 */
export function computeRelaxedDefRecall({ rows, expectedSymbolOf, languageOf, perCellKeyFn, rowFilter = null }) {
  const reposMap = loadReposMap();
  const perCell = new Map();
  let unloadable = 0;

  for (const row of rows) {
    if (rowFilter && !rowFilter(row)) continue;
    const sym = expectedSymbolOf(row);
    const lang = languageOf(row);
    const key = perCellKeyFn(row);
    if (key == null) continue;

    let relaxedDef = 0;
    if (row.fileRecallAt1 && sym && lang) {
      const v = rowRelaxedDef({ row, expectedSymbol: sym, language: lang, reposMap });
      if (v == null) {
        unloadable++;
        continue;
      }
      relaxedDef = v;
    }
    const fr5 = row.fileRecallAt5 ? 1 : 0;
    let cell = perCell.get(key);
    if (!cell) {
      cell = { n: 0, relaxed_def_at_1_sum: 0, file_recall_at_5_sum: 0 };
      perCell.set(key, cell);
    }
    cell.n++;
    cell.relaxed_def_at_1_sum += relaxedDef;
    cell.file_recall_at_5_sum += fr5;
  }

  const out = {};
  for (const [k, v] of perCell.entries()) {
    out[k] = {
      n: v.n,
      relaxed_def_at_1_sum: v.relaxed_def_at_1_sum,
      file_recall_at_5_sum: v.file_recall_at_5_sum,
      relaxed_def_at_1_mean: v.n ? v.relaxed_def_at_1_sum / v.n : null,
      file_recall_at_5_mean: v.n ? v.file_recall_at_5_sum / v.n : null,
    };
  }
  return { perCell: out, unloadable };
}
