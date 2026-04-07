#!/usr/bin/env node

/**
 * Track B2: Agent-in-the-Loop Evaluation
 *
 * Head-to-head comparison: an agent answers code questions using three
 * different tool configurations:
 *
 *   1. rg+read:        grep(regex, dir) → file:line, read(file, start, end) → code
 *   2. pattern+meta:   pattern_search(regex, query) → ranked metadata (no code)
 *   3. pattern+agent:  pattern_search(regex, query, format=agent) → ranked code blocks
 *
 * Measures: answer quality (blind-judged), token savings, search operations,
 * read operations, turn count, self-containment rate, time-to-answer.
 *
 * Usage:
 *   node eval/agent-eval/run-agent-eval.js --generate-questions --repo=fastify
 *   node eval/agent-eval/run-agent-eval.js --run --system=pattern+agent --repo=fastify
 *   node eval/agent-eval/run-agent-eval.js --judge --repo=fastify
 *   node eval/agent-eval/run-agent-eval.js --report --repo=fastify
 *
 * Prerequisites:
 *   - ANTHROPIC_API_KEY env var set
 *   - Indexed repos in eval/repos/
 *   - Generated question sets in eval/agent-eval/questions/
 *
 * References: docs/USEFUL_ANSWER_COLGREP_PLAN.md §15
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const REPOS = ['sweet-search', 'fastify', 'gin', 'flask', 'ripgrep'];
const SYSTEMS = ['rg+read', 'pattern+meta', 'pattern+agent'];
const MAX_TURNS = 10;
const TOKEN_LIMIT = 50000;
const TIMEOUT_PER_QUESTION_MS = 120_000;

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    action: null,     // 'generate-questions' | 'run' | 'judge' | 'report'
    repo: null,
    system: null,
    maxQuestions: 0,
    verbose: false,
    model: 'claude-sonnet-4-6',
    judgeModel: 'claude-opus-4-6',
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
    else if (arg.startsWith('--judge-model=')) opts.judgeModel = arg.split('=')[1];
    else if (arg === '-v' || arg === '--verbose') opts.verbose = true;
    else if (arg === '--help') {
      console.log(`Track B2: Agent-in-the-Loop Evaluation

Usage:
  --generate-questions  Generate frozen question sets per repo (requires API key)
  --run                 Run agent on questions (requires --system and --repo)
  --judge               Blind-judge all answers for a repo
  --report              Compute and display metrics

Options:
  --repo=NAME           Repository name (fastify, gin, flask, ripgrep, sweet-search)
  --system=SYSTEM       System to run: rg+read, pattern+meta, pattern+agent
  --max-questions=N     Limit questions (0 = all)
  --model=ID            Agent model (default: claude-sonnet-4-6)
  --judge-model=ID      Judge model (default: claude-opus-4-6)
  -v, --verbose         Verbose output
`);
      process.exit(0);
    }
  }
  if (!opts.action) { console.error('No action specified. Use --help.'); process.exit(1); }
  return opts;
}

// ─── Question generation ──────────────────────────────────────────────────────

const QUESTION_PROMPT = `Given the {repo} codebase, generate 30 code questions at 3 difficulty levels:

EASY (10): "Where is X defined?" / "What does function Y do?"
  - Answers require finding one specific entity
  - Example: "Where is the SweetSearch class constructor defined?"

MEDIUM (10): "How does X work?" / "What calls Y?"
  - Answers require understanding a module or data flow
  - Example: "How does the query router decide between lexical and semantic search?"

HARD (10): "How would I change X to do Y?" / "What's the relationship between X and Z?"
  - Answers require cross-file understanding or architectural knowledge
  - Example: "How would I add a new search mode to Sweet Search?"

Each question must have:
- A clear, unambiguous answer findable in the codebase
- A difficulty level (easy/medium/hard)
- A list of key files the answer involves (for judge reference)
- A brief reference answer (2-3 sentences describing expected code locations and key facts)

Output as JSONL, one question per line:
{"id": "q001", "text": "...", "difficulty": "easy", "keyFiles": ["..."], "referenceAnswer": "..."}`;

async function generateQuestions(repo, opts) {
  const questionsPath = path.join(__dirname, 'questions', `${repo}.jsonl`);
  if (fs.existsSync(questionsPath)) {
    console.log(`  Questions already exist: ${questionsPath}`);
    console.log(`  Delete to regenerate.`);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('  ANTHROPIC_API_KEY not set. Cannot generate questions.');
    console.error('  Create questions manually in eval/agent-eval/questions/{repo}.jsonl');
    console.error('  Format: {"id":"q001","text":"...","difficulty":"easy","keyFiles":["..."],"referenceAnswer":"..."}');
    process.exit(1);
  }

  console.log(`  Generating questions for ${repo} using ${opts.judgeModel}...`);

  // Load repo file listing for context
  const repoRoot = repo === 'sweet-search' ? ROOT : path.join(ROOT, 'eval/repos', repo);
  const ssDir = path.join(repoRoot, '.sweet-search');
  let fileList = '';
  if (fs.existsSync(path.join(ssDir, 'code-graph.db'))) {
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(path.join(ssDir, 'code-graph.db'), { readonly: true });
      const files = db.prepare('SELECT DISTINCT file_path FROM entities ORDER BY file_path LIMIT 200').all();
      fileList = files.map(r => r.file_path).join('\n');
      db.close();
    } catch { /* fallback below */ }
  }

  const prompt = QUESTION_PROMPT.replace('{repo}', repo) +
    (fileList ? `\n\nKey files in the repo:\n${fileList}` : '');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.judgeModel,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const body = await response.json();
  const text = body.content?.[0]?.text || '';

  // Extract JSONL lines from the response
  const lines = text.split('\n').filter(l => l.trim().startsWith('{'));
  if (lines.length === 0) {
    console.error('  Failed to parse questions from API response.');
    console.error('  Raw response:', text.slice(0, 500));
    process.exit(1);
  }

  fs.writeFileSync(questionsPath, lines.join('\n') + '\n');
  console.log(`  Generated ${lines.length} questions → ${questionsPath}`);
}

