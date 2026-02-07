/**
 * Translation Cache
 *
 * Caches translation results to avoid redundant API calls.
 * Uses stable cache keys that include config version to prevent stale results.
 *
 * @module translation/translation-cache
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { TRANSLATION_CONFIG, DB_PATHS, isQuietMode, LOGGING } from '../config.js';

// =============================================================================
// TRANSLATION CACHE CLASS
// =============================================================================

/**
 * Translation Cache
 *
 * Caches translation results to avoid redundant API calls.
 * Uses stable cache keys that include config version to prevent stale results.
 */
class TranslationCache {
  constructor() {
    this.cache = new Map();
    this.config = TRANSLATION_CONFIG.cache;
    this.dirty = false;
    this.loaded = false;
  }

  /**
   * Generate stable cache key
   *
   * Includes config version to invalidate when settings change.
   *
   * @param {string} query - Original query
   * @param {string} provider - Provider key
   * @param {string} model - Model name
   * @returns {string} Cache key
   */
  _getCacheKey(query, provider, model) {
    return JSON.stringify({
      q: query.toLowerCase().trim(),
      p: provider,
      m: model,
      v: this.config.keyVersion,
    });
  }

  /**
   * Load cache from disk
   * @private
   */
  _loadFromDisk() {
    if (this.loaded) return;

    try {
      const filePath = this.config.filePath || DB_PATHS.translationCache;
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        for (const [key, entry] of Object.entries(data)) {
          this.cache.set(key, entry);
        }
      }
    } catch (err) {
      if (!isQuietMode() && LOGGING.debug) {
        console.log(`[TranslationCache] Failed to load: ${err.message}`);
      }
    }

    this.loaded = true;
  }

  /**
   * Save cache to disk
   * @private
   */
  _saveToDisk() {
    if (!this.dirty) return;

    try {
      const filePath = this.config.filePath || DB_PATHS.translationCache;
      const data = Object.fromEntries(this.cache);
      writeFileSync(filePath, JSON.stringify(data, null, 2));
      this.dirty = false;
    } catch (err) {
      if (!isQuietMode() && LOGGING.debug) {
        console.log(`[TranslationCache] Failed to save: ${err.message}`);
      }
    }
  }

  /**
   * Get cached translation
   *
   * @param {string} query - Original query
   * @param {string} provider - Provider key
   * @param {string} model - Model name
   * @returns {Object|null} Cached result or null if not found/expired
   */
  get(query, provider, model) {
    if (!this.config.enabled) return null;

    this._loadFromDisk();

    const key = this._getCacheKey(query, provider, model);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.config.ttl) {
      this.cache.delete(key);
      this.dirty = true;
      return null;
    }

    if (!isQuietMode() && LOGGING.verbose) {
      console.log(`[TranslationCache] Hit: "${query}"`);
    }

    return entry.result;
  }

  /**
   * Cache a translation result
   *
   * @param {string} query - Original query
   * @param {string} provider - Provider key
   * @param {string} model - Model name
   * @param {Object} result - Translation result
   */
  set(query, provider, model, result) {
    if (!this.config.enabled) return;

    this._loadFromDisk();

    // Enforce max entries (LRU-ish: just remove oldest)
    if (this.cache.size >= this.config.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    const key = this._getCacheKey(query, provider, model);
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    });

    this.dirty = true;
    this._saveToDisk();
  }

  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
    this.dirty = true;
    this._saveToDisk();
  }

  /**
   * Get cache stats
   *
   * @returns {{ size: number, maxEntries: number, ttl: number, keyVersion: number }}
   */
  getStats() {
    this._loadFromDisk();
    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      ttl: this.config.ttl,
      keyVersion: this.config.keyVersion,
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let cacheInstance = null;

/**
 * Get the translation cache singleton
 *
 * @returns {TranslationCache} Cache instance
 */
export function getTranslationCache() {
  if (!cacheInstance) {
    cacheInstance = new TranslationCache();
  }
  return cacheInstance;
}

export default TranslationCache;
