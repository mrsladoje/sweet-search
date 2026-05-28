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
 *   - consumer-clean contract: no body leaks optimizer-internal provenance
 *     (Phase-6 labels, recall metrics, "dev FAILs", tree-sitter, shape labels);
 *     capability-card framing (no persona) + native-tools boundary in all 15
 *   - grounded variants carry compiled query-shaping guidance; `full` variants
 *     encode the ss-trace symbol-not-query contract ("never an NL question")
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

// ─── consumer-clean contract ──────────────────────────────────────────────────
// The §4.2 findings are COMPILED into bare directives, not pasted verbatim. The
// recommendations-v2-*.json bullets carry optimizer-internal provenance (Phase-6
// labels, recall deltas, "dev FAILs", tree-sitter notes) that the consuming agent
// has no knowledge of and cannot act on — so the shipped variant bodies must be
// free of it. These constants encode that contract.

/** Optimizer-internal provenance that must NEVER reach a consumer-facing body. */
const PROVENANCE_PATTERNS = [
  /Phase ?6/i, // "Phase 6 data"
  /R@\d/, // recall@k metrics, e.g. "R@5=0.62"
  /recall ?@ ?\d/i, // spelled "recall@5"
  /recall ?at ?\d/i, // spelled "recall at 5"
  /\d+ ?pp\b/, // percentage-point deltas, e.g. "18-29 pp"
  /percentage points?/i, // spelled-out deltas
  /dev FAILs?/i, // "4 of 7 dev FAILs"
  /agentic-tier/i, // optimization weighting, e.g. "2026 agentic-tier weights"
  /tree-sitter/i, // parser implementation detail
  /\bIoU\b/, // span-overlap metric
  /symbol_recall/i, // metric name
  /graphNeighbors/i, // gold-construction internal
  /recommendations-v2/i, // source-artifact filename
  /\bwinners?\b/i, // "V7/V4 winners", "the winner"
  /\bbenchmark/i, // benchmarking vocabulary
  /\bV\d+\b/, // internal shape labels V1..V7 (and V10+)
  /\d+ indexed languages/i, // corpus-size brag
];

/** Persona framing we rejected in favour of a capability card (§4.3 review). */
const PERSONA_OPENING = 'You are the sweet-search agent';
/** Capability-card header fragment every variant must use. */
const CAPABILITY_HEADER = 'code search tool';
/** The native-tools boundary every variant must establish. */
const NATIVE_TOOLS_BOUNDARY = 'raw grep/ripgrep';
/** Native-tools fallback clause — every body (incl. the T12 control) carries it (§4.5). */
const FALLBACK_PHRASE = 'Fall back to plain grep';
/** Compiled ss-trace symbol-not-query contract (replaces the old verbatim bullet).
 *  Phrasing varies across variants ("never an NL question" / "NEVER call [[ss-trace]]
 *  with an NL question"); the invariant is that the NL-question prohibition is stated. */
const SS_TRACE_CONTRACT = /\bNL question\b/i;
/** Compiled ss-trace Python weak-spot compensation directive. */
const SS_TRACE_PY_RULE = 'prefer callers/callees over impact';
/** Shell-wrapper call syntax every body must teach so agents invoke the CLI
 *  shims (eval/agent-read-workflows/bin/) instead of hunting for a literal tool
 *  named [[ss-find]]. §4.5 wrapper-syntax contract. */
const WRAPPER_SNIPPETS = [
  'ss-search "<query>"',
  'ss-find "<query>" --regex "<regex>"',
  'ss-semantic <file> "<query>"',
  'ss-trace <symbol>',
  'ss-grep "<regex>"',
  'ss-read <file>',
];
/** Hard tool-call counters replaced by sufficiency-based stopping (§4.5). */
const HARD_CAP_PATTERNS = [
  /cap at \d/i,
  /after two attempts/i,
  /do not continue/i,
  /at most \d+ hops/i,
  /two failed attempts/i,
];

