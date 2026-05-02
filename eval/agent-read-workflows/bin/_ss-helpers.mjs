#!/usr/bin/env node
// Bench-local agent wrappers for Sweet Search. Each subcommand is a thin,
// agent-friendly skin over the JS API:
//   grep      → SweetSearch.bareGrep        (indexed lexical grep, gram-prefiltered)
//   find      → SweetSearch.patternSearch   (ColGrep — regex candidates, MaxSim re-rank)
//   read      → search-read.readFile        (filesystem-grounded read with optional line range)
//   semantic  → search-read-semantic.readSemantic (query-specific spans within one file)
//
// Output is compact, deterministic, agent-readable (one match per line for
// discovery; fenced code for reads). No colour codes. No JSON unless asked.

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// The agent's cwd is the target repo. SWEET_SEARCH_PROJECT_ROOT must point
// at the repo so DB_PATHS resolves to the repo's own .sweet-search/.
const PROJECT_ROOT = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();

if (!existsSync(path.join(PROJECT_ROOT, '.sweet-search', 'codebase.db'))) {
  process.stderr.write(
    `[ss-*] no Sweet Search index at ${PROJECT_ROOT}/.sweet-search/codebase.db\n` +
    `Run: SWEET_SEARCH_PROJECT_ROOT=${PROJECT_ROOT} node ${REPO_ROOT}/core/indexing/index-codebase-v21.js --full --sqlite-fast\n`
  );
  process.exit(2);
}
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

const subcommand = process.argv[2];
const rest = process.argv.slice(3);

function parseFlag(args, name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
function parseShortFlag(args, names, fallback) {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1) { const v = args[i + 1]; args.splice(i, 2); return v; }
  }
  return fallback;
}

async function getSweetSearch() {
  const { SweetSearch } = await import(path.join(REPO_ROOT, 'core/search/sweet-search.js'));
  const s = new SweetSearch({ projectRoot: PROJECT_ROOT });
  await s.init();
  return s;
}

// --- subcommands ----------------------------------------------------------

async function cmdGrep(args) {
  const k = +parseShortFlag(args, ['-k', '--top'], 20);
  const regex = args[0];
  if (!regex) {
    process.stderr.write('Usage: ss-grep <regex> [-k N]\n');
    process.exit(2);
  }
  const s = await getSweetSearch();
  const result = await s.bareGrep(regex, null, { regex, maxMatches: k * 5, contextLines: 0 });
  // Group by file, take first k matches across all files (ordered as bareGrep returns).
  const grouped = new Map();
  for (const r of result.results.slice(0, k * 5)) {
    if (!grouped.has(r.file)) grouped.set(r.file, []);
    grouped.get(r.file).push(r);
  }
  let printed = 0;
  process.stdout.write(`# ss-grep: ${result.results.length} total match(es) for /${regex}/\n`);
  for (const [file, lines] of grouped) {
    for (const r of lines) {
      const text = (r.matchText || '').replace(/\s+/g, ' ').trim().slice(0, 140);
      process.stdout.write(`${file}:${r.line}: ${text}\n`);
      printed++;
      if (printed >= k) break;
    }
    if (printed >= k) break;
  }
  if (printed === 0) process.stdout.write('(no matches)\n');
  process.exit(0);
}

async function cmdFind(args) {
  const k = +parseShortFlag(args, ['-k', '--top'], 6);
  const regex = parseFlag(args, '--regex', '');
  const query = args[0];
  if (!query) {
    process.stderr.write('Usage: ss-find "<query>" --regex "<regex>" [-k N]\n');
    process.exit(2);
  }
  const effectiveRegex = regex || '';
  const s = await getSweetSearch();
  if (!s.hasLateInteractionIndex) {
    process.stderr.write(`[ss-find] no late-interaction index — falling back to ss-grep\n`);
    return cmdGrep([effectiveRegex || query, '-k', String(k)]);
  }
  const result = await s.patternSearch(query, null, {
    regex: effectiveRegex || `\\b\\w+\\b`,
    k,
    format: 'benchmark',
  });
  process.stdout.write(`# ss-find: ColGrep top ${result.results.length} for "${query}" /${effectiveRegex || '*'}/\n`);
  for (const r of result.results) {
    const sym = r.name ? ` [${r.type || 'code'}: ${r.name}]` : '';
    const preview = (r.text || '').split('\n')[0].slice(0, 140);
    process.stdout.write(`${r.file}:${r.startLine}-${r.endLine}${sym}\n  ${preview}\n`);
  }
  if (result.results.length === 0) process.stdout.write('(no matches)\n');
  process.exit(0);
}

