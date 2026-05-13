#!/usr/bin/env node
/**
 * Refined spot-check: for each PARTIAL flagged "containsSymbol_wordBoundary",
 * scan EVERY occurrence of the expectedSymbol in the chunk and classify each:
 *   - DEFINITION-like: preceded by def/class/fn/const/let/var/func/pub/static/
 *                     internal/sealed/trait/struct/abstract/interface/enum/
 *                     module/object/extension/case class/macro_rules!/etc on
 *                     the same line OR immediately preceding token
 *   - REFERENCE: bare mention in code (e.g., `new X(...)`, `: X`, `X.method()`)
 *   - COMMENT/DOC: inside // /* # -- """ ''' or doc-string blocks
 *
 * Output: a per-row classification + an aggregated headline:
 *   "Strong hidden PASS": chunk contains at least one DEFINITION-like match
 *   "Weak hidden PASS":   chunk contains references but no definition
 *   "Comment-only":       only comment/doc mentions
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyChunk, loadReposMap, loadFileLines } from './relaxed-grading.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const AUDIT = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/cross-tool-audit-2026-05-13.json');
const OUT = path.join(REPO_ROOT, 'core/prompt-optimization/data/query-shapes/cross-tool-audit-2026-05-13-spotcheck.json');

const reposMap = loadReposMap();
const audit = JSON.parse(fs.readFileSync(AUDIT, 'utf8'));

function process_(tool) {
  const out = { strong: 0, weak: 0, commentOnly: 0, none: 0, audits: [] };
  for (const a of tool.partialAudits.filter(x => x.containsSymbol_wordBoundary)) {
    const lines = loadFileLines(reposMap, a.language, a.top1.file);
    if (!lines) { out.none++; continue; }
    const cls = classifyChunk(lines, a.top1.startLine, a.top1.endLine, a.expectedSymbol, a.language);
    a.classification = cls.verdict;
    a.classificationFindings = cls.findings.slice(0, 5);
    out[cls.verdict === 'strong' ? 'strong' : cls.verdict === 'weak' ? 'weak' : cls.verdict === 'comment-only' ? 'commentOnly' : 'none']++;
    out.audits.push({
      goldId: a.goldId, language: a.language, family: a.family,
      expectedSymbol: a.expectedSymbol, top1Symbol: a.top1.symbol,
      top1Range: `${a.top1.file}:${a.top1.startLine}-${a.top1.endLine}`,
      classification: cls.verdict,
      defLines: cls.findings.filter(f => f.kind === 'definition').map(f => `${f.line}: ${f.snippet}`),
      refLines: cls.findings.filter(f => f.kind === 'reference').slice(0, 2).map(f => `${f.line}: ${f.snippet}`),
      commentLines: cls.findings.filter(f => f.kind === 'comment').slice(0, 2).map(f => `${f.line}: ${f.snippet}`),
    });
  }
  return out;
}

const ssSearchRes = process_(audit.raw.ssSearch);
const ssFindRes = process_(audit.raw.ssFind);

function print(label, res, total) {
  const strict = res.strong;
  const lenient = res.strong + res.weak;
  process.stdout.write(`\n=== ${label} ===\n`);
  process.stdout.write(`  strong (chunk DEFINES expected sym): ${res.strong}\n`);
  process.stdout.write(`  weak   (only references):           ${res.weak}\n`);
  process.stdout.write(`  comment-only:                        ${res.commentOnly}\n`);
  process.stdout.write(`  none   (no match — should be 0):    ${res.none}\n`);
  process.stdout.write(`  strict hidden PASS (DEF only):  ${strict}/${total} of PARTIALs\n`);
  process.stdout.write(`  lenient hidden PASS (DEF+REF):  ${lenient}/${total} of PARTIALs\n`);
  for (const a of res.audits) {
    process.stdout.write(`  [${a.goldId}] ${a.language} expected=${a.expectedSymbol} label=${a.top1Symbol}\n`);
    process.stdout.write(`    verdict=${a.classification}\n`);
    if (a.defLines.length) process.stdout.write(`    def: ${a.defLines[0]}\n`);
    else if (a.refLines.length) process.stdout.write(`    ref: ${a.refLines[0]}\n`);
    else if (a.commentLines.length) process.stdout.write(`    cmt: ${a.commentLines[0]}\n`);
  }
}

print('ss-search PARTIALs', ssSearchRes, audit.raw.ssSearch.partial);
print('ss-find PARTIALs', ssFindRes, audit.raw.ssFind.partial);

fs.writeFileSync(OUT, JSON.stringify({ ssSearch: ssSearchRes, ssFind: ssFindRes }, null, 2));
process.stdout.write(`\nWrote ${path.relative(REPO_ROOT, OUT)}\n`);
