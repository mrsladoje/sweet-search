/**
 * Query Router - CatBoost WASM (Production)
 *
 * Single high-performance router using compiled CatBoost model in WebAssembly.
 *
 * Performance:
 *   - Latency: ~10μs per query (22x faster than JS)
 *   - Size: 225KB WASM (4.5x smaller than 1MB JS)
 *   - Accuracy: 100% match rate with reference implementation
 *   - Throughput: ~100k queries/sec
 *
 * The WASM module includes:
 *   - CatBoost model (499 trees, depth 4)
 *   - Feature extraction (50 features)
 *   - Reject option for uncertainty handling
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum query length to prevent DoS attacks */
const MAX_QUERY_LENGTH = 100000; // 100KB

// =============================================================================
// WASM MODULE LOADING
// =============================================================================

let wasmModule = null;
let wasmLoadError = null;

/**
 * Load the WASM module synchronously on first use.
 * The WASM file is loaded via require() for Node.js compatibility.
 */
function loadWasm() {
  if (wasmModule) return wasmModule;
  if (wasmLoadError) throw wasmLoadError;

  try {
    // Use createRequire for ES module compatibility with CommonJS WASM glue
    const require = createRequire(import.meta.url);
    const wasmPath = join(__dirname, '..', '..', 'crates', 'wasm-router', 'pkg', 'query_router_wasm.js');
    wasmModule = require(wasmPath);
    return wasmModule;
  } catch (err) {
    wasmLoadError = new Error(`Failed to load WASM router: ${err.message}`);
    throw wasmLoadError;
  }
}

// =============================================================================
// QUERY ROUTER CLASS
// =============================================================================

export class QueryRouter {
  constructor(options = {}) {
    this.wasm = null;
    this.initialized = false;
  }

  /**
   * Ensure WASM module is loaded.
   */
  ensureLoaded() {
    if (!this.wasm) {
      this.wasm = loadWasm();
      this.initialized = true;
    }
    return this.wasm;
  }

  /**
   * Route a query to the optimal search path.
   *
   * Pipeline:
   *   1. Input validation - Handles null, undefined, empty, too-long queries
   *   2. File path check (~0.1μs) - Fast path for file extensions
   *   3. WASM CatBoost ML (~10μs) - 3-class routing (lexical/semantic/hybrid)
   *
   * Structural mode is opt-in only (explicit --structural flag).
   *
   * @param {string} query - The search query
   * @returns {{mode: string, confidence: number, method: string, routingLatency_us: number}}
   */
  route(query) {
    const start = performance.now();

    // === INPUT VALIDATION ===
    // Handle null, undefined, and non-string inputs
    if (query == null || typeof query !== 'string') {
      return {
        mode: 'hybrid',
        confidence: 0,
        method: 'invalid_input',
        routingLatency_us: Math.round((performance.now() - start) * 1000),
        error: 'Query must be a non-null string',
      };
    }

    // Handle queries exceeding maximum length (DoS protection)
    if (query.length > MAX_QUERY_LENGTH) {
      return {
        mode: 'hybrid',
        confidence: 0,
        method: 'query_too_long',
        routingLatency_us: Math.round((performance.now() - start) * 1000),
        error: `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`,
      };
    }

    const trimmed = query.trim();

    // Handle empty or whitespace-only queries
    if (trimmed.length === 0) {
      return {
        mode: 'hybrid',
        confidence: 0,
        method: 'empty_query',
        routingLatency_us: Math.round((performance.now() - start) * 1000),
      };
    }

    // === FILE PATH CHECK (~0.1μs) ===
    // File extensions and paths are always lexical
    if (/\.(java|js|jsx|ts|tsx|py|go|rs|kt|swift|rb|php|c|cpp|h|proto|json|xml|yml|yaml|md|sql)$/i.test(trimmed) ||
        /[/\\]/.test(trimmed)) {
      return {
        mode: 'lexical',
        confidence: 0.95,
        method: 'file_pattern',
        routingLatency_us: Math.round((performance.now() - start) * 1000),
      };
    }

    // === WASM CATBOOST ML (~10μs) ===
    let result = null;
    try {
      const wasm = this.ensureLoaded();
      result = wasm.route_query(trimmed);

      const mode = result.mode_str.toLowerCase();
      const confidence = result.confidence;
      const rejected = result.rejected;

      return {
        mode: rejected ? 'hybrid' : mode,
        confidence,
        method: rejected ? 'wasm_rejected' : 'wasm_catboost',
        routingLatency_us: Math.round((performance.now() - start) * 1000),
      };
    } catch (err) {
      // Fallback to hybrid if WASM fails
      console.error(`[QueryRouter] WASM error: ${err.message}`);
      return {
        mode: 'hybrid',
        confidence: 0.5,
        method: 'fallback_error',
        routingLatency_us: Math.round((performance.now() - start) * 1000),
      };
    } finally {
      // Always free WASM result to prevent memory leak
      if (result && typeof result.free === 'function') {
        try {
          result.free();
        } catch {
          // Ignore free errors (may already be freed or invalid)
        }
      }
    }
  }
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

// Default singleton instance
const defaultRouter = new QueryRouter();

/**
 * Route a query using the default router.
 * @param {string} query - The search query
 * @returns {{mode: string, confidence: number, method: string, routingLatency_us: number}}
 */
export function routeQuery(query) {
  return defaultRouter.route(query);
}

/**
 * Extract features from a query (for debugging/testing).
 * @param {string} query - The query to extract features from
 * @returns {Float32Array|null} - Feature vector, or null for invalid input
 */
export function extractFeatures(query) {
  // Input validation
  if (query == null || typeof query !== 'string') {
    return null;
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return null;
  }
  const wasm = loadWasm();
  return wasm.extract_features_js(query);
}

export default QueryRouter;
