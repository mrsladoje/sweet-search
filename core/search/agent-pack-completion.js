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

// ---------------------------------------------------------------------------
// Singleton-grep sibling line (2026-09-03, smoke-loss forensics L1a).
//
// A 1-match ss-grep took NO enrichment path: the family manifest needs >=2
// results and digit-bearing names, the "across N files" header needs >1 file,
// and the same-file span map lives in packageForAgent, which grep never
// enters. squashql-295: the hit sat in checkSubQuery; the fix also needed the
// field subQueryMeasures (declared L35, assigned L55, read in toSubQuery L207)
// and nothing named it. Native saw all three lines in one wide grep in 20/21
// rollouts; sweet in 3/21. In the transcripts, three sites co-listed WITH
// their code lines converted 4/4; a bare name list converted 0/2. So this
// prints code lines, not names, and is additive (a singleton has no body
// lines to reclaim). Gate: agent format, no --in, 1-3 hits in ONE file, and
// the client-side SS_SIBLING_LINE=0 off-switch (option `_siblingLine`).
// ---------------------------------------------------------------------------

const MAX_SIBLING_SITES = 4;
const MAX_SIBLING_HITS = 3;
const PACK_SIBLING_TYPES = new Set(['method', 'function', 'constructor']);
const MAX_SIBLING_ENTITIES = 3;
const SIBLING_LINE_MAX_CHARS = 90;
const STATE_ENTITY_TYPES = new Set(['field', 'property', 'variable', 'constant', 'const', 'static', 'enum_constant']);

function siblingTokens(name) {
  return [...informativeSubtokens(name)].filter((token) => !BODY_REFERENCE_GENERIC_TOKENS.has(token));
}

function compactSourceLine(text) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > SIBLING_LINE_MAX_CHARS ? `${oneLine.slice(0, SIBLING_LINE_MAX_CHARS - 1)}…` : oneLine;
}

/** First line assigning `name` outside the enclosing entity and the declaration. */
function findAssignmentLine(lines, name, { declarationLine, excludeRanges = [] }) {
  const re = new RegExp(`(?:^|[^A-Za-z0-9_$.])(?:this\\.|self\\.|@)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=[^=]`);
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    if (line === declarationLine || excludeRanges.some(([start, end]) => line >= start && line <= end)) continue;
    if (re.test(lines[i])) return line;
  }
  return null;
}

/**
 * Same-file identifier family for one to three hits in ONE file: declarations
 * sharing the enclosing symbols' informative subtokens, plus state (fields)
 * their bodies reference. `hits` are `{ file, line }`. Returns
 * { rendered, tokens, enclosing, sites } or null.
 */
