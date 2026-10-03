/**
 * Every cut of an ss-search / ss-find entry body is visible (2026-10-04).
 *
 * tortoise executor.py:686-730 printed 31 of 45 lines with no marker: the preview tier built
 * `prefix + // ... (N more lines)` and then clamped the text to the token cap by dropping
 * trailing lines, the marker first. The preview also skipped the marker whenever the kept text
 * contained `...` (a spread, a Python Ellipsis), and turned an open block into `{ ... }` with no
 * line count. Token-cap truncation could return a bare prefix; a sandwich that overshot its cap
 * printed the gold chunk under the sandwich's (wider) range.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  compressToPreview,
  estimateTokens,
  packageForAgent,
  truncateToTokenCap,
} from '../../core/search/context-expander.js';

const MARKER_RE = /^\/\/ \.\.\. \((\d+) more lines\)$/;

/** Source lines a code block shows (marker excluded) + the count the marker reports. */
function accounted(code) {
  const lines = code.split('\n');
  const last = lines[lines.length - 1];
  const m = MARKER_RE.exec(last);
  return m ? lines.length - 1 + Number(m[1]) : lines.length;
}

let projectRoot;
beforeEach(() => { projectRoot = mkdtempSync(path.join(tmpdir(), 'entry-cut-marker-')); });
afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });
function write(rel, lines) {
  const abs = path.join(projectRoot, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, `${lines.join('\n')}\n`);
  return rel;
}

describe('1a: a cut entry body is never silent', () => {
  const pyBody = [
    '    async def _prefetch_direct_relation(',
    '        self,',
    '        instance_list: Iterable[Model],',
    '    ) -> Iterable[Model]:',
    ...Array.from({ length: 41 }, (_, i) => `        value_${i} = compute_something_long(instance_list, ${i}, extra="padding text")`),
  ].join('\n');

  it('a preview keeps its `// ... (N more lines)` marker inside the cap (the clamp used to drop it)', () => {
    for (const cap of [40, 120, 300, 500]) {
      const preview = compressToPreview(pyBody, cap);
      expect(estimateTokens(preview)).toBeLessThanOrEqual(cap);
      expect(MARKER_RE.test(preview.split('\n').at(-1))).toBe(true);
      expect(accounted(preview)).toBe(45);
    }
  });

  it('a preview whose kept text contains `...` or ends on an open brace still carries the marker', () => {
    const js = ['function f(...args) {', '  const x = [...args];', '  if (x) {', ...Array.from({ length: 30 }, (_, i) => `    call(${i}, "some padding text here");`), '  }', '}'].join('\n');
    const preview = compressToPreview(js, 40);
    expect(preview).not.toContain('{ ... }');
    expect(MARKER_RE.test(preview.split('\n').at(-1))).toBe(true);
    expect(accounted(preview)).toBe(js.split('\n').length);
  });

  it('a preview of code that fits is the code itself; no room for one line is no code', () => {
    expect(compressToPreview('a\nb', 100)).toBe('a\nb');
    expect(compressToPreview('x'.repeat(400), 3)).toBe('');
  });

  it('token-cap truncation never returns a marker-less prefix', () => {
    const code = ['line one is here', 'line two is here', 'line three is here'].join('\n');
    for (let cap = 1; cap <= 20; cap++) {
      const { code: out } = truncateToTokenCap(code, cap);
      if (out) expect(accounted(out)).toBe(3);
    }
  });

  it('packageForAgent: every code entry (full and preview tiers) accounts for every line of its span', () => {
    const ranked = [0, 1, 2, 3].map((n) => {
      const rel = write(`pkg/executor${n}.py`, ['class Executor:', ...pyBody.split('\n'), '']);
      return {
        id: `r${n}`, file: rel, startLine: 2, endLine: 46, score: 1 - n * 0.1,
        metadata: { file: rel, name: '_prefetch_direct_relation', type: 'function', startLine: 2, endLine: 46 },
      };
    });
    const response = packageForAgent(ranked, { path: 'hybrid' }, {
      query: 'prefetch related objects', format: 'agent_preview', tokenBudget: 900,
      codeGraphRepo: null, projectRoot, _isAgentFormat: true,
    });
    const coded = response.results.filter((r) => r.code);
    expect(coded.map((r) => r.presentation)).toContain('preview');
    for (const r of coded) expect(accounted(r.code)).toBe(r.endLine - r.startLine + 1);
  });

  it('a sandwich that overshoots its cap prints the gold chunk under the gold range, cut visibly', () => {
    write('src/big.js', ['function big() {', ...Array.from({ length: 398 }, (_, i) => `  const v${i} = "${'x'.repeat(190)}";`), '}']);
    const ranked = [{ id: 'r', file: 'src/big.js', startLine: 200, endLine: 239, score: 1, metadata: { file: 'src/big.js', name: null, type: 'code', startLine: 200, endLine: 239 } }];
    const repo = { findEnclosingEntity: () => ({ id: 'e', name: 'big', type: 'function', startLine: 1, endLine: 400 }), getDbMtime: () => null, getFileIndexInfo: () => null };
    const top = packageForAgent(ranked, { path: 'hybrid' }, {
      query: 'big', format: 'agent', tokenBudget: 3000, codeGraphRepo: repo, projectRoot, _isAgentFormat: true,
    }).results[0];
    // The sandwich span was 1-400 (signature + gold + closing brace); the code is the gold chunk.
    expect([top.startLine, top.endLine, top.expansionKind]).toEqual([200, 239, 'chunk']);
    expect(top.code.split('\n')[0]).toContain('const v198 ');
    expect(accounted(top.code)).toBe(40);
    expect(top.shownEndLine).toBe(200 + top.code.split('\n').length - 2);
  });
});
