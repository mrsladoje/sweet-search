/**
 * finalize-mpp.mjs — produce the shipped ship-file from the M++++ champion.
 *
 * Background: the PHASE7 GEPA run crowned M* (gen3-r1b). The user then ran a
 * 7-edit hand correctness pass over M* producing **M++ = `Mpp.md`** (see
 * memory `project_p7_mpp_correctness_pass`): "every file"/uncommitted wording,
 * sub-agent-verbatim, true ss-semantic/ss-trace descriptions, flooding-line
 * trim, and all 27 `[[ ]]` tokens stripped — routing byte-identical to M*.
 * M++ (NOT M*) is what every benchmark loaded (`cc-batch`, `oc-batch`,
 * `ba-batch`, `usd-capture-*`, all five cross-harness vault cells) and is the
 * frozen champion (committed 6604299 under prereg tag `p7-v1`; sealed
 * validation in 7412cd4).
 *
 * **M++++ = `Mpppp.md`** is the stop-discipline scoping pass over M++ (fix for
 * the over-stop-on-FIX-tasks finding, memory
 * `project_p7_mpp_stop_discipline_fix_tasks`): a new intro paragraph scoping
 * these rules to code-SEARCH only ("locating the right code is a means, not
 * the finish line"), and "stop"/"Output" wording narrowed to "stop
 * searching"/"Search output" so the stop discipline can no longer read as
 * task-level termination. The routing rules, tool table, sufficiency stops,
 * two-probe absence rule, and <state_summary> gate are unchanged from M++.
 *
 * `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` is the
 * ship-file `scripts/init.js` consumes (plan §3.7.1 step 13 / §10). This
 * script regenerates it from `Mpppp.md`'s EXACT bytes via the canonical
 * `renderShipFile`, so the body that ships to users is byte-identical to
 * M++++.
 *
 * The body is M++++ verbatim. The YAML front-matter carries **M++'s** ABSOLUTE
 * sealed-validation numbers — M++++ itself has NOT been re-run through the
 * sealed held-out/OOD/vault battery; the numbers are inherited because the
 * edits are scoping/wording only (routing untouched). Treat them as M++
 * provenance, not fresh M++++ measurements. (Not the GEPA native-relative
 * selection metrics — hand-edits are validated on absolute accuracy, so
 * eas_factor / length_penalty / final_score do not apply and are null.)
 *
 * Numbers sourced from the committed validation artifacts + the freeze/validate
 * commits (no fabrication):
 *   - held-out(30×2×3): sonnet 0.993 / gpt5_5 0.988, Maximin 0.988
 *       (results/heldout-mpp.json, recomputed: sonnet 0.9928 / gpt 0.9878)
 *   - OOD(40, 8 langs): Maximin sonnet 0.96 / gpt 0.952, PASS ≥0.55, all ≥0.79
 *       (results/ood-mpp.json)
 *   - family HOMP: MiMo-v2.5-pro 0.988 + Qwen3.6-plus 0.980, both PASS ≥0.69
 *   - reasoning HOMP: MiniMax-M3 max-reasoning 0.963, PASS ≥0.69
 *   - SCS(630): cwSCS sonnet 0.950 / gpt 0.931 (min 0.931), both PASS ≥0.8;
 *       minParaphraseAccuracy 1.00
 *   - blind vault(60×3): Codex/GPT-5.5 acc 0.963, Claude-Code/Opus 0.984
 *       (vault_maximin = lower production harness 0.963; within 15% of held-out)
 *
 * Re-run: `node core/prompt-optimization/sweep/finalize-mpp.mjs`
 * Idempotent — writes the same bytes every time.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { renderShipFile } from './gepa-finalize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const MPP_PATH = path.join(
  REPO_ROOT,
  'core/prompt-optimization/data/p7-variant-restarts/p7-gen3-candidates/Mpppp.md',
);
const SHIP_PATH = path.join(
  REPO_ROOT,
  'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md',
);

// Body = the M++++ champion, byte-for-byte.
const mppBody = readFileSync(MPP_PATH, 'utf8');

const winner = {
  // M++++ = M++ + stop-discipline scoping edits (routing unchanged). Body is
  // Mpppp.md verbatim.
  prompt: mppBody,
  // ABSOLUTE sealed-validation per-target accuracy of the PARENT M++
  // (held-out 30×3) — inherited, see header note. NOT the GEPA
  // native-relative selection score.
  score_sonnet: 0.993,
  score_gpt5_5: 0.988,
  taskScore: 0.988, // held-out Maximin
  // GEPA native-relative selection diagnostics — N/A for a hand-edited champion
  // validated on absolute metrics. Left null rather than copying M*'s values.
  efficiencyFactor: null,
  lengthPenalty: null,
  finalScore: null,
  tokenCount: undefined, // renderShipFile estimates from the body
};

const gates = {
  scs: { cwSCS: 0.931, minParaphraseAccuracy: 1.0 }, // min(sonnet 0.950, gpt 0.931); both PASS ≥0.8
  familyHomp: { pass: true }, // MiMo 0.988 + Qwen 0.980, both ≥0.69
  reasoningHomp: { pass: true }, // MiniMax-M3 max-reasoning 0.963 ≥0.69
  ood: { maximin_sonnet: 0.96, maximin_gpt: 0.952, pass: true }, // ≥0.55, all langs ≥0.79
};

const vault = { maximin: 0.963, withinExpected: true }; // Codex/GPT-5.5 blind-60 (CC/Opus 0.984)

const body = renderShipFile({ runId: 'p7-v1-mpppp', winner, gates, vault });
writeFileSync(SHIP_PATH, body);

// Verify the shipped body is byte-identical to Mpppp.md (front-matter aside).
const written = readFileSync(SHIP_PATH, 'utf8');
const shippedBody = written.slice(written.indexOf('\n---\n') + '\n---\n'.length);
if (shippedBody !== mppBody) {
  throw new Error('finalize-mpp: shipped body is NOT byte-identical to Mpppp.md');
}

console.log(`Wrote ${path.relative(REPO_ROOT, SHIP_PATH)} (${body.length} bytes); body === Mpppp.md ✓`);
