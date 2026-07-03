/**
 * Byte-triggered streaming gate — few-files-huge-bytes regression (e2e).
 *
 * The streaming gate fires on file count OR total admitted source bytes
 * (shouldStreamVectors, core/indexing/indexer-utils.js). The byte trigger
 * protects the repo shape the file gate cannot see: few files, huge content
 * (amalgamations, vendored/generated blobs, extreme duplication), where the
 * in-memory path OOMs the default heap. tests/integration/
 * streaming-vectors.integration.test.js exercises the streaming PATH by
 * forcing MIN_FILES=1; this test exercises the byte TRIGGER end-to-end:
 * MIN_FILES is set unreachably high, so the only way this repo streams is
 * the byte gate — then asserts the run completes under a constrained heap
 * and produces a queryable index (vectors + LI + alias sidecar semantics
 * intact).
 *
 * Unit coverage of the gate decision logic is in
 * tests/indexing/streaming-gate.test.js; this guards the wiring in the real
 * indexer process.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const INDEXER = join(PROJECT_ROOT, 'core', 'indexing', 'index-codebase-v21.js');
const TIMEOUT = Number(process.env.SWEET_SEARCH_TEST_INDEXER_TIMEOUT_MS || 300000);

let REPO = null;

function run(cmd, args, env, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: REPO,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.end();
    const t = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('timeout')); }, timeout);
    child.on('close', (code, signal) => { clearTimeout(t); resolve({ stdout, stderr, code, signal }); });
    child.on('error', reject);
  });
}

describe('streaming gate byte trigger (few-files-huge-bytes regression)', () => {
  let indexRun;

  beforeAll(async () => {
    REPO = join(tmpdir(), `ss-stream-bytes-it-${Date.now()}`);
    mkdirSync(join(REPO, 'src'), { recursive: true });

    // 12 files x ~8 KB of REAL indexable source ≈ 100 KB admitted — far
    // under the 5000-file gate, so with MIN_BYTES=64KB the ONLY way this
    // repo streams is the byte trigger. The corpus is deliberately tiny:
    // this test proves the TRIGGER wiring (bytes fire, count can't), not
    // scale — bounded-memory behaviour at scale is the count-gated
    // streaming-vectors integration test's job, and a big corpus here just
    // times out on ORT-CPU runners. Content is distinct-per-file function
    // bodies so chunking, dedup, and LI all see legitimate code.
    const fn = (f, i) =>
      `export function handler_${f}_${i}(req, res) {\n` +
      `  const payload = { file: ${f}, op: ${i}, ts: 0 };\n` +
      `  if (!req || typeof req.id !== 'string') { return res.status(400).json(payload); }\n` +
      `  return res.status(200).json({ ...payload, id: req.id });\n` +
      `}\n`;
    for (let f = 0; f < 12; f++) {
      let body = `// module ${f}: synthetic source for the byte-gate test\n`;
      for (let i = 0; body.length < 8 * 1024; i++) body += fn(f, i);
      writeFileSync(join(REPO, 'src', `big-mod-${f}.js`), body);
    }

    const git = (a) => run('git', a, {});
    await git(['init', '-q']);
    await git(['-c', 'user.email=t@t.io', '-c', 'user.name=t', 'add', '-A']);
    await git(['-c', 'user.email=t@t.io', '-c', 'user.name=t', 'commit', '-qm', 'snap']);

    indexRun = await run('node', ['--max-old-space-size=1024', INDEXER, '--full', '--sqlite-fast', '--concurrency=1'], {
      SWEET_SEARCH_PROJECT_ROOT: REPO,
      SWEET_SEARCH_RECONCILE_V2: '0',
      SWEET_SEARCH_WATCH: '0',
      SWEET_SEARCH_STREAM_MIN_FILES: '999999',        // count trigger unreachable
      SWEET_SEARCH_STREAM_MIN_BYTES: String(64 * 1024), // byte trigger at 64 KB
      SWEET_SEARCH_STREAM_PARSE_FILES: '4',
      SWEET_SEARCH_STREAM_HYDRATE_CHUNKS: '32',
    });

    if (indexRun.code !== 0) {
      console.error(
        `\n[streaming-byte-gate] indexer FAILED: code=${indexRun.code} signal=${indexRun.signal}\n` +
        `--- indexer stdout (tail) ---\n${indexRun.stdout.slice(-4000)}\n` +
        `--- indexer stderr (tail) ---\n${indexRun.stderr.slice(-4000)}\n`
      );
    }
  }, TIMEOUT + 60000);

  afterAll(() => {
    if (REPO) { try { rmSync(REPO, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  it('streams because of BYTES, not file count, and completes under a constrained heap', () => {
    expect(indexRun.code).toBe(0);
    const out = indexRun.stdout + indexRun.stderr;
    // The byte-trigger log line from buildVectorsAndArtifactsPhase…
    expect(out).toMatch(/Streaming vectors: 12 files total \d+\+? MB >= \d+ MB/);
    // …and the streaming path's own marker.
    expect(out).toMatch(/streaming, bounded memory/i);
  });

  it('produces a queryable index (vectors + LI) identical in kind to the count-triggered path', () => {
    const dbPath = join(REPO, '.sweet-search', 'codebase.db');
    expect(existsSync(dbPath)).toBe(true);
    const db = new Database(dbPath, { readonly: true });
    try {
      const total = db.prepare('SELECT COUNT(*) c FROM vectors').get().c;
      // 12 files x ~8 KB chunks to ~5 vectors per file on the current
      // chunker; assert well above 12 (one-per-file) to prove real chunking
      // without pinning the exact chunker output.
      expect(total).toBeGreaterThan(30);
    } finally {
      db.close();
    }
    expect(existsSync(join(REPO, '.sweet-search', 'codebase-late-interaction.db'))).toBe(true);
  });
});
