#!/usr/bin/env node
// Reference exposure texts for ONE product checkout, built WITHOUT the bench's per-arm adapter
// (loadProduct in scripts/retrieval-bench-282.mjs). exposure-check.sh diffs these against the
// bench's --print-exposure output, so a wrong arm→checkout mapping, a module loaded from the wrong
// root, or a text the adapter builds differently from the commit's own bench all show up as a diff.
//
//   node exposure-ref.mjs <product-root> <cell> <out-dir>
//
// What it calls, per harness, is what THAT commit's own retrieval bench called (d013b492 resolves the
// Claude Code rules layout from SS_CLAUDE_RULES_LAYOUT; later commits always use the pointer layout).
// The rules text is read from the commit's git object, not the working tree, so a dirty worktree
// cannot pass for the shipped text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

process.env.SS_ISOLATION = '0';
const [root0, cell, out0] = process.argv.slice(2);
if (!root0 || !cell || !out0) { console.error('usage: exposure-ref.mjs <product-root> <cell> <out-dir>'); process.exit(2); }
const root = path.resolve(root0), out = path.resolve(out0);
const CELLS = {
  'cc-opus55-medium': { harness: 'cc' },
  'codex-sol61-high': { harness: 'codex', model: 'gpt-6.1-sol' },
  'oc-sol61-high': { harness: 'opencode', model: 'openai/gpt-6.1-sol' },
};
const C = CELLS[cell];
if (!C) { console.error(`cell must be one of ${Object.keys(CELLS).join(', ')}`); process.exit(2); }
const im = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
const commit = git('rev-parse', 'HEAD').trim();
const RULES_REL = 'core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md';
const rules = git('show', `${commit}:${RULES_REL}`).replace(/^---\n[\s\S]*?\n---\n/, '');
const HR = 'eval/task-completion-bench/harness';
const texts = {};
// Same scratch path as the bench's exposure (the Claude Code agent file embeds a memory path built from it).
const work = path.join(os.tmpdir(), 'r282-exposure', cell, 'work');
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
try {
  if (C.harness === 'cc') {
    const wr = await im('scripts/write-claude-rules.js');
    const lean = await im('scripts/install-claude-lean-harness.js');
    const proj = path.join(work, 'repo'), home = path.join(work, 'home');
    fs.mkdirSync(proj); fs.mkdirSync(home);
    const layout = wr.resolveClaudeRulesLayout ? wr.resolveClaudeRulesLayout(process.env, { strict: true }).layout : 'pointer';
    const r = lean.installClaudeLeanHarness({ projectRoot: proj, configDir: home, visibleConfigDir: home });
    if (r.active !== true) throw new Error(`lean harness not active: ${r.status} ${r.detail}`);
    if (layout !== 'none') wr.writeClaudeRules({ projectRoot: proj, layout: layout === 'pointer' ? 'pointer' : 'full' });
    const norm = (t) => t.split(fs.realpathSync(proj)).join('<PROJECT>').split(proj).join('<PROJECT>').split(fs.realpathSync(home)).join('<HOME>').split(home).join('<HOME>');
    for (const f of ['.claude/rules/sweet-search.md', '.claude/agents/sweet-search.md', '.claude/agents/general-purpose.md', '.claude/agents/Plan.md', '.claude/sweet-search-harness.json', '.claude/settings.json']) {
      const fp = path.join(proj, f); if (fs.existsSync(fp)) texts[f.replace(/\//g, '__')] = norm(fs.readFileSync(fp, 'utf8'));
    }
  } else if (C.harness === 'codex') {
    const cx = await im(`${HR}/codex-task-runner.mjs`);
    const trim = cx.codexHarnessTrim({ sweet: true, model: `openai/${C.model}` });
    cx.codexHarnessTrimArgs(trim, work, { model: `openai/${C.model}` });
    texts['model_instructions_file.md'] = fs.readFileSync(path.join(work, cx.CODEX_HARNESS_TRIM_STATE_FILE), 'utf8');
    // developer_instructions = the rules text, passed through codexRulesConfigArgs unchanged.
    const args = cx.codexRulesConfigArgs(rules).join(' ');
    if (!args.includes('developer_instructions')) throw new Error('codexRulesConfigArgs carries no developer_instructions');
    texts['developer_instructions.md'] = rules;
  } else {
    const oc = await im(`${HR}/opencode-task-runner.mjs`);
    const shared = await im(`${HR}/agent-runner-shared.mjs`);
    const trim = oc.opencodeArmHarnessTrim({ sweet: true, apiModel: C.model, stateDir: work });
    texts['agent.build.prompt.txt'] = trim.config?.agentBuild?.prompt ?? '';
    texts['agent.general.prompt.txt'] = trim.config?.agents?.general?.prompt ?? '';
    texts['tool-edits.json'] = `${JSON.stringify(trim.config?.plugin?.[0]?.[1]?.edits ?? null, null, 1)}\n`;
    texts['instructions.md'] = shared.sweetRulesBlock({ mppText: rules });
  }
} finally { fs.rmSync(work, { recursive: true, force: true }); }
const gutter = (await im('core/search/gutter-form.js')).HARNESS_DEFAULT_FORM[{ cc: 'claude-code', codex: 'codex', opencode: 'opencode' }[C.harness]];
fs.mkdirSync(out, { recursive: true });
for (const [n, t] of Object.entries(texts)) fs.writeFileSync(path.join(out, n), t);
fs.writeFileSync(path.join(out, '_ref.json'), `${JSON.stringify({ root, commit, gutter }, null, 1)}\n`);
console.log(`ref ${cell} ${root} @ ${commit.slice(0, 8)} gutter ${gutter}`);
for (const [n, t] of Object.entries(texts)) console.log(`  ${n.padEnd(44)} ${String(t.length).padStart(6)} chars  sha256 ${crypto.createHash('sha256').update(t).digest('hex').slice(0, 16)}`);
