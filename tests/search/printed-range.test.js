/**
 * ss-search / ss-find header range = the lines the body prints.
 *
 * Regression (r282 final run, r3-dgraph-29): a rank-2 preview body headed
 * `worker/draft.go:1756-1894 [method: calculateSnapshot]` stopped at line 1809 with no marker.
 * compressToPreview appended `// ... (N more lines)` and the clamp after it popped that line, so
 * the cut was silent and the header claimed lines the agent never saw.
 *
 * The contract checked on every rendered block: the header names exactly the printed source
 * lines, and each line the packed range leaves out is named by a `# not shown: lines A-B —
 * ss-read <file> A B` line (or, between sandwich parts, an in-body marker with the same command).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageForAgent } from '../../core/search/context-expander.js';
import { renderFixedBlocks, selectEntries } from '../../core/search/agent-output-fixes.js';

const FILE = 'worker/draft.go';
const SANDWICH_MARKER_RE = /^\/\/ \.\.\. \(not shown: lines (\d+)-(\d+) — ss-read (\S+) (\d+) (\d+)\) \.\.\.$/;

let root;
let source;

// applyCommitted 10-130 (121 lines), calculateSnapshot 140-279 (140 lines), helper 290-296.
function buildFixture() {
  const lines = ['package worker', ''];
  while (lines.length < 9) lines.push('');
  lines.push('func (n *node) applyCommitted(proposal *pb.Proposal, key uint64) error {'); // 10
  while (lines.length < 128) lines.push(`\tspan.AddEvent("applying proposal step ${lines.length + 1}", attribute.Int64("key", int64(key)))`);
  lines.push('\treturn nil'); // 129
  lines.push('}'); // 130
  while (lines.length < 139) lines.push('');
  lines.push('func (n *node) calculateSnapshot(startIdx, lastIdx, minPendingStart uint64) (*pb.Snapshot, error) {'); // 140
  while (lines.length < 199) lines.push(`\tspan.AddEvent("snapshot bookkeeping ${lines.length + 1}", trace.WithAttributes(attribute.Int64("first", int64(first))))`);
  lines.push('\tmaxCommitTs := snap.ReadTs'); // 200
  lines.push('\tvar snapshotIdx uint64'); // 201
  while (lines.length < 260) lines.push(`\t\tif entry.Index >= lastIdx { snapshotIdx = entry.Index - 1 } // cut-point scan ${lines.length + 1}`);
  while (lines.length < 278) lines.push(`\treturn &pb.Snapshot{ReadTs: maxCommitTs, Index: snapshotIdx} // ${lines.length + 1}`);
  lines.push('}'); // 279
  while (lines.length < 289) lines.push('');
  lines.push('func helper() int {'); // 290
  while (lines.length < 295) lines.push(`\treturn ${lines.length + 1}`);
  lines.push('}'); // 296
  return lines;
}

const ENTITIES = [
  { id: 'e1', name: 'applyCommitted', type: 'method', startLine: 10, endLine: 130 },
  { id: 'e2', name: 'calculateSnapshot', type: 'method', startLine: 140, endLine: 279 },
  { id: 'e3', name: 'helper', type: 'function', startLine: 290, endLine: 296 },
];

// Eight more files, one 150-line function each, to fill the budget in the budget test.
const OTHER_FILES = Array.from({ length: 8 }, (_, i) => `pkg/part${i}/handler_${i}.go`);
const OTHER_ENTITIES = [{ id: 'o', name: 'handle', type: 'function', startLine: 1, endLine: 150 }];

function repo() {
  return {
    findEnclosingEntity: (file, start, end) => (file === FILE ? ENTITIES : OTHER_ENTITIES)
      .find((e) => e.startLine <= start && e.endLine >= end) || null,
    getFileIndexInfo: () => null,
    getDbMtime: () => null,
  };
}

function hit(startLine, endLine, score, name = null, type = 'code') {
  return { file: FILE, startLine, endLine, score, metadata: { file: FILE, startLine, endLine, name, type } };
}

/** Index of the next ``` fence at or after `j`; fails (does not hang) when there is none. */
function nextFence(out, j) {
  const k = out.indexOf('```', j);
  expect(k).toBeGreaterThanOrEqual(j);
  return k;
}

/**
 * Parse rendered blocks and check the contract; returns the parsed blocks. `results` (the packed
 * results) lets it check that the not-shown lines cover exactly fullStartLine..fullEndLine.
 */
