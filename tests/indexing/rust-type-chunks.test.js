/**
 * Rust enums, unions and type aliases are chunk boundaries: a file's leading enums no longer
 * join the license + imports chunk with no name (jj lib/src/bisect.rs 1-60).
 */
import { describe, it, expect, beforeAll } from 'vitest';

let provider;
beforeAll(async () => {
  const mod = await import('../../core/infrastructure/tree-sitter-provider.js');
  provider = mod.getTreeSitterProvider();
  if (typeof provider.initialize === 'function') await provider.initialize();
});

const RUST = `// Copyright 2025 The Authors
//! Bisect a range of commits.

use std::collections::HashSet;

/// An error that occurred while bisecting
#[derive(Debug)]
pub enum BisectionError {
    Backend,
    Revset,
}

/// Whether a commit was good or bad.
pub enum Evaluation {
    Good,
    Bad,
}

pub type Ids = HashSet<u32>;
`;

describe('Rust type declarations as chunk boundaries', () => {
  it('names the chunk after the first enum and lists the others', async () => {
    const chunks = await provider.parseFileToChunks(RUST, 'rust', { maxChunkSize: 2000 });
    const named = chunks.filter((c) => c.name);
    expect(named[0].type).toBe('enum');
    expect(named[0].name).toBe('BisectionError');
    expect(named[0].additionalSymbols).toEqual(expect.arrayContaining(['Evaluation', 'Ids']));
  });

  it('a small cap gives each declaration its own named chunk', async () => {
    const chunks = await provider.parseFileToChunks(RUST, 'rust', { maxChunkSize: 120 });
    const byName = Object.fromEntries(chunks.filter((c) => c.name).map((c) => [c.name, c]));
    expect(byName.BisectionError.type).toBe('enum');
    expect(byName.Evaluation.type).toBe('enum');
    // The one-line alias rides with the enum above it, by name.
    expect(byName.Evaluation.additionalSymbols).toEqual(['Ids']);
  });
});
