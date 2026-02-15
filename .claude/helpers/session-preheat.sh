#!/bin/bash
# Session Preheat - PARALLEL warmup for Sweet Search v2.8
#
# Pre-warms ALL Sweet Search components in PARALLEL during the ~4s local model load window.
# Since the local embedding model takes ~4s to load (the bottleneck), we use
# that time to load everything else concurrently via Promise.all().
#
# Components warmed in parallel:
# 0. Search server (TCP + Unix socket) - one-time, ~3s
# 1. Local embedding model (CodeRankEmbed-onnx) - ~2-4s (bottleneck)
# 2. Vocabulary cache (~700ms)
# 3. FlashRank reranker model (ms-marco-MiniLM-L-6-v2) - ~1.5s
# 4. HNSW index - ~100-200ms
# 5. Binary HNSW index - ~100ms
# 6. SQLite FTS5 page cache (touch query) - ~50ms
# 7. ColBERT token database - ~200ms (if indexed)
# 8. Voyage API connection warmup (TLS handshake) - ~100ms
# 9. HCGS summaries database - ~50ms
# 10. WASM Query Router (CatBoost ML) - ~6ms (WASM load + JIT warmup)
# 11. Local Reranker ModernBERT INT8 - ~2-5s (only if USE_LOCAL_RERANKER=true)
# 12. Index maintainer daemon - file change detection every 45s
#
# The index-maintainer detects ALL file changes (Claude + external IDE)
# and runs full incremental indexing: FTS5, HNSW, Code Graph, HCGS.
#
# Result: Total warmup ≈ 4s (instead of 30s+ sequential)
# First query: <10ms lexical, <150ms semantic (fully warm)
# C binary (ss): No warmup needed - connects to pre-warmed server
#
# Uses lock file + health check to ensure only ONE preheat per session (24h TTL).
# v2.7: Added index-maintainer daemon for automatic external change detection

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SEARCH_DIR="${SWEET_SEARCH_DIR:-$PROJECT_ROOT}"
if [ ! -f "$SEARCH_DIR/core/sweet-search.js" ]; then
    SEARCH_DIR="$PROJECT_ROOT"
fi
LOG_FILE="/tmp/sweet-search-preheat.log"
LOCK_FILE="/tmp/sweet-search-preheat.lock"

# === Stale Session Slug Cleanup (Parallel Session Safe) ===
# Remove session slug files older than 4 hours (prevents stale attribution)
# Handles both legacy /tmp/claude-session-slug and PID-based /tmp/claude-session-slug.{PID}
SESSION_SLUG_PREFIX="/tmp/claude-session-slug"
SESSION_SLUG_TTL=14400  # 4 hours in seconds
NOW=$(date +%s)

# Clean legacy global file
if [ -f "$SESSION_SLUG_PREFIX" ]; then
    SLUG_AGE=$((NOW - $(stat -c %Y "$SESSION_SLUG_PREFIX" 2>/dev/null || echo 0)))
    if [ "$SLUG_AGE" -gt "$SESSION_SLUG_TTL" ]; then
        rm -f "$SESSION_SLUG_PREFIX"
        echo "[$(date '+%H:%M:%S')] Cleaned stale legacy session slug (age: ${SLUG_AGE}s)" >> "$LOG_FILE" 2>/dev/null || true
    fi
fi

# Clean PID-namespaced files (parallel session safe)
for slug_file in "${SESSION_SLUG_PREFIX}".*; do
    [ -f "$slug_file" ] || continue
    SLUG_AGE=$((NOW - $(stat -c %Y "$slug_file" 2>/dev/null || echo 0)))
    if [ "$SLUG_AGE" -gt "$SESSION_SLUG_TTL" ]; then
        rm -f "$slug_file"
        echo "[$(date '+%H:%M:%S')] Cleaned stale PID session slug: $slug_file (age: ${SLUG_AGE}s)" >> "$LOG_FILE" 2>/dev/null || true
    fi
done

# Check if already preheated this session (lock file < 24h old) AND server is running
if [ -f "$LOCK_FILE" ]; then
    LOCK_AGE=$(($(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0)))
    if [ "$LOCK_AGE" -lt 86400 ]; then
        # Lock is fresh, but verify server is actually running
        if curl -s --max-time 1 "http://localhost:9876/health" >/dev/null 2>&1; then
            # Server is alive, skip preheat
            exit 0
        fi
        # Server dead despite fresh lock - continue with preheat
    fi
