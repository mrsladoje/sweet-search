#!/usr/bin/env node
/**
 * retrieval-bench-282 — the P7 code-retrieval matrix re-run on sweet-search 2.8.2 (2026-09-30).
 *
 * What changed from the June 3k matrix (scripts/budget-sweep-smoke.mjs, deleted 2026-10-03, + scripts/oc-batch.mjs):
 *   - SWEET ARM = THE SHIPPED PRODUCT HARNESS, not the bench-only M++ prompt. Per harness it gets
 *     exactly what `sweet-search init` 2.8.2 installs, through the same helpers the task bench uses:
 *       cc        .claude/rules/sweet-search.md (writeClaudeRules) + the lean harness
 *                 (installClaudeLeanHarness: agent files, settings, manifest) — written into the
 *                 bench repo for the sweet arm only and removed right after it
 *       codex     -c model_instructions_file (conflict + yt3batch2) + -c developer_instructions (rules)
 *       opencode  conflict3+todo3eff3k trim plugin/prompts + rules in an `instructions` file
 *     NATIVE ARM = the stock harness. ss-* wrappers are on PATH for the sweet arm only.
 *   - ONE FRAME, BOTH ARMS, EVERY HARNESS (FRAME below): how to finish and what to answer. It rides
 *     in the user message, so no CLAUDE.md / AGENTS.md is written into the bench repos.
 *   - Private harness state per cell: CLAUDE_CONFIG_DIR / CODEX_HOME + HOME / opencode XDG dirs under
 *     ~/.ss-eval/r282/. The operator's ~/.claude, ~/.codex and ~/.config/opencode are never loaded
 *     and ~/.claude/CLAUDE.md is never moved. Ancestor CLAUDE.md files (this repo's own) are excluded.
 *   - Probes: vault (60) + held-out (30) + OOD (40) merged = 130 per arm. The whole pool is treated
 *     as HELD-OUT: consume --report aggregates only, never per-probe rows (CLAUDE.md methodology).
 *   - Cost: token counts × list price (ideal-cost.mjs MODEL_PRICES, ledger basis
 *     'cache-write-by-ttl': each cache write at the rate of its recorded TTL) for every cell,
 *     whatever the billing (Claude Code + Codex run on subscriptions).
 *   - Real API-key cache behaviour (2026-10-01): Claude Code runs with FORCE_PROMPT_CACHING_5M=1 in
 *     BOTH arms. Without it a subscription writes at the 1-hour TTL, which no API-key user pays.
 *   - Equal cache warmth (2026-10-01): before the first scored rollout of each arm, ONE unscored
 *     warm-up request runs with that arm's exact launch config (cache-warmup.mjs). It runs from its
 *     own clone of the first repo, so the shared prefix (tools + system prompt) is warm in both arms
 *     and the per-repo part stays cold for the first question of each repo in both arms. Its cost goes
 *     to warmups.jsonl, never to runs.jsonl. The run ends with a fairness check on each arm's first
 *     wave of scored requests (--conc of them; summary.json). It exits 3 on a mismatch only for
 *     Claude Code (deterministic cache); codex / opencode (best-effort cache) get a warning.
 *     SS_CACHE_WARMUP=0 turns the warm-up off, --allow-unfair-cache keeps the exit code 0.
 *
 *   CELL=cc-sonnet55-high  node scripts/retrieval-bench-282.mjs            # run / resume one cell
 *   CELL=cc-sonnet55-high  node scripts/retrieval-bench-282.mjs --smoke    # 1 probe × 2 arms
 *   CELL=cc-sonnet55-high  node scripts/retrieval-bench-282.mjs --report   # aggregates only
 *   options: --conc 3 (default)  --ids a,b  --arms native,sweet  --tag <name>
 *   --print-exposure <dir> ($0): write the sweet arm's exact rules / harness texts to <dir> and exit
 *   --tag (final-tuning, 2026-10-01): a separate results dir, harness state dir AND clone root per
 *   tag. Separate clones = separate project roots = fresh ss-* daemons started with this run's env,
 *   so an SS_VARIANT_* switch reaches the daemon (ss-search output is formatted server-side).
 *   Plan recorded before the run: core/prompt-optimization/data/r282-PREREG.md
 *   Final run (PLAN.md §7, 2026-10-03; driver core/prompt-optimization/data/final-run/run.sh):
 *   --before-root <checkout> adds arm `before`: the product (ss-* tools, daemon code, rules, harness
 *     texts, gutter, opencode cache plugin) of an older commit, judged/scored/costed by THIS bench code
 *   --before-repos <dir> its source repos (copies of eval/repos indexed by that commit's indexer)
 *   --arm-env "<arm>:K=V,...;<arm>:K=V" per-arm env overlay   --require-index-stamp / --index-stamps <dir>
 *   Rows: gitCommit = the code the arm's product ran, benchCommit = this bench's commit.
 */
process.env.SS_ISOLATION = '0'; // Mac, unjailed — must be set before the harness modules load

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { opencodeRulesDir, applyOpencodeRepoCacheKey, applyOpencodeProductCacheKey, stageProductCachePlugin, OC_CACHE_KEY_MODES } from './lib/oc-bench-config.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = path.join(REPO, 'eval/task-completion-bench/harness');
const imp = (rel) => import(path.join(REPO, rel));

const { resolveRepoCwd, judgePanelScore, JUDGE_PANEL, normalizeJudgeUsage, AllJudgesFailedError } = await imp('core/prompt-optimization/sweep/gepa-evaluate.mjs');
const { runJudge } = await imp('eval/agent-read-workflows/judge-runner.js');
const { toRJudge, usdPanelScore, scoreUSD, composeUSD, computeRubricHash, USD_PARAMS } = await imp('core/prompt-optimization/sweep/usd-metric.mjs');
const { parseRouteMetadata } = await imp('core/search/search-format.js');
const { ISOLATION_ON } = await import(path.join(H, 'agent-jail.mjs'));
const { spawnWithTimeout, costsFromTurns, priceFor } = await import(path.join(H, 'agent-runner-shared.mjs'));
const { parseClaudeStream, excludeAncestorClaudeMd } = await import(path.join(H, 'claude-code-task-runner.mjs'));
const { turnsFromTranscript, sidechainTurnSets, addSidechainCostsChecked, selectClaudeMainCosts } = await import(path.join(H, 'claude-code-accounting.mjs'));
// Product-side harness functions (trim, rules, installers) come per arm from loadProduct() below.
const { parseCodexAgentStream, buildPrivateHome, isZeroCallStartFailure, classifyCodexCommand } = await import(path.join(H, 'codex-task-runner.mjs'));
const { opencodeUnjailedEnv, parseOpencodeStream, opencodeRunMessage, readOpencodeChildSessions, opencodeRowCosts } = await import(path.join(H, 'opencode-task-runner.mjs'));
const { WARMUP_ID, WARMUP_QUESTION, warmupEnabled, createWarmupGate, excludeWarmups, applyClaudeCacheTtl, firstRequestCacheFields, cacheFairness, cacheIsDeterministic, fairnessBanner } = await import(path.join(H, 'cache-warmup.mjs'));
const { turnsFromRollout, LEDGER_BASIS } = await import(path.join(H, 'ideal-cost.mjs'));
const { SPAWN_LEDGER_ENV, reapRoots, reapRootsSync } = await import(path.join(H, 'spawn-ledger-reap.mjs'));
const { TOOL_KIND_VERSION } = await import(path.join(H, 'shell-command-kind.mjs'));
if (ISOLATION_ON) throw new Error('SS_ISOLATION must be 0 on the Mac');

// ─── cells (agreed 2026-09-30) ─────────────────────────────────────────────────────────────────
const EVAL = path.join(os.homedir(), '.ss-eval');
const BIN = {
  cc: path.join(EVAL, 'bin-claude-2.1.281'),
  codex: path.join(EVAL, 'bin-codex-0.159.2'),
  // 1.18.4, not newer: the shipped opencode trim edits and the preflight are pinned to its text.
  opencode: path.join(EVAL, 'bin-opencode-1.18.4'),
};
const CELLS = {
  'cc-sonnet55-high':   { harness: 'cc', model: 'claude-sonnet-5-5', effort: 'high', price: 'claude-sonnet-5-5' },
  'cc-opus55-medium':   { harness: 'cc', model: 'claude-opus-5-5', effort: 'medium', price: 'claude-opus-5-5' },
  'codex-sol61-high':   { harness: 'codex', model: 'gpt-6.1-sol', effort: 'high', price: 'openai/gpt-6.1-sol' },
  // ChatGPT subscription login (`opencode auth login` → OpenAI → ChatGPT Plus/Pro), not OpenRouter.
  'oc-sol61-high':      { harness: 'opencode', model: 'openai/gpt-6.1-sol', variant: 'high', price: 'openai/gpt-6.1-sol', ocAuth: 'openai' },
  // No --variant: opencode then sends no reasoning_effort, and the DeepSeek API default is thinking
  // ON at "high" (GET /models: effort.default_level = high). deepseek-flash = DeepSeek-V4.1-Flash.
  'oc-dsflash41':       { harness: 'opencode', model: 'deepseek/deepseek-flash', variant: null, price: 'deepseek/deepseek-flash' },
};
const CELL_NAME = process.env.CELL;
const CELL = CELLS[CELL_NAME];
// No memory in any benchmarked harness (owner, 2026-10-05): a memory saved in one rollout would carry
// facts into later rollouts. Claude Code: auto memory off in both arms (the sweet installer reads
// process.env, so the product's agent file drops its memory section too). Codex: features.memories=false
// in both arms. opencode has no memory store. assertNoMemory fails a rollout that finds one anyway.
if (CELL?.harness === 'cc') process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
if (!CELL) { console.error(`CELL must be one of: ${Object.keys(CELLS).join(', ')}`); process.exit(2); }
const PRICE = priceFor(CELL.price);

// ─── args ──────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i !== -1 ? argv[i + 1] : d; };
const REPORT = argv.includes('--report');
const SMOKE = argv.includes('--smoke');
const CONC = Number(flag('--conc', 3));
const onlyIds = String(flag('--ids', '')).split(',').map(s => s.trim()).filter(Boolean);
const ARMS = String(flag('--arms', 'native,sweet')).split(',').map(s => s.trim()).filter(Boolean);
const ALLOW_UNFAIR_CACHE = argv.includes('--allow-unfair-cache');
const WARMUP_ON = warmupEnabled();
// The fairness check is strict (exit 3) only on Claude Code: Anthropic's explicit cache is
// deterministic after a warm-up. Codex and opencode use best-effort automatic prefix caching,
// which can read 0 right after a warm-up; a mismatch there is a recorded WARNING, never fatal,
// so one routing miss cannot stop retrieval-bench-282-all.sh.
const CACHE_DETERMINISTIC = cacheIsDeterministic({ harness: CELL.harness });
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || 900000);
const TAG = flag('--tag', process.env.RESULTS_TAG || '');
const STABLE_RULES_PATH = process.env.SS_BENCH_STABLE_RULES_PATH === '1';
if (TAG && !/^[a-z0-9][a-z0-9._-]*$/i.test(TAG)) { console.error(`bad --tag ${TAG}`); process.exit(2); }
const SUFFIX = `${SMOKE ? '-smoke' : ''}${TAG ? `-${TAG}` : ''}`;

