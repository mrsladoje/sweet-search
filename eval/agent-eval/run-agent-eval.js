#!/usr/bin/env node

/**
 * Track B2: Agent-in-the-Loop Evaluation
 *
 * Head-to-head comparison: an agent answers code questions using three
 * different tool configurations. Uses the Anthropic Messages API with
 * tool_use to run real agent conversations.
 *
 * Systems:
 *   1. rg+read:        grep + file read (standard workflow)
 *   2. pattern+meta:   ColGrep ranked metadata + file read
 *   3. pattern+agent:  ColGrep agent mode (code in results, no reads)
 *
 * Usage:
 *   node eval/agent-eval/run-agent-eval.js --generate-questions --repo=fastify
 *   node eval/agent-eval/run-agent-eval.js --run --system=pattern+agent --repo=fastify
 *   node eval/agent-eval/run-agent-eval.js --judge --repo=fastify
 *   node eval/agent-eval/run-agent-eval.js --report --repo=fastify
 *
 * Prerequisites: ANTHROPIC_API_KEY env var set
 *
 * References: docs/USEFUL_ANSWER_COLGREP_PLAN.md §15
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const SYSTEMS = ['rg+read', 'pattern+meta', 'pattern+agent'];
const MAX_TURNS = 10;
const TOKEN_LIMIT = 50000;

const SYSTEM_PROMPT = `You are a code expert. Answer the question about the codebase using the tools available to you. Be specific: cite file paths, function names, and line numbers. Give a concise, actionable answer.`;

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    action: null, repo: null, system: null, maxQuestions: 0,
    verbose: false, model: 'claude-sonnet-4-6', judgeModel: 'claude-opus-4-6',
    backend: 'api', // 'api' (requires ANTHROPIC_API_KEY) | 'cli' (uses claude -p)
  };
  for (const arg of args) {
    if (arg === '--generate-questions') opts.action = 'generate-questions';
    else if (arg === '--run') opts.action = 'run';
    else if (arg === '--judge') opts.action = 'judge';
    else if (arg === '--report') opts.action = 'report';
    else if (arg.startsWith('--repo=')) opts.repo = arg.split('=')[1];
    else if (arg.startsWith('--system=')) opts.system = arg.split('=')[1];
    else if (arg.startsWith('--max-questions=')) opts.maxQuestions = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--model=')) opts.model = arg.split('=')[1];
    else if (arg === '--backend=cli' || arg === '--cli') opts.backend = 'cli';
    else if (arg === '--backend=api') opts.backend = 'api';
    else if (arg === '-v' || arg === '--verbose') opts.verbose = true;
    else if (arg === '--help') {
      console.log(`Track B2: Agent-in-the-Loop Evaluation

Actions:
  --generate-questions   Generate frozen question sets per repo
  --run                  Run agent on questions (requires --system and --repo)
  --judge                Blind-judge all answers for a repo
  --report               Compute and display metrics

Options:
  --repo=NAME            Repository (fastify, gin, flask, ripgrep)
  --system=SYSTEM        System: rg+read, pattern+meta, pattern+agent
  --max-questions=N      Limit (0 = all)
  --model=ID             Agent model (default: claude-sonnet-4-6)
  --cli                  Use claude CLI backend (no API key needed, uses Claude.ai login)
  --backend=api|cli      Backend selection (default: api)
  -v                     Verbose
`);
      process.exit(0);
    }
  }
  if (!opts.action) { console.error('No action. Use --help.'); process.exit(1); }
  return opts;
}

// ─── API Client ───────────────────────────────────────────────────────────────

/** Simple prompt → response via claude -p (no tools, for question gen + judging). */
async function callViaCli(prompt, model = 'opus') {
  const { execSync } = await import('child_process');
  const cliModel = model.replace('claude-opus-4-6', 'opus').replace('claude-sonnet-4-6', 'sonnet');
  // Pipe prompt through stdin to avoid shell argument length/quoting issues
  const result = execSync(
    `claude -p --model ${cliModel} --no-session-persistence --dangerously-skip-permissions --disallowed-tools "Bash Edit Write"`,
    { input: prompt, timeout: 180_000, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }
  );
  return { content: [{ text: result.trim() }] };
}

