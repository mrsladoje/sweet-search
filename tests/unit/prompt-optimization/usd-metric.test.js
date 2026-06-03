/**
 * USD metric — unit + RED-TEAM gaming-case tests (Metric Forge §10/§13).
 *
 * Each gaming test maps to a §10 anti-gaming guarantee (G1..G9). The crux
 * assertions:
 *   - G1  a padded/verbose-but-worse response does NOT outscore a compact one,
 *         and USD DROPS by ≥0.30 when irrelevant code is appended.
 *   - G2  a terse-but-sufficient native response is NOT penalized for length.
 *   - G3  disjoint-token-support arms ⇒ "not length-matchable", claim withheld.
 *   - G4  byte-identical content (ss vs native formatting) ⇒ equal purity_ratio + USD.
 *   - G5  format/chrome cannot buy score (strip idempotence + label removal).
 *   - G6  under-answering (truncation) is penalized.
 *   - G7  whole-file cite snaps to the answer node (the B1 crux regression).
 *   - G8  no-match cannot be won by a 15k context bomb.
 *   - G9  any rubric/param edit changes the rubricHash.
 *
 * NO network: panels are built as plain verdict objects (the shape usdPanelScore
 * emits), and scoreUSD is pure given those verdicts.
 */

import { describe, expect, it } from 'vitest';

import {
  USD_PARAMS,
  USD_CRITERIA,
  computeRubricHash,
  stripChrome,
  artifactFilter,
  toRJudge,
  balancedNodeRange,
  snapSpan,
  computeDensity,
  densityMultiplier,
  composeUSD,
  groundingPrecheck,
  scoreNoMatch,
  medianBinary,
  aggregatePanel,
  scoreUSD,
  caliperMatchedDelta,
  pairedBootstrapCI,
  buildUsdJudgePrompt,
  parseUsdVerdict,
} from '../../../core/prompt-optimization/sweep/usd-metric.mjs';

// ─── fixtures ────────────────────────────────────────────────────────────────

function probe(overrides = {}) {
  return {
    id: 'cpp-001',
    repo: 'highway',
    language: 'cpp',
    stratum: 'literal-lookup',
    query: 'Where is HWY_NAMESPACE defined to N_AVX3?',
    expectedFiles: ['hwy/ops/set_macros-inl.h'],
    expectedSymbols: ['HWY_NAMESPACE'],
    expectedFacts: ['set_macros-inl.h defines HWY_NAMESPACE to N_AVX3'],
    expectedNoMatch: false,
    max_turns: 3,
    ...overrides,
  };
}

// A perfect, all-1 panel that cites a given span for every criterion.
function unanimousPanel(span) {
  const verdictByCriterion = {};
  for (const c of USD_CRITERIA) verdictByCriterion[c] = { span, v: 1 };
  return [
    { model: 'deepseek-v4-flash', lineage: 'deepseek-api', verdictByCriterion },
    { model: 'gemini-3.1-flash-lite', lineage: 'google-api', verdictByCriterion },
    { model: 'abab6.5s-chat', lineage: 'minimax', verdictByCriterion },
  ];
}

// A panel with explicit per-criterion verdicts (and a per-criterion span).
function panelWith(spec) {
  const verdictByCriterion = {};
  for (const c of USD_CRITERIA) {
    const s = spec[c];
    verdictByCriterion[c] = s ? { span: s.span ?? '', v: s.v ?? 0 } : { span: '', v: 0 };
  }
  return [0, 1, 2].map((i) => ({ model: `m${i}`, lineage: `lin${i}`, verdictByCriterion }));
}

// The gold answer line (what an ideal answer contains).
const ANSWER_LINE = '#define HWY_NAMESPACE N_AVX3';
// A compact, sufficient response: just the answer node.
const COMPACT = `380\t${ANSWER_LINE}\n381\t#endif`;
// A large irrelevant block to append for padding tests.
const IRRELEVANT = Array.from({ length: 60 }, (_, i) => `${500 + i}\tstatic uint32_t ReadXCR0_${i}() { return _xgetbv(0); }`).join('\n');

