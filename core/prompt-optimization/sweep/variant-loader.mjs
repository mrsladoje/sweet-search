/**
 * Phase 7 — T1–T15 seed-variant loader (§4.2, §4.3).
 *
 * Loads the hand-authored GEPA seed variants from
 * `core/prompt-optimization/data/p7-variants/T{1..15}.md`. Each file carries a
 * minimal-YAML front-matter block (§4.3) followed by a runnable agent
 * system-prompt body. This module parses the front-matter, slices the body,
 * extracts the protected `[[token]]` markers (§3.2.1), estimates the token
 * count (≈4 chars/token, §4.3), and validates the front-matter schema.
 *
 * Dependency-light by design: the only internal import is the protected-token
 * grammar from `p7-shared.mjs` (read-only). No third-party YAML parser — the
 * front-matter dialect we need is a tiny subset (scalars, quoted scalars,
 * integers, inline arrays), parsed by hand below.
 *
 * Plan references: docs/PHASE7.md §4.2, §4.3, §3.2.1.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute, basename, sep } from 'node:path';

import { PROTECTED_TOKEN_RE } from './p7-shared.mjs';

// ─── constants ──────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
/** Canonical directory holding the T_i seed files. */
export const VARIANTS_DIR = resolve(HERE, '../data/p7-variants');

/** All seed ids, in canonical (numeric) order. */
export const VARIANT_IDS = Object.freeze(Array.from({ length: 15 }, (_, i) => `T${i + 1}`));

/** Front-matter enums (§4.3). */
export const STRATEGIES = Object.freeze([
  'tool-routing-first',
  'query-shape-first',
  'evidence-first',
  'hybrid',
  'control',
]);
export const VERBOSITIES = Object.freeze(['terse', 'medium', 'verbose']);
export const GROUNDINGS = Object.freeze(['full', 'partial', 'none']);
export const SPECIAL_HANDLING = Object.freeze(['no-match', 'multi-file-flow', 'behavioral']);

/** Required front-matter keys (§4.3). */
export const REQUIRED_KEYS = Object.freeze([
  'id',
  'strategy',
  'verbosity',
  'p6_grounding',
  'special_handling',
  'expected_strengths',
  'expected_weaknesses',
  'target_tokens',
]);

// ─── token estimation (§4.3 — ≈4 chars/token) ────────────────────────────────

/**
 * Estimate the LLM token count of a prompt body using the ≈4-chars/token
 * heuristic from §4.3. Deterministic; no tokenizer dependency.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (typeof text !== 'string') throw new TypeError('estimateTokens: string required');
  return Math.round(text.length / 4);
}

// ─── protected-token extraction (§3.2.1) ──────────────────────────────────────

/**
 * Extract every `[[token]]` marker from `text`, in document order, preserving
 * multiplicity. Inner whitespace is normalised (`[[ ss-search ]]` →
 * `[[ss-search]]`) so callers can compare against the canonical token forms.
 *
 * @param {string} text
 * @returns {string[]} normalised tokens, e.g. ['[[ss-search]]', '[[ss-find]]', ...]
 */
export function extractTokens(text) {
  if (typeof text !== 'string') throw new TypeError('extractTokens: string required');
  const out = [];
  for (const m of text.matchAll(PROTECTED_TOKEN_RE)) {
    const inner = m[0].slice(2, -2).trim().replace(/\s+/g, ' ');
    out.push(`[[${inner}]]`);
  }
  return out;
}

/** Distinct protected tokens (multiplicity collapsed), in first-seen order. */
export function uniqueTokens(text) {
  return [...new Set(extractTokens(text))];
}

// ─── minimal YAML front-matter parser ─────────────────────────────────────────

/**
 * Coerce a single scalar token from the front-matter into a JS value.
 * Handles quoted strings, integers, booleans, and bare strings.
 */
function coerceScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return Number.parseFloat(s);
  return s;
}

/** Parse an inline array literal `[a, b, "c d"]` → ['a','b','c d']. */
function parseInlineArray(raw) {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];
  // Split on commas that are not inside quotes.
  const parts = [];
  let buf = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      else buf += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Parse a minimal-YAML front-matter block (the text BETWEEN the `---` fences).
 * Supports: `key: scalar`, `key: "quoted"`, `key: 123`, `key: [inline, array]`.
 * Blank lines and `# comments` are ignored. Unknown keys are preserved.
 *
 * @param {string} block
 * @returns {Record<string, unknown>}
 */
