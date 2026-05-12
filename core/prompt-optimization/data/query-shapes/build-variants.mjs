/**
 * Build core/prompt-optimization/data/query-shapes/variants.json — K=7 shape
 * variants per gold across the orthogonal main-effects grid declared in
 * docs/SYSTEM_PROMPT_OPT_PLAN.md §7.2 / preregistration.md. V7 was added
 * 2026-05-12 per docs/PHASE6_REDO.md §5 (descriptive-with-symbol cell);
 * V1-V6 remain unchanged.
 *
 * Shape grid dimensions (agent-instructable):
 *   1. Length tier:        very-short (≤3 tok), short (4-8), medium (9-15), long-NL (16+)
 *   2. Symbol presence:    with-symbol, without-symbol
 *   3. Intent verb:        present, absent
 *   4. Q framing:          declarative-noun-phrase, interrogative, imperative
 *   5. Domain-term density: high, low
 *   6. Regex anchor breadth (ss-find only): narrow (1 literal), medium (2-3), broad (5+)
 *
 * The full Cartesian product is 4×2×2×3×2×3 = 288 cells. We sample K=7 per
 * gold along the orthogonal grid below, chosen to give every dimension
 * non-trivial main-effect coverage while keeping the within-gold per-tool
 * sweep tractable.
 *
 * The 7 canonical variants per gold (V7 added 2026-05-12 per docs/PHASE6_REDO.md §5):
 *
 *   V1: very-short + with-symbol*          + absent  + imperative   + high + narrow-regex   (* falls back to without-symbol when no expectedSymbols, anchoring on file basename)
 *   V2: short      + with-symbol           + present + interrogative+ high + narrow-regex
 *   V3: short      + without-symbol        + absent  + declarative  + high + medium-regex
 *   V4: medium     + with-symbol           + present + interrogative+ high + medium-regex   (the existing tasks.js phrasing baseline)
 *   V5: medium     + without-symbol        + present + interrogative+ low  + broad-regex
 *   V6: long-NL    + without-symbol        + present + interrogative+ low  + broad-regex
 *   V7: medium     + with-symbol           + absent  + declarative  + high + narrow-regex   (PHASE6_REDO §5: covers descriptive-with-symbol form — the existing rust.json probe phrasing shape)
 *
 * Variants are authored programmatically from each gold's components
 * (query / expectedSymbols / expectedFiles / qshape_stratum). The original
 * tasks.js question is preserved as V4 (the baseline that already exists).
 *
 * INDEPENDENT-AUTHOR DISCIPLINE (§11.2 / §7.6 four-gate gate #4):
 *   The variants here are programmatic transforms; provenance is recorded
 *   in `authoredBy: 'variant-generator-v1'`. The hand-authored gold queries
 *   come from a different author ('sweet-search-core'). At promotion time,
 *   if the variant generator was tuned per-gold (which it is NOT here — it's
 *   a deterministic transform), the gate would trip.
 *
 * Run: node core/prompt-optimization/data/query-shapes/build-variants.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GOLDS_PATH = path.join(__dirname, 'golds.json');
const VARIANTS_PATH = path.join(__dirname, 'variants.json');

// ─── helpers ───────────────────────────────────────────────────────────────

function pickPrimarySymbol(gold) {
  return gold.expectedSymbols?.[0] ?? null;
}

function pickPrimaryFile(gold) {
  return gold.expectedFiles?.[0] ?? null;
}

/**
 * TSX-canonical surface form for a symbol.
 *
 * Plan §7.6 / P6.1 (added 2026-05-09 with vercel/ai-chatbot): for ai-chatbot
 * golds the "with-symbol" variants must use TSX-canonical forms
 * (`<ChatHeader>`, `useArtifact()`) rather than function-only forms, so the
 * symbol-presence axis is genuinely tested on the new shape. A function-only
 * `ChatHeader` would not match how an agent or developer searches a TSX/React
 * codebase — they search for the JSX-rendered tag or the hook-call form.
 *
 * Heuristic:
 *   - Symbol begins with "use" + lowercase → React hook → `useFoo()` form.
 *   - Symbol begins with uppercase letter on a `.tsx` file → component → `<Foo>` form.
 *   - Otherwise: bare identifier (existing behaviour for non-ai-chatbot golds).
 *
 * Repo-gated: only ai-chatbot exercises this transform; other repos retain
 * the bare-identifier surface form so the V1/V2 variants compare like-for-
 * like with the prior 4-repo dev set.
 */