const KNOWN_TOKEN_NAMES = new Set([
  'ss-search',
  'ss-find',
  'ss-semantic',
  'ss-trace',
  'ss-grep',
  'ss-read',
  'json',
  'regex',
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

// ─── consumer-clean contract (§4.3 review — no provenance, capability card) ────

describe('p7 variant slate — consumer-clean contract', () => {
  it('T12 is the grounding-free control', () => {
    const t12 = byId.get('T12');
    expect(t12.frontMatter.strategy).toBe('control');
    expect(t12.frontMatter.p6_grounding).toBe('none');
  });

  it('T7 and T12 are exactly the `none`-grounding variants', () => {
    const none = variants.filter((v) => v.frontMatter.p6_grounding === 'none').map((v) => v.id).sort();
    expect(none).toEqual(['T12', 'T7']);
  });

  it('no variant body leaks optimizer-internal provenance', () => {
    for (const v of variants) {
      for (const re of PROVENANCE_PATTERNS) {
        expect(re.test(v.body), `${v.id} leaks provenance ${re}`).toBe(false);
      }
    }
  });

  it('no variant uses the rejected persona opening', () => {
    for (const v of variants) {
      expect(v.body.includes(PERSONA_OPENING), `${v.id} persona opening`).toBe(false);
    }
  });

  it('every variant uses the capability-card framing', () => {
    for (const v of variants) {
      expect(v.body.includes(CAPABILITY_HEADER), `${v.id} capability-card header`).toBe(true);
    }
  });

  it('every variant establishes the native-tools boundary', () => {
    for (const v of variants) {
      expect(v.body.includes(NATIVE_TOOLS_BOUNDARY), `${v.id} native-tools boundary`).toBe(true);
    }
  });

  it('grounded variants carry compiled query-shaping guidance', () => {
    for (const v of variants) {
      if (v.frontMatter.p6_grounding === 'none') continue;
      expect(
        /symbol verbatim|word-bounded|declarative|interrogative/.test(v.body),
        `${v.id} compiled shaping guidance`,
      ).toBe(true);
    }
  });

  it('`none` variants carry no family-conditioning', () => {
    for (const v of variants) {
      if (v.frontMatter.p6_grounding !== 'none') continue;
      expect(/C-family|JS-mobile/.test(v.body), `${v.id} should be family-free`).toBe(false);
    }
  });

  it('`full`-grounding variants encode the ss-trace symbol-not-query contract', () => {
    for (const v of variants) {
      if (v.frontMatter.p6_grounding !== 'full') continue;
      expect(SS_TRACE_CONTRACT.test(v.body), `${v.id} ss-trace contract`).toBe(true);
    }
  });

  it('the compiled ss-trace Python weak-spot directive appears in the slate', () => {
    expect(variants.some((v) => v.body.includes(SS_TRACE_PY_RULE))).toBe(true);
  });

  it('every body teaches the shell-wrapper call syntax for all six tools', () => {
    for (const v of variants) {
      for (const s of WRAPPER_SNIPPETS) {
        expect(v.body.includes(s), `${v.id} missing wrapper syntax: ${s}`).toBe(true);
      }
    }
  });

  it('no body imposes a hard tool-call / hop counter', () => {
    for (const v of variants) {
      for (const re of HARD_CAP_PATTERNS) {
        expect(re.test(v.body), `${v.id} has a hard cap ${re}`).toBe(false);
      }
    }
  });

  it('every body (incl. the T12 control) carries the native-tools fallback clause', () => {
    for (const v of variants) {
      expect(v.body.includes(FALLBACK_PHRASE), `${v.id} missing fallback clause`).toBe(true);
    }
  });

  it('family-conditioned variants handle an unknown symbol/file (→ default shaping)', () => {
    for (const v of variants) {
      if (!v.body.includes('C-family')) continue;
      expect(v.body.includes('lead with domain terms'), `${v.id} missing unknown-hint fallback`).toBe(true);
    }
  });

  it('no-match variants give no-symbol (conceptual) negative guidance', () => {
    for (const v of variants) {
      const sh = v.frontMatter.special_handling;
      if (!(Array.isArray(sh) && sh.includes('no-match'))) continue;
      expect(v.body.includes('no obvious symbol'), `${v.id} missing no-symbol no-match guidance`).toBe(true);
    }
  });
});

// ─── §3.2.3 stateful-summary rule ─────────────────────────────────────────────

describe('p7 variant slate — §3.2.3 stateful-summary rule', () => {
  it('the canonical rule imports cleanly and is non-trivial', () => {
    expect(typeof STATEFUL_SUMMARY_RULE).toBe('string');
    expect(STATEFUL_SUMMARY_RULE.startsWith('Before your third sweet-search query')).toBe(true);
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

  it('no body references gold-schema or the undefined agent-format token (§4.5 item 6)', () => {
    // expectedFiles/Symbols/Facts are the probe GOLD field names + the judge's
    // reward rubric (coaching them couples the optimization to the grader — the
    // output-layer analog of §5.7 query-shape overfit). [[agent-format]] is an
    // undefined label (no glossary ships) that adds no actionable signal. The
    // answer contract is worded in plain consumer language instead, so none of
    // these tokens may appear in a body.
    for (const v of variants) {
      expect(/\[\[(expectedFiles|expectedSymbols|expectedFacts|agent-format)\]\]/.test(v.body), `${v.id} references a removed token`).toBe(false);
    }
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
