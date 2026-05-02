// Deterministic metrics for the agent-in-the-loop benchmark.
//
// Inputs:
//   task: { expectedFiles, expectedSymbols, expectedFacts, expectedLineRanges, expectedNoMatch }
//   answer (parsed JSON from the agent):
//     { answer, files: [{path, lines: 'a-b'}], symbols, confidence, notes }
//
// We score:
//   fileRecall, filePrecision, falsePositiveFiles
//   symbolRecall (substring case-insensitive against full answer text)
//   factRecall   (substring/regex match against `answer` + `notes`)
//   lineOverlap  (fraction of expected gold lines covered by cited lines)
//   citedFileCount
//   approxAnswerTokens
//
// answerability (full | partial | failure):
//   - "full": fileRecall=1, factRecall>=0.8, no false positives flagged as wrong
//   - "partial": some recall but missing key parts
//   - "failure": fileRecall=0 AND factRecall<0.5
//   - no-match tasks invert: success means fileRecall is 1 (no files cited)
//                            AND factRecall hits the "no/not exist" hint.

function parseLineSpec(spec) {
  if (!spec) return null;
  const s = String(spec).trim();
  const m = s.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (m) return [+m[1], +m[2]];
  if (/^\d+$/.test(s)) return [+s, +s];
  return null;
}

function expandLineRanges(ranges) {
  const set = new Set();
  for (const [a, b] of ranges || []) {
    for (let i = a; i <= b; i++) set.add(i);
  }
  return set;
}

function answerHaystack(answer) {
  // The text we search for symbols/facts is the answer prose + notes + each
  // cited file's reason. We do NOT include cited file paths in the haystack
  // (those are handled separately as fileRecall).
  const parts = [];
  if (typeof answer?.answer === 'string') parts.push(answer.answer);
  if (typeof answer?.notes === 'string') parts.push(answer.notes);
  for (const f of answer?.files || []) {
    if (f && typeof f.reason === 'string') parts.push(f.reason);
  }
  return parts.join('\n').toLowerCase();
}

function citedFiles(answer) {
  const out = [];
  for (const f of answer?.files || []) {
    if (f && typeof f.path === 'string' && f.path.trim()) out.push(f.path.trim());
  }
  return out;
}

function citedSymbols(answer) {
  const haystack = answerHaystack(answer);
  const explicit = (answer?.symbols || []).map(String);
  return { explicit, haystack };
}

function citedLineRangesByFile(answer) {
  const out = {};
  for (const f of answer?.files || []) {
    if (!f?.path) continue;
    const range = parseLineSpec(f.lines);
    if (!range) continue;
    out[f.path] ||= [];
    out[f.path].push(range);
  }
  return out;
}

