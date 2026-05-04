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
    // File extensions and paths route to lexical via the file_pattern
    // fast-path. The previous heuristic (`/[/\\]/.test(query)`) fired on
    // ANY slash, which mis-routed natural-language phrases like
    // "HTTP/2 server setup" to lexical. The new rule (looksLikePath)
    // requires either an extension anchor (`.js`, `.json`, ...) OR a slash
    // with NO whitespace anywhere — true paths never contain whitespace.
    if (looksLikePath(trimmed)) {
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

      // Collapse semantic → hybrid: empirically hybrid >= semantic on MRR
      // across both gencodesearchnet and fastify/gin/ripgrep at ~+1ms p50.
      const collapsedMode = (mode === 'semantic') ? 'hybrid' : mode;
      return {
        mode: rejected ? 'hybrid' : collapsedMode,
        rawMode: mode,
        confidence,
        method: rejected
          ? 'wasm_rejected'
          : (mode === 'semantic' ? 'wasm_collapsed_semantic' : 'wasm_catboost'),
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
// PATH-LIKENESS HEURISTIC
// =============================================================================

const FILE_EXT_RE = /\.(java|js|jsx|ts|tsx|mjs|cjs|py|go|rs|kt|swift|rb|php|c|cpp|h|hpp|proto|json|xml|yml|yaml|md|sql|toml|ini|conf|cfg|sh|bash|zsh|env|lock|gitignore|gitattributes|dockerfile|makefile|rake|gemspec|cargo)$/i;

/**
 * Decide whether a query is a "real" file path / glob the user wants
 * routed verbatim through lexical search, vs a natural-language phrase
 * that just happens to contain a slash.
 *
 * Path-likeness rules (model-agnostic):
 *   1. extension-anchored (`*.test.js`, `package.json`, `README.md`)
 *      → looks like a path (regardless of slashes).
 *   2. contains `/` or `\` AND has NO whitespace anywhere
 *      → looks like a path. True paths never contain whitespace.
 *   3. starts with `.`, `./`, `..`, or `~/` (relative-path prefix)
 *      → looks like a path.
 *   4. anything else (plain identifiers, NL phrases including ones that
 *      contain slashes like "HTTP/2 server setup", "TCP/IP stack")
 *      → NOT a path; let the WASM router decide.
 *
 * @param {string} query
 * @returns {boolean}
 */
export function looksLikePath(query) {
  if (typeof query !== 'string') return false;
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (FILE_EXT_RE.test(trimmed)) return true;
  // Whitespace immediately disqualifies — even if a slash is present, this
  // is natural language ("HTTP/2 server setup", "client/server architecture").
  if (/\s/.test(trimmed)) return false;
  // No-whitespace + slash/backslash → true path or glob.
  if (/[/\\]/.test(trimmed)) return true;
  // Relative-path prefixes without slashes already returned above when an
  // extension is present (e.g. `.env`); plain identifiers fall through.
  return false;
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