const OUT = path.join(REPO, 'core/prompt-optimization/data/results', `r282-${CELL_NAME}${SUFFIX}`);
const RUNS = path.join(OUT, 'runs.jsonl');
// Warm-up requests are logged HERE and nowhere else: never in runs.jsonl, captures or any aggregate.
const WARMUPS = path.join(OUT, 'warmups.jsonl');
const SUMMARY = path.join(OUT, 'summary.json');
const CAP_DIR = path.join(OUT, 'captures');
const STATE = path.join(EVAL, 'r282', `${CELL_NAME}${SUFFIX}`);
// --interleave --armB-env "K=V,K2=V2" (final-tuning 2026-10-01): a second sweet arm `sweetB` with an env
// overlay, run INTERLEAVED with `sweet` (A, B, A, B … per probe) in one queue, so both conditions see
// the same provider/time drift. Needed because two identical Codex baselines run 25 min apart
// differed by −24.5% in cost (significant). Not wired for Claude Code (per-repo installed files).
const parseKv = (s) => Object.fromEntries(String(s || '').split(',').map(x => x.trim()).filter(Boolean).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
const ARMB_ENV = parseKv(flag('--armB-env', ''));
// --arm-env "<arm>:K=V,K2=V2;<arm>:K=V" (final run, 2026-10-03): an env overlay for ONE named arm, so
// interleaved arms can differ in a bench switch (e.g. SS_VARIANT_OC_CACHE_KEY=product for the two sweet
// arms, none for native = stock opencode).
const ARM_ENV = Object.fromEntries(String(flag('--arm-env', '')).split(';').map(x => x.trim()).filter(Boolean)
  .map(x => [x.slice(0, x.indexOf(':')), parseKv(x.slice(x.indexOf(':') + 1))]));
const envOf = (arm) => ({ ...process.env, ...(arm === 'sweetB' ? ARMB_ENV : {}), ...(ARM_ENV[arm] || {}) });
// Claude Code reads every switch from process.env (installClaudeLeanHarness / writeClaudeRules write
// per-repo files); an --armB-env overlay would never reach it and would mislabel rows and exposure.
// Run the two Claude Code arms one after the other with their own env instead.
if (CELL.harness === 'cc' && (Object.keys(ARMB_ENV).length || Object.keys(ARM_ENV).length)) { console.error('--armB-env / --arm-env are not wired for Claude Code: run the arms sequentially, each with its own env'); process.exit(2); }
// ─── the product each arm runs (final run, PLAN.md §7.2, 2026-10-03) ───────────────────────────
// native / sweet / sweetB use THIS checkout's product. `before` (--before-root <checkout of an older
// commit>) uses THAT checkout's product: its ss-* bin dir (and so its native client, daemon and
// maintainer code), its rules text, its Claude Code installer, its Codex / opencode harness texts,
// the read gutter its product picks for this harness, and its opencode cache plugin. Everything
// else — frame, stream parsers, cost accounting, judges, report — stays this checkout's, so both
// sweet arms are run, judged, scored and costed by the same bench code and only the product differs.
// `before` also gets its own clones (from --before-repos: copies of eval/repos indexed by that
// checkout's indexer), daemon registry, harness state dirs and warm-up clone, so no index, daemon or
// maintainer of one arm can serve the other.
const KNOWN_ARMS = ['native', 'sweet', 'sweetB', 'before'];
const isSweet = (arm) => arm !== 'native';
const HARNESS_KEY = { cc: 'claude-code', codex: 'codex', opencode: 'opencode' }[CELL.harness];
const gitInfo = (root) => {
  try {
    return {
      commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
    };
  } catch { return { commit: null, dirty: null }; }
};
async function loadProduct(root) {
  const im = (rel) => import(pathToFileURL(path.join(root, rel)).href);
  const HR = 'eval/task-completion-bench/harness';
  const [wr, lean, cx, oc, shared, gutter] = await Promise.all([
    im('scripts/write-claude-rules.js'), im('scripts/install-claude-lean-harness.js'),
    im(`${HR}/codex-task-runner.mjs`), im(`${HR}/opencode-task-runner.mjs`), im(`${HR}/agent-runner-shared.mjs`),
    im('core/search/gutter-form.js'),
  ]);
  const rulesFile = path.join(root, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md');
  return {
    root, ...gitInfo(root),
    ssBin: path.join(root, 'eval/agent-read-workflows/bin'),
    rules: fs.readFileSync(rulesFile, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, ''),
    gutter: gutter.HARNESS_DEFAULT_FORM?.[HARNESS_KEY] ?? 'none',
    writeClaudeRules: wr.writeClaudeRules, removeClaudeRules: wr.removeClaudeRules,
    installClaudeLeanHarness: lean.installClaudeLeanHarness, removeClaudeLeanHarness: lean.removeClaudeLeanHarness,
    codexHarnessTrim: cx.codexHarnessTrim, codexHarnessTrimArgs: cx.codexHarnessTrimArgs, codexRulesConfigArgs: cx.codexRulesConfigArgs,
    CODEX_HARNESS_TRIM_STATE_FILE: cx.CODEX_HARNESS_TRIM_STATE_FILE,
    opencodeArmHarnessTrim: oc.opencodeArmHarnessTrim, opencodeRulesInConfig: oc.opencodeRulesInConfig,
    buildMainOpencodeConfig: oc.buildMainOpencodeConfig, runOpencodePreflight: oc.runOpencodePreflight,
    OPENCODE_TRIM_REPORT: oc.OPENCODE_TRIM_REPORT, OPENCODE_RULES_FILE: oc.OPENCODE_RULES_FILE,
    sweetRulesBlock: shared.sweetRulesBlock,
  };
}
const BEFORE_ROOT_ARG = flag('--before-root', process.env.SS_BENCH_BEFORE_ROOT || '');
const THIS_PRODUCT = await loadProduct(REPO);
const BEFORE_PRODUCT = BEFORE_ROOT_ARG ? await loadProduct(path.resolve(BEFORE_ROOT_ARG)) : null;
const productOf = (arm) => (arm === 'before' ? BEFORE_PRODUCT : THIS_PRODUCT);
// The read gutter an arm's ss-* tools print: an explicit SS_READ_GUTTER wins, else the form the arm's
// own product picks for this harness (gutter-form.js HARNESS_DEFAULT_FORM). This checkout's forms are
// the values the bench pinned before (none for all three harnesses since 2026-10-03).
const gutterFor = (arm) => envOf(arm).SS_READ_GUTTER ?? productOf(arm).gutter;
{
  const bad = ARMS.filter(a => !KNOWN_ARMS.includes(a));
  if (bad.length) { console.error(`unknown arm(s) ${bad.join(', ')} (known: ${KNOWN_ARMS.join(', ')})`); process.exit(2); }
  if (ARMS.includes('before') && !BEFORE_PRODUCT) { console.error('arm "before" needs --before-root <checkout>'); process.exit(2); }
  const badEnv = Object.keys(ARM_ENV).filter(a => !KNOWN_ARMS.includes(a));
  if (badEnv.length) { console.error(`--arm-env names unknown arm(s) ${badEnv.join(', ')}`); process.exit(2); }
}
// SS_VARIANT_OC_CACHE_KEY (opencode; per arm like every SS_VARIANT_*): unset = opencode's own session-id
// keys; `repo` = bench key (per-model promptCacheKey + scripts/opencode-cache-key-plugin.mjs); `product`
// = the shipped plugin from the main checkout, listed exactly as `sweet-search init --opencode` lists it.
const ocCacheMode = (arm) => envOf(arm).SS_VARIANT_OC_CACHE_KEY || '';
// The switches still under test that change what an arm sees (SWITCHES.md): every SS_VARIANT_*.
// Stamped on each row as `variants`, next to its gitCommit.
const isArmSwitch = (k) => k.startsWith('SS_VARIANT_') || k.startsWith('SS_FIX_');
// A deleted switch (SWITCHES.md) would be ignored by the code but still stamped on the row as a
// variant: refuse it, so no run looks like an A/B that it is not.
const KEPT_SWITCHES = new Set(['SS_VARIANT_RULES_FILE', 'SS_VARIANT_OC_CACHE_KEY']);
const DELETED_OTHER = new Set(['SS_FIX_GREP_FULLLINE', 'SS_VARIANT_GREP_BROAD', 'SWEET_SEARCH_COMPACT_OUTPUT', 'SS_SIBLING_LINE', 'SS_UNREAD_ABOVE', 'SS_READ_SPAN_EXPAND', 'SS_READ_WINDOW',
  'SS_SMOKE_SEARCH_BUDGET', 'SS_SMOKE_FIND_BUDGET', 'SS_SMOKE_TRACE_BUDGET', 'SS_SMOKE_SEMANTIC_MAXTOKENS',
  'CC_PRODUCT_STEER', 'CC_PRODUCT_TOKREM', 'CC_PRODUCT_SKILLDESC', 'CC_PRODUCT_HOOKPLUG',
  'SS_NO_CMD_CONDENSE', 'SS_NO_RT_AUTHORITY', 'SS_RT_LONGYIELD', 'SS_RUNTESTS_DEDUP', 'SS_NO_ANTITHRASH']);
for (const a of KNOWN_ARMS) {
  const dead = Object.keys(envOf(a)).filter(k => (isArmSwitch(k) && !KEPT_SWITCHES.has(k)) || DELETED_OTHER.has(k));
  if (dead.length) { console.error(`[${a}] deleted switch(es) ${dead.join(', ')}: no code reads them (core/prompt-optimization/data/obs-loop/SWITCHES.md); reproduce old rows from their git commit`); process.exit(2); }
}
for (const a of KNOWN_ARMS) {
  const m = ocCacheMode(a);
  if (m && !OC_CACHE_KEY_MODES.includes(m)) { console.error(`SS_VARIANT_OC_CACHE_KEY must be one of ${OC_CACHE_KEY_MODES.join(', ')} (got "${m}")`); process.exit(2); }
}
const OC_PRODUCT = KNOWN_ARMS.some(a => ocCacheMode(a) === 'product');
if (OC_PRODUCT && CELL.harness !== 'opencode') { console.error('SS_VARIANT_OC_CACHE_KEY=product is an opencode switch'); process.exit(2); }
// The product plugin acts on the `openai` provider only; on any other provider the paid run would measure nothing.
if (OC_PRODUCT && !CELL.model.startsWith('openai/')) { console.error(`SS_VARIANT_OC_CACHE_KEY=product: ${CELL.model} is not an openai/ model; the product plugin leaves it untouched`); process.exit(2); }
// SS_VARIANT_RULES_FILE=<path relative to the repo> (final-tuning): a full alternative rules text for that
// arm (same tools; Codex / opencode). Default unset = the shipped rules.
// Claude Code reads SS_VARIANT_RULES_FILE from process.env too (getPolicyBody in
// scripts/inject-agent-instructions.js, bench-only switch used by installClaudeLeanHarness / writeClaudeRules).
const rulesFor = (arm) => {
  const f = envOf(arm).SS_VARIANT_RULES_FILE;
  if (f) return fs.readFileSync(path.resolve(REPO, f), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
  return productOf(arm).rules;
};
// ─── probes: vault + held-out + OOD, merged ───────────────────────────────────────────────────
const SETS = [
  ['vault', 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'],
  ['heldout', 'core/prompt-optimization/data/frozen/p7-heldout-probes.json'],
  ['ood', 'core/prompt-optimization/data/frozen/p7-langtransfer-probes.json'],
];
// --smoke reads the DEV probes instead (default: one gin probe), so a mechanics check never
// touches the held-out pool.
const loadSet = ([set, rel]) => {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
  return (Array.isArray(raw) ? raw : raw.probes).map(p => ({ ...p, _set: set }));
};
// --probes <file> (final-tuning r3): a probe file in the same schema instead of the r282 pool. Each
// probe's `set` field (e.g. dev / heldout) becomes the bootstrap stratum; default 'r3'.
const PROBE_FILE = flag('--probes', null);
let PROBES = SMOKE ? loadSet(['dev', 'core/prompt-optimization/data/p7-dev-probes.json'])
  : PROBE_FILE ? loadSet(['r3', path.relative(REPO, path.resolve(PROBE_FILE))]).map(p => ({ ...p, _set: p.set || 'r3' }))
  : SETS.flatMap(loadSet);
const dup = PROBES.map(p => p.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dup.length) throw new Error(`duplicate probe ids across sets: ${dup.join(',')}`);
if (onlyIds.length || SMOKE) PROBES = PROBES.filter(p => (onlyIds.length ? onlyIds : ['go-005']).includes(p.id));
// Every rollout runs in an APFS copy-on-write CLONE of its bench repo (index included) under
// ~/.ss-eval/r282-repos/<cell>/, never in eval/repos itself:
//   - no ancestor instruction file can reach the agent. The five eval/repos checkouts have an
//     EMPTY .git, so opencode walks past them to this project's own AGENTS.md (proved with a
//     sentinel file on 2026-09-30) and Claude Code 2.1.281 loads ancestor AGENTS.md/CLAUDE.md;
//   - every cell starts from the same index bytes (ss-* writes runtime state into .sweet-search/);
//   - an agent that writes a file despite the frame pollutes only its cell's clone.
// The index holds no absolute paths; ss-search output was byte-identical in a clone (3 queries).
const CLONE_ROOT = path.join(EVAL, 'r282-repos', `${CELL_NAME}${SUFFIX}`);
// The `before` arm (final run): its own clone root, cloned from --before-repos/<repo> — a copy of
// eval/repos/<repo> indexed by the before checkout's indexer (core/prompt-optimization/data/final-run/index-repos.sh).
const CLONE_ROOT_BEFORE = `${CLONE_ROOT}__before`;
const BEFORE_REPOS = path.resolve(flag('--before-repos', process.env.SS_BENCH_BEFORE_REPOS || path.join(EVAL, 'final-before-repos')));
const cloneRootOf = (arm) => (arm === 'before' ? CLONE_ROOT_BEFORE : CLONE_ROOT);
// --after-repos <dir> (final run): the after (sweet) arm's source repos — private APFS copies of eval/repos
// with its §6.1 index, so another session's ss-* use of the shared eval/repos cannot change the index
// mid-run (2026-10-04: a main-checkout daemon wrote query stats into eval/repos/r3-dgraph). Unset = eval/repos.
const AFTER_REPOS = flag('--after-repos', process.env.SS_BENCH_AFTER_REPOS || '') ? path.resolve(flag('--after-repos', process.env.SS_BENCH_AFTER_REPOS)) : null;
const sourceOf = (orig, arm) => (arm === 'before' ? path.join(BEFORE_REPOS, path.basename(orig))
  : (AFTER_REPOS && arm !== 'native' ? path.join(AFTER_REPOS, path.basename(orig)) : orig));
const cloneOf = (orig, arm = 'sweet') => path.join(cloneRootOf(arm), path.relative(REPO, orig).replace(/[\\/]/g, '__'));
// core/prompt-optimization/data/final-run/index-repos.sh stamps every index it builds:
// <stamps>/<before|after>/<repo>.json = { commit, backend, indexDigest, ... } (indexDigest: sha256 of the
// sorted .sweet-search file list with sizes — the same function as below), without the
// runtime files a maintainer writes while it runs (log, lock, queue, SQLite -shm, pid, socket).
const INDEX_RUNTIME_FILE = /(^|\/)(index-maintainer\.(log|lock)|rebuild-queue\.jsonl|[^\/]*-shm|[^\/]*\.pid|[^\/]*\.sock)$/;
const INDEX_STAMPS = path.resolve(flag('--index-stamps', process.env.SS_BENCH_INDEX_STAMPS || path.join(EVAL, 'final-run', 'index-stamps')));
const indexStampOf = (orig, arm) => { try { return JSON.parse(fs.readFileSync(path.join(INDEX_STAMPS, arm === 'before' ? 'before' : 'after', `${path.basename(orig)}.json`), 'utf8')); } catch { return null; } };
function indexDigest(src) {
  const root = path.join(src, '.sweet-search'), rows = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile() && !INDEX_RUNTIME_FILE.test(path.relative(root, f))) rows.push(`${path.relative(root, f)}\t${fs.statSync(f).size}`); } };
  walk(root); rows.sort();
  return crypto.createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 16);
}
// --require-index-stamp (final run): refuse a sweet arm whose source index has no stamp or changed since
// it was stamped, and a `before` arm whose index was built by any other commit than the before checkout.
const REQUIRE_INDEX_STAMP = argv.includes('--require-index-stamp');
function ensureClone(orig, arm = 'sweet') {
  const src = sourceOf(orig, arm);
  if ((arm === 'before' || REQUIRE_INDEX_STAMP) && !fs.existsSync(path.join(src, '.sweet-search'))) throw new Error(`[${arm}] ${src} has no .sweet-search index`);
  if (REQUIRE_INDEX_STAMP && isSweet(arm) && !fs.existsSync(cloneOf(orig, arm))) {
    const st = indexStampOf(orig, arm);
    if (!st) throw new Error(`[${arm}] ${src}: no index stamp in ${INDEX_STAMPS}; index it with final-run/index-repos.sh`);
    if (arm === 'before' && st.commit !== BEFORE_PRODUCT.commit) throw new Error(`[before] ${src}: index built by ${st.commit}, before checkout is ${BEFORE_PRODUCT.commit}`);
    const dig = indexDigest(src);
    if (st.indexDigest !== dig) throw new Error(`[${arm}] ${src}: index changed since it was stamped (digest ${dig} vs ${st.indexDigest})`);
  }
  const dst = cloneOf(orig, arm);
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(cloneRootOf(arm), { recursive: true });
    execFileSync('cp', ['-c', '-p', '-R', src, dst]);
    fs.writeFileSync(`${dst}.cloned-at`, new Date().toISOString());
    // A frozen benchmark index gets no index maintainer (the launcher starts none for a paused
    // index). The origin in eval/repos carries the pause already; this covers one that does not.
    const pauseFile = path.join(dst, '.sweet-search', 'reconcile-pause.json');
    if (fs.existsSync(path.dirname(pauseFile)) && !fs.existsSync(pauseFile)) {
      fs.writeFileSync(pauseFile, JSON.stringify({ paused: true, pausedAt: new Date().toISOString(), reason: 'frozen benchmark index' }, null, 2));
    }
  }
  return dst;
}
// A probe as one arm sees it: the `before` arm runs in its own clone.
const armProbe = (p, arm) => (arm === 'before' ? { ...p, _cwd: p._cwdBefore } : p);
// Files an agent created or changed in a clone since it was made (index/runtime dirs excluded).
function cloneDrift(dst) {
  try {
    const out = sh('find', [dst, '-newer', `${dst}.cloned-at`, '-type', 'f', '-not', '-path', '*/.sweet-search/*', '-not', '-path', '*/.claude/*', '-not', '-name', '.DS_Store']);
    return out ? out.split('\n').map(f => path.relative(dst, f)) : [];
  } catch { return []; }
}
// The warm-up's own working directory: a fresh clone of the first repo under a DIFFERENT path.
// The warm-up then writes the shared prefix (tools + system prompt, identical across repos) but not
// the per-repo part (cwd, memory path), so the first question in each repo stays cold on that part
// in BOTH arms. For the Claude Code sweet arm the product files are installed here too (see main).
const WARM_CWD = path.join(CLONE_ROOT, WARMUP_ID);
const warmCwdOf = (arm) => (arm === 'before' ? path.join(CLONE_ROOT_BEFORE, WARMUP_ID) : WARM_CWD);
const REAP_ROOTS = [CLONE_ROOT, CLONE_ROOT_BEFORE];
// Teardown of this run's ss-* daemons and index maintainers (2026-10-03). They are spawned
// detached (ppid 1), so they outlived every run: 59 were alive after 8 runs on 2026-10-02 and
// kept the load average at 40-75. Two exact matchers, both limited to this run:
//   - the spawn ledger: core records every daemon/maintainer pid started with
//     SWEET_SEARCH_SPAWN_LEDGER_DIR in the env, which only this invocation's children carry;
//   - open files: a process holding a file under CLONE_ROOT (this cell + tag only) — catches a
//     daemon left by an earlier invocation of the same tag.
// The owner's own daemons have neither the env var nor a file under CLONE_ROOT.
const SPAWN_LEDGER_DIR = path.join(STATE, 'spawn-ledger', String(process.pid));
process.env[SPAWN_LEDGER_ENV] = SPAWN_LEDGER_DIR;
// One daemon registry per cell (2026-10-03). The registry (the resident-daemon cap, 3 in the
// ss-* shims, and the maintainer RSS coordinator) lives in ~/.cache/sweet-search, which every
// cell's private HOME links to. One cell's daemons then /stop another cell's: r282 diet1 Codex
// r1 typedoc found its warmed daemon gone while other cells started theirs, cold-started it
// under load, and 5 searches were refused.
process.env.SWEET_SEARCH_RUNTIME_DIR ??= path.join(STATE, 'runtime');
async function reapCloneDaemons(label) {
  const killed = await reapRoots({ ledgerDir: SPAWN_LEDGER_DIR, roots: REAP_ROOTS });
  if (killed.length) console.error(`  [reap] ${label}: stopped ${killed.length} ss-* process(es): ${killed.map(k => `${k.comm}(${k.pid})`).join(', ')}`);
}
process.on('exit', () => { try { reapRootsSync({ ledgerDir: SPAWN_LEDGER_DIR, roots: REAP_ROOTS }); fs.rmSync(SPAWN_LEDGER_DIR, { recursive: true, force: true }); } catch { /* */ } });
function recreateWarmupClone(orig, arm = 'sweet') {
  const dst = warmCwdOf(arm);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(cloneRootOf(arm), { recursive: true });
  execFileSync('cp', ['-c', '-p', '-R', sourceOf(orig, arm), dst]);
}
// Grouped by repo so concurrent rollouts share warm ss-* servers; the same order for both arms.
PROBES = PROBES.map(p => ({ ...p, _orig: resolveRepoCwd(p, {}) })).map(p => ({ ...p, _cwd: cloneOf(p._orig), _cwdBefore: cloneOf(p._orig, 'before') }))
  .sort((a, b) => a._cwd.localeCompare(b._cwd) || a.id.localeCompare(b.id));

