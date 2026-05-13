#!/usr/bin/env node
/**
 * verify-chunker.mjs — for each of the 4 "OverlayRequired" dev FAILs,
 * load ALL chunks the chunker emitted for the expected file and report
 * which (if any) overlap the gold line range.
 *
 * If chunks DO overlap the gold:
 *   → "OverlayRequired" was a misnomer. The chunker is fine; the chunks
 *     just lost in the RRF fusion before the top-K cut. Re-classify as
 *     ranker problem.
 *
 * If chunks DON'T overlap the gold:
 *   → Real chunker gap. Worth web research to confirm tree-sitter
 *     behaviour for the pattern.
 *
 * Uses orchestrator/child pattern (SWEET_SEARCH_PROJECT_ROOT must be set
 * BEFORE codebase-repository imports DB_PATHS).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const INPUTS_DIR = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/inputs');
const REPOS_PATH = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');

const TARGETS = [
  { lang: 'cpp',    goldId: 'CPP-003' },  // ChosenTarget struct, gold 166-207
  { lang: 'lua',    goldId: 'LU-004'  },  // List class, gold 122-129
  { lang: 'python', goldId: 'PY-006'  },  // ParamType.convert, gold 173-219
  { lang: 'zig',    goldId: 'ZG-005'  },  // Response struct, gold 20-64
];

function loadReposManifest() {
  const raw = JSON.parse(fs.readFileSync(REPOS_PATH, 'utf8'));
  const map = new Map();
  for (const e of raw.repos || []) map.set(e.key || e.language, e);
  return map;
}

function loadInput(lang, goldId) {
  return JSON.parse(fs.readFileSync(path.join(INPUTS_DIR, `${lang}-${goldId}.json`), 'utf8'));
}

async function orchestrate() {
  const reposMap = loadReposManifest();
  for (const t of TARGETS) {
    const repoEntry = reposMap.get(t.lang);
    if (!repoEntry) continue;
    const projectRoot = path.join(REPO_ROOT, repoEntry.localPath);
    process.stdout.write(`\n=== ${t.lang}-${t.goldId} (projectRoot=${path.relative(REPO_ROOT, projectRoot)}) ===\n`);
    const res = spawnSync(process.argv[0], [process.argv[1], '--child', t.lang, t.goldId], {
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: projectRoot, SS_VERIFY_CHILD: '1' },
      stdio: 'inherit',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) process.stderr.write(`  child exited ${res.status}\n`);
  }
}

async function child(lang, goldId) {
  const input = loadInput(lang, goldId);
  const expectedFile = input.expectedFile;
  const gold = input.containingChunk;
  process.stdout.write(`expectedFile: ${expectedFile}\n`);
  process.stdout.write(`expectedSymbol: ${input.expectedSymbol}\n`);
  process.stdout.write(`gold range: ${gold.startLine}-${gold.endLine} (${gold.endLine - gold.startLine + 1}L)\n`);

  const { CodebaseRepository } = await import('../../../infrastructure/codebase-repository.js');
  const { DB_PATHS } = await import('../../../infrastructure/config/index.js');
  process.stdout.write(`DB: ${DB_PATHS.codebase}\n`);
  const repo = new CodebaseRepository(DB_PATHS.codebase);
  const rows = repo.getChunksByFilePath(expectedFile);
  process.stdout.write(`total chunks in file: ${rows.length}\n`);
  if (rows.length === 0) {
    process.stdout.write(`*** FILE NOT INDEXED — readSemantic would fall back to whole-file read ***\n`);
    return;
  }
  // Parse + sort by startLine
  const chunks = rows.map((r) => {
    const meta = (() => { try { return typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata; } catch { return {}; } })() || {};
    return {
      id: r.id,
      startLine: meta.startLine ?? meta.line_start ?? null,
      endLine: meta.endLine ?? meta.line_end ?? null,
      symbol: meta.name ?? meta.symbol ?? null,
      type: meta.type ?? meta.chunk_type ?? null,
    };
  }).filter((c) => c.startLine != null).sort((a, b) => a.startLine - b.startLine);

  // Find chunks overlapping the gold range
  const overlapping = chunks.filter((c) => c.startLine <= gold.endLine && c.endLine >= gold.startLine);
  process.stdout.write(`\nchunks OVERLAPPING gold range ${gold.startLine}-${gold.endLine}: ${overlapping.length}\n`);
  for (const c of overlapping) {
    process.stdout.write(`  ${c.startLine}-${c.endLine} (${c.endLine - c.startLine + 1}L) sym=${c.symbol ?? '(null)'} type=${c.type ?? ''}\n`);
  }

  // Find chunks near the gold (within ±50 lines) for context
  const near = chunks.filter((c) =>
    !overlapping.includes(c) &&
    Math.min(Math.abs(c.startLine - gold.endLine), Math.abs(c.endLine - gold.startLine)) <= 50
  );
  process.stdout.write(`\nchunks NEAR gold (±50 lines, not overlapping): ${near.length}\n`);
  for (const c of near.slice(0, 10)) {
    process.stdout.write(`  ${c.startLine}-${c.endLine} (${c.endLine - c.startLine + 1}L) sym=${c.symbol ?? '(null)'} type=${c.type ?? ''}\n`);
  }

  // Is any chunk's symbol the expectedSymbol?
  const symLower = String(input.expectedSymbol || '').toLowerCase();
  const symbolChunks = chunks.filter((c) => c.symbol && c.symbol.toLowerCase().includes(symLower));
  process.stdout.write(`\nchunks whose symbol mentions "${input.expectedSymbol}": ${symbolChunks.length}\n`);
  for (const c of symbolChunks.slice(0, 10)) {
    process.stdout.write(`  ${c.startLine}-${c.endLine} (${c.endLine - c.startLine + 1}L) sym=${c.symbol} type=${c.type ?? ''}\n`);
  }
}

async function main() {
  if (process.env.SS_VERIFY_CHILD === '1' && process.argv[2] === '--child') {
    await child(process.argv[3], process.argv[4]);
  } else {
    await orchestrate();
  }
}

main().catch((err) => { process.stderr.write(`fatal ${err.stack || err.message}\n`); process.exit(1); });
