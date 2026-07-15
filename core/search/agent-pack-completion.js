/**
 * Agent-only pack completion.
 *
 * This is a post-ranking presentation policy: it never changes retrieval
 * scores or asks the model to search again. A compact continuation or indexed
 * family manifest is paid for by removing a lower-ranked code body (or the
 * older same-file hint), so the configured and realized pack ceilings stay
 * unchanged.
 */

import path from 'node:path';
import { readFileRange } from './search-pattern-chunks.js';
import { containsToken, extractQueryEvidence, informativeSubtokens } from './query-sufficiency.js';

const MAX_BOUNDARY_GAP_LINES = 12;
const MAX_IMMEDIATE_GAP_LINES = 3;
const MAX_REFERENCED_SIBLING_GAP_LINES = 160;
const MAX_FAMILY_SEEDS = 24;
const MAX_FAMILY_STEMS = 3;
const MAX_FAMILY_CANDIDATES = 64;
const BODY_REFERENCE_GENERIC_TOKENS = new Set(['get', 'set', 'has', 'can', 'could', 'should', 'needed', 'result', 'value', 'data', 'info']);
const IDENTIFIER_RE = /\b[A-Za-z_$][A-Za-z0-9_$]{2,79}\b/g;
const TRUNCATION_MARKER_RE = /^\s*\/\/ \.\.\. \(\d+ (?:more lines|lines elided)\)(?: \.\.\.)?\s*$/;

function defaultEstimateTokens(text) {
  return text ? Math.ceil(text.length / 3.5) : 0;
}