async function cmdRead(args) {
  const file = args[0];
  if (!file) {
    process.stderr.write('Usage: ss-read <file>             # whole file\n');
    process.stderr.write('       ss-read <file> <start>     # ONE line\n');
    process.stderr.write('       ss-read <file> <start> <end>\n');
    process.exit(2);
  }
  // If start is provided and end is omitted, read EXACTLY that one line —
  // no open-ended start-to-EOF (which a previous version did and which
  // caused accidental over-reading on large files).
  let start = null, end = null;
  if (args[1] != null) {
    start = +args[1];
    if (!Number.isFinite(start) || start < 1) {
      process.stderr.write(`[ss-read] invalid start line: "${args[1]}"\n`);
      process.exit(2);
    }
    if (args[2] != null) {
      end = +args[2];
      if (!Number.isFinite(end) || end < start) {
        process.stderr.write(`[ss-read] invalid end line: "${args[2]}" (must be ≥ start ${start})\n`);
        process.exit(2);
      }
    } else {
      end = start;     // single-line read
    }
  }
  const { readFile } = await import(path.join(REPO_ROOT, 'core/search/search-read.js'));
  const r = await readFile({ path: file, projectRoot: PROJECT_ROOT, startLine: start ?? undefined, endLine: end ?? undefined });
  if (!r.ok) {
    process.stderr.write(`[ss-read] error: ${r.error}\n`);
    process.exit(1);
  }
  const range = r.range ? ` (lines ${r.range.startLine}-${r.range.endLine} of ${r.totalLines})` : ` (${r.totalLines} lines)`;
  const fence = r.language ? '```' + r.language : '```';
  process.stdout.write(`# ss-read ${r.file}${range}\n${fence}\n${r.text}\n\`\`\`\n`);
  process.exit(0);
}

async function cmdSemantic(args) {
  const file = args[0];
  const query = args[1];
  if (!file || !query) {
    process.stderr.write('Usage: ss-semantic <file> "<question>" [--max-tokens N]\n');
    process.exit(2);
  }
  const maxTokens = +parseFlag(args.slice(2), '--max-tokens', 800);
  const { readSemantic } = await import(path.join(REPO_ROOT, 'core/search/search-read-semantic.js'));
  const r = await readSemantic({
    path: file, query, projectRoot: PROJECT_ROOT,
    maxChars: maxTokens * 4, verbose: false,
  });
  if (!r.ok) {
    process.stderr.write(`[ss-semantic] error: ${r.reason || 'unknown'}\n`);
    process.exit(1);
  }
  process.stdout.write(`# ss-semantic ${r.file} | "${query}" | spans=${r.spans?.length ?? 0} | ~tokens=${r.approxTokensReturned}${r.fellBack ? ' [FALLBACK]' : ''}\n`);
  for (const span of r.spans || []) {
    const fence = r.language ? '```' + r.language : '```';
    const sym = span.symbols?.length ? ` [${span.symbols.join(', ')}]` : '';
    process.stdout.write(`### ${r.file}:${span.startLine}-${span.endLine}${sym}\n${fence}\n${span.text}\n\`\`\`\n`);
  }
  process.exit(0);
}

(async () => {
  try {
    if (subcommand === 'grep') await cmdGrep(rest);
    else if (subcommand === 'find') await cmdFind(rest);
    else if (subcommand === 'read') await cmdRead(rest);
    else if (subcommand === 'semantic') await cmdSemantic(rest);
    else { process.stderr.write(`unknown subcommand: ${subcommand}\n`); process.exit(2); }
  } catch (err) {
    process.stderr.write(`[ss-*] crash: ${err.stack || err.message || err}\n`);
    process.exit(1);
  }
})();

// Mark unused for lint:
void readFileSync;
