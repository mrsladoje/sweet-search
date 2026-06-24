/**
 * Streaming vectors path — large-repo OOM regression.
 *
 * The in-memory vectors path materialises the whole chunk corpus + all
 * embeddings + all LI per-token slabs (peak heap O(repo)) and OOMs on large
 * repos (tursodatabase/libsql ≈ 431k chunks, swc ≈ 217k) under the default
 * ~4 GB Node heap — on every encoder backend, since the hogs are JS-side.
 *
 * The streaming path (core/indexing/streaming-vectors.js, auto-selected for
 * large full rebuilds) spills chunks to disk and embeds/encodes in bounded
 * windows so peak heap is O(window). This test forces the streaming path on a
 * small synthetic repo (so it runs fast + deterministically) under a
 * constrained heap and asserts it:
 *   1. completes (exit 0) and actually took the streaming path,
 *   2. produces a queryable index (vectors + binary HNSW + LI),
 *   3. ran global dedup (near-dup files share an exemplar's vector),
 *   4. honored admission caps — the oversized generated file and the binary
 *      blob are NOT indexed.
 *
 * The full-scale "fits under the default heap" proof is the libsql/swc manual
 * runs in docs/STREAMING_VECTORS_OOM_FIX.md; this guards the path in CI.
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

describe('streaming vectors (large-repo OOM regression)', () => {
  let indexRun;

  beforeAll(async () => {
    REPO = join(tmpdir(), `ss-stream-it-${Date.now()}`);
    mkdirSync(join(REPO, 'src'), { recursive: true });

    // ~160 small source files. The first is duplicated many times so global
    // dedup must collapse them into one exemplar + many aliases.
    const base = (i) => `// module ${i}\n` +
      `export function add${i}(a, b) { return a + b; }\n` +
      `export function mul${i}(a, b) { return a * b; }\n` +
      `export class Calc${i} {\n  constructor(x) { this.x = x; }\n  apply(y) { return this.x + y; }\n}\n`;
    for (let i = 0; i < 120; i++) writeFileSync(join(REPO, 'src', `mod${i}.js`), base(i));
    for (let i = 0; i < 40; i++) writeFileSync(join(REPO, 'src', `dup${i}.js`), base(0)); // near-dups of mod0

    // Pathological #1: a >1 MB generated C file (250k lines) → admission size cap (1 MB) must skip it.
    const huge = 'int generated_line_marker_DO_NOT_INDEX = 0;\n'.repeat(250_000);
    writeFileSync(join(REPO, 'src', 'amalgamation.c'), huge);
    // Pathological #2: a binary blob with a non-source extension → not in the include allowlist.
    writeFileSync(join(REPO, 'src', 'fixture.db'), Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 256)));

    const git = (a) => run('git', a, {});
    await git(['init', '-q']);
    await git(['-c', 'user.email=t@t.io', '-c', 'user.name=t', 'add', '-A']);
    await git(['-c', 'user.email=t@t.io', '-c', 'user.name=t', 'commit', '-qm', 'snap']);

    // Force the streaming path on this small repo (min-files=1) with tiny windows
    // so the multi-window + spill + dedup + (no-op) eviction logic is exercised.
    // Constrain the heap to prove the path stays bounded.
    indexRun = await run('node', ['--max-old-space-size=1024', INDEXER, '--full', '--sqlite-fast', '--concurrency=1'], {
      SWEET_SEARCH_PROJECT_ROOT: REPO,
      SWEET_SEARCH_RECONCILE_V2: '0',
      SWEET_SEARCH_WATCH: '0',
      SWEET_SEARCH_STREAM_MIN_FILES: '1',
      SWEET_SEARCH_STREAM_PARSE_FILES: '16',
      SWEET_SEARCH_STREAM_HYDRATE_CHUNKS: '32',
    });

    // Diagnostics: when the indexer subprocess fails, surface its real output so
    // CI logs are actionable (the indexer's stdout/stderr is captured in-process
    // and otherwise never reaches the job log — opaque on the macOS GitHub VM).
    if (indexRun.code !== 0) {
      console.error(
        `\n[streaming-vectors] indexer FAILED: code=${indexRun.code} signal=${indexRun.signal}\n` +
        `--- indexer stdout (tail) ---\n${indexRun.stdout.slice(-4000)}\n` +
        `--- indexer stderr (tail) ---\n${indexRun.stderr.slice(-4000)}\n`
      );
    }
  }, TIMEOUT + 60000);

  afterAll(() => {
    if (REPO) { try { rmSync(REPO, { recursive: true, force: true }); } catch { /* ignore */ } }
  });

  it('completes via the streaming path under a constrained heap', () => {
    expect(indexRun.code).toBe(0);
    expect(indexRun.stdout + indexRun.stderr).toMatch(/streaming, bounded memory/i);
  });

  it('produces a queryable index (vectors + binary HNSW + LI)', () => {
    const dbPath = join(REPO, '.sweet-search', 'codebase.db');
    expect(existsSync(dbPath)).toBe(true);
    const db = new Database(dbPath, { readonly: true });
    try {
      const total = db.prepare('SELECT COUNT(*) c FROM vectors').get().c;
      expect(total).toBeGreaterThan(100);
      // every stored embedding is a valid Float32 BLOB (dim * 4 bytes)
      const sample = db.prepare('SELECT embedding FROM vectors LIMIT 50').all();
      for (const r of sample) expect(r.embedding.length % 4).toBe(0);
    } finally {
      db.close();
    }
    expect(existsSync(join(REPO, '.sweet-search', 'codebase-binary-hnsw.meta.json'))).toBe(true);
    expect(existsSync(join(REPO, '.sweet-search', 'codebase-late-interaction.db'))).toBe(true);
  });

  it('ran global dedup (near-dup files reuse an exemplar vector)', () => {
    const db = new Database(join(REPO, '.sweet-search', 'codebase.db'), { readonly: true });
    try {
      const aliases = db.prepare("SELECT COUNT(*) c FROM vectors WHERE json_extract(metadata,'$.exemplarId') IS NOT NULL").get().c;
      const exemplars = db.prepare("SELECT COUNT(*) c FROM vectors WHERE json_extract(metadata,'$.exemplarId') IS NULL").get().c;
      // The 40 dup files (copies of mod0) must alias to mod0's exemplar.
      expect(aliases).toBeGreaterThanOrEqual(40);
      expect(exemplars).toBeGreaterThan(100);
    } finally {
      db.close();
    }
  });

  it('honors admission caps (oversized + binary files are not indexed)', () => {
    const db = new Database(join(REPO, '.sweet-search', 'codebase.db'), { readonly: true });
    try {
      const huge = db.prepare("SELECT COUNT(*) c FROM vectors WHERE file_path LIKE '%amalgamation.c'").get().c;
      const bin = db.prepare("SELECT COUNT(*) c FROM vectors WHERE file_path LIKE '%fixture.db'").get().c;
      expect(huge).toBe(0);
      expect(bin).toBe(0);
    } finally {
      db.close();
    }
  });

  it('the streaming-built index returns sane ranked search results', async () => {
    // In-process search (no daemon) via the production SweetSearch class —
    // the same entry the eval harness uses (eval/lib/indexer.js initSearch).
    const dataDir = join(REPO, '.sweet-search');
    const search = await run('node', ['-e', `
      process.env.SWEET_SEARCH_PROJECT_ROOT = ${JSON.stringify(REPO)};
      process.env.EMBEDDING_PROVIDER = 'local';
      const { SweetSearch } = await import(${JSON.stringify(join(PROJECT_ROOT, 'core', 'search', 'sweet-search.js'))});
      const s = new SweetSearch({
        graphDbPath: ${JSON.stringify(join(dataDir, 'code-graph.db'))},
        binaryHnswPath: ${JSON.stringify(join(dataDir, 'codebase-binary-hnsw.idx'))},
        codebaseDbPath: ${JSON.stringify(join(dataDir, 'codebase.db'))},
        useLateInteraction: true, verbose: false, timing: false,
      });
      await s.init();
      const out = await s.search('calculator class that adds numbers', { k: 5 });
      const arr = Array.isArray(out) ? out : (out?.results || []);
      console.log('SEARCH_RESULT_COUNT=' + arr.length);
    `], { SWEET_SEARCH_PROJECT_ROOT: REPO }, 120000);
    const m = (search.stdout + search.stderr).match(/SEARCH_RESULT_COUNT=(\d+)/);
    expect(m, `search did not report a count.\nstdout:\n${search.stdout}\nstderr:\n${search.stderr}`).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThan(0);
  }, 180000);
});
