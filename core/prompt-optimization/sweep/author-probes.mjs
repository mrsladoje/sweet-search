/**
 * Phase 7 — probe-authoring tool.
 *
 * Provides:
 *  - stratifiedSplit({probes, seed, perLanguage}) — deterministic per-language split (§5.0)
 *  - validate(probes)                             — wraps shared validateProbes
 *  - makePathologyProbeTemplate(kind)             — empty template for §5.5 probes
 *  - makeDistractorProbeTemplate()                — empty template for §5.6 probes
 *  - COUNTER_PROBE_REWRITE_PROMPT                 — §5.7 Sonnet anti-P6-shape instruction
 *  - OOD_LANGUAGES / IN_DISTRIBUTION             — catalog constants
 *  - generateSmokeProbes({repoRoot})              — ~5 VERIFIED smoke probes (smoke:true)
 *
 * CLI (guard on import.meta.url === process.argv[1]):
 *   node author-probes.mjs --smoke              # write data/p7-smoke-probes.json
 *   node author-probes.mjs --validate <file>    # validate a probe JSON file
 *   node author-probes.mjs --split <file>       # report split counts for a probe file
 *
 * INTEGRITY RULE: this module provides TOOLING + SMOKE FIXTURES only.
 * The real prereg probe sets (40 dev / 30 held-out / 25 vault / 40 OOD) are a
 * separate human workstream (docs/PHASE7.md §5 status). Every smoke probe's gold
 * (expectedFiles/expectedSymbols) was verified by grep before being written here.
 *
 * Plan references: docs/PHASE7.md §5.0, §5.1, §5.5, §5.6, §5.7, §3.5.1.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateProbes } from './p7-shared.mjs';
import { mulberry32 } from '../stats/rng.mjs';

// ─── catalog constants ────────────────────────────────────────────────────────

/**
 * 8 out-of-distribution languages for the §3.5.1 OOD transfer gate (winner-only;
 * never in the optimization loop). Aggregate Maximin ≥ 0.55 on BOTH production
 * targets (Sonnet 4.6 + GPT-5.5) required to ship; any single language < 0.4 is
 * flagged a documented weak spot. SHA-locked repos (eval/ast-tester-probes/repos.json):
 *   C → redis/hiredis · Dart → dart-lang/http · Elixir → michalmuskala/jason ·
 *   Lua → lunarmodules/Penlight · PHP → slimphp/Slim · Scala → com-lihaoyi/requests-scala ·
 *   Swift → Alamofire · Zig → karlseguin/http.zig.
 * Kept as language-name strings (the OOD scaffolding + tests key off these).
 */
export const OOD_LANGUAGES = Object.freeze([
  'C', 'Dart', 'Elixir', 'Lua', 'PHP', 'Scala', 'Swift', 'Zig',
]);

/**
 * 10 in-distribution languages + anchor repos for dev/held-out/vault (§5.0).
 * Split mechanics: 4 dev / 3 held-out / 2-3 vault per language, seed=42.
 *
 * `repo` is the short repo name; `path` is the on-disk location (verified to
 * exist 2026-05-22). The first 5 are the P6 anchor repos under `eval/repos/`;
 * the last 5 are the SHA-locked ast-tester repos under
 * `eval/ast-tester-probes/_repos/` (SHAs in `eval/ast-tester-probes/repos.json`).
 */
export const IN_DISTRIBUTION = Object.freeze([
  { language: 'javascript', repo: 'fastify',             path: 'eval/repos/fastify' },
  { language: 'typescript', repo: 'ai-chatbot',          path: 'eval/repos/ai-chatbot' },
  { language: 'go',         repo: 'gin',                 path: 'eval/repos/gin' },
  { language: 'python',     repo: 'flask',               path: 'eval/repos/flask' },
  { language: 'rust',       repo: 'ripgrep',             path: 'eval/repos/ripgrep' },
  { language: 'java',       repo: 'gson',                path: 'eval/ast-tester-probes/_repos/java' },
  { language: 'cpp',        repo: 'highway',             path: 'eval/ast-tester-probes/_repos/cpp' },
  { language: 'csharp',     repo: 'garnet',              path: 'eval/ast-tester-probes/_repos/csharp' },
  { language: 'ruby',       repo: 'sinatra',             path: 'eval/ast-tester-probes/_repos/ruby' },
  { language: 'kotlin',     repo: 'kotlinx.coroutines',  path: 'eval/ast-tester-probes/_repos/kotlin' },
]);