function tsxCanonicalSymbol(gold, sym) {
  if (!sym) return sym;
  if (gold.repo !== 'ai-chatbot') return sym;
  // React hook: useFoo, useFooBar — must start with "use" + uppercase next char
  if (/^use[A-Z]/.test(sym)) return `${sym}()`;
  // Component: PascalCase, file is .tsx (or first expected file is .tsx)
  const file = pickPrimaryFile(gold) ?? '';
  if (/\.tsx$/.test(file) && /^[A-Z]/.test(sym)) return `<${sym}>`;
  return sym;
}

/**
 * Tokenise the query into a word array (whitespace + punctuation split,
 * lowercase, filter 1-letter tokens).
 */
function words(text) {
  return String(text || '')
    .split(/[\s,;:.()\[\]{}<>"'`!?]+/u)
    .filter((w) => w.length > 1);
}

/**
 * Strip leading filler words ("In Fastify, ...", "When you ...", "How does
 * ...") and return the substantive remainder. Coarse but deterministic.
 */
function stripFiller(query) {
  return String(query)
    .replace(/^(in\s+\w+\s*,?\s*)/i, '')
    .replace(/^(in\s+the\s+\w+\s+(codebase|code)\s*,?\s*)/i, '')
    .replace(/^(when\s+\w+\s+\w+\s*,?\s*)/i, '')
    .replace(/^(how\s+does\s+\w+\s+)/i, '')
    .trim();
}

function topicNoun(gold) {
  // Heuristic: the LAST noun-ish token before the first "?" or end is often
  // a strong topic word. Fall back to first content-word if nothing else.
  const stripped = stripFiller(gold.query);
  const ws = words(stripped);
  if (ws.length === 0) return gold.repo;
  // Prefer multi-word noun phrase: take 2-3 content words.
  return ws.slice(0, Math.min(3, ws.length)).join(' ');
}

/**
 * Build a narrow regex around a specific symbol / file token.
 *
 * Narrow:  \bSymbolName\b
 * Medium:  \b(SymbolName|alt1|alt2)\b
 * Broad:   \b(token1|token2|token3|token4|token5|token6)\b
 */
function narrowRegex(gold) {
  const sym = pickPrimarySymbol(gold);
  if (sym) return `\\b${sym}\\b`;
  // No symbol: anchor on the canonical file basename
  const file = pickPrimaryFile(gold);
  if (file) {
    const base = path.basename(file).replace(/\./g, '\\.');
    return `\\b${base}\\b`;
  }
  return '\\b\\w+\\b';
}

function mediumRegex(gold) {
  const syms = (gold.expectedSymbols || []).slice(0, 3);
  if (syms.length >= 2) return `\\b(${syms.join('|')})\\b`;
  if (syms.length === 1) {
    const file = pickPrimaryFile(gold);
    if (file) {
      const base = path.basename(file).replace(/\.\w+$/, '');
      return `\\b(${syms[0]}|${base})\\b`;
    }
    return `\\b${syms[0]}\\b`;
  }
  return narrowRegex(gold);
}

function broadRegex(gold) {
  const stripped = stripFiller(gold.query);
  const tokens = words(stripped)
    .filter((w) => /^[a-z][a-z0-9_-]+$/i.test(w))
    .filter((w) => !/^(does|the|that|how|where|what|which|when|file|name|line)$/i.test(w))
    .slice(0, 6);
  if (tokens.length >= 4) return `\\b(${tokens.join('|')})\\b`;
  return mediumRegex(gold);
}

// ─── 6 canonical variants per gold ─────────────────────────────────────────

function variantV1(gold) {
  // very-short + with-symbol + absent intent + imperative + high domain + narrow regex
  const sym = pickPrimarySymbol(gold);
  if (sym) {
    return {
      shape: 'very-short+with-symbol+narrow-regex+imperative+high-density',
      query: tsxCanonicalSymbol(gold, sym),
      regex: narrowRegex(gold),
    };
  }
  // No symbol: fall back to file basename
  const file = pickPrimaryFile(gold);
  const base = file ? path.basename(file, path.extname(file)) : gold.repo;
  return {
    shape: 'very-short+without-symbol+narrow-regex+imperative+high-density',
    query: base,
    regex: narrowRegex(gold),
  };
}

function variantV2(gold) {
  // short + with-symbol + intent-verb + interrogative + high domain + narrow regex
  const file = pickPrimaryFile(gold) ?? '';
  const fallback = file ? path.basename(file, path.extname(file)) : gold.repo;
  const symRaw = pickPrimarySymbol(gold) ?? fallback;
  const sym = tsxCanonicalSymbol(gold, symRaw);
  // Choose the verb based on stratum
  let q;
  switch (gold.qshape_stratum) {
    case 'literal-lookup':
    case 'structural':
      q = `where is ${sym} defined`;
      break;
    case 'behavioral':
      q = `how does ${sym} work`;
      break;
    case 'multi-file-flow':
      q = `trace ${sym} across files`;
      break;
    default:
      q = `find ${sym}`;
  }
  return {
    shape: 'short+with-symbol+narrow-regex+interrogative+high-density',
    query: q,
    regex: narrowRegex(gold),
  };
}

function variantV3(gold) {
  // short + without-symbol + absent intent + declarative noun phrase + high domain + medium regex
  const noun = topicNoun(gold);
  return {
    shape: 'short+without-symbol+medium-regex+declarative+high-density',
    query: noun,
    regex: mediumRegex(gold),
  };
}

function variantV4(gold) {
  // medium + with-symbol + intent-verb + interrogative + high domain + medium regex
  // V4 is the BASELINE: the original tasks.js question, preserving the gold
  // author's natural phrasing. This is the comparison anchor.
  return {
    shape: 'medium+with-symbol+medium-regex+interrogative+high-density',
    query: gold.query,
    regex: mediumRegex(gold),
    isBaseline: true,
  };
}

function variantV5(gold) {
  // medium + without-symbol + intent-verb + interrogative + low domain + broad regex
  // Strip the symbol from the query if present, replace with generic noun.
  const sym = pickPrimarySymbol(gold);
  let q = gold.query;
  if (sym) {
    q = q.replace(new RegExp(`\\b${sym}\\b`, 'gi'), 'this').replace(/\s+/g, ' ').trim();
  }
  // Drop repo-specific names ("Fastify", "Gin", "Flask", "ripgrep", "uv")
  q = q.replace(/\b(Fastify|Gin|Flask|ripgrep|uv)\b/gi, 'the framework');
  q = q.replace(/\bai-chatbot\b/gi, 'the framework');
  q = q.replace(/\bvercel\/the framework\b/gi, 'the framework');
  // Cap length
  const ws = words(q);
  if (ws.length > 15) q = ws.slice(0, 14).join(' ');
  return {
    shape: 'medium+without-symbol+broad-regex+interrogative+low-density',
    query: q,
    regex: broadRegex(gold),
  };
}

function variantV6(gold) {
  // long-NL + without-symbol + intent-verb + interrogative + low domain + broad regex
  // Take the full original question, strip the symbol, and add an explicit
  // verbose framing prefix so the resulting query exceeds 16 tokens.
  const sym = pickPrimarySymbol(gold);
  let body = gold.query;
  if (sym) {
    body = body.replace(new RegExp(`\\b${sym}\\b`, 'gi'), 'the relevant component');
  }
  body = body.replace(/\b(Fastify|Gin|Flask|ripgrep|uv)\b/gi, 'this codebase');
  body = body.replace(/\bai-chatbot\b/gi, 'this codebase');
  body = body.replace(/\bvercel\/this codebase\b/gi, 'this codebase');
  const prefix = 'I am trying to understand exactly how this works at a deep level. Specifically: ';
  let q = prefix + body;
  const ws = words(q);
  if (ws.length < 16) {
    q += ' Please walk through the relevant control flow step by step.';
  }
  return {
    shape: 'long-NL+without-symbol+broad-regex+interrogative+low-density',
    query: q,
    regex: broadRegex(gold),
  };
}

function variantV7(gold) {
  // medium + with-symbol + absent intent + declarative noun-phrase + high domain + narrow regex
  // V7 (added 2026-05-12 per docs/PHASE6_REDO.md §5) covers the
  // descriptive-with-symbol form — the existing AST-tester probes
  // (rust.json, kotlin.json, etc.) are authored as "X struct that does Y";
  // V4 (interrogative) does not cover this case. V7 lets us measure whether
  // the existing probe phrasing is in a good cell.
  const file = pickPrimaryFile(gold) ?? '';
  const fallback = file ? path.basename(file, path.extname(file)) : gold.repo;
  const symRaw = pickPrimarySymbol(gold) ?? fallback;
  const sym = tsxCanonicalSymbol(gold, symRaw);
  const symbolType = gold.expectedSymbolType ?? gold.expectedSymbolTypeAnyOf?.[0] ?? 'symbol';
  // Build a declarative noun-phrase: "<symbol> <type> that <topic-phrase>".
  // Skip an intent verb (declarative, not interrogative/imperative).
  const noun = topicNoun(gold);
  let q = `${sym} ${symbolType} that ${noun}`;
  // Cap to the medium tier (9-15 tokens whitespace-split).
  const ws = words(q);
  if (ws.length > 15) q = ws.slice(0, 14).join(' ');
  // Pad to ≥ 9 if the topic noun is unusually terse.
  if (words(q).length < 9) q = `${q} in the ${gold.repo} codebase implementation`;
  return {
    shape: 'medium+with-symbol+narrow-regex+declarative+high-density',
    query: q,
    regex: narrowRegex(gold),
  };
}

const VARIANT_BUILDERS = [variantV1, variantV2, variantV3, variantV4, variantV5, variantV6, variantV7];

// ─── ss-find specific anchor sweep (regex-breadth side analysis) ──────────

/**
 * For the ss-find side analysis (§7.4 regex-anchor sweep), each gold also
 * gets three regex-anchor pairings using V4's NL query but with
 * narrow / medium / broad regex separately. Logged as a sub-array so the
 * Track A harness can score them as the regex-engineering side study
 * without polluting the main shape claim space.
 */
function regexAnchorVariants(gold) {
  return [
    { id: 'A_narrow', regex: narrowRegex(gold) },
    { id: 'A_medium', regex: mediumRegex(gold) },
    { id: 'A_broad',  regex: broadRegex(gold) },
  ];
}

// ─── main ─────────────────────────────────────────────────────────────────

function buildForGold(gold) {
  const variants = VARIANT_BUILDERS.map((fn, idx) => {
    const v = fn(gold);
    return {
      variantId: `V${idx + 1}`,
      shape: v.shape,
      query: v.query,
      regex: v.regex,
      isBaseline: !!v.isBaseline,
    };
  });
  return {
    goldId: gold.id,
    repo: gold.repo,
    tier: gold.tier,
    qshape_stratum: gold.qshape_stratum,
    predicted_winning_tool: gold.predicted_winning_tool,
    predicted_winning_shape: gold.predicted_winning_shape,
    variants,
    ssFindAnchorSweep: regexAnchorVariants(gold),
  };
}

function summarise(perGold) {
  const shapeHistogram = {};
  let totalVariants = 0;
  for (const g of perGold) {
    for (const v of g.variants) {
      shapeHistogram[v.shape] = (shapeHistogram[v.shape] || 0) + 1;
      totalVariants += 1;
    }
  }
  return {
    nGolds: perGold.length,
    nVariants: totalVariants,
    shapeHistogram,
  };
}

function main() {
  const goldsRaw = JSON.parse(readFileSync(GOLDS_PATH, 'utf8'));
  const perGold = goldsRaw.records.map(buildForGold);

  const out = {
    schemaVersion: 1,
    runId: 'qshape-v1',
    generatedAt: new Date().toISOString(),
    authoredBy: 'variant-generator-v1',
    builderSource: 'core/prompt-optimization/data/query-shapes/build-variants.mjs',
    shapeGrid: {
      lengthTiers: ['very-short (≤3 tok)', 'short (4-8)', 'medium (9-15)', 'long-NL (16+)'],
      symbolPresence: ['with-symbol', 'without-symbol'],
      intentVerb: ['present', 'absent'],
      qFraming: ['declarative-noun-phrase', 'interrogative', 'imperative'],
      domainDensity: ['high', 'low'],
      regexAnchor: ['narrow (1 literal)', 'medium (2-3 alt)', 'broad (5+ alt)'],
    },
    canonicalVariants: [
      // (D17.) V1 is `with-symbol` IF a primary symbol exists; otherwise
      // the builder falls back to the file basename and emits the variant
      // with the `without-symbol` token. This matches the histogram
      // produced by build-variants.mjs (some V1 rows show
      // `very-short+without-symbol+...`).
      'V1: very-short+(with|without)-symbol+narrow-regex+imperative+high-density (without-symbol when no expectedSymbols)',
      'V2: short+with-symbol+narrow-regex+interrogative+high-density',
      'V3: short+without-symbol+medium-regex+declarative+high-density',
      'V4: medium+with-symbol+medium-regex+interrogative+high-density (baseline = original tasks.js phrasing)',
      'V5: medium+without-symbol+broad-regex+interrogative+low-density',
      'V6: long-NL+without-symbol+broad-regex+interrogative+low-density',
      'V7: medium+with-symbol+narrow-regex+declarative+high-density (PHASE6_REDO §5 — descriptive-with-symbol)',
    ],
    summary: summarise(perGold),
    perGold,
  };

  writeFileSync(VARIANTS_PATH, JSON.stringify(out, null, 2) + '\n');
  const K = VARIANT_BUILDERS.length;
  process.stdout.write(`variants.json written: ${out.summary.nGolds} golds × ${K} = ${out.summary.nVariants} variants\n`);
  process.stdout.write(JSON.stringify(out.summary.shapeHistogram, null, 2) + '\n');
}

main();