// ─── Agent execution ──────────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are a code expert. Answer the question about the codebase using the tools available to you. Be specific: cite file paths, function names, and line numbers. Give a concise, actionable answer.`;

async function runAgentOnQuestion(question, system, searchInstance, opts) {
  // Placeholder: in a full implementation, this would call the Anthropic API
  // with tool_use, routing through the appropriate tool adapter.
  //
  // For now, return a simulated record structure per plan §15.5
  const record = {
    questionId: question.id,
    system,
    answer: `[Placeholder — requires ANTHROPIC_API_KEY and tool-use API calls]`,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    searchCalls: 0,
    readCalls: 0,
    turns: 0,
    elapsedMs: 0,
    error: null,
  };

  // Direct measurement: for pattern+agent, the search result itself IS the context
  if (system === 'pattern+agent' && searchInstance) {
    const start = performance.now();
    try {
      const result = await searchInstance.search(question.text, {
        regex: '\\w+', // broad regex for question-driven search
        k: 5,
        format: 'agent',
        gramIndex: false,
      });
      record.elapsedMs = Math.round(performance.now() - start);
      record.searchCalls = 1;
      record.readCalls = 0; // agent mode: zero reads
      record.answer = JSON.stringify(result.results?.slice(0, 3)?.map(r => ({
        file: r.file, startLine: r.startLine, endLine: r.endLine,
        symbol: r.symbol, code: r.code?.slice(0, 200),
      })));
    } catch (err) {
      record.error = err.message;
    }
  }

  return record;
}

// ─── Judge ────────────────────────────────────────────────────────────────────

const JUDGE_PROMPT = `You are judging the quality of a code question answer.

Question: {question}
Expected key files: {keyFiles}
Reference answer: {referenceAnswer}
Answer: {answer}

Rate the answer on these dimensions (1-5 each):

1. CORRECTNESS: Is the answer factually correct about the codebase?
   1=wrong, 3=partially correct, 5=fully correct

2. COMPLETENESS: Does the answer cover all relevant aspects?
   1=missing major parts, 3=covers main points, 5=comprehensive

3. SPECIFICITY: Does the answer reference specific files/functions/lines?
   1=vague, 3=mentions some specifics, 5=precise references

4. ACTIONABILITY: Could a developer act on this answer immediately?
   1=needs more research, 3=mostly actionable, 5=ready to implement

Output as JSON: {"correctness": N, "completeness": N, "specificity": N, "actionability": N, "overall": N, "notes": "..."}
Overall = (correctness * 2 + completeness + specificity + actionability) / 5`;

// ─── Report ───────────────────────────────────────────────────────────────────

