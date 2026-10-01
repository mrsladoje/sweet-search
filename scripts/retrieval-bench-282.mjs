#!/usr/bin/env node
/**
 * retrieval-bench-282 — the P7 code-retrieval matrix re-run on sweet-search 2.8.2 (2026-09-30).
 *
 * What changed from the June 3k matrix (scripts/budget-sweep-smoke.mjs + scripts/oc-batch.mjs):
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
 *   - Cost: token counts × list price (ideal-cost.mjs MODEL_PRICES, cache-write 1.25x basis) for
 *     every cell, whatever the billing (Claude Code + Codex run on subscriptions).
 *
 *   CELL=cc-sonnet55-high  node scripts/retrieval-bench-282.mjs            # run / resume one cell
 *   CELL=cc-sonnet55-high  node scripts/retrieval-bench-282.mjs --smoke    # 1 probe × 2 arms
 *   CELL=cc-sonnet55-high  node scripts/retrieval-bench-282.mjs --report   # aggregates only
 *   options: --conc 3 (default)  --ids a,b  --arms native,sweet  --tag <name>
 *   --tag (final-tuning, 2026-10-01): a separate results dir, harness state dir AND clone root per
 *   tag. Separate clones = separate project roots = fresh ss-* daemons started with this run's env,
 *   so an SS_VARIANT_* switch reaches the daemon (ss-search output is formatted server-side).
 *   Plan recorded before the run: core/prompt-optimization/data/r282-PREREG.md
 */
process.env.SS_ISOLATION = '0'; // Mac, unjailed — must be set before the harness modules load

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { opencodeRulesDir, applyOpencodeRepoCacheKey, applyOpencodeProductCacheKey, stageProductCachePlugin, OC_CACHE_KEY_MODES } from './lib/oc-bench-config.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = path.join(REPO, 'eval/task-completion-bench/harness');
const imp = (rel) => import(path.join(REPO, rel));

const { resolveRepoCwd, judgePanelScore, JUDGE_PANEL, normalizeJudgeUsage, AllJudgesFailedError } = await imp('core/prompt-optimization/sweep/gepa-evaluate.mjs');
const { runJudge } = await imp('eval/agent-read-workflows/judge-runner.js');
const { toRJudge, usdPanelScore, scoreUSD, composeUSD, computeRubricHash, USD_PARAMS } = await imp('core/prompt-optimization/sweep/usd-metric.mjs');
const { parseRouteMetadata } = await imp('core/search/search-format.js');
const { ISOLATION_ON } = await import(path.join(H, 'agent-jail.mjs'));
const { spawnWithTimeout, sweetRulesBlock, costsFromTurns, priceFor } = await import(path.join(H, 'agent-runner-shared.mjs'));
const { parseClaudeStream, excludeAncestorClaudeMd } = await import(path.join(H, 'claude-code-task-runner.mjs'));
const { turnsFromTranscript, sidechainTurnSets, addSidechainCostsChecked, selectClaudeMainCosts } = await import(path.join(H, 'claude-code-accounting.mjs'));
const { parseCodexAgentStream, codexHarnessTrim, codexHarnessTrimArgs, codexRulesConfigArgs, buildPrivateHome, isZeroCallStartFailure, classifyCodexCommand } = await import(path.join(H, 'codex-task-runner.mjs'));
const { opencodeArmHarnessTrim, opencodeRulesInConfig, buildMainOpencodeConfig, opencodeUnjailedEnv, runOpencodePreflight, parseOpencodeStream, opencodeRunMessage, OPENCODE_TRIM_REPORT, OPENCODE_RULES_FILE } = await import(path.join(H, 'opencode-task-runner.mjs'));
const { writeClaudeRules, removeClaudeRules, resolveClaudeRulesLayout } = await imp('scripts/write-claude-rules.js');
const { installClaudeLeanHarness, removeClaudeLeanHarness } = await imp('scripts/install-claude-lean-harness.js');
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
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || 900000);
const TAG = flag('--tag', process.env.RESULTS_TAG || '');
const STABLE_RULES_PATH = process.env.SS_BENCH_STABLE_RULES_PATH === '1';
if (TAG && !/^[a-z0-9][a-z0-9._-]*$/i.test(TAG)) { console.error(`bad --tag ${TAG}`); process.exit(2); }
const SUFFIX = `${SMOKE ? '-smoke' : ''}${TAG ? `-${TAG}` : ''}`;

