#!/usr/bin/env node
// $0: which of the smoke goldens do the 2026-08-28 index fixes actually change?
//
// The rule the owner applied to the frozen set (18 of 267 rebuilt): rebuild ONLY the goldens
// whose admitted file set moves. Three fixes can move it — Jam files now indexed, git-tracked
// source under a build-output directory re-admitted, and committed bundles/minified files
// dropped by CONTENT shape (honouring .gitattributes linguist overrides).
//
// Compares what the CURRENT admission policy admits against what the golden's index holds.
// Read-only.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
// Resolved from this file so the script runs from anywhere in the repo.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const { createAdmissionPolicy } = await import(path.join(REPO, 'core/indexing/admission-policy.js'));
const { looksMinified } = await import(path.join(REPO, 'core/indexing/minified-detector.js'));

const require = createRequire(import.meta.url);
const Database = require(path.join(REPO, 'node_modules/better-sqlite3'));
// Usage: node golden-rebuild-need.mjs <vault-dir> <smoke20.json>
const VAULT = process.argv[2];
const IDS = JSON.parse(readFileSync(process.argv[3], 'utf8'))
  .map(x => ({ id: x.instance_id || x.id, dir: x.dir || path.join(VAULT, x.golden) }));

console.log('task                                          jam  srcBuild  bundlesIn  gitattr   VERDICT');
const needs = [];
for (const { id, dir } of IDS) {
  if (!existsSync(dir)) { console.log(`${id.padEnd(44)} (no golden)`); continue; }
  const tracked = execFileSync('git', ['-C', dir, 'ls-files', '-z'], { maxBuffer: 1 << 28 })
    .toString('utf8').split('\0').filter(Boolean);
  const policy = createAdmissionPolicy({ projectRoot: dir });

  // (1) .jam / Jamfile / Jamroot the old indexer never saw
  const jam = tracked.filter(f => /(^|\/)(Jamfile|Jamroot)(\.\w+)?$|\.jam$/i.test(f)).length;
  // (2) git-tracked source under a build-output directory that the path rules now re-admit
  const srcBuild = tracked.filter(f => policy.isBuildOutputOnly(f) && policy.matchesInclude(f)).length;
  // (4) .gitattributes linguist overrides that force a decision either way
  const gitattr = tracked.filter(f => policy.linguistAttr(f)).length;

  // (3) files the OLD index HOLDS that the content rule would now drop
  const db = new Database(path.join(dir, '.sweet-search', 'codebase.db'), { readonly: true });
  const indexed = new Set(db.prepare('SELECT DISTINCT file_path FROM vectors WHERE epoch_retired IS NULL').all().map(r => r.file_path));
  db.close();
  let bundlesIn = 0;
  for (const f of indexed) {
    if (policy.forceAdmit(f)) continue;
    const abs = path.join(dir, f);
    try {
      const st = require('node:fs').statSync(abs);
      if (st.size < 1024) continue;
      const fd = require('node:fs').openSync(abs, 'r');
      const head = Buffer.alloc(Math.min(32768, st.size));
      require('node:fs').readSync(fd, head, 0, head.length, 0);
      let tail = '';
      if (st.size > head.length) {
        const tb = Buffer.alloc(Math.min(4096, st.size));
        require('node:fs').readSync(fd, tb, 0, tb.length, st.size - tb.length);
        tail = tb.toString('utf8');
      }
      require('node:fs').closeSync(fd);
      if (looksMinified(head.toString('utf8'), { ext: path.extname(f).toLowerCase(), tailText: tail, totalBytes: st.size })) bundlesIn++;
    } catch { /* unreadable */ }
  }

  const need = jam > 0 || srcBuild > 0 || bundlesIn > 0;
  if (need) needs.push(id);
  console.log(`${id.padEnd(44)} ${String(jam).padStart(3)}  ${String(srcBuild).padStart(8)}  ${String(bundlesIn).padStart(9)}  ${String(gitattr).padStart(7)}   ${need ? 'REBUILD' : 'no change'}`);
}
console.log(`\n${needs.length} of ${IDS.length} goldens need a rebuild: ${needs.join(', ') || '(none)'}`);
