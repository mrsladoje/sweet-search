// Blind A/B judge — runs as a third claude -p call (defaults to haiku, can be
// raised to sonnet/opus via --judge-model). The judge is given the task, the
// gold facts/files/symbols, and BOTH answers with their mode labels stripped
// and order randomised. It returns strict JSON with per-answer scores and a
// preference. We then de-randomise to attribute scores back to modes.
//
// Important: deterministic metrics in metrics.js are the primary signal.
// Judge scores are advisory; their main use is "who would a developer
// prefer?" and surfacing wrong-claim/missing-fact patterns the deterministic
// metrics can't catch.

import { runClaudeAgent, extractAnswerJson } from './claude-runner.js';

const JUDGE_SYSTEM = `\
You are an impartial code-review judge. Two answers (A and B) attempt to
answer the same code-understanding question about a real open-source
repository. You are given the task, the gold expectations (files, symbols,
key facts), and both answers verbatim. Score each answer independently and
then declare a preference.

Output STRICT JSON only — no prose before or after — in this exact shape:

{
  "answerA": {
    "correctness": 0,
    "completeness": 0,
    "evidence": 0,
    "hallucinationRisk": 0,
    "missingFacts": ["..."],
    "wrongClaims": ["..."]
  },
  "answerB": { "correctness": 0, "completeness": 0, "evidence": 0,
               "hallucinationRisk": 0, "missingFacts": [], "wrongClaims": [] },
  "preferred": "A",
  "preferenceReason": "..."
}

Score scale (each 0-5):
- correctness: do the cited files/symbols and the prose match the gold answer?
- completeness: does the answer cover the key facts?
- evidence: are the citations specific (file + line range) and well-founded?
- hallucinationRisk: 0=no risk, 5=clear hallucination of files/symbols/lines.

preferred: "A" | "B" | "tie".
`;

function shuffleAB(modeAnswers, rng) {
  // modeAnswers: { 'native-rg-read': {...}, 'sweet-search-tools': {...} }
  const modes = Object.keys(modeAnswers);
  // Random coin: A=modes[0] or A=modes[1]
  const flip = rng() < 0.5 ? 0 : 1;
  const A = modes[flip];
  const B = modes[1 - flip];
  return { A, B };
}

function fmtAnswer(answer) {
  if (!answer) return '(no answer)';
  if (answer._parseError) return `(unparseable answer: ${answer._parseError})\n${(answer._raw || '').slice(0, 1500)}`;
  return JSON.stringify({
    answer: answer.answer,
    files: answer.files,
    symbols: answer.symbols,
    confidence: answer.confidence,
    notes: answer.notes,
  }, null, 2);
}

/**
 * @param {Object} req
 * @param {Object} req.task
 * @param {{[mode]: Object}} req.modeAnswers - parsed answer per mode
 * @param {string} req.judgeModel - 'haiku' | 'sonnet' | 'opus' | full id
 * @param {()=>number} req.rng    - deterministic RNG
 * @param {string} req.cwd        - some safe cwd (eval root) — judge does no IO
 * @param {number} [req.timeoutMs=120000]
 * @returns {Promise<Object>}
 */
export async function judgePair(req) {
  const { task, modeAnswers, judgeModel, rng, cwd } = req;
  const { A, B } = shuffleAB(modeAnswers, rng);
  const prompt = [
    `# Task\n${task.question}`,
    `\n# Gold expectations`,
    `expectedFiles: ${JSON.stringify(task.expectedFiles || [])}`,
    `expectedSymbols: ${JSON.stringify(task.expectedSymbols || [])}`,
    `expectedFacts: ${JSON.stringify(task.expectedFacts || [])}`,
    task.expectedNoMatch ? `note: this task EXPECTS no real match — the right answer says the symbol does not exist.` : '',
    `\n# Answer A\n${fmtAnswer(modeAnswers[A])}`,
    `\n# Answer B\n${fmtAnswer(modeAnswers[B])}`,
    `\nReturn the strict JSON judgement.`,
  ].filter(Boolean).join('\n');

  const run = await runClaudeAgent({
    prompt,
    systemAppend: JUDGE_SYSTEM,
    model: judgeModel,
    cwd,
    allowedTools: [],            // judge needs no tools
    disallowedTools: ['Bash', 'Read', 'Edit', 'Write'],
    addDirs: [],
    timeoutMs: req.timeoutMs ?? 120000,
  });
  const judgement = extractAnswerJson(run.finalResultText || run.finalAssistantText);

  // De-randomise: convert "A"/"B" → real mode names.
  const labelToMode = { A, B };
  const preferredMode = judgement?.preferred && labelToMode[judgement.preferred]
    ? labelToMode[judgement.preferred]
    : (judgement?.preferred === 'tie' ? 'tie' : null);

  return {
    judgeModel,
    randomization: { A, B },
    judgement,
    preferredMode,
    rawAnswerCharsA: (modeAnswers[A]?.answer || '').length,
    rawAnswerCharsB: (modeAnswers[B]?.answer || '').length,
    runMeta: {
      wallMs: run.wallMs,
      exitCode: run.exitCode,
      isError: run.isError,
      usage: run.usage,
      totalCostUsd: run.totalCostUsd,
    },
  };
}