const OUT = path.join(REPO, 'core/prompt-optimization/data/results', `r282-${CELL_NAME}${SUFFIX}`);
const RUNS = path.join(OUT, 'runs.jsonl');
const CAP_DIR = path.join(OUT, 'captures');
const STATE = path.join(EVAL, 'r282', `${CELL_NAME}${SUFFIX}`);
const SS_BIN = path.join(REPO, 'eval/agent-read-workflows/bin');
const RULES = fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
// final-tuning variant SS_VARIANT_PRUNE3=1 (default off = byte-identical): ss-find, ss-semantic and
// ss-trace are removed — from the rules text (variants/rules-prune3.md) AND from PATH (a bin dir with
// only ss-search / ss-grep / ss-read and their shared helpers), so the agent can neither read about
// nor call them. Codex / opencode only (Claude Code reads the rules via writeClaudeRules).
// --interleave --armB-env "K=V,K2=V2" (final-tuning 2026-10-01): a second sweet arm `sweetB` with an env
// overlay, run INTERLEAVED with `sweet` (A, B, A, B … per probe) in one queue, so both conditions see
// the same provider/time drift. Needed because two identical Codex baselines run 25 min apart
// differed by −24.5% in cost (significant). Not wired for Claude Code (per-repo installed files).
const ARMB_ENV = Object.fromEntries(String(flag('--armB-env', '')).split(',').map(x => x.trim()).filter(Boolean).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
const envOf = (arm) => (arm === 'sweetB' ? { ...process.env, ...ARMB_ENV } : process.env);
const prune3 = (arm) => envOf(arm).SS_VARIANT_PRUNE3 === '1';
// SS_VARIANT_OC_CACHE_KEY (opencode; per arm like every SS_VARIANT_*): unset = opencode's own session-id
// keys; `repo` = bench key (per-model promptCacheKey + scripts/opencode-cache-key-plugin.mjs); `product`
// = the shipped plugin from the main checkout, listed exactly as `sweet-search init --opencode` lists it.
const ocCacheMode = (arm) => envOf(arm).SS_VARIANT_OC_CACHE_KEY || '';
for (const a of ['native', 'sweet', 'sweetB']) {
  const m = ocCacheMode(a);
  if (m && !OC_CACHE_KEY_MODES.includes(m)) { console.error(`SS_VARIANT_OC_CACHE_KEY must be one of ${OC_CACHE_KEY_MODES.join(', ')} (got "${m}")`); process.exit(2); }
}
const OC_PRODUCT = ['native', 'sweet', 'sweetB'].some(a => ocCacheMode(a) === 'product');
if (OC_PRODUCT && CELL.harness !== 'opencode') { console.error('SS_VARIANT_OC_CACHE_KEY=product is an opencode switch'); process.exit(2); }
// The product plugin acts on the `openai` provider only; on any other provider the paid run would measure nothing.
if (OC_PRODUCT && !CELL.model.startsWith('openai/')) { console.error(`SS_VARIANT_OC_CACHE_KEY=product: ${CELL.model} is not an openai/ model; the product plugin leaves it untouched`); process.exit(2); }
const PRUNE3 = prune3('sweet') || prune3('sweetB');
const RULES_PRUNE3 = () => fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/final-tuning/variants/rules-prune3.md'), 'utf8');
// SS_VARIANT_RULES_FILE=<path relative to the repo> (final-tuning): a full alternative rules text for that
// arm (same tools; Codex / opencode). Default unset = the shipped rules.
const rulesFor = (arm) => {
  const f = envOf(arm).SS_VARIANT_RULES_FILE;
  if (f) return fs.readFileSync(path.resolve(REPO, f), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
  return prune3(arm) ? RULES_PRUNE3() : RULES;
};
function prunedBin() {
  const d = path.join(EVAL, 'final-tuning-bin-prune3');
  fs.mkdirSync(d, { recursive: true });
  for (const f of ['ss-search', 'ss-grep', 'ss-read', '_ss-env.sh', '_ss-helpers.mjs', '_ss-argparse.mjs']) {
    const link = path.join(d, f), target = path.join(SS_BIN, f);
    try { if (fs.readlinkSync(link) === target) continue; fs.rmSync(link); } catch {}
    fs.symlinkSync(target, link);
  }
  return d;
}

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
const cloneOf = (orig) => path.join(CLONE_ROOT, path.relative(REPO, orig).replace(/[\\/]/g, '__'));
function ensureClone(orig) {
  const dst = cloneOf(orig);
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(CLONE_ROOT, { recursive: true });
    execFileSync('cp', ['-c', '-p', '-R', orig, dst]);
    fs.writeFileSync(`${dst}.cloned-at`, new Date().toISOString());
  }
  return dst;
}
// Files an agent created or changed in a clone since it was made (index/runtime dirs excluded).
function cloneDrift(dst) {
  try {
    const out = sh('find', [dst, '-newer', `${dst}.cloned-at`, '-type', 'f', '-not', '-path', '*/.sweet-search/*', '-not', '-path', '*/.claude/*', '-not', '-name', '.DS_Store']);
    return out ? out.split('\n').map(f => path.relative(dst, f)) : [];
  } catch { return []; }
}
// Grouped by repo so concurrent rollouts share warm ss-* servers; the same order for both arms.
PROBES = PROBES.map(p => ({ ...p, _orig: resolveRepoCwd(p, {}) })).map(p => ({ ...p, _cwd: cloneOf(p._orig) }))
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
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const harnessVersion = () => { try { return sh(path.join(BIN[CELL.harness], { cc: 'claude', codex: 'codex', opencode: 'opencode' }[CELL.harness]), ['--version']).split('\n')[0]; } catch { return null; } };
const baseEnv = (sweet, cwd, arm = sweet ? 'sweet' : 'native') => ({
  ...envOf(arm),
  PATH: [BIN[CELL.harness], sweet ? (prune3(arm) ? prunedBin() : SS_BIN) : null, process.env.PATH].filter(Boolean).join(':'),
  SWEET_SEARCH_PROJECT_ROOT: cwd,
  SWEET_SEARCH_OFFLINE: '1',
});
const warmup = (cwd) => { try { execFileSync(path.join(SS_BIN, 'ss-search'), ['warmup', '-k', '1'], { cwd, env: baseEnv(true, cwd), stdio: 'ignore', timeout: 180000 }); } catch { /* best-effort */ } };

// One normalized call shape for every harness: { kind, command, text, isError }.
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
// rules file by its result). SS_VARIANT_CC_RULES_IN_PROMPT=0 reproduces the 2.8.2 layout (full
// rules file, agent file without rules) for controls; =2 is the default; =1 (V1) writes no rules file.
const CLAUDE_PRODUCT_FILES = ['.claude/rules/sweet-search.md', '.claude/agents/sweet-search.md', '.claude/agents/general-purpose.md', '.claude/agents/Plan.md', '.claude/sweet-search-harness.json'];
function installClaudeProduct(cwds, home) {
  const installed = [];
  for (const cwd of cwds) {
    const pre = CLAUDE_PRODUCT_FILES.filter(f => fs.existsSync(path.join(cwd, f)));
    if (pre.length) throw new Error(`${cwd} already has ${pre.join(', ')} — clean it before the run`);
    const settings = path.join(cwd, '.claude/settings.json');
    const settingsBefore = fs.existsSync(settings) ? fs.readFileSync(settings) : null;
    const claudeDirExisted = fs.existsSync(path.join(cwd, '.claude'));
    installed.push({ cwd, settings, settingsBefore, claudeDirExisted });
    const { layout } = resolveClaudeRulesLayout(process.env, { strict: true });
    const lean = installClaudeLeanHarness({ projectRoot: cwd, configDir: home, visibleConfigDir: home });   // reads the switch from process.env, as init does
    if (lean.active !== true) throw new Error(`lean harness not active in ${cwd}: ${lean.status} ${lean.detail}`);
    if (lean.rulesInPrompt !== (layout !== 'file')) throw new Error(`rules placement mismatch in ${cwd}: rulesInPrompt=${lean.rulesInPrompt}, layout=${layout}`);
    const rules = layout === 'none' ? 'in-prompt' : writeClaudeRules({ projectRoot: cwd, layout: layout === 'pointer' ? 'pointer' : 'full' });
    if (rules !== 'created' && rules !== 'in-prompt') throw new Error(`rules not created in ${cwd}: ${rules}`);
  }
  return installed;
}
function uninstallClaudeProduct(installed) {
  for (const it of installed) {
    try { removeClaudeLeanHarness({ projectRoot: it.cwd }); } catch {}
    try { removeClaudeRules({ projectRoot: it.cwd }); } catch {}
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
    ...baseEnv(sweet, cwd),
    CLAUDE_CONFIG_DIR: home,
    CLAUDE_CODE_OAUTH_TOKEN: loadClaudeToken(),
    IS_SANDBOX: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    SS_READ_GUTTER: process.env.SS_READ_GUTTER ?? 'tab',
  };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) delete env[k];
  const args = ['-p', '--model', CELL.model, '--effort', CELL.effort, '--permission-mode', 'bypassPermissions',
    '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
  const t0 = Date.now();
  const once = () => spawnWithTimeout(path.join(BIN.cc, 'claude'), args, { cwd, env, timeoutMs: TIMEOUT_MS, stdinText: promptFor(probe) });
  let r = await once(); let p = parseClaudeStream(r.stdout); let startRetried = false;
  if (isZeroCallStartFailure(r, p.toolCalls, p.answer) && !p.accountFatal) { startRetried = true; r = await once(); p = parseClaudeStream(r.stdout); }
  if (p.accountFatal) throw Object.assign(new Error(`ACCOUNT FATAL: ${p.accountFatal}`), { fatal: true });
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
async function runCodex(probe, sweet, arm) {
  const cwd = probe._cwd;
  const { home, phome } = codexHome();
  const stateDir = fs.mkdtempSync(path.join(STATE, 'codex-state-'));
  const trim = codexHarnessTrim({ sweet, model: `openai/${CELL.model}` });
  const trimArgs = sweet ? [...codexHarnessTrimArgs(trim, stateDir, { model: `openai/${CELL.model}` }), ...codexRulesConfigArgs(rulesFor(arm))] : [];
  const env = { ...baseEnv(sweet, cwd, arm), CODEX_HOME: home, HOME: phome, SS_READ_GUTTER: process.env.SS_READ_GUTTER ?? 'none' };
  delete env.OPENAI_API_KEY;
  const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--json',
    '-c', `model_reasoning_effort="${CELL.effort}"`, ...trimArgs, '-m', CELL.model, '-C', cwd, '-'];
  const t0 = Date.now();
  const once = () => spawnWithTimeout(path.join(BIN.codex, 'codex'), args, { cwd, env, timeoutMs: TIMEOUT_MS, stdinText: promptFor(probe) });
  let r = await once(); let p = parseCodexAgentStream(r.stdout); let startRetried = false;
  if (isZeroCallStartFailure(r, p.toolCalls, p.answer)) { startRetried = true; r = await once(); p = parseCodexAgentStream(r.stdout); }
  codexSyncAuthBack(home);
  fs.rmSync(stateDir, { recursive: true, force: true });
  const errText = p.errors.join(' ');
  if (/refresh token|usage limit|log ?in|unauthorized|401/i.test(errText) && !p.toolCalls.length) throw Object.assign(new Error(`ACCOUNT FATAL: ${errText.slice(0, 200)}`), { fatal: true });
  const u = p.usage || {};
  const inTok = u.input_tokens || 0, cached = u.cached_input_tokens || 0, out = u.output_tokens || 0;
  return {
    calls: p.toolCalls.map(c => ({ kind: classifyCodexCommand(c.input?.command || '').kind, command: c.input?.command || '', text: c.result?.content || '', isError: c.result?.isError })),
    answer: p.answer, wallMs: Date.now() - t0, exitCode: r.exitCode, timedOut: r.timedOut, startRetried, usage: u,
    harnessTrim: trim.mode || null,
    // OpenAI charges no cache-write premium: realized = fresh input + cached input + output.
    costRealizedUsd: ((inTok - cached) * PRICE.in + cached * PRICE.cache + out * PRICE.out) / 1e6,
    costNaiveUsd: (inTok * PRICE.in + out * PRICE.out) / 1e6,
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
  const ocData = path.join(STATE, `oc-data-${sweet ? 'sweet' : 'native'}`); fs.mkdirSync(ocData, { recursive: true });
  if (CELL.ocAuth) ocSeedAuth(ocData, CELL.ocAuth);
  let trim = opencodeArmHarnessTrim({ sweet, apiModel: CELL.model.replace(/^openrouter\//, ''), stateDir });
  // SS_BENCH_STABLE_RULES_PATH=1 (final-tuning, 2026-10-01): the rules file lives at ONE path per run
  // instead of the per-rollout mkdtemp dir. opencode prints "Instructions from: <absolute path>" into
  // the system prompt, so the random dir broke the provider's prefix cache on every sweet rollout
  // (r282 DeepSeek sweet req-0 cache hit 24% vs native 86%). The product (`init`) uses the stable
  // project path .opencode/sweet-search.md, so the stable path is the production-faithful setting.
  // The directory is chosen by the rules TEXT (oc-rules-<sha8>), not by the arm: two arms with identical
  // rules then send the identical `Instructions from:` line and share the provider prefix cache (the old
  // oc-rules / oc-rules-B split cut the shared prefix at about 2,150 developer tokens; STATS-HARD S4).
  const rulesText = sweet ? sweetRulesBlock({ mppText: rulesFor(arm) }) : null;
  const rulesDir = opencodeRulesDir({ stable: STABLE_RULES_PATH, stateRoot: STATE, stateDir, rulesText });
  trim = opencodeRulesInConfig(trim, { rules: rulesText, stateDir: rulesDir });
  if (STABLE_RULES_PATH && sweet) {
    fs.mkdirSync(rulesDir, { recursive: true });
    const f = path.join(rulesDir, OPENCODE_RULES_FILE), txt = trim.files[OPENCODE_RULES_FILE];
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== txt) { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, txt); fs.renameSync(tmp, f); }
  }
  for (const [name, text] of Object.entries(trim.files || {})) fs.writeFileSync(path.join(stateDir, name), text);
  let cfg = buildMainOpencodeConfig({ trim });
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
    const r = applyOpencodeProductCacheKey(cfg, { plugin: OC_PRODUCT_PLUGIN.plugin });
    cfg = r.cfg; extraPlugins = [r.plugin];
  }
  const cfgPath = path.join(stateDir, 'opencode.json'); fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const env = {
    ...baseEnv(sweet, cwd, arm),
    ...opencodeUnjailedEnv({ root: path.join(STATE, `oc-home-${sweet ? 'sweet' : 'native'}`), ocData }),
    OPENCODE_CONFIG: cfgPath, SS_READ_GUTTER: process.env.SS_READ_GUTTER ?? 'colon',
  };
  if (CELL.ocAuth === 'openai') delete env.OPENAI_API_KEY; // the subscription login must pay, never a key
  await runOpencodePreflight({ cwd, env, plugins: [...(trim.plugins || []), ...extraPlugins] });
  const args = ['run', '--format', 'json', '--agent', 'build', '--auto', '--model', CELL.model, ...(CELL.variant ? ['--variant', CELL.variant] : []), '--dir', cwd];
  const t0 = Date.now();
  const once = () => spawnWithTimeout(path.join(BIN.opencode, 'opencode'), args, { cwd, env, timeoutMs: TIMEOUT_MS, stdinText: opencodeRunMessage(promptFor(probe)) });
  let r = await once(); let p = parseOpencodeStream(r.stdout); let startRetried = false;
  if (isZeroCallStartFailure(r, p.toolCalls, p.answer)) { startRetried = true; r = await once(); p = parseOpencodeStream(r.stdout); }
  if (CELL.ocAuth) ocSyncAuthBack(ocData, CELL.ocAuth);
  const trimReport = path.join(stateDir, OPENCODE_TRIM_REPORT);
  const trimApplied = trim.mode ? fs.existsSync(trimReport) : null;
  fs.rmSync(stateDir, { recursive: true, force: true });
  const costs = costsFromTurns(p.turns, PRICE);
  return {
    calls: p.toolCalls.map(c => ({ kind: c.kind, command: c.command, text: c.resultText, isError: c.isError })),
    answer: p.answer, wallMs: Date.now() - t0, exitCode: r.exitCode, timedOut: r.timedOut, startRetried,
    usage: { turns: p.turns.length, in: p.turns.reduce((a, t) => a + t.in, 0), out: p.turns.reduce((a, t) => a + t.out, 0) },
    harnessTrim: trim.mode || null, harnessTrimApplied: trimApplied,
    costRealizedUsd: costs.costRealizedUsd, costNaiveUsd: costs.costNaiveUsd ?? null, costSource: 'step_finish',
    errors: p.errors.slice(0, 3), stderrPreview: String(r.stderr || '').slice(0, 300),
  };
}

// ─── one rollout ───────────────────────────────────────────────────────────────────────────────
async function runOne(probe, arm) {
  const sweet = arm === 'sweet' || arm === 'sweetB';
  const base = { cell: CELL_NAME, arm, id: probe.id, set: probe._set, lang: probe.language, stratum: probe.stratum, harness: CELL.harness, model: CELL.model, effort: CELL.effort ?? CELL.variant ?? 'default', harnessVersion: HARNESS_VERSION, ...(STABLE_RULES_PATH ? { stableRulesPath: true } : {}), ...(CELL.harness === 'opencode' && ocCacheMode(arm) === 'product' ? { ocCachePlugin: { sha: OC_PRODUCT_PLUGIN.sha, mainCommit: OC_PRODUCT_PLUGIN.commit, dirty: OC_PRODUCT_PLUGIN.dirty } } : {}), ...(Object.keys(envOf(arm)).some(k => k.startsWith('SS_VARIANT_')) ? { variants: Object.fromEntries(Object.entries(envOf(arm)).filter(([k]) => k.startsWith('SS_VARIANT_'))) } : {}) };
  let run;
  try {
    run = CELL.harness === 'cc' ? await runClaude(probe, sweet, arm)
      : CELL.harness === 'codex' ? await runCodex(probe, sweet, arm)
      : await runOpencode(probe, sweet, arm);
  } catch (e) {
    if (e.fatal) throw e;
    return { ...base, error: String(e.message).slice(0, 400), exitCode: -1 };
  }
  const rawResponse = responseFor(run.calls, sweet);
  const delivered = ssDelivered(run.calls);
  const kinds = run.calls.reduce((m, c) => (m[c.kind] = (m[c.kind] || 0) + 1, m), {});
  fs.mkdirSync(CAP_DIR, { recursive: true });
  fs.writeFileSync(path.join(CAP_DIR, `${arm}.${probe.id}.json`), JSON.stringify({ ...base, answer: run.answer, rawResponse, calls: run.calls.map(c => ({ kind: c.kind, command: c.command, isError: c.isError, textChars: (c.text || '').length })) }));
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
    calls: calls.length, toolKinds: kinds, ssCalls: kinds.ss || 0, ssUsed: (kinds.ss || 0) > 0,
    nativeSearchCalls: (kinds.nativeGrep || 0) + (kinds.nativeRead || 0),
    ssDeliveredTokens: delivered.reduce((s, d) => s + (d.used || 0), 0),
    // Same unit in both arms: the SS_FIX_* switches remove the route trailer / budget header that
    // ssDeliveredTokens reads, so compare switch-on vs switch-off runs on characters.
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
function report() {
  const rows = fs.existsSync(RUNS) ? fs.readFileSync(RUNS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const ok = rows.filter(r => !r.error && r.exitCode === 0);
  const M = [['accuracy', r => r.score], ['content', r => r.content], ['USD_noC', r => r.USD_noC], ['calls', r => r.calls],
    ['cost$', r => r.costRealizedUsd], ['naive$', r => r.costNaiveUsd], ['wallSec', r => r.wallMs / 1000], ['ssUsed', r => (r.arm === 'sweet' ? +r.ssUsed : null)]];
  console.log(`\n=== r282 ${CELL_NAME} (${CELL.model} via ${CELL.harness}, ${rows[0]?.harnessVersion || '?'}) — aggregates only ===`);
  console.log(`rows ${rows.length}  ok ${ok.length}  errors ${rows.length - ok.length}  timeouts ${rows.filter(r => r.timedOut).length}`);
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

// ─── main ──────────────────────────────────────────────────────────────────────────────────────
const HARNESS_VERSION = harnessVersion();
if (REPORT) { report(); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(STATE, { recursive: true });
// SS_VARIANT_OC_CACHE_KEY=product: copy the plugin from the main checkout ONCE, at run start.
const OC_PRODUCT_PLUGIN = OC_PRODUCT ? stageProductCachePlugin({ repo: REPO, stateRoot: STATE }) : null;
if (OC_PRODUCT_PLUGIN) console.error(`opencode product cache plugin: ${OC_PRODUCT_PLUGIN.src} (main ${OC_PRODUCT_PLUGIN.commit}${OC_PRODUCT_PLUGIN.dirty ? ', UNCOMMITTED edits' : ''}, sha ${OC_PRODUCT_PLUGIN.sha}) -> ${OC_PRODUCT_PLUGIN.file}`);
const done = new Set(fs.existsSync(RUNS) ? fs.readFileSync(RUNS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !r.error && r.exitCode === 0).map(r => `${r.arm}|${r.id}`) : []);
console.error(`r282 ${CELL_NAME}: ${CELL.model} via ${CELL.harness} (${HARNESS_VERSION}) effort=${CELL.effort ?? CELL.variant ?? 'default'} | ${PROBES.length} probes × ${ARMS.length} arms | conc=${CONC} | ${done.size} done`);
for (const orig of new Set(PROBES.map(p => p._orig))) ensureClone(orig);
const cleanup = [];
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
    const cwds = [...new Set(tasks.map(t => t.p._cwd))];
    if (arms.some(a => a.startsWith('sweet'))) { console.error(`[${label}] warming ${cwds.length} ss-* servers…`); for (const c of cwds) warmup(c); }
    let installed = [];
    if (CELL.harness === 'cc' && PRUNE3) throw new Error('SS_VARIANT_PRUNE3 is not wired for Claude Code');
    if (CELL.harness === 'cc' && arms.includes('sweet')) {
      installed = installClaudeProduct(cwds, claudeHome('sweet'));
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
    for (const c of cwds) { const d = cloneDrift(c); if (d.length) console.error(`  [DRIFT] ${path.basename(c)}: ${d.length} file(s) written after cloning: ${d.slice(0, 5).join(', ')}`); }
    if (fatal) throw fatal;
  }
} finally {
  for (const f of cleanup.splice(0)) f();
}
console.error(`\n${CELL_NAME} complete. Aggregates: CELL=${CELL_NAME} node scripts/retrieval-bench-282.mjs --report${SMOKE ? ' --smoke' : ''}`);