fi

# Create lock file immediately to prevent concurrent preheats
touch "$LOCK_FILE"

# Run entirely in background
(
    cd "$PROJECT_ROOT" || exit 1

    echo "[$(date '+%H:%M:%S')] Session preheat v2.8 (PARALLEL) starting..." > "$LOG_FILE"

    # 1. Start warm server if not running
    if ! curl -s "http://localhost:9876/health" >/dev/null 2>&1; then
        echo "[$(date '+%H:%M:%S')] Starting warm server..." >> "$LOG_FILE"
        node "$SEARCH_DIR/core/sweet-search.js" --serve >/dev/null 2>&1 &
        SERVER_PID=$!

        # Wait for server to be ready (max 5 seconds)
        for i in {1..50}; do
            if curl -s "http://localhost:9876/health" >/dev/null 2>&1; then
                echo "[$(date '+%H:%M:%S')] Warm server ready (${i}00ms)" >> "$LOG_FILE"
                break
            fi
            sleep 0.1
        done
    else
        echo "[$(date '+%H:%M:%S')] Warm server already running" >> "$LOG_FILE"
    fi

    # 1b. Unix socket warmup - preestablish connection for blazing fast ss queries
    SOCKET="/tmp/sweet-search.sock"
    [[ ! -S "$SOCKET" ]] && SOCKET="/tmp/search.sock"
    if [ -S "$SOCKET" ]; then
        echo "[$(date '+%H:%M:%S')] Prewarming Unix socket..." >> "$LOG_FILE"
        curl -s --unix-socket "$SOCKET" "http://l/health" >/dev/null 2>&1
        echo "[$(date '+%H:%M:%S')] Unix socket ready" >> "$LOG_FILE"
    else
        # Wait for Unix socket to appear (server starting)
        for i in {1..30}; do
            if [ -S "$SOCKET" ]; then
                curl -s --unix-socket "$SOCKET" "http://l/health" >/dev/null 2>&1
                echo "[$(date '+%H:%M:%S')] Unix socket ready (${i}00ms)" >> "$LOG_FILE"
                break
            fi
            sleep 0.1
        done
    fi

    # 2. PARALLEL warmup of ALL components using Promise.all()
    echo "[$(date '+%H:%M:%S')] Starting PARALLEL warmup of all components..." >> "$LOG_FILE"

    cd "$SCRIPT_DIR" || exit 1

    # Single node process that loads EVERYTHING in parallel
    SEARCH_DIR="$SEARCH_DIR" PROJECT_ROOT="$PROJECT_ROOT" node -e "
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const searchDir = process.env.SEARCH_DIR;
const projectRoot = process.env.PROJECT_ROOT;
const importFromSearch = async (relPath) => import(pathToFileURL(path.join(searchDir, relPath)).href);

// Timer helper
const timer = () => { const s = performance.now(); return () => Math.round(performance.now() - s); };

// ============================================================================
// PARALLEL WARMUP FUNCTIONS
// ============================================================================

// 1. Local embedding model - CodeRankEmbed (code-specialized, 768d)
async function warmLocalModel() {
    const t = timer();
    try {
        const { EMBEDDING_PROVIDERS } = await importFromSearch('core/config.js');
        const modelName = EMBEDDING_PROVIDERS.local?.model || 'jalipalo/CodeRankEmbed-onnx';
        const { pipeline } = await import('@xenova/transformers');
        await pipeline('feature-extraction', modelName, { quantized: true });
        return { c: 'local-model', ok: true, ms: t(), model: modelName };
    } catch (e) { return { c: 'local-model', ok: false, ms: t(), err: e.message }; }
}

// 2. Vocabulary cache - OPTIMIZED: Try binary first (256d Matryoshka, 4x faster)
async function warmVocabulary() {
    const t = timer();
    try {
        const binaryPath = path.join(projectRoot, '.sweet-search', 'vocabulary.bin');
        const binaryMetaPath = path.join(projectRoot, '.sweet-search', 'vocabulary.meta.json');
        const jsonPath = path.join(projectRoot, '.sweet-search', 'query-vocabulary.json');

        // Try binary vocabulary first (75% smaller, 4x faster load)
        if (existsSync(binaryPath) && existsSync(binaryMetaPath)) {
            const meta = JSON.parse(await fs.readFile(binaryMetaPath, 'utf-8'));
            // Just load metadata - binary buffer loaded on-demand
            return { c: 'vocabulary', ok: true, ms: t(), count: meta.termCount, format: 'binary', dim: meta.dimension };
        }

        // Fallback to JSON (legacy)
        if (existsSync(jsonPath)) {
            const data = await fs.readFile(jsonPath, 'utf-8');
            const vocab = JSON.parse(data);
            const count = Object.keys(vocab.terms || {}).length;
            return { c: 'vocabulary', ok: true, ms: t(), count, format: 'json', note: 'migrate with: node vocabulary-utils.js migrate' };
        }

        return { c: 'vocabulary', ok: true, ms: t(), skip: 'not found' };
    } catch (e) { return { c: 'vocabulary', ok: false, ms: t(), err: e.message }; }
}

// 3. FlashRank reranker (~1.5s)
async function warmFlashRank() {
    const t = timer();
    try {
        const { pipeline } = await import('@xenova/transformers');
        await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', { quantized: true });
        return { c: 'flashrank', ok: true, ms: t() };
    } catch (e) { return { c: 'flashrank', ok: false, ms: t(), err: e.message }; }
}

// 4. HNSW index (~100-200ms)
async function warmHNSW() {
    const t = timer();
    try {
        const { DB_PATHS } = await importFromSearch('core/config.js');
        const metaPath = DB_PATHS.hnswIndex.replace('.idx', '.meta.json');
        if (!existsSync(metaPath)) return { c: 'hnsw', ok: true, ms: t(), skip: 'not indexed' };
        const { HNSWIndex } = await importFromSearch('core/hnsw-index.js');
        const hnsw = new HNSWIndex({ indexPath: DB_PATHS.hnswIndex });
        await hnsw.load();
        return { c: 'hnsw', ok: true, ms: t(), vectors: hnsw.getStats().totalVectors };
    } catch (e) { return { c: 'hnsw', ok: false, ms: t(), err: e.message }; }
}

// 5. Binary HNSW (~100ms)
async function warmBinaryHNSW() {
    const t = timer();
    try {
        const { DB_PATHS } = await importFromSearch('core/config.js');
        const metaPath = DB_PATHS.binaryHnswIndex.replace('.idx', '.meta.json');
        if (!existsSync(metaPath)) return { c: 'binary-hnsw', ok: true, ms: t(), skip: 'not indexed' };
        const { BinaryHNSWIndex } = await importFromSearch('core/binary-hnsw-index.js');
        const bh = new BinaryHNSWIndex({ indexPath: DB_PATHS.binaryHnswIndex });
        await bh.load();
        return { c: 'binary-hnsw', ok: true, ms: t(), vectors: bh.getStats().totalVectors };
    } catch (e) { return { c: 'binary-hnsw', ok: false, ms: t(), err: e.message }; }
}

// 6. SQLite FTS5 page cache (~50ms)
async function warmSQLiteFTS() {
    const t = timer();
    try {
        const { DB_PATHS } = await importFromSearch('core/config.js');
        if (!existsSync(DB_PATHS.codeGraph)) return { c: 'sqlite-fts', ok: true, ms: t(), skip: 'not indexed' };
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(DB_PATHS.codeGraph, { readonly: true });
        try { db.prepare('SELECT count(*) FROM entities_fts WHERE name MATCH \"warmup\"').get(); } catch {}
        try { db.prepare('SELECT count(*) FROM relationships').get(); } catch {}
        db.close();
        return { c: 'sqlite-fts', ok: true, ms: t() };
    } catch (e) { return { c: 'sqlite-fts', ok: false, ms: t(), err: e.message }; }
}

// 7. ColBERT (~200ms)
async function warmColBERT() {
    const t = timer();
    try {
        const { DB_PATHS } = await importFromSearch('core/config.js');
        const colbertPath = DB_PATHS.colbert || path.join(projectRoot, '.sweet-search', 'colbert-tokens.db');
        if (!existsSync(colbertPath)) return { c: 'colbert', ok: true, ms: t(), skip: 'not indexed' };
        const { ColBERTIndex } = await importFromSearch('core/colbert-index.js');
        const cb = new ColBERTIndex({ indexPath: colbertPath });
        await cb.init();
        return { c: 'colbert', ok: true, ms: t(), docs: cb.getStats().documents };
    } catch (e) { return { c: 'colbert', ok: false, ms: t(), err: e.message }; }
}

// 8. Voyage connection (~100ms TLS handshake)
async function warmVoyageConnection() {
    const t = timer();
    try {
        const { EMBEDDING_PROVIDERS } = await importFromSearch('core/config.js');
        if (!EMBEDDING_PROVIDERS.voyage?.enabled || !EMBEDDING_PROVIDERS.voyage?.apiKey) {
            return { c: 'voyage-conn', ok: true, ms: t(), skip: 'not configured' };
        }
        // Establish TLS tunnel with tiny request
        await fetch('https://api.voyageai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + EMBEDDING_PROVIDERS.voyage.apiKey,
                'Content-Type': 'application/json',
                'Connection': 'keep-alive',
            },
            body: JSON.stringify({
                model: EMBEDDING_PROVIDERS.voyage.model,
                input: ['warmup'],
                input_type: 'query',
            }),
        }).catch(() => {});
        return { c: 'voyage-conn', ok: true, ms: t() };
    } catch (e) { return { c: 'voyage-conn', ok: false, ms: t(), err: e.message }; }
}

