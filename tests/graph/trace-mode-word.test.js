// The p7 guide has taught `ss-trace <symbol> [callers|callees|impact]` since it shipped,
// but the wrapper read only the first positional, so `ss-trace foo callers` ran as an
// un-moded trace: the agent asked for one relationship and silently received the whole
// thing, target body included. 27 pooled operations used the form.
//
// The guidance block is owner-protected, so the mode word is implemented rather than
// removed from the guide.
import { describe, it, expect } from 'vitest';
import { formatStructuralContext, TRACE_MODES } from '../../core/graph/structural-context-format.js';

const result = () => ({
  format: 'structural_context', tool: 'trace', symbol: 'processOrder',
  target: {
    name: 'processOrder', type: 'function', filePath: 'src/orders.js',
    startLine: 10, endLine: 40, fanIn: 2, fanOut: 3,
    code: 'function processOrder() { /* TARGET BODY */ }',
    headerContext: "import { db } from './db';",
    callsiteHints: ['processOrder(order)'],
  },
  disambiguation: [], budgetTier: 'standard', budgetReason: 'default',
  tokenBudget: 8000, tokensUsed: 900, maxDepth: 3,
  stats: { totalEntities: 100, callers: 1, callees: 1, impactPaths: 1, entropy: 0, latencyMs: 4 },
  sections: {
    callers: {
      total: 1, shown: 1,
      items: [{ name: 'CALLER_ONE', type: 'function', importance: 0.9, summary: 'calls it', code: 'CALLER_BODY' }],
      provenance: { stored: 1, sameFileFallback: 0 },
    },
    callees: {
      total: 1, shown: 1,
      items: [{ name: 'CALLEE_ONE', type: 'function', importance: 0.5, summary: 'is called', code: 'CALLEE_BODY' }],
    },
    impact: { total: 1, shown: 1, paths: [{ path: 'IMPACT_PATH_ONE', direction: 'upstream', depth: 2, edgeTypes: ['calls'], importance: 0.3 }] },
  },
});

describe('ss-trace mode word', () => {
  it('exposes exactly the three modes the guide teaches', () => {
    expect(TRACE_MODES).toEqual(['callers', 'callees', 'impact']);
  });

  it('with no mode, renders every section (unchanged behaviour)', () => {
    const out = formatStructuralContext(result());
    for (const marker of ['## callers', '## callees', '## impact paths', 'TARGET BODY', 'CALLER_ONE', 'CALLEE_ONE', 'IMPACT_PATH_ONE']) {
      expect(out, marker).toContain(marker);
    }
    expect(out).not.toContain('mode=');
  });

  it('callers shows ONLY callers', () => {
    const out = formatStructuralContext(result(), { mode: 'callers' });
    expect(out).toContain('## callers (1)');
    expect(out).toContain('CALLER_ONE');
    expect(out).not.toContain('## callees');
    expect(out).not.toContain('CALLEE_ONE');
    expect(out).not.toContain('## impact paths');
    expect(out).not.toContain('IMPACT_PATH_ONE');
  });

  it('callees shows ONLY callees', () => {
    const out = formatStructuralContext(result(), { mode: 'callees' });
    expect(out).toContain('## callees (1)');
    expect(out).toContain('CALLEE_ONE');
    expect(out).not.toContain('## callers');
    expect(out).not.toContain('CALLER_ONE');
    expect(out).not.toContain('IMPACT_PATH_ONE');
  });

  it('impact shows ONLY impact paths', () => {
    const out = formatStructuralContext(result(), { mode: 'impact' });
    expect(out).toContain('## impact paths (1');
    expect(out).toContain('IMPACT_PATH_ONE');
    expect(out).not.toContain('## callers');
    expect(out).not.toContain('## callees');
  });

  it('a restricted trace leaves out the target body, which is the largest block', () => {
    // Asking for one relationship is asking about a relationship, not about the symbol's
    // own source. Keeping the body would make the mode word nearly free of effect.
    for (const mode of TRACE_MODES) {
      const out = formatStructuralContext(result(), { mode });
      expect(out, mode).not.toContain('TARGET BODY');
      expect(out, mode).not.toContain('## target imports');
      expect(out, mode).toBeTruthy();
      // ...but it always says WHICH symbol was resolved. An agent that cannot see that
      // cannot trust anything below it.
      expect(out, mode).toContain('# trace processOrder [function] src/orders.js:10-40');
      expect(out, mode).toContain(`mode=${mode}`);
    }
  });

  it('a restricted trace is strictly shorter than the full one', () => {
    const full = formatStructuralContext(result()).length;
    for (const mode of TRACE_MODES) {
      expect(formatStructuralContext(result(), { mode }).length, mode).toBeLessThan(full);
    }
  });

  it('an unknown or absent mode falls back to the full render, never to an empty one', () => {
    for (const bad of ['bogus', '', null, undefined, 'CALLERS ']) {
      const out = formatStructuralContext(result(), { mode: bad });
      expect(out, JSON.stringify(bad)).toContain('## callers');
      expect(out, JSON.stringify(bad)).toContain('## impact paths');
    }
  });

  it('a symbol that resolves to nothing still answers the same way in every mode', () => {
    const missing = { symbol: 'nope', target: null };
    for (const mode of [null, ...TRACE_MODES]) {
      expect(formatStructuralContext(missing, { mode })).toBe('No indexed symbol found for "nope".');
    }
  });
});
