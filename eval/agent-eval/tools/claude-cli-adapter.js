/**
 * Claude CLI adapter for B2 agent execution.
 *
 * Uses `claude -p` (Claude Code CLI) instead of direct API calls.
 * This works with a Claude.ai subscription — no ANTHROPIC_API_KEY needed.
 *
 * Each system variant is implemented by restricting which tools Claude can use:
 *   - rg+read:        Bash(rg:*) + Read only
 *   - pattern+meta:   Bash(node:*) + Read (calls pattern search via node script)
 *   - pattern+agent:  Bash(node:*) only (calls pattern search with format=agent)
 *
 * The adapter shells out to `claude -p --bare --output-format json` and
 * parses the structured response.
 */

import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SEARCH_HELPER = path.join(PROJECT_ROOT, 'eval/agent-eval/tools/search-helper.js');
const SWEET_SEARCH_CLI = path.join(PROJECT_ROOT, 'core/cli.js');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

/**
 * Run a single question through Claude Code CLI with tool restrictions.
 *
 * @param {string} question - The user's question
 * @param {string} system - 'rg+read' | 'pattern+meta' | 'pattern+agent'
 * @param {string} projectRoot - Repo root directory
 * @param {object} opts
 * @param {string} [opts.model='sonnet'] - Model alias
 * @param {number} [opts.maxBudget=0.10] - Max USD per question
 * @param {boolean} [opts.verbose=false]
 * @returns {{ answer: string, totalTokens: number, inputTokens: number, outputTokens: number, toolCalls: number, searchCalls: number, readCalls: number, turns: number, elapsedMs: number, error: string|null }}
 */