// 9. HCGS summaries (~50ms)
async function warmHCGS() {
    const t = timer();
    try {
        const { DB_PATHS } = await importFromSearch('core/config.js');
        if (!existsSync(DB_PATHS.codeGraph)) return { c: 'hcgs', ok: true, ms: t(), skip: 'not indexed' };
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(DB_PATHS.codeGraph, { readonly: true });
        try {
            const r = db.prepare('SELECT count(*) as cnt FROM entities WHERE summary IS NOT NULL').get();
            db.close();
            return { c: 'hcgs', ok: true, ms: t(), summaries: r?.cnt || 0 };
        } catch { db.close(); return { c: 'hcgs', ok: true, ms: t(), skip: 'no summaries' }; }
    } catch (e) { return { c: 'hcgs', ok: false, ms: t(), err: e.message }; }
}

// 10. WASM Query Router (~6ms cold, then ~17μs warm)
async function warmQueryRouter() {
    const t = timer();
    try {
        const { routeQuery } = await importFromSearch('core/query-router.js');
        // Trigger WASM load + JIT warmup with a simple query
        routeQuery('AuthService');
        // Second call to ensure JIT is fully warm
        routeQuery('how does authentication work');
        return { c: 'query-router', ok: true, ms: t() };
    } catch (e) { return { c: 'query-router', ok: false, ms: t(), err: e.message }; }
}