// ─── §5.7 adversarial counter-probe rewrite prompt ───────────────────────────

/**
 * Instruction string for the §5.7 Sonnet adversarial counter-probe rewrite pass.
 *
 * Sonnet rewrites dev probes so their surface form is HOSTILE to a specific P6
 * win-rate heuristic, while preserving the underlying user intent and gold answer
 * exactly. This guards against the gold-probe self-fulfilling-prophecy risk
 * (Gemini 2nd-pass §B4): if the author subconsciously aligned dev probes with the
 * P6 signal, GEPA would trivially "validate" P6 only because the test was rigged.
 *
 * Replace {{HEURISTIC}} with the P6 winRate guidance to violate (e.g.
 * "ss-find narrow-regex + interrogative wins for JS-mobile"), and {{QUERY}},
 * {{REPO}}, {{LANGUAGE}} with the probe's actual values, before sending to Sonnet.
 * Output should be only the rewritten query string.
 *
 * The counter-probes are added to the HELD-OUT set (a generalization gate, NOT a
 * training signal) and evaluated on the winner at end of run.
 * Gate (§5.7): within 15% of the winner's dev score ⇒ the P6 signal generalised;
 * a >25% drop ⇒ the prompt was overfit to query-shape alignment.
 */
export const COUNTER_PROBE_REWRITE_PROMPT = `\
You are rewriting a code-search probe query so its surface form is HOSTILE to a
named retrieval heuristic, without changing what the user is actually asking for.

Heuristic to violate: {{HEURISTIC}}

Rules:
1. Preserve the underlying user intent and gold answer EXACTLY — the rewritten
   query must resolve to the same file(s)/symbol(s) as the original.
2. Make the rewritten query violate the heuristic: e.g. if the heuristic favours
   interrogative phrasing, use a terse imperative without a symbol; if it favours
   a narrow symbol/path anchor, use broad natural language with no anchor.
3. Avoid leaking the structured-query shapes P6 was optimized for (path tokens,
   file extensions, exact symbol names, CamelCase identifiers) unless the
   heuristic is specifically that those shapes LOSE — then it is fair to keep one.
4. Do not make the query unanswerable or ambiguous — a human with the repo open
   must still be able to land on the same gold answer.
5. Output ONLY the rewritten query string, no explanation, no quotes.

Original query: {{QUERY}}
Repo: {{REPO}}
Language: {{LANGUAGE}}`;

// ─── pathology probe templates (§5.5) ────────────────────────────────────────

/**
 * Returns a partial probe template for pathology probes (§5.5).
 * The template is NOT a complete probe — gold (expectedFiles/expectedSymbols)
 * MUST be filled in by the human author after verifying against the real repo.
 * Do NOT commit a template with TODO fields as a prereg probe.
 *
 * @param {'wrong-extension'|'flooding'|'rabbit-hole'} kind
 * @returns {object} partial probe template (not validated)
 */
export function makePathologyProbeTemplate(kind) {
  const base = {
    id: `TODO-pathology-${kind}-1`,
    repo: 'TODO',
    language: 'TODO',
    stratum: 'literal-lookup',
    difficulty: 'medium',
    query: 'TODO: write a query that exercises this pathology',
    expectedFiles: [],
    expectedSymbols: [],
    expectedFacts: [],
    expectedNoMatch: false,
    max_turns: 6,
    tier: 'deferred-pathology',
    pathology: kind,
    smoke: false,
    notes: `Pathology kind: ${kind}. Gold MUST be verified by grep before committing.`,
  };

  if (kind === 'wrong-extension') {
    base.stratum = 'literal-lookup';
    base.difficulty = 'medium';
    base.query = 'TODO: query implies .js but answer lives in .tsx — agent must relax file filter before relaxing search term';
    base.notes += ' Wrong-extension: query implies one extension but real answer is in another.';
  } else if (kind === 'flooding') {
    base.stratum = 'literal-lookup';
    base.difficulty = 'hard';
    base.query = 'TODO: query that surfaces a large minified/generated file — agent must skip the noise file';
    base.notes += ' Flooding: a large or minified file traps context window.';
  } else if (kind === 'rabbit-hole') {
    base.stratum = 'multi-file-flow';
    base.difficulty = 'hard';
    base.query = 'TODO: query with deep transitive call chain — agent must terminate within max_turns';
    base.max_turns = 8;
    base.notes += ' Rabbit-hole: deep transitive chain, agent must know when to stop.';
  }

  return base;
}

