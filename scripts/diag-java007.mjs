#!/usr/bin/env node
// One-off: re-run java-007 native in the minimal harness, capture the tool-call commands +
// raw stream, to find which Bash/Read call ate ~170s (out_tokens were tiny, so it wasn't thinking).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeAgent } from '../eval/agent-read-workflows/claude-runner.js';
import { resolveRepoCwd, buildAgentUserPrompt } from '../core/prompt-optimization/sweep/gepa-evaluate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vault = JSON.parse(fs.readFileSync(path.join(REPO, 'core/prompt-optimization/data/frozen/p7-vault-probes-v60.json'), 'utf8'));
const probes = Array.isArray(vault) ? vault : vault.probes;
const probe = probes.find((p) => p.id === 'java-007');
const cwd = resolveRepoCwd(probe, {});
const NATIVE_POLICY = `You are solving a code-understanding task in a repository you are already inside.
Use your normal code-reading workflow (ripgrep/grep, find, and reading files). Do NOT use sweet-search or any ss-* command, and do not read anything under .sweet-search/.
Keep searches focused; stop as soon as your evidence covers the answer.
Final answer: cite the relevant file paths, symbols, and facts. If absent, say no match found.`;
const LEAN_MIN = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'project', '--tools', 'Bash', 'Read', '--exclude-dynamic-system-prompt-sections'];

delete process.env.ANTHROPIC_API_KEY;
process.env.MAX_THINKING_TOKENS = '31999';
console.log('probe java-007:', JSON.stringify(probe.query).slice(0, 120));
console.log('cwd:', path.relative(REPO, cwd));
const t0 = Date.now();
const run = await runClaudeAgent({ model: 'claude-opus-4-8', prompt: buildAgentUserPrompt(probe), systemAppend: '', cwd, projectRoot: cwd, extraPathEntries: [], addDirs: [cwd], extraArgs: [...LEAN_MIN, '--system-prompt', NATIVE_POLICY], timeoutMs: 300000, logPath: '/tmp/java007.jsonl' });
console.log(`\nwall=${((Date.now() - t0) / 1000).toFixed(0)}s calls=${run.toolCalls.length} exit=${run.exitCode} timedOut=${run.timedOut} out_tokens=${run.usage?.output_tokens}`);
console.log('--- tool calls (in order) ---');
for (const c of run.toolCalls) console.log(`  [${c.name}] ${JSON.stringify(c.input).slice(0, 240)}`);
console.log('\n(raw stream saved to /tmp/java007.jsonl)');