function normalizedLines(text) {
  if (typeof text !== 'string' || !text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Return the last contiguous source coordinate actually rendered. */
export function shownSourceEndLine(startLine, code, truncated = false) {
  if (!Number.isInteger(startLine) || startLine < 1) return null;
  const lines = normalizedLines(code);
  if (lines.length === 0) return startLine - 1;
  const marker = truncated ? lines.findIndex((line) => TRUNCATION_MARKER_RE.test(line)) : -1;
  const sourceLineCount = marker >= 0 ? marker : lines.length;
  return startLine + Math.max(0, sourceLineCount - 1);
}

function identifierParts(name) {
  return String(name || '').match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|[A-Z]+|\d+/g) || [];
}

function familyStem(name) {
  const alpha = identifierParts(name).filter((part) => /^[A-Za-z]{3,}$/.test(part));
  if (alpha.length === 0) return null;
  alpha.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return alpha[0].toLowerCase();
}

function groupSortKey(group) {
  const width = Number(group.prefix.match(/\d+/)?.[0] || 0);
  const alpha = group.prefix.replace(/\d+/g, '').toLowerCase();
  return { width, alpha, prefix: group.prefix.toLowerCase() };
}

function compareNumericLabels(a, b) {
  const normalizedA = a.replace(/^0+(?=\d)/, '');
  const normalizedB = b.replace(/^0+(?=\d)/, '');
  return normalizedA.length - normalizedB.length
    || normalizedA.localeCompare(normalizedB)
    || a.length - b.length
    || a.localeCompare(b);
}

/**
 * Compact exact indexed names by their final numeric slot. No Cartesian
 * products are generated: every rendered member came from `candidates`.
 */
export function buildIndexedFamilyManifest(candidates, { seedNames = [] } = {}) {
  if (!Array.isArray(candidates) || candidates.length < 2) return null;
  const seedStems = new Set(seedNames.map(familyStem).filter(Boolean));
  const byName = new Map();
  for (const candidate of candidates) {
    const name = candidate?.name;
    if (typeof name !== 'string' || !/[A-Za-z]/.test(name) || !/\d/.test(name)) continue;
    const stem = familyStem(name);
    if (!stem || (seedStems.size > 0 && !seedStems.has(stem))) continue;
    if (!byName.has(name)) byName.set(name, candidate);
  }

  const groups = new Map();
  for (const [name, candidate] of byName) {
    const match = name.match(/^(.*?)(\d+)([^\d]*)$/);
    if (!match) continue;
    const [, prefix, numeric, suffix] = match;
    if (!prefix || !/[A-Za-z]/.test(prefix)) continue;
    const key = `${prefix}\u0000${suffix}`;
    if (!groups.has(key)) groups.set(key, { prefix, suffix, values: new Map() });
    groups.get(key).values.set(numeric, { candidate, numeric });
  }

  const compact = [...groups.values()]
    .filter((group) => group.values.size >= 2)
    .sort((a, b) => {
      const ka = groupSortKey(a);
      const kb = groupSortKey(b);
      return ka.width - kb.width || ka.alpha.localeCompare(kb.alpha)
        || ka.prefix.localeCompare(kb.prefix);
    });
  if (compact.length === 0) return null;

  const labels = [];
  const members = [];
  for (const group of compact) {
    const values = [...group.values.keys()].sort(compareNumericLabels);
    labels.push(`${group.prefix}{${values.join(',')}}${group.suffix}`);
    for (const value of values) members.push(group.values.get(value).candidate);
  }
  const rendered = `# indexed family: ${labels.join(' · ')}`;
  return {
    rendered,
    tokens: defaultEstimateTokens(rendered),
    groups: labels,
    members,
  };
}

function overlapsShown(candidate, results) {
  return results.some((result) => {
    if (!result?.code || result.file !== candidate.file) return false;
    const start = result.shownStartLine ?? result.startLine;
    const end = result.shownEndLine ?? result.endLine;
    return Number.isFinite(start) && Number.isFinite(end)
      && candidate.startLine <= end && candidate.endLine >= start;
  });
}

function boundaryScore(entity, queryEvidence, parentClass, gap, allowImmediate = false) {
  const name = String(entity?.name || '');
  if (!name) return 0;
  let exact = 0;
  for (const anchor of queryEvidence.anchors) {
    const caseSensitive = /[A-Z]/.test(anchor);
    if (containsToken(name, anchor, { caseSensitive })) exact = Math.max(exact, 100);
    else if (name.toLowerCase().includes(anchor.toLowerCase())) exact = Math.max(exact, 60);
  }
  const nameTokens = informativeSubtokens(name);
  let matched = 0;
  for (const token of queryEvidence.subtokens) if (nameTokens.has(token)) matched++;
  if (exact === 0 && matched === 0) {
    // The top-ranked result already establishes query relevance. Do not let a
    // budget cutoff land immediately before its next complete sibling merely
    // because the model phrased the behavior rather than the sibling's name.
    return allowImmediate && gap <= MAX_IMMEDIATE_GAP_LINES
      ? MAX_IMMEDIATE_GAP_LINES - gap + 1 : 0;
  }
  const sameParent = parentClass && entity.parentClass === parentClass ? 5 : 0;
  return exact + matched * 10 + sameParent + (MAX_BOUNDARY_GAP_LINES - gap) / 100;
}

function bodySiblingScore(entity, code) {
  const candidateTokens = [...informativeSubtokens(entity?.name)]
    .filter((token) => !BODY_REFERENCE_GENERIC_TOKENS.has(token));
  if (candidateTokens.length < 2 || !code) return 0;
  let inspected = 0;
  for (const [identifier] of String(code).matchAll(IDENTIFIER_RE)) {
    if (++inspected > 256) break;
    const referenceTokens = informativeSubtokens(identifier);
    let overlap = 0;
    for (const token of candidateTokens) if (referenceTokens.has(token)) overlap++;
    if (overlap >= 2) return 40 + overlap * 10;
  }
  return 0;
}

function findBoundaryContinuation(results, query, regex, codeGraphRepo) {
  if (!codeGraphRepo || typeof codeGraphRepo.findAdjacentEntities !== 'function') return null;
  const evidence = extractQueryEvidence(query, regex);
  if (evidence.anchors.length === 0 && evidence.subtokens.size === 0) return null;

  for (const result of results) {
    if (!result?.code || result.presentation !== 'full'
        || !Number.isInteger(result.shownStartLine)
        || !Number.isInteger(result.shownEndLine)) continue;
    let adjacent;
    try {
      adjacent = codeGraphRepo.findAdjacentEntities(
        result.file,
        result.shownStartLine,
        result.shownEndLine,
        { perSide: 8 },
      );
    } catch {
      continue;
    }
    let parentClass = result.parentClass || null;
    if (!parentClass && result.entityId && typeof codeGraphRepo.getEntityById === 'function') {
      try { parentClass = codeGraphRepo.getEntityById(result.entityId)?.parentClass || null; }
      catch { parentClass = null; }
    }
    const candidates = (adjacent?.below || []).flatMap((entity) => {
      const gap = entity.startLine - result.shownEndLine;
      if (!Number.isInteger(entity.startLine) || !Number.isInteger(entity.endLine)
          || gap < 1 || gap > (result.rank === 1
            ? MAX_REFERENCED_SIBLING_GAP_LINES : MAX_BOUNDARY_GAP_LINES)) return [];
      const candidate = { ...entity, file: result.file };
      if (overlapsShown(candidate, results)) return [];
      const namedScore = gap <= MAX_BOUNDARY_GAP_LINES
        ? boundaryScore(entity, evidence, parentClass, gap, result.rank === 1) : 0;
      const referencedScore = result.rank === 1 ? bodySiblingScore(entity, result.code) : 0;
      const score = Math.max(namedScore, referencedScore);
      return score > 0 ? [{ trigger: result, entity, score, gap }] : [];
    }).sort((a, b) => b.score - a.score || a.gap - b.gap || a.entity.startLine - b.entity.startLine);
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

function identifierMatchesQuery(name, evidence) {
  for (const anchor of evidence.anchors) {
    const caseSensitive = /[A-Z]/.test(anchor);
    if (containsToken(name, anchor, { caseSensitive })
        || name.toLowerCase().includes(anchor.toLowerCase())) return true;
  }
  const nameTokens = informativeSubtokens(name);
  for (const token of evidence.subtokens) if (nameTokens.has(token)) return true;
  return false;
}

function extractSeedNames(results, query, regex) {
  const out = [];
  const seen = new Set();
  const evidence = extractQueryEvidence(query, regex);
  const push = (name) => {
    if (out.length >= MAX_FAMILY_SEEDS || typeof name !== 'string'
        || !/[A-Za-z]/.test(name) || !/\d/.test(name) || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  for (const result of results) {
    // A selected summary row is still indexed evidence. Generated-family
    // searches often return the template/output map with code while concrete
    // members (IVec2/UVec2, etc.) survive only as lower summary symbols.
    push(result?.symbol);
    if (result?.code) {
      for (const name of result.code.match(IDENTIFIER_RE) || []) {
        if (identifierMatchesQuery(name, evidence)) push(name);
      }
    }
    if (out.length >= MAX_FAMILY_SEEDS) break;
  }
  return out;
}

function commonDirectory(filePaths) {
  const dirs = filePaths
    .filter((file) => typeof file === 'string' && file.length > 0)
    .map((file) => path.posix.dirname(file.replace(/\\/g, '/')));
  if (dirs.length === 0) return null;
  const parts = dirs.map((dir) => dir.split('/').filter(Boolean));
  const common = [];
  for (let i = 0; i < Math.min(...parts.map((entry) => entry.length)); i++) {
    if (!parts.every((entry) => entry[i] === parts[0][i])) break;
    common.push(parts[0][i]);
  }
  let prefix = common.join('/');
  if (!prefix || prefix === '.') return null;
  if (new Set(dirs).size === 1 && /\d/.test(path.posix.basename(prefix))) {
    const parent = path.posix.dirname(prefix);
    if (parent && parent !== '.') prefix = parent;
  }
  return prefix;
}

function findIndexedFamily(indexedSeeds, codeGraphRepo) {
  const stems = [...new Set(indexedSeeds.map((seed) => familyStem(seed.name)).filter(Boolean))]
    .slice(0, MAX_FAMILY_STEMS);
  let best = null;
  for (const stem of stems) {
    const seeds = indexedSeeds.filter((seed) => familyStem(seed.name) === stem);
    const filePrefix = commonDirectory(seeds.map((seed) => seed.filePath));
    if (!filePrefix) continue;
    const types = [...new Set(seeds.map((seed) => seed.type).filter(Boolean))];
    let candidates;
    try {
      candidates = codeGraphRepo.findFamilyCandidates(stem, {
        filePrefix, types, limit: MAX_FAMILY_CANDIDATES,
      });
    } catch {
      continue;
    }
    const manifest = buildIndexedFamilyManifest(candidates, {
      seedNames: seeds.map((seed) => seed.name),
    });
    if (manifest && (!best || manifest.members.length > best.manifest.members.length)) {
      best = { manifest, seeds };
    }
  }
  return best;
}

/** Build grep family closure only from symbols indexed at exact match lines. */
export function buildIndexedGrepFamilyManifest(results, codeGraphRepo) {
  if (!Array.isArray(results) || results.length < 2
      || typeof codeGraphRepo?.findEntitiesInRange !== 'function'
      || typeof codeGraphRepo?.findFamilyCandidates !== 'function') return null;
  const seeds = [];
  const seen = new Set();
  for (const result of results.slice(0, MAX_FAMILY_SEEDS)) {
    let entities = [];
    try { entities = codeGraphRepo.findEntitiesInRange(result.file, result.line, result.line) || []; }
    catch { entities = []; }
    if (entities.length === 0 && typeof codeGraphRepo.findEnclosingEntity === 'function') {
      try { entities = [codeGraphRepo.findEnclosingEntity(result.file, result.line, result.line)].filter(Boolean); }
      catch { entities = []; }
    }
    for (const entity of entities) {
      if (typeof entity?.name !== 'string' || !/\d/.test(entity.name) || seen.has(entity.name)) continue;
      seen.add(entity.name);
      seeds.push({ ...entity, filePath: result.file });
    }
  }
  if (seeds.length < 2) return null;
  return findIndexedFamily(seeds, codeGraphRepo)?.manifest || null;
}

function discoverFamily(results, codeGraphRepo, query, regex) {
  if (!codeGraphRepo
      || typeof codeGraphRepo.findEntitiesByAnyName !== 'function'
      || typeof codeGraphRepo.findFamilyCandidates !== 'function') return null;
  const seedNames = extractSeedNames(results, query, regex);
  if (seedNames.length === 0) return null;
  let indexedSeeds;
  try {
    indexedSeeds = codeGraphRepo.findEntitiesByAnyName(seedNames, {
      limit: MAX_FAMILY_SEEDS * 2,
    });
  } catch {
    return null;
  }
  if (!Array.isArray(indexedSeeds) || indexedSeeds.length === 0) return null;
  const family = findIndexedFamily(indexedSeeds, codeGraphRepo);
  if (!family) return null;
  const owner = results.find((result) => result?.code && (
    family.manifest.members.some((member) => member.name === result.symbol)
    || family.seeds.some((seed) => result.code.includes(seed.name))
  )) || results.find((result) => result?.code);
  return owner ? { manifest: family.manifest, owner } : null;
}

function summaryFor(result) {
  const symbol = result.symbol || 'code block';
  const type = result.symbolType ? ` (${result.symbolType})` : '';
  return `${result.file}:${result.startLine} — ${symbol}${type}`;
}

function demoteDonor(result) {
  result.summary ||= summaryFor(result);
  result.presentation = 'summary';
  result.code = null;
  result.codeTokens = 0;
  result.expanded = false;
  delete result.shownStartLine;
  delete result.shownEndLine;
  delete result.boundaryTruncated;
}

function completeContinuation(boundary, fileCache, projectRoot, estimateTokens) {
  if (!boundary) return null;
  const { trigger, entity } = boundary;
  const header = `# continues at ${trigger.file}:${entity.startLine} ${entity.name}`;
  const code = readFileRange(fileCache, trigger.file, entity.startLine, entity.endLine, projectRoot);
  const expectedLines = entity.endLine - entity.startLine + 1;
  if (code && normalizedLines(code).length === expectedLines) {
    return {
      kind: 'symbol',
      file: trigger.file,
      startLine: entity.startLine,
      endLine: entity.endLine,
      symbol: entity.name,
      symbolType: entity.type || null,
      code,
      rendered: header,
      tokens: estimateTokens(`${header}\n${code}`),
    };
  }
  return null;
}

function trailerContinuation(boundary, estimateTokens) {
  if (!boundary) return null;
  const { trigger, entity } = boundary;
  const rendered = `# continues at ${trigger.file}:${entity.startLine} ${entity.name}`;
  return {
    kind: 'trailer',
    file: trigger.file,
    startLine: entity.startLine,
    endLine: entity.endLine,
    symbol: entity.name,
    symbolType: entity.type || null,
    code: null,
    rendered,
    tokens: estimateTokens(rendered),
  };
}

/** Apply token-neutral completion in place and return updated accounting. */
export function applyAgentPackCompletion({
  results,
  query,
  regex,
  codeGraphRepo,
  fileCache,
  projectRoot,
  tokensUsed,
  tokenBudget,
  estimateTokens = defaultEstimateTokens,
  isAgentFormat = false,
}) {
  if (isAgentFormat !== true || !Array.isArray(results) || results.length === 0) {
    return { tokensUsed, changed: false };
  }
  const originalTokens = Math.max(0, Number(tokensUsed) || 0);
  const boundary = findBoundaryContinuation(results, query, regex, codeGraphRepo);
  const family = discoverFamily(results, codeGraphRepo, query, regex);
  if (!boundary && !family) return { tokensUsed: originalTokens, changed: false };

  // Reallocate only a lower-ranked tail. The top result and the rows that own
  // the new evidence must remain code-bearing; otherwise a family-only pack
  // can demote its sole useful hit and attach an invisible manifest to a
  // summary row.
  const donor = results.slice(1).reverse().find((result) => (
    result !== boundary?.trigger
    && result !== family?.owner
    && result?.code
    && Number(result.codeTokens) > 0
  ));
  const donorTokens = donor ? Number(donor.codeTokens) : 0;
  const mapTokens = boundary?.trigger?.sameFile?.tokens || 0;
  let available = donorTokens + mapTokens;
  if (available <= 0) return { tokensUsed: originalTokens, changed: false };

  let spent = 0;
  let continuation = null;
  if (boundary) {
    const complete = completeContinuation(boundary, fileCache, projectRoot, estimateTokens);
    const trailer = trailerContinuation(boundary, estimateTokens);
    if (complete && complete.tokens <= available) continuation = complete;
    else if (trailer.tokens <= available) continuation = trailer;
    if (continuation) {
      spent += continuation.tokens;
      available -= continuation.tokens;
    } else {
      // The old same-file line cannot fund another feature unless it is
      // actually replaced by a continuation.
      available = donorTokens;
    }
  }

  let familyManifest = null;
  if (family) {
    const familyTokens = estimateTokens(family.manifest.rendered);
    if (familyTokens <= available) {
      familyManifest = { ...family.manifest, tokens: familyTokens };
      spent += familyTokens;
      available -= familyTokens;
    }
  }
  if (!continuation && !familyManifest) {
    return { tokensUsed: originalTokens, changed: false };
  }

  const reclaimMap = !!continuation && mapTokens > 0;
  const mapReclaimed = reclaimMap ? mapTokens : 0;
  const needsDonor = spent > mapReclaimed;
  if (needsDonor && !donor) return { tokensUsed: originalTokens, changed: false };

  const reclaimed = mapReclaimed + (needsDonor ? donorTokens : 0);
  const nextTokens = Math.max(0, originalTokens - reclaimed + spent);
  const numericBudget = Number(tokenBudget);
  const effectiveBudget = Number.isFinite(numericBudget) && numericBudget >= 0
    ? numericBudget : originalTokens;
  if (nextTokens > originalTokens || nextTokens > effectiveBudget) {
    return { tokensUsed: originalTokens, changed: false };
  }

  if (reclaimMap) delete boundary.trigger.sameFile;
  if (needsDonor) demoteDonor(donor);
  if (continuation) boundary.trigger.continuation = continuation;
  if (familyManifest) family.owner.familyManifest = familyManifest;

  return {
    tokensUsed: nextTokens,
    changed: true,
  };
}