// 11. Local Reranker ModernBERT INT8 (~15s cold download, ~500ms cached load)
// Model: Alibaba-NLP/gte-reranker-modernbert-base with dtype=q8 (INT8)
// Auto-downloads via @huggingface/transformers on first use
async function warmLocalReranker() {
    const t = timer();
    try {
        // Check if local reranker is configured
        const { shouldUseLocalReranker } = await importFromSearch('core/config.js');
        if (!shouldUseLocalReranker()) {
            return { c: 'local-reranker', ok: true, ms: t(), skip: 'not configured (set USE_LOCAL_RERANKER=true)' };
        }

        // Import and initialize the local reranker
        // Model auto-downloads from HuggingFace on first use (~15s)
        // Subsequent loads from cache are fast (~500ms)
        const { getGlobalLocalReranker } = await importFromSearch('core/local-reranker.js');
        const reranker = getGlobalLocalReranker();

        // Initialize model (loads ONNX + tokenizer)
        await reranker.init();

        // CRITICAL: Run warmup inference to trigger ONNX JIT compilation
        // This makes subsequent inferences ~10x faster
        await reranker.rerank('warmup query for JIT compilation', [
            'First warmup document to trigger tensor allocation',
            'Second warmup document to warm the inference path',
        ], 2);

        return { c: 'local-reranker', ok: true, ms: t(), model: 'gte-reranker-modernbert-base-int8' };
    } catch (e) { return { c: 'local-reranker', ok: false, ms: t(), err: e.message }; }
}

