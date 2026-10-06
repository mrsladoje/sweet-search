// Subscription login seed / write-back for the Codex and opencode task runners (2026-10-06).
// OAuth refresh tokens are single-use: a refreshed rollout copy must reach the master, and an older
// copy must never overwrite a newer master.
import { mkdtempSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ocSeedAuth, ocSyncAuthBack } from '../harness/opencode-task-runner.mjs';
import { codexSyncAuthBack } from '../harness/codex-task-runner.mjs';

const d = mkdtempSync(path.join(tmpdir(), 'auth-sync-'));
const master = path.join(d, 'master.json'), ocData = mkdtempSync(path.join(d, 'oc-'));
writeFileSync(master, JSON.stringify({ openai: { refresh: 'r1', expires: 100 }, other: { k: 1 } }));
ocSeedAuth(ocData, 'openai', master);
assert.deepEqual(JSON.parse(readFileSync(path.join(ocData, 'auth.json'))), { openai: { refresh: 'r1', expires: 100 } });
assert.equal(ocSyncAuthBack(ocData, 'openai', master), false, 'unchanged copy is not written back');
writeFileSync(path.join(ocData, 'auth.json'), JSON.stringify({ openai: { refresh: 'r2', expires: 200 } }));
assert.equal(ocSyncAuthBack(ocData, 'openai', master), true);
assert.deepEqual(JSON.parse(readFileSync(master)), { openai: { refresh: 'r2', expires: 200 }, other: { k: 1 } }, 'only the provider entry changes');
writeFileSync(path.join(ocData, 'auth.json'), JSON.stringify({ openai: { refresh: 'old', expires: 50 } }));
assert.equal(ocSyncAuthBack(ocData, 'openai', master), false, 'older copy never overwrites a newer master');
assert.throws(() => ocSeedAuth(ocData, 'anthropic', master), /no anthropic login/);

const cm = path.join(d, 'codex-master.json'), home = mkdtempSync(path.join(d, 'ch-'));
writeFileSync(cm, 'A'); writeFileSync(path.join(home, 'auth.json'), 'A');
assert.equal(codexSyncAuthBack(home, cm), false, 'identical login is not written back');
writeFileSync(path.join(home, 'auth.json'), 'B'); utimesSync(cm, 1, 1);
assert.equal(codexSyncAuthBack(home, cm), true); assert.equal(readFileSync(cm, 'utf8'), 'B');
writeFileSync(path.join(home, 'auth.json'), 'C'); utimesSync(path.join(home, 'auth.json'), 1, 1);
assert.equal(codexSyncAuthBack(home, cm), false, 'an older rollout copy never overwrites the master');
console.log('ALL PASS');
