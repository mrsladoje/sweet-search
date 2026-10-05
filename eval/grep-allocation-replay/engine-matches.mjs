#!/usr/bin/env node
/**
 * Collector worker: the ENGINE's full match list for each grep of one repository, as ss-grep
 * would fetch it (eval/grep-allocation-replay/collect.mjs --matcher engine, the default).
 *
 * The pattern goes through the tool's own steps: buildGrepPattern (-i/-w/-F), the regex
 * repair of a pattern the engine cannot parse, and the one case-insensitive retry of a
 * zero-hit search (SS_FIX_GREP_RETRY, default on). The search is the warm in-process
 * SweetSearch.bareGrep over the repository's real index, with no per-file cap, so the replay
 * sees every match the tool's file selection sees. Read-only: grep-only init, no daemon.
 *
 * Run by collect.mjs: node engine-matches.mjs <job.json>
 *   job = { repoDir, outFile, greps: [{ key, pattern, flags: {i, w, F} }] }
 *   out = { [key]: { usedRegex, note, files: { [file]: { total, lines: [[line, text]] } } } }
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { buildGrepPattern } from '../agent-read-workflows/bin/_ss-argparse.mjs';
import { isRegexParseError, repairRegexBranches } from '../../core/search/agent-output-fixes.js';

const MAX_LINES_PER_FILE = 400;
const MAX_TEXT = 300;

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { SweetSearch } = await import('../../core/search/sweet-search.js');
const searcher = new SweetSearch({ projectRoot: job.repoDir });
await searcher.initGrepOnly();

const fetch = rx => searcher.bareGrep(rx, null, { regex: rx, maxMatches: 0, contextLines: 0, _isAgentFormat: true, _siblingLine: false });

const out = {};
for (const g of job.greps) {
  const opts = { ignoreCase: g.flags.i, wordBound: g.flags.w, fixedString: g.flags.F };
  let usedRegex = buildGrepPattern(g.pattern, opts);
  let note = null;
  let result = null;
  try {
    result = await fetch(usedRegex);
  } catch (err) {
    if (!isRegexParseError(err)) { out[g.key] = { usedRegex, note: `error: ${err.message}`, files: {} }; continue; }
    usedRegex = buildGrepPattern(repairRegexBranches(g.pattern).pattern, { ...opts, fixedString: false });
    note = 'repaired';
    try { result = await fetch(usedRegex); } catch { out[g.key] = { usedRegex, note: 'unparsable', files: {} }; continue; }
  }
  if ((result.stats?.totalMatches ?? result.results.length) === 0 && !/^\(\?[a-z-]*i[a-z-]*[:)]/.test(usedRegex)) {
    try {
      const retry = await fetch(`(?i)${usedRegex}`);
      if ((retry.stats?.totalMatches ?? retry.results.length) > 0) { result = retry; usedRegex = `(?i)${usedRegex}`; note = 'case-insensitive retry'; }
    } catch { /* keep the zero-hit answer */ }
  }
  const files = {};
  for (const r of result.results) {
    let f = files[r.file];
    if (!f) { f = { total: 0, lines: [] }; files[r.file] = f; }
    f.total++;
    if (f.lines.length < MAX_LINES_PER_FILE) f.lines.push([r.line, String(r.content ?? r.matchText ?? '').replace(/\r$/, '').slice(0, MAX_TEXT)]);
  }
  out[g.key] = { usedRegex, note, files };
}
writeFileSync(job.outFile, JSON.stringify(out));
process.exit(0);