/**
 * Returns a partial probe template for distractor/poisoned probes (§5.6).
 * Gold MUST be filled in by the human author after verifying against the real repo.
 *
 * @returns {object} partial probe template (not validated)
 */
export function makeDistractorProbeTemplate() {
  return {
    id: 'TODO-distractor-1',
    repo: 'TODO',
    language: 'TODO',
    stratum: 'literal-lookup',
    difficulty: 'medium',
    query: 'TODO: a query whose surface phrasing implies a plausible-sounding but incorrect file',
    expectedFiles: [],
    expectedSymbols: [],
    expectedFacts: [],
    expectedNoMatch: false,
    max_turns: 4,
    distractor: true,
    smoke: false,
    notes: 'Distractor probe: surface phrasing misleads toward wrong file. Gold MUST be verified by grep.',
  };
}

// ─── deterministic per-language split (§5.0) ─────────────────────────────────

/**
 * Mix a language string into a base seed to produce a per-language sub-seed.
 * Deterministic across machines (pure arithmetic, no native hash).
 * @param {number} seed
 * @param {string} language
 * @returns {number}
 */
function mixLangSeed(seed, language) {
  let h = seed >>> 0;
  for (let i = 0; i < language.length; i++) {
    h = (Math.imul(h, 31) + language.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Fisher-Yates shuffle (in-place).
 * @param {T[]} arr
 * @param {() => number} rng — mulberry32 instance
 * @returns {T[]}
 */
function fisherYates(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Stratified train/held-out/vault/rotation split by language (§5.0).
 *
 * Mechanics:
 *  1. Group probes by probe.language.
 *  2. For each group (languages processed in sorted order for determinism):
 *     a. Shuffle using mulberry32(mixLangSeed(seed, language)).
 *     b. Take first perLanguage.dev → dev.
 *     c. Take next perLanguage.heldout → heldout.
 *     d. Take next perLanguage.vault → vault.
 *     e. Remainder → rotation.
 *  3. Returns {dev, heldout, vault, rotation} as flat probe arrays.
 *
 * DETERMINISTIC: same seed → identical split. Different seed → different split.
 * Language-isolated: adding a new language does not reshuffle existing language groups.
 *
 * @param {object}   opts
 * @param {object[]} opts.probes          — array of ProbeRecord objects
 * @param {number}   [opts.seed=42]       — mulberry32 base seed
 * @param {object}   [opts.perLanguage]   — per-language count overrides
 * @param {number}   [opts.perLanguage.dev=4]
 * @param {number}   [opts.perLanguage.heldout=3]
 * @param {number}   [opts.perLanguage.vault=2]
 * @returns {{ dev: object[], heldout: object[], vault: object[], rotation: object[] }}
 */
export function stratifiedSplit({ probes, seed = 42, perLanguage } = {}) {
  const counts = { dev: 4, heldout: 3, vault: 2, ...perLanguage };

  // Group by language
  const byLang = new Map();
  for (const p of probes) {
    const lang = p.language ?? '';
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang).push(p);
  }

  // Sort language keys for determinism (order of insertion into Map is stable
  // but depends on probe order; sorting guarantees cross-call consistency).
  const sortedLangs = [...byLang.keys()].sort();

  const dev = [], heldout = [], vault = [], rotation = [];

  for (const lang of sortedLangs) {
    const group = byLang.get(lang);
    const rng = mulberry32(mixLangSeed(seed, lang));
    const shuffled = fisherYates([...group], rng);

    let i = 0;
    for (let j = 0; j < counts.dev && i < shuffled.length; j++, i++) dev.push(shuffled[i]);
    for (let j = 0; j < counts.heldout && i < shuffled.length; j++, i++) heldout.push(shuffled[i]);
    for (let j = 0; j < counts.vault && i < shuffled.length; j++, i++) vault.push(shuffled[i]);
    while (i < shuffled.length) rotation.push(shuffled[i++]);
  }

  return { dev, heldout, vault, rotation };
}

// ─── validate wrapper ─────────────────────────────────────────────────────────

/**
 * Validate an array of probe objects.
 * Wraps shared validateProbes — returns { ok, errors:[{index, message}] }.
 *
 * @param {object[]} probes
 * @returns {{ ok: boolean, errors: {index: number, message: string}[] }}
 */
export function validate(probes) {
  return validateProbes(probes);
}

// ─── smoke probes (DRY-RUN fixtures) ─────────────────────────────────────────

const _SMOKE_DATE   = '2026-05-22';
const _SMOKE_AUTHOR = 'probe-author-agent';

/**
 * Returns ~5 VERIFIED smoke probes (smoke: true).
 *
 * These are DRY-RUN fixtures for testing the author-probes tooling.
 * They are NOT prereg probes. Every gold entry was verified by grep
 * against the on-disk eval/repos/ corpus before being written here.
 *
 * Repos verified:
 *   - ripgrep (Rust)  — eval/repos/ripgrep/
 *   - gin (Go)        — eval/repos/gin/
 *   - fastify (JS)    — eval/repos/fastify/
 *   - flask (Python)  — eval/repos/flask/
 *
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]  — unused for hardcoded smoke set; reserved for future dynamic probes
 * @returns {object[]} array of ~5 validated probe objects
 */
export function generateSmokeProbes({ repoRoot } = {}) {
  return [
    // ── smoke-001: literal-lookup / easy / rust / ripgrep ───────────────────
    // Verified: grep -n "fn search_parallel" eval/repos/ripgrep/crates/core/main.rs → line 160
    {
      id:              'smoke-001',
      repo:            'ripgrep',
      language:        'rust',
      stratum:         'literal-lookup',
      difficulty:      'easy',
      query:           'Where is the search_parallel function defined?',
      expectedFiles:   ['crates/core/main.rs'],
      expectedSymbols: ['search_parallel'],
      expectedFacts:   ['search_parallel accepts HiArgs and SearchMode parameters and returns anyhow::Result<bool>'],
      expectedNoMatch: false,
      max_turns:       3,
      smoke:           true,
      author:          _SMOKE_AUTHOR,
      date:            _SMOKE_DATE,
      notes:           'Verified: crates/core/main.rs:160 — fn search_parallel(args: &HiArgs, mode: SearchMode) -> anyhow::Result<bool>',
    },

    // ── smoke-002: literal-lookup / medium / go / gin ───────────────────────
    // Verified: grep -n "func (c *Context) Abort()" eval/repos/gin/context.go → line 207
    {
      id:              'smoke-002',
      repo:            'gin',
      language:        'go',
      stratum:         'literal-lookup',
      difficulty:      'medium',
      query:           'Where is the Abort method on gin Context defined and what does it do?',
      expectedFiles:   ['context.go'],
      expectedSymbols: ['Abort'],
      expectedFacts:   ['Abort sets the index to abortIndex to prevent pending handlers from executing'],
      expectedNoMatch: false,
      max_turns:       3,
      smoke:           true,
      author:          _SMOKE_AUTHOR,
      date:            _SMOKE_DATE,
      notes:           'Verified: context.go:207 — func (c *Context) Abort()',
    },

    // ── smoke-003: multi-file-flow / medium / javascript / fastify ──────────
    // Verified:
    //   buildRouting in lib/route.js:75 imports onRequestHookRunner from lib/hooks.js:6
    //   route.js:557 calls onRequestHookRunner when context.onRequest is non-null
    {
      id:              'smoke-003',
      repo:            'fastify',
      language:        'javascript',
      stratum:         'multi-file-flow',
      difficulty:      'medium',
      query:           'How does the onRequest lifecycle hook get invoked when a fastify route is matched?',
      expectedFiles:   ['lib/route.js', 'lib/hooks.js'],
      expectedSymbols: ['buildRouting', 'onRequestHookRunner'],
      expectedFacts:   ['buildRouting requires onRequestHookRunner from hooks.js and calls it when context.onRequest is non-null'],
      expectedNoMatch: false,
      max_turns:       5,
      smoke:           true,
      author:          _SMOKE_AUTHOR,
      date:            _SMOKE_DATE,
      notes:           'Verified: lib/route.js:6 requires onRequestHookRunner from ./hooks; lib/route.js:557 calls it; lib/hooks.js:276 defines it',
    },

    // ── smoke-004: behavioral / hard / python / flask ───────────────────────
    // Verified:
    //   wsgi_app in src/flask/app.py:1566 calls ctx.push() then full_dispatch_request(ctx)
    //   AppContext.push() defined in src/flask/ctx.py:416 (RequestContext merged into AppContext in Flask 3.2)
    {
      id:              'smoke-004',
      repo:            'flask',
      language:        'python',
      stratum:         'behavioral',
      difficulty:      'hard',
      query:           'How does Flask push and pop the request context around a WSGI request dispatch?',
      expectedFiles:   ['src/flask/app.py', 'src/flask/ctx.py'],
      expectedSymbols: ['wsgi_app', 'push'],
      expectedFacts:   ['wsgi_app calls ctx.push() before full_dispatch_request and pops the context in a finally block'],
      expectedNoMatch: false,
      max_turns:       6,
      smoke:           true,
      author:          _SMOKE_AUTHOR,
      date:            _SMOKE_DATE,
      notes:           'Verified: src/flask/app.py:1566 wsgi_app; ctx.push() at app.py:1596; AppContext.push() at src/flask/ctx.py:416',
    },

    // ── smoke-005: no-match / easy / rust / ripgrep ─────────────────────────
    // Verified no-match: grep -rn "http_client|connection_pool|HttpClient" eval/repos/ripgrep/crates/ → 0 results
    // ripgrep is a grep tool; there is no HTTP client or connection pool.
    {
      id:              'smoke-005',
      repo:            'ripgrep',
      language:        'rust',
      stratum:         'no-match',
      difficulty:      'easy',
      query:           'Where is the HTTP connection pool implemented in ripgrep?',
      expectedFiles:   [],
      expectedSymbols: [],
      expectedFacts:   [],
      expectedNoMatch: true,
      max_turns:       4,
      smoke:           true,
      author:          _SMOKE_AUTHOR,
      date:            _SMOKE_DATE,
      notes:           'Verified no-match: 0 results for http_client/connection_pool/HttpClient in eval/repos/ripgrep/crates/ — ripgrep has no HTTP networking code',
    },
  ];
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

const _thisFile = fileURLToPath(import.meta.url);

if (process.argv[1] === _thisFile) {
  const [, , subcommand, ...rest] = process.argv;

  if (subcommand === '--smoke') {
    const probes = generateSmokeProbes();
    const result = validate(probes);
    if (!result.ok) {
      console.error('Smoke probe validation failed:');
      for (const e of result.errors) console.error(`  [${e.index}] ${e.message}`);
      process.exit(1);
    }
    const out = {
      _note: 'DRY-RUN fixtures — NOT prereg probes. These ~5 smoke probes exist solely to '
           + 'exercise the author-probes tooling. See docs/PHASE7.md §5 for the real probe '
           + 'authoring workstream (40 dev / 30 held-out / 25 vault across 10 languages).',
      probes,
    };
    const outPath = new URL('../data/p7-smoke-probes.json', import.meta.url).pathname;
    writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
    console.log(`Wrote ${probes.length} smoke probes → ${outPath}`);

  } else if (subcommand === '--validate') {
    const filePath = rest[0];
    if (!filePath) { console.error('Usage: --validate <file>'); process.exit(1); }
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    const probes = Array.isArray(raw) ? raw : (raw.probes ?? []);
    const result = validate(probes);
    if (result.ok) {
      console.log(`✓ ${probes.length} probe(s) valid`);
    } else {
      console.error(`✗ ${result.errors.length} validation error(s):`);
      for (const e of result.errors) console.error(`  [${e.index}] ${e.message}`);
      process.exit(1);
    }

  } else if (subcommand === '--split') {
    const filePath = rest[0];
    if (!filePath) { console.error('Usage: --split <file>'); process.exit(1); }
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    const probes = Array.isArray(raw) ? raw : (raw.probes ?? []);
    const split = stratifiedSplit({ probes });
    const langs = [...new Set(probes.map(p => p.language))].sort();
    console.log(JSON.stringify({
      totals: {
        dev:      split.dev.length,
        heldout:  split.heldout.length,
        vault:    split.vault.length,
        rotation: split.rotation.length,
      },
      byLanguage: Object.fromEntries(langs.map(lang => [lang, {
        dev:      split.dev.filter(p => p.language === lang).length,
        heldout:  split.heldout.filter(p => p.language === lang).length,
        vault:    split.vault.filter(p => p.language === lang).length,
        rotation: split.rotation.filter(p => p.language === lang).length,
      }])),
    }, null, 2));

  } else {
    console.log('Usage:');
    console.log('  node author-probes.mjs --smoke              # write data/p7-smoke-probes.json');
    console.log('  node author-probes.mjs --validate <file>    # validate a probe JSON file');
    console.log('  node author-probes.mjs --split <file>       # report split counts');
    process.exit(1);
  }
}
