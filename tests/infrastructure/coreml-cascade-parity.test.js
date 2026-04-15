/**
 * Regression tests for the CoreML cascade JS↔Rust filename parity contract.
 *
 * Context: `core/infrastructure/coreml-cascade.json` is consumed by JS
 * (`coreml-cascade.js::formatVariantFilename`), by Python
 * (`scripts/spike-coreml/trace_cascade.py`), AND indirectly by the Rust
 * filename parser in
 * `crates/sweet-search-native/src/inference/embedding_model.rs`
 * (parse_embed_variant_filename at ~line 140, uses `strip_prefix("nomic_bert_b")`)
 * and `crates/sweet-search-native/src/inference/li_model.rs`
 * (parse_li_variant_filename at ~line 127, uses `strip_prefix("li_modernbert_b")`).
 *
 * The Rust side does NOT read the JSON — it hardcodes the prefix literals.
 * Prior to this test and the `validateCascadeSpec` check, a future JSON
 * edit that renamed variants would silently disarm the cascade on every
 * M3+ user's machine with no failing test. This test closes that gap by:
 *
 *   1. Asserting the spec's filePattern starts with the Rust-hardcoded
 *      prefix via the shared `RUST_EMBED_PREFIX` / `RUST_LI_PREFIX`
 *      constants exported from `coreml-cascade.js`.
 *   2. Formatting one variant for each side and parsing it back through
 *      a JS replica of the Rust regex to ensure the round trip works.
 *   3. Parsing the actual Rust parser source for the literal prefixes
 *      and asserting they match the JS constants (catches drift where
 *      someone updates one but not the other).
 *   4. Exercising `validateCascadeSpec` on malformed specs to ensure
 *      every invariant throws with an actionable message.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  getCascadeSpec,
  validateCascadeSpec,
  formatVariantFilename,
  RUST_EMBED_PREFIX,
  RUST_LI_PREFIX,
  RUST_VARIANT_SUFFIX,
} from '../../core/infrastructure/coreml-cascade.js';

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..'
);

describe('CoreML cascade — JS↔Rust filename parity', () => {
  it('spec filePattern prefixes match the Rust-hardcoded prefixes', () => {
    const spec = getCascadeSpec();
    expect(spec.embed.filePattern.startsWith(RUST_EMBED_PREFIX)).toBe(true);
    expect(spec.li.filePattern.startsWith(RUST_LI_PREFIX)).toBe(true);
    expect(spec.embed.filePattern.endsWith(RUST_VARIANT_SUFFIX)).toBe(true);
    expect(spec.li.filePattern.endsWith(RUST_VARIANT_SUFFIX)).toBe(true);
  });

  it('Rust source files use the exact same literal prefixes as the JS constants', () => {
    // Parse the Rust files for their strip_prefix() arguments and verify
    // they match the JS-side RUST_*_PREFIX constants. This catches drift
    // in either direction: JS constant changed but Rust wasn't updated,
    // or vice versa.
    const embedRust = readFileSync(
      path.join(REPO_ROOT, 'crates/sweet-search-native/src/inference/embedding_model.rs'),
      'utf-8'
    );
    const liRust = readFileSync(
      path.join(REPO_ROOT, 'crates/sweet-search-native/src/inference/li_model.rs'),
      'utf-8'
    );

    // Each parse_*_variant_filename function has exactly one
    // `strip_prefix("literal")` call.
    const embedMatch = embedRust.match(/strip_prefix\("([^"]+)"\)/);
    const liMatch = liRust.match(/strip_prefix\("([^"]+)"\)/);

    expect(embedMatch).not.toBeNull();
    expect(liMatch).not.toBeNull();
    expect(embedMatch[1]).toBe(RUST_EMBED_PREFIX);
    expect(liMatch[1]).toBe(RUST_LI_PREFIX);
  });

  it('formatted variant filenames round-trip through the JS replica of the Rust regex', () => {
    const spec = getCascadeSpec();

    // JS replica of parse_embed_variant_filename / parse_li_variant_filename.
    // Rust logic: strip_prefix → split on `_s` → parse batch, strip suffix
    // from seq side, parse seq. We replicate it here so the test fails if
    // the convention changes.
    const parseVariant = (filename, prefix) => {
      if (!filename.startsWith(prefix)) return null;
      const rest = filename.slice(prefix.length);
      const sIdx = rest.indexOf('_s');
      if (sIdx < 0) return null;
      const batchStr = rest.slice(0, sIdx);
      const afterS = rest.slice(sIdx + 2);
      if (!afterS.endsWith(RUST_VARIANT_SUFFIX)) return null;
      const seqStr = afterS.slice(0, -RUST_VARIANT_SUFFIX.length);
      const batch = parseInt(batchStr, 10);
      const seq = parseInt(seqStr, 10);
      if (!Number.isInteger(batch) || !Number.isInteger(seq)) return null;
      return { batch, seq };
    };

    for (const v of spec.embed.variants) {
      const fname = formatVariantFilename(spec.embed.filePattern, v.batch, v.seq);
      const parsed = parseVariant(fname, RUST_EMBED_PREFIX);
      expect(parsed).not.toBeNull();
      expect(parsed.batch).toBe(v.batch);
      expect(parsed.seq).toBe(v.seq);
    }
    for (const v of spec.li.variants) {
      const fname = formatVariantFilename(spec.li.filePattern, v.batch, v.seq);
      const parsed = parseVariant(fname, RUST_LI_PREFIX);
      expect(parsed).not.toBeNull();
      expect(parsed.batch).toBe(v.batch);
      expect(parsed.seq).toBe(v.seq);
    }
  });
});

describe('CoreML cascade — validateCascadeSpec', () => {
  const validSpec = () => ({
    version: 2,
    hfRepo: 'example/cascade',
    embed: {
      modelKey: 'nomic-bert',
      filePattern: 'nomic_bert_b{batch}_s{seq}_fp16.mlpackage',
      tarballPattern: 'embed/nomic_bert_b{batch}_s{seq}_fp16.mlpackage.tar.gz',
      hiddenDim: 768,
      variants: [
        { batch: 64, seq: 96 },
        { batch: 1, seq: 2048 },
      ],
    },
    li: {
      modelKey: 'modernbert-li',
      filePattern: 'li_modernbert_b{batch}_s{seq}_fp16.mlpackage',
      tarballPattern: 'li/li_modernbert_b{batch}_s{seq}_fp16.mlpackage.tar.gz',
      tokenDim: 128,
      variants: [{ batch: 128, seq: 48 }],
    },
  });

  it('accepts a minimally-valid spec', () => {
    expect(() => validateCascadeSpec(validSpec())).not.toThrow();
  });

  it('rejects missing version field', () => {
    const spec = validSpec();
    delete spec.version;
    expect(() => validateCascadeSpec(spec)).toThrow(/version/);
  });

  it('rejects missing hfRepo', () => {
    const spec = validSpec();
    spec.hfRepo = '';
    expect(() => validateCascadeSpec(spec)).toThrow(/hfRepo/);
  });

  it('rejects embed.filePattern with wrong prefix (schema drift)', () => {
    const spec = validSpec();
    spec.embed.filePattern = 'nomic_bert_v2_b{batch}_s{seq}_fp16.mlpackage';
    expect(() => validateCascadeSpec(spec)).toThrow(
      /nomic_bert_b.*Rust parser contract/
    );
  });

  it('rejects li.filePattern with wrong prefix (schema drift)', () => {
    const spec = validSpec();
    spec.li.filePattern = 'li_modernbert_short_b{batch}_s{seq}_fp16.mlpackage';
    expect(() => validateCascadeSpec(spec)).toThrow(
      /li_modernbert_b.*Rust parser contract/
    );
  });

  it('rejects filePattern without _fp16.mlpackage suffix', () => {
    const spec = validSpec();
    spec.embed.filePattern = 'nomic_bert_b{batch}_s{seq}.mlpackage';
    expect(() => validateCascadeSpec(spec)).toThrow(/_fp16\.mlpackage/);
  });

  it('rejects filePattern missing {batch} or {seq} placeholder', () => {
    const spec = validSpec();
    spec.embed.filePattern = 'nomic_bert_b64_s{seq}_fp16.mlpackage';
    expect(() => validateCascadeSpec(spec)).toThrow(/{batch}/);
  });

  it('rejects non-integer batch in a variant', () => {
    const spec = validSpec();
    spec.embed.variants[0].batch = '64';
    expect(() => validateCascadeSpec(spec)).toThrow(/batch.*positive integer/);
  });

  it('rejects malformed tarballSha256 hex string', () => {
    const spec = validSpec();
    spec.embed.variants[0].tarballSha256 = 'not-a-hash';
    expect(() => validateCascadeSpec(spec)).toThrow(/tarballSha256.*64-char hex/);
  });

  it('rejects negative tarballSizeBytes', () => {
    const spec = validSpec();
    spec.embed.variants[0].tarballSizeBytes = -1;
    expect(() => validateCascadeSpec(spec)).toThrow(/tarballSizeBytes.*positive integer/);
  });

  it('accepts variants with missing tarballSha256 (not yet backfilled by release machine)', () => {
    const spec = validSpec();
    // Confirm variants without checksums still validate — the release workflow
    // is allowed to upload before backfilling checksums, and the fetcher's
    // `variantSpec.tarballSha256` guard handles the missing-checksum case.
    expect(() => validateCascadeSpec(spec)).not.toThrow();
  });
});
