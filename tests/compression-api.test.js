/**
 * compression-api.test.js
 *
 * Tests for V2b request/response compression helpers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import embeddingService from '../core/embedding-service.js';

// These will be exported after V2b implementation
const { looksLikeJson, _providerCompressionSupport } = embeddingService;

describe('V2b Compression Helpers', () => {
  beforeEach(() => {
    // Clear compression support cache between tests
    if (_providerCompressionSupport) {
      _providerCompressionSupport.clear();
    }
  });

  describe('looksLikeJson', () => {
    it('detects JSON object', () => {
      const buf = Buffer.from('{"key": "value"}');
      expect(looksLikeJson(buf)).toBe(true);
    });

    it('detects JSON array', () => {
      const buf = Buffer.from('[1, 2, 3]');
      expect(looksLikeJson(buf)).toBe(true);
    });

    it('detects JSON with leading whitespace', () => {
      const buf = Buffer.from('  \n  {"key": "value"}');
      expect(looksLikeJson(buf)).toBe(true);
    });

    it('rejects binary/compressed data', () => {
      // gzip magic bytes (0x1f 0x8b)
      const buf = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);
      expect(looksLikeJson(buf)).toBe(false);
    });

    it('handles empty buffer', () => {
      const buf = Buffer.from('');
      expect(looksLikeJson(buf)).toBe(false);
    });

    it('handles ArrayBuffer input', () => {
      const text = '{"data": []}';
      const ab = new TextEncoder().encode(text).buffer;
      expect(looksLikeJson(ab)).toBe(true);
    });

    it('rejects plain text that does not start with { or [', () => {
      const buf = Buffer.from('Hello World');
      expect(looksLikeJson(buf)).toBe(false);
    });

    it('handles whitespace-only buffer', () => {
      const buf = Buffer.from('   \n\t\r  ');
      expect(looksLikeJson(buf)).toBe(false);
    });
  });

  describe('Provider compression support tracking', () => {
    it('defaults to supporting compression for unknown providers', () => {
      // New provider should default to "try compression"
      expect(_providerCompressionSupport.has('new-provider')).toBe(false);
    });

    it('tracks provider support state', () => {
      _providerCompressionSupport.set('test-provider', false);
      expect(_providerCompressionSupport.get('test-provider')).toBe(false);
    });
  });
});
