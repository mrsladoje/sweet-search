#!/usr/bin/env node
/**
 * Aider head-to-head runner.
 *
 * Wraps `aider --message <q>` and captures answer + token + timing for fair
 * comparison against eval/agent-eval/results/<repo>-{rg+read,pattern+meta,
 * pattern+agent,sweet-search+agent}.jsonl. Output schema is identical so the
 * existing judge (run-agent-eval.js --judge) can score aider blind alongside
 * the other systems.
 *
 * Aider's repo map is ITS retrieval mechanism — that's what we're comparing
 * against sweet-search's hybrid index. Use --map-tokens to match the agent
 * token budget for fairness (default 4096; pass --map-tokens=8192 to match
 * sweet-search-auto's full-budget tier).
 *
 * Setup once:
 *   pip3 install --user aider-chat                 (or uvx, pipx, etc.)
 *   export ANTHROPIC_API_KEY=sk-ant-...            (required — aider goes
 *                                                   through litellm direct;
 *                                                   does NOT use claude CLI)
 *   ~/Library/Python/3.9/bin/aider --version       (verify install)
 *
 * Usage:
 *   node eval/agent-eval/run-aider.mjs --repo=fastify --max-questions=5
 *   node eval/agent-eval/run-aider.mjs --repo=fastify --model=claude-sonnet-4-6
 *
 * Output: eval/agent-eval/results/<repo>-aider.jsonl (same schema as the
 * other system runners — answer, totalTokens, inputTokens, outputTokens,
 * elapsedMs, costUsd, questionId, system="aider").
 *
 * IMPORTANT: aider sees the parent git repo (sweet-search-private) when run
 * from eval/repos/<repo>/, because the bench repos aren't separate gits.
 * We pass `--no-git` and `--subtree-only` so aider treats <repo>/ as a
 * stand-alone tree. This matches how a real user would run aider against
 * the bench repo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function parseArgs() {
  const args = process.argv.slice(2);
  const o = {
    repo: null,
    maxQuestions: 0,
    model: 'claude-sonnet-4-6',
    mapTokens: 4096,
    timeout: 180000,
    aiderBin: process.env.AIDER_BIN
      || path.resolve(process.env.HOME, 'Library/Python/3.9/bin/aider'),
    out: null,
  };
  for (const a of args) {
    if (a.startsWith('--repo=')) o.repo = a.split('=')[1];
    else if (a.startsWith('--max-questions=')) o.maxQuestions = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--model=')) o.model = a.split('=')[1];
    else if (a.startsWith('--map-tokens=')) o.mapTokens = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--timeout=')) o.timeout = parseInt(a.split('=')[1], 10) * 1000;
    else if (a.startsWith('--aider-bin=')) o.aiderBin = a.split('=')[1];
    else if (a.startsWith('--out=')) o.out = a.split('=')[1];
  }
  if (!o.repo) {
    console.error('Required: --repo=<fastify|gin|flask|ripgrep>');
    process.exit(1);
  }
  return o;
}

function readQuestions(repo) {
  const p = path.join(ROOT, 'eval/agent-eval/questions', `${repo}.jsonl`);
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// Aider prints a token usage line like "Tokens: 12k sent, 1.2k received."
// And cost like "Cost: $0.041 message, $0.041 session."
const TOKEN_RE = /Tokens:\s*([\d.]+)\s*([kKm]?)\s*sent,\s*([\d.]+)\s*([kKm]?)\s*received/i;
const COST_RE  = /Cost:\s*\$([\d.]+)\s*message/i;

function unsuffix(num, suffix) {
  const n = parseFloat(num);
  if (!Number.isFinite(n)) return 0;
  if (!suffix) return Math.round(n);
  if (suffix.toLowerCase() === 'k') return Math.round(n * 1000);
  if (suffix.toLowerCase() === 'm') return Math.round(n * 1_000_000);
  return Math.round(n);
}

function parseAiderOutput(stdout) {
  // Strip ANSI + tqdm progress lines and anything before the model's actual
  // reply. Aider's plain-text output has the assistant's response between
  // "Repo-map:" / "Initial repo scan" lines and the closing "Tokens:" line.
  const lines = stdout.split('\n');
  let answerStart = -1, answerEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (answerStart < 0 && /^(?:>|=|-)/.test(lines[i].trim())) continue;
    if (answerStart < 0 && /Initial repo scan|Repo-map:|Scanning repo/.test(lines[i])) {
      answerStart = i + 1;
      continue;
    }
    if (answerStart >= 0 && /^Tokens:/.test(lines[i])) {
      answerEnd = i;
      break;
    }
  }
  if (answerStart < 0) answerStart = 0;
  if (answerEnd < 0) answerEnd = lines.length;
  // Trim leading blank lines + tqdm artifacts
  const answer = lines.slice(answerStart, answerEnd)
    .filter(l => !/Scanning repo:/.test(l))
    .join('\n')
    .trim();

  let inputTokens = 0, outputTokens = 0, costUsd = 0;
  const tm = stdout.match(TOKEN_RE);
  if (tm) {
    inputTokens = unsuffix(tm[1], tm[2]);
    outputTokens = unsuffix(tm[3], tm[4]);
  }
  const cm = stdout.match(COST_RE);
  if (cm) costUsd = parseFloat(cm[1]) || 0;

  return { answer, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, costUsd };
}

function runAider({ repoDir, question, opts }) {
  return new Promise((resolve) => {
    const args = [
      '--model', opts.model,
      '--map-tokens', String(opts.mapTokens),
      '--no-auto-commits',
      '--no-stream',
      '--no-pretty',
      '--yes-always',
      '--no-show-model-warnings',
      '--no-check-update',
      '--no-git',           // bench repos aren't separate git repos
      '--subtree-only',
      '--message', question,
    ];
    const child = spawn(opts.aiderBin, args, {
      cwd: repoDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    const start = Date.now();
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ stdout, stderr, code: -1, elapsedMs: Date.now() - start, timeout: true });
    }, opts.timeout);
    child.on('exit', (code) => {
      clearTimeout(t);
      resolve({ stdout, stderr, code, elapsedMs: Date.now() - start, timeout: false });
    });
  });
}

async function main() {
  const opts = parseArgs();
  if (!fs.existsSync(opts.aiderBin)) {
    console.error(`aider binary not found at ${opts.aiderBin}. Install with:`);
    console.error('  pip3 install --user aider-chat');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set. Aider needs this — it goes through litellm directly,');
    console.error('NOT through claude CLI. Export the key, then re-run.');
    process.exit(1);
  }

  const repoDir = path.join(ROOT, 'eval/repos', opts.repo);
  if (!fs.existsSync(repoDir)) {
    console.error(`Repo not found: ${repoDir}`);
    process.exit(1);
  }
  const questions = readQuestions(opts.repo);
  const subset = opts.maxQuestions > 0 ? questions.slice(0, opts.maxQuestions) : questions;
  const outPath = opts.out || path.join(ROOT, 'eval/agent-eval/results', `${opts.repo}-aider.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  process.stdout.write(`[aider] running ${subset.length} questions on ${opts.repo} (model=${opts.model}, mapTokens=${opts.mapTokens})\n`);

  const stream = fs.createWriteStream(outPath, { flags: 'w' });
  for (const q of subset) {
    process.stdout.write(`  ${q.id}: `);
    const start = Date.now();
    const r = await runAider({ repoDir, question: q.text, opts });
    const parsed = parseAiderOutput(r.stdout);
    const row = {
      questionId: q.id,
      system: 'aider',
      answer: parsed.answer,
      totalTokens: parsed.totalTokens,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      elapsedMs: r.elapsedMs,
      costUsd: parsed.costUsd,
      timeout: r.timeout,
      exitCode: r.code,
      error: r.code !== 0 ? r.stderr.slice(-2000) : null,
    };
    stream.write(JSON.stringify(row) + '\n');
    process.stdout.write(`${row.totalTokens} tok, ${row.elapsedMs}ms${row.timeout ? ' TIMEOUT' : ''}\n`);
  }
  stream.end();
  process.stdout.write(`\nWrote ${outPath}\n`);
  process.stdout.write('Next: run the existing judge to score aider against the others:\n');
  process.stdout.write(`  node eval/agent-eval/run-agent-eval.js --judge --repo=${opts.repo}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