// ─── the frame: both arms, every harness, byte-identical ──────────────────────────────────────
export const FRAME = [
  'You are answering a question about the code in the repository in your current working directory.',
  'Work read-only: do not create, edit or delete any file. Use only this repository — not the web, and not its git history. Do not open anything under .sweet-search/.',
  'Stop as soon as your evidence covers the answer. Then give your final answer in this form:',
  '- the file path(s) and symbol(s) that answer the question;',
  '- one to three sentences on how they answer it.',
  'If the repository does not contain what the question asks for, answer "No match found." and say in one sentence what you checked.',
].join('\n');
const promptFor = (probe) => `${FRAME}\n\nQuestion: ${probe.query}`;

// ─── helpers ───────────────────────────────────────────────────────────────────────────────────
// The code every row ran (2026-10-03: switches are deleted once decided, so a row is reproduced from its commit).
const GIT_COMMIT = (() => {
  try {
    const head = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '';
    return { commit: head, dirty };
  } catch { return { commit: null, dirty: null }; }
})();
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const harnessVersion = () => { try { return sh(path.join(BIN[CELL.harness], { cc: 'claude', codex: 'codex', opencode: 'opencode' }[CELL.harness]), ['--version']).split('\n')[0]; } catch { return null; } };
const baseEnv = (sweet, cwd, arm = sweet ? 'sweet' : 'native') => {
  const env = {
    ...envOf(arm),
    PATH: [BIN[CELL.harness], sweet ? productOf(arm).ssBin : null, process.env.PATH].filter(Boolean).join(':'),
    SWEET_SEARCH_PROJECT_ROOT: cwd,
    SWEET_SEARCH_OFFLINE: '1',
    // The `before` arm's daemons register in their own registry: neither product can /stop or
    // count the other's daemons (the cap and the maintainer RSS coordinator live there).
    ...(arm === 'before' ? { SWEET_SEARCH_RUNTIME_DIR: path.join(STATE, 'runtime-before') } : {}),
  };
  // The daemon entry must come from the arm's own checkout (the native client and the JS fallback
  // both resolve it next to themselves); an inherited override would point both arms at one checkout.
  delete env.SWEET_SEARCH_SERVER_ENTRY;
  return env;
};
const warmup = (cwd, arm = 'sweet') => { try { execFileSync(path.join(productOf(arm).ssBin, 'ss-search'), ['warmup', '-k', '1'], { cwd, env: baseEnv(true, cwd, arm), stdio: 'ignore', timeout: 180000 }); } catch { /* best-effort */ } };

