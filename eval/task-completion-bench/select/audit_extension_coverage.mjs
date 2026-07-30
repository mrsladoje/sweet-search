// audit_extension_coverage.mjs — HELDOUT2_RULES.md §8.
//
// Every file path in the drawn set's gold patches and hidden test patches is the
// set of files an agent must be able to FIND and EDIT. This checks each of them
// against sweet-search's own indexing config, imported live:
//   discovered = matched by FILE_PATTERNS.include (indexed, embedded, ss-search)
//   greppable  = in CODE_FILE_EXTENSIONS         (visible to ss-grep)
// A coverage gap is fixed in the indexing config, NEVER by dropping a task.
//
//   node select/audit_extension_coverage.mjs .cache/tasks_full_heldout2.json [...]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EXTENSION_MAP, FILENAME_MAP } from '../../../core/infrastructure/language-patterns/maps.js';
import { FILE_PATTERNS } from '../../../core/infrastructure/config/search.js';
import { CODE_FILE_EXTENSIONS } from '../../../core/infrastructure/constants.js';
import { minimatch } from 'minimatch';

const files = process.argv.slice(2);
const paths = new Map(); // path -> Set(taskId)
const pathsFrom = (diff) => (diff || '').split('\n')
  .filter(l => l.startsWith('--- ') || l.startsWith('+++ '))
  .map(l => l.slice(4).trim().replace(/^[ab]\//, ''))
  .filter(p => p && p !== '/dev/null');

for (const f of files) for (const t of JSON.parse(readFileSync(f, 'utf8'))) {
  for (const p of [...pathsFrom(t.patch), ...pathsFrom(t.test_patch)]) {
    if (!paths.has(p)) paths.set(p, new Set());
    paths.get(p).add(`${t.instance_id}(${t.language})`);
  }
}

const globMatch = (p) => FILE_PATTERNS.include.some(g => minimatch(p, g, { dot: true, nocase: false }));
// discovered => indexed + embedded + ss-search/ss-semantic reachable
// greppable  => in the ss-grep extension filter (CODE_FILE_EXTENSIONS)
const mapped = (p) => {
  const ext = path.extname(p).toLowerCase();
  if (ext) return CODE_FILE_EXTENSIONS.has(ext.slice(1));
  const base = path.basename(p);
  return !!(FILENAME_MAP && FILENAME_MAP[base]);
};

const gaps = new Map();
let covered = 0;
for (const [p, tasks] of paths) {
  const g = globMatch(p), m = mapped(p);
  if (g && m) { covered++; continue; }
  const key = `${path.extname(p) || `<no-ext:${path.basename(p)}>`}  discovered=${g ? 'Y' : 'N'} greppable=${m ? 'Y' : 'N'}`;
  if (!gaps.has(key)) gaps.set(key, { n: 0, ex: [], tasks: new Set() });
  const e = gaps.get(key);
  e.n++; if (e.ex.length < 3) e.ex.push(p);
  for (const t of tasks) e.tasks.add(t);
}
console.log(`paths=${paths.size} covered=${covered} gap-paths=${paths.size - covered}`);
console.log('--- gaps by extension (sorted by task count) ---');
for (const [k, v] of [...gaps].sort((a, b) => b[1].tasks.size - a[1].tasks.size)) {
  console.log(`${k.padEnd(46)} paths=${String(v.n).padStart(4)} tasks=${String(v.tasks.size).padStart(3)}  ${v.ex.join(' , ').slice(0, 110)}`);
  if (v.tasks.size <= 6) console.log(`      ${[...v.tasks].join(' ')}`);
}