export function parseFrontMatter(block) {
  if (typeof block !== 'string') throw new TypeError('parseFrontMatter: string required');
  const out = {};
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue; // skip malformed lines rather than throwing
    const key = line.slice(0, idx).trim();
    const valueRaw = line.slice(idx + 1).trim();
    if (key === '') continue;
    if (valueRaw.startsWith('[') && valueRaw.endsWith(']')) {
      out[key] = parseInlineArray(valueRaw);
    } else {
      out[key] = coerceScalar(valueRaw);
    }
  }
  return out;
}

/**
 * Split a raw `.md` file into `{ frontMatter (raw text), body }`.
 * Throws if the leading `---` fence pair is missing.
 *
 * @param {string} raw
 * @returns {{ frontMatterBlock: string, body: string }}
 */
export function splitFrontMatter(raw) {
  if (typeof raw !== 'string') throw new TypeError('splitFrontMatter: string required');
  // Normalise line endings first so CRLF / lone-CR files parse identically.
  const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Allow optional trailing whitespace on the `---` fence lines and tolerate a
  // body that does not end in a newline (`\n---` closing fence may be followed
  // by `\n`, EOF, or arbitrary body content).
  const m = normalised.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/);
  if (!m) throw new Error('splitFrontMatter: missing or malformed `---` front-matter fences');
  return { frontMatterBlock: m[1], body: m[2] ?? '' };
}

// ─── path resolution ──────────────────────────────────────────────────────────

/**
 * Resolve an id ('T7'), a bare filename ('T7.md'), or a path to an absolute
 * file path. The resolved path is asserted to live INSIDE `VARIANTS_DIR` —
 * absolute paths or `..` traversal that escape the sandbox are rejected
 * (CLAUDE.md path-sanitisation mandate). Callers pass 'T1'..'T15' / 'T1.md',
 * which always resolve inside the sandbox.
 */
function resolveVariantPath(idOrPath) {
  if (typeof idOrPath !== 'string' || idOrPath.length === 0) {
    throw new TypeError('loadVariant: id or path string required');
  }
  let resolved;
  if (idOrPath.includes('/') || idOrPath.endsWith('.md')) {
    resolved = isAbsolute(idOrPath) ? resolve(idOrPath) : resolve(VARIANTS_DIR, basename(idOrPath));
  } else {
    resolved = resolve(VARIANTS_DIR, `${idOrPath}.md`);
  }
  // Sandbox guard: the resolved path must be the dir itself or a descendant.
  if (resolved !== VARIANTS_DIR && !resolved.startsWith(VARIANTS_DIR + sep)) {
    throw new Error(
      `loadVariant: refusing to load "${idOrPath}" outside the variants sandbox (${VARIANTS_DIR})`,
    );
  }
  return resolved;
}

function assertInside(root, resolved, label) {
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error(`${label}: refusing to load outside ${root}`);
  }
}

function resolveVariantsDir(dir) {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new TypeError('loadVariantsFromDir: directory string required');
  }
  const resolved = isAbsolute(dir) ? resolve(dir) : resolve(REPO_ROOT, dir);
  assertInside(REPO_ROOT, resolved, 'loadVariantsFromDir');
  return resolved;
}

function resolveVariantPathInDir(dir, idOrPath) {
  const root = resolveVariantsDir(dir);
  if (typeof idOrPath !== 'string' || idOrPath.length === 0) {
    throw new TypeError('loadVariantFromDir: id or path string required');
  }
  let resolved;
  if (idOrPath.includes('/') || idOrPath.endsWith('.md')) {
    resolved = isAbsolute(idOrPath) ? resolve(idOrPath) : resolve(root, basename(idOrPath));
  } else {
    resolved = resolve(root, `${idOrPath}.md`);
  }
  assertInside(root, resolved, 'loadVariantFromDir');
  return resolved;
}

// ─── public loaders ───────────────────────────────────────────────────────────

/**
 * @typedef {object} Variant
 * @property {string}                 id
 * @property {string}                 path
 * @property {Record<string,unknown>} frontMatter      parsed front-matter
 * @property {string}                 body             runnable system-prompt body
 * @property {string}                 raw              full file contents
 * @property {number}                 tokenEstimate    estimateTokens(body)
 * @property {number}                 targetTokens     front-matter target_tokens
 * @property {string[]}               protectedTokens  extractTokens(body)
 */

/**
 * Load and parse a single seed variant.
 *
 * @param {string} idOrPath  e.g. 'T7', 'T7.md', or an absolute path
 * @returns {Variant}
 */
