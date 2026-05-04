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
repository. You are given the task, the GOLD expectations (the only set of
files/symbols/facts that count), and both answers verbatim. Score each
answer strictly against the gold; do not import outside knowledge of the
project to second-guess the answers.

GROUND RULES (apply these — they override any prior bias you have):

1. Score against GOLD ONLY.
   - "correctness" measures match against gold files + gold symbols + gold
     facts. Do not penalise an answer for omitting *non-gold* details.
   - "completeness" measures coverage of the gold facts. Citing more
     non-gold files is NOT a positive — it is at best neutral.
   - Do NOT require an answer to include extra files/symbols beyond gold.
     If gold lists one file and the answer cites that file correctly with
     the right symbol and the gold facts, that is full completeness even
     if the answer is short.

2. Specific line numbers are GOOD, not bad.
   - Both worker conditions read source code and quote line ranges from
     what they actually saw. If line numbers are inside the gold range
     for the cited file, treat that as evidence, not hallucination.
   - Mark line ranges as hallucinated ONLY if they are obviously
     impossible (e.g. negative, beyond a tiny file) or contradict another
     part of the same answer.
   - Do not flag a line range as hallucinated merely because you, the
     judge, do not have the file content. If the cited file matches gold
     and the lines are plausibly inside the gold range, it is evidence.

3. Hallucination = INVENTED content.
   - hallucinationRisk should reflect: cites a file/symbol that is not the
     gold file/symbol when gold is specific, OR makes a factual claim
     about behaviour that contradicts gold facts. It should NOT be raised
     for legitimate detail (e.g. naming a private symbol the gold list
     doesn't enumerate but which clearly exists in the cited region).

4. Tie-break logic:
   - If both answers cover all gold facts and cite gold files correctly,
     prefer the answer with FEWER unverifiable extra claims (lower
     hallucinationRisk) and clearer evidence; do not prefer the longer
     answer just because it is longer.
   - "tie" is allowed and SHOULD be used when both answers are
     substantively equivalent on gold.

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
- correctness: do the cited GOLD files/symbols and the prose match the gold answer?
- completeness: does the answer cover the GOLD key facts? (Extra non-gold detail does not raise this.)
- evidence: are the citations specific (file + line range, where applicable) and consistent with the answer's own claims?
- hallucinationRisk: 0=no invented content, 5=clear hallucination of files/symbols/behaviour. Do NOT raise for specific line ranges that fall inside the gold file/range.

"missingFacts" must be facts from the GOLD list that the answer omitted.
"wrongClaims" must be statements that contradict gold or are internally
inconsistent within the answer. Do not list missing non-gold detail.

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
    `\n# Gold expectations (THE ONLY SET THAT COUNTS — do not invent extras)`,
    `expectedFiles: ${JSON.stringify(task.expectedFiles || [])}`,
    `expectedSymbols: ${JSON.stringify(task.expectedSymbols || [])}`,
    `expectedFacts: ${JSON.stringify(task.expectedFacts || [])}`,
    `expectedLineRanges: ${JSON.stringify(task.expectedLineRanges || {})}`,
    task.expectedNoMatch ? `note: this task EXPECTS no real match — the right answer says the symbol does not exist.` : '',
    `\nIMPORTANT JUDGE GUIDANCE:`,
    `- Cited line ranges that fall inside an expectedLineRange (or close to it)`,
    `  are EVIDENCE, not hallucination. The workers actually read these lines.`,
    `- Citing only the gold file with the right symbol and the gold facts is`,
    `  FULL completeness. Do not require extra non-gold files.`,
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