function computeReport(repo) {
  const resultsDir = path.join(__dirname, 'results');
  const files = fs.readdirSync(resultsDir).filter(f => f.startsWith(`${repo}-`) && f.endsWith('.jsonl'));

  if (files.length === 0) {
    console.log(`  No results found for ${repo}.`);
    return;
  }

  console.log(`\n  Track B2 Report: ${repo}`);
  console.log('  ' + '─'.repeat(60));

  for (const file of files) {
    const system = file.replace(`${repo}-`, '').replace('.jsonl', '');
    const lines = fs.readFileSync(path.join(resultsDir, file), 'utf8')
      .trim().split('\n').map(l => JSON.parse(l));

    const totalTokens = lines.reduce((s, r) => s + (r.totalTokens || 0), 0);
    const totalSearches = lines.reduce((s, r) => s + (r.searchCalls || 0), 0);
    const totalReads = lines.reduce((s, r) => s + (r.readCalls || 0), 0);
    const avgTurns = lines.reduce((s, r) => s + (r.turns || 0), 0) / lines.length;
    const selfContained = lines.filter(r => r.readCalls === 0).length;
    const avgTime = lines.reduce((s, r) => s + (r.elapsedMs || 0), 0) / lines.length;

    console.log(`  ${system}:`);
    console.log(`    Questions:        ${lines.length}`);
    console.log(`    Total tokens:     ${totalTokens}`);
    console.log(`    Search calls:     ${totalSearches} (${(totalSearches/lines.length).toFixed(1)}/q)`);
    console.log(`    Read calls:       ${totalReads} (${(totalReads/lines.length).toFixed(1)}/q)`);
    console.log(`    Self-contained:   ${selfContained}/${lines.length} (${(selfContained/lines.length*100).toFixed(0)}%)`);
    console.log(`    Avg turns:        ${avgTurns.toFixed(1)}`);
    console.log(`    Avg time:         ${avgTime.toFixed(0)}ms`);
  }

  // ─── Pass/fail criteria (plan §15.8) ────────────────────────────────────────
  console.log('\n  Pass/Fail Criteria (§15.8):');
  console.log('    SHIP:        Quality ≥ baseline AND token savings >20% AND self-containment >80%');
  console.log('    CONDITIONAL: Quality ≥ baseline AND token savings 10-20%');
  console.log('    NO-SHIP:     Quality < baseline OR self-containment <60%');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('═'.repeat(70));
  console.log('  Track B2: Agent-in-the-Loop Evaluation');
  console.log('═'.repeat(70));

  switch (opts.action) {
    case 'generate-questions': {
      if (!opts.repo) { console.error('  --repo required for question generation'); process.exit(1); }
      await generateQuestions(opts.repo, opts);
      break;
    }
    case 'run': {
      if (!opts.repo || !opts.system) {
        console.error('  --repo and --system required for run');
        process.exit(1);
      }
      if (!SYSTEMS.includes(opts.system)) {
        console.error(`  Unknown system: ${opts.system}. Must be: ${SYSTEMS.join(', ')}`);
        process.exit(1);
      }

      const questionsPath = path.join(__dirname, 'questions', `${opts.repo}.jsonl`);
      if (!fs.existsSync(questionsPath)) {
        console.error(`  Questions not found: ${questionsPath}`);
        console.error('  Run --generate-questions first.');
        process.exit(1);
      }

      let questions = fs.readFileSync(questionsPath, 'utf8')
        .trim().split('\n').map(l => JSON.parse(l));
      if (opts.maxQuestions > 0) questions = questions.slice(0, opts.maxQuestions);

      console.log(`  System: ${opts.system}`);
      console.log(`  Repo: ${opts.repo}`);
      console.log(`  Questions: ${questions.length}`);

      // Initialize search for pattern+meta and pattern+agent systems
      let search = null;
      if (opts.system.startsWith('pattern')) {
        const repoRoot = opts.repo === 'sweet-search' ? ROOT : path.join(ROOT, 'eval/repos', opts.repo);
        const ssDir = path.join(repoRoot, '.sweet-search');
        process.env.SWEET_SEARCH_PROJECT_ROOT = repoRoot;

        const SweetSearch = (await import('../../core/search/index.js')).default;
        search = new SweetSearch({
          projectRoot: repoRoot,
          graphDbPath: path.join(ssDir, 'code-graph.db'),
          hnswPath: path.join(ssDir, 'codebase-hnsw.idx'),
          binaryHnswPath: path.join(ssDir, 'codebase-binary-hnsw.idx'),
          codebaseDbPath: path.join(ssDir, 'codebase.db'),
          sparseGramIndexPath: path.join(ssDir, 'codebase-sparse-grams.idx'),
          lateInteractionOptions: { indexPath: path.join(ssDir, 'codebase-late-interaction.db') },
        });
        await search.init();
      }

      const results = [];
      for (const q of questions) {
        const record = await runAgentOnQuestion(q, opts.system, search, opts);
        results.push(record);
        if (opts.verbose) {
          console.log(`    ${q.id}: ${record.elapsedMs}ms, ${record.searchCalls} searches, ${record.readCalls} reads`);
        }
      }

      if (search) search.close();

      const outPath = path.join(__dirname, 'results', `${opts.repo}-${opts.system}.jsonl`);
      fs.writeFileSync(outPath, results.map(r => JSON.stringify(r)).join('\n') + '\n');
      console.log(`  Results saved: ${outPath}`);
      break;
    }
    case 'judge': {
      if (!opts.repo) { console.error('  --repo required for judging'); process.exit(1); }
      console.log('  Blind judging requires ANTHROPIC_API_KEY and is not yet automated.');
      console.log('  Use: node eval/agent-eval/judge-answers.js --repo=' + opts.repo);
      console.log('  Judge prompt template:');
      console.log(JUDGE_PROMPT.slice(0, 200) + '...');
      break;
    }
    case 'report': {
      if (!opts.repo) { console.error('  --repo required for report'); process.exit(1); }
      computeReport(opts.repo);
      break;
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