export function buildSameFileSiblingLine(hits, codeGraphRepo, {
  regex = '', projectRoot, fileCache = new Map(), estimateTokens = defaultEstimateTokens,
} = {}) {
  // No env gate HERE: this runs inside the warm daemon, whose env is whatever
  // the first client that spawned it happened to carry. SS_SIBLING_LINE=0 is
  // read by the ss-grep wrapper and travels as the `_siblingLine` option.
  if (!Array.isArray(hits) || hits.length < 1 || hits.length > MAX_SIBLING_HITS) return null;
  if (typeof codeGraphRepo?.findEnclosingEntity !== 'function'
      || typeof codeGraphRepo?.findEntitiesInFile !== 'function') return null;
  const file = hits[0]?.file;
  if (!file || hits.some((hit) => hit?.file !== file || !Number.isInteger(hit.line))) return null;

  const enclosings = [];
  const seenEnclosing = new Set();
  for (const hit of hits) {
    let enclosing = null;
    try { enclosing = codeGraphRepo.findEnclosingEntity(file, hit.line, hit.line); } catch { enclosing = null; }
    if (!enclosing?.name || !Number.isInteger(enclosing.startLine) || !Number.isInteger(enclosing.endLine)) continue;
    const key = `${enclosing.name}:${enclosing.startLine}`;
    if (seenEnclosing.has(key)) continue;
    seenEnclosing.add(key);
    enclosings.push(enclosing);
  }
  if (enclosings.length === 0) return null;
  let entities = [];
  try { entities = codeGraphRepo.findEntitiesInFile(file) || []; } catch { entities = []; }
  if (entities.length === 0) return null;

  const evidence = extractQueryEvidence('', regex);
  const ownTokens = new Set(enclosings.flatMap((entity) => siblingTokens(entity.name)));
  const fileText = readFileRange(fileCache, file, 1, 1_000_000, projectRoot);
  const lines = fileText ? fileText.split('\n') : [];
  const body = enclosings.map((entity) => lines.slice(entity.startLine - 1, entity.endLine).join('\n')).join('\n');
  const hitLines = hits.map((hit) => hit.line);
  const isEnclosingOrKin = (entity) => enclosings.some((own) =>
    (entity.id != null && entity.id === own.id)
    || (entity.name === own.name && entity.startLine === own.startLine)
    || (entity.startLine >= own.startLine && entity.endLine <= own.endLine));

  const scored = [];
  for (const entity of entities) {
    if (!entity?.name || !Number.isInteger(entity.startLine) || !Number.isInteger(entity.endLine)) continue;
    // Parents (the class around the hit) and children (closures inside it) are
    // already in view or are the hit itself; only true siblings count.
    if (hitLines.some((line) => entity.startLine <= line && entity.endLine >= line)) continue;
    if (isEnclosingOrKin(entity)) continue;

    const tokens = siblingTokens(entity.name);
    let overlap = 0;
    for (const token of tokens) if (ownTokens.has(token)) overlap++;
    // Family: >=2 shared subtokens, or every subtoken of a short enclosing name.
    const family = overlap >= 2 || (overlap >= 1 && overlap === ownTokens.size);
    const isState = STATE_ENTITY_TYPES.has(String(entity.type || '').toLowerCase());
    const referenced = isState && body
      && new RegExp(`(?:^|[^A-Za-z0-9_$])${entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_$])`).test(body);
    const queryHit = identifierMatchesQuery(entity.name, evidence);
    let score = 0;
    if (family) score += 20 + overlap * 10;
    if (referenced) score += 30;
    if (queryHit) score += 15;
    if (score === 0) continue;
    if (isState) score += 5; // state first: it is what a method-local read cannot show
    const distance = Math.min(...hitLines.map((line) => Math.abs(entity.startLine - line)));
    scored.push({ entity, score, isState, distance });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score || a.distance - b.distance || a.entity.startLine - b.entity.startLine);

  const sites = [];
  const seenLines = new Set();
  const pushSite = (line, kind) => {
    if (!Number.isInteger(line) || seenLines.has(line) || sites.length >= MAX_SIBLING_SITES) return;
    const text = lines[line - 1];
    if (typeof text !== 'string' || !text.trim()) return;
    seenLines.add(line);
    sites.push({ line, kind, text: compactSourceLine(text) });
  };
  for (const { entity, isState } of scored.slice(0, MAX_SIBLING_ENTITIES)) {
    pushSite(entity.startLine, entity.type || 'symbol');
    if (isState && lines.length) {
      const inside = enclosings.map((own) => [own.startLine, own.endLine]);
      pushSite(findAssignmentLine(lines, entity.name, { declarationLine: entity.startLine, excludeRanges: inside }), 'assignment');
    }
  }
  if (sites.length === 0) return null;
  sites.sort((a, b) => a.line - b.line);
  const label = enclosings.map((entity) => entity.name).join(', ');
  const rendered = `# same file (siblings of ${label}): `
    + sites.map((site) => `${site.line}: ${site.text}`).join(' · ');
  return { rendered, tokens: estimateTokens(rendered), enclosing: label, sites };
}

/** Grep form: 1-3 bare grep results, all in one file. */
export function buildSingletonSiblingLine(results, codeGraphRepo, opts = {}) {
  if (!Array.isArray(results) || results.length < 1 || results.length > MAX_SIBLING_HITS) return null;
  return buildSameFileSiblingLine(results.map((result) => ({ file: result?.file, line: result?.line })), codeGraphRepo, opts);
}

/**
 * Pack form (ss-search / ss-find): the top-1 result when it is a method or
 * function chunk. The hit is the symbol's own declaration line, so the
 * family is computed for that symbol, not for the chunk's first line (a
 * chunk labelled checkSubQuery can start inside the previous method).
 */
export function buildPackSiblingLine(top, codeGraphRepo, opts = {}) {
  if (!top?.file || !top.symbol || !PACK_SIBLING_TYPES.has(String(top.symbolType || '').toLowerCase())) return null;
  if (typeof codeGraphRepo?.findEntityWithNameInRange !== 'function') return null;
  let entity = null;
  try {
    entity = codeGraphRepo.findEntityWithNameInRange(top.file, top.startLine, top.endLine, top.symbol);
  } catch { entity = null; }
  const line = Number.isInteger(entity?.startLine) ? entity.startLine : null;
  if (line == null) return null;
  return buildSameFileSiblingLine([{ file: top.file, line }], codeGraphRepo, opts);
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