export async function runViaClaude(question, system, projectRoot, opts = {}) {
  const model = opts.model || 'sonnet';
  const maxBudget = opts.maxBudget || 0.50;
  const verbose = opts.verbose || false;

  // Build the system prompt based on the system variant
  let systemPrompt;
  let allowedTools;
  let disallowedTools = '';

  switch (system) {
    case 'rg+read':
      systemPrompt = `You are answering a code question about the codebase in the current directory. Use rg (ripgrep) to search for code patterns and the Read tool to read files. Be specific: cite file paths, function names, and line numbers. Give a concise, actionable answer.`;
      allowedTools = 'Bash(rg:*) Read';
      break;

    case 'pattern+meta':
      systemPrompt = `You are answering a code question about the codebase in the current directory. You have a code search tool. Use it to find code, then use the Read tool to see the actual code.

To search: node ${SEARCH_HELPER} --query="YOUR QUERY" --regex="YOUR_REGEX" --k=5 2>/dev/null | grep '^{'

The results show file paths, line numbers, and scores. Then use Read to see the actual code.
Be specific: cite file paths, function names, and line numbers. Give a concise, actionable answer.`;
      allowedTools = 'Bash(node:*) Read';
      break;

    case 'pattern+agent':
      systemPrompt = `You are answering a code question about the codebase in the current directory. You have a powerful code search tool that returns FULL CODE BLOCKS directly — you do NOT need to read files.

To search: node ${SEARCH_HELPER} --query="YOUR QUERY" --regex="YOUR_REGEX" --format=agent --k=3 2>/dev/null | grep '^{'

IMPORTANT: The search results already contain the code. One search is usually enough. Answer directly from the first search result. Do NOT search again unless the first result was clearly wrong. Do NOT read files.
Be specific: cite file paths, function names, and line numbers. Give a concise answer.`;
      allowedTools = 'Bash(node:*)';
      break;

    case 'claude-full-tools':
      // Native Claude Code experience: full tool palette, no restriction
      // beyond editing/destructive ops. This is the "default Claude Code"
      // SOTA-via-claude proxy a developer would actually use — strictly
      // stronger than rg+read because the agent can choose Glob/Grep/Read
      // freely and even invoke shell scripts. Closest free comparison to
      // Cursor / Cody / Aider's repo-map approach since the model decides
      // its own retrieval surface.
      systemPrompt = `You are answering a code question about the codebase in the current directory. You have access to all native Claude Code tools (Bash, Read, Grep, Glob). Use whatever combination is best — grep, glob, ripgrep, file reads, etc. Be specific: cite file paths, function names, and line numbers. Give a concise, actionable answer.`;
      allowedTools = 'Bash Read Grep Glob';
      disallowedTools = 'Edit Write MultiEdit NotebookEdit';
      break;

    case 'sweet-search+agent':
      systemPrompt = `You answer code questions using sweet-search. Two commands:

GREP: node ${SEARCH_HELPER} --query="NAME" --regex="NAME" --mode=grep --k=10 2>/dev/null | grep '^{'
SEARCH: node ${SEARCH_HELPER} --query="QUESTION" --regex="REGEX" --format=agent --k=3 2>/dev/null | grep '^{'

SEARCH returns full code blocks — answer directly from the code, do not read files.
Use GREP for exact names ("where is X", "what calls X"). Use SEARCH for concepts ("how does X work").
Make ONE search call, then give a complete, thorough answer citing file paths, function names, and line numbers. The search result contains everything you need.`;
      allowedTools = 'Bash';
      disallowedTools = 'Read Edit Write Glob Grep';
      break;

    default:
      throw new Error(`Unknown system: ${system}`);
  }

  const startMs = performance.now();

  try {
    // Write system prompt to a temp file to avoid shell quoting issues
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'b2-'));
    const promptFile = path.join(tmpDir, 'system-prompt.txt');
    writeFileSync(promptFile, systemPrompt);

    const args = [
      '-p',
      '--output-format', 'json',
      '--model', model,
      '--system-prompt-file', promptFile,
      '--allowed-tools', allowedTools,
      ...(disallowedTools ? ['--disallowed-tools', disallowedTools] : []),
      '--max-budget-usd', maxBudget.toString(),
      '--dangerously-skip-permissions',
      '--no-session-persistence',
      question,
    ];

    if (verbose) {
      console.log(`    [claude] cwd=${projectRoot} model=${model} tools=${allowedTools}`);
    }

    let result;
    try {
      result = execFileSync(CLAUDE_BIN, args, {
        cwd: projectRoot,
        timeout: 120_000,
        encoding: 'utf8',
        maxBuffer: 5 * 1024 * 1024,
      });
    } finally {
      try { unlinkSync(promptFile); } catch {}
      try { unlinkSync(tmpDir); } catch {}
    }

    // Parse JSON output from claude -p --output-format json
    // Shape: { type: "result", result: "answer text", num_turns, duration_ms, usage: { input_tokens, output_tokens }, ... }
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch {
      return {
        answer: result.trim(),
        totalTokens: 0, inputTokens: 0, outputTokens: 0,
        toolCalls: 0, searchCalls: 0, readCalls: 0, turns: 0,
        elapsedMs: Math.round(performance.now() - startMs),
        error: null,
      };
    }

    const answer = parsed.result || '';
    const inputTokens = parsed.usage?.input_tokens || 0;
    const outputTokens = parsed.usage?.output_tokens || 0;
    const cacheRead = parsed.usage?.cache_read_input_tokens || 0;
    const turns = parsed.num_turns || 0;

    // Estimate tool usage from the answer content and turn count
    // claude -p doesn't expose individual tool calls in JSON output,
    // so we infer from the answer text and turn structure
    const searchCalls = (answer.match(/pattern_search|warmSearch|rg /g) || []).length > 0 ? 1 : 0;
    const readCalls = system.includes('read') ? Math.max(0, turns - 1) : 0;
    const toolCalls = turns > 1 ? turns - 1 : (searchCalls > 0 ? 1 : 0);

    return {
      answer,
      totalTokens: inputTokens + outputTokens + cacheRead,
      inputTokens: inputTokens + cacheRead,
      outputTokens,
      toolCalls,
      searchCalls: searchCalls > 0 ? 1 : (turns > 1 ? 1 : 0),
      readCalls: (system === 'pattern+agent' || system === 'sweet-search+agent') ? 0 : Math.max(0, turns - 2),
      turns,
      elapsedMs: parsed.duration_ms || Math.round(performance.now() - startMs),
      costUsd: parsed.total_cost_usd || 0,
      error: parsed.is_error ? 'Agent returned error' : null,
    };
  } catch (err) {
    return {
      answer: null,
      totalTokens: 0, inputTokens: 0, outputTokens: 0,
      toolCalls: 0, searchCalls: 0, readCalls: 0, turns: 0,
      elapsedMs: Math.round(performance.now() - startMs),
      error: err.message?.split('\n')[0] || 'Unknown error',
    };
  }
}
