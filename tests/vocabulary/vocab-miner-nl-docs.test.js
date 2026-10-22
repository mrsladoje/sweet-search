import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractNLText, isDirectiveComment, mineNLContent } from '../../core/vocabulary/vocab-miner-nl.js';

describe('mineNLContent documents', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ss-nl-docs-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/ledger.js'), '// Records ledger entries for settled customer invoices\nexport function a() {}\n');
    writeFileSync(join(root, 'src/render.js'), '// Renders invoice totals into printable statements\nexport function b() {}\n');
  });
  afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

  it('mines one document per file set: single entities of one file share it', () => {
    // Most communities are single entities when few call edges resolve (17,651 of 17,854
    // on this repository); each used to be its own document with its file's full text.
    const communities = Array.from({ length: 30 }, (_, i) => ({
      id: i, entityIds: [`e${i}`], fileIds: [i % 2 ? 'src/render.js' : 'src/ledger.js'],
    }));
    const { communityPhrases } = mineNLContent(communities, root);
    expect(communityPhrases.map((c) => c.communityId)).toEqual([0, 1]);
    const ledger = communityPhrases[0].phrases.map((p) => p.text);
    expect(ledger).toContain('ledger');
    expect(ledger).not.toContain('statements');
  });

  it('scores the text read before the deadline instead of dropping every community', () => {
    let t = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => t++);
    const communities = [
      { id: 0, entityIds: ['a'], fileIds: ['src/ledger.js'] },
      { id: 1, entityIds: ['b'], fileIds: ['src/render.js'] },
    ];
    const { communityPhrases } = mineNLContent(communities, root, { timeoutMs: 2 });
    expect(communityPhrases).toHaveLength(1);
    expect(communityPhrases[0].phrases.length).toBeGreaterThan(0);
  });
});

describe('isDirectiveComment', () => {
  it('drops comments for tools and keeps comments for readers', () => {
    for (const t of ['eslint-disable-next-line no-console', 'tslint:disable', '@ts-ignore', 'prettier-ignore',
      'eslint-disable max-len, no-unused-vars', '!/usr/bin/env node']) {
      expect(isDirectiveComment(t), t).toBe(true);
    }
    for (const t of ['re-run the tests after a merge', 'TODO: fix the retry loop', 'Renders invoice totals']) {
      expect(isDirectiveComment(t), t).toBe(false);
    }
  });

  it('extractNLText leaves shebangs and lint directives out', () => {
    const text = extractNLText('#!/usr/bin/env node\n/* eslint-disable no-console */\n// Parses the ledger file\n', '.js');
    expect(text).toBe('Parses the ledger file');
  });
});
