/**
 * Unit tests for the Phase 7 T1–T15 seed-variant slate (§4.2, §4.3) and its
 * loader (`core/prompt-optimization/sweep/variant-loader.mjs`).
 *
 * Pure file-system reads + deterministic string checks — no network / no LLM.
 *
 * Coverage:
 *   - all 15 variants load with well-formed front-matter + body
 *   - front-matter passes the §4.3 schema (required keys, enums, positive tokens)
 *   - T12 is the grounding-free control; T7 + T12 are the only `none` variants
 *   - `none` variants embed NO verbatim §4.2 bullet; grounded variants embed ≥1
 *   - `full` variants embed the verbatim ss-trace bullet
 *   - the §3.2.3 stateful-summary rule appears in exactly T2/T8/T13/T14/T15,
 *     matching operators-opus's canonical STATEFUL_SUMMARY_RULE verbatim
 *   - T15 (and only T15) carries the Hypothesis-Driven `<failure_analysis>` block
 *   - every `[[token]]` is well-formed (known name, no inner whitespace)
 *   - body token estimates land within ±30% of target_tokens (§4.3)
 *   - loader primitives: parseFrontMatter / estimateTokens / extractTokens
 */

import { describe, it, expect } from 'vitest';

import {
  loadVariant,
  loadAllVariants,
  validateVariant,
  parseFrontMatter,
  estimateTokens,
  extractTokens,
  uniqueTokens,
  splitFrontMatter,
  VARIANT_IDS,
  VARIANTS_DIR,
  STRATEGIES,
  VERBOSITIES,
  GROUNDINGS,
} from '../../../core/prompt-optimization/sweep/variant-loader.mjs';

