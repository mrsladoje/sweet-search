// Real-repo task loader — reads gold queries from
// eval/data/pattern-benchmark-<repo>/queries.jsonl.
//
// Each JSONL row carries:
//   regex, semantic_query, relevant_files[], relevant_chunks[ "file:start-end", ... ],
//   difficulty, regex_family, naming_quality, repo, split
//
// We translate each row to the bench task shape:
//   { id, taskType, difficulty, queryRegex, question, gold: { files }, maxBudgetTokens }

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function parseChunkRef(ref) {
  // "src/flask/sansio/scaffold.py:336-365" → { file, start, end }
  const m = String(ref).match(/^(.+):(\d+)-(\d+)$/);
  if (!m) return null;
  return { file: m[1], start: +m[2], end: +m[3] };
}

function deriveTaskType(row) {
  // Map regex_family + naming_quality + difficulty to one of the canonical
  // task types described in the bench plan. The mapping is intentional: the
  // queries.jsonl set was hand-authored to be primarily "function_behavior"
  // and "exact_symbol_lookup" cases under broad regex umbrellas.
  const fam = (row.regex_family || '').toLowerCase();
  const naming = (row.naming_quality || '').toLowerCase();
  const goldRanges = (row.relevant_chunks || []).map(parseChunkRef).filter(Boolean);
  const fileCount = new Set((row.relevant_files || [])).size;
  const totalLines = goldRanges.reduce((acc, r) => acc + (r.end - r.start + 1), 0);

  if (fileCount > 1) return 'import_call_relationship';
  if (fam.includes('struct') || fam.includes('class')) return 'function_behavior';
  if (fam.includes('const') || fam.includes('var') || fam === 'config') return 'config_lookup';
  if (fam.includes('error') || fam.includes('panic') || fam.includes('except')) return 'error_handling_path';
  if (naming === 'descriptive' && (row.semantic_query || '').length > 50) return 'function_behavior';
  if (totalLines > 60) return 'large_file';
  // Default
  return 'function_behavior';
}

function approxLineToTokens(loc) {
  // Budget = 4× the gold span tokens with a 600-token floor. Reasoning: a
  // good system returns the gold span with ~2× context expansion (gold + a
  // little surrounding code) plus some discovery overhead. A 4× multiplier
  // forgives reasonable expansion but still flags whole-file dumps as
  // budget-blowing. Floor handles 1-line gold targets where 4× is too tight.
  const goldTokens = Math.ceil(loc * 4);
  return Math.max(600, goldTokens * 4);
}

function rowToTask(row, repo) {
  const goldRanges = (row.relevant_chunks || []).map(parseChunkRef).filter(Boolean);
  const filesMap = {};
  for (const r of goldRanges) {
    filesMap[r.file] ||= { lineRanges: [], symbols: [] };
    filesMap[r.file].lineRanges.push([r.start, r.end]);
  }
  // If relevant_files lists files with no ranges, pad with whole-file gold.
  for (const f of row.relevant_files || []) {
    filesMap[f] ||= { lineRanges: [], symbols: [] };
  }
  // Symbol field is left empty — queries.jsonl does not always carry the
  // exact symbol name; symbol recall is reported in the metric block but is
  // optional and treated as 1 when no symbols are listed.
  const totalGoldLines = Object.values(filesMap)
    .flatMap(v => v.lineRanges)
    .reduce((acc, [a, b]) => acc + (b - a + 1), 0);

  return {
    id: `${repo}:${row.query_id}`,
    repo,
    queryId: row.query_id,
    taskType: deriveTaskType(row),
    difficulty: row.difficulty || 'medium',
    regexFamily: row.regex_family || null,
    namingQuality: row.naming_quality || null,
    split: row.split || 'dev',
    queryRegex: row.regex,
    question: row.semantic_query,
    notes: row.notes,
    gold: { files: filesMap },
    // Budget = enough tokens to fit the gold spans plus a little context.
    // A tight budget exposes overfetch in success@budget.
    maxBudgetTokens: approxLineToTokens(totalGoldLines || 30),
  };
}

/**
 * @param {string} repo - one of fastify | gin | flask | ripgrep
 * @param {Object} [opts]
 * @param {('dev'|'test'|'all')} [opts.split='dev']
 * @param {number} [opts.maxQueries=20]
 * @param {string[]} [opts.onlyIds]
 */
export function loadTasks(repo, opts = {}) {
  const split = opts.split || 'dev';
  const maxQueries = opts.maxQueries ?? 20;
  const onlyIds = opts.onlyIds && opts.onlyIds.length ? new Set(opts.onlyIds) : null;

  const jsonlPath = path.join(REPO_ROOT, 'eval', 'data', `pattern-benchmark-${repo}`, 'queries.jsonl');
  if (!existsSync(jsonlPath)) {
    throw new Error(`gold queries missing: ${jsonlPath}`);
  }

  const rows = readFileSync(jsonlPath, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l));

  let filtered = rows;
  if (split !== 'all') filtered = filtered.filter(r => (r.split || 'dev') === split);
  if (onlyIds) filtered = filtered.filter(r => onlyIds.has(r.query_id) || onlyIds.has(`${repo}:${r.query_id}`));
  if (maxQueries > 0 && !onlyIds) filtered = filtered.slice(0, maxQueries);

  return filtered.map(r => rowToTask(r, repo));
}

export function summarizeTasks(tasks) {
  const byType = {};
  const byDifficulty = {};
  for (const t of tasks) {
    byType[t.taskType] = (byType[t.taskType] || 0) + 1;
    byDifficulty[t.difficulty] = (byDifficulty[t.difficulty] || 0) + 1;
  }
  return { count: tasks.length, byType, byDifficulty };
}