// One normalized call shape for every harness: { kind, command, text, isError }.
// CAPTURE_VERSION 2 (2026-10-03): `kind` comes from shell-command-kind.mjs, so an ss-* tool inside a
// compound shell command (`cd <dir>; ss-grep …`) is `ss` (it was `bash` in Claude Code and opencode,
// and its output reached neither rawResponse nor the capture), and captures keep every call's full
// text. ssCalls, ssDeliveredTokens, ssDeliveredChars, rawLen and the USD content metric change with
// it: never pool rows with captureVersion 2 and rows without it.
const CAPTURE_VERSION = TOOL_KIND_VERSION;
const SS_RE = /(^|\/)(ss[-_](search|grep|find|read|semantic|trace|batch))\b/;
function responseFor(calls, sweet) {
  // Same rule as the June matrix (budget-sweep-smoke buildArmResponse): sweet = ss-* output + reads;
  // native = every search/read/shell output. Feeds the useful-content (USD) metric only.
  const blocks = [];
  for (const c of calls) {
    if (!c.text || !c.text.trim() || c.kind === 'edit') continue;
    if (sweet) { if (c.kind === 'ss' || c.kind === 'nativeRead') blocks.push(c.kind === 'ss' ? c.text : `${c.command}\n${c.text}`); }
    else blocks.push(`$ ${c.command}\n${c.text}`);
  }
  return blocks.join('\n\n');
}
function ssDelivered(calls) {
  const per = [];
  for (const c of calls) {
    if (c.kind !== 'ss' || typeof c.text !== 'string') continue;
    const out = c.text; let m;
    const rm = parseRouteMetadata(out);
    if (rm && Number.isFinite(rm.tokenBudget) && Number.isFinite(rm.tokensUsed)) per.push({ tool: 'ss-search', used: rm.tokensUsed });
    else if ((m = out.match(/^# ss-find:.* budget=(\d+) used=(\d+)/m))) per.push({ tool: 'ss-find', used: +m[2] });
    else if ((m = out.match(/<<SS_TRACE_META>>(\{.*\})/))) { try { per.push({ tool: 'ss-trace', used: JSON.parse(m[1]).tokensUsed }); } catch {} }
    else per.push({ tool: 'ss-other', used: Math.round(out.length / 4) });
  }
  return per;
}
async function scoreUsd(probe, rawResponse, arm) {
  try {
    const rJudge = toRJudge(rawResponse, arm);
    const needPanel = !probe.expectedNoMatch && !!rJudge.trim();
    const [panelCorrectness, panel] = await Promise.all([
      judgePanelScore({ probe, answer: rJudge, panel: JUDGE_PANEL }).then(r => r.score).catch(() => null),
      needPanel ? usdPanelScore({ probe, rJudge, panel: JUDGE_PANEL, runJudgeFn: runJudge, normalizeUsageFn: normalizeJudgeUsage, AllJudgesFailedError }).then(r => r.panel).catch(() => []) : Promise.resolve([]),
    ]);
    const sc = scoreUSD({ probe, rawResponse, arm, panel, panelCorrectness, rubricHash: computeRubricHash(USD_PARAMS) });
    const usdNoC = probe.expectedNoMatch ? sc.USD : composeUSD({ g: sc.grounding, signalPurity: 1, content: sc.content, purity_ratio: sc.purity_ratio }, USD_PARAMS);
    return { USD: sc.USD, USD_noC: usdNoC, grounding: sc.grounding, content: sc.content, content_noD3: sc.content_noD3, purity_ratio: sc.purity_ratio, usdTokens: sc.total_tokens };
  } catch (e) { return { usdError: e.message }; }
}

// Cache-write ledger columns carried on every priced row (ideal-cost.mjs 'cache-write-by-ttl').
const cacheLedgerFields = (c) => ({
  ledgerBasis: LEDGER_BASIS,
  costRealizedFlat125Usd: c.costRealizedFlat125Usd ?? null,
  cacheWriteTokens: c.cacheWriteTokens ?? null, cacheWriteTokens5m: c.cacheWriteTokens5m ?? null,
  cacheWriteTokens1h: c.cacheWriteTokens1h ?? null, cacheWriteUnsplitTokens: c.cacheWriteUnsplitTokens ?? null,
});

// ─── Claude Code ───────────────────────────────────────────────────────────────────────────────
function loadClaudeToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const f = path.join(EVAL, 'claude-sub.env');
  const m = fs.existsSync(f) && fs.readFileSync(f, 'utf8').match(/^CLAUDE_CODE_OAUTH_TOKEN=(.+)$/m);
  if (!m) throw new Error(`no CLAUDE_CODE_OAUTH_TOKEN (env or ${f})`);
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}
// One private config dir per arm, shared by that arm's concurrent sessions (like a user running
// several sessions). The lean harness writes this dir's memory path into the repo's agent file,
// so it must be the same dir for every rollout of the arm.
const claudeHome = (arm) => { const d = path.join(STATE, `claude-home-${arm}`); fs.mkdirSync(d, { recursive: true }); return d; };

// Sweet-arm install into the bench repos = what `init` writes for Claude Code. Snapshot first,
// refuse to touch a repo that already has .claude/ product files, and remove them after the arm.
// Since V1b (2026-10-01, the product default after 2.8.2) the rules ride in the lean agent file and the
// rules file is the short pointer, exactly as init installs them (lean harness first, then the
// rules file by its result).
const CLAUDE_PRODUCT_FILES = ['.claude/rules/sweet-search.md', '.claude/agents/sweet-search.md', '.claude/agents/general-purpose.md', '.claude/agents/Plan.md', '.claude/sweet-search-harness.json'];
function installClaudeProduct(cwds, home, product = THIS_PRODUCT) {
  const installed = [];
  for (const cwd of cwds) {
    const pre = CLAUDE_PRODUCT_FILES.filter(f => fs.existsSync(path.join(cwd, f)));
    if (pre.length) throw new Error(`${cwd} already has ${pre.join(', ')} — clean it before the run`);
    const settings = path.join(cwd, '.claude/settings.json');
    const settingsBefore = fs.existsSync(settings) ? fs.readFileSync(settings) : null;
    const claudeDirExisted = fs.existsSync(path.join(cwd, '.claude'));
    installed.push({ cwd, settings, settingsBefore, claudeDirExisted, product });
    const lean = product.installClaudeLeanHarness({ projectRoot: cwd, configDir: home, visibleConfigDir: home });   // reads SS_VARIANT_RULES_FILE from process.env, as init does
    if (lean.active !== true) throw new Error(`lean harness not active in ${cwd}: ${lean.status} ${lean.detail}`);
    if (lean.rulesInPrompt !== true) throw new Error(`rules placement mismatch in ${cwd}: rulesInPrompt=${lean.rulesInPrompt}`);
    const rules = product.writeClaudeRules({ projectRoot: cwd, layout: 'pointer', memoryDir: lean.memoryDir });
    if (rules !== 'created') throw new Error(`rules not created in ${cwd}: ${rules}`);
  }
  return installed;
}
function uninstallClaudeProduct(installed) {
  for (const it of installed) {
    try { it.product.removeClaudeLeanHarness({ projectRoot: it.cwd }); } catch {}
    try { it.product.removeClaudeRules({ projectRoot: it.cwd }); } catch {}
    try { if (it.settingsBefore == null) fs.rmSync(it.settings, { force: true }); else fs.writeFileSync(it.settings, it.settingsBefore); } catch {}
    for (const d of ['.claude/rules', '.claude/agents']) { try { fs.rmdirSync(path.join(it.cwd, d)); } catch {} }
    if (!it.claudeDirExisted) { try { fs.rmdirSync(path.join(it.cwd, '.claude')); } catch {} }
    const left = CLAUDE_PRODUCT_FILES.filter(f => fs.existsSync(path.join(it.cwd, f)));
    if (left.length) console.error(`  [WARN] ${it.cwd}: product files left behind: ${left.join(', ')}`);
  }
}

async function runClaude(probe, sweet, arm) {
  const cwd = probe._cwd;
  const home = claudeHome(arm);
  // Ancestor instruction files: the bench repos live INSIDE this project, whose own CLAUDE.md and
  // AGENTS.md (2.1.281 loads AGENTS.md too) reached both arms in the first smoke. Exclude both kinds.
  const settingsPath = path.join(home, 'settings.json');
  const patterns = excludeAncestorClaudeMd(settingsPath, cwd);
  const agentsMd = patterns.filter(p => p.endsWith(`${path.sep}CLAUDE.md`) && !p.includes(`${path.sep}.claude${path.sep}`)).map(p => p.replace(/CLAUDE\.md$/, 'AGENTS.md'));
  const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  s.claudeMdExcludes = [...s.claudeMdExcludes, ...agentsMd];
  fs.writeFileSync(settingsPath, `${JSON.stringify(s, null, 2)}\n`);
  const env = {
    ...baseEnv(sweet, cwd, arm),
    CLAUDE_CONFIG_DIR: home,
    CLAUDE_CODE_OAUTH_TOKEN: loadClaudeToken(),
    IS_SANDBOX: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    SS_READ_GUTTER: gutterFor(arm), // the arm's product form for claude-code (gutter-form.js): none since 2026-10-02, tab before
  };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) delete env[k];
  // Diagnostics only: route Claude Code through a local logging proxy to dump the exact request bodies.
  if (process.env.SS_BENCH_CC_CAPTURE_BASE_URL) env.ANTHROPIC_BASE_URL = process.env.SS_BENCH_CC_CAPTURE_BASE_URL;
  // Both arms: the 5-minute cache TTL an API-key user gets (a subscription writes at 1 hour).
  applyClaudeCacheTtl(env);
  const args = ['-p', '--model', CELL.model, '--effort', CELL.effort, '--permission-mode', 'bypassPermissions',
    '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
  const t0 = Date.now();
  const once = () => spawnWithTimeout(path.join(BIN.cc, 'claude'), args, { cwd, env, timeoutMs: TIMEOUT_MS, stdinText: promptFor(probe) });
  let r = await once(); let p = parseClaudeStream(r.stdout); let startRetried = false;
  if (isZeroCallStartFailure(r, p.toolCalls, p.answer) && !p.accountFatal) { startRetried = true; r = await once(); p = parseClaudeStream(r.stdout); }
  if (p.accountFatal) throw Object.assign(new Error(`ACCOUNT FATAL: ${p.accountFatal}`), { fatal: true });
  assertNoMemory(home, cwd);
  const wallMs = Date.now() - t0;
  // Sidechain-inclusive cost (the task-bench contract): main context + every subagent transcript.
  const main = selectClaudeMainCosts({ streamTurns: p.turns, transcriptTurns: turnsFromTranscript(home, p.sessionId), resultUsage: p.resultUsage, price: PRICE });
  const side = sidechainTurnSets(home, p.sessionId);
  const costs = addSidechainCostsChecked(main.costs, side, PRICE);
  return {
    calls: p.toolCalls.map(c => ({ kind: c.kind, command: c.command, text: c.resultText, isError: c.isError })),
    answer: p.answer, wallMs, exitCode: r.exitCode, timedOut: r.timedOut, startRetried,
    usage: p.resultUsage, costSource: main.source, subagentContexts: side.length,
    costRealizedUsd: costs.costRealizedUsd ?? null, costNaiveUsd: costs.costNaiveUsd ?? null,
    costRealizedLowerBoundUsd: costs.costRealizedLowerBoundUsd ?? null,
    ...cacheLedgerFields(costs), ...firstRequestCacheFields(main.turns), cacheTtl: '5m-forced',
    costAccountingComplete: costs.sidechainAccountingComplete !== false,
    errors: p.errors.slice(0, 3), stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}

// ─── Codex ─────────────────────────────────────────────────────────────────────────────────────
// Private CODEX_HOME + HOME per cell (no operator config.toml, AGENTS.md, skills or memories).
// The ChatGPT login is copied in, and written back after every rollout if codex refreshed it —
// otherwise the master keeps a spent single-use refresh token (the 2026-08-17 auth-decay trap).
const MASTER_AUTH = path.join(os.homedir(), '.codex', 'auth.json');
function codexHome() {
  const home = path.join(STATE, 'codex-home'); fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.toml'), '[features]\nsuppress_unstable_features_warning = true\n');
  if (!fs.existsSync(path.join(home, 'auth.json'))) { fs.copyFileSync(MASTER_AUTH, path.join(home, 'auth.json')); fs.chmodSync(path.join(home, 'auth.json'), 0o600); }
  const phome = buildPrivateHome(path.join(STATE, 'home'), { realHome: os.homedir(), codexHome: home });
  return { home, phome };
}
function codexSyncAuthBack(home) {
  const local = path.join(home, 'auth.json');
  try {
    const a = fs.readFileSync(local), b = fs.readFileSync(MASTER_AUTH);
    if (!a.equals(b) && fs.statSync(local).mtimeMs > fs.statSync(MASTER_AUTH).mtimeMs) {
      const tmp = `${MASTER_AUTH}.tmp-${process.pid}`; fs.writeFileSync(tmp, a, { mode: 0o600 }); fs.renameSync(tmp, MASTER_AUTH);
    }
  } catch { /* nothing to sync */ }
}
// Per-request usage of ONE codex rollout, found by the thread id in the stream's thread.started
// event (the rollout file is named rollout-<time>-<thread id>.jsonl). Concurrent rollouts share a
// cwd, so the thread id is the only unambiguous key. [] when it cannot be found: the fairness
// check then reads the arm as unmeasured instead of guessing.
function codexRolloutFile(home, stdout) {
  const id = /"thread_id"\s*:\s*"([^"]+)"/.exec(stdout || '')?.[1];
  if (!id) return null;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { const hit = walk(f); if (hit) return hit; }
      else if (e.name.endsWith(`-${id}.jsonl`)) return f;
    }
    return null;
  };
  return walk(path.join(home, 'sessions'));
}
// Codex offers collaboration tools (spawn_agent, followup_task, ...). A spawned agent is a separate
// thread whose usage is NOT in this rollout's turn.completed usage, and this bench does not price it.
// Count the calls in the main rollout so a row that delegated is published cost-incomplete (fail
// closed) instead of main-only. null = rollout not found. The 2026-10 final run made 0 such calls.
const CODEX_COLLAB_TOOLS = new Set(['spawn_agent', 'followup_task', 'send_message', 'wait_agent', 'interrupt_agent', 'list_agents']);
function codexSubagentCalls(home, stdout) {
  try {
    const file = codexRolloutFile(home, stdout);
    if (!file) return null;
    let n = 0;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('function_call')) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      const pl = ev.payload || {};
      if ((pl.type === 'function_call' || pl.type === 'custom_tool_call') && CODEX_COLLAB_TOOLS.has(String(pl.name || '').split('.').pop())) n++;
    }
    return n;
  } catch { return null; }
}
function codexRolloutTurns(home, stdout) {
  try {
    const id = /"thread_id"\s*:\s*"([^"]+)"/.exec(stdout || '')?.[1];
    if (!id) return [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) { const hit = walk(f); if (hit) return hit; }
        else if (e.name.endsWith(`-${id}.jsonl`)) return f;
      }
      return null;
    };
    const file = walk(path.join(home, 'sessions'));
    return file ? turnsFromRollout(file) : [];
  } catch { return []; }
}
// Any memory a harness saved: Claude Code <home>/projects/*/memory/*, Codex <home>/memories/*, and
// MEMORY.md / CLAUDE.md / AGENTS.md / GEMINI.md written into the clone. Throws so the rollout is an error row.
function assertNoMemory(home, cwd) {
  const found = [];
  const list = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
  for (const p of list(path.join(home, 'projects'))) for (const f of list(path.join(home, 'projects', p.name, 'memory'))) found.push(path.join('projects', p.name, 'memory', f.name));
  for (const f of list(path.join(home, 'memories'))) found.push(path.join('memories', f.name));
  for (const f of ['MEMORY.md', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.claude/CLAUDE.md']) if (fs.existsSync(path.join(cwd, f))) found.push(`clone:${f}`);
  if (found.length) throw new Error(`MEMORY FOUND (no memory allowed in a benchmark): ${found.join(', ')}`);
}
async function runCodex(probe, sweet, arm) {
  const cwd = probe._cwd;
  const { home, phome } = codexHome();
  const stateDir = fs.mkdtempSync(path.join(STATE, 'codex-state-'));
  const P = productOf(arm);
  const trim = P.codexHarnessTrim({ sweet, model: `openai/${CELL.model}`, env: envOf(arm) });
  const trimArgs = sweet ? [...P.codexHarnessTrimArgs(trim, stateDir, { model: `openai/${CELL.model}` }), ...P.codexRulesConfigArgs(rulesFor(arm))] : [];
  const env = { ...baseEnv(sweet, cwd, arm), CODEX_HOME: home, HOME: phome, SS_READ_GUTTER: gutterFor(arm) };
  delete env.OPENAI_API_KEY;
  const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--json',
    '-c', `model_reasoning_effort="${CELL.effort}"`, '-c', 'features.memories=false', ...trimArgs, '-m', CELL.model, '-C', cwd, '-'];
  const t0 = Date.now();
  const once = () => spawnWithTimeout(path.join(BIN.codex, 'codex'), args, { cwd, env, timeoutMs: TIMEOUT_MS, stdinText: promptFor(probe) });
  let r = await once(); let p = parseCodexAgentStream(r.stdout); let startRetried = false;
  if (isZeroCallStartFailure(r, p.toolCalls, p.answer)) { startRetried = true; r = await once(); p = parseCodexAgentStream(r.stdout); }
  codexSyncAuthBack(home);
  assertNoMemory(home, cwd);
  fs.rmSync(stateDir, { recursive: true, force: true });
  const errText = p.errors.join(' ');
  if (/refresh token|usage limit|log ?in|unauthorized|401/i.test(errText) && !p.toolCalls.length) throw Object.assign(new Error(`ACCOUNT FATAL: ${errText.slice(0, 200)}`), { fatal: true });
  const u = p.usage || {};
  const inTok = u.input_tokens || 0, cached = u.cached_input_tokens || 0, out = u.output_tokens || 0;
  const firstReq = firstRequestCacheFields(codexRolloutTurns(home, r.stdout));
  const spawns = codexSubagentCalls(home, r.stdout);
  const costsComplete = spawns == null ? null : spawns === 0; // null = rollout not found (unknown)
  return {
    ...firstReq, subagentSpawnCalls: spawns, costAccountingComplete: costsComplete,
    calls: p.toolCalls.map(c => ({ kind: classifyCodexCommand(c.input?.command || '').kind, command: c.input?.command || '', text: c.result?.content || '', isError: c.result?.isError })),
    answer: p.answer, wallMs: Date.now() - t0, exitCode: r.exitCode, timedOut: r.timedOut, startRetried, usage: u,
    harnessTrim: trim.mode || null,
    // OpenAI charges no cache-write premium: realized = fresh input + cached input + output.
    // Same figure on every basis (no write is charged), so the flat column equals it.
    ledgerBasis: LEDGER_BASIS,
    costRealizedFlat125Usd: ((inTok - cached) * PRICE.in + cached * PRICE.cache + out * PRICE.out) / 1e6,
    // A delegating row is cost-incomplete: inclusive columns null, main-only figure as the lower bound.
    costRealizedUsd: spawns > 0 ? null : ((inTok - cached) * PRICE.in + cached * PRICE.cache + out * PRICE.out) / 1e6,
    costNaiveUsd: spawns > 0 ? null : (inTok * PRICE.in + out * PRICE.out) / 1e6,
    costRealizedLowerBoundUsd: ((inTok - cached) * PRICE.in + cached * PRICE.cache + out * PRICE.out) / 1e6,
    costSource: 'turn.completed', errors: p.errors.slice(0, 3), stderrPreview: String(r.stderr || '').replace(/^Reading additional input from stdin\.\.\.\s*/, '').slice(0, 300),
  };
}

// ─── opencode ──────────────────────────────────────────────────────────────────────────────────
// Subscription login for a cell (CELL.ocAuth): the operator's opencode auth entry is copied into the
// private data dir, and a refreshed entry is written back after each rollout (OAuth refresh tokens are
// single-use — the codex auth-decay trap). Only that provider's entry is ever touched.
const MASTER_OC_AUTH = path.join(os.homedir(), '.local/share/opencode/auth.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
function ocSeedAuth(ocData, provider) {
  const local = path.join(ocData, 'auth.json');
  const entry = readJson(MASTER_OC_AUTH)?.[provider];
  if (!entry) throw Object.assign(new Error(`no ${provider} login in ${MASTER_OC_AUTH} — run: opencode auth login`), { fatal: true });
  const mine = readJson(local)?.[provider];
  // Keep the local copy unless the master holds a newer one (the other arm refreshed it).
  if (mine && (mine.expires ?? 0) >= (entry.expires ?? 0)) return;
  fs.writeFileSync(local, JSON.stringify({ [provider]: entry }, null, 2), { mode: 0o600 });
}
function ocSyncAuthBack(ocData, provider) {
  const mine = readJson(path.join(ocData, 'auth.json'))?.[provider];
  const master = readJson(MASTER_OC_AUTH);
  if (!mine || !master || JSON.stringify(master[provider]) === JSON.stringify(mine)) return;
  if ((mine.expires ?? 0) < (master[provider]?.expires ?? 0)) return; // master is already newer
  const tmp = `${MASTER_OC_AUTH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ ...master, [provider]: mine }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, MASTER_OC_AUTH);
}
async function runOpencode(probe, sweet, arm) {
  const cwd = probe._cwd;
  const stateDir = fs.mkdtempSync(path.join(STATE, 'oc-state-'));
  const P = productOf(arm);
  const ocDir = arm === 'before' ? 'before' : (sweet ? 'sweet' : 'native');
  const ocData = path.join(STATE, `oc-data-${ocDir}`); fs.mkdirSync(ocData, { recursive: true });
  if (CELL.ocAuth) ocSeedAuth(ocData, CELL.ocAuth);
  let trim = P.opencodeArmHarnessTrim({ sweet, env: envOf(arm), apiModel: CELL.model.replace(/^openrouter\//, ''), stateDir });
  // SS_BENCH_STABLE_RULES_PATH=1 (final-tuning, 2026-10-01): the rules file lives at ONE path per run
  // instead of the per-rollout mkdtemp dir. opencode prints "Instructions from: <absolute path>" into
  // the system prompt, so the random dir broke the provider's prefix cache on every sweet rollout
  // (r282 DeepSeek sweet req-0 cache hit 24% vs native 86%). The product (`init`) uses the stable
  // project path .opencode/sweet-search.md, so the stable path is the production-faithful setting.
  // The directory is chosen by the rules TEXT (oc-rules-<sha8>), not by the arm: two arms with identical
  // rules then send the identical `Instructions from:` line and share the provider prefix cache (the old
  // oc-rules / oc-rules-B split cut the shared prefix at about 2,150 developer tokens; STATS-HARD S4).
  const rulesText = sweet ? P.sweetRulesBlock({ mppText: rulesFor(arm) }) : null;
  const rulesDir = opencodeRulesDir({ stable: STABLE_RULES_PATH, stateRoot: STATE, stateDir, rulesText });
  trim = P.opencodeRulesInConfig(trim, { rules: rulesText, stateDir: rulesDir });
  if (STABLE_RULES_PATH && sweet) {
    fs.mkdirSync(rulesDir, { recursive: true });
    const f = path.join(rulesDir, P.OPENCODE_RULES_FILE), txt = trim.files[P.OPENCODE_RULES_FILE];
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== txt) { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, txt); fs.renameSync(tmp, f); }
  }
  for (const [name, text] of Object.entries(trim.files || {})) fs.writeFileSync(path.join(stateDir, name), text);
  let cfg = P.buildMainOpencodeConfig({ trim });
  cfg.provider = { ...cfg.provider, deepseek: { options: { apiKey: '{env:DEEPSEEK_API_KEY}' } } };
  // SS_VARIANT_OC_CACHE_KEY=repo (final-tuning S4): opencode sends promptCacheKey = session id and the
  // headers session-id / x-session-affinity / X-Session-Id = session id, so every rollout routes to its own
  // provider cache although the prefix is byte-identical. The switch sets ONE value per repo in both places:
  // promptCacheKey as a per-model option, the headers through scripts/opencode-cache-key-plugin.mjs.
  // SS_VARIANT_OC_CACHE_KEY=product: ONLY the product plugin (staged from main at run start), appended
  // after the trim plugin with no options, as init writes it. Its key: sha256 of opencode's worktree, or
  // of the --dir when opencode reports worktree "/" (a .git without commits) — one value per clone.
  let extraPlugins = [];
  if (ocCacheMode(arm) === 'repo') {
    const r = applyOpencodeRepoCacheKey(cfg, { model: CELL.model, cwd });
    cfg = r.cfg; extraPlugins = [r.plugin];
  } else if (ocCacheMode(arm) === 'product') {
    const r = applyOpencodeProductCacheKey(cfg, { plugin: OC_PRODUCT_PLUGINS[arm].plugin });
    cfg = r.cfg; extraPlugins = [r.plugin];
  }
  const cfgPath = path.join(stateDir, 'opencode.json'); fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const env = {
    ...baseEnv(sweet, cwd, arm),
    ...opencodeUnjailedEnv({ root: path.join(STATE, `oc-home-${ocDir}`), ocData }),
    OPENCODE_CONFIG: cfgPath, SS_READ_GUTTER: gutterFor(arm), // the arm's product form for opencode (gutter-form.js): none since 2026-10-03, colon before
  };
  if (CELL.ocAuth === 'openai') delete env.OPENAI_API_KEY; // the subscription login must pay, never a key
  await P.runOpencodePreflight({ cwd, env, plugins: [...(trim.plugins || []), ...extraPlugins] });
  const args = ['run', '--format', 'json', '--agent', 'build', '--auto', '--model', CELL.model, ...(CELL.variant ? ['--variant', CELL.variant] : []), '--dir', cwd];
  const t0 = Date.now();
  const once = () => spawnWithTimeout(path.join(BIN.opencode, 'opencode'), args, { cwd, env, timeoutMs: TIMEOUT_MS, stdinText: opencodeRunMessage(promptFor(probe)) });
  let r = await once(); let p = parseOpencodeStream(r.stdout); let startRetried = false;
  if (isZeroCallStartFailure(r, p.toolCalls, p.answer)) { startRetried = true; r = await once(); p = parseOpencodeStream(r.stdout); }
  if (CELL.ocAuth) ocSyncAuthBack(ocData, CELL.ocAuth);
  assertNoMemory(path.join(STATE, `oc-home-${ocDir}`), cwd); // opencode keeps no memory store; this checks the clone
  const trimReport = path.join(stateDir, P.OPENCODE_TRIM_REPORT);
  const trimApplied = trim.mode ? fs.existsSync(trimReport) : null;
  fs.rmSync(stateDir, { recursive: true, force: true });
  // Sidechain-inclusive cost (2026-10-04): the stream holds only the main session; every `task`
  // subagent ran in a child session that only the session DB records. Unreadable DB → the row is
  // cost-incomplete (inclusive columns null), never silently main-only.
  let childSets = null;
  try { childSets = p.sessionID ? readOpencodeChildSessions(path.join(ocData, 'opencode.db'), p.sessionID) : (p.turns.length ? null : []); } catch { childSets = null; }
  const { costs, fields: costFields } = opencodeRowCosts({ mainTurns: p.turns, childSets, price: PRICE });
  return {
    calls: p.toolCalls.map(c => ({ kind: c.kind, command: c.command, text: c.resultText, isError: c.isError })),
    answer: p.answer, wallMs: Date.now() - t0, exitCode: r.exitCode, timedOut: r.timedOut, startRetried,
    sessionID: p.sessionID,
    ...cacheLedgerFields(costs), ...firstRequestCacheFields(p.turns),
    harnessTrim: trim.mode || null, harnessTrimApplied: trimApplied,
    ...costFields, costSource: 'step_finish+child_sessions',
    errors: p.errors.slice(0, 3), stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}

// ─── warm-up (cache-warmup.mjs) ────────────────────────────────────────────────────────────────
const launch = (probe, arm) => {
  const sweet = isSweet(arm);
  return CELL.harness === 'cc' ? runClaude(probe, sweet, arm)
    : CELL.harness === 'codex' ? runCodex(probe, sweet, arm)
    : runOpencode(probe, sweet, arm);
};
// ONE unscored request with the arm's exact launch config (same binary, prompt, rules, tools, env,
// model and effort; only the question differs). The returned entry goes to warmups.jsonl.
async function runWarmup(arm) {
  const probe = { id: WARMUP_ID, query: WARMUP_QUESTION, _set: 'warmup', _cwd: warmCwdOf(arm) };
  const run = await launch(probe, arm);
  if (run.timedOut || run.exitCode !== 0) throw new Error(`warm-up exited ${run.exitCode}${run.timedOut ? ' (timeout)' : ''}: ${(run.errors || []).join('; ').slice(0, 160)}`);
  const { calls, answer, ...rest } = run;
  return { id: WARMUP_ID, cell: CELL_NAME, cwd: warmCwdOf(arm), calls: calls.length, answerChars: (answer || '').length, ...rest };
}
const GATE = createWarmupGate({ logFile: WARMUPS, meta: { cell: CELL_NAME, harness: CELL.harness, model: CELL.model }, enabled: WARMUP_ON });

// ─── one rollout ───────────────────────────────────────────────────────────────────────────────
async function runOne(probe0, arm) {
  const sweet = isSweet(arm);
  const probe = armProbe(probe0, arm);
  // gitCommit = the code the arm's product ran (a sweet arm: its checkout; native: this one);
  // benchCommit = the bench code that ran, judged, scored and costed it (the same for every arm).
  const P = productOf(arm), plug = OC_PRODUCT_PLUGINS[arm];
  const productFields = sweet
    ? { gitCommit: P.commit, gitDirty: P.dirty, productRoot: P.root, gutter: gutterFor(arm), indexCommit: indexStampOf(probe._orig, arm)?.commit ?? null }
    : { gitCommit: GIT_COMMIT.commit, gitDirty: GIT_COMMIT.dirty };
  const base = { captureVersion: CAPTURE_VERSION, cell: CELL_NAME, arm, id: probe.id, set: probe._set, lang: probe.language, stratum: probe.stratum, harness: CELL.harness, model: CELL.model, effort: CELL.effort ?? CELL.variant ?? 'default', harnessVersion: HARNESS_VERSION, ...productFields, benchCommit: GIT_COMMIT.commit, benchDirty: GIT_COMMIT.dirty, ...(STABLE_RULES_PATH ? { stableRulesPath: true } : {}), ...(CELL.harness === 'opencode' && ocCacheMode(arm) === 'product' ? { ocCachePlugin: { sha: plug.sha, mainCommit: plug.commit, dirty: plug.dirty } } : {}), ...(Object.keys(envOf(arm)).some(isArmSwitch) ? { variants: Object.fromEntries(Object.entries(envOf(arm)).filter(([k]) => isArmSwitch(k))) } : {}) };
  let run;
  try {
    // The arm's warm-up must have FINISHED before any scored rollout of that arm starts.
    await GATE.ensure(arm, () => runWarmup(arm));
    base.startedAtMs = Date.now();
    run = await launch(probe, arm);
  } catch (e) {
    if (e.fatal) throw e;
    return { ...base, error: String(e.message).slice(0, 400), exitCode: -1 };
  }
  const rawResponse = responseFor(run.calls, sweet);
  const delivered = ssDelivered(run.calls);
  const kinds = run.calls.reduce((m, c) => (m[c.kind] = (m[c.kind] || 0) + 1, m), {});
  fs.mkdirSync(CAP_DIR, { recursive: true });
  fs.writeFileSync(path.join(CAP_DIR, `${arm}.${probe.id}.json`), JSON.stringify({ ...base, answer: run.answer, rawResponse, calls: run.calls.map(c => ({ kind: c.kind, command: c.command, isError: c.isError, textChars: (c.text || '').length, text: c.text || '' })) }));
  const [judged, usd] = await Promise.all([
    judgePanelScore({ probe, answer: run.answer, panel: JUDGE_PANEL }).catch(() => null),
    // SS_BENCH_NO_USD=1 (final-tuning, cash): skip the secondary USD/content judge panel; accuracy is unchanged.
    process.env.SS_BENCH_NO_USD === '1' ? Promise.resolve({ usdSkipped: true }) : scoreUsd(probe, rawResponse, sweet ? 'ss' : 'native'),
  ]);
  const { calls, answer, ...rest } = run;
  return {
    ...base, score: judged?.score ?? null,
    judgesOk: judged ? judged.judges.filter(j => !j.isError).map(j => j.lineage) : [],
    ...usd, ...rest,
    // calls = every tool call the rollout paid for: main session + subagent sessions. Only opencode
    // publishes subagentCalls (child sessions); Codex and Claude Code count what their stream carries.
    calls: calls.length + (Number(rest.subagentCalls) || 0), callsMainOnly: calls.length,
    toolKinds: kinds, ssCalls: kinds.ss || 0, ssUsed: (kinds.ss || 0) > 0,
    nativeSearchCalls: (kinds.nativeGrep || 0) + (kinds.nativeRead || 0),
    ssDeliveredTokens: delivered.reduce((s, d) => s + (d.used || 0), 0),
    // Same unit across commits: the compact ss-* output (since 2026-10-01) has no route trailer /
    // budget header for ssDeliveredTokens to read, so compare runs on characters.
    ssDeliveredChars: run.calls.reduce((s, c) => s + (c.kind === 'ss' && typeof c.text === 'string' ? c.text.length : 0), 0),
    answerChars: (answer || '').length, rawLen: rawResponse.length,
  };
}

// ─── report (aggregates only — the whole pool is held-out) ───────────────────────────────────
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
// Stratified paired bootstrap: resample probes WITHIN each set, so the pooled interval keeps the sets' sizes.
function bootCI(pairs, B = 20000, seed = 42) {
  const bySet = new Map(); for (const p of pairs) { if (!bySet.has(p.set)) bySet.set(p.set, []); bySet.get(p.set).push(p.d); }
  const rnd = mulberry32(seed); const ms = [];
  for (let b = 0; b < B; b++) { let s = 0, n = 0; for (const ds of bySet.values()) for (let j = 0; j < ds.length; j++) { s += ds[Math.floor(rnd() * ds.length)]; n++; } ms.push(s / n); }
  ms.sort((x, y) => x - y); return [ms[Math.floor(0.025 * B)], ms[Math.floor(0.975 * B)]];
}
const readRuns = () => (fs.existsSync(RUNS) ? fs.readFileSync(RUNS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
function report() {
  const rows = excludeWarmups(readRuns());
  const ok = rows.filter(r => !r.error && r.exitCode === 0);
  const M = [['accuracy', r => r.score], ['content', r => r.content], ['USD_noC', r => r.USD_noC], ['calls', r => r.calls],
    ['cost$', r => r.costRealizedUsd], ['naive$', r => r.costNaiveUsd], ['wallSec', r => r.wallMs / 1000], ['ssUsed', r => (r.arm === 'sweet' ? +r.ssUsed : null)]];
  console.log(`\n=== r282 ${CELL_NAME} (${CELL.model} via ${CELL.harness}, ${rows[0]?.harnessVersion || '?'}) — aggregates only ===`);
  console.log(`rows ${rows.length}  ok ${ok.length}  errors ${rows.length - ok.length}  timeouts ${rows.filter(r => r.timedOut).length}`);
  const bases = [...new Set(ok.map(r => r.ledgerBasis || 'unlabelled (pre-2026-10-01: every cache write at 1.25x)'))];
  console.log(`ledger basis: ${bases.length > 1 ? `MIXED (${bases.join(' + ')}) - NOT COMPARABLE` : (bases[0] || 'n/a')}`);
  const capVers = [...new Set(ok.map(r => r.captureVersion ?? 1))];
  console.log(`capture version: ${capVers.length > 1 ? `MIXED (${capVers.join(' + ')}) - ssCalls / content NOT COMPARABLE` : capVers[0] ?? 'n/a'}`);
  console.log(fairnessBanner(cacheFairness(ok, { wave: CONC, deterministic: CACHE_DETERMINISTIC })));
  for (const scope of ['ALL', ...SETS.map(s => s[0])]) {
    const rs = ok.filter(r => scope === 'ALL' || r.set === scope);
    const nat = new Map(rs.filter(r => r.arm === 'native').map(r => [r.id, r]));
    const sw = new Map(rs.filter(r => r.arm === 'sweet').map(r => [r.id, r]));
    const ids = [...sw.keys()].filter(k => nat.has(k));
    if (!ids.length) continue;
    console.log(`\n[${scope}] paired n=${ids.length}`);
    for (const [name, f] of M) {
      const pairs = ids.map(id => ({ set: sw.get(id).set, a: f(sw.get(id)), b: f(nat.get(id)) })).filter(p => Number.isFinite(p.a) && Number.isFinite(p.b));
      if (!pairs.length) { const v = ids.map(id => f(sw.get(id))).filter(Number.isFinite); if (v.length) console.log(`  ${name.padEnd(9)} sweet ${mean(v).toFixed(3)}`); continue; }
      const ds = pairs.map(p => ({ set: p.set, d: p.a - p.b }));
      const [lo, hi] = bootCI(ds);
      const na = mean(pairs.map(p => p.b)), sa = mean(pairs.map(p => p.a));
      const rel = na ? ` (${(((sa - na) / na) * 100).toFixed(1)}%)` : '';
      console.log(`  ${name.padEnd(9)} native ${na.toFixed(4)}  sweet ${sa.toFixed(4)}  Δ ${(sa - na).toFixed(4)}${rel}  95% CI [${lo.toFixed(4)}, ${hi.toFixed(4)}]${lo > 0 || hi < 0 ? ' *' : ''}`);
    }
  }
}

// ─── exposure gate ($0) ───────────────────────────────────────────────────────────────────────
// --print-exposure <dir>: write the exact sweet-arm texts this invocation would deliver (per sweet arm:
// rules, harness prompt, tool edits) to <dir>/<arm>/, print their sha256 and sizes, and exit. No model
// call, no clone, no daemon. Run it with the switch on and off and diff the two dirs.
function exposureTexts(arm) {
  const P = productOf(arm);
  // One scratch path for every arm (texts run one at a time): the Claude Code agent file embeds a
  // memory path derived from it, so arm-specific paths would make every arm pair differ on that line.
  const work = path.join(os.tmpdir(), 'r282-exposure', CELL_NAME, 'work');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  try {
    if (CELL.harness === 'cc') {
      // Same calls as installClaudeProduct (process.env, as for a real Claude Code run).
      const proj = path.join(work, 'repo'), home = path.join(work, 'home');
      fs.mkdirSync(proj); fs.mkdirSync(home);
      const lean = P.installClaudeLeanHarness({ projectRoot: proj, configDir: home, visibleConfigDir: home });
      if (lean.active !== true) throw new Error(`exposure: lean harness not active: ${lean.status} ${lean.detail}`);
      P.writeClaudeRules({ projectRoot: proj, layout: 'pointer', memoryDir: lean.memoryDir });
      const out = {};
      // settings.json too (hooks, permissions); the scratch paths are normalised so two runs compare.
      const norm = (t) => t.split(fs.realpathSync(proj)).join('<PROJECT>').split(proj).join('<PROJECT>').split(fs.realpathSync(home)).join('<HOME>').split(home).join('<HOME>');
      for (const f of [...CLAUDE_PRODUCT_FILES, '.claude/settings.json']) { const fp = path.join(proj, f); if (fs.existsSync(fp)) out[f.replace(/\//g, '__')] = norm(fs.readFileSync(fp, 'utf8')); }
      return out;
    }
    if (CELL.harness === 'codex') {
      const trim = P.codexHarnessTrim({ sweet: true, model: `openai/${CELL.model}`, env: envOf(arm) });
      P.codexHarnessTrimArgs(trim, work, { model: `openai/${CELL.model}` });
      return { 'model_instructions_file.md': fs.readFileSync(path.join(work, P.CODEX_HARNESS_TRIM_STATE_FILE), 'utf8'), 'developer_instructions.md': rulesFor(arm) };
    }
    const trim = P.opencodeArmHarnessTrim({ sweet: true, env: envOf(arm), apiModel: CELL.model.replace(/^openrouter\//, ''), stateDir: work });
    return {
      'agent.build.prompt.txt': trim.config?.agentBuild?.prompt ?? '',
      'agent.general.prompt.txt': trim.config?.agents?.general?.prompt ?? '',
      'tool-edits.json': `${JSON.stringify(trim.config?.plugin?.[0]?.[1]?.edits ?? null, null, 1)}\n`,
      'instructions.md': P.sweetRulesBlock({ mppText: rulesFor(arm) }),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
const EXPOSURE_DIR = flag('--print-exposure', null);
if (EXPOSURE_DIR) {
  // The sweet arms of --arms (default: sweet), plus sweetB when --armB-env is given.
  const sweetArms = [...new Set([...ARMS.filter(isSweet), ...(Object.keys(ARMB_ENV).length ? ['sweet', 'sweetB'] : [])])];
  if (!sweetArms.length) sweetArms.push('sweet');
  for (const arm of sweetArms) {
    const dir = path.resolve(EXPOSURE_DIR, arm);
    fs.mkdirSync(dir, { recursive: true });
    const P = productOf(arm);
    console.log(`[${arm}] ${CELL_NAME} product ${P.root} @ ${P.commit?.slice(0, 8)}${P.dirty ? ' (dirty)' : ''} | ss-bin ${P.ssBin} | gutter ${gutterFor(arm)} | SS_VARIANT_RULES_FILE=${envOf(arm).SS_VARIANT_RULES_FILE ?? '(unset)'}`);
    // Provenance only (leading underscore: not an exposure text, never compared).
    fs.writeFileSync(path.join(dir, '_product.json'), `${JSON.stringify({ arm, root: P.root, commit: P.commit, dirty: P.dirty, ssBin: P.ssBin, gutter: gutterFor(arm), ocCacheKey: ocCacheMode(arm) || null }, null, 1)}\n`);
    for (const [name, text] of Object.entries(exposureTexts(arm))) {
      fs.writeFileSync(path.join(dir, name), text);
      console.log(`  ${name.padEnd(44)} ${String(text.length).padStart(6)} chars  sha256 ${crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)}`);
    }
  }
  process.exit(0);
}

// ─── main ──────────────────────────────────────────────────────────────────────────────────────
const HARNESS_VERSION = harnessVersion();
if (REPORT) { report(); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(STATE, { recursive: true });
// SS_VARIANT_OC_CACHE_KEY=product: copy the plugin from the main checkout ONCE, at run start.
// One staged plugin per arm in product mode. sweet / sweetB: the main checkout's (as before; SS_PRODUCT_MAIN_DIR
// overrides). before: the before checkout's own plugin, staged in its own dir.
const OC_PRODUCT_PLUGINS = Object.fromEntries(ARMS.concat(Object.keys(ARMB_ENV).length ? ['sweetB'] : []).filter(a => ocCacheMode(a) === 'product').map(a => [a,
  a === 'before'
    ? stageProductCachePlugin({ repo: REPO, stateRoot: path.join(STATE, 'before'), env: { ...process.env, SS_PRODUCT_MAIN_DIR: BEFORE_PRODUCT.root } })
    : stageProductCachePlugin({ repo: REPO, stateRoot: STATE })]));
for (const [a, pl] of Object.entries(OC_PRODUCT_PLUGINS)) console.error(`opencode product cache plugin [${a}]: ${pl.src} (${pl.commit}${pl.dirty ? ', UNCOMMITTED edits' : ''}, sha ${pl.sha}) -> ${pl.file}`);
const done = new Set(fs.existsSync(RUNS) ? fs.readFileSync(RUNS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.error && r.exitCode === 0).map(r => `${r.arm}|${r.id}`) : []);
console.error(`r282 ${CELL_NAME}: ${CELL.model} via ${CELL.harness} (${HARNESS_VERSION}) effort=${CELL.effort ?? CELL.variant ?? 'default'} | ${PROBES.length} probes × ${ARMS.length} arms | conc=${CONC} | ${done.size} done`);
// Clones per clone root: this checkout's arms share one, `before` has its own.
const CLONE_ARMS = [...new Set(ARMS.map(a => (a === 'before' ? 'before' : 'sweet')))];
for (const orig of new Set(PROBES.map(p => p._orig))) for (const a of CLONE_ARMS) ensureClone(orig, a);
// The warm-up's own clone (first repo, different path). Rebuilt every run so no earlier install
// or drift reaches it. PROBES is empty only for a --ids filter that matched nothing.
if (WARMUP_ON && PROBES.length) for (const a of CLONE_ARMS) recreateWarmupClone(PROBES[0]._orig, a);
if (BEFORE_PRODUCT) console.error(`before arm: product ${BEFORE_PRODUCT.root} @ ${BEFORE_PRODUCT.commit?.slice(0, 8)}${BEFORE_PRODUCT.dirty ? ' (dirty)' : ''}, gutter ${gutterFor('before')}, clones ${CLONE_ROOT_BEFORE} from ${BEFORE_REPOS}`);
console.error(`cache warm-up: ${WARMUP_ON ? `ON, one unscored request per arm before its first scored rollout, from ${WARM_CWD}` : 'OFF (SS_CACHE_WARMUP=0)'} | claude cache TTL: ${CELL.harness === 'cc' ? '5m forced (FORCE_PROMPT_CACHING_5M=1)' : 'n/a'}`);
const cleanup = [];
// process.exit runs the 'exit' handler above, which stops this run's daemons and maintainers.
const onSignal = () => { for (const f of cleanup.splice(0)) f(); process.exit(130); };
process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
try {
  const INTERLEAVE = argv.includes('--interleave');
  // Claude Code installs product files INTO the shared clones for the sweet arm: no mixed phase.
  if (INTERLEAVE && CELL.harness === 'cc') throw new Error('--interleave is not wired for Claude Code');
  // phases: one per arm (default), or ONE mixed phase with sweet/sweetB alternating per probe.
  // --interleave: sweet vs sweetB when --armB-env is given, else the --arms list (e.g. native,sweet).
  const phases = INTERLEAVE ? [Object.keys(ARMB_ENV).length ? ['sweet', 'sweetB'] : ARMS] : ARMS.map(a => [a]);
  for (const arms of phases) {
    const label = arms.join('+');
    const tasks = [];
    PROBES.forEach((p, i) => { const order = (INTERLEAVE && i % 2) ? [...arms].reverse() : arms; for (const arm of order) if (!done.has(`${arm}|${p.id}`)) tasks.push({ p, arm }); });
    if (!tasks.length) { console.error(`[${label}] all done`); continue; }
    const cwds = [...new Set(tasks.map(t => armProbe(t.p, t.arm)._cwd))];
    // Each sweet arm warms its own ss-* servers with its own product, in its own clones.
    const warmPairs = [...new Map(tasks.filter(t => isSweet(t.arm)).map(t => { const c = armProbe(t.p, t.arm)._cwd; return [`${t.arm}|${c}`, { c, arm: t.arm }]; })).values()];
    if (warmPairs.length) { console.error(`[${label}] warming ${warmPairs.length} ss-* servers…`); for (const { c, arm } of warmPairs) warmup(c, arm); }
    let installed = [];
    const ccArm = CELL.harness === 'cc' ? arms.find(isSweet) : null;
    if (ccArm) {
      // The warm-up dir carries the same product install, so the warm-up IS the sweet launch config.
      const armCwds = [...new Set(tasks.filter(t => t.arm === ccArm).map(t => armProbe(t.p, ccArm)._cwd))];
      installed = installClaudeProduct(WARMUP_ON ? [...armCwds, warmCwdOf(ccArm)] : armCwds, claudeHome(ccArm), productOf(ccArm));
      cleanup.push(() => uninstallClaudeProduct(installed));
    }
    console.error(`\n[${label}] ${tasks.length} rollouts`);
    let idx = 0, fatal = null;
    const worker = async () => {
      while (idx < tasks.length && !fatal) {
        const { p, arm } = tasks[idx++];
        let row;
        try { row = await runOne(p, arm); } catch (e) { fatal = e; break; }
        fs.appendFileSync(RUNS, JSON.stringify(row) + '\n');
        console.error(`  [${arm}] ${String(idx).padStart(3)}/${tasks.length} ${p._set.padEnd(7)} calls=${row.calls ?? '—'} ss=${row.ssCalls ?? 0} $${row.costRealizedUsd != null ? row.costRealizedUsd.toFixed(4) : '—'} ${row.wallMs != null ? (row.wallMs / 1000).toFixed(0) + 's' : ''}${row.timedOut ? ' TIMEOUT' : ''}${row.error ? ' ERR:' + row.error.slice(0, 100) : ''}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, tasks.length) }, worker));
    if (installed.length) { uninstallClaudeProduct(installed); cleanup.pop(); }
    await reapCloneDaemons(label);
    for (const c of cwds) { const d = cloneDrift(c); if (d.length) console.error(`  [DRIFT] ${path.basename(c)}: ${d.length} file(s) written after cloning: ${d.slice(0, 5).join(', ')}`); }
    if (fatal) throw fatal;
  }
} finally {
  for (const f of cleanup.splice(0)) f();
  await reapCloneDaemons('end of run');   // before the warm-up clone goes: its daemon holds files there
  for (const a of CLONE_ARMS) fs.rmSync(warmCwdOf(a), { recursive: true, force: true });   // the warm-up clone is never a result
}
// Run summary + fairness assertion: did both arms' first scored requests see the same cache state?
{
  const scored = excludeWarmups(readRuns()).filter(r => !r.error && r.exitCode === 0);
  const fairness = cacheFairness(scored, { wave: CONC, deterministic: CACHE_DETERMINISTIC });
  const warmups = GATE.entries();
  const wUsd = warmups.filter(w => w.ok).reduce((s, w) => s + (Number(w.costRealizedUsd) || 0), 0);
  const summary = {
    cell: CELL_NAME, smoke: SMOKE, finishedAt: new Date().toISOString(), harnessVersion: HARNESS_VERSION,
    ledgerBasis: LEDGER_BASIS, claudeCacheTtl: CELL.harness === 'cc' ? '5m-forced' : null,
    scoredRows: scored.length, cacheWarmup: { enabled: WARMUP_ON, file: WARMUPS, thisInvocation: warmups.length, thisInvocationCostUsd: +wUsd.toFixed(6), note: 'warm-up cost is NOT in runs.jsonl or any aggregate' },
    cacheFairness: fairness,
  };
  fs.writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
  console.error(fairnessBanner(fairness));
  if (fairness.status === 'violation' && !ALLOW_UNFAIR_CACHE) {
    console.error('Exit code 3: the arms started with different cache state on a deterministic (Claude Code) cache. Check warmups.jsonl, rerun with the warm-up on, or pass --allow-unfair-cache to accept it.');
    process.exitCode = 3;
  }
}
console.error(`\n${CELL_NAME} complete. Aggregates: CELL=${CELL_NAME} node scripts/retrieval-bench-282.mjs --report${SMOKE ? ' --smoke' : ''}`);