// Canonical §3.2.3 rule lives in operators-opus's files; op-pruner re-exports it.
import { STATEFUL_SUMMARY_RULE } from '../../../core/prompt-optimization/sweep/op-pruner.mjs';
// Shared mutation-rejection reason set (§3.2.1 / §7.4) — asserted below for M11.
import { MUTATION_REJECTION_REASONS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

// ─── verbatim §4.2 instruction_text fragments (pulled from recommendations-v2-*.json) ─

const SS_SEARCH_DEFAULT =
  'Use a medium declarative phrase (9-15 tokens) that includes the symbol verbatim and domain-specific terms.';
const SS_SEARCH_JSMOBILE = 'phrase a short interrogative query (4-8 tokens) that includes the symbol verbatim';
const SS_SEARCH_CFAMILY = 'Use a medium interrogative query (9-15 tokens) that includes the symbol verbatim.';
const SS_SEARCH_POPULAR = 'query with the symbol name only (≤ 3 tokens, imperative)';
const SS_FIND_SIMPLE = '[simple-global] For ss-find: build the regex as word-bounded literal:';
const SS_FIND_JSMOBILE = '[JS-mobile-override] For ss-find: build the regex as definition-anchored:';
const SS_FIND_POPULAR = '[popular-weighted (agentic-tier)] For ss-find: build the regex as small alternation:';
const SS_SEM_SIMPLE =
  'For ss-semantic (in-file span retrieval): phrase a very short imperative query consisting of the target symbol verbatim';
const SS_SEM_INTERROG =
  'For ss-semantic: phrase a short interrogative query (4-8 tokens) that contains the target symbol verbatim.';
// Common prefix shared by all three ss-trace strategy instruction_texts.
const SS_TRACE_PREFIX =
  '[[ss-trace]] is symbol-in / structural-context-out. Call when you already know the target symbol and want callers, callees, and impact paths in one response.';

/** Every distinctive verbatim §4.2 bullet fragment. */
const ALL_BULLETS = [
  SS_SEARCH_DEFAULT,
  SS_SEARCH_JSMOBILE,
  SS_SEARCH_CFAMILY,
  SS_SEARCH_POPULAR,
  SS_FIND_SIMPLE,
  SS_FIND_JSMOBILE,
  SS_FIND_POPULAR,
  SS_SEM_SIMPLE,
  SS_SEM_INTERROG,
  SS_TRACE_PREFIX,
];

const KNOWN_TOKEN_NAMES = new Set([
  'ss-search',
  'ss-find',
  'ss-semantic',
  'ss-trace',
  'ss-grep',
  'ss-read',
  'agent-format',
  'json',
  'regex',
  'expectedFiles',
  'expectedSymbols',
  'expectedFacts',
  'no-match',
]);

const STATE_SUMMARY_VARIANTS = ['T2', 'T8', 'T13', 'T14', 'T15'];

const variants = loadAllVariants();
const byId = new Map(variants.map((v) => [v.id, v]));

// ─── slate completeness ───────────────────────────────────────────────────────

describe('p7 variant slate — completeness', () => {
  it('loads all 15 variants in canonical T1..T15 order', () => {
    expect(variants).toHaveLength(15);
    expect(variants.map((v) => v.id)).toEqual(VARIANT_IDS);
  });

  it('has unique ids', () => {
    expect(new Set(variants.map((v) => v.id)).size).toBe(15);
  });

  it('every variant has a non-empty body and raw source', () => {
    for (const v of variants) {
      expect(v.body.trim().length, `${v.id} body`).toBeGreaterThan(0);
      expect(v.raw.startsWith('---\n'), `${v.id} raw`).toBe(true);
    }
  });

  it('loadVariant accepts id, filename, and path forms', () => {
    expect(loadVariant('T7').id).toBe('T7');
    expect(loadVariant('T7.md').id).toBe('T7');
    expect(loadVariant(byId.get('T7').path).id).toBe('T7');
  });
});

// ─── front-matter schema (§4.3) ───────────────────────────────────────────────

describe('p7 variant slate — front-matter schema', () => {
  it.each(VARIANT_IDS)('%s passes validateVariant', (id) => {
    const res = validateVariant(byId.get(id));
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('every variant declares valid enum values', () => {
    for (const v of variants) {
      const fm = v.frontMatter;
      expect(STRATEGIES, `${v.id} strategy`).toContain(fm.strategy);
      expect(VERBOSITIES, `${v.id} verbosity`).toContain(fm.verbosity);
      expect(GROUNDINGS, `${v.id} p6_grounding`).toContain(fm.p6_grounding);
      expect(Array.isArray(fm.special_handling), `${v.id} special_handling`).toBe(true);
      expect(fm.expected_strengths.length, `${v.id} strengths`).toBeGreaterThan(0);
      expect(fm.expected_weaknesses.length, `${v.id} weaknesses`).toBeGreaterThan(0);
    }
  });

  it('target_tokens is a positive integer matching front-matter', () => {
    for (const v of variants) {
      expect(Number.isInteger(v.targetTokens) && v.targetTokens > 0, `${v.id} target_tokens`).toBe(true);
    }
  });

  it('front-matter id matches the canonical T_n id', () => {
    for (const v of variants) expect(v.frontMatter.id).toBe(v.id);
  });

  it('rejects an invalid front-matter (enum + missing-key)', () => {
    const bad = validateVariant({ id: 'X1', strategy: 'nope', verbosity: 'loud' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });
});

// ─── grounding semantics (§4.1/§4.2/§4.3) ─────────────────────────────────────

describe('p7 variant slate — P6 grounding', () => {
  it('T12 is the grounding-free control', () => {
    const t12 = byId.get('T12');
    expect(t12.frontMatter.strategy).toBe('control');
    expect(t12.frontMatter.p6_grounding).toBe('none');
  });

  it('T7 and T12 are exactly the `none`-grounding variants', () => {
    const none = variants.filter((v) => v.frontMatter.p6_grounding === 'none').map((v) => v.id).sort();
    expect(none).toEqual(['T12', 'T7']);
  });

  it('`none` variants embed NO verbatim §4.2 bullet', () => {
    for (const v of variants) {
      if (v.frontMatter.p6_grounding !== 'none') continue;
      for (const bullet of ALL_BULLETS) {
        expect(v.body.includes(bullet), `${v.id} should NOT contain a §4.2 bullet`).toBe(false);
      }
    }
  });

  it('grounded variants embed ≥1 verbatim §4.2 bullet', () => {
    for (const v of variants) {
      if (v.frontMatter.p6_grounding === 'none') continue;
      const found = ALL_BULLETS.filter((b) => v.body.includes(b));
      expect(found.length, `${v.id} embeds a verbatim §4.2 bullet`).toBeGreaterThan(0);
    }
  });

  it('`full`-grounding variants embed the verbatim ss-trace bullet', () => {
    for (const v of variants) {
      if (v.frontMatter.p6_grounding !== 'full') continue;
      expect(v.body.includes(SS_TRACE_PREFIX), `${v.id} ss-trace verbatim`).toBe(true);
    }
  });

  it('the ss-search default bullet appears verbatim somewhere in the slate', () => {
    expect(variants.some((v) => v.body.includes(SS_SEARCH_DEFAULT))).toBe(true);
  });
});

// ─── §3.2.3 stateful-summary rule ─────────────────────────────────────────────

describe('p7 variant slate — §3.2.3 stateful-summary rule', () => {
  it('the canonical rule imports cleanly and is non-trivial', () => {
    expect(typeof STATEFUL_SUMMARY_RULE).toBe('string');
    expect(STATEFUL_SUMMARY_RULE.startsWith('Before your 3rd tool call')).toBe(true);
    expect(STATEFUL_SUMMARY_RULE).toContain('<state_summary>');
  });

  it('exactly T2/T8/T13/T14/T15 contain the rule, verbatim', () => {
    const withRule = variants.filter((v) => v.body.includes(STATEFUL_SUMMARY_RULE)).map((v) => v.id);
    expect(withRule.sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))).toEqual(STATE_SUMMARY_VARIANTS);
  });
});

// ─── T15 Hypothesis-Driven Backtracking (§4.3) ────────────────────────────────

describe('p7 variant slate — T15 hypothesis-driven backtracking', () => {
  it('T15 (and only T15) carries a <failure_analysis> block', () => {
    const withFA = variants.filter((v) => v.body.includes('<failure_analysis>')).map((v) => v.id);
    expect(withFA).toEqual(['T15']);
  });

  it('T15 also carries the §3.2.3 stateful-summary rule (all special handling)', () => {
    expect(byId.get('T15').body.includes(STATEFUL_SUMMARY_RULE)).toBe(true);
  });
});

// ─── protected tokens (§3.2.1) ────────────────────────────────────────────────

describe('p7 variant slate — protected [[tokens]]', () => {
  it('every variant references at least one protected token', () => {
    for (const v of variants) expect(v.protectedTokens.length, `${v.id}`).toBeGreaterThan(0);
  });

  it('every protected token is well-formed and a known name', () => {
    for (const v of variants) {
      for (const tok of v.protectedTokens) {
        expect(tok, `${v.id} token shape`).toMatch(/^\[\[[A-Za-z][A-Za-z0-9_-]*\]\]$/);
        const name = tok.slice(2, -2);
        expect(KNOWN_TOKEN_NAMES.has(name), `${v.id} unknown token ${tok}`).toBe(true);
      }
    }
  });

  it('no token carries inner whitespace in the raw body', () => {
    for (const v of variants) {
      expect(/\[\[\s|\s\]\]/.test(v.body), `${v.id} inner-whitespace token`).toBe(false);
    }
  });

  it('every variant routes through [[ss-search]]', () => {
    for (const v of variants) expect(v.body.includes('[[ss-search]]'), `${v.id}`).toBe(true);
  });
});

// ─── token budgets (§4.3 — ±30% of target_tokens) ─────────────────────────────

describe('p7 variant slate — token budgets', () => {
  it.each(VARIANT_IDS)('%s body lands within ±30%% of target_tokens', (id) => {
    const v = byId.get(id);
    const ratio = v.tokenEstimate / v.targetTokens;
    expect(ratio, `${id}: est=${v.tokenEstimate} target=${v.targetTokens} ratio=${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
    expect(ratio, `${id}: est=${v.tokenEstimate} target=${v.targetTokens} ratio=${ratio.toFixed(2)}`).toBeLessThanOrEqual(1.3);
  });
});

// ─── distinctiveness (§4.3 axes) ──────────────────────────────────────────────

describe('p7 variant slate — strategy/verbosity coverage', () => {
  it('covers every strategy and every verbosity at least once', () => {
    const strategies = new Set(variants.map((v) => v.frontMatter.strategy));
    const verbosities = new Set(variants.map((v) => v.frontMatter.verbosity));
    for (const s of STRATEGIES) expect(strategies.has(s), `strategy ${s}`).toBe(true);
    for (const vb of VERBOSITIES) expect(verbosities.has(vb), `verbosity ${vb}`).toBe(true);
  });

  it('every variant body is unique', () => {
    expect(new Set(variants.map((v) => v.body)).size).toBe(15);
  });
});

// ─── loader primitives ────────────────────────────────────────────────────────

describe('variant-loader — estimateTokens', () => {
  it('uses the ≈4-chars/token heuristic', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('')).toBe(0);
  });

  it('throws on non-string input', () => {
    expect(() => estimateTokens(42)).toThrow(TypeError);
  });
});

describe('variant-loader — extractTokens', () => {
  it('preserves multiplicity and document order', () => {
    expect(extractTokens('[[ss-search]] then [[ss-find]] then [[ss-search]]')).toEqual([
      '[[ss-search]]',
      '[[ss-find]]',
      '[[ss-search]]',
    ]);
  });

  it('normalises inner whitespace', () => {
    expect(extractTokens('[[ ss-find ]] and [[  ss-trace  ]]')).toEqual(['[[ss-find]]', '[[ss-trace]]']);
  });

  it('uniqueTokens collapses multiplicity, keeping first-seen order', () => {
    expect(uniqueTokens('[[ss-read]] [[ss-read]] [[ss-grep]]')).toEqual(['[[ss-read]]', '[[ss-grep]]']);
  });

  it('returns [] when there are no tokens', () => {
    expect(extractTokens('plain prose with no markers')).toEqual([]);
  });
});

describe('variant-loader — parseFrontMatter', () => {
  it('parses scalars, integers, quoted strings, and inline arrays', () => {
    const fm = parseFrontMatter(
      [
        'id: T9',
        'strategy: evidence-first',
        'target_tokens: 1100',
        'special_handling: []',
        'expected_strengths: [structured-citation, full-grounding]',
        'note: "a quoted: value"',
      ].join('\n'),
    );
    expect(fm.id).toBe('T9');
    expect(fm.strategy).toBe('evidence-first');
    expect(fm.target_tokens).toBe(1100);
    expect(fm.special_handling).toEqual([]);
    expect(fm.expected_strengths).toEqual(['structured-citation', 'full-grounding']);
    expect(fm.note).toBe('a quoted: value');
  });

  it('ignores blank lines and comments', () => {
    const fm = parseFrontMatter('\n# a comment\nid: T1\n\n');
    expect(fm).toEqual({ id: 'T1' });
  });
});

describe('variant-loader — splitFrontMatter', () => {
  it('splits the fenced front-matter from the body', () => {
    const { frontMatterBlock, body } = splitFrontMatter('---\nid: T1\n---\nhello [[ss-search]]\n');
    expect(frontMatterBlock).toBe('id: T1');
    expect(body).toBe('hello [[ss-search]]\n');
  });

  it('throws when the fences are missing', () => {
    expect(() => splitFrontMatter('no front matter here')).toThrow();
  });

  it('parses a CRLF file identically to LF (m10 regression)', () => {
    const crlf = '---\r\nid: T1\r\n---\r\nhello [[ss-search]]\r\n';
    const { frontMatterBlock, body } = splitFrontMatter(crlf);
    expect(frontMatterBlock).toBe('id: T1');
    expect(body).toBe('hello [[ss-search]]\n');
  });

  it('tolerates trailing whitespace on the `---` fence lines (m10 regression)', () => {
    const trailing = '---  \nid: T1\n---\t\nhello [[ss-search]]\n';
    const { frontMatterBlock, body } = splitFrontMatter(trailing);
    expect(frontMatterBlock).toBe('id: T1');
    expect(body).toBe('hello [[ss-search]]\n');
  });

  it('tolerates a body that does not end in a newline (m10 regression)', () => {
    const { frontMatterBlock, body } = splitFrontMatter('---\nid: T1\n---\nno trailing newline');
    expect(frontMatterBlock).toBe('id: T1');
    expect(body).toBe('no trailing newline');
  });

  it('handles an empty body after the closing fence', () => {
    const { frontMatterBlock, body } = splitFrontMatter('---\nid: T1\n---\n');
    expect(frontMatterBlock).toBe('id: T1');
    expect(body).toBe('');
  });
});

// ─── path sandboxing (m11) ────────────────────────────────────────────────────

describe('variant-loader — VARIANTS_DIR sandbox', () => {
  it('loads canonical ids and bare filenames inside the sandbox', () => {
    expect(loadVariant('T1').id).toBe('T1');
    expect(loadVariant('T1.md').id).toBe('T1');
  });

  it('rejects an absolute path OUTSIDE VARIANTS_DIR (m11 regression)', () => {
    expect(() => loadVariant('/etc/passwd')).toThrow(/sandbox|outside/i);
  });

  it('rejects an absolute `..`-traversal path that escapes the sandbox', () => {
    // `resolve` collapses the `..` segments; the resulting path lives outside
    // VARIANTS_DIR and must be refused before any filesystem read.
    expect(() => loadVariant(`${VARIANTS_DIR}/../../secret.md`)).toThrow(/sandbox|outside/i);
  });

  it('basename-strips a relative traversal so it stays inside the sandbox', () => {
    // A relative path's basename is resolved against VARIANTS_DIR, so it cannot
    // escape — it fails (if at all) only with a filesystem ENOENT, never a
    // sandbox-escape error.
    expect(() => loadVariant('../../../../etc/hosts.md')).not.toThrow(/sandbox|outside/i);
  });
});

// ─── shared mutation-rejection reasons (m6 / M11) ─────────────────────────────

describe('p7-shared — MUTATION_REJECTION_REASONS', () => {
  it('includes the OP-5 fenced-block-altered reason (M11 support)', () => {
    expect(MUTATION_REJECTION_REASONS).toContain('fenced-block-altered');
  });

  it("retains the reserved (never-emitted) 'whitespace-norm' reason (m6)", () => {
    expect(MUTATION_REJECTION_REASONS).toContain('whitespace-norm');
  });
});
