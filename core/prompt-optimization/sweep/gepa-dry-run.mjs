import { hashContent } from './p7-shared.mjs';

/** Deterministic stub agent evaluator - score is a hash of (prompt,probe,target). */
export function makeDryRunEvaluate() {
  return async ({ promptText, probe, target }) => {
    const h = hashContent(`${promptText}|${probe.id}|${target}`);
    const s = Number.parseInt(h.slice(2, 10), 16) / 0xffffffff;
    const calls = 1 + Math.floor(s * 4);
    return {
      score: s,
      toolCalls: calls,
      finalAnswerEmitted: true,
      usedReadOrGrep: s > 0.2,
      usedSweetSearch: s > 0.2,
      usedNativeSearch: false,
      usedNativeRead: false,
      trajectory: { toolCalls: Array.from({ length: calls }, () => ({ name: 'ss-search' })), answer: `ans-${probe.id}-${target}` },
      wallMs: 1,
    };
  };
}

/** Deterministic stub model - echoes the fenced candidate body. */
export function makeDryRunCallModel() {
  return async ({ userPrompt }) => {
    const m = userPrompt.match(/```\n([\s\S]*?)\n```/);
    return { text: m ? m[1] : userPrompt, isError: false };
  };
}