async function callAnthropic(messages, tools, model, maxTokens = 4096) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const body = {
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages,
    ...(tools?.length > 0 && { tools }),
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json();
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

async function runAgentConversation(question, tools, executeTool, model, verbose) {
  const messages = [{ role: 'user', content: question }];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolCalls = 0;
  let searchCalls = 0;
  let readCalls = 0;
  let turns = 0;

  const startMs = performance.now();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    turns++;
    const response = await callAnthropic(messages, tools, model);

    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;

    if (totalInputTokens + totalOutputTokens > TOKEN_LIMIT) {
      if (verbose) console.log(`    Token limit reached at turn ${turn + 1}`);
      break;
    }

    // Check if the model wants to use tools
    const toolUseBlocks = (response.content || []).filter(b => b.type === 'tool_use');

    if (toolUseBlocks.length === 0) {
      // Model responded with text — conversation complete
      const textBlocks = (response.content || []).filter(b => b.type === 'text');
      const answer = textBlocks.map(b => b.text).join('\n');

      return {
        answer,
        totalTokens: totalInputTokens + totalOutputTokens,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        toolCalls,
        searchCalls,
        readCalls,
        turns,
        elapsedMs: Math.round(performance.now() - startMs),
      };
    }

    // Execute each tool call
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      toolCalls++;
      if (block.name.includes('search') || block.name === 'grep') searchCalls++;
      if (block.name === 'read') readCalls++;

      if (verbose) console.log(`    [turn ${turn + 1}] ${block.name}(${JSON.stringify(block.input).slice(0, 80)}...)`);

      let result;
      try {
        result = await executeTool(block.name, block.input);
        if (typeof result !== 'string') result = JSON.stringify(result);
        // Truncate very long results to avoid token bloat
        if (result.length > 10000) result = result.slice(0, 10000) + '\n... (truncated)';
      } catch (err) {
        result = `Tool error: ${err.message}`;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Max turns reached — extract whatever answer the model gave
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop();
  const textBlocks = (lastAssistant?.content || []).filter(b => b.type === 'text');
  const answer = textBlocks.map(b => b.text).join('\n') || '(max turns reached without answer)';

  return {
    answer,
    totalTokens: totalInputTokens + totalOutputTokens,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    toolCalls,
    searchCalls,
    readCalls,
    turns,
    elapsedMs: Math.round(performance.now() - startMs),
  };
}

// ─── Question Generation ──────────────────────────────────────────────────────

async function generateQuestions(repo, opts) {
  const questionsPath = path.join(__dirname, 'questions', `${repo}.jsonl`);
  if (fs.existsSync(questionsPath)) {
    console.log(`  Questions exist: ${questionsPath} (delete to regenerate)`);
    return;
  }

  console.log(`  Generating questions for ${repo}...`);

  // Load file listing from code graph
  const repoRoot = repo === 'sweet-search' ? ROOT : path.join(ROOT, 'eval/repos', repo);
  const ssDir = path.join(repoRoot, '.sweet-search');
  let fileList = '';
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(path.join(ssDir, 'code-graph.db'), { readonly: true });
    const files = db.prepare('SELECT DISTINCT file_path FROM entities ORDER BY file_path LIMIT 200').all();
    fileList = files.map(r => r.file_path).join('\n');
    db.close();
  } catch { /* proceed without file list */ }

  const prompt = `Given the ${repo} codebase, generate 30 code questions at 3 difficulty levels.

EASY (10): "Where is X defined?" / "What does function Y do?"
MEDIUM (10): "How does X work?" / "What calls Y?"
HARD (10): "How would I change X to do Y?" / "What's the relationship between X and Z?"

Each question must have a clear answer findable in the codebase.

Output as JSONL (one JSON object per line, no markdown fences):
{"id": "q001", "text": "...", "difficulty": "easy", "keyFiles": ["..."], "referenceAnswer": "..."}

${fileList ? 'Key files:\n' + fileList : ''}`;

  let response;
  if (process.env.ANTHROPIC_API_KEY) {
    response = await callAnthropic([{ role: 'user', content: prompt }], [], opts.judgeModel, 8192);
  } else {
    response = await callViaCli(prompt, opts.judgeModel);
  }

  const text = response.content?.[0]?.text || '';
  const lines = text.split('\n').filter(l => l.trim().startsWith('{'));

  if (lines.length < 10) {
    console.error(`  Only ${lines.length} questions generated. Check API response.`);
    if (lines.length === 0) { console.error('  Raw:', text.slice(0, 300)); process.exit(1); }
  }

  fs.writeFileSync(questionsPath, lines.join('\n') + '\n');
  console.log(`  Generated ${lines.length} questions → ${questionsPath}`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function runSystem(repo, system, opts) {
  const questionsPath = path.join(__dirname, 'questions', `${repo}.jsonl`);
  if (!fs.existsSync(questionsPath)) {
    console.error(`  Questions not found: ${questionsPath}`);
    console.error('  Run --generate-questions first.');
    process.exit(1);
  }

  let questions = fs.readFileSync(questionsPath, 'utf8')
    .trim().split('\n').map(l => JSON.parse(l));
  if (opts.maxQuestions > 0) questions = questions.slice(0, opts.maxQuestions);

  // Load tool adapter
  const repoRoot = repo === 'sweet-search' ? ROOT : path.join(ROOT, 'eval/repos', repo);
  const ssDir = path.join(repoRoot, '.sweet-search');

  let tools, executeTool;

  if (system === 'rg+read') {
    const adapter = await import('./tools/grep-read-tools.js');
    tools = adapter.TOOL_DEFINITIONS;
    executeTool = adapter.createToolExecutor(repoRoot);
  } else {
    // Both pattern systems need a SweetSearch instance
    process.env.SWEET_SEARCH_PROJECT_ROOT = repoRoot;
    const SweetSearch = (await import('../../core/search/index.js')).default;
    const search = new SweetSearch({
      projectRoot: repoRoot,
      graphDbPath: path.join(ssDir, 'code-graph.db'),
      hnswPath: path.join(ssDir, 'codebase-hnsw.idx'),
      binaryHnswPath: path.join(ssDir, 'codebase-binary-hnsw.idx'),
      codebaseDbPath: path.join(ssDir, 'codebase.db'),
      sparseGramIndexPath: path.join(ssDir, 'codebase-sparse-grams.idx'),
      lateInteractionOptions: { indexPath: path.join(ssDir, 'codebase-late-interaction.db') },
    });
    await search.init();

    if (system === 'pattern+meta') {
      const adapter = await import('./tools/pattern-meta-tools.js');
      tools = adapter.TOOL_DEFINITIONS;
      executeTool = adapter.createToolExecutor(repoRoot, search);
    } else {
      const adapter = await import('./tools/pattern-agent-tools.js');
      tools = adapter.TOOL_DEFINITIONS;
      executeTool = adapter.createToolExecutor(repoRoot, search);
    }
  }

  console.log(`  System: ${system}`);
  console.log(`  Backend: ${opts.backend}`);
  console.log(`  Questions: ${questions.length}`);
  console.log(`  Model: ${opts.model}`);

  // CLI backend: use claude -p directly (no API key needed)
  let cliAdapter;
  if (opts.backend === 'cli') {
    cliAdapter = await import('./tools/claude-cli-adapter.js');
  }

  const results = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log(`  [${i + 1}/${questions.length}] ${q.id}: ${q.text.slice(0, 60)}...`);
    try {
      let record;
      if (opts.backend === 'cli') {
        // CLI backend: shell out to claude -p
        const cliModel = opts.model.replace('claude-sonnet-4-6', 'sonnet').replace('claude-opus-4-6', 'opus');
        record = await cliAdapter.runViaClaude(
          q.text, system, repoRoot, { model: cliModel, verbose: opts.verbose }
        );
      } else {
        // API backend: use Anthropic Messages API with tool_use
        record = await runAgentConversation(
          q.text, tools, executeTool, opts.model, opts.verbose
        );
      }
      record.questionId = q.id;
      record.system = system;
      results.push(record);

      console.log(`    → ${record.turns} turns, ${record.toolCalls} tools (${record.searchCalls}S ${record.readCalls}R), ${record.totalTokens} tokens, ${record.elapsedMs}ms`);
    } catch (err) {
      console.error(`    ERROR: ${err.message}`);
      results.push({ questionId: q.id, system, error: err.message, answer: null,
        totalTokens: 0, inputTokens: 0, outputTokens: 0,
        toolCalls: 0, searchCalls: 0, readCalls: 0, turns: 0, elapsedMs: 0 });
    }
  }

  const outPath = path.join(__dirname, 'results', `${repo}-${system}.jsonl`);
  fs.writeFileSync(outPath, results.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`  Saved: ${outPath}`);
  return results;
}

// ─── Judge ────────────────────────────────────────────────────────────────────

async function judgeAnswers(repo, opts) {
  const questionsPath = path.join(__dirname, 'questions', `${repo}.jsonl`);
  const questions = fs.readFileSync(questionsPath, 'utf8')
    .trim().split('\n').map(l => JSON.parse(l));
  const qMap = new Map(questions.map(q => [q.id, q]));

  // Collect all answers across systems, shuffle for blind judging
  const allAnswers = [];
  for (const system of SYSTEMS) {
    const resultsPath = path.join(__dirname, 'results', `${repo}-${system}.jsonl`);
    if (!fs.existsSync(resultsPath)) continue;
    const results = fs.readFileSync(resultsPath, 'utf8')
      .trim().split('\n').map(l => JSON.parse(l));
    for (const r of results) {
      if (!r.answer) continue;
      allAnswers.push({ questionId: r.questionId, system, answer: r.answer });
    }
  }

  // Shuffle for blind judging
  for (let i = allAnswers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allAnswers[i], allAnswers[j]] = [allAnswers[j], allAnswers[i]];
  }

  console.log(`  Judging ${allAnswers.length} answers (blind, shuffled)...`);

  const judgments = [];
  for (let i = 0; i < allAnswers.length; i++) {
    const a = allAnswers[i];
    const q = qMap.get(a.questionId);
    if (!q) continue;

    const prompt = `You are judging the quality of a code question answer.

Question: ${q.text}
Expected key files: ${JSON.stringify(q.keyFiles)}
Reference answer: ${q.referenceAnswer}
Answer: ${a.answer}

Rate on these dimensions (1-5 each):
1. CORRECTNESS: Is the answer factually correct? (1=wrong, 3=partial, 5=fully correct)
2. COMPLETENESS: Does it cover all relevant aspects? (1=missing major parts, 5=comprehensive)
3. SPECIFICITY: Does it reference specific files/functions/lines? (1=vague, 5=precise)
4. ACTIONABILITY: Could a developer act on it immediately? (1=needs more research, 5=ready)

Output ONLY a JSON object:
{"correctness": N, "completeness": N, "specificity": N, "actionability": N, "overall": N}
Overall = (correctness * 2 + completeness + specificity + actionability) / 5`;

    try {
      let response;
      if (process.env.ANTHROPIC_API_KEY) {
        response = await callAnthropic([{ role: 'user', content: prompt }], [], opts.judgeModel, 512);
      } else {
        response = await callViaCli(prompt, opts.judgeModel);
      }
      const text = response.content?.[0]?.text || '';
      const jsonMatch = text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const scores = JSON.parse(jsonMatch[0]);
        judgments.push({ ...a, scores });
        if (opts.verbose) console.log(`    ${a.questionId}: ${JSON.stringify(scores)}`);
      }
    } catch (err) {
      console.error(`    Judge error for ${a.questionId}: ${err.message}`);
    }

    // Rate limit: 1 judgment per second
    if (i < allAnswers.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  const outPath = path.join(__dirname, 'results', `${repo}-judgments.jsonl`);
  fs.writeFileSync(outPath, judgments.map(j => JSON.stringify(j)).join('\n') + '\n');
  console.log(`  Saved ${judgments.length} judgments → ${outPath}`);
}

// ─── Report ───────────────────────────────────────────────────────────────────

function generateReport(repo) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Track B2 Report: ${repo}`);
  console.log('═'.repeat(70));

  const systemMetrics = {};

  for (const system of SYSTEMS) {
    const resultsPath = path.join(__dirname, 'results', `${repo}-${system}.jsonl`);
    if (!fs.existsSync(resultsPath)) continue;
    const allResults = fs.readFileSync(resultsPath, 'utf8')
      .trim().split('\n').map(l => JSON.parse(l));
    const results = allResults.filter(r => !r.error);
    const errors = allResults.filter(r => r.error);

    const nTotal = allResults.length;
    const n = results.length;
    if (nTotal === 0) continue;

    const m = {
      n,
      nTotal,
      completionRate: n / nTotal,
      totalTokens: results.reduce((s, r) => s + r.totalTokens, 0),
      inputTokens: results.reduce((s, r) => s + r.inputTokens, 0),
      searchCalls: results.reduce((s, r) => s + r.searchCalls, 0),
      readCalls: results.reduce((s, r) => s + r.readCalls, 0),
      toolCalls: results.reduce((s, r) => s + r.toolCalls, 0),
      turns: results.reduce((s, r) => s + r.turns, 0),
      selfContained: results.filter(r => r.readCalls === 0).length,
      elapsedMs: results.reduce((s, r) => s + r.elapsedMs, 0),
    };

    systemMetrics[system] = m;

    console.log(`\n  ${system} (${n}/${nTotal} completed, ${(m.completionRate * 100).toFixed(0)}%):`);
    console.log(`    Total tokens:     ${m.totalTokens} (${Math.round(m.totalTokens / n)}/q)`);
    console.log(`    Input tokens:     ${m.inputTokens} (${Math.round(m.inputTokens / n)}/q)`);
    console.log(`    Search calls:     ${m.searchCalls} (${(m.searchCalls / n).toFixed(1)}/q)`);
    console.log(`    Read calls:       ${m.readCalls} (${(m.readCalls / n).toFixed(1)}/q)`);
    console.log(`    Self-contained:   ${m.selfContained}/${n} (${(m.selfContained / n * 100).toFixed(0)}%)`);
    console.log(`    Avg turns:        ${(m.turns / n).toFixed(1)}`);
    console.log(`    Avg time:         ${Math.round(m.elapsedMs / n)}ms`);
  }

  // Judgments
  const judgmentsPath = path.join(__dirname, 'results', `${repo}-judgments.jsonl`);
  if (fs.existsSync(judgmentsPath)) {
    const judgments = fs.readFileSync(judgmentsPath, 'utf8')
      .trim().split('\n').map(l => JSON.parse(l));

    console.log('\n  Quality scores (blind-judged):');
    for (const system of SYSTEMS) {
      const sj = judgments.filter(j => j.system === system);
      if (sj.length === 0) continue;
      const avg = (field) => sj.reduce((s, j) => s + (j.scores?.[field] || 0), 0) / sj.length;
      console.log(`    ${system}: overall=${avg('overall').toFixed(2)} correct=${avg('correctness').toFixed(2)} complete=${avg('completeness').toFixed(2)} specific=${avg('specificity').toFixed(2)} action=${avg('actionability').toFixed(2)}`);
    }
  }

  // Ship/no-ship decision
  const baseline = systemMetrics['rg+read'];
  const treatment = systemMetrics['pattern+agent'];
  if (baseline && treatment) {
    console.log('\n  ' + '─'.repeat(60));
    const tokenSavings = 1 - treatment.totalTokens / baseline.totalTokens;
    const selfContainRate = treatment.selfContained / treatment.n;
    const completionRate = treatment.completionRate;
    console.log(`  Token savings:     ${(tokenSavings * 100).toFixed(1)}% (target: >20%)`);
    console.log(`  Self-containment:  ${(selfContainRate * 100).toFixed(0)}% (target: >80%)`);
    console.log(`  Completion rate:   ${(completionRate * 100).toFixed(0)}% (target: >90%)`);

    // Unconditional utility: effective quality = quality × completion rate
    const effectiveTokenSavings = tokenSavings * completionRate;
    console.log(`  Effective savings: ${(effectiveTokenSavings * 100).toFixed(1)}% (completion-adjusted)`);

    const allPass = tokenSavings > 0.2 && selfContainRate > 0.8 && completionRate >= 0.9;
    const conditional = (tokenSavings > 0.1 || selfContainRate > 0.6) && completionRate >= 0.5;

    if (allPass) {
      console.log('  ✅ SHIP');
    } else if (conditional) {
      console.log('  ⚠️  CONDITIONAL' + (completionRate < 0.9 ? ' (completion rate too low for SHIP)' : ''));
    } else {
      console.log('  ❌ NO-SHIP');
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('═'.repeat(70));
  console.log('  Track B2: Agent-in-the-Loop Evaluation');
  console.log('═'.repeat(70));

  switch (opts.action) {
    case 'generate-questions':
      if (!opts.repo) { console.error('  --repo required'); process.exit(1); }
      await generateQuestions(opts.repo, opts);
      break;

    case 'run':
      if (!opts.repo || !opts.system) { console.error('  --repo and --system required'); process.exit(1); }
      if (!SYSTEMS.includes(opts.system)) { console.error(`  Unknown system: ${opts.system}`); process.exit(1); }
      if (opts.backend === 'api' && !process.env.ANTHROPIC_API_KEY) { console.error('  ANTHROPIC_API_KEY not set (use --cli for Claude Code backend)'); process.exit(1); }
      await runSystem(opts.repo, opts.system, opts);
      break;

    case 'judge':
      if (!opts.repo) { console.error('  --repo required'); process.exit(1); }
      await judgeAnswers(opts.repo, opts);
      break;

    case 'report':
      if (!opts.repo) { console.error('  --repo required'); process.exit(1); }
      generateReport(opts.repo);
      break;
  }
}

main().catch(err => { console.error(err); process.exit(1); });