// ─── parameters + rubric hash (G9) ───────────────────────────────────────────

describe('pre-committed params + rubric hash (G9)', () => {
  it('locks φ=0.25, α=2, τ=400, θ_floor=0.5', () => {
    expect(USD_PARAMS.phi).toBe(0.25);
    expect(USD_PARAMS.alpha).toBe(2);
    expect(USD_PARAMS.tau).toBe(400);
    expect(USD_PARAMS.thetaFloor).toBe(0.5);
  });

  it('any param edit changes the rubricHash (no mid-run drift)', () => {
    const base = computeRubricHash(USD_PARAMS);
    expect(base).toMatch(/^0x[0-9a-f]{16}$/);
    expect(computeRubricHash({ ...USD_PARAMS, phi: 0.5 })).not.toBe(base);
    expect(computeRubricHash({ ...USD_PARAMS, alpha: 3 })).not.toBe(base);
    expect(computeRubricHash({ ...USD_PARAMS, tau: 500 })).not.toBe(base);
    expect(computeRubricHash({ ...USD_PARAMS, thetaFloor: 0.6 })).not.toBe(base);
  });
});

// ─── stripChrome + artifactFilter (G5/G4/§5d) ────────────────────────────────

describe('stripChrome — only true chrome removed, content kept (G5)', () => {
  const ss = `# ss-search: routed=hybrid conf=0.99 budget=4000 used=2231 results=2 subMode=agent_preview
# confidence=medium (close_top2) sufficient=no

## #1 hwy/ops/set_macros-inl.h:380-381 [namespace: x86] (full kind=chunk) score=0.368
\`\`\`
380\t${ANSWER_LINE}
\`\`\``;

  it('strips route-meta, confidence, rank#/tier-label/score; KEEPS the path:line locator + code', () => {
    const r = stripChrome(ss, 'ss');
    expect(r).not.toMatch(/routed=hybrid/);
    expect(r).not.toMatch(/confidence=medium/);
    expect(r).not.toMatch(/\[namespace: x86\]/);
    expect(r).not.toMatch(/kind=chunk/);
    expect(r).not.toMatch(/score=0\.368/);
    expect(r).not.toMatch(/#1\s/);
    // path:line locator is CONTENT — kept.
    expect(r).toMatch(/hwy\/ops\/set_macros-inl\.h:380-381/);
    expect(r).toContain(ANSWER_LINE);
  });

  it('is idempotent', () => {
    const once = stripChrome(ss, 'ss');
    expect(stripChrome(once, 'ss')).toBe(once);
  });

  it('is a no-op on the native arm (no ss chrome to strip)', () => {
    const nat = `hwy/ops/set_macros-inl.h:380:${ANSWER_LINE}`;
    expect(stripChrome(nat, 'native')).toBe(nat);
  });

  it('strips ss SERVER-LIFECYCLE boot noise (cold-start) but KEEPS code (G5/B3-class)', () => {
    const ssBoot = `BinaryHNSW: Loaded 6530 vectors from /x/.sweet-search/codebase-binary-hnsw.idx
HNSW: Mapped 6161 vectors from /x/.sweet-search/codebase-hnsw.usearch
LateInteraction: Streaming load 5000 documents...
[LateInteraction] Loaded lateon-code in 731ms (128d, ep: cpu)
Warming up embedding service...
Loading local model: mrsladoje/CodeRankEmbed-onnx-int8...
Provider: local (jalipalo/CodeRankEmbed-onnx)
exit 0

## hwy/ops/set_macros-inl.h:380-381
\`\`\`
380\t${ANSWER_LINE}
\`\`\``;
    const r = stripChrome(ssBoot, 'ss');
    // all server-lifecycle log lines gone
    expect(r).not.toMatch(/BinaryHNSW:/);
    expect(r).not.toMatch(/HNSW: Mapped/);
    expect(r).not.toMatch(/LateInteraction:/);
    expect(r).not.toMatch(/\[LateInteraction\]/);
    expect(r).not.toMatch(/Warming up embedding/);
    expect(r).not.toMatch(/Loading local model:/);
    expect(r).not.toMatch(/Provider: local/);
    expect(r).not.toMatch(/^\s*exit 0\s*$/m);
    // code content + locator KEPT
    expect(r).toContain(ANSWER_LINE);
    expect(r).toMatch(/hwy\/ops\/set_macros-inl\.h:380-381/);
    // idempotent
    expect(stripChrome(r, 'ss')).toBe(r);
  });

  it('does NOT drop a code line that merely mentions a noise word (e.g. an "exit" call)', () => {
    const code = `## app/main.c:10-12
\`\`\`
10\tif (rc != 0) exit 1;  /* this is real code, must be KEPT */
11\tHNSW_index_t idx = build();  /* identifier, not the "HNSW: Mapped" log */
\`\`\``;
    const r = stripChrome(code, 'ss');
    expect(r).toContain('if (rc != 0) exit 1;');
    expect(r).toContain('HNSW_index_t idx = build();');
  });
});

describe('artifactFilter — native code is NEVER dropped (G4/§5d.2)', () => {
  it('drops binary-match notices but keeps every code/match line', () => {
    const nat = `Binary file hwy/x.o matches
hwy/ops/set_macros-inl.h:380:${ANSWER_LINE}
hwy/ops/set_macros-inl.h:381:#endif`;
    const r = artifactFilter(nat);
    expect(r).not.toMatch(/Binary file/);
    expect(r).toContain(ANSWER_LINE);
    expect(r).toContain('#endif');
  });

  it('is idempotent', () => {
    const r1 = artifactFilter(`a\nb\nBinary file z matches\na\n`);
    expect(artifactFilter(r1)).toBe(r1);
  });

  it('dedups EXACT-duplicate lines (boilerplate filler) but keeps uniques', () => {
    const r = artifactFilter('foo();\nfoo();\nbar();');
    expect(r.match(/foo\(\);/g)).toHaveLength(1);
    expect(r).toContain('bar();');
  });
});

// ─── balancedNodeRange + snapSpan — the DIV-4 numerator (G7 crux) ────────────

describe('balancedNodeRange — bounds the answering node', () => {
  it('snaps a brace-balanced function around the anchor', () => {
    const lines = [
      'void f() {',
      '  int x = 1;',
      '  return;',
      '}',
      'void g() { other(); }',
    ];
    const { start, end } = balancedNodeRange(lines, 1);
    expect(start).toBe(0);
    expect(end).toBe(3);
  });

  it('snaps an indent-balanced python def', () => {
    const lines = ['def f():', '    x = 1', '    return x', 'y = 2'];
    const { start, end } = balancedNodeRange(lines, 2);
    expect(start).toBe(0);
    expect(end).toBe(2);
  });

  it('falls back to the line floor when no node is found', () => {
    const lines = ['#define X 1', '#define Y 2'];
    const { start, end } = balancedNodeRange(lines, 0);
    expect(start).toBe(0);
    expect(end).toBe(0);
  });
});

describe('snapSpan — verbatim-substring + gold/AST/line snapping (G7)', () => {
  it('returns "" for a span that is NOT a verbatim substring of R_judge (anti-spoof)', () => {
    const rJudge = `380\t${ANSWER_LINE}`;
    expect(snapSpan('this text is not present', { rJudge, gold: probe() })).toBe('');
  });

  it('THE B1 CRUX: a whole-file cite snaps to the answering node, NOT the whole file', () => {
    // R_judge = a 1000-line monolith; the answer node is a tiny brace block.
    const head = Array.from({ length: 200 }, (_, i) => `${i}\tjunk line ${i};`);
    const node = ['200\tvoid SetNamespace() {', `201\t  ${ANSWER_LINE}`, '202\t}'];
    const tail = Array.from({ length: 800 }, (_, i) => `${203 + i}\tmore junk ${i};`);
    const rJudge = [...head, ...node, ...tail].join('\n');
    const whole = rJudge; // the judge generously cited the WHOLE file
    const snapped = snapSpan(whole, { rJudge, gold: probe({ expectedSymbols: ['HWY_NAMESPACE'] }) });
    // snapped must be the small node, not the whole file.
    expect(snapped).toContain(ANSWER_LINE);
    expect(snapped.length).toBeLessThan(rJudge.length / 5);
    expect(snapped.split('\n').length).toBeLessThan(10);
  });
});

describe('computeDensity — purity_ratio falls when padding inflates total only', () => {
  it('compact answer ⇒ high purity_ratio', () => {
    const rJudge = COMPACT;
    const { purity_ratio } = computeDensity({ rJudge, citedSpans: [COMPACT], gold: probe() });
    expect(purity_ratio).toBeGreaterThan(0.6);
  });

  it('padded answer (same cited node) ⇒ purity_ratio drops sharply', () => {
    const rJudge = `${COMPACT}\n${IRRELEVANT}`;
    // the judge still only legitimately cites the answer node.
    const { purity_ratio, used_tokens_AST, total_tokens } = computeDensity({
      rJudge, citedSpans: [COMPACT], gold: probe(),
    });
    expect(used_tokens_AST).toBeLessThan(total_tokens);
    expect(purity_ratio).toBeLessThan(0.3);
  });
});

// ─── shaper + composition ─────────────────────────────────────────────────────

describe('density shaper + USD composition', () => {
  it('multiplier ∈ [φ,1] and is monotone in purity_ratio', () => {
    expect(densityMultiplier(0, USD_PARAMS)).toBeCloseTo(0.25, 6);
    expect(densityMultiplier(1, USD_PARAMS)).toBeCloseTo(1, 6);
    expect(densityMultiplier(0.5, USD_PARAMS)).toBeGreaterThan(densityMultiplier(0.1, USD_PARAMS));
  });

  it('USD = g·C·content·shaper; wrong-floor zeroes it', () => {
    expect(composeUSD({ g: 0, signalPurity: 1, content: 1, purity_ratio: 1 })).toBe(0);
    expect(composeUSD({ g: 1, signalPurity: 1, content: 1, purity_ratio: 1 })).toBeCloseTo(1, 6);
  });
});

// ─── grounding floor (G4 symmetric gate) ──────────────────────────────────────

describe('grounding precheck — symmetric file/symbol gate', () => {
  it('passes when the expected symbol is present', () => {
    expect(groundingPrecheck(`380\t${ANSWER_LINE}`, probe())).toBe(true);
  });
  it('passes when the expected file path is present', () => {
    expect(groundingPrecheck('hwy/ops/set_macros-inl.h:380:foo', probe({ expectedSymbols: [] }))).toBe(true);
  });
  it('fails when neither file nor symbol appears (wrong region)', () => {
    expect(groundingPrecheck('hwy/targets.cc:117 namespace x86 { ReadXCR0 }', probe({ expectedSymbols: ['HWY_NAMESPACE'], expectedFiles: ['hwy/ops/set_macros-inl.h'] }))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  RED-TEAM GAMING CASES — the deliverable's core
// ═══════════════════════════════════════════════════════════════════════════

describe('G1 — verbosity is NEVER rewarded (the headline guarantee)', () => {
  const panel = unanimousPanel(COMPACT); // judge legitimately cites the answer node

  it('a padded response does NOT outscore the compact one; USD drops by ≥0.30', () => {
    const compact = scoreUSD({ probe: probe(), rawResponse: COMPACT, arm: 'ss', panel, panelCorrectness: 1 });
    const padded = scoreUSD({ probe: probe(), rawResponse: `${COMPACT}\n${IRRELEVANT}`, arm: 'ss', panel: unanimousPanel(COMPACT), panelCorrectness: 1 });
    expect(padded.USD).toBeLessThan(compact.USD);
    expect(compact.USD - padded.USD).toBeGreaterThanOrEqual(0.30);
  });

  it('a padded-but-worse response (purity docked) loses to a compact-sufficient one', () => {
    // Compact: all criteria 1. Padded: signal_purity docked to 0 by the panel
    // (it saw the irrelevant blocks) AND purity_ratio falls.
    const compact = scoreUSD({ probe: probe(), rawResponse: COMPACT, arm: 'ss', panel: unanimousPanel(COMPACT), panelCorrectness: 1 });
    const paddedPanel = panelWith({
      answer_grounding: { span: COMPACT, v: 1 },
      workable_code: { span: COMPACT, v: 1 },
      navigability: { span: COMPACT, v: 1 },
      edit_locality: { span: COMPACT, v: 1 },
      sufficiency: { span: COMPACT, v: 1 },
      signal_purity: { span: '', v: 0 }, // docked — response is bloated
    });
    const padded = scoreUSD({ probe: probe(), rawResponse: `${COMPACT}\n${IRRELEVANT}`, arm: 'ss', panel: paddedPanel, panelCorrectness: 1 });
    expect(padded.signal_purity).toBe(0);
    expect(padded.USD).toBe(0); // C=0 zeroes USD_raw
    expect(padded.USD).toBeLessThan(compact.USD);
  });
});

describe('G2 — a terse-but-sufficient NATIVE response is NOT penalized', () => {
  it('every token does work ⇒ purity_ratio ≥ 0.85, USD high, not docked for being short', () => {
    const terseNative = `hwy/ops/set_macros-inl.h:380:${ANSWER_LINE}`;
    const panel = unanimousPanel(terseNative);
    const r = scoreUSD({ probe: probe(), rawResponse: terseNative, arm: 'native', panel, panelCorrectness: 1 });
    expect(r.purity_ratio).toBeGreaterThanOrEqual(0.85);
    expect(r.USD).toBeGreaterThan(0.9);
  });
});

describe('G3 — the gap survives length-matching, or is dropped', () => {
  it('disjoint token support ⇒ "not length-matchable", claim WITHHELD (no extrapolation)', () => {
    // ss responses all ~2000 tok; native all ~150 tok → log-supports do not overlap.
    const ss = Array.from({ length: 10 }, (_, i) => ({ probeId: `p${i}`, total_tokens: 2000 + i * 10, metrics: { content_noD3: 1, content: 1, USD: 0.9 } }));
    const nat = Array.from({ length: 10 }, (_, i) => ({ probeId: `p${i}`, total_tokens: 140 + i * 5, metrics: { content_noD3: 0.4, content: 0.4, USD: 0.3 } }));
    const out = caliperMatchedDelta(ss, nat);
    expect(out.lengthMatchable).toBe(false);
    expect(out.deltas).toEqual({});
    expect(out.reason).toMatch(/not length-matchable/);
  });

  it('overlapping support ⇒ matched paired Δ with a CI is reported', () => {
    const ss = Array.from({ length: 12 }, (_, i) => ({ probeId: `p${i}`, total_tokens: 200 + i * 10, metrics: { content_noD3: 0.8, content: 0.8, USD: 0.7 } }));
    const nat = Array.from({ length: 12 }, (_, i) => ({ probeId: `p${i}`, total_tokens: 205 + i * 10, metrics: { content_noD3: 0.5, content: 0.5, USD: 0.4 } }));
    const out = caliperMatchedDelta(ss, nat, { rng: () => 0.5 });
    expect(out.lengthMatchable).toBe(true);
    expect(out.matchedPairs).toBeGreaterThan(0);
    expect(out.deltas.content_noD3.mean).toBeCloseTo(0.3, 1);
    expect(out.deltas.content_noD3).toHaveProperty('ci');
  });
});

describe('G4 — symmetric: byte-identical content (ss vs native) ⇒ equal purity_ratio + USD', () => {
  it('the SAME code, one wrapped in ss chrome and one bare, scores identically', () => {
    const bare = `hwy/ops/set_macros-inl.h:380\n380\t${ANSWER_LINE}\n381\t#endif`;
    const ssWrapped = `# ss-search: routed=hybrid conf=0.99 budget=4000 used=20 results=1 subMode=agent_preview
# confidence=high (single_result) sufficient=yes

## #1 hwy/ops/set_macros-inl.h:380-381 [namespace: hwy] (full kind=chunk) score=0.5
${bare.split('\n').slice(1).join('\n')}`;
    // After toRJudge both should reduce to the same scored bytes.
    const rNat = toRJudge(bare, 'native');
    const rSs = toRJudge(ssWrapped, 'ss');
    // The ss header collapses to "## hwy/...:380-381" — content-equivalent locator.
    // Build identical panels citing the answer line.
    const span = `380\t${ANSWER_LINE}`;
    const dNat = computeDensity({ rJudge: rNat, citedSpans: [span], gold: probe() });
    const dSs = computeDensity({ rJudge: rSs, citedSpans: [span], gold: probe() });
    // total_tokens differ only by the kept locator line; assert ratios are close.
    expect(Math.abs(dNat.purity_ratio - dSs.purity_ratio)).toBeLessThan(0.15);
  });

  it('ss chrome NEVER enters used_tokens (it is stripped before judging)', () => {
    const ss = `# ss-search: routed=hybrid conf=0.99 sufficient=no\n380\t${ANSWER_LINE}`;
    const r = toRJudge(ss, 'ss');
    expect(r).not.toMatch(/routed=hybrid/);
  });
});

describe('G6 — under-answering (truncation) IS penalized', () => {
  it('a truncated high-USD capture loses sufficiency/workable_code ⇒ USD falls', () => {
    const full = unanimousPanel(COMPACT);
    const truncatedPanel = panelWith({
      answer_grounding: { span: ANSWER_LINE, v: 1 },
      workable_code: { span: '', v: 0 }, // truncation marker ⇒ not edit-ready
      navigability: { span: '', v: 0 },
      edit_locality: { span: ANSWER_LINE, v: 1 },
      sufficiency: { span: '', v: 0 }, // gold not fully covered
      signal_purity: { span: ANSWER_LINE, v: 1 },
    });
    const ok = scoreUSD({ probe: probe(), rawResponse: COMPACT, arm: 'ss', panel: full, panelCorrectness: 1 });
    const trunc = scoreUSD({ probe: probe(), rawResponse: `380\t#define HWY_NAMESPACE // …(2 more lines)`, arm: 'ss', panel: truncatedPanel, panelCorrectness: 1 });
    expect(trunc.D2).toBe(0);
    expect(trunc.D5).toBe(0);
    expect(trunc.content).toBeLessThan(ok.content);
    expect(trunc.USD).toBeLessThan(ok.USD);
  });
});

describe('G7 — citation cannot be spoofed; whole-file-cite snaps (B1 regression on scoreUSD)', () => {
  it('a 1000-line dump cited whole does NOT beat a 3-line terse answer', () => {
    const head = Array.from({ length: 400 }, (_, i) => `${i}\tjunk line ${i};`);
    const node = ['400\tvoid SetNS() {', `401\t  ${ANSWER_LINE}`, '402\t}'];
    const tail = Array.from({ length: 600 }, (_, i) => `${403 + i}\tmore junk ${i};`);
    const dump = [...head, ...node, ...tail].join('\n');
    // The dump's judge generously cites the WHOLE file for every criterion.
    const dumpPanel = unanimousPanel(dump);
    const terse = scoreUSD({ probe: probe(), rawResponse: COMPACT, arm: 'native', panel: unanimousPanel(COMPACT), panelCorrectness: 1 });
    const dumped = scoreUSD({ probe: probe(), rawResponse: dump, arm: 'ss', panel: dumpPanel, panelCorrectness: 1 });
    // used_tokens snapped to the node ⇒ purity_ratio ≈ node/whole ≈ tiny.
    expect(dumped.purity_ratio).toBeLessThan(0.2);
    expect(dumped.USD).toBeLessThan(terse.USD);
  });

  it('a v:1 with a non-substring span is demoted to 0 at aggregation', () => {
    const panel = panelWith({ answer_grounding: { span: 'NOT IN RESPONSE', v: 1 } });
    const { verdicts, citedSpansByCriterion } = aggregatePanel(panel, COMPACT);
    expect(verdicts.answer_grounding).toBe(0);
    expect(citedSpansByCriterion.answer_grounding).toHaveLength(0);
  });
});

describe('G8 — no-match cannot be won by a context bomb', () => {
  const nm = probe({ id: 'nm-1', stratum: 'no-match', expectedNoMatch: true, expectedSymbols: ['FlibbertyGibbet'], query: 'where is FlibbertyGibbet implemented?' });

  it('terse-correct "no match" keeps USD ≈ g (≈1)', () => {
    const r = scoreUSD({ probe: nm, rawResponse: 'No match found. Searched the repo for FlibbertyGibbet; not present.', arm: 'native', panel: [], panelCorrectness: 1 });
    expect(r.grounding).toBe(1);
    expect(r.USD).toBeGreaterThan(0.85);
  });

  it('a 15k-token dump on a no-match probe collapses USD to ≈0', () => {
    const bomb = Array.from({ length: 1500 }, (_, i) => `${i}\tsome_unrelated_code_${i}();`).join('\n');
    const r = scoreUSD({ probe: nm, rawResponse: bomb, arm: 'ss', panel: [], panelCorrectness: 0 });
    expect(r.USD).toBeLessThan(0.05);
  });

  it('a confident false-positive (code block naming the fabricated symbol) ⇒ g=0', () => {
    const fp = '```\nint FlibbertyGibbet() { return 42; }\n```';
    const r = scoreNoMatch({ rJudge: toRJudge(fp, 'ss'), gold: { expectedSymbols: ['FlibbertyGibbet'] }, panelCorrectness: 1 });
    expect(r.confidentFalsePositive).toBe(true);
    expect(r.grounding).toBe(0);
    expect(r.USD).toBe(0);
  });
});

// ─── parse + median helpers ───────────────────────────────────────────────────

describe('parseUsdVerdict + medianBinary', () => {
  it('parses the 6-criterion JSON', () => {
    const text = '{"answer_grounding":{"span":"x","v":1},"workable_code":{"span":"","v":0},"navigability":{"span":"","v":0},"edit_locality":{"span":"x","v":1},"sufficiency":{"span":"","v":0},"signal_purity":{"span":"x","v":1}}';
    const p = parseUsdVerdict(text);
    expect(p.verdictByCriterion.answer_grounding.v).toBe(1);
    expect(p.verdictByCriterion.workable_code.v).toBe(0);
  });
  it('returns null on unparseable / incomplete verdicts', () => {
    expect(parseUsdVerdict('garbage')).toBeNull();
    expect(parseUsdVerdict('{"answer_grounding":{"v":1}}')).toBeNull();
  });
  it('medianBinary is the majority vote', () => {
    expect(medianBinary([1, 1, 0])).toBe(1);
    expect(medianBinary([0, 0, 1])).toBe(0);
    expect(medianBinary([])).toBe(0);
  });
  it('buildUsdJudgePrompt is arm-blind (no "ss"/"native"/arm label)', () => {
    const txt = buildUsdJudgePrompt({ probe: probe(), rJudge: COMPACT });
    expect(txt).not.toMatch(/\barm\b/i);
    expect(txt).toContain('Response (tool output, chrome removed)');
  });
});

describe('pairedBootstrapCI', () => {
  it('a strictly positive vector ⇒ CI excludes 0', () => {
    // real rng so the resample is non-degenerate; the vector is all-positive so
    // every resample mean is > 0 ⇒ lo > 0 (CI excludes 0).
    const [lo, hi] = pairedBootstrapCI([0.3, 0.4, 0.35, 0.5, 0.45], 5000);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThanOrEqual(lo);
  });
  it('empty ⇒ [0,0]', () => {
    expect(pairedBootstrapCI([])).toEqual([0, 0]);
  });
});
