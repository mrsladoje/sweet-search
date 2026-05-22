/**
 * Unit tests for core/prompt-optimization/sweep/p7-persist.mjs (§7.4).
 *
 * Covers:
 *   - appendFsynced: written events are parseable
 *   - loadTrajectory: corrupt/partial trailing line is silently skipped
 *   - atomicWriteJSON: uses .tmp + rename, final file is readable
 *   - resumeState: round tracking, completedStepIds, mutation grouping
 *   - kill-9 sim: write N events, truncate mid-last-line → recover N-1
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, truncateSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  appendFsynced,
  appendEvent,
  atomicWriteJSON,
  loadTrajectory,
  loadParetoCurrent,
  resumeState,
  stepId,
  trajectoryPath,
  promptBankPath,
  paretoCurrentPath,
  RESULTS_DIR,
} from '../../../core/prompt-optimization/sweep/p7-persist.mjs';

// ─── helpers ──────────────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'p7-persist-test-'));
});

afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function tmpFile(name = 'traj.jsonl') {
  return path.join(tmpDir, name);
}

// ─── appendFsynced ────────────────────────────────────────────────────────────

describe('appendFsynced', () => {
  it('writes a parseable JSONL event and can be read back', () => {
    const p = tmpFile();
    const event = { _kind: 'mutation', round: 1, mutation_hash: '0xabc', source_op: 'reflective' };
    appendFsynced(p, event);

    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject(event);
  });

  it('appends multiple events in order', () => {
    const p = tmpFile();
    const events = [
      { _kind: 'mutation', round: 1 },
      { _kind: 'screen', round: 1, probe_id: 'p-001', target: 'sonnet', score: 0.8 },
      { _kind: 'confirm', round: 1, probe_id: 'p-001', target: 'gpt5_5', final_score: 0.72 },
    ];
    for (const ev of events) appendFsynced(p, ev);

    const loaded = loadTrajectory(p);
    expect(loaded).toHaveLength(3);
    expect(loaded[0]._kind).toBe('mutation');
    expect(loaded[2].final_score).toBe(0.72);
  });

  it('appendEvent is an alias for appendFsynced', () => {
    expect(appendEvent).toBe(appendFsynced);
  });

  it('creates parent directory if missing', () => {
    const nested = path.join(tmpDir, 'deep', 'nested', 'traj.jsonl');
    appendFsynced(nested, { _kind: 'mutation', round: 1 });
    expect(existsSync(nested)).toBe(true);
  });
});

// ─── loadTrajectory ───────────────────────────────────────────────────────────

describe('loadTrajectory', () => {
  it('returns [] for a missing file', () => {
    expect(loadTrajectory(tmpFile('nonexistent.jsonl'))).toEqual([]);
  });

  it('skips a corrupt trailing line (kill-9 partial-write simulation)', () => {
    const p = tmpFile();
    const events = [
      { _kind: 'mutation', round: 1, mutation_hash: 'h1' },
      { _kind: 'screen',   round: 1, probe_id: 'p-001', score: 0.9 },
      { _kind: 'confirm',  round: 1, probe_id: 'p-001', final_score: 0.85 },
    ];
    for (const ev of events) appendFsynced(p, ev);

    // Simulate kill -9: truncate 8 bytes off the end of the last line
    const sz = statSync(p).size;
    truncateSync(p, Math.max(0, sz - 8));

    const loaded = loadTrajectory(p);
    // The last event is corrupt; we should recover the first two.
    expect(loaded.length).toBeGreaterThanOrEqual(events.length - 1);
    expect(loaded[0]._kind).toBe('mutation');
    expect(loaded[1]._kind).toBe('screen');
  });

  it('handles completely empty file', () => {
    const p = tmpFile();
    writeFileSync(p, '');
    expect(loadTrajectory(p)).toEqual([]);
  });

  it('skips blank lines between valid events', () => {
    const p = tmpFile();
    writeFileSync(p, '{"_kind":"mutation","round":1}\n\n{"_kind":"screen","round":1}\n');
    const loaded = loadTrajectory(p);
    expect(loaded).toHaveLength(2);
  });
});

// ─── atomicWriteJSON ──────────────────────────────────────────────────────────

describe('atomicWriteJSON', () => {
  it('writes valid JSON readable by JSON.parse', () => {
    const p = tmpFile('pareto.json');
    const obj = { front: ['T1-r0', 'T3-r2'], round: 5 };
    atomicWriteJSON(p, obj);
    const back = JSON.parse(readFileSync(p, 'utf8'));
    expect(back).toMatchObject(obj);
  });

  it('does not leave a .tmp file on success', () => {
    const p = tmpFile('pareto.json');
    atomicWriteJSON(p, { round: 1 });
    expect(existsSync(p + '.tmp')).toBe(false);
  });

  it('overwrites an existing file atomically', () => {
    const p = tmpFile('pareto.json');
    atomicWriteJSON(p, { round: 1, front: ['T1'] });
    atomicWriteJSON(p, { round: 3, front: ['T1', 'T5'] });
    const back = JSON.parse(readFileSync(p, 'utf8'));
    expect(back.round).toBe(3);
    expect(back.front).toHaveLength(2);
  });
});

// ─── loadParetoCurrent ────────────────────────────────────────────────────────

describe('loadParetoCurrent', () => {
  it('returns null for missing file', () => {
    expect(loadParetoCurrent(tmpFile('missing.json'))).toBeNull();
  });

  it('returns parsed object for valid JSON file', () => {
    const p = tmpFile('pareto.json');
    const obj = { front: ['T1-r0'], round: 2 };
    writeFileSync(p, JSON.stringify(obj));
    expect(loadParetoCurrent(p)).toMatchObject(obj);
  });

  it('returns null for corrupt JSON', () => {
    const p = tmpFile('pareto.json');
    writeFileSync(p, '{bad json}');
    expect(loadParetoCurrent(p)).toBeNull();
  });
});

// ─── stepId ───────────────────────────────────────────────────────────────────

describe('stepId', () => {
  it('builds id with all fields', () => {
    const ev = { _kind: 'screen', round: 3, mutation_hash: '0xabc', probe_id: 'p-001', target: 'sonnet' };
    expect(stepId(ev)).toBe('screen:3:0xabc:p-001:sonnet');
  });

  it('handles missing optional fields with empty strings', () => {
    expect(stepId({ _kind: 'pareto-update', round: 2 })).toBe('pareto-update:2:::');
  });

  it('two distinct events get distinct stepIds', () => {
    const a = stepId({ _kind: 'screen', round: 1, probe_id: 'p-001', target: 'sonnet' });
    const b = stepId({ _kind: 'screen', round: 1, probe_id: 'p-001', target: 'gpt5_5' });
    expect(a).not.toBe(b);
  });
});

// ─── resumeState ──────────────────────────────────────────────────────────────

describe('resumeState', () => {
  it('returns zero state for empty / missing trajectory', () => {
    const state = resumeState({ trajectoryPath: tmpFile('missing.jsonl') });
    expect(state.lastRound).toBe(0);
    expect(state.completedStepIds.size).toBe(0);
    expect(state.paretoUpdates).toEqual([]);
    expect(state.mutationsByRound.size).toBe(0);
  });

  it('tracks lastRound correctly', () => {
    const p = tmpFile();
    appendFsynced(p, { _kind: 'mutation', round: 1, mutation_hash: 'h1' });
    appendFsynced(p, { _kind: 'confirm', round: 3, mutation_hash: 'h1', probe_id: 'p-1', target: 'sonnet' });
    appendFsynced(p, { _kind: 'screen',  round: 2, mutation_hash: 'h2', probe_id: 'p-2', target: 'gpt5_5' });

    const state = resumeState({ trajectoryPath: p });
    expect(state.lastRound).toBe(3);
  });

  it('collects pareto-update events', () => {
    const p = tmpFile();
    appendFsynced(p, { _kind: 'pareto-update', round: 1, front: ['T1-r0'] });
    appendFsynced(p, { _kind: 'mutation', round: 2, mutation_hash: 'h2' });
    appendFsynced(p, { _kind: 'pareto-update', round: 2, front: ['T1-r0', 'T2-r1'] });

    const state = resumeState({ trajectoryPath: p });
    expect(state.paretoUpdates).toHaveLength(2);
    expect(state.paretoUpdates[1].round).toBe(2);
  });

  it('groups mutations by round', () => {
    const p = tmpFile();
    appendFsynced(p, { _kind: 'mutation', round: 1, mutation_hash: 'ha', source_op: 'reflective' });
    appendFsynced(p, { _kind: 'mutation', round: 1, mutation_hash: 'hb', source_op: 'pruner' });
    appendFsynced(p, { _kind: 'mutation', round: 2, mutation_hash: 'hc', source_op: 'tool-mask' });

    const state = resumeState({ trajectoryPath: p });
    expect(state.mutationsByRound.get(1)).toHaveLength(2);
    expect(state.mutationsByRound.get(2)).toHaveLength(1);
  });

  it('completedStepIds contains all events written', () => {
    const p = tmpFile();
    const events = [
      { _kind: 'mutation', round: 1, mutation_hash: 'h1' },
      { _kind: 'screen',   round: 1, mutation_hash: 'h1', probe_id: 'p-1', target: 'sonnet' },
      { _kind: 'screen',   round: 1, mutation_hash: 'h1', probe_id: 'p-1', target: 'gpt5_5' },
    ];
    for (const ev of events) appendFsynced(p, ev);

    const state = resumeState({ trajectoryPath: p });
    for (const ev of events) {
      expect(state.completedStepIds.has(stepId(ev))).toBe(true);
    }
  });
});

// ─── kill-9 simulation ────────────────────────────────────────────────────────

describe('kill-9 crash recovery', () => {
  it('recovers N-1 events when the last line is truncated mid-write', () => {
    const p = tmpFile();
    const N = 7;
    const events = Array.from({ length: N }, (_, i) => ({
      _kind: 'screen',
      round: 1,
      mutation_hash: `h${i}`,
      probe_id: `p-${i.toString().padStart(3, '0')}`,
      target: i % 2 === 0 ? 'sonnet' : 'gpt5_5',
      score: 0.5 + i * 0.05,
    }));

    for (const ev of events) appendFsynced(p, ev);

    // Simulate kill -9: truncate halfway through the last line
    const full = readFileSync(p, 'utf8');
    const lines = full.split('\n').filter(Boolean);
    expect(lines).toHaveLength(N);

    // Reconstruct file with N-1 complete lines + partial last line
    const partial = lines[N - 1].slice(0, Math.floor(lines[N - 1].length / 2));
    const truncated = lines.slice(0, N - 1).join('\n') + '\n' + partial;
    writeFileSync(p, truncated, 'utf8');

    // Resume: should recover exactly N-1 events
    const loaded = loadTrajectory(p);
    expect(loaded).toHaveLength(N - 1);
    for (let i = 0; i < N - 1; i++) {
      expect(loaded[i]).toMatchObject(events[i]);
    }
  });

  it('resumeState after kill-9 gives correct lastRound and completedStepIds', () => {
    const p = tmpFile();
    const N = 5;
    for (let i = 0; i < N; i++) {
      appendFsynced(p, { _kind: 'mutation', round: i + 1, mutation_hash: `h${i}` });
    }

    // Simulate kill -9 *mid-write of the last line*. Truncating only the
    // trailing newline would leave valid JSON (and correctly recover all N),
    // so we must cut into the body of the last line to actually corrupt it.
    // Compute the byte offset of the last line's start, then truncate to a
    // point partway through it.
    const buf = readFileSync(p);
    const lastNl = buf.lastIndexOf(0x0a, buf.length - 2); // newline before the final line
    const lastLineStart = lastNl + 1;
    const lastLineLen = buf.length - 1 - lastLineStart; // exclude final '\n'
    truncateSync(p, lastLineStart + Math.floor(lastLineLen / 2));

    const state = resumeState({ trajectoryPath: p });
    // N-1 complete events recovered → lastRound = N-1
    expect(state.lastRound).toBe(N - 1);
    expect(state.completedStepIds.size).toBe(N - 1);
  });
});

// ─── path builders ────────────────────────────────────────────────────────────

describe('path builders', () => {
  it('trajectoryPath contains the runId', () => {
    expect(trajectoryPath('p7-v1')).toContain('p7-v1');
    expect(trajectoryPath('p7-v1')).toContain('gepa-trajectory.jsonl');
  });

  it('promptBankPath contains prompt-bank.jsonl', () => {
    expect(promptBankPath('p7-v1')).toContain('prompt-bank.jsonl');
  });

  it('paretoCurrentPath contains pareto-current.json', () => {
    expect(paretoCurrentPath('p7-v1')).toContain('pareto-current.json');
  });

  it('RESULTS_DIR contains results and runId', () => {
    const d = RESULTS_DIR('p7-v2');
    expect(d).toContain('results');
    expect(d).toContain('p7-v2');
  });
});
