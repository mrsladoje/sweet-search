/**
 * Held-out model panel (HOMP) runner — campaign-end gate.
 *
 * Plan reference: §0.5 (control #7), §11.11 (algorithm + transfer-gap gate).
 *
 * Why this exists: `robustness_score = min()` over the four cheap-pool models
 * is *not* "generalisation across user deployments" — it generalises across
 * those four specific models. To make the robustness claim defensible at
 * BEIR/CoIR researcher standards, we hold out 2 models that are NEVER used
 * during optimisation (not in cheap pool, not as reflector, not as judge),
 * and score the final uber-tree on Vault probes against those models exactly
 * once at campaign end.
 *
 * Hard rules:
 *   1. This module is the ONLY caller permitted to invoke any model in the
 *      `heldOutModels` list of `manifest.json`. Any other code path that
 *      hits those endpoints invalidates the campaign.
 *   2. Vault probes (`splits/freshstack_30.json` + `splits/vault_50.json`)
 *      are read here only after `scripts/check-vault-lock.mjs` confirms the
 *      `release/<run-id>` git tag exists.
 *   3. Promotion criterion: `transfer_gap = aux_panel_min_pass −
 *      homp_min_pass` ≤ 5pp on Vault. > 5pp invalidates the "robustness"
 *      claim per §11.11.2.
 *
 * This module ships as a thin orchestrator with a clear seam — the actual
 * model invocation is the caller's responsibility (different harnesses /
 * subscriptions / API keys), but the gate logic is centralised here.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { execSync } from 'child_process';

const DEFAULT_TRANSFER_GAP_BUDGET = 0.05; // 5pp per §11.11.2

/**
 * Verify the `release/<run-id>` tag exists in git before any Vault read.
 * Returns true on success; throws otherwise. The tag is the explicit
 * authorisation gesture that the campaign is at the publication step.
 */
export function assertReleaseTag(runId) {
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new TypeError('run-homp: runId required');
  }
  const tag = `release/${runId}`;
  try {
    execSync(`git rev-parse --verify ${JSON.stringify(tag)}`, {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    throw new Error(
      `run-homp: refusing to access Vault — git tag ${tag} does not exist. ` +
        `Vault is opened EXACTLY ONCE at campaign end (§0.5.3); create the ` +
        `tag with: git tag ${tag}`
    );
  }
}

/**
 * Load the held-out model panel from the manifest.
 *
 * @param {string} manifestPath
 * @returns {Array<{ name: string, lineage: string, endpoint: string,
 *   wireApi: string, role: string, addedAt: string }>}
 */
export function loadHompFromManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(`run-homp: manifest not found at ${manifestPath}`);
  }
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // Manifest schema: heldOutModels = { transferGapBudgetPct, panel: [...] }.
  // Accept both the wrapped object form and a bare array for forwards
  // compatibility — the payload is always the panel itself.
  const raw = m.heldOutModels;
  const panel = Array.isArray(raw) ? raw : raw && Array.isArray(raw.panel) ? raw.panel : null;
  if (!panel || panel.length < 2) {
    throw new Error(
      `run-homp: manifest.heldOutModels.panel must list at least 2 models (§11.11.1); ` +
        `found ${panel ? panel.length : 'undefined'}`
    );
  }
  return panel;
}

/**
 * Compute transfer-gap and gate decision.
 *
 * Inputs are pre-aggregated per-model PASS rates on Vault probes. Caller
 * runs the actual evaluations (model dispatch, retry, timeouts) — this
 * module is the deterministic gate decision once those numbers exist.
 *
 * @param {object} args
 * @param {Record<string, number>} args.auxPanelPassByModel
 *   PASS rate per cheap-pool model on Vault probes (re-evaluated for the
 *   transfer-gap calculation; this is the same `min()` panel as §8.5).
 * @param {Record<string, number>} args.hompPassByModel
 *   PASS rate per HOMP model on Vault probes (the campaign-end measurement).
 * @param {number} [args.transferGapBudget=DEFAULT_TRANSFER_GAP_BUDGET]
 * @returns {{
 *   auxPanelMinPass: number,
 *   hompMinPass: number,
 *   transferGap: number,
 *   passes: boolean,
 *   transferGapBudget: number,
 *   detail: { auxPanel: Record<string, number>, homp: Record<string, number> },
 * }}
 */
export function computeTransferGap({
  auxPanelPassByModel,
  hompPassByModel,
  transferGapBudget = DEFAULT_TRANSFER_GAP_BUDGET,
}) {
  if (!auxPanelPassByModel || typeof auxPanelPassByModel !== 'object') {
    throw new TypeError('run-homp: auxPanelPassByModel must be an object');
  }
  if (!hompPassByModel || typeof hompPassByModel !== 'object') {
    throw new TypeError('run-homp: hompPassByModel must be an object');
  }
  const auxValues = Object.values(auxPanelPassByModel);
  const hompValues = Object.values(hompPassByModel);
  if (auxValues.length === 0 || hompValues.length === 0) {
    throw new RangeError('run-homp: pass-rate maps must be non-empty');
  }
  if (!(transferGapBudget >= 0)) {
    throw new RangeError('run-homp: transferGapBudget must be non-negative');
  }
  const auxPanelMinPass = Math.min(...auxValues);
  const hompMinPass = Math.min(...hompValues);
  const transferGap = auxPanelMinPass - hompMinPass;
  return {
    auxPanelMinPass,
    hompMinPass,
    transferGap,
    passes: transferGap <= transferGapBudget,
    transferGapBudget,
    detail: { auxPanel: { ...auxPanelPassByModel }, homp: { ...hompPassByModel } },
  };
}

/**
 * Persist the HOMP gate result alongside the campaign run-id.
 *
 * Output schema is stable for downstream §11.7 reproducibility-artifacts
 * tooling and §11.8 pre-registration matching.
 */
export function writeHompReport({ runId, outDir, gate, manifestVersion }) {
  if (typeof outDir !== 'string') throw new TypeError('run-homp: outDir required');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const reportPath = `${outDir}/homp-report.json`;
  const payload = {
    schemaVersion: 1,
    runId,
    manifestVersion: manifestVersion || null,
    generatedAt: new Date().toISOString(),
    gate,
    references: ['§0.5.5', '§11.11'],
  };
  if (!existsSync(dirname(reportPath))) mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(payload, null, 2) + '\n');
  return reportPath;
}

/**
 * Convenience: full campaign-end gate routine.
 *
 * Caller pipeline:
 *   1. assertReleaseTag(runId)            — proves campaign is at end
 *   2. loadHompFromManifest(manifestPath) — reads pinned HOMP slots
 *   3. <caller runs the uber-tree against HOMP × Vault, collects PASS rates>
 *   4. computeTransferGap({ ... })        — deterministic gate
 *   5. writeHompReport({ ... })           — append-only artifact
 */
export const _internal = { DEFAULT_TRANSFER_GAP_BUDGET };