function checkContract(text, results = []) {
  const out = text.split('\n');
  const blocks = [];
  for (let i = 0; i < out.length; i++) {
    const m = out[i].match(/^## #\d+ (\S+):(\d+)-(\d+)/);
    if (!m) continue;
    const block = { file: m[1], start: Number(m[2]), end: Number(m[3]), before: [], after: [], body: [] };
    let j = i + 1;
    if (out[j] === '### imports') j = nextFence(out, j + 2) + 1;
    while (out[j]?.startsWith('# not shown:')) block.before.push(out[j++]);
    expect(out[j]).toBe('```');
    const close = nextFence(out, j + 1);
    block.body = out.slice(j + 1, close);
    j = close + 1;
    while (j < out.length && out[j].startsWith('# not shown:')) block.after.push(out[j++]);
    blocks.push(block);

    // Body = header range, line for line (in-body sandwich markers stand for their own gap).
    let line = block.start;
    for (const text of block.body) {
      const marker = text.match(SANDWICH_MARKER_RE);
      if (marker) {
        const [a, b] = [Number(marker[1]), Number(marker[2])];
        expect(a).toBe(line);
        expect(marker[3]).toBe(block.file);
        expect([Number(marker[4]), Number(marker[5])]).toEqual([a, b]);
        line = b + 1;
        continue;
      }
      expect(text).toBe(sourceOf(block.file)[line - 1]);
      line++;
    }
    expect(line - 1).toBe(block.end);
    for (const note of [...block.before, ...block.after]) {
      const n = note.match(/^# not shown: lines (\d+)-(\d+) — ss-read (\S+) (\d+) (\d+)$/);
      expect(n).not.toBeNull();
      expect(n[3]).toBe(block.file);
      expect([Number(n[4]), Number(n[5])]).toEqual([Number(n[1]), Number(n[2])]);
    }
    // The not-shown lines and the body together cover the packed range exactly.
    const r = results.find((x) => x.code && x.file === block.file && x.startLine === block.start);
    if (r) {
      const fullStart = r.fullStartLine ?? r.startLine;
      const fullEnd = r.fullEndLine ?? r.endLine;
      const expectBefore = fullStart < block.start
        ? [`# not shown: lines ${fullStart}-${block.start - 1} — ss-read ${block.file} ${fullStart} ${block.start - 1}`] : [];
      const expectAfter = fullEnd > block.end
        ? [`# not shown: lines ${block.end + 1}-${fullEnd} — ss-read ${block.file} ${block.end + 1} ${fullEnd}`] : [];
      expect(block.before).toEqual(expectBefore);
      expect(block.after).toEqual(expectAfter);
    }
    // No legacy silent-or-uncounted cut marker survives in an agent body.
    expect(block.body.some((t) => /^\/\/ \.\.\. \(\d+ more lines\)$/.test(t))).toBe(false);
  }
  return blocks;
}

function sourceOf(file) {
  return file === FILE ? source : readFileSync(join(root, file), 'utf8').split('\n');
}

function render(response) {
  const plan = selectEntries(response.results);
  return renderFixedBlocks(response.results, plan);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'printed-range-'));
  source = buildFixture();
  mkdirSync(join(root, 'worker'));
  writeFileSync(join(root, FILE), source.join('\n'), 'utf8');
  for (const file of OTHER_FILES) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    const body = Array.from({ length: 148 }, (_, k) => `\tlog.Printf("handler step ${k} of ${file}: %v", state.Snapshot(ctx, uint64(${k})))`);
    writeFileSync(join(root, file), ['func handle() {', ...body, '}'].join('\n'), 'utf8');
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('agent header range = printed lines', () => {
  it('a cut preview body (dgraph-29 shape) names its printed lines and the rest', () => {
    const response = packageForAgent([
      hit(10, 120, 0.9, 'applyCommitted', 'method'), // not within 10 lines of rank 2 (diversity)
      hit(140, 279, 0.85, 'calculateSnapshot', 'method'),
    ], {}, {
      query: 'WAL truncation safe cut point snapshot',
      format: 'agent_preview',
      tokenBudget: 3000,
      projectRoot: root,
      codeGraphRepo: repo(),
      _isAgentFormat: true,
    });
    const second = response.results[1];
    expect(second.presentation).toBe('preview');
    expect(second.symbol).toBe('calculateSnapshot');
    expect(second.startLine).toBe(140);
    expect(second.endLine).toBeLessThan(279);
    expect(second.fullStartLine).toBe(140);
    expect(second.fullEndLine).toBe(279);

    const text = render(response);
    const blocks = checkContract(text, response.results);
    const b = blocks.find((x) => x.start === 140);
    expect(b.after).toEqual([`# not shown: lines ${b.end + 1}-279 — ss-read ${FILE} ${b.end + 1} 279`]);
  });

  it('a cut full body names its printed lines and the rest', () => {
    const response = packageForAgent([hit(10, 60, 0.9)], {}, {
      query: 'apply committed proposal',
      format: 'agent_preview',
      tokenBudget: 1200,
      projectRoot: root,
      codeGraphRepo: repo(),
      _isAgentFormat: true,
    });
    const top = response.results[0];
    expect(top.presentation).toBe('full');
    expect(top.boundaryTruncated).toBe(true);
    expect(top.code).not.toMatch(/more lines\)/);
    const [b] = checkContract(render(response), response.results);
    expect(b.start).toBe(10);
    expect(b.after).toEqual([`# not shown: lines ${b.end + 1}-130 — ss-read ${FILE} ${b.end + 1} 130`]);
    // The printed lines are a verbatim range, so the shown-span ledger may record them.
    expect(top.code.split('\n')).toHaveLength(top.endLine - top.startLine + 1);
  });

  it('a body that fits keeps the entity range and prints no not-shown line', () => {
    const response = packageForAgent([hit(291, 295, 0.9)], {}, {
      query: 'helper',
      format: 'agent_full',
      tokenBudget: 4000,
      projectRoot: root,
      codeGraphRepo: repo(),
      _isAgentFormat: true,
    });
    const top = response.results[0];
    expect([top.startLine, top.endLine]).toEqual([290, 296]);
    expect(top.fullStartLine).toBeUndefined();
    const [b] = checkContract(render(response), response.results);
    expect(b.before).toEqual([]);
    expect(b.after).toEqual([]);
  });

  it('a sandwich names the lines between its parts with the ss-read command', () => {
    // Gold 200-205 inside calculateSnapshot (140 lines, too big for the cap) → signature + gold + closing.
    const response = packageForAgent([hit(200, 205, 0.9)], { grepMatches: 1 }, {
      query: 'maxCommitTs snapshotIdx',
      format: 'agent_full',
      tokenBudget: 1200,
      projectRoot: root,
      codeGraphRepo: repo(),
      _isAgentFormat: true,
    });
    const top = response.results[0];
    expect(top.expansionKind).toBe('sandwich');
    const [b] = checkContract(render(response), response.results);
    expect(b.body.some((t) => SANDWICH_MARKER_RE.test(t))).toBe(true);
    // Signature and closing line fit: the header is the whole method, the gaps are in-body markers.
    expect([b.start, b.end]).toEqual([140, 279]);
    expect(b.body).toContain(`// ... (not shown: lines 144-199 — ss-read ${FILE} 144 199) ...`);
    expect(b.body).toContain(`// ... (not shown: lines 206-278 — ss-read ${FILE} 206 278) ...`);
    expect(b.before).toEqual([]);
    expect(b.after).toEqual([]);
  });

  it('the gold-only sandwich fallback is headed by the gold lines it prints', () => {
    // Gold 160-199: the sandwich fits the 10-tokens-per-line estimate, but these long lines
    // overshoot the cap, so the packer falls back to the gold chunk alone, cut at the cap.
    const response = packageForAgent([hit(160, 199, 0.9)], { grepMatches: 1 }, {
      query: 'snapshot bookkeeping',
      format: 'agent_full',
      tokenBudget: 1200,
      projectRoot: root,
      codeGraphRepo: repo(),
      _isAgentFormat: true,
    });
    const top = response.results[0];
    expect(top.expansionKind).toBe('chunk');
    expect(top.sandwich).toBeUndefined();
    const [b] = checkContract(render(response), response.results);
    expect(b.start).toBe(160);
    expect(b.end).toBeLessThan(199);
    expect(b.before).toEqual([`# not shown: lines 140-159 — ss-read ${FILE} 140 159`]);
    expect(b.after).toEqual([`# not shown: lines ${b.end + 1}-279 — ss-read ${FILE} ${b.end + 1} 279`]);
  });

  it('the not-shown lines are paid from the budget: tokensUsed never exceeds tokenBudget', () => {
    const hits = [
      hit(10, 120, 0.9, 'applyCommitted', 'method'),
      ...OTHER_FILES.map((file, i) => ({
        file, startLine: 1, endLine: 150, score: 0.85 - i * 0.01,
        metadata: { file, startLine: 1, endLine: 150, name: 'handle', type: 'function' },
      })),
    ];
    for (let tokenBudget = 300; tokenBudget <= 4000; tokenBudget += 37) {
      for (const format of ['agent', 'agent_preview', 'agent_full']) {
        const response = packageForAgent(hits, { grepMatches: 4 }, {
          query: 'snapshot cut point', format, tokenBudget, projectRoot: root, codeGraphRepo: repo(), _isAgentFormat: true,
        });
        expect(response.tokensUsed).toBeLessThanOrEqual(response.tokenBudget);
        checkContract(render(response), response.results);
      }
    }
  });
});
