function tokens(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) || [])];
}

function wantsImplementation(hintTokens) {
  if (hintTokens.includes('wrapper')) return false;
  return hintTokens.some(t => ['callee', 'callees', 'downstream', 'helper', 'helpers', 'conversion', 'implementation'].includes(t));
}

function delegatesSameName(candidate, code) {
  const name = String(candidate.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\.\\s*${name}\\s*\\(`).test(code);
}

function scoreCandidate(candidate, hintTokens, readFileRange) {
  if (!hintTokens.length) return 0;
  const code = readFileRange(candidate.filePath, candidate.startLine, candidate.endLine) || '';
  const hay = `${candidate.name} ${candidate.type} ${candidate.filePath} ${candidate.signature} ${candidate.summary} ${code}`.toLowerCase();
  let hits = 0;
  for (const tok of hintTokens) if (hay.includes(tok)) hits++;
  let score = hits / hintTokens.length;
  if (wantsImplementation(hintTokens) && delegatesSameName(candidate, code)) score -= 0.35;
  return score;
}

export function rankStructuralCandidates(candidates, { queryHint, readFileRange }) {
  const hintTokens = tokens(queryHint);
  if (!hintTokens.length || candidates.length < 2) return candidates;
  return candidates.map((candidate, index) => ({
    candidate,
    index,
    score: scoreCandidate(candidate, hintTokens, readFileRange),
  })).sort((a, b) => (b.score - a.score) || (a.index - b.index)).map(x => x.candidate);
}
