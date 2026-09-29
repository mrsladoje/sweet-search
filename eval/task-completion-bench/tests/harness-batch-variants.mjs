// Tests for trim/batch-variants.mjs (SWEET ARM ONLY research lines, default OFF).
// 1. Every variant that existed before 2026-09-27 is byte-identical (sha256 pins taken from
//    commit ca1df79), so earlier hill-climb cells stay reproducible.
// 2. The Claude Code 'eff' line inserts after the base prompt's "act" line and fails loudly
//    when that anchor is missing (the product module is being rebuilt elsewhere).
// 3. The new general lines carry no benchmark-specific words.
//
// Standalone: `node tests/harness-batch-variants.mjs` — exit 1 on fail.
import { createHash } from 'node:crypto';
import {
  CODEX_BATCH_VARIANTS, CC_BATCH_VARIANTS, EFFICIENCY_LINE, applyClaudeBatch, applyCodexBatch,
  opencodeBatchPrompt, opencodeBatchToolEdits, OPENCODE_VARIANT_NAMES,
} from '../harness/trim/batch-variants.mjs';

let ok = true;
const assert = (c, name, extra = '') => { console.log((c ? '  ✓ ' : '  ✗ ') + name + (c ? '' : '  ' + extra)); if (!c) ok = false; };
const throws = fn => { try { fn(); return false; } catch { return true; } };
const h = x => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));

console.log('pre-existing variants are byte-identical (pins from ca1df79):');
const CX = ['unchain', 'dep', 'two', 'plan', 'pall', 'yield', 'pallyield', 'yieldedit', 'yieldeditpall', 'pallyt', 'pallyt1', 'pallyt1open', 'pallfind', 'pallytfind'];
const CC = ['two', 'plan', 'amp', 'ssread', 'ampssread', 'ampsafe', 'ampsaferange', 'saferange', 'saferangefinal'];
const OC = ['unchain', 'dep', 'two', 'plan', 'todo', 'tododesc', 'todoall', 'combo', 'todoallfit', 'todoall2', 'todoall2diff', 'todoall2find', 'comboall'];
assert(h(pick(CODEX_BATCH_VARIANTS, CX)) === '1099ee2edf0f0d2c', 'Codex variants');
assert(h(pick(CC_BATCH_VARIANTS, CC)) === '4d797f36dd7502ba', 'Claude Code variants');
assert(h(OC.map(v => opencodeBatchPrompt(v))) === '9555d90ecb17ee82', 'opencode variant prompts');
assert(h(OC.map(v => opencodeBatchToolEdits(v))) === '3a98a3d0bc479340', 'opencode variant tool edits');
assert(JSON.stringify(Object.keys(CODEX_BATCH_VARIANTS)) === JSON.stringify([...CX, 'yt2', 'poll', 'yt2eff', 'yt3', 'yt3batch', 'rbatch', 'rbatch2', 'yt3batch2'])
    && JSON.stringify(Object.keys(CC_BATCH_VARIANTS)) === JSON.stringify([...CC, 'eff', 'noedit', 'read3', 'read4', 'read4out', 'read5', 'read5pack', 'read6', 'read6fs'])
    && JSON.stringify(OPENCODE_VARIANT_NAMES) === JSON.stringify([...OC, 'todo2', 'todo3eff', 'todo3eff2', 'todo3eff2k', 'todo3eff3k', 'todo2eff']),
  'only new keys were added: Codex yt2, poll, yt2eff; Claude Code eff; opencode todo2, todo2eff, todo3eff, todo3eff2');

console.log('\nClaude Code eff (inserted after the "act" line):');
const ACT = '- When you have enough information to act, act.';
const BATCH = '- Combine dependent shell steps into one Bash call where you can, for example an edit made with a short script together with the command that checks it.';
const agent = `---\nname: sweet-search\n---\nYou are a coding agent.\n\n- Write code that matches.\n${ACT}\n${BATCH}\n`;
assert(applyClaudeBatch(agent, 'eff') === agent.replace(`${ACT}\n`, `${ACT}\n${EFFICIENCY_LINE}\n`), 'eff: the line goes right after the act line; nothing replaced');
assert(applyClaudeBatch(`x\n${ACT}`, 'eff') === `x\n${ACT}\n${EFFICIENCY_LINE}`, 'eff: act line at end of file');
assert(throws(() => applyClaudeBatch('---\nname: sweet-search\n---\nYou are a coding agent.\n', 'eff')), 'eff: a file without the anchor throws');
assert(throws(() => applyClaudeBatch(`${ACT}\n${ACT}\n`, 'eff')), 'eff: an anchor found twice throws');
assert(applyClaudeBatch(agent, 'two') === agent.replace(BATCH, CC_BATCH_VARIANTS.two), 'existing variants still replace the max-batch line');
let product = null;
try { product = (await import('../../../scripts/install-claude-lean-harness.js')).CLAUDE_LEAN_BASE_PROMPT_BATCH; } catch { /* module rebuilt elsewhere */ }
if (typeof product === 'string' && product.includes(ACT.slice(2))) {
  const out = applyClaudeBatch(product, 'eff');
  assert(out.includes(`${ACT}\n${EFFICIENCY_LINE}`) && out.replace(`\n${EFFICIENCY_LINE}`, '') === product, 'eff on the current product prompt: one line added, nothing else changed');
} else console.log('  - product prompt has no "act" line today: CC_TRIM_BATCH=eff will throw at install (by design)');

console.log('\ngeneral wording (no benchmark words):');
for (const [name, text] of [['efficiency line', EFFICIENCY_LINE], ['Codex yt2', CODEX_BATCH_VARIANTS.yt2],
  ['opencode todo2', opencodeBatchPrompt('todo2')]]) {
  assert(!/bench|run_tests|failing test|acceptance|frame/i.test(text), `${name}: no benchmark-specific words`);
}
assert(!/test/i.test(EFFICIENCY_LINE), 'efficiency line assumes no tests exist');
assert(applyCodexBatch(`a\n${CODEX_BATCH_VARIANTS.unchain}\n- Do not chain shell commands with separators like \`echo "====";\` or \`printf '---'\`; the output becomes noisy in a way that makes the user's side of the conversation worse.\nb`, 'yt2eff').endsWith(`${EFFICIENCY_LINE}\nb`),
  'Codex yt2eff: the efficiency line follows the template');

console.log(ok ? '\nALL PASS' : '\nFAILED');
process.exit(ok ? 0 : 1);
