/**
 * CLI staleness footer.
 *
 * Plan § 19.1. Sweet-search shows a three-tier alert based on how long
 * since the manifest was published, how many files are sitting dirty,
 * and whether the maintenance queue is backed up:
 *
 *   green   < 60 s, 0 dirty               → hidden
 *   yellow  60-300 s, < 5 dirty            → one-liner footer
 *   red     > 300 s, > 5 dirty, or         → explicit warning
 *           maintenance-queue backlog
 *
 * The display is informational. The reconciler does not block any CLI
 * command on it; users decide whether to wait for the next tick or
 * proceed against the slightly stale index.
 */

const GREEN = 'green';
const YELLOW = 'yellow';
const RED = 'red';

const YELLOW_AGE_MS = 60_000;
const RED_AGE_MS = 300_000;
const YELLOW_DIRTY = 1;
const RED_DIRTY = 5;
const RED_BACKLOG = 4;

/**
 * Classify the staleness tier given the inputs.
 *
 * @param {object} input
 * @param {number} input.ageMs               How long since manifest publish.
 * @param {number} input.dirtyFiles          Current dirty-set size.
 * @param {number} input.maintenanceBacklog  Pending maintenance jobs.
 * @returns {'green'|'yellow'|'red'}
 */
export function stalenessTier(input) {
  const { ageMs = 0, dirtyFiles = 0, maintenanceBacklog = 0 } = input;
  if (ageMs > RED_AGE_MS || dirtyFiles > RED_DIRTY || maintenanceBacklog > RED_BACKLOG) {
    return RED;
  }
  if (ageMs > YELLOW_AGE_MS || dirtyFiles > YELLOW_DIRTY) {
    return YELLOW;
  }
  return GREEN;
}

function humaniseAge(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Build the footer string. Empty string when tier=green AND the caller
 * did not pass `forceShow`.
 *
 * @param {object} input
 * @param {number} input.epoch
 * @param {number} input.ageMs
 * @param {number} input.dirtyFiles
 * @param {string|null} input.lastMaintenanceTier
 * @param {number} input.lastMaintenanceAgeMs
 * @param {number} input.maintenanceBacklog
 * @param {boolean} [input.forceShow=false]
 * @returns {string}
 */
export function formatStalenessFooter(input) {
  const tier = stalenessTier(input);
  if (tier === GREEN && !input.forceShow) return '';
  const parts = [];
  parts.push(`index epoch: ${input.epoch}`);
  parts.push(`age: ${humaniseAge(input.ageMs)}`);
  parts.push(`dirty files: ${input.dirtyFiles}`);
  if (input.lastMaintenanceTier) {
    parts.push(`last maintenance: ${input.lastMaintenanceTier} ${humaniseAge(input.lastMaintenanceAgeMs)} ago`);
  }
  if (input.maintenanceBacklog > 0) {
    parts.push(`backlog: ${input.maintenanceBacklog}`);
  }
  const body = parts.join('   ');
  const prefix = tier === RED ? '[sweet-search] ⚠ stale index — ' : '[sweet-search] ';
  return prefix + body;
}

/**
 * Render two lines (separator + footer). Plan § 19.1 mock-up format.
 *
 * @param {object} input
 * @returns {string[]}
 */
export function renderStalenessLines(input) {
  const footer = formatStalenessFooter(input);
  if (!footer) return [];
  return ['─────────', footer];
}

export const __testing = {
  YELLOW_AGE_MS, RED_AGE_MS, YELLOW_DIRTY, RED_DIRTY, RED_BACKLOG,
  GREEN, YELLOW, RED,
};