// ============================================================================
// RUN ALL IN PARALLEL
// ============================================================================

const totalStart = performance.now();

const results = await Promise.all([
    warmLocalModel(),        // ~4000ms (bottleneck)
    warmVocabulary(),        // ~700ms
    warmFlashRank(),         // ~1500ms
    warmHNSW(),              // ~100-200ms
    warmBinaryHNSW(),        // ~100ms
    warmSQLiteFTS(),         // ~50ms
    warmColBERT(),           // ~200ms
    warmVoyageConnection(),  // ~100ms
    warmHCGS(),              // ~50ms
    warmQueryRouter(),       // ~6ms (WASM + JIT warmup)
    warmLocalReranker(),     // ~2-5s (only if USE_LOCAL_RERANKER=true)
]);

const totalMs = Math.round(performance.now() - totalStart);

// Print results
console.log('[Sweet Search] Parallel warmup complete in ' + totalMs + 'ms');
for (const r of results) {
    const icon = r.ok ? (r.skip ? '○' : '✓') : '✗';
    let detail = '';
    if (r.count) {
        detail = '(' + r.count + ' terms';
        if (r.format) detail += ', ' + r.format;
        if (r.dim) detail += ', ' + r.dim + 'd';
        detail += ')';
    } else if (r.vectors) {
        detail = '(' + r.vectors + ' vectors)';
    } else if (r.docs) {
        detail = '(' + r.docs + ' docs)';
    } else if (r.summaries) {
        detail = '(' + r.summaries + ' summaries)';
    } else if (r.skip) {
        detail = '(' + r.skip + ')';
    } else if (r.err) {
        detail = '(' + r.err + ')';
    }
    if (r.note) detail += ' [' + r.note + ']';
    console.log('  ' + icon + ' ' + r.c + ': ' + r.ms + 'ms ' + detail);
}
const ok = results.filter(r => r.ok && !r.skip).length;
const skip = results.filter(r => r.skip).length;
const err = results.filter(r => !r.ok).length;
console.log('[Sweet Search] Summary: ' + ok + ' ok, ' + skip + ' skipped, ' + err + ' errors');
    " >> "$LOG_FILE" 2>&1

    # --- Index Maintainer Daemon (search index self-maintenance) ---
    start_index_maintainer() {
        local maintainer="$PROJECT_ROOT/.claude/hooks/index-maintainer.mjs"
        local lock_file="/tmp/claude-index-maintainer.lock"

        if [ ! -f "$maintainer" ]; then
            echo "[$(date '+%H:%M:%S')] Index maintainer not found" >> "$LOG_FILE"
            return 0
        fi

        # Check if already running via lockfile
        if [ -f "$lock_file" ]; then
            local lock_pid=$(head -n1 "$lock_file" 2>/dev/null | tr -d '[:space:]')
            local lock_ts=$(sed -n '2p' "$lock_file" 2>/dev/null | tr -d '[:space:]')
            local now=$(date +%s)000
            local stale_threshold=300000  # 5 minutes in ms

            if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
                if [ -n "$lock_ts" ]; then
                    local age=$((now - lock_ts))
                    if [ "$age" -lt "$stale_threshold" ]; then
                        echo "[$(date '+%H:%M:%S')] Index maintainer already running (PID: $lock_pid)" >> "$LOG_FILE"
                        return 0
                    fi
                else
                    echo "[$(date '+%H:%M:%S')] Index maintainer already running (PID: $lock_pid)" >> "$LOG_FILE"
                    return 0
                fi
            fi
        fi

        echo "[$(date '+%H:%M:%S')] Starting index maintainer daemon..." >> "$LOG_FILE"
        node "$maintainer" >> "$LOG_FILE" 2>&1 &
        echo $! > /tmp/index-maintainer.pid
        echo "[$(date '+%H:%M:%S')] Index maintainer started (PID: $!)" >> "$LOG_FILE"
    }

    # Start index maintainer in background (after search warmup)
    start_index_maintainer &

    echo "[$(date '+%H:%M:%S')] Session preheat complete" >> "$LOG_FILE"

) &

# Return immediately - preheat runs in background
exit 0
