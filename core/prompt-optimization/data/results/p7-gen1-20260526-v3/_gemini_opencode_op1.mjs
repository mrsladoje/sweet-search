#!/usr/bin/env node
/**
 * Opencode harness experiment: run OP-1 reflective via opencode with
 * google/gemini-3.1-pro-preview, giving Gemini access to opencode's built-in
 * file/grep/bash tools so it can investigate the run state more deeply than
 * the single-shot direct API allows.
 *
 * Direct-API run produced ACCEPTED with one focused length-discipline edit.
 * The harness should be evaluated by ONE question: does Gemini make MEANINGFULLY
 * different (better, more theoretically grounded, or more surgical) edits when
 * it can read probes/traces/scores on its own?
 *
 * Output: gemini-opencode-experiment/op1-opencode.{stdout,stderr,parsed,validation}.{txt,json}
 *
 * NOT integrated, NOT committed. Scratch comparison artifact.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReflectivePrompt } from '../../../sweep/gepa-mutate.mjs';
import { validateMutation } from '../../../sweep/token-validator.mjs';
import { topFailures } from '../../../sweep/gepa-scoring.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = __dirname;
const OUT_DIR = resolve(RUN_DIR, 'gemini-opencode-experiment');
mkdirSync(OUT_DIR, { recursive: true });

const PROBES_FILE = resolve(RUN_DIR, '../../p7-dev-probes.json');
const REPO_ROOT = resolve(RUN_DIR, '../../../../..');
const MODEL = 'google/gemini-3.1-pro-preview';

// ─── load round-5 end state ─────────────────────────────────────────────────
const pc = JSON.parse(readFileSync(resolve(RUN_DIR, 'pareto-current.json'), 'utf8'));
const bankLines = readFileSync(resolve(RUN_DIR, 'prompt-bank.jsonl'), 'utf8').trim().split('\n');
const promptByHash = Object.fromEntries(
  bankLines.map((l) => JSON.parse(l)).filter((r) => r._kind === 'prompt').map((r) => [r.hash, r.text]),
);
const probesDoc = JSON.parse(readFileSync(PROBES_FILE, 'utf8'));
const probeMap = new Map(probesDoc.probes.map((p) => [p.id, p]));

const JOINT_BEST_HASH = '0xe9c1421a31a50f5a';
const jointBest = pc.front.find((m) => m.hash === JOINT_BEST_HASH);
const candidatePrompt = promptByHash[JOINT_BEST_HASH];
if (!candidatePrompt) throw new Error('joint_best prompt missing from bank');

// ─── build OP-1 reflective inputs (matching production exactly) ─────────────
let failures = topFailures({ candidate: jointBest, probes: probesDoc.probes, limit: 5 });
if (failures.length === 0) {
  const sorted = Object.entries(jointBest.scores)
    .map(([pid, s]) => ({ pid, s }))
    .sort((a, b) => a.s - b.s)
    .slice(0, 5);
  for (const { pid } of sorted) {
    const p = probeMap.get(pid);
    const d = jointBest.detail?.[pid];
    const worse = d ? (d.sonnet.score <= d.gpt5_5.score ? 'sonnet' : 'gpt5_5') : 'sonnet';
    const traj = d?.[worse]?.traj || { toolCalls: [], answer: '' };
    failures.push({
      probeId: pid, stratum: p?.stratum, repo: p?.repo, query: p?.query,
      jointScore: jointBest.scores[pid], target: worse,
      toolCalls: traj.toolCalls, answer: traj.answer,
      expectedFiles: p?.expectedFiles ?? [],
    });
  }
}
const reflective = buildReflectivePrompt({ candidate: candidatePrompt, failures });

// ─── augment with harness-aware clauses ─────────────────────────────────────
const HARNESS_CLAUSE =
  '\n\n## HARNESS AVAILABLE — investigate before deciding\n' +
  'You are running inside the opencode CLI harness. You have direct access to the project filesystem via your built-in tools (Read, Grep, Bash). The repo root is ' + REPO_ROOT + '.\n' +
  'Files you may find useful:\n' +
  '  - core/prompt-optimization/data/p7-dev-probes.json (all 40 dev probe definitions with expected facts)\n' +
  '  - core/prompt-optimization/data/results/p7-gen1-20260526-v3/gepa-trajectory.jsonl (full event stream incl. seeds + screens + confirms)\n' +
  '  - core/prompt-optimization/data/results/p7-gen1-20260526-v3/pareto-current.json (current Pareto front with per-probe scores + trajectories)\n' +
  '  - core/prompt-optimization/data/p7-native-baseline-dev-3panel.json (native search baseline scores per probe)\n' +
  '  - core/prompt-optimization/sweep/gepa-scoring.mjs (the scoring formula — see how finalScore is computed)\n' +
  '\nUse the harness to:\n' +
  '  1. Inspect probes outside the 5 failures shown above if you suspect a broader pattern\n' +
  '  2. Compare the candidate prompt against the OTHER Pareto front members (T2-r1-reflective, +r3-reflective, +r4-persona-pivot) to see what they do differently\n' +
  '  3. Read the scoring formula to understand WHY the candidate is losing finalScore (length penalty? EAS? native-relative?)\n' +
  '  4. Look at the FULL trajectory of a probe (not just the 5 summarized failures) to see what tool-calls the agent actually made\n' +
  '\nDO NOT modify files. READ-ONLY investigation only.\n' +
  '\nWhen you have gathered enough context, produce the rewritten prompt. Output the FINAL prompt as the LAST block of your response, wrapped in <REWRITTEN_PROMPT>...</REWRITTEN_PROMPT> tags so the harness can extract it cleanly. Everything before the tags is reasoning (free to be as long as you need).';

const ANTI_OVERFIT_CLAUSE =
  '\n\n## ANTI-OVERFITTING DISCIPLINE\n' +
  'The probes you can inspect are the DEV split (60% of the benchmark); a HELDOUT split of 40% has been set aside and will validate this prompt later. Do NOT tailor the prompt to specific probe IDs, individual query phrasings, or single-repo idioms. Edits should be GENERAL — improve the underlying reasoning or routing pattern, not the symptom on one query. If a proposed edit would only help one or two probes and could plausibly hurt unseen ones, reject it.';

const augmentedSystem = reflective.systemPrompt + ANTI_OVERFIT_CLAUSE + HARNESS_CLAUSE;

// ─── compose the single message for `opencode run` ──────────────────────────
const fullMessage = `[SYSTEM]\n${augmentedSystem}\n\n[USER]\n${reflective.userPrompt}`;

writeFileSync(`${OUT_DIR}/op1-opencode.system.txt`, augmentedSystem);
writeFileSync(`${OUT_DIR}/op1-opencode.user.txt`, reflective.userPrompt);
writeFileSync(`${OUT_DIR}/op1-opencode.fullmessage.txt`, fullMessage);

console.error(`Running opencode harness with ${MODEL}`);
console.error(`message size: ${fullMessage.length} chars`);
console.error(`cwd: ${REPO_ROOT}`);

// ─── spawn opencode ─────────────────────────────────────────────────────────
const t0 = Date.now();
const child = spawn('opencode', ['run', '--model', MODEL, '--format', 'json', '--print-logs', '--log-level', 'INFO', fullMessage], {
  cwd: REPO_ROOT,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d; });
child.stderr.on('data', (d) => {
  const s = d.toString();
  stderr += s;
  // Stream stderr live so we can see tool-use activity in real time
  process.stderr.write(s);
});

child.on('close', (code) => {
  const wallMs = Date.now() - t0;
  console.error(`\n─── opencode exited with code ${code} after ${(wallMs / 1000).toFixed(1)}s ───`);
  writeFileSync(`${OUT_DIR}/op1-opencode.stdout.txt`, stdout);
  writeFileSync(`${OUT_DIR}/op1-opencode.stderr.txt`, stderr);

  // ─── parse final assistant text ──
  let assistantText = '';
  try {
    const obj = JSON.parse(stdout);
    if (typeof obj.text === 'string') assistantText = obj.text;
    else if (typeof obj.response === 'string') assistantText = obj.response;
    else if (typeof obj.message === 'string') assistantText = obj.message;
    else if (Array.isArray(obj.messages) && obj.messages.length) {
      const last = obj.messages[obj.messages.length - 1];
      assistantText = typeof last.content === 'string' ? last.content : JSON.stringify(last);
    }
  } catch {
    // try JSONL
    for (const line of stdout.split('\n')) {
      const t = line.trim();
      if (!t || t[0] !== '{') continue;
      try {
        const ev = JSON.parse(t);
        if (ev.role === 'assistant' || ev.type === 'message') {
          if (typeof ev.content === 'string') assistantText = ev.content;
          else if (typeof ev.text === 'string') assistantText = ev.text;
        }
      } catch {}
    }
    if (!assistantText) assistantText = stdout;
  }
  writeFileSync(`${OUT_DIR}/op1-opencode.assistant.txt`, assistantText);

  // ─── extract the rewritten prompt block ──
  const m = assistantText.match(/<REWRITTEN_PROMPT>([\s\S]*?)<\/REWRITTEN_PROMPT>/);
  const mutated = m ? m[1].trim() : assistantText.trim();
  writeFileSync(`${OUT_DIR}/op1-opencode.mutated.txt`, mutated);

  const validation = validateMutation({ source: candidatePrompt, mutated, op: 'reflective' });
  writeFileSync(`${OUT_DIR}/op1-opencode.validation.json`, JSON.stringify({
    accepted: validation.ok,
    failures: validation.failures,
    extractedFromTags: !!m,
    mutated_chars: mutated.length,
    source_chars: candidatePrompt.length,
    delta_chars: mutated.length - candidatePrompt.length,
    wall_ms: wallMs,
    exitCode: code,
  }, null, 2));

  console.error(`\nvalidation: ${validation.ok ? 'ACCEPTED' : 'REJECTED'}`);
  if (!validation.ok) console.error(`  failures: ${JSON.stringify(validation.failures).slice(0, 400)}`);
  console.error(`mutated chars: ${mutated.length} (source ${candidatePrompt.length}, Δ ${mutated.length - candidatePrompt.length})`);
  console.error(`extractedFromTags: ${!!m}`);
  console.error(`\nAll artifacts in: ${OUT_DIR}`);

  // Sniff tool-use signals from stderr (opencode logs each tool call)
  const toolEvents = [...stderr.matchAll(/(tool|read|grep|bash|edit|write|list).*?(call|invoked|started|completed)/gi)];
  console.error(`stderr tool-use signals: ${toolEvents.length} matches`);
});
