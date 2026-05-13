#!/usr/bin/env node
/**
 * preprocess.mjs — produce inputs/<lang>-<probe-id>.json per docs/PHASE6_REDO.md
 * §5.2 + §5.5.2.
 *
 * For each (language, probe) in the 18-language AST-tester pack and the
 * doc-positive supplement:
 *   - resolve the source file at the pinned SHA from eval/ast-tester-probes/repos.json
 *   - extract the symbol's containing chunk via core/indexing/ast-chunker.js
 *     (JS-native ASTChunker, NOT the napi crate — per §5.5.2)
 *   - extract a tighter source snippet (the symbol's definition + leading doc)
 *     using line ranges from the code-graph.db when available
 *   - resolve graph neighbours via core/infrastructure/structural-context-repository.js
 *   - assign goldClass + eligibleShapes per the §5.1 doc-positive scope rule
 *   - decompose path tokens for the validator's path-token-leak check
 *
 * Output: core/prompt-optimization/data/query-shapes/inputs/<lang>-<probe-id>.json
 *
 * Usage:
 *   node core/prompt-optimization/scripts/preprocess.mjs            # all 18 languages + doc-positive
 *   node core/prompt-optimization/scripts/preprocess.mjs --lang=rust # one language
 *   node core/prompt-optimization/scripts/preprocess.mjs --id=RS-001 # one probe
 *   node core/prompt-optimization/scripts/preprocess.mjs --dry-run   # report counts, write nothing
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ASTChunker } from '../../indexing/ast-chunker.js';
import { StructuralContextRepository } from '../../infrastructure/structural-context-repository.js';
import {
  COVERED_LANGUAGES,
  languageToFamily,
  normalizeProbePackKey,
} from '../data/query-shapes/family-map.mjs';
import { pathTokens } from './validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const GOLD_DIR = path.join(REPO_ROOT, 'eval/ast-tester-probes/gold');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const OUTPUT_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');

const SCHEMA_VERSION = 2;

const ALL_SHAPES = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7'];
const DOC_POSITIVE_SHAPES = ['V3', 'V5', 'V6'];

const SNIPPET_CONTEXT_BEFORE = 10; // include up to N preceding lines (doc-comment)
const SNIPPET_CONTEXT_AFTER = 0;   // entity end_line is already inclusive

// ─── helpers ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { lang: null, id: null, dryRun: false, verbose: false };
  for (const arg of argv) {
    if (arg.startsWith('--lang=')) out.lang = arg.slice('--lang='.length);
    else if (arg.startsWith('--id=')) out.id = arg.slice('--id='.length);
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--verbose' || arg === '-v') out.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`usage: preprocess.mjs [--lang=<lang>] [--id=<probe-id>] [--dry-run] [--verbose]\n`);
      process.exit(0);
    } else {
      process.stderr.write(`preprocess: unknown arg "${arg}"\n`);
      process.exit(2);
    }
  }
  return out;
}

function loadReposManifest() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const map = new Map();
  for (const entry of raw.repos || []) {
    map.set(entry.key || entry.language, entry);
  }
  return map;
}

function loadGoldForLanguage(language) {
  const file = path.join(GOLD_DIR, `${language}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, probes: raw.probes || [], repoSha: raw.repoSha || null };
}

function loadDocPositive() {
  const file = path.join(GOLD_DIR, 'doc-positive.json');
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, probes: raw.probes || [] };
}

/**
 * Slice file content into lines (1-indexed) bounded by [start, end] inclusive.
 * Returns the slice plus the actual lines included (post-clamp).
 */
function sliceLines(content, start, end) {
  const lines = content.split(/\r?\n/);
  const lo = Math.max(1, start);
  const hi = Math.min(lines.length, end);
  if (lo > hi) return { text: '', startLine: lo, endLine: hi };
  const slice = lines.slice(lo - 1, hi).join('\n');
  return { text: slice, startLine: lo, endLine: hi };
}

