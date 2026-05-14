#!/usr/bin/env node
/**
 * Spot-check the cross-tool-audit-2026-05-13.json PARTIAL classifications.
 * For each PARTIAL flagged "hidden PASS", show:
 *   - expectedSymbol vs top1.symbol (chunker label)
 *   - 6 lines around where expectedSymbol appears in the chunk
 * to confirm the verbatim word-boundary match is genuine (vs. e.g., a
 * `get` that matches `getType`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const REPOS_MANIFEST = path.join(REPO_ROOT, 'eval/ast-tester-probes/repos.json');
const AUDIT = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/cross-tool-audit-2026-05-13.json');

const repos = JSON.parse(fs.readFileSync(REPOS_MANIFEST, 'utf8'));
const reposMap = new Map();
for (const e of repos.repos || []) reposMap.set(e.key || e.language, e);

const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));

function loadFileLines(language, file) {
  const entry = reposMap.get(language);
  if (!entry) return null;
  const abs = path.join(REPO_ROOT, entry.localPath, file);
  try { return fs.readFileSync(abs, 'utf8').split('\n'); } catch { return null; }
}

function locateSymbolLine(lines, startLine, endLine, sym) {
  const re = new RegExp(`\\b${sym.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`);
  for (let i = startLine; i <= endLine; i++) {
    const l = lines[i - 1];
    if (l && re.test(l)) return i;
  }
  return null;
}

function dump(label, audits) {
  process.stdout.write(`\n=== ${label} — PARTIAL spot-checks (${audits.length}) ===\n`);
  for (const a of audits) {
    const lines = loadFileLines(a.language, a.top1.file);
    const sym = a.expectedSymbol;
    const symLine = lines ? locateSymbolLine(lines, a.top1.startLine, a.top1.endLine, sym) : null;
    process.stdout.write(`\n[${a.goldId}] ${a.language}/${a.family} shape=${a.shape}\n`);
    process.stdout.write(`  expected: ${sym}   chunker-label: ${a.top1.symbol}\n`);
    process.stdout.write(`  top1: ${a.top1.file}:${a.top1.startLine}-${a.top1.endLine} (${a.chunkLines}L) score=${a.top1.score?.toFixed(3) || '-'}\n`);
    process.stdout.write(`  wordBoundaryMatch=${a.containsSymbol_wordBoundary}  substringMatch=${a.containsSymbol_substring}\n`);
    if (symLine && lines) {
      const ctxStart = Math.max(a.top1.startLine, symLine - 2);
      const ctxEnd = Math.min(a.top1.endLine, symLine + 2);
      process.stdout.write(`  --- chunk @ line ${symLine} ---\n`);
      for (let i = ctxStart; i <= ctxEnd; i++) {
        const arrow = i === symLine ? '>' : ' ';
        process.stdout.write(`  ${arrow} ${String(i).padStart(5)} | ${lines[i-1] ?? ''}\n`);
      }
    } else if (!a.containsSymbol_wordBoundary) {
      process.stdout.write(`  (no word-boundary match found)\n`);
    } else {
      process.stdout.write(`  (could not load file or locate line)\n`);
    }
  }
}

// Show only the audits flagged "containsSymbol_wordBoundary: true"
const ssSearchHits = audit.raw.ssSearch.partialAudits.filter(a => a.containsSymbol_wordBoundary);
const ssFindHits = audit.raw.ssFind.partialAudits.filter(a => a.containsSymbol_wordBoundary);

dump('ss-search', ssSearchHits);
dump('ss-find', ssFindHits);

// And the misses (the 2 cases word-boundary said "no")
process.stdout.write('\n=== ss-search PARTIAL — word-boundary MISSES (potential genuine PARTIALs) ===\n');
for (const a of audit.raw.ssSearch.partialAudits.filter(x => !x.containsSymbol_wordBoundary)) {
  process.stdout.write(`  [${a.goldId}] ${a.language} expected=${a.expectedSymbol} top1=${a.top1.file}:${a.top1.startLine}-${a.top1.endLine} sym=${a.top1.symbol}\n`);
}