export function scoreAnswer(task, answer) {
  const expectedFiles = (task.expectedFiles || []).map(s => s.trim());
  const expectedSymbols = task.expectedSymbols || [];
  const expectedFacts = task.expectedFacts || [];
  const expectedLineRanges = task.expectedLineRanges || {};
  const isNoMatch = !!task.expectedNoMatch;

  const cited = citedFiles(answer);
  const citedLower = cited.map(s => s.toLowerCase());
  const expectedLower = expectedFiles.map(s => s.toLowerCase());
  const fileTP = expectedLower.filter(f => citedLower.some(c => c === f || c.endsWith('/' + f) || c.endsWith(f))).length;
  const fileRecall = expectedLower.length === 0 ? (isNoMatch ? (cited.length === 0 ? 1 : 0) : 1)
    : fileTP / expectedLower.length;
  const falsePositiveFiles = isNoMatch
    ? cited
    : cited.filter(c => !expectedLower.some(f => f === c.toLowerCase() || c.toLowerCase().endsWith('/' + f) || c.toLowerCase().endsWith(f)));
  const filePrecision = cited.length === 0 ? (expectedLower.length === 0 ? 1 : 0)
    : (cited.length - falsePositiveFiles.length) / cited.length;

  // Symbol recall: case-insensitive substring search over the answer haystack
  // OR explicit listing in answer.symbols.
  const haystack = answerHaystack(answer);
  const explicitSymbols = ((answer?.symbols || []).map(s => String(s).toLowerCase()));
  let symbolHit = 0;
  for (const sym of expectedSymbols) {
    const lc = String(sym).toLowerCase();
    if (haystack.includes(lc) || explicitSymbols.includes(lc)) symbolHit++;
  }
  const symbolRecall = expectedSymbols.length === 0 ? 1 : symbolHit / expectedSymbols.length;

  // Fact recall: each fact is a case-insensitive substring (or RegExp if it
  // looks like /.../). Counted as hit if found in the haystack OR in any
  // cited file path (e.g., "lib/server.js" fact matches the cited file).
  const fileLower = cited.map(s => s.toLowerCase()).join('\n');
  let factHit = 0;
  for (const fact of expectedFacts) {
    const f = String(fact);
    let hit = false;
    if (f.startsWith('/') && f.endsWith('/')) {
      try {
        const re = new RegExp(f.slice(1, -1), 'i');
        hit = re.test(haystack) || re.test(fileLower);
      } catch { hit = false; }
    } else {
      const lc = f.toLowerCase();
      hit = haystack.includes(lc) || fileLower.includes(lc);
    }
    if (hit) factHit++;
  }
  const factRecall = expectedFacts.length === 0 ? 1 : factHit / expectedFacts.length;

  // Line overlap: only meaningful when expected ranges exist for the cited file.
  const citedRanges = citedLineRangesByFile(answer);
  let goldLineTotal = 0, goldLineHit = 0;
  for (const [file, ranges] of Object.entries(expectedLineRanges)) {
    const goldSet = expandLineRanges(ranges);
    goldLineTotal += goldSet.size;
    const matchKey = Object.keys(citedRanges).find(k => k.toLowerCase() === file.toLowerCase()
      || k.toLowerCase().endsWith('/' + file.toLowerCase())
      || k.toLowerCase().endsWith(file.toLowerCase()));
    if (!matchKey) continue;
    const citedSet = expandLineRanges(citedRanges[matchKey]);
    for (const ln of goldSet) if (citedSet.has(ln)) goldLineHit++;
  }
  const lineOverlap = goldLineTotal === 0 ? null : goldLineHit / goldLineTotal;

  // Stricter answerability:
  //   `full` requires ALL of these (per the bench's quality bar):
  //     - fileRecall = 1
  //     - factRecall >= 0.8
  //     - if expectedSymbols present, symbolRecall >= 0.8
  //     - if expectedLineRanges present, lineOverlap >= 0.3
  //     - filePrecision >= 0.5 (no "answered with a wall of irrelevant files")
  //   For no-match tasks: full means the agent correctly cited nothing AND
  //   said the symbol does not exist (factRecall hits the "no/not exist" hint).
  const hasSymbolGold = expectedSymbols.length > 0;
  const hasLineGold = Object.keys(expectedLineRanges).length > 0;
  const evidenceSuccess = hasLineGold && lineOverlap !== null
    ? (lineOverlap >= 0.3)
    : null;
  const lowPrecisionEvidence = cited.length > 0 && filePrecision < 0.5;

  let answerability;
  if (isNoMatch) {
    answerability = (cited.length === 0 && factRecall >= 0.5) ? 'full'
      : (cited.length > 0 && factRecall < 0.5) ? 'failure' : 'partial';
  } else {
    const meetsFull =
      fileRecall >= 1 &&
      factRecall >= 0.8 &&
      (!hasSymbolGold || symbolRecall >= 0.8) &&
      (!hasLineGold || (lineOverlap !== null && lineOverlap >= 0.3)) &&
      !lowPrecisionEvidence;
    if (meetsFull) answerability = 'full';
    else if (fileRecall === 0 && factRecall < 0.5) answerability = 'failure';
    else answerability = 'partial';
  }

  // Reasons the answer was downgraded from full → useful for debugging
  // and for spotting "good answer with messy citations" cases.
  const downgradeReasons = [];
  if (!isNoMatch && answerability !== 'full') {
    if (fileRecall < 1) downgradeReasons.push('fileRecall<1');
    if (factRecall < 0.8) downgradeReasons.push('factRecall<0.8');
    if (hasSymbolGold && symbolRecall < 0.8) downgradeReasons.push('symbolRecall<0.8');
    if (hasLineGold && (lineOverlap === null || lineOverlap < 0.3)) downgradeReasons.push('lineOverlap<0.3');
    if (lowPrecisionEvidence) downgradeReasons.push('lowPrecisionEvidence');
  }

  const answerText = (answer?.answer || '') + (answer?.notes || '');
  return {
    fileRecall, filePrecision, falsePositiveFiles,
    symbolRecall, factRecall,
    lineOverlap,
    evidenceSuccess,
    lowPrecisionEvidence,
    goldLineTotal, goldLineHit,
    citedFileCount: cited.length,
    citedFiles: cited,
    answerChars: answerText.length,
    approxAnswerTokens: Math.ceil(answerText.length / 4),
    confidence: typeof answer?.confidence === 'number' ? answer.confidence : null,
    answerability,
    downgradeReasons,
  };
}