export function loadVariant(idOrPath) {
  const path = resolveVariantPath(idOrPath);
  return loadVariantFile(path);
}

function loadVariantFile(path) {
  const raw = readFileSync(path, 'utf8');
  const { frontMatterBlock, body } = splitFrontMatter(raw);
  const frontMatter = parseFrontMatter(frontMatterBlock);
  return {
    id: typeof frontMatter.id === 'string' ? frontMatter.id : basename(path, '.md'),
    path,
    frontMatter,
    body,
    raw,
    tokenEstimate: estimateTokens(body),
    targetTokens: typeof frontMatter.target_tokens === 'number' ? frontMatter.target_tokens : NaN,
    protectedTokens: extractTokens(body),
  };
}

/**
 * Load one T_i-style variant from a caller-supplied directory under the repo.
 */
export function loadVariantFromDir(dir, idOrPath) {
  return loadVariantFile(resolveVariantPathInDir(dir, idOrPath));
}

/**
 * Load all 15 seed variants in canonical (T1..T15) order.
 *
 * @returns {Variant[]}
 */
export function loadAllVariants() {
  return VARIANT_IDS.map((id) => loadVariant(id));
}

/**
 * Load every `T*.md` variant from a caller-supplied directory under the repo.
 * This is used by restart scaffolds without mutating the canonical T1-T15 slate.
 */
export function loadVariantsFromDir(dir) {
  const root = resolveVariantsDir(dir);
  return readdirSync(root)
    .filter((name) => /^T\d+\.md$/.test(name))
    .sort((a, b) => Number.parseInt(a.slice(1), 10) - Number.parseInt(b.slice(1), 10))
    .map((name) => loadVariantFile(resolve(root, name)));
}

// ─── validation ───────────────────────────────────────────────────────────────

/**
 * Validate a loaded variant's front-matter against the §4.3 schema.
 *
 * Checks: presence of all required keys; enum membership for `strategy`,
 * `verbosity`, `p6_grounding`; `special_handling` is an array of known tags;
 * `expected_strengths` / `expected_weaknesses` are non-empty arrays;
 * `target_tokens` is a positive integer; `id` matches /^T\d+$/.
 *
 * @param {Variant|Record<string,unknown>} variantOrFrontMatter
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateVariant(variantOrFrontMatter) {
  const fm =
    variantOrFrontMatter && typeof variantOrFrontMatter === 'object' && 'frontMatter' in variantOrFrontMatter
      ? variantOrFrontMatter.frontMatter
      : variantOrFrontMatter;
  const errors = [];

  if (!fm || typeof fm !== 'object') {
    return { ok: false, errors: ['front-matter is not an object'] };
  }

  for (const key of REQUIRED_KEYS) {
    if (!(key in fm)) errors.push(`missing required key: ${key}`);
  }

  if ('id' in fm && !(typeof fm.id === 'string' && /^T\d+$/.test(fm.id))) {
    errors.push(`id must match /^T\\d+$/ (got ${JSON.stringify(fm.id)})`);
  }
  if ('strategy' in fm && !STRATEGIES.includes(fm.strategy)) {
    errors.push(`strategy not in enum: ${JSON.stringify(fm.strategy)}`);
  }
  if ('verbosity' in fm && !VERBOSITIES.includes(fm.verbosity)) {
    errors.push(`verbosity not in enum: ${JSON.stringify(fm.verbosity)}`);
  }
  if ('p6_grounding' in fm && !GROUNDINGS.includes(fm.p6_grounding)) {
    errors.push(`p6_grounding not in enum: ${JSON.stringify(fm.p6_grounding)}`);
  }
  if ('special_handling' in fm) {
    if (!Array.isArray(fm.special_handling)) {
      errors.push('special_handling must be an array');
    } else {
      for (const tag of fm.special_handling) {
        if (!SPECIAL_HANDLING.includes(tag)) errors.push(`unknown special_handling tag: ${JSON.stringify(tag)}`);
      }
    }
  }
  for (const arrKey of ['expected_strengths', 'expected_weaknesses']) {
    if (arrKey in fm && (!Array.isArray(fm[arrKey]) || fm[arrKey].length === 0)) {
      errors.push(`${arrKey} must be a non-empty array`);
    }
  }
  if ('target_tokens' in fm && !(Number.isInteger(fm.target_tokens) && fm.target_tokens > 0)) {
    errors.push(`target_tokens must be a positive integer (got ${JSON.stringify(fm.target_tokens)})`);
  }

  return { ok: errors.length === 0, errors };
}
