#!/usr/bin/env node

/**
 * Sweet Search init — idempotent setup command.
 *
 * Detects project root, resolves profile, verifies/downloads required assets,
 * generates .sweet-search/config.json, runs verification, and prints a report.
 *
 * Usage:
 *   sweet-search init [--profile <core|full>] [--verify-deep] [--force] [--verbose]
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  getModelEntry, getModelsForProfile, getSkippedOptInModels, MODEL_REGISTRY, fetchModel, getModelCacheDir,
  getPlatformInfo, resolveNativeAddon, resolveNativeBinary,
  detectHardwareCapability,
  getCoremlCascadeState, getCoremlCascadeReport, fetchCoremlCascade,
  isDedupAvailable, getDedupLoadError, computeFingerprints, clusterFingerprints,
  DEDUP_CONFIG,
} from '../core/infrastructure/index.js';
import {
  LI_MODEL_EDGE,
  LI_MODEL_NONE,
  LI_MODEL_STANDARD,
  VALID_LI_MODELS,
  VALID_RERANK_POLICIES,
  normalizeLiModel,
  normalizePolicy,
  recommendInitDefaults,
} from '../core/ranking/late-interaction-policy.js';
import { describeDedupConfig } from '../core/infrastructure/index.js';
import { verifyRuntime, getMaxsimTier, getRouterType } from './verify-runtime.js';
import { ALL_HARNESSES, injectAgentInstructions } from './inject-agent-instructions.js';
import { writeClaudeRules } from './write-claude-rules.js';
import { installPromptReminderHook } from './install-prompt-reminders.js';
import { installToolEnforcement } from './install-tool-enforcement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

const VALID_PROFILES = ['core', 'full'];
const DATA_DIR_NAME = '.sweet-search';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseInitArgs(args) {
  const result = {
    profile: null,
    verifyDeep: false,
    force: false,
    verbose: false,
    help: false,
    buildCoremlCascade: false,
    skipCoremlCascade: false,
    skipDedup: false,
    skipPrewarmHook: false,
    skipCuda: false,
    liModel: null,           // Phase 4: --li-model standard|edge|none (raw user input; 'standard' aliased to 'lateon-code')
    searchReranking: null,   // Phase 4: --search-reranking auto|on|off
    wizard: false,           // Phase 4: --wizard runs interactive prompts
    // P1 (system-prompt opt) — agent-instruction injection.
    // Default: only CLAUDE.md (sweet-search is Claude-first).
    //   --agents / --gemini / --cursor opt INTO additional harness files.
    //   --no-claude opts OUT of CLAUDE.md *and* every .claude/* write
    //     (hooks, skills, rules, settings-json mutations).
    //   --no-agent-instructions is the umbrella: skip the four harness
    //     instruction files but keep .claude/* hooks unless --no-claude.
    skipAgentInstructions: false,
    symlinkInstructionFiles: true,
    optInHarnesses: new Set(),
    noClaude: false,
    skipPromptReminders: false, // P2: --no-prompt-reminders (default OFF)
    enforceTools: false,        // P3: --enforce-tools (default OFF — opt-in strict mode)
    codex: false,                // --codex: wire the Codex CLI SessionStart hook
    codexEnableGlobalHooks: false, // --codex-enable-global-hooks: also enable the flag in ~/.codex/config.toml
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--profile' || arg === '-p') {
      result.profile = args[++i] || null;
    } else if (arg.startsWith('--profile=')) {
      result.profile = arg.split('=')[1];
    } else if (arg === '--li-model') {
      result.liModel = args[++i] || null;
    } else if (arg.startsWith('--li-model=')) {
      result.liModel = arg.split('=')[1];
    } else if (arg === '--search-reranking') {
      result.searchReranking = args[++i] || null;
    } else if (arg.startsWith('--search-reranking=')) {
      result.searchReranking = arg.split('=')[1];
    } else if (arg === '--wizard') {
      result.wizard = true;
    } else if (arg === '--verify-deep') {
      result.verifyDeep = true;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    } else if (arg === '--build-coreml-cascade') {
      // Opt-in: run scripts/build-coreml-cascade.js as part of init.
      // Requires Python + coremltools locally (~12 min trace time).
      // Without this flag, init is capability-aware but passive:
      // it detects the cascade, reports its state, and never blocks.
      result.buildCoremlCascade = true;
    } else if (arg === '--skip-coreml-cascade') {
      // Opt-out: skip cascade inspection entirely. Useful on CI
      // or disk-constrained environments where even read-only
      // inspection of the managed cache is unwanted.
      result.skipCoremlCascade = true;
    } else if (arg === '--skip-dedup') {
      // Opt-out: skip dedup readiness inspection + smoke test.
      // Useful for benchmarks that want deterministic dedup-disabled
      // runs without touching the native addon.
      result.skipDedup = true;
    } else if (arg === '--skip-prewarm-hook') {
      // Opt-out: skip registering the Claude Code SessionStart prewarm
      // hook in .claude/settings.json. Useful when a user manages their
      // own Claude Code hooks and doesn't want init to touch the file.
      result.skipPrewarmHook = true;
    } else if (arg === '--skip-cuda') {
      // Opt-out: force-disable CUDA even when an NVIDIA GPU + -cuda
      // native package are present. Equivalent to SWEET_SEARCH_CUDA=0
      // but persisted through init's diagnostic output.
      result.skipCuda = true;
    } else if (arg === '--no-agent-instructions') {
      // P1: skip ALL instruction-file writes (CLAUDE.md / AGENTS.md /
      // GEMINI.md / .cursor/rules/sweet-search.mdc / .claude/rules/sweet-search.md).
      result.skipAgentInstructions = true;
    } else if (arg === '--no-symlink-instruction-files') {
      // P1: write GEMINI.md as a copy with @import rather than a symlink to
      // the canonical file. Useful on filesystems that don't support symlinks
      // (e.g. some Windows configurations) or when a tool requires a regular file.
      result.symlinkInstructionFiles = false;
    } else if (arg === '--symlink-instruction-files') {
      // P1: explicit ON — useful for clarity in scripts even though it's the default.
      result.symlinkInstructionFiles = true;
    } else if (arg === '--no-claude') {
      // P1: opt out of CLAUDE.md *and* every other .claude/* write that
      // init normally performs (rules file, /sweet-index skill,
      // index-maintainer hook, prewarm SessionStart entry). Universal
      // gate — the user has signalled they don't use Claude Code.
      // If `--agents` / `--gemini` / `--cursor` is also set, AGENTS.md
      // (or whichever opt-in is canonical) carries the policy instead.
      result.noClaude = true;
    } else if (arg === '--agents') {
      // P1: opt INTO writing AGENTS.md, the multi-harness convention
      // (Codex CLI, OpenCode, and any other tool that adopts AGENTS.md).
      result.optInHarnesses.add('agents');
    } else if (arg === '--gemini') {
      // P1: opt INTO writing GEMINI.md.
      result.optInHarnesses.add('gemini');
    } else if (arg === '--cursor') {
      // P1: opt INTO writing .cursor/rules/sweet-search.mdc.
      result.optInHarnesses.add('cursor');
    } else if (arg === '--codex') {
      // Wire the Codex CLI: write a SessionStart hook into .codex/hooks.json
      // (Codex's hook surface) reusing the same launcher as the Claude prewarm
      // hook, and ship AGENTS.md (Codex's instruction file) by implying
      // --agents. Independent of --no-claude (writes .codex/, not .claude/).
      result.codex = true;
      result.optInHarnesses.add('agents');
    } else if (arg === '--codex-enable-global-hooks') {
      // Opt-in: also enable the `[features] hooks` feature flag in the
      // user-level ~/.codex/config.toml. Off by default because it writes
      // outside the project into the user's hand-curated global config.
      result.codexEnableGlobalHooks = true;
    } else if (arg === '--no-prompt-reminders') {
      // P2: skip the UserPromptSubmit reminder hook. Default-on because
      // the reminder is the cheapest available shift-left for tool
      // selection (~80 tokens per prompt vs avoided re-search loops).
      result.skipPromptReminders = true;
    } else if (arg === '--enforce-tools') {
      // P3: opt-in strict mode — denies native Grep + installs a Read
      // hint hook. Opinionated and Claude-specific (per §4D).
      result.enforceTools = true;
    }
  }

  return result;
}

/**
 * Resolve the active harness list. Default is `claude-code` only;
 * `--agents` / `--gemini` / `--cursor` add to that set; `--no-claude`
 * removes claude-code (and gates every .claude/* write — see init flow).
 *
 * @param {object} args
 * @param {Set<string>|string[]} [args.optInHarnesses] subset of
 *   {agents, gemini, cursor} to add on top of the default
 * @param {boolean} [args.noClaude] when true, drops claude-code entirely
 * @returns {string[]} ordered list matching ALL_HARNESSES order
 */
export function resolveActiveHarnesses({ optInHarnesses, noClaude = false } = {}) {
  const optIn = optInHarnesses instanceof Set
    ? optInHarnesses
    : new Set(optInHarnesses ?? []);
  const active = new Set();
  if (!noClaude) active.add('claude-code');
  for (const h of optIn) active.add(h);
  return ALL_HARNESSES.filter(h => active.has(h));
}

// ---------------------------------------------------------------------------
// Node.js version check
// ---------------------------------------------------------------------------

export function checkNodeVersion() {
  const major = parseInt(process.versions.node, 10);
  if (major < 18) {
    throw new Error(
      `Node.js ${process.versions.node} is below the minimum required version (18.0.0).\n` +
      `  Please upgrade Node.js: https://nodejs.org/`
    );
  }
}

// ---------------------------------------------------------------------------
// Project root detection
// ---------------------------------------------------------------------------

export function detectProjectRoot(cwd = process.cwd()) {
  let dir = cwd;
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return cwd;
}

// ---------------------------------------------------------------------------
// Data directory
// ---------------------------------------------------------------------------

