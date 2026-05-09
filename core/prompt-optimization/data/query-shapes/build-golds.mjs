/**
 * Build core/prompt-optimization/data/query-shapes/golds.json from the two
 * single-sources-of-truth:
 *
 *   1. eval/agent-read-workflows/tasks.js — 60 hand-authored dev golds across
 *      fastify (12) + gin (12) + flask (12) + ripgrep (12) + ai-chatbot (12).
 *      The ai-chatbot repo (added 2026-05-09 per SYSTEM_PROMPT_OPT_PLAN.md
 *      §7.3) closes the TS / React / component-search shape gap that the
 *      four prior backend/CLI repos leave open.
 *   2. eval/freshstack/uv-queries.json — 30 hand-authored held-out probes on
 *      the post-cutoff astral-sh/uv repo.
 *
 * The output adds the qshape-v1 extension fields per §7.3:
 *   - predicted_winning_tool   ('ss-search' | 'ss-find' | 'ss-semantic' | 'structural')
 *   - predicted_winning_shape  (string label from the agent-instructable shape grid)
 *   - qshape_stratum           ('literal-lookup' | 'behavioral' | 'structural' | 'multi-file-flow')
 *   - tier                     ('dev' | 'heldout')
 *   - gold_authored_by         (provenance for the §11.2 independent-author check)
 *
 * Tool-affinity predictions are pre-registered in this file BEFORE the sweep
 * runs, per §7.3 ("the pre-registered prediction is the dev-only error
 * analysis input; we measure where our intuition was wrong, not which
 * intuition to confirm"). Predictions live in PREDICTIONS below.
 *
 * Stratum classification: the existing tasks.js uses a fine-grained taskType
 * vocabulary; we map it to the §7.3 4-way stratum scheme. The mapping table
 * is TASKTYPE_TO_STRATUM. Any unmapped taskType throws.
 *
 * Run: node core/prompt-optimization/data/query-shapes/build-golds.mjs
 *
 * Output is deterministic given the source files; runs in CI and the diff
 * is reviewed alongside source changes.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const TASKTYPE_TO_STRATUM = {
  // §7.3 strata: literal-lookup / behavioral / structural / multi-file-flow
  config_lookup: 'literal-lookup',
  exact_symbol_lookup: 'literal-lookup',
  no_match: 'literal-lookup',
  large_file: 'structural',
  function_behavior: 'behavioral',
  error_handling_path: 'behavioral',
  multi_file_flow: 'multi-file-flow',
};

// Pre-registered predictions per gold id. The hypothesis (preregistration.md)
// says: short+with-symbol+narrow-regex wins for ss-find/ss-search; question-
// form NL wins for ss-semantic; structural prefers a relationship verb +
// symbol. The per-gold predictions below operationalise that hypothesis.
//
// Coverage: we predict for every gold in tasks.js + uv-queries.json. A missing
// id throws when build-golds.mjs runs, so adding a new gold without a prereg
// is impossible.
const PREDICTIONS = {
  // ── fastify ─────────────────────────────────────────────────────────────
  'fastify:internal-symbols':            { tool: 'ss-find',     shape: 'short+without-symbol+narrow-regex' },
  'fastify:error-codes':                 { tool: 'ss-find',     shape: 'short+with-symbol+medium-regex' },
  'fastify:validation-pipeline':         { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'fastify:server-protocol-selection':   { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'fastify:reply-send-payload-detection':{ tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'fastify:error-handler-chain':         { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'fastify:request-lifecycle-order':     { tool: 'structural',  shape: 'short+with-symbol+relationship-verb' },
  'fastify:route-handler-bridge':        { tool: 'structural',  shape: 'short+with-symbol+relationship-verb' },
  'fastify:public-api-surface':          { tool: 'ss-semantic', shape: 'medium+without-symbol+interrogative' },
  'fastify:nonexistent-quantum-router':  { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'fastify:supported-hooks-list':        { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'fastify:request-prototype-getters':   { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },

  // ── gin ─────────────────────────────────────────────────────────────────
  'gin:radix-route-insertion':           { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'gin:next-abort':                      { tool: 'ss-find',     shape: 'short+with-symbol+medium-regex' },
  'gin:engine-struct':                   { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'gin:panic-recovery':                  { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'gin:http-dispatch':                   { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'gin:default-binding-dispatch':        { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'gin:error-type-flags':                { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'gin:router-group-struct':             { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'gin:handler-func-types':              { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'gin:response-writer-interface':       { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'gin:should-bind-pipeline':            { tool: 'structural',  shape: 'medium+with-symbol+relationship-verb' },
  'gin:render-pipeline':                 { tool: 'structural',  shape: 'medium+with-symbol+relationship-verb' },

  // ── flask ───────────────────────────────────────────────────────────────
  'flask:route-decorator':               { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'flask:app-class':                     { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'flask:make-response':                 { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'flask:http-error-dispatch':           { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'flask:secure-cookie-session':         { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  // 7 additions (P6.0-extend §7.3 stratified split: 2 literal + 3 structural + 2 multi-file)
  'flask:jsonify-location':              { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'flask:blueprint-class':               { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'flask:request-response-classes':      { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'flask:config-class':                  { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'flask:app-context-class':             { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'flask:wsgi-dispatch-flow':            { tool: 'structural',  shape: 'medium+with-symbol+relationship-verb' },
  'flask:blueprint-registration-flow':   { tool: 'structural',  shape: 'medium+with-symbol+relationship-verb' },

  // ── ripgrep ─────────────────────────────────────────────────────────────
  'ripgrep:search-config-struct':        { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'ripgrep:parallel-search':             { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'ripgrep:sink-trait':                  { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'ripgrep:locate-line-bounds':          { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'ripgrep:regex-error-kinds':           { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  // 7 additions (literal × 2, structural × 3, multi-file-flow × 2)
  'ripgrep:glob-struct-fields':              { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'ripgrep:override-set-type':               { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'ripgrep:searcher-internal-config':        { tool: 'ss-semantic', shape: 'medium+without-symbol+interrogative' },
  'ripgrep:standard-printer-builder-config': { tool: 'ss-semantic', shape: 'medium+without-symbol+interrogative' },
  'ripgrep:matcher-trait-and-regex-impl':    { tool: 'structural',  shape: 'medium+with-symbol+relationship-verb' },
  'ripgrep:walk-parallel-thread-spawn':      { tool: 'structural',  shape: 'medium+with-symbol+relationship-verb' },
  'ripgrep:run-mode-dispatch-to-worker':     { tool: 'structural',  shape: 'medium+with-symbol+relationship-verb' },

  // ── vercel/ai-chatbot ───────────────────────────────────────────────────
  // Added 2026-05-09 per §7.3. ≥6 of these 12 golds are component- or hook-
  // shaped (3 hooks + 3 components + 1 hybrid multi-file flow = 7) so the
  // per-repo stratification stresses the new shape rather than redundantly
  // testing function-name lookup. With-symbol variants for these golds use
  // TSX-canonical forms (<ChatHeader>, useArtifact()) — see build-variants.mjs.
  'ai-chatbot:default-chat-model':            { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'ai-chatbot:entitlements-config':           { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'ai-chatbot:visibility-type-export':        { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'ai-chatbot:use-artifact-hook':             { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'ai-chatbot:use-chat-visibility-hook':      { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'ai-chatbot:use-auto-resume-hook':          { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'ai-chatbot:chat-header-component':         { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'ai-chatbot:visibility-selector-component': { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'ai-chatbot:multimodal-input-component':    { tool: 'ss-find',     shape: 'short+with-symbol+narrow-regex' },
  'ai-chatbot:visibility-update-flow':        { tool: 'structural',  shape: 'medium+with-symbol+relationship-verb' },
  'ai-chatbot:chat-post-flow':                { tool: 'structural',  shape: 'medium+with-symbol+relationship-verb' },
  'ai-chatbot:document-create-flow':          { tool: 'structural',  shape: 'medium+with-symbol+relationship-verb' },

  // ── uv (held-out) ───────────────────────────────────────────────────────
  // Convention: UV-NL-* are NL behaviour questions (predict ss-search / ss-find
  // depending on symbol presence); UV-DEF-* are struct definitions (predict
  // ss-find narrow-regex with the symbol); UV-FLOW-* are multi-file flows
  // (predict structural mode); UV-ERR-* are error-class lookups (predict
  // ss-find narrow-regex with the symbol).
  'UV-NL-1': { tool: 'ss-search',   shape: 'long-NL+without-symbol+intent-verb-present' },
  'UV-NL-2': { tool: 'ss-search',   shape: 'medium+without-symbol+intent-verb-present' },
  'UV-NL-3': { tool: 'ss-search',   shape: 'long-NL+without-symbol+intent-verb-present' },
  'UV-NL-4': { tool: 'ss-search',   shape: 'medium+without-symbol+intent-verb-present' },
  'UV-NL-5': { tool: 'ss-search',   shape: 'medium+with-symbol+intent-verb-present' },
  'UV-NL-6': { tool: 'ss-search',   shape: 'medium+without-symbol+intent-verb-present' },
  'UV-NL-7': { tool: 'ss-find',     shape: 'short+without-symbol+narrow-regex' },
  'UV-NL-8': { tool: 'ss-search',   shape: 'medium+without-symbol+intent-verb-present' },
  'UV-DEF-1': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-DEF-2': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-DEF-3': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-DEF-4': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-DEF-5': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-DEF-6': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-DEF-7': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-DEF-8': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-FLOW-1': { tool: 'structural', shape: 'medium+with-symbol+relationship-verb' },
  'UV-FLOW-2': { tool: 'structural', shape: 'medium+with-symbol+relationship-verb' },
  'UV-FLOW-3': { tool: 'structural', shape: 'medium+with-symbol+relationship-verb' },
  'UV-FLOW-4': { tool: 'structural', shape: 'medium+with-symbol+relationship-verb' },
  'UV-FLOW-5': { tool: 'ss-search',  shape: 'medium+without-symbol+intent-verb-present' },
  'UV-FLOW-6': { tool: 'structural', shape: 'medium+with-symbol+relationship-verb' },
  'UV-FLOW-7': { tool: 'ss-search',  shape: 'medium+with-symbol+intent-verb-present' },
  'UV-FLOW-8': { tool: 'structural', shape: 'medium+with-symbol+relationship-verb' },
  'UV-ERR-1': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-ERR-2': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-ERR-3': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-ERR-4': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-ERR-5': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
  'UV-ERR-6': { tool: 'ss-find',    shape: 'short+with-symbol+narrow-regex' },
};

// Stratum override map. UV-* probes don't carry a taskType field; classify
// by id-prefix using the convention above.
const UV_ID_TO_STRATUM = {
  'UV-NL': 'behavioral',
  'UV-DEF': 'structural',
  'UV-FLOW': 'multi-file-flow',
  'UV-ERR': 'literal-lookup',
};

const REPO_COMMITS = {
  fastify:      '39f0f24233cf6da2fef48551f51be2f589f7d5d0',
  gin:          'd3ffc9985281dcf4d3bef604cce4e662b1a327a6',
  flask:        '7ef2946fb5151b745df30201b8c27790cac53875',
  ripgrep:      '4519153e5e461527f4bca45b042fff45c4ec6fb9',
  'ai-chatbot': '107a43a8039bb4f19d0ced4ff3445e2523d14305',
  uv:           'bb8109a3c4e57b76acaa319981911e68f4098aa6',
};

function uvStratumOf(id) {
  for (const [prefix, stratum] of Object.entries(UV_ID_TO_STRATUM)) {
    if (id.startsWith(prefix)) return stratum;
  }
  throw new Error(`uv probe id "${id}" doesn't match a known prefix`);
}

function pickPrediction(id) {
  const p = PREDICTIONS[id];
  if (!p) {
    throw new Error(
      `no pre-registered tool/shape prediction for gold "${id}". ` +
      `Per §7.3 every gold MUST have a prediction BEFORE the sweep runs. ` +
      `Add an entry to PREDICTIONS in build-golds.mjs and re-run.`
    );
  }
  return p;
}

async function loadDevTasks() {
  const tasksMod = await import(path.join(REPO_ROOT, 'eval/agent-read-workflows/tasks.js'));
  const repos = tasksMod.listRepos();
  const out = [];
  for (const repo of repos) {
    if (!REPO_COMMITS[repo]) continue;            // skip repos not pinned
    if (!['fastify', 'gin', 'flask', 'ripgrep', 'ai-chatbot'].includes(repo)) continue;
    const tasks = tasksMod.loadTasks(repo);
    for (const t of tasks) {
      const stratum = TASKTYPE_TO_STRATUM[t.taskType];
      if (!stratum) {
        throw new Error(`unmapped taskType "${t.taskType}" for ${t.id}`);
      }
      const pred = pickPrediction(t.id);
      out.push({
        id: t.id,
        repo,
        repo_commit: REPO_COMMITS[repo],
        tier: 'dev',
        qshape_stratum: stratum,
        difficulty: t.difficulty,
        query: t.question,
        expectedFiles: t.expectedFiles ?? [],
        expectedSymbols: t.expectedSymbols ?? [],
        expectedFacts: t.expectedFacts ?? [],
        expectedLineRanges: t.expectedLineRanges ?? {},
        expectedNoMatch: !!t.expectedNoMatch,
        maxTurns: t.maxTurns ?? 8,
        seedQueryId: t.seedQueryId ?? null,
        gold_authored_by: 'sweet-search-core',
        predicted_winning_tool: pred.tool,
        predicted_winning_shape: pred.shape,
        source_file: 'eval/agent-read-workflows/tasks.js',
      });
    }
  }
  return out;
}

function loadUvProbes() {
  const text = readFileSync(
    path.join(REPO_ROOT, 'eval/freshstack/uv-queries.json'),
    'utf8'
  );
  const json = JSON.parse(text);
  return json.probes.map((p) => {
    const stratum = uvStratumOf(p.id);
    const pred = pickPrediction(p.id);
    const expectedFiles = p.expectedFile
      ? [p.expectedFile]
      : (p.expectedFileAnyOf || []);
    const expectedSymbols = p.expectedSymbol
      ? [p.expectedSymbol]
      : (p.expectedSymbolAnyOf || []);
    return {
      id: p.id,
      repo: 'uv',
      repo_commit: REPO_COMMITS.uv,
      tier: 'heldout',
      qshape_stratum: stratum,
      difficulty: stratum === 'multi-file-flow' ? 'hard' : 'medium',
      query: p.query,
      expectedFiles,
      expectedSymbols,
      expectedFacts: [],
      expectedLineRanges: {},
      expectedNoMatch: false,
      maxTurns: 10,
      seedQueryId: null,
      gold_authored_by: 'sweet-search-core',
      predicted_winning_tool: pred.tool,
      predicted_winning_shape: pred.shape,
      source_file: 'eval/freshstack/uv-queries.json',
      source_notes: p.notes ?? null,
    };
  });
}

function summarise(records) {
  const byTier = {};
  const byRepo = {};
  const byStratum = {};
  const byTool = {};
  for (const r of records) {
    byTier[r.tier] = (byTier[r.tier] || 0) + 1;
    byRepo[r.repo] = (byRepo[r.repo] || 0) + 1;
    byStratum[r.qshape_stratum] = (byStratum[r.qshape_stratum] || 0) + 1;
    byTool[r.predicted_winning_tool] = (byTool[r.predicted_winning_tool] || 0) + 1;
  }
  return { total: records.length, byTier, byRepo, byStratum, byPredictedTool: byTool };
}

async function main() {
  const dev = await loadDevTasks();
  const uv = loadUvProbes();
  const records = [...dev, ...uv];

  const out = {
    schemaVersion: 1,
    runId: 'qshape-v1',
    generatedAt: new Date().toISOString(),
    pinnedFromCommit: REPO_COMMITS,
    sourceFiles: [
      'eval/agent-read-workflows/tasks.js',
      'eval/freshstack/uv-queries.json',
    ],
    summary: summarise(records),
    knownGaps: {
      _comment:
        'Per §7.3 the dev tier needs 12 golds × 5 repos = 60 stratified ' +
        '3:3:3:3 across literal-lookup / behavioral / structural / ' +
        'multi-file-flow. All five dev repos (fastify, gin, flask, ripgrep, ' +
        'ai-chatbot) and the uv held-out tier are now at target (60 dev + ' +
        '30 held-out = 90 total). The §13.7 P6.0 stop rule (<50 distinct ' +
        'golds within 17h → halt; scaled from <40/14h after ai-chatbot ' +
        'added a 5th repo) is satisfied. Of the 12 ai-chatbot golds, ≥6 ' +
        'are component- or hook-shaped (per §7.3) so the new repo stresses ' +
        'TS/React shape coverage rather than redundantly testing function-' +
        'name lookup.',
      missingPerRepo: {
        fastify: 0,
        gin: 0,
        flask: 0,
        ripgrep: 0,
        'ai-chatbot': 0,
      },
      missingTotal: 0,
    },
    records,
  };

  const outPath = path.join(__dirname, 'golds.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  process.stdout.write(`golds.json written: ${records.length} records\n`);
  process.stdout.write(JSON.stringify(out.summary, null, 2) + '\n');
}

main().catch((err) => {
  process.stderr.write(`build-golds failed: ${err.message}\n`);
  process.exit(1);
});