/**
 * For ast-tester (code-symbol) golds: open the source file, look up the
 * symbol in code-graph.db to pin precise line ranges, then derive both
 * `containingChunk` (from ASTChunker) and `sourceSnippet` (entity body +
 * a few preceding lines of doc-comment).
 *
 * If the symbol cannot be located in the code-graph.db, fall back to:
 *   - containingChunk = first chunk in the file
 *   - sourceSnippet   = first 60 lines of the file
 * The validator does not strictly require these to be tight; downstream
 * scoring runs against the gold's `expectedFile` / `expectedSymbol`, not
 * these snippets.
 */
async function buildAstTesterInput({
  chunker, repo, repoEntry, probe, projectRoot,
}) {
  // Some probe packs (elixir, lua, zig) use expectedFileAnyOf /
  // expectedSymbolAnyOf instead of (or in addition to) the singular fields.
  // The validator treats the singular field as the canonical "symbol to
  // forbid/require", but we also pass through the AnyOf list so downstream
  // checks (validator path-token leak, track-a-runner grading) can union
  // across all alternatives.
  const fileAnyOf = probe.expectedFileAnyOf?.length ? probe.expectedFileAnyOf : null;
  const symAnyOf = probe.expectedSymbolAnyOf?.length ? probe.expectedSymbolAnyOf : null;
  const expectedFile = probe.expectedFile ?? fileAnyOf?.[0] ?? null;
  const expectedSymbol = probe.expectedSymbol ?? symAnyOf?.[0] ?? null;
  if (!expectedFile) {
    throw new Error(`preprocess: ${probe.id} has neither expectedFile nor expectedFileAnyOf`);
  }
  const absPath = path.join(projectRoot, expectedFile);
  if (!fs.existsSync(absPath)) {
    throw new Error(
      `preprocess: source file missing for ${probe.id}: ${absPath} ` +
        `(pinned SHA ${repoEntry.sha}; did fetch-benchmark-repos run for ${repo}?)`,
    );
  }
  const content = fs.readFileSync(absPath, 'utf8');
  let chunks = [];
  try {
    chunks = await chunker.parseFile(absPath, content);
  } catch (err) {
    // ASTChunker is best-effort; record an empty list rather than abort.
    chunks = [];
  }

  // Try to pin the symbol's line range via code-graph.db
  const graphDbPath = path.join(projectRoot, '.sweet-search/code-graph.db');
  let candidate = null;
  let callers = [];
  let callees = [];
  let implementors = [];
  let repoInst = null;
  if (fs.existsSync(graphDbPath) && expectedSymbol) {
    repoInst = new StructuralContextRepository(graphDbPath, { projectRoot });
    try {
      const candidates = repoInst.findEntityCandidates(expectedSymbol, {
        filePath: expectedFile,
        limit: 5,
      });
      candidate = candidates?.[0] ?? null;
      if (candidate) {
        callers = (repoInst.getCallers(candidate, { limit: 12 }) || []).map((c) => ({
          symbol: c.name,
          file: c.filePath,
          relationship: c.relationship,
          contextLine: c.contextLine,
        }));
        callees = (repoInst.getCallees(candidate, { limit: 12 }) || []).map((c) => ({
          symbol: c.name,
          file: c.filePath,
          relationship: c.relationship,
          contextLine: c.contextLine,
        }));
        // Implementors are callers with 'implements' / 'extends' / 'overrides'
        // relationship types — separated for diagnostic convenience.
        implementors = callers.filter((c) =>
          c.relationship === 'implements' || c.relationship === 'extends' || c.relationship === 'overrides',
        );
      }
    } finally {
      repoInst.close();
    }
  }

  // Snippet windows
  let containingChunk = null;
  let sourceSnippet = null;
  if (candidate?.startLine && candidate?.endLine) {
    const docStart = Math.max(1, candidate.startLine - SNIPPET_CONTEXT_BEFORE);
    sourceSnippet = sliceLines(content, docStart, candidate.endLine + SNIPPET_CONTEXT_AFTER);
    sourceSnippet.extractor = 'code-graph';
    if (chunks.length) {
      const symLine = candidate.startLine;
      const found = chunks.find((c) =>
        (c.metadata?.line_start ?? 1) <= symLine &&
        (c.metadata?.line_end ?? Infinity) >= symLine,
      );
      if (found) {
        containingChunk = {
          startLine: found.metadata?.line_start ?? null,
          endLine: found.metadata?.line_end ?? null,
          text: found.text || found.content || '',
        };
      }
    }
  }
  if (!sourceSnippet) {
    sourceSnippet = sliceLines(content, 1, 60);
    sourceSnippet.extractor = 'fallback-head';
  }
  if (!containingChunk && chunks.length) {
    // Mode A fix (2026-05-13): scan chunks for one whose text contains the
    // expected symbol before falling back to chunks[0]. The bare chunks[0]
    // fallback was returning file-header chunks for symbols whose code-graph
    // lookup returned no candidate (hiredis.c: copyright block, lines 1-44;
    // tablex.lua: imports, lines 1-20; etc.). R5's sibling-from-chunk
    // extractor then picked proper-noun tokens (`Copyright`, `Salvatore`,
    // `Microsoft`) as alternation members, generating regexes that matched
    // every file header in the corpus. Per CLAUDE.md "shape heuristics over
    // stopword lists" — fixing the source chunk is structurally correct;
    // strengthening the shape filter alone would still let length-≥-5
    // proper-noun tokens through (e.g., `Microsoft`).
    let bySymbol = null;
    if (expectedSymbol) {
      // Robust word boundary that works for non-word-char-prefixed symbols
      // (`$ZodType`, `tablex.deepcopy`). Standard `\b` doesn't sit between
      // two non-word chars, so we use explicit non-word lookarounds.
      const escaped = expectedSymbol.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
      const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?=[^A-Za-z0-9_]|$)`);
      bySymbol = chunks.find((c) => re.test(c.text || c.content || ''));
    }
    const pick = bySymbol ?? chunks[0];
    containingChunk = {
      startLine: pick.metadata?.line_start ?? null,
      endLine: pick.metadata?.line_end ?? null,
      text: pick.text || pick.content || '',
    };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    goldId: probe.id,
    goldClass: 'ast-tester',
    eligibleShapes: [...ALL_SHAPES],
    language: repo, // canonical probe-pack key (e.g., "rust"); typescript-lib is normalized below
    canonicalLanguage: normalizeProbePackKey(repo),
    family: languageToFamily(repo),
    repoKey: repo,
    repoSha: repoEntry.sha,
    expectedFile,
    expectedFileAnyOf: fileAnyOf,
    expectedSymbol,
    expectedSymbolAnyOf: symAnyOf,
    expectedSymbolType: probe.expectedSymbolType ?? probe.expectedSymbolTypeAnyOf?.[0] ?? null,
    goldNotes: probe.notes ?? '',
    goldQuery: probe.query,
    containingChunk,
    sourceSnippet,
    graphNeighbors: { callers, callees, implementors },
    pathTokens: pathTokens(expectedFile),
    preregistered_shape_winner: null,
  };
}

/**
 * For doc-positive golds: no code symbol — the gold IS the doc/manifest
 * file. Source snippet is the head of the file (or full content if short).
 * eligibleShapes = V3/V5/V6 per §5.1 scope rule.
 */
function buildDocPositiveInput({ probe, projectRoot, repoEntry, repoKey }) {
  const expectedFile = probe.expectedFile || probe.expectedFileAnyOf?.[0] || null;
  if (!expectedFile) {
    throw new Error(`preprocess: doc-positive ${probe.id} has no expectedFile`);
  }
  const absPath = path.join(projectRoot, expectedFile);
  let content = '';
  if (fs.existsSync(absPath)) {
    content = fs.readFileSync(absPath, 'utf8');
  }
  const sourceSnippet = sliceLines(content || '', 1, 80);
  sourceSnippet.extractor = 'doc-head';

  return {
    schemaVersion: SCHEMA_VERSION,
    goldId: probe.id,
    goldClass: 'doc-positive',
    eligibleShapes: [...DOC_POSITIVE_SHAPES],
    language: repoKey,
    canonicalLanguage: normalizeProbePackKey(repoKey),
    family: languageToFamily(repoKey),
    repoKey,
    repoSha: repoEntry?.sha ?? null,
    expectedFile,
    expectedFileAnyOf: probe.expectedFileAnyOf ?? null,
    expectedSymbol: null,
    expectedSymbolType: null,
    goldNotes: probe.notes ?? '',
    goldQuery: probe.query,
    containingChunk: null,
    sourceSnippet,
    graphNeighbors: { callers: [], callees: [], implementors: [] },
    pathTokens: pathTokens(expectedFile),
    preregistered_shape_winner: null,
  };
}

function writeInput(record, dryRun) {
  if (dryRun) return null;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filename = `${record.language}-${record.goldId}.json`;
  const outPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + '\n');
  return outPath;
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const reposMap = loadReposManifest();
  const chunker = new ASTChunker();

  // 1) AST-tester probes per covered language
  const stats = { astWritten: 0, astSkipped: 0, docWritten: 0, docSkipped: 0, errors: [] };
  for (const language of COVERED_LANGUAGES) {
    if (opts.lang && language !== opts.lang) continue;
    const gold = loadGoldForLanguage(language);
    if (!gold) {
      stats.errors.push(`gold file missing for ${language}`);
      continue;
    }
    const repoEntry = reposMap.get(language);
    if (!repoEntry) {
      stats.errors.push(`repos.json entry missing for ${language}`);
      continue;
    }
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    for (const probe of gold.probes) {
      if (opts.id && probe.id !== opts.id) continue;
      try {
        const record = await buildAstTesterInput({
          chunker, repo: language, repoEntry, probe, projectRoot,
        });
        writeInput(record, opts.dryRun);
        stats.astWritten++;
        if (opts.verbose) process.stdout.write(`  ✓ ${probe.id} (${language})\n`);
      } catch (err) {
        stats.astSkipped++;
        stats.errors.push(`${probe.id}: ${err.message}`);
        if (opts.verbose) process.stdout.write(`  ✗ ${probe.id} (${language}): ${err.message}\n`);
      }
    }
  }

  // 2) Doc-positive probes (lang inferred from probe.repo)
  if (!opts.lang || opts.lang === 'doc-positive') {
    const doc = loadDocPositive();
    if (!doc) {
      stats.errors.push('doc-positive.json missing');
    } else {
      for (const probe of doc.probes) {
        if (opts.id && probe.id !== opts.id) continue;
        const repoKey = probe.repo;
        if (!COVERED_LANGUAGES.includes(repoKey)) {
          stats.docSkipped++;
          continue;
        }
        const repoEntry = reposMap.get(repoKey);
        const projectRoot = repoEntry
          ? path.join(REPO_ROOT, repoEntry.localPath)
          : null;
        try {
          if (!projectRoot) throw new Error(`no repos.json entry for ${repoKey}`);
          const record = buildDocPositiveInput({ probe, projectRoot, repoEntry, repoKey });
          writeInput(record, opts.dryRun);
          stats.docWritten++;
          if (opts.verbose) process.stdout.write(`  ✓ ${probe.id} (${repoKey} doc)\n`);
        } catch (err) {
          stats.docSkipped++;
          stats.errors.push(`${probe.id}: ${err.message}`);
          if (opts.verbose) process.stdout.write(`  ✗ ${probe.id} (${repoKey} doc): ${err.message}\n`);
        }
      }
    }
  }

  process.stdout.write(
    `\npreprocess: AST-tester written=${stats.astWritten} skipped=${stats.astSkipped}; ` +
      `doc-positive written=${stats.docWritten} skipped=${stats.docSkipped}\n` +
      (opts.dryRun ? '  (dry-run — nothing written)\n' : `  (output dir: ${path.relative(REPO_ROOT, OUTPUT_DIR)})\n`),
  );
  if (stats.errors.length > 0) {
    process.stdout.write(`  warnings/errors:\n`);
    for (const e of stats.errors.slice(0, 30)) process.stdout.write(`    - ${e}\n`);
    if (stats.errors.length > 30) {
      process.stdout.write(`    (... ${stats.errors.length - 30} more)\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`preprocess: fatal ${err.stack || err.message}\n`);
  process.exit(1);
});