export function ensureDataDir(projectRoot) {
  const dataDir = join(projectRoot, DATA_DIR_NAME);
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

// ---------------------------------------------------------------------------
// Init config read/write
// ---------------------------------------------------------------------------

export function loadInitConfig(dataDir) {
  const configPath = join(dataDir, 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeInitConfig(dataDir, config) {
  const configPath = join(dataDir, 'config.json');
  const tmpPath = configPath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, configPath);
}

// ---------------------------------------------------------------------------
// LI policy resolution (Phase 4)
//
// Two persisted choices land in `.sweet-search/config.json::runtime.li`:
//   - `model`            : 'lateon-code' | 'lateon-code-edge' | 'none'
//   - `searchReranking`  : 'auto' | 'on' | 'off'
//
// Precedence (most-specific wins):
//   1. CLI flag (--li-model, --search-reranking) — explicit, persisted
//   2. --wizard interactive prompt (when TTY); non-TTY falls back to (3)/(4)
//   3. Existing persisted config (re-uses prior choice across re-runs)
//   4. Hardware-aware recommendation (recommendInitDefaults)
// ---------------------------------------------------------------------------

const LI_MODEL_ALIASES = {
  standard: LI_MODEL_STANDARD,
  full: LI_MODEL_STANDARD,
  edge: LI_MODEL_EDGE,
  small: LI_MODEL_EDGE,
  none: LI_MODEL_NONE,
  off: LI_MODEL_NONE,
  disable: LI_MODEL_NONE,
};

/**
 * Coerce a user-facing model alias to a canonical id. Returns null when
 * the input is unrecognized so the caller can produce a clear error.
 */
export function coerceLiModelChoice(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (LI_MODEL_ALIASES[v]) return LI_MODEL_ALIASES[v];
  return normalizeLiModel(v);
}

/**
 * Read the LI policy section from a parsed init config (the format written
 * by `buildConfig`). Defensive — returns an empty object when the section
 * is missing or malformed.
 */
function readPersistedLi(existingConfig) {
  const li = existingConfig?.runtime?.li;
  if (!li || typeof li !== 'object') return {};
  const out = {};
  if (typeof li.model === 'string' && VALID_LI_MODELS.includes(li.model)) {
    out.liModel = li.model;
  }
  if (typeof li.searchReranking === 'string' && VALID_RERANK_POLICIES.includes(li.searchReranking)) {
    out.searchReranking = li.searchReranking;
  }
  return out;
}

/**
 * Resolve the LI model + rerank policy from CLI args, persisted config,
 * and hardware capability. Pure (modulo `wizardFn` which performs I/O when
 * --wizard is set). Suitable for unit testing — pass a fake `wizardFn` and
 * a fixed capability snapshot.
 *
 * @param {object} input
 * @param {object} input.parsed             - parseInitArgs result
 * @param {object|null} input.existingConfig - prior `.sweet-search/config.json`
 * @param {object} input.capability         - detectHardwareCapability snapshot
 * @param {boolean} input.isTTY             - whether stdin is a TTY (for wizard fallback)
 * @param {Function} [input.wizardFn]       - async ({existingConfig, capability, recommendation, defaults}) => {liModel, searchReranking}
 *
 * @returns {Promise<{liModel: string, searchReranking: string, source: string, recommendation: object}>}
 */
export async function resolveLiPolicyChoices({
  parsed,
  existingConfig,
  capability,
  isTTY,
  wizardFn,
}) {
  const recommendation = recommendInitDefaults(capability ?? {});
  const persisted = readPersistedLi(existingConfig);

  // (1) CLI flags — validate now, fail fast with a clear message so users
  //     don't need to dig into the resolver. Wizard runs after CLI flags
  //     are validated so a bad --li-model never reaches the prompt.
  let cliModel = null;
  if (parsed.liModel) {
    cliModel = coerceLiModelChoice(parsed.liModel);
    if (cliModel == null) {
      throw new Error(
        `Invalid --li-model "${parsed.liModel}". Valid choices: ${VALID_LI_MODELS.join(', ')} (aliases: standard, edge, none).`,
      );
    }
  }
  let cliReranking = null;
  if (parsed.searchReranking) {
    const v = String(parsed.searchReranking).trim().toLowerCase();
    if (!VALID_RERANK_POLICIES.includes(v)) {
      throw new Error(
        `Invalid --search-reranking "${parsed.searchReranking}". Valid choices: ${VALID_RERANK_POLICIES.join(', ')}.`,
      );
    }
    cliReranking = v;
  }

  // (2) --wizard. Only meaningful on a TTY; on a non-TTY, fall through
  //     silently to (3)/(4) — wizard exists for humans, not CI.
  let wizardChoice = null;
  if (parsed.wizard && isTTY && typeof wizardFn === 'function') {
    wizardChoice = await wizardFn({
      existingConfig,
      capability,
      recommendation,
      defaults: {
        liModel: persisted.liModel ?? recommendation.liModel,
        searchReranking: persisted.searchReranking ?? recommendation.searchReranking,
      },
    });
  } else if (parsed.wizard && !isTTY) {
    process.stderr.write(
      '[init] --wizard requested on a non-TTY stdin; falling back to persisted config / hardware recommendation.\n',
    );
  }

  // Final selection — first non-null source for each field wins.
  const liModel =
    cliModel
    ?? wizardChoice?.liModel
    ?? persisted.liModel
    ?? recommendation.liModel;

  const searchReranking =
    cliReranking
    ?? wizardChoice?.searchReranking
    ?? persisted.searchReranking
    ?? recommendation.searchReranking;

  // Source label for logging — "where did each field actually come from".
  const sourceFor = (cli, wiz, per) => {
    if (cli) return 'cli';
    if (wiz) return 'wizard';
    if (per) return 'persisted';
    return 'recommendation';
  };
  const source = {
    liModel: sourceFor(cliModel, wizardChoice?.liModel, persisted.liModel),
    searchReranking: sourceFor(cliReranking, wizardChoice?.searchReranking, persisted.searchReranking),
  };

  return { liModel, searchReranking, source, recommendation };
}

/**
 * Interactive prompt — readline/promises. Caller has already verified
 * `process.stdin.isTTY`. Echoes the recommendation, accepts blank input
 * as the default, and validates each prompt before persisting.
 *
 * Exit ergonomics: blank input always defaults; ^C is allowed to throw,
 * caller treats it as "no choice made" and re-runs without --wizard.
 */
export async function runInitWizard({ existingConfig, capability, recommendation, defaults }) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write('\n');
    process.stdout.write('Sweet Search init — interactive setup\n');
    process.stdout.write('---------------------------------------\n');
    if (capability?.brandString) {
      process.stdout.write(`Hardware: ${capability.brandString} (${capability.totalMemGB?.toFixed?.(0) ?? '?'} GB RAM)\n`);
    }
    if (recommendation?.reason) {
      process.stdout.write(`Recommendation: ${recommendation.reason}\n`);
    }
    if (existingConfig?.runtime?.li) {
      process.stdout.write(
        `Currently persisted: liModel=${existingConfig.runtime.li.model ?? '?'}, `
        + `searchReranking=${existingConfig.runtime.li.searchReranking ?? '?'}\n`,
      );
    }
    process.stdout.write('\n');

    // ---- LI model prompt ----
    const modelPrompt =
      `Late-interaction model? [standard / edge / none] (default: ${defaults.liModel}): `;
    const liModelRaw = (await rl.question(modelPrompt)).trim() || defaults.liModel;
    const liModel = coerceLiModelChoice(liModelRaw);
    if (!liModel) {
      throw new Error(
        `Invalid model choice "${liModelRaw}". Valid: ${VALID_LI_MODELS.join(', ')} (aliases: standard, edge, none).`,
      );
    }

    // ---- Search reranking prompt ----
    // Suppress when liModel === 'none' — without an LI index there's
    // nothing to rerank, so persist 'off' explicitly.
    let searchReranking;
    if (liModel === LI_MODEL_NONE) {
      process.stdout.write('  (skipping search-reranking prompt — liModel=none implies no rerank)\n');
      searchReranking = 'off';
    } else {
      const rerankPrompt =
        `Search-time LI reranking? [auto / on / off] (default: ${defaults.searchReranking}): `;
      const raw = (await rl.question(rerankPrompt)).trim() || defaults.searchReranking;
      const v = raw.toLowerCase();
      if (!VALID_RERANK_POLICIES.includes(v)) {
        throw new Error(
          `Invalid rerank choice "${raw}". Valid: ${VALID_RERANK_POLICIES.join(', ')}.`,
        );
      }
      searchReranking = v;
    }

    // ---- Echo + confirm ----
    process.stdout.write('\n');
    process.stdout.write(`Plan: liModel=${liModel}, searchReranking=${searchReranking}\n`);
    if (liModel === LI_MODEL_EDGE && searchReranking === 'on') {
      process.stdout.write(
        'Note: edge LI rerank benchmarked below no-rerank on gencodesearchnet '
        + '(80.65% vs 82.91% MRR). "auto" is recommended.\n',
      );
    }
    const confirm = (await rl.question('Proceed? [Y/n]: ')).trim().toLowerCase();
    if (confirm === 'n' || confirm === 'no') {
      throw new Error('Wizard cancelled by user.');
    }

    return { liModel, searchReranking };
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Profile resolution
// ---------------------------------------------------------------------------

export function resolveProfile(cliProfile, existingConfig) {
  if (cliProfile) {
    if (!VALID_PROFILES.includes(cliProfile)) {
      throw new Error(
        `Unknown profile "${cliProfile}". Valid profiles: ${VALID_PROFILES.join(', ')}`
      );
    }
    return cliProfile;
  }
  if (existingConfig?.profile && VALID_PROFILES.includes(existingConfig.profile)) {
    return existingConfig.profile;
  }
  return 'full';
}

// ---------------------------------------------------------------------------
// Runtime asset verification (WASM/router/JS assets in the package)
// ---------------------------------------------------------------------------

export function verifyRuntimeAssets(packageRoot) {
  const manifestPath = join(packageRoot, 'core', 'infrastructure', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { ok: false, missing: ['core/infrastructure/manifest.json'], present: [] };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const missing = [];
  const present = [];

  for (const [key, relativePath] of Object.entries(manifest.runtimeAssets)) {
    const fullPath = join(packageRoot, relativePath);
    if (existsSync(fullPath)) {
      present.push(relativePath);
    } else {
      missing.push(relativePath);
    }
  }

  return { ok: missing.length === 0, missing, present };
}

// ---------------------------------------------------------------------------
// Native status check
// ---------------------------------------------------------------------------

export function checkNativeStatus() {
  const platformInfo = getPlatformInfo();
  return {
    platform: platformInfo,
    addon: resolveNativeAddon(),
    binary: resolveNativeBinary(),
  };
}

// ---------------------------------------------------------------------------
// Model download
// ---------------------------------------------------------------------------

/**
 * Filter the profile's model keys based on the resolved `liModel` choice.
 * - 'lateon-code'      → exclude all lateon-code-edge* keys (don't fetch the edge variant)
 * - 'lateon-code-edge' → exclude all standard lateon-code* keys (don't fetch the standard 768d backbone)
 * - 'none'             → exclude every lateon-* key (search rerank disabled product-wide)
 *
 * Order-preserving + non-mutating: returns a new array.
 */
export function filterModelKeysForLiChoice(modelKeys, liModel) {
  if (liModel === LI_MODEL_NONE) {
    return modelKeys.filter((k) => !k.startsWith('lateon-code'));
  }
  if (liModel === LI_MODEL_STANDARD) {
    return modelKeys.filter((k) => !k.startsWith('lateon-code-edge'));
  }
  if (liModel === LI_MODEL_EDGE) {
    // Keep only edge-flavoured keys; everything matching `lateon-code` but
    // not `lateon-code-edge` is a standard variant.
    return modelKeys.filter(
      (k) => !k.startsWith('lateon-code') || k.startsWith('lateon-code-edge'),
    );
  }
  return modelKeys;
}

export async function downloadModelsForProfile(profile, options = {}) {
  let modelKeys = getModelsForProfile(profile);
  if (options.liModel) {
    modelKeys = filterModelKeysForLiChoice(modelKeys, options.liModel);
  }
  if (modelKeys.length === 0) {
    return { results: new Map(), totalDownloaded: 0, totalCached: 0, failures: [] };
  }

  const results = new Map();
  let totalDownloaded = 0;
  let totalCached = 0;
  const failures = [];

  for (const key of modelKeys) {
    const entry = getModelEntry(key);
    if (!entry) {
      failures.push({ key, error: `Unknown model key: ${key}` });
      continue;
    }

    // --force: delete cached files before re-fetching
    if (options.force) {
      const cacheDir = getModelCacheDir(entry.hfId);
      for (const file of entry.files) {
        const filePath = join(cacheDir, file.path);
        if (existsSync(filePath)) {
          try { unlinkSync(filePath); } catch { /* ignore */ }
        }
      }
    }

    try {
      // init is ALWAYS allowed to download — the persisted
      // `allowRuntimeModelDownload: false` flag is meant to prevent
      // runtime (query-time) downloads, not to block init re-runs.
      // Without this explicit bypass, a second `sweet-search init`
      // after the first can't fetch a bumped SHA256 or a newly added
      // model, and `--force` leaves the cache empty and unfixable.
      const result = await fetchModel(key, {
        onProgress: options.onProgress,
        allowDownload: true,
      });
      results.set(key, { status: 'cached', cached: result.cached, downloaded: result.downloaded });
      totalDownloaded += result.downloaded;
      totalCached += result.cached;
    } catch (err) {
      failures.push({ key, error: err.message });
    }
  }

  return { results, totalDownloaded, totalCached, failures };
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

function printReport(report) {
  const {
    profile, maxsimTier, routerType, models, verification, runtimeDownloads,
    capability, cascadeReport, dedupReport, prewarmHookReport, skillReport,
    liChoices, agentInstructionsReport, claudeRulesReport,
    promptReminderReport, toolEnforcementReport,
  } = report;

  console.log('');
  console.log('Sweet Search init complete');
  console.log('');
  console.log(`  Profile:              ${profile}`);
  if (capability?.brandString) {
    console.log(`  Hardware:             ${capability.brandString} (${capability.platform}-${capability.arch})`);
  } else {
    console.log(`  Hardware:             ${capability?.platform ?? process.platform}-${capability?.arch ?? process.arch}`);
  }
  console.log(`  MaxSim:               ${maxsimTier}`);
  console.log(`  Router:               ${routerType}`);

  if (liChoices) {
    const { liModel, searchReranking, source } = liChoices;
    const srcStr = source
      ? ` (model: ${source.liModel}, rerank: ${source.searchReranking})`
      : '';
    console.log(`  LI model:             ${liModel}${srcStr}`);
    console.log(`  LI search rerank:     ${searchReranking}`);
    if (liModel === LI_MODEL_NONE) {
      console.log('                        ↳ rerank, read-semantic, ColGrep all disabled');
    } else if (liModel === LI_MODEL_EDGE && searchReranking === 'on') {
      console.log('                        ↳ NOTE: edge LI rerank benchmarked below no-rerank — consider "auto"');
    }
  }

  // NVIDIA / CUDA status line. Shown only when it's actionable:
  //   cudaAvailable=true  → confirm GPU detection (user-visible win)
  //   nvidiaGpu present but cudaAddonEnabled=false → warn that the
  //       installed -cuda package is missing (user needs to act)
  // If no NVIDIA GPU is present, stay silent — most Linux hosts
  // don't have one and a "no GPU" line is noise.
  if (capability?.cudaAvailable) {
    const g = capability.nvidiaGpu;
    console.log(
      `  NVIDIA GPU:           ${g.name} (CC ${g.computeCapability}, ${g.memoryMB} MB, driver ${g.driverVersion}) — candle-cuda armed`,
    );
  } else if (capability?.nvidiaGpu && !capability.cudaAddonEnabled) {
    const g = capability.nvidiaGpu;
    const arch = capability.arch === 'arm64' ? 'arm64' : 'x64';
    console.log(
      `  NVIDIA GPU:           ${g.name} detected but CUDA addon missing —\n` +
        `                        install @sweet-search/native-linux-${arch}-gnu-cuda to enable GPU indexing`,
    );
  }

  if (profile !== 'core') {
    for (const [key, info] of models) {
      const label = key.replace(/-/g, ' ');
      console.log(`  ${label}: ${info.status}`);
    }
  }

  // CoreML cascade line. Shown only when it says something actionable —
  // silent on ineligible hardware where no user action applies.
  if (cascadeReport) {
    if (cascadeReport.status === 'present') {
      console.log(`  CoreML cascade:       present (${cascadeReport.detail})`);
    } else if (cascadeReport.status === 'partial') {
      console.log(`  CoreML cascade:       PARTIAL — ${cascadeReport.detail}`);
    } else if (cascadeReport.status === 'not-built' && cascadeReport.applicable) {
      console.log(`  CoreML cascade:       eligible but not built — ${cascadeReport.detail}`);
    } else if (cascadeReport.status === 'disabled') {
      console.log(`  CoreML cascade:       disabled (${cascadeReport.detail})`);
    }
    // 'not-applicable' and 'skipped' are silent — no user action available.
  }

  if (dedupReport) {
    if (dedupReport.status === 'ready') {
      let line = `  Dedup:                ready (${dedupReport.detail})`;
      if (dedupReport.smokeTest) {
        const pass = dedupReport.smokeTest.passed;
        line += pass ? ', smoke-test pass' : ', smoke-test FAIL';
      }
      console.log(line);
    } else if (dedupReport.status === 'disabled') {
      console.log(`  Dedup:                disabled (${dedupReport.detail})`);
    } else if (dedupReport.status === 'unavailable') {
      console.log(`  Dedup:                unavailable — ${dedupReport.detail}`);
    }
    // 'skipped' is silent — explicit user opt-out.
  }

  if (prewarmHookReport) {
    if (prewarmHookReport.status === 'registered') {
      console.log(`  Prewarm hook:         registered — first query is warm if ≥2s after session start`);
    } else if (prewarmHookReport.status === 'error') {
      console.log(`  Prewarm hook:         ERROR — ${prewarmHookReport.detail}`);
    }
    // 'skipped' is silent — explicit user opt-out.
  }

  if (skillReport) {
    if (skillReport.status === 'installed') {
      console.log(`  /sweet-index skill:   installed → ${skillReport.skillPath}`);
    } else if (skillReport.status === 'already-installed') {
      console.log(`  /sweet-index skill:   already installed`);
    } else if (skillReport.status === 'error') {
      console.log(`  /sweet-index skill:   ERROR — ${skillReport.detail}`);
    }
  }

  if (agentInstructionsReport) {
    const summary = Object.entries(agentInstructionsReport.harnesses)
      .map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`  Agent instructions:   ${summary}`);
  }
  if (claudeRulesReport) {
    console.log(`  Claude rules file:    ${claudeRulesReport.status}`);
  }
  if (promptReminderReport && promptReminderReport.status !== 'skipped') {
    console.log(`  Prompt reminder hook: ${promptReminderReport.status}`);
  }
  if (toolEnforcementReport && toolEnforcementReport.status !== 'skipped') {
    console.log(`  Tool enforcement:     ${toolEnforcementReport.status} (Grep deny + Read hint)`);
  }

  console.log(`  Runtime downloads:    ${runtimeDownloads}`);

  const passedCount = verification.checks.filter(c => c.status === 'pass').length;
  const totalCount = verification.checks.length;
  console.log(`  Verification:         ${verification.type}-pass (${passedCount}/${totalCount})`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Dedup readiness inspection
// ---------------------------------------------------------------------------

/**
 * Check whether the dedup NAPI surface is loadable, and optionally run a
 * deterministic smoke test to verify cross-run bit-equality on this host.
 * Returns `{ status, detail, smokeTest? }` suitable for the init report +
 * .sweet-search/config.json persistence.
 *
 * Statuses:
 *   ready         — addon loads, functions callable, config enabled
 *   disabled      — config SWEET_SEARCH_DEDUP_ENABLED=0
 *   unavailable   — native addon missing or functions not exported
 *   skipped       — explicit --skip-dedup flag
 */
export function inspectDedupReadiness({ deep = false, skipped = false } = {}) {
  if (skipped) return { status: 'skipped', detail: '--skip-dedup flag' };
  if (!DEDUP_CONFIG.enabled) return { status: 'disabled', detail: 'SWEET_SEARCH_DEDUP_ENABLED=0' };
  if (!isDedupAvailable()) {
    const err = getDedupLoadError();
    return {
      status: 'unavailable',
      detail: err ? err.message : 'native addon missing',
    };
  }
  const base = { status: 'ready', detail: describeDedupConfig(DEDUP_CONFIG) };
  if (!deep) return base;

  try {
    const fixtures = [
      'function foo(x) { return x + 1; } function bar(y) { return y * 2; }',
      'function foo(x) { return x + 1; } function bar(y) { return y * 2; }',
      'class Widget { constructor() { this.v = 42; } render() { return this.v; } }',
    ];
    const fpsA = computeFingerprints(fixtures);
    const fpsB = computeFingerprints(fixtures);
    const deterministic = fpsA.every((fp, i) => (
      fp.simhashHex === fpsB[i].simhashHex
      && Buffer.compare(fp.minhash, fpsB[i].minhash) === 0
    ));
    const clusters = clusterFingerprints(fpsA);
    const foundDup = clusters.some((c) => c.siblingIdxs.length > 0);
    return {
      ...base,
      smokeTest: {
        deterministic,
        foundDup,
        passed: deterministic && foundDup,
      },
    };
  } catch (err) {
    return {
      status: 'unavailable',
      detail: `smoke test errored: ${err.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Claude Code SessionStart daemon-prewarm hook
// ---------------------------------------------------------------------------

// The hook script's filename doubles as the ownership marker — a path-based
// marker works on every OS and survives JSON re-serialization without shell-
// syntax concerns. Both init and uninstall grep the command string for this
// substring to find entries sweet-search owns.
//
// The hook spawns a detached search daemon at Claude Code SessionStart so the
// user's first `sweet-search <query>` hits an already-warm daemon (~80ms
// instead of ~2.5s cold). The earlier page-cache preheat
// (`session-preheat-hook.mjs`) was measured to save ~0ms on query latency —
// the daemon's own init warms the same pages anyway — and was replaced.
export const PREWARM_HOOK_FILENAME = 'session-daemon-prewarm.mjs';

/**
 * Register (or update) a SessionStart entry in `.claude/settings.json` that
 * spawns the search daemon in the background on every Claude Code session.
 * Non-destructive: preserves all existing hooks, permissions, env, etc.
 * Idempotent: re-running init replaces the existing sweet-search entry rather
 * than appending a duplicate.
 *
 * Returns `{ status, detail }` suitable for the init report.
 *   registered  — entry written (new or updated)
 *   skipped     — --skip-prewarm-hook, or package lives outside projectRoot
 *   error       — write failed; init continues (never blocks)
 */
export function registerPrewarmSessionStartHook({
  projectRoot,
  packageRoot,
  skipped = false,
} = {}) {
  if (skipped) return { status: 'skipped', detail: '--skip-prewarm-hook flag' };

  const hookScriptAbs = join(packageRoot, 'core', 'search', PREWARM_HOOK_FILENAME);
  if (!existsSync(hookScriptAbs)) {
    return { status: 'error', detail: `hook script missing: ${hookScriptAbs}` };
  }

  // Refuse to write a machine-specific absolute path into settings.json — that
  // file is frequently committed, and an absolute path from a hoisted pnpm /
  // npm-linked / globally-installed sweet-search would leak the init machine's
  // filesystem layout to every teammate.
  const hookPath = relative(projectRoot, hookScriptAbs);
  if (hookPath.startsWith('..') || isAbsolute(hookPath)) {
    return {
      status: 'skipped',
      detail: 'package lives outside projectRoot (hoisted / linked / global install) — re-run with --skip-prewarm-hook to silence this',
    };
  }

  const command = `node ${hookPath}`;

  const settingsDir = join(projectRoot, '.claude');
  const settingsPath = join(settingsDir, 'settings.json');

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch (err) {
      return { status: 'error', detail: `existing settings.json is not valid JSON: ${err.message}` };
    }
  }

  settings.hooks = settings.hooks || {};
  const sessionStart = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];

  const entry = {
    hooks: [
      {
        type: 'command',
        command,
        timeout: 4000,
        continueOnError: true,
      },
    ],
  };

  // Find and replace any existing sweet-search-owned entry by filename match.
  const ownedIdx = sessionStart.findIndex((group) =>
    Array.isArray(group?.hooks) &&
    group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(PREWARM_HOOK_FILENAME))
  );

  if (ownedIdx >= 0) {
    sessionStart[ownedIdx] = entry;
  } else {
    sessionStart.push(entry);
  }
  settings.hooks.SessionStart = sessionStart;

  try {
    mkdirSync(settingsDir, { recursive: true });
    const tmpPath = settingsPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, settingsPath);
  } catch (err) {
    return { status: 'error', detail: err.message };
  }

  return {
    status: 'registered',
    detail: ownedIdx >= 0 ? 'updated existing entry' : 'added new entry',
    hookPath,
  };
}

// ---------------------------------------------------------------------------
// Codex CLI SessionStart hook (--codex)
// ---------------------------------------------------------------------------

export const CODEX_HOOKS_FILENAME = 'hooks.json';

/**
 * Register (or update) a Codex CLI SessionStart hook in `.codex/hooks.json`
 * that launches the search server + incremental-index maintainer on every
 * Codex session — the Codex analogue of `registerPrewarmSessionStartHook`.
 * Reuses the same harness-agnostic launcher (`session-daemon-prewarm.mjs`,
 * matched by `PREWARM_HOOK_FILENAME`), which reads only env/cwd and writes
 * nothing to stdout, so it is safe under Codex's hook contract.
 *
 * Codex hook schema (developers.openai.com/codex/hooks):
 *   { "hooks": { "SessionStart": [ { "hooks": [ { type, command, timeout } ] } ] } }
 *
 * Non-destructive + idempotent: preserves other events/entries and replaces
 * the sweet-search-owned entry (matched by the launcher filename) instead of
 * appending a duplicate. Refuses to write a machine-specific absolute path
 * into the (often committed) `.codex/hooks.json`, mirroring the Claude path.
 *
 * NOTE: hooks only fire when Codex's `[features] hooks` flag is enabled and the
 * project `.codex/` layer is trusted (reviewed via `/hooks`) — neither of which
 * a project init can fully guarantee. `ensureCodexHooksFeatureFlag` handles the
 * flag (best-effort) and the init report prints the trust caveat.
 *
 * @returns {{status:'registered'|'skipped'|'error', detail:string, hookPath?:string}}
 */
export function registerCodexSessionStartHook({ projectRoot, packageRoot, skipped = false } = {}) {
  if (skipped) return { status: 'skipped', detail: '--skip-prewarm-hook flag' };

  const hookScriptAbs = join(packageRoot, 'core', 'search', PREWARM_HOOK_FILENAME);
  if (!existsSync(hookScriptAbs)) {
    return { status: 'error', detail: `hook script missing: ${hookScriptAbs}` };
  }

  const hookPath = relative(projectRoot, hookScriptAbs);
  if (hookPath.startsWith('..') || isAbsolute(hookPath)) {
    return {
      status: 'skipped',
      detail: 'package lives outside projectRoot (hoisted / linked / global install) — re-run with --skip-prewarm-hook to silence this',
    };
  }

  // Codex runs hook commands with the *session* cwd, and per its hooks docs a
  // session "may be started from a subdirectory", so a bare relative path is
  // unreliable — the docs explicitly recommend resolving from the git root.
  // We `cd` to the git toplevel first (falling back to the current dir outside
  // a repo), which fixes both path resolution AND the launcher's own
  // `process.cwd()` project-root detection, while staying machine-portable
  // (no absolute path is written into the often-committed hooks.json).
  const command = `cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && node ${JSON.stringify(hookPath)}`;
  const codexDir = join(projectRoot, '.codex');
  const hooksPath = join(codexDir, CODEX_HOOKS_FILENAME);

  let doc = {};
  if (existsSync(hooksPath)) {
    try {
      doc = JSON.parse(readFileSync(hooksPath, 'utf-8'));
    } catch (err) {
      return { status: 'error', detail: `existing .codex/hooks.json is not valid JSON: ${err.message}` };
    }
  }

  doc.hooks = doc.hooks || {};
  const sessionStart = Array.isArray(doc.hooks.SessionStart) ? doc.hooks.SessionStart : [];

  // `matcher` mirrors the official Codex SessionStart example: fire on a new
  // session and on resume (the cases where the daemon may not be running yet).
  // `timeout` is in seconds (per Codex's hooks docs); the launcher detaches and
  // returns in well under a second, so a small budget is plenty.
  const entry = {
    matcher: 'startup|resume',
    hooks: [
      {
        type: 'command',
        command,
        timeout: 10,
      },
    ],
  };

  const ownedIdx = sessionStart.findIndex((group) =>
    Array.isArray(group?.hooks) &&
    group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(PREWARM_HOOK_FILENAME))
  );

  if (ownedIdx >= 0) {
    sessionStart[ownedIdx] = entry;
  } else {
    sessionStart.push(entry);
  }
  doc.hooks.SessionStart = sessionStart;

  try {
    mkdirSync(codexDir, { recursive: true });
    const tmpPath = hooksPath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, hooksPath);
  } catch (err) {
    return { status: 'error', detail: err.message };
  }

  return {
    status: 'registered',
    detail: ownedIdx >= 0 ? 'updated existing entry' : 'added new entry',
    hookPath,
  };
}

/**
 * Ensure the canonical Codex hooks feature flag `[features] hooks = true` is
 * present in a Codex `config.toml`, preserving the file's existing content +
 * comments. Targeted text edit (no TOML round-trip) so a hand-curated config is
 * never reformatted.
 *
 * `hooks` is the canonical key as of Codex v0.132+. The earlier `codex_hooks`
 * key is deprecated (Codex now prints a deprecation warning for it), so this
 * function also MIGRATES a legacy `codex_hooks` flag to `hooks` instead of
 * writing the deprecated name. Legacy handling is deliberate: users who ran an
 * older sweet-search (which wrote `codex_hooks`) or older Codex shouldn't be
 * left with a deprecated, warning-producing flag.
 *
 * Behaviour:
 *   - `hooks = true` already present → no-op ('already'); if a deprecated
 *     `codex_hooks` line also lingers, strip it ('migrated')
 *   - `hooks` present but non-true → respect the user's choice ('present-other')
 *   - legacy `codex_hooks` present (no `hooks` key) → rename the key to `hooks`
 *     in place, preserving its value + inline comment ('migrated')
 *   - a `[features]` table exists → insert `hooks = true` under its header
 *   - no `[features]` table → append a fresh block at EOF
 *   - file absent + `create` → create it; absent + no `create` → 'absent'
 *
 * @param {string} configPath
 * @param {{create?:boolean}} [opts]
 * @returns {{status:'created'|'added'|'migrated'|'already'|'present-other'|'absent'|'error', path:string, detail?:string}}
 */
export function ensureCodexHooksFeatureFlag(configPath, { create = false } = {}) {
  const exists = existsSync(configPath);
  if (!exists && !create) return { status: 'absent', path: configPath };

  let text = '';
  if (exists) {
    try {
      text = readFileSync(configPath, 'utf-8');
    } catch (err) {
      return { status: 'error', path: configPath, detail: `read failed: ${err.message}` };
    }
  }

  const write = (next, status) => {
    try {
      mkdirSync(dirname(configPath), { recursive: true });
      const tmp = configPath + '.tmp';
      writeFileSync(tmp, next, 'utf-8');
      renameSync(tmp, configPath);
    } catch (err) {
      return { status: 'error', path: configPath, detail: `write failed: ${err.message}` };
    }
    return { status, path: configPath };
  };

  // `^[ \t]*hooks` cannot match a `codex_hooks` line (the prefix differs), so
  // these canonical-key checks never collide with the legacy key.
  const HOOKS_TRUE = /^[ \t]*hooks[ \t]*=[ \t]*true\b/m;
  const HOOKS_ANY = /^[ \t]*hooks[ \t]*=/m;
  const LEGACY_ANY = /^[ \t]*codex_hooks[ \t]*=/m;
  const LEGACY_LINE = /^[ \t]*codex_hooks[ \t]*=.*(?:\r?\n)?/m;

  // Canonical flag already enabled.
  if (HOOKS_TRUE.test(text)) {
    if (LEGACY_ANY.test(text)) {
      // Strip the deprecated `codex_hooks` line so Codex v0.132+ stops warning.
      return write(text.replace(LEGACY_LINE, ''), 'migrated');
    }
    return { status: 'already', path: configPath };
  }

  // Canonical flag present but explicitly non-true → respect the user's choice;
  // don't add a duplicate key (which would make the TOML invalid).
  if (HOOKS_ANY.test(text)) {
    return { status: 'present-other', path: configPath };
  }

  // Deprecated `codex_hooks` present (no canonical key) → migrate the key name
  // in place, preserving its value and any inline comment.
  if (LEGACY_ANY.test(text)) {
    return write(text.replace(/^([ \t]*)codex_hooks([ \t]*=.*)$/m, '$1hooks$2'), 'migrated');
  }

  // Neither key present → add the canonical flag.
  let next;
  if (!exists || text.trim() === '') {
    next = '[features]\nhooks = true\n';
  } else if (/^[ \t]*\[features\][ \t]*$/m.test(text)) {
    next = text.replace(/^([ \t]*\[features\][ \t]*)$/m, '$1\nhooks = true');
  } else {
    const sep = text.endsWith('\n') ? '' : '\n';
    next = `${text}${sep}\n[features]\nhooks = true\n`;
  }
  return write(next, exists ? 'added' : 'created');
}

// ---------------------------------------------------------------------------
// /sweet-index skill installation
// ---------------------------------------------------------------------------

// The skill is shipped inside the npm tarball at core/skills/sweet-index/SKILL.md
// (see package.json::files). Init copies it into the project's
// .claude/skills/sweet-index/ — creating the .claude tree if absent — so users
// who haven't yet adopted Claude Code still get the skill available the moment
// they do. Per-project install (not global ~/.claude) so different projects
// can pin different sweet-search versions without skill drift.
//
// Returns `{ status, detail, skillPath? }` for the init report:
//   installed         — copied SKILL.md (new install)
//   already-installed — destination existed, left untouched (idempotent)
//   error             — copy failed; init continues (never blocks)
export function installSweetIndexSkill({ projectRoot, packageRoot } = {}) {
  const skillDir = join(projectRoot, '.claude', 'skills', 'sweet-index');
  const skillDest = join(skillDir, 'SKILL.md');
  const skillSrc = join(packageRoot, 'core', 'skills', 'sweet-index', 'SKILL.md');

  if (!existsSync(skillSrc)) {
    return {
      status: 'error',
      detail: `skill source missing in package: ${skillSrc} (re-install sweet-search)`,
    };
  }

  if (existsSync(skillDest)) {
    return {
      status: 'already-installed',
      detail: skillDir,
      skillPath: skillDest,
    };
  }

  try {
    mkdirSync(skillDir, { recursive: true });
    copyFileSync(skillSrc, skillDest);
    return {
      status: 'installed',
      detail: skillDir,
      skillPath: skillDest,
    };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Sweet Search init — set up runtime assets and models

Usage:
  sweet-search init [options]

Options:
  --profile <profile>       Install profile: core, full (default: full)
  --li-model <choice>       Late-interaction model: standard | edge | none.
                            Aliases: 'standard' = lateon-code (149M, 128d, accuracy
                            default), 'edge' = lateon-code-edge (17M, 48d, smaller +
                            faster), 'none' = disable LI rerank, read-semantic and
                            ColGrep entirely. Persisted to .sweet-search/config.json.
  --search-reranking <p>    Search-time LI rerank policy: auto | on | off.
                            'auto' resolves from the LI index manifest at search time
                            (standard index → on, edge index → off, missing/mismatched
                            → off). 'on' / 'off' are explicit overrides. Persisted.
  --wizard                  Run interactive setup prompts for --li-model and
                            --search-reranking. Falls back to persisted/recommended
                            defaults on a non-TTY stdin (CI-safe).
  --verify-deep             Run deep verification (load modules, verify checksums)
  --force                   Re-download all models even if cached
  --build-coreml-cascade    (M3+ Apple Silicon, local builds only) Trace the
                            CoreML variant cascade locally via
                            scripts/build-coreml-cascade.js instead of fetching
                            from HuggingFace. Requires Python 3 + coremltools
                            (~12 min trace time). Skipped automatically on
                            ineligible hardware. Usually not needed — the
                            default HF fetch path is faster and works without
                            Python.
  --skip-coreml-cascade     Skip CoreML cascade fetch entirely. Useful on CI
                            or disk-constrained environments.
  --skip-dedup              Skip near-duplicate dedup readiness inspection.
                            Useful for benchmarks requiring dedup-disabled
                            runs without touching the native addon.
  --skip-prewarm-hook       Skip registering the Claude Code SessionStart
                            daemon-prewarm hook in .claude/settings.json.
                            The hook spawns the search daemon in the
                            background so the first query is warm. Skip
                            this when the project already manages its own
                            hooks or does not use Claude Code.
  --skip-cuda               Force-disable the CUDA backend even when an
                            NVIDIA GPU and the -cuda native package are
                            detected. Equivalent to SWEET_SEARCH_CUDA=0.
                            Indexing falls back to candle-cpu.
  --no-agent-instructions   Skip the agent-instruction injection layer
                            entirely (no CLAUDE.md, no AGENTS.md, no
                            GEMINI.md, no Cursor rule, no
                            .claude/rules/sweet-search.md). Use when you
                            manage your own agent instructions. Idempotent
                            rewrites use a marker block; re-running init
                            never duplicates content.
  --no-claude               Don't ship anything to .claude/. Skips
                            CLAUDE.md + .claude/rules/sweet-search.md +
                            .claude/hooks/index-maintainer.mjs +
                            .claude/skills/sweet-index/ +
                            .claude/settings.json prewarm SessionStart entry.
                            Combine with --agents / --gemini / --cursor to
                            ship the policy through a non-Claude harness.
  --agents                  Also ship AGENTS.md, the multi-harness
                            convention read by Codex CLI, OpenCode, and any
                            other tool that adopts AGENTS.md. Without
                            --no-claude, AGENTS.md is a thin @CLAUDE.md
                            import shim; with --no-claude it carries the
                            full canonical policy body.
  --gemini                  Also ship GEMINI.md (symlink → canonical, or
                            an @import file when --no-symlink-instruction-files).
  --cursor                  Also ship .cursor/rules/sweet-search.mdc with
                            sweet-search frontmatter.
  --codex                   Wire the Codex CLI: write a SessionStart hook into
                            .codex/hooks.json (reusing the same launcher as the
                            Claude prewarm hook, so Codex sessions also start the
                            search server + default-on incremental maintainer),
                            enable [features] hooks = true in the project
                            .codex/config.toml (migrating a deprecated codex_hooks
                            flag if present), and ship AGENTS.md (implies
                            --agents). Independent of --no-claude. You must enable
                            hooks ([features] hooks = true, or 'codex --enable
                            hooks') and review/trust repo-local hooks with /hooks
                            in Codex for the project hook to run; if your Codex
                            only honors the user-level flag, add
                            --codex-enable-global-hooks.
  --codex-enable-global-hooks
                            With --codex, also enable [features] hooks = true in
                            the user-level ~/.codex/config.toml (append-if-absent,
                            comment-preserving, migrates a deprecated codex_hooks).
                            Off by default because it writes outside the project
                            into your global Codex config.
  --no-symlink-instruction-files
                            Write GEMINI.md as a regular file with an @import
                            line rather than a symlink to the canonical file.
                            Useful on filesystems / hosts where symlinks
                            aren't supported. Default is to symlink.
  --no-prompt-reminders     Skip the UserPromptSubmit reminder hook (default
                            on). The reminder injects a small (~80 token)
                            sweet-search tool-routing summary into every
                            prompt to prevent drift back to native Grep/Read.
                            Always implied when --no-claude is set.
  --enforce-tools           (Opt-in strict mode) Deny native Grep entirely
                            (forces ss-grep) and install a hint hook for
                            native Read suggesting ss-read / ss-semantic.
                            Read is hinted, not blocked, because edit
                            workflows legitimately need Read. Always
                            implied off when --no-claude is set.
  --verbose, -v             Enable verbose output
  --help, -h                Show this help

Profiles:
  core    Lightweight search setup (no models)
  full    Full search with all models (~523 MB download + ~1.8 GB CoreML
          cascade on M3+ Apple Silicon)

CoreML cascade (M3+ Apple Silicon only):
  A fast-path for NomicBERT embedding + ModernBERT late-interaction
  inference via Apple's Neural Engine. Gives ~18% faster full indexing
  on M3 Max vs the candle Metal baseline. Fetched automatically from
  mrsladoje/sweet-search-coreml-cascade on HuggingFace as part of the
  full profile. Non-eligible hardware (Intel Mac, Linux, M1/M2) never
  downloads the cascade. See docs/INIT_STRATEGY.md for the delivery
  strategy.

Examples:
  sweet-search init                         # Full profile (default)
  sweet-search init --profile core          # Core profile (no model downloads)
  sweet-search init --force                 # Re-download all models
  sweet-search init --build-coreml-cascade  # Trace the cascade locally (dev only)
`);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runInit(args) {
  const parsed = parseInitArgs(args);

  if (parsed.help) {
    printHelp();
    return;
  }

  // 1. Node.js version check
  checkNodeVersion();

  // 2. Detect project root
  const projectRoot = detectProjectRoot();
  if (parsed.verbose) {
    process.stderr.write(`[init] Project root: ${projectRoot}\n`);
  }

  // 3. Ensure .sweet-search/ directory
  const dataDir = ensureDataDir(projectRoot);
  if (parsed.verbose) {
    process.stderr.write(`[init] Data directory: ${dataDir}\n`);
  }

  // 4. Resolve profile
  const existingConfig = loadInitConfig(dataDir);
  const profile = resolveProfile(parsed.profile, existingConfig);
  process.stderr.write(`[init] Profile: ${profile}\n`);

  // 4.5. Resolve LI policy (Phase 4 — `--li-model`, `--search-reranking`,
  //      `--wizard`). Done early so the model-fetch loop, cascade fetch,
  //      and final config write all see the same choices. Uses an early
  //      hardware capability snapshot for the recommendation; the snapshot
  //      is recomputed later for the runtime config (cheap + cacheable).
  const earlyCapability = detectHardwareCapability();
  let liChoices;
  try {
    liChoices = await resolveLiPolicyChoices({
      parsed,
      existingConfig,
      capability: earlyCapability,
      isTTY: process.stdin.isTTY === true,
      wizardFn: runInitWizard,
    });
  } catch (err) {
    process.stderr.write(`[init] LI policy resolution failed: ${err.message}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `[init] LI policy: model=${liChoices.liModel} (${liChoices.source.liModel}), `
    + `searchReranking=${liChoices.searchReranking} (${liChoices.source.searchReranking})\n`,
  );
  if (liChoices.source.liModel === 'recommendation' && liChoices.recommendation?.reason) {
    process.stderr.write(`[init]   recommendation reason: ${liChoices.recommendation.reason}\n`);
  }
  if (liChoices.liModel === LI_MODEL_NONE) {
    process.stderr.write(
      '[init]   note: liModel=none disables LI rerank, read-semantic and ColGrep — '
      + 're-run with --li-model standard|edge to re-enable.\n',
    );
  }

  // 5. Verify runtime assets (WASM, router, etc.)
  const assetCheck = verifyRuntimeAssets(PACKAGE_ROOT);
  if (!assetCheck.ok) {
    process.stderr.write(`[init] ERROR: Missing runtime assets:\n`);
    for (const m of assetCheck.missing) {
      process.stderr.write(`  - ${m}\n`);
    }
    process.stderr.write(`  Try reinstalling sweet-search: npm install sweet-search\n`);
    process.exit(1);
  }
  process.stderr.write(`[init] Runtime assets: OK (${assetCheck.present.length}/${assetCheck.present.length} present)\n`);

  // 6. Check native status
  const nativeStatus = checkNativeStatus();
  const maxsimTier = getMaxsimTier();
  const routerType = getRouterType();
  if (parsed.verbose) {
    process.stderr.write(`[init] MaxSim tier: ${maxsimTier}\n`);
    process.stderr.write(`[init] Router type: ${routerType}\n`);
  }

  // 7. Download models for profile (filtered by LI choice).
  //    `liModel === 'none'` skips every lateon-* key; 'standard' skips edge
  //    variants; 'edge' skips standard variants. Saves disk + bandwidth on
  //    constrained installs.
  const allModelKeys = getModelsForProfile(profile);
  const modelKeys = filterModelKeysForLiChoice(allModelKeys, liChoices.liModel);
  const skippedByLiChoice = allModelKeys.filter((k) => !modelKeys.includes(k));
  if (skippedByLiChoice.length > 0 && parsed.verbose) {
    process.stderr.write(
      `[init]   liModel=${liChoices.liModel} → skipping ${skippedByLiChoice.length} model key(s): ${skippedByLiChoice.join(', ')}\n`,
    );
  }
  const skippedOptIns = getSkippedOptInModels(profile);
  let modelResults = new Map();

  // Tell the user once which optional models are being skipped. This is
  // NOT an error — these are opt-in features (e.g. cross-encoder
  // rerankers disabled by default since commit 43a61eb). Without this
  // line, init silently omitting them looks like a missing-model bug.
  if (skippedOptIns.length > 0) {
    for (const skipped of skippedOptIns) {
      process.stderr.write(
        `[init] Skipping opt-in model "${skipped.key}" — ` +
          `set ${skipped.envVars.map((v) => v + '=1').join(' or ')} to install. ` +
          `(${skipped.reason})\n`,
      );
    }
  }

  if (modelKeys.length > 0) {
    process.stderr.write(`[init] Downloading models for profile "${profile}"...\n`);
    const downloadResult = await downloadModelsForProfile(profile, {
      force: parsed.force,
      liModel: liChoices.liModel,
    });

    modelResults = downloadResult.results;

    if (downloadResult.failures.length > 0) {
      process.stderr.write(`[init] ERROR: Failed to download required models:\n`);
      for (const f of downloadResult.failures) {
        process.stderr.write(`  - ${f.key}: ${f.error}\n`);
      }
      process.stderr.write(`  Run \`sweet-search init --force\` to retry.\n`);

      // Write partial config for diagnostics before exiting
      const partialConfig = buildConfig({
        profile, maxsimTier, routerType, nativeStatus,
        modelResults, verification: { type: 'none', timestamp: new Date().toISOString(), checks: [] },
        failed: true,
        liChoices,
      });
      writeInitConfig(dataDir, partialConfig);

      process.exit(1);
    }

    const cached = downloadResult.totalCached;
    const downloaded = downloadResult.totalDownloaded;
    process.stderr.write(`[init] Models: ${cached} cached, ${downloaded} downloaded\n`);
  } else {
    process.stderr.write(`[init] No models required for profile "${profile}"\n`);
  }

  // --skip-cuda: translate to SWEET_SEARCH_CUDA=0 so the shared
  // capability detection on hardware-capability.js honors it. Set before
  // detectHardwareCapability() runs because that call caches its result.
  if (parsed.skipCuda && !process.env.SWEET_SEARCH_CUDA) {
    process.env.SWEET_SEARCH_CUDA = '0';
  }

  // 8. Resolve hardware capability + CoreML cascade state.
  //
  // The cascade is an M3+ Apple Silicon acceleration for native inference.
  // It's always optional: missing hardware, fetch failure, and explicit
  // opt-out all collapse to the standard candle path. Never fails init.
  //
  // Decision tree (full profile, eligible hardware, cascade not already
  // present):
  //
  //   --skip-coreml-cascade      → skip everything, record 'skipped'
  //   --build-coreml-cascade     → run trace_cascade.py locally via
  //                                scripts/build-coreml-cascade.js
  //                                (requires Python + coremltools)
  //   default (no flags)         → fetch tarballs from the HF repo in
  //                                coreml-cascade.json and extract into
  //                                the managed cache — same delivery
  //                                mechanism as the other models
  //
  // Both paths end up at the same on-disk state and are interchangeable
  // from the addon's point of view.
  const capability = detectHardwareCapability();
  let cascadeReport = { status: 'skipped', detail: 'Cascade inspection skipped' };
  // Phase 4: liModel === 'none' opts out of the cascade entirely (no LI rerank,
  // no read-semantic, no ColGrep — the only consumer of the LI cascade family).
  // The embed cascade is still useful for fast NomicBERT inference, but
  // without an LI consumer the "auto" family resolution would still pick
  // standard or edge LI tarballs we'll never use. Skipping outright is
  // cleaner and saves ~600 MB.
  const skipCascadeForLiNone = liChoices.liModel === LI_MODEL_NONE;
  if (skipCascadeForLiNone && !parsed.skipCoremlCascade && profile !== 'core' && parsed.verbose) {
    process.stderr.write('[init]   liModel=none → skipping CoreML cascade fetch\n');
  }
  if (!parsed.skipCoremlCascade && !skipCascadeForLiNone && profile !== 'core') {
    cascadeReport = getCoremlCascadeReport();

    if (cascadeReport.applicable && cascadeReport.status !== 'present') {
      if (parsed.buildCoremlCascade) {
        // Explicit local-build path — traces the cascade via the
        // Python subprocess. Primarily for developers on machines
        // without internet, or for retracing after a shape-set
        // change in coreml-cascade.json.
        process.stderr.write('[init] Building CoreML cascade via scripts/build-coreml-cascade.js...\n');
        const built = runCoremlCascadeBuild({ verbose: parsed.verbose });
        if (built.ok) {
          cascadeReport = getCoremlCascadeReport();
        } else {
          process.stderr.write(`[init] CoreML cascade build failed: ${built.error}\n`);
          process.stderr.write(`[init] Init continues without the cascade — candle path is unaffected.\n`);
        }
      } else {
        // Default path — fetch from HuggingFace, same pattern as
        // the other models. fetchCoremlCascade handles atomic
        // download + checksum verification + tarball extraction
        // and never throws. Failures are reported but don't
        // abort init.
        process.stderr.write('[init] Fetching CoreML variant cascade from HuggingFace...\n');
        try {
          const fetchResult = await fetchCoremlCascade({
            force: parsed.force,
            allowDownload: true, // init-time bypass — see downloadModelsForProfile comment
            // Phase 4: pass the user's persisted choice as the cascade variant
            // selector. Without this the cascade would default to whatever
            // SWEET_SEARCH_LATE_INTERACTION_MODEL says, which may diverge
            // from what the user just chose interactively or via --li-model.
            liVariantKey: liChoices.liModel,
          });
          if (fetchResult.status === 'fetched' || fetchResult.status === 'cached' || fetchResult.status === 'partial') {
            const total = fetchResult.fetched + fetchResult.cached;
            const parts = [];
            if (fetchResult.fetched > 0) parts.push(`${fetchResult.fetched} downloaded`);
            if (fetchResult.cached > 0) parts.push(`${fetchResult.cached} already cached`);
            if (fetchResult.skipped > 0) parts.push(`${fetchResult.skipped} not yet published`);
            if (fetchResult.failures.length > 0) parts.push(`${fetchResult.failures.length} failed`);
            process.stderr.write(`[init] CoreML cascade: ${total}/12 variants installed (${parts.join(', ')})\n`);
            for (const f of fetchResult.failures) {
              process.stderr.write(`[init]   ${f.variant}: ${f.error}\n`);
            }
          } else if (fetchResult.status === 'not-published') {
            process.stderr.write(`[init] CoreML cascade: not yet published on HuggingFace — tarballs will be fetched once checksums are backfilled in coreml-cascade.json\n`);
          } else if (fetchResult.status === 'skipped') {
            if (parsed.verbose) {
              process.stderr.write(`[init] CoreML cascade fetch skipped: ${fetchResult.reason}\n`);
            }
          } else if (fetchResult.status === 'not-configured') {
            process.stderr.write(`[init] CoreML cascade: ${fetchResult.reason} — skipping\n`);
          }
          // Re-inspect the cache now that the fetch is done.
          cascadeReport = getCoremlCascadeReport();
        } catch (err) {
          process.stderr.write(`[init] CoreML cascade fetch errored: ${err.message}\n`);
          process.stderr.write(`[init] Init continues without the cascade — candle path is unaffected.\n`);
        }
      }
    } else if (parsed.buildCoremlCascade && !cascadeReport.applicable) {
      process.stderr.write(`[init] --build-coreml-cascade ignored: ${cascadeReport.detail}\n`);
    }

    if (parsed.verbose) {
      process.stderr.write(`[init] CoreML cascade: ${cascadeReport.status} — ${cascadeReport.detail}\n`);
    }
  }

  // 8.5. Inspect dedup readiness (SimHash + MinHash-LSH NAPI surface).
  //      Never blocks init — failure collapses to "dedup disabled, every chunk
  //      is its own exemplar". --verify-deep adds a smoke test asserting
  //      fingerprint determinism across runs.
  const dedupReport = inspectDedupReadiness({
    deep: parsed.verifyDeep,
    skipped: parsed.skipDedup,
  });
  if (parsed.verbose || dedupReport.status === 'unavailable') {
    process.stderr.write(`[init] Dedup: ${dedupReport.status} — ${dedupReport.detail}\n`);
    if (dedupReport.smokeTest && !dedupReport.smokeTest.passed) {
      process.stderr.write(
        `[init]   smoke test FAILED: deterministic=${dedupReport.smokeTest.deterministic}, foundDup=${dedupReport.smokeTest.foundDup}\n`,
      );
    }
  }

  // 9. Write init config (before verification so it's available for diagnostics)
  const runtimeDownloads = profile === 'core' ? 'enabled' : 'disabled';
  const allowRuntimeModelDownload = profile === 'core';

  const preVerifyConfig = buildConfig({
    profile, maxsimTier, routerType, nativeStatus,
    modelResults, allowRuntimeModelDownload,
    verification: { type: 'pending', timestamp: new Date().toISOString(), checks: [] },
    failed: false,
    capability,
    cascadeReport,
    dedupReport,
    liChoices,
  });
  writeInitConfig(dataDir, preVerifyConfig);

  // 10. Run verification
  process.stderr.write(`[init] Running ${parsed.verifyDeep ? 'deep' : 'fast'} verification...\n`);
  const verification = await verifyRuntime({
    profile,
    modelKeys,
    deep: parsed.verifyDeep,
    packageRoot: PACKAGE_ROOT,
  });

  // Update config with verification result
  const finalConfig = buildConfig({
    profile, maxsimTier, routerType, nativeStatus,
    modelResults, allowRuntimeModelDownload,
    verification,
    failed: false,
    capability,
    cascadeReport,
    dedupReport,
    liChoices,
  });
  writeInitConfig(dataDir, finalConfig);

  if (!verification.passed) {
    process.stderr.write(`[init] ERROR: Verification failed:\n`);
    for (const check of verification.checks) {
      if (check.status === 'fail') {
        process.stderr.write(`  FAIL ${check.name}: ${check.message}\n`);
      }
    }
    process.exit(1);
  }

  // 10. Install index-maintainer daemon hook (Claude-only — gated on
  //     --no-claude per the universal "don't touch .claude/" contract).
  let skillReport = null;
  let prewarmHookReport = null;
  if (parsed.noClaude) {
    if (parsed.verbose) {
      process.stderr.write(`[init] Skipping all .claude/ writes (--no-claude): index-maintainer hook, /sweet-index skill, prewarm SessionStart entry\n`);
    }
  } else {
    try {
      const hookDir = join(projectRoot, '.claude', 'hooks');
      const hookDest = join(hookDir, 'index-maintainer.mjs');
      const hookSrc = join(PACKAGE_ROOT, 'core', 'indexing', 'index-maintainer.mjs');
      if (!existsSync(hookDest)) {
        mkdirSync(hookDir, { recursive: true });
        copyFileSync(hookSrc, hookDest);
        process.stderr.write(`[init] Installed index-maintainer daemon to ${hookDir}\n`);
      } else {
        process.stderr.write(`[init] Index-maintainer daemon already installed\n`);
      }
    } catch (e) {
      process.stderr.write(`[init] Warning: Could not install index-maintainer: ${e.message}\n`);
    }

    // 11. Install /sweet-index skill — Claude-only artifact, gated on --no-claude.
    skillReport = installSweetIndexSkill({
      projectRoot,
      packageRoot: PACKAGE_ROOT,
    });
    if (skillReport.status === 'installed') {
      process.stderr.write(`[init] Installed /sweet-index skill to ${skillReport.detail}\n`);
    } else if (skillReport.status === 'already-installed') {
      process.stderr.write(`[init] /sweet-index skill already installed\n`);
    } else if (skillReport.status === 'error') {
      process.stderr.write(`[init] Warning: Could not install /sweet-index skill: ${skillReport.detail}\n`);
    }

    // 11.5. Register Claude Code SessionStart daemon-prewarm hook.
    //       Spawns the search daemon detached in the background so the user's
    //       first `sweet-search <query>` hits a warm daemon (~80ms) instead of
    //       paying ~2.5s cold-start. The hook exits immediately; the daemon
    //       loads models + indexes while the user reads Claude's first reply.
    //       Never blocks init — any write failure collapses to a silent no-op
    //       on next session start.
    prewarmHookReport = registerPrewarmSessionStartHook({
      projectRoot,
      packageRoot: PACKAGE_ROOT,
      skipped: parsed.skipPrewarmHook,
    });
    if (parsed.verbose || prewarmHookReport.status === 'error') {
      process.stderr.write(`[init] Prewarm hook: ${prewarmHookReport.status} — ${prewarmHookReport.detail}\n`);
    }
  }

  // 11.6. Codex CLI session-start hook (opt-in via --codex). Mirrors the
  //       Claude prewarm hook but writes Codex's hook surface (.codex/hooks.json)
  //       and reuses the same launcher. Independent of --no-claude (it touches
  //       .codex/, never .claude/). Two things init can't fully guarantee — the
  //       `codex_hooks` feature flag (we set it project-locally; user-global only
  //       with --codex-enable-global-hooks) and project trust — are surfaced as
  //       post-init instructions rather than assumed.
  let codexHookReport = null;
  if (parsed.codex) {
    codexHookReport = registerCodexSessionStartHook({
      projectRoot,
      packageRoot: PACKAGE_ROOT,
      skipped: parsed.skipPrewarmHook,
    });
    const projectFlag = ensureCodexHooksFeatureFlag(
      join(projectRoot, '.codex', 'config.toml'),
      { create: true },
    );
    let globalFlag = null;
    if (parsed.codexEnableGlobalHooks) {
      globalFlag = ensureCodexHooksFeatureFlag(
        join(homedir(), '.codex', 'config.toml'),
        { create: true },
      );
    }

    process.stderr.write(`[init] Codex hook: ${codexHookReport.status} — ${codexHookReport.detail}\n`);
    process.stderr.write(`[init] Codex [features] hooks flag (project .codex/config.toml): ${projectFlag.status}\n`);
    if (globalFlag) {
      process.stderr.write(`[init] Codex [features] hooks flag (~/.codex/config.toml): ${globalFlag.status}\n`);
    }
    if (codexHookReport.status === 'registered') {
      process.stderr.write(
        `[init] Codex setup needs two things init can't do for you:\n` +
        `         1. Enable hooks: set [features] hooks = true in config.toml ` +
        `(or run \`codex --enable hooks\`).\n` +
        (parsed.codexEnableGlobalHooks
          ? `            Set in ~/.codex/config.toml (status: ${globalFlag?.status}).\n`
          : `            Set in ./.codex/config.toml (status: ${projectFlag.status}). If your Codex only\n` +
            `            honors the user-level flag, re-run with --codex-enable-global-hooks.\n`) +
        `         2. Review/trust repo-local hooks with \`/hooks\` in Codex so the\n` +
        `            project .codex/hooks.json is allowed to run.\n`,
      );
    }
  }

  // 12-15. Inject the sweet-search policy across coding-agent harnesses.
  //        Default: only CLAUDE.md (sweet-search is Claude-first; the
  //        existing project CLAUDE.md is where users look). Opt INTO
  //        additional harnesses with --agents (AGENTS.md) / --gemini /
  //        --cursor. --no-claude opts OUT of CLAUDE.md AND every other
  //        .claude/* write (universal gate enforced above).
  //        Plan §4A + §4B + §10 (the canonical flip from AGENTS.md →
  //        CLAUDE.md is a user-driven product call — plan doc updated
  //        in §3.3 / §10).
  //        Idempotent marker block so re-init never duplicates content.
  //        `--no-agent-instructions` is the umbrella that skips the
  //        instruction-file injection layer entirely.
  let agentInstructionsReport = null;
  let claudeRulesReport = null;
  if (!parsed.skipAgentInstructions) {
    const activeHarnesses = resolveActiveHarnesses({
      optInHarnesses: parsed.optInHarnesses,
      noClaude: parsed.noClaude,
    });
    if (activeHarnesses.length === 0) {
      process.stderr.write(
        `[init] Agent instructions: nothing to write — pass --agents / --gemini / --cursor `
        + `to opt into additional harness files (claude-code is disabled by --no-claude).\n`,
      );
    } else {
      try {
        agentInstructionsReport = injectAgentInstructions({
          projectRoot,
          harnesses: activeHarnesses,
          useSymlinks: parsed.symlinkInstructionFiles,
        });
        const summary = Object.entries(agentInstructionsReport.harnesses)
          .map(([k, v]) => `${k}=${v}`).join(' ');
        const canonical = agentInstructionsReport.canonical
          ? ` (canonical=${agentInstructionsReport.canonical})` : '';
        process.stderr.write(`[init] Agent instructions: ${summary || '(none)'}${canonical}\n`);
      } catch (err) {
        process.stderr.write(`[init] Warning: Agent-instruction injection failed: ${err.message}\n`);
      }
      // Claude rules file is only useful when claude-code is enabled — the
      // sole load path is the @.claude/rules/sweet-search.md import line that
      // injectAgentInstructions writes into CLAUDE.md.
      if (activeHarnesses.includes('claude-code')) {
        try {
          const status = writeClaudeRules({ projectRoot });
          claudeRulesReport = { status };
          process.stderr.write(`[init] Claude rules: ${status}\n`);
        } catch (err) {
          process.stderr.write(`[init] Warning: Could not write Claude rules: ${err.message}\n`);
        }
      }
    }
  } else if (parsed.verbose) {
    process.stderr.write(`[init] Agent instructions: skipped (--no-agent-instructions)\n`);
  }

  // 16. UserPromptSubmit reminder hook (P2 — plan §4C / §10 step 16).
  //     Universal `--no-claude` gate already enforced at step 10. Default-on;
  //     `--no-prompt-reminders` opts out. The hook lives at
  //     `.claude/hooks/sweet-search-remind-tools.mjs` with a
  //     `hooks.UserPromptSubmit` entry in `.claude/settings.json` keyed by
  //     filename so re-init updates rather than duplicates.
  let promptReminderReport = null;
  if (!parsed.noClaude) {
    promptReminderReport = installPromptReminderHook({
      projectRoot,
      packageRoot: PACKAGE_ROOT,
      skipped: parsed.skipPromptReminders,
    });
    if (parsed.verbose || promptReminderReport.status === 'error') {
      process.stderr.write(`[init] Prompt reminder hook: ${promptReminderReport.status} — ${promptReminderReport.detail}\n`);
    }
  }

  // 17. Tool enforcement (P3 — plan §4D / §10 step 17). Opt-in via
  //     `--enforce-tools`; universal `--no-claude` gate above. Adds
  //     `permissions.deny: ["Grep"]` and a PreToolUse hint hook for `Read`
  //     in `.claude/settings.json`. Strict + opinionated; off by default.
  let toolEnforcementReport = null;
  if (!parsed.noClaude) {
    toolEnforcementReport = installToolEnforcement({
      projectRoot,
      packageRoot: PACKAGE_ROOT,
      skipped: !parsed.enforceTools,
    });
    if (parsed.verbose || toolEnforcementReport.status === 'error') {
      process.stderr.write(`[init] Tool enforcement: ${toolEnforcementReport.status} — ${toolEnforcementReport.detail}\n`);
    }
  }

  // 18. Print report
  printReport({
    profile,
    maxsimTier,
    routerType,
    models: modelResults,
    verification,
    runtimeDownloads,
    capability,
    cascadeReport,
    dedupReport,
    prewarmHookReport,
    skillReport,
    liChoices,
    agentInstructionsReport,
    claudeRulesReport,
    promptReminderReport,
    toolEnforcementReport,
  });
}

/**
 * Run `node scripts/build-coreml-cascade.js` as a child process and
 * return a pass/fail object. Output is inherited so the user sees
 * the Python progress lines in real time. Errors are caught and
 * reported — init never aborts on cascade build failure.
 */
function runCoremlCascadeBuild(options = {}) {
  const scriptPath = join(PACKAGE_ROOT, 'scripts', 'build-coreml-cascade.js');
  if (!existsSync(scriptPath)) {
    // The build script is repo-only right now (not shipped via npm)
    // because it wraps scripts/spike-coreml/trace_cascade.py which in
    // turn needs Python + coremltools + the PyTorch port code. Until
    // pre-traced mlpackages are hosted on HuggingFace, the cascade can
    // only be built from a clone. Surface this clearly instead of a
    // bare "not found" message.
    return {
      ok: false,
      error: `scripts/build-coreml-cascade.js not found (${scriptPath}).\n` +
        `  The CoreML cascade build path currently requires a local clone\n` +
        `  of the sweet-search repository — it is not yet shipped via npm.\n` +
        `  To build the cascade:\n` +
        `    git clone https://github.com/panonitorg/sweet-search\n` +
        `    cd sweet-search\n` +
        `    node scripts/build-coreml-cascade.js\n` +
        `  Then point your install at the managed cache (init detects it).`,
    };
  }
  const args = [scriptPath];
  if (options.verbose) args.push('--verbose');

  try {
    const result = spawnSync(process.execPath, args, {
      stdio: 'inherit',
      cwd: PACKAGE_ROOT,
    });
    if (result.status === 0) return { ok: true };
    return { ok: false, error: `exit code ${result.status ?? 'unknown'}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

function buildConfig({
  profile, maxsimTier, routerType, nativeStatus, modelResults,
  allowRuntimeModelDownload, verification, failed,
  capability, cascadeReport, dedupReport, liChoices,
}) {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'));

  const models = {};
  for (const [key, info] of modelResults) {
    const entry = getModelEntry(key);
    models[key] = {
      status: info.status,
      cacheDir: entry ? getModelCacheDir(entry.hfId) : null,
    };
  }

  // Runtime section — records the hardware decision and cascade
  // state so `sweet-search uninstall` and future `sweet-search doctor`
  // can surface the same picture without redetecting.
  const runtime = {
    maxsimTier,
    routerType,
    allowRuntimeModelDownload: allowRuntimeModelDownload !== undefined ? allowRuntimeModelDownload : profile === 'core',
  };
  if (capability) {
    runtime.hardware = {
      platform: capability.platform,
      arch: capability.arch,
      brandString: capability.brandString,
      appleSilicon: capability.appleSilicon,
      nvidiaGpu: capability.nvidiaGpu ?? null,
      cudaAddonEnabled: capability.cudaAddonEnabled ?? false,
      cudaAvailable: capability.cudaAvailable ?? false,
      cudaReason: capability.cudaReason ?? null,
      candleGpuBackend: capability.candleGpuBackend,
      inferenceBackendPreference: capability.inferenceBackendPreference,
    };
  }
  if (cascadeReport) {
    runtime.coremlCascade = {
      status: cascadeReport.status,
      detail: cascadeReport.detail,
      applicable: cascadeReport.applicable ?? false,
      reason: cascadeReport.reason,
      embedDir: cascadeReport.embedDir ?? null,
      liDir: cascadeReport.liDir ?? null,
    };
  }
  if (dedupReport) {
    runtime.dedup = {
      status: dedupReport.status,
      detail: dedupReport.detail,
      smokeTest: dedupReport.smokeTest ?? null,
    };
  }
  if (liChoices) {
    // Phase 4: persisted LI policy. Read at runtime by SweetSearch via
    // `core/infrastructure/init-config.js::readPersistedLiPolicy`. The
    // `source` block is diagnostic only — it tells us which input wins
    // on the next re-run.
    runtime.li = {
      model: liChoices.liModel,
      searchReranking: liChoices.searchReranking,
      source: liChoices.source ?? null,
      recommendation: liChoices.recommendation ?? null,
    };
  }

  return {
    version: 1,
    profile,
    initTimestamp: new Date().toISOString(),
    sweetSearchVersion: pkg.version,
    platform: {
      os: process.platform,
      arch: process.arch,
      nativePackage: nativeStatus.platform?.packageName || null,
    },
    runtime,
    models,
    verification: {
      type: verification.type,
      passedAt: verification.passed ? verification.timestamp : null,
      result: failed ? 'failed' : (verification.passed ? 'pass' : 'fail'),
    },
  };
}

// ---------------------------------------------------------------------------
// Direct invocation support: `node scripts/init.js [args]`
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/^\.\//, ''));
if (isDirectRun) {
  runInit(process.argv.slice(2)).catch(err => {
    process.stderr.write(`[init] ${err.message}\n`);
    process.exit(1);
  });
}
