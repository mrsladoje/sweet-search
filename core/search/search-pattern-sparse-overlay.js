import fs from 'fs';
import path from 'path';
import {
  extractSparseGramRequiredGrams,
  getSparseGramAllFiles as _getSparseGramAllFiles,
  nativeAcceptsNoExtensionToken as _nativeAcceptsNoExtensionToken,
  nativeGrepFull as _nativeGrepFull,
  nativeGrepLines as _nativeGrepLines,
  resolveSparseSymbolMask as _resolveSparseSymbolMask,
} from '../infrastructure/native-sparse-gram.js';
import { readSparseGramDeltaRecordsSince } from '../infrastructure/sparse-gram-delta-reader.js';
import { DB_PATHS, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { readJsonFileCached } from '../infrastructure/cached-json-file.js';
import { resolveSearchSymbolFilter } from './search-pattern-chunks.js';

const RECONCILE_MANIFEST_FILENAME = 'reconcile-manifest.json';

function sparseGramIndexPath(searcher, options = {}) {
  return options.sparseGramIndexPath || searcher?.sparseGramIndexPath || DB_PATHS.sparseGramIndex;
}

function normalizeDeltaPath(filePath, projectRoot = PROJECT_ROOT) {
  if (!filePath || typeof filePath !== 'string') return null;
  // The usual index path is already normal: relative, '/'-separated, no leading ./ or ../.
  if (filePath[0] !== '/' && filePath[0] !== '.' && !filePath.includes('\\') && !path.isAbsolute(filePath)) {
    return filePath;
  }
  let normalized = filePath;
  if (path.isAbsolute(normalized)) {
    normalized = relativeInsideRoot(projectRoot, normalized);
    return normalized || null;
  }
  normalized = normalized.replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized && !normalized.startsWith('../') ? normalized : null;
}

function relativeInsideRoot(projectRoot, absolutePath) {
  const root = path.resolve(projectRoot);
  const candidate = path.resolve(absolutePath);
  const lexical = safeRelative(root, candidate);
  if (lexical !== null) return lexical;

  const rootReal = realpathOrNull(root);
  const candidateReal = materializedRealpath(candidate);
  if (!rootReal || !candidateReal) return null;
  return safeRelative(rootReal, candidateReal);
}

function safeRelative(root, candidate) {
  const rel = path.relative(root, candidate).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!rel || rel.startsWith('../') || path.isAbsolute(rel)) return null;
  return rel;
}

function realpathOrNull(filePath) {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return null;
  }
}

function materializedRealpath(filePath) {
  let current = filePath;
  const rest = [];
  while (current && current !== path.dirname(current)) {
    const real = realpathOrNull(current);
    if (real) return rest.length > 0 ? path.join(real, ...rest.reverse()) : real;
    rest.push(path.basename(current));
    current = path.dirname(current);
  }
  const rootReal = realpathOrNull(current);
  return rootReal && rest.length > 0 ? path.join(rootReal, ...rest.reverse()) : rootReal;
}

function sparseManifestStateDirs(searcher, options = {}, indexPath) {
  return [
    options.manifestStateDir,
    searcher?._manifestStateDir,
    indexPath ? path.dirname(indexPath) : null,
  ].filter((dir, idx, dirs) => typeof dir === 'string' && dir && dirs.indexOf(dir) === idx);
}

// Negative cache for stateDirs known to lack reconcile-manifest.json.
// 1s TTL bounds staleness when reconcile later starts publishing.
const _sparseManifestAbsentAt = new Map();
const SPARSE_MANIFEST_ABSENT_TTL_MS = 1000;

export function _resetSparseManifestAbsentCache() {
  _sparseManifestAbsentAt.clear();
}

function readSparseManifest(searcher, options, indexPath) {
  const dirs = sparseManifestStateDirs(searcher, options, indexPath);
  const now = Date.now();
  for (const dir of dirs) {
    const absentAt = _sparseManifestAbsentAt.get(dir);
    if (absentAt !== undefined && now - absentAt < SPARSE_MANIFEST_ABSENT_TTL_MS) {
      continue;
    }
    const manifest = readSparseManifestFromDir(dir);
    if (manifest) {
      _sparseManifestAbsentAt.delete(dir);
      return manifest;
    }
    _sparseManifestAbsentAt.set(dir, now);
  }
  return null;
}

function readSparseManifestFromDir(dir) {
  try {
    const manifestPath = path.join(dir, RECONCILE_MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = readJsonFileCached(manifestPath);
    const epoch = manifest?.sparseGram?.epoch ?? manifest?.epoch;
    return {
      epoch: Number.isInteger(epoch) ? epoch : null,
      weightsId: typeof manifest?.sparseGram?.weightsId === 'string'
        ? manifest.sparseGram.weightsId
        : null,
      deltas: Array.isArray(manifest?.sparseGram?.deltas)
        ? manifest.sparseGram.deltas.filter((entry) => typeof entry === 'string')
        : null,
      stateDir: dir,
    };
  } catch {
    return null;
  }
}

function resolveDeltaSegments(segments, stateDir) {
  if (!Array.isArray(segments)) return null;
  const out = [];
  for (const segment of segments) {
    if (path.isAbsolute(segment)) {
      out.push(segment);
    } else {
      if (stateDir) out.push(path.join(stateDir, segment));
      out.push(segment);
    }
  }
  return [...new Set(out)];
}

function sparseManifestEpoch(searcher, options, manifestInfo) {
  if (Number.isInteger(options.manifestEpoch)) return options.manifestEpoch;
  if (Number.isInteger(searcher?.manifestEpoch)) return searcher.manifestEpoch;
  const repoEpoch = searcher?.codebaseRepo?.getManifestEpoch?.();
  if (Number.isInteger(repoEpoch)) return repoEpoch;
  const graphEpoch = searcher?.graphSearch?.getManifestEpoch?.();
  if (Number.isInteger(graphEpoch)) return graphEpoch;
  return manifestInfo?.epoch ?? null;
}

function sparseWeightsId(searcher, options, manifestInfo) {
  if (typeof options.sparseGramWeightsId === 'string') return options.sparseGramWeightsId;
  if (typeof searcher?.sparseGramWeightsId === 'string') return searcher.sparseGramWeightsId;
  return manifestInfo?.weightsId ?? null;
}

function sparseDeltaSegments(searcher, options, manifestInfo) {
  if (Array.isArray(options.sparseGramDeltas)) return options.sparseGramDeltas;
  if (Array.isArray(searcher?.sparseGramDeltas)) return searcher.sparseGramDeltas;
  return Array.isArray(manifestInfo?.deltas) ? manifestInfo.deltas : null;
}

// The delta records' grams, as an inverted index: gram → the ascending slots of the records that
// hold it. A Set per record held 136 MB for a 48 MB delta (2,440 files, 4.3M grams, 269k
// distinct). Here each distinct gram string is held once, and the slot lists share one
// Uint32Array (`[length, ...slots]` per gram); slots added since the last pack wait in `extra`.
class GramPostings {
  constructor() {
    this.buf = new Uint32Array(0);
    this.at = new Map();
    this.extra = new Map();
    this.extraCount = 0;
  }

  add(gram, slot) {
    let list = this.extra.get(gram);
    if (!list) this.extra.set(gram, (list = []));
    if (list[list.length - 1] !== slot) {
      list.push(slot);
      this.extraCount++;
    }
  }

  /** The slots holding `gram` (ascending), or null when no record holds it. */
  slots(gram) {
    const at = this.at.get(gram);
    const packed = at === undefined ? null : this.buf.subarray(at + 1, at + 1 + this.buf[at]);
    const extra = this.extra.get(gram);
    if (!extra) return packed;
    return packed ? [...packed, ...extra] : extra;
  }

  /** Moves `extra` into the shared buffer once it is a quarter of it (always after a full read). */
  maybePack() {
    if (this.extraCount === 0 || this.extraCount * 4 < this.buf.length) return;
    const buf = new Uint32Array(this.buf.length + this.extraCount + this.extra.size);
    const at = new Map();
    let pos = 0;
    const put = (gram) => {
      const list = this.slots(gram);
      at.set(gram, pos);
      buf[pos++] = list.length;
      buf.set(list, pos);
      pos += list.length;
    };
    for (const gram of this.at.keys()) put(gram);
    for (const gram of this.extra.keys()) if (!this.at.has(gram)) put(gram);
    this.buf = buf.length === pos ? buf : buf.slice(0, pos);
    this.at = at;
    this.extra = new Map();
    this.extraCount = 0;
  }
}

function addRecordGrams(cache, grams) {
  if (!Array.isArray(grams) || grams.length === 0) return -1;
  let slot = -1;
  for (const entry of grams) {
    const gram = Array.isArray(entry) ? entry[0] : entry;
    if (typeof gram !== 'string' || gram.length === 0) continue;
    if (slot < 0) slot = cache.nextSlot++;
    cache.postings.add(gram, slot);
  }
  return slot;
}

/**
 * `slot => boolean`: does the record in `slot` hold every gram `literals` require? The
 * required grams depend only on the index and the literals, so they are extracted once per
 * call, and only when some record has grams to test.
 */
function clauseSlotMatcher(overlay, literals, sparseGramIndex) {
  const required = extractSparseGramRequiredGrams(sparseGramIndex, literals);
  if (!required) return () => true;
  if (!required.eligible || !Array.isArray(required.grams) || required.grams.length === 0) return () => false;
  const postings = required.grams.map((gram) => overlay.postings.slots(gram));
  if (postings.some((p) => !p)) return () => false;
  postings.sort((a, b) => a.length - b.length);
  let matched = new Set(postings[0]);
  for (let i = 1; i < postings.length && matched.size > 0; i++) {
    const next = new Set();
    for (const slot of postings[i]) if (matched.has(slot)) next.add(slot);
    matched = next;
  }
  return (slot) => matched.has(slot);
}

// The daemon asks for the overlay several times per query (the planner's change check, the
// gram lookup, the all-files list) and once more per retry, and a full read is ~1 s per 50 MB
// of deltas. So the overlay is kept per index and updated from the bytes appended since
// (readSparseGramDeltaRecordsSince); it is rebuilt only when a segment is replaced.
const OVERLAY_CACHE_MAX = 4;
const _overlayCache = new Map();

export function _resetSparseDeltaOverlayCache() {
  _overlayCache.clear();
}

function emptyOverlayCache() {
  return {
    cursor: null, entries: new Map(), postings: new GramPostings(),
    nextSlot: 0, deadSlots: 0, deadSlotsAtReset: 0, overlay: null,
  };
}

function refreshOverlayCache(cache, indexPath, readOpts, projectRoot, expectedWeightsId) {
  let changed = false;
  let reset = false;
  const read = (cursor) => readSparseGramDeltaRecordsSince(indexPath, readOpts, cursor, {
    onReset() {
      Object.assign(cache, emptyOverlayCache());
      changed = true;
      reset = true;
    },
    onRecord(record) {
      changed = true;
      const old = cache.entries.get(record.fileId);
      if (old?.slot >= 0) cache.deadSlots++;
      // Map.set keeps a known fileId at its first position, as the full read's Map does.
      cache.entries.set(record.fileId, deltaEntry(cache, record, projectRoot, expectedWeightsId));
    },
  });
  cache.cursor = read(cache.cursor);
  if (reset) cache.deadSlotsAtReset = cache.deadSlots;
  // Postings of replaced records are never read again. A full read leaves those of the records
  // a segment replaces itself; once appends have left more than there are live slots, read
  // everything again to drop them.
  const appendedDead = cache.deadSlots - cache.deadSlotsAtReset;
  if (appendedDead > 1024 && appendedDead > cache.nextSlot - cache.deadSlots) {
    reset = false;
    cache.cursor = read(null);
    cache.deadSlotsAtReset = cache.deadSlots;
  }
  cache.postings.maybePack();
  if (changed || !cache.overlay) cache.overlay = buildOverlay(cache);
}

function deltaEntry(cache, record, projectRoot, expectedWeightsId) {
  if (expectedWeightsId && record.weightsId !== expectedWeightsId) return null;
  const filePath = normalizeDeltaPath(record.filePath, projectRoot);
  if (!filePath) return null;
  if (record.deleted) return { filePath, deleted: true, slot: -1 };
  return {
    filePath,
    deleted: false,
    symbolMask: Number.isInteger(record.symbolMask) ? record.symbolMask : 0,
    slot: addRecordGrams(cache, record.grams),
  };
}

function buildOverlay(cache) {
  if (cache.entries.size === 0) return null;
  const hidden = new Set();
  const live = [];
  for (const entry of cache.entries.values()) {
    if (!entry) continue;
    hidden.add(entry.filePath);
    if (!entry.deleted) {
      live.push({ filePath: entry.filePath, symbolMask: entry.symbolMask, slot: entry.slot });
    }
  }
  if (hidden.size === 0 && live.length === 0) return null;
  return { hidden, live, postings: cache.postings };
}

export function loadSparseDeltaOverlay(searcher, options = {}) {
  const indexPath = sparseGramIndexPath(searcher, options);
  if (!indexPath) return null;
  const manifestInfo = readSparseManifest(searcher, options, indexPath);
  const maxEpoch = sparseManifestEpoch(searcher, options, manifestInfo);
  const manifestSegments = sparseDeltaSegments(searcher, options, manifestInfo);
  if (!Array.isArray(manifestSegments)) return null;
  const segments = resolveDeltaSegments(
    manifestSegments,
    manifestInfo?.stateDir || sparseManifestStateDirs(searcher, options, indexPath)[0],
  );
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const projectRoot = searcher?.projectRoot || options.projectRoot || PROJECT_ROOT;
  const expectedWeightsId = sparseWeightsId(searcher, options, manifestInfo);
  // A new epoch only lists more segments; the cursor sees that. Root and weights id decide
  // what every cached entry is, so they key the cache.
  const key = `${indexPath}\0${projectRoot}\0${expectedWeightsId ?? ''}`;
  let cache = _overlayCache.get(key);
  if (cache) {
    _overlayCache.delete(key);
  } else {
    cache = emptyOverlayCache();
    while (_overlayCache.size >= OVERLAY_CACHE_MAX) _overlayCache.delete(_overlayCache.keys().next().value);
  }
  _overlayCache.set(key, cache);
  try {
    refreshOverlayCache(cache, indexPath, {
      ...(Number.isInteger(maxEpoch) ? { maxEpoch } : {}),
      segments,
    }, projectRoot, expectedWeightsId);
  } catch (err) {
    _overlayCache.delete(key);
    throw err;
  }
  return cache.overlay ? { ...cache.overlay, maxEpoch } : null;
}

export function sparseDeltaOverlayHasChanges(searcher, options = {}) {
  const overlay = loadSparseDeltaOverlay(searcher, options);
  return !!overlay && (overlay.hidden.size > 0 || overlay.live.length > 0);
}

export function liveOverlayFiles(overlay, symbolMask = 0, literals = null, sparseGramIndex = null) {
  if (!overlay) return [];
  const out = [];
  let inClause = null;
  for (const record of overlay.live) {
    if (symbolMask && record.symbolMask && (record.symbolMask & symbolMask) === 0) continue;
    // A record with no grams passes every gram filter.
    if (Array.isArray(literals) && record.slot >= 0) {
      inClause ??= clauseSlotMatcher(overlay, literals, sparseGramIndex);
      if (!inClause(record.slot)) continue;
    }
    out.push(record.filePath);
  }
  return out;
}

export function applySparseDeltaOverlay(files, overlay, symbolMask = 0, projectRoot = PROJECT_ROOT, literals = null, sparseGramIndex = null) {
  if (!overlay) return Array.isArray(files) ? files : [];
  const merged = new Set();
  for (const file of Array.isArray(files) ? files : []) {
    const normalized = normalizeDeltaPath(file, projectRoot);
    if (normalized && !overlay.hidden.has(normalized)) {
      merged.add(normalized);
    }
  }
  for (const file of liveOverlayFiles(overlay, symbolMask, literals, sparseGramIndex)) {
    merged.add(file);
  }
  return [...merged];
}

// The native unified search keeps a gram candidate only when the text after the path's LAST
// '.' (ASCII-lower-cased) is in its `codeExtensions` list (has_code_extension,
// sparse_gram.rs); a path with no '.' never passes. The index already holds exactly the grep
// corpus, so the list is every key of the index's own paths, and the paths that cannot pass
// are returned for the caller to grep alongside the narrowed candidates.
const _pathFilterByIndex = new WeakMap();

export function sparseGramPathFilter(sparseGramIndex) {
  if (!sparseGramIndex || typeof sparseGramIndex !== 'object') return { extensions: [], unfilterable: [] };
  const cached = _pathFilterByIndex.get(sparseGramIndex);
  if (cached) return cached;
  const keys = new Set();
  const unfilterable = [];
  for (const file of _getSparseGramAllFiles(sparseGramIndex) || []) {
    const dot = file.lastIndexOf('.');
    if (dot < 0 || dot + 1 >= file.length) unfilterable.push(file);
    else keys.add(file.slice(dot + 1).replace(/[A-Z]+/g, (s) => s.toLowerCase()));
  }
  // An addon that knows the `''` token narrows the extensionless paths with the rest.
  const filter = unfilterable.length > 0 && _nativeAcceptsNoExtensionToken()
    ? { extensions: [...keys, ''], unfilterable: [] }
    : { extensions: [...keys], unfilterable };
  _pathFilterByIndex.set(sparseGramIndex, filter);
  return filter;
}

/**
 * True when the gram index proves no file can match: every OR-clause is eligible and has 0
 * candidate files. The native unified search reads 0 candidates as "cannot narrow" and greps
 * every file, so the caller must not hand it such a query.
 */
export function gramsProveNoMatch(sparseGramIndex, clauses, { maxCandidates = 0, symbolMask = 0 } = {}) {
  if (!Array.isArray(clauses) || clauses.length === 0) return false;
  if (typeof sparseGramIndex?.queryLiterals !== 'function') return false;
  try {
    return clauses.every((clause) => {
      if (!Array.isArray(clause) || clause.length === 0) return false;
      const result = sparseGramIndex.queryLiterals(clause, maxCandidates, symbolMask);
      return result?.eligible === true && Array.isArray(result.files) && result.files.length === 0;
    });
  } catch {
    return false;
  }
}

/**
 * Native grep of `files` (the `unfilterable` paths above); [] when there are none or native is
 * unavailable. `withTotals`: the whole result `{ matches, fileTotals? }` instead, with
 * `perFileCap` as in nativeGrepFull.
 */
export function grepUnfilterablePaths(files, regex, searchDir, { caseInsensitive = false, lightweightParse = false, perFileCap = 0, withTotals = false } = {}) {
  if (!Array.isArray(files) || files.length === 0) return withTotals ? { matches: [] } : [];
  const result = lightweightParse
    ? _nativeGrepLines(regex, searchDir, files, caseInsensitive)
    : _nativeGrepFull(regex, searchDir, files, caseInsensitive, { perFileCap, indexPaths: true });
  if (withTotals) return result?.matches ? result : { matches: [] };
  return result?.matches || [];
}

// A loaded index never changes its file list, and an overlay keeps its `hidden` and `live`
// until the deltas change, so the merged list is kept per index for the last overlay seen.
const _allFilesByIndex = new WeakMap();

export function getSparseGramAllFilesWithOverlay(searcher, sparseGramIndex, options = {}) {
  const entry = allFilesEntry(searcher, sparseGramIndex, options);
  return Array.isArray(entry?.files) ? entry.files.slice() : entry?.files;
}

/**
 * The files getSparseGramAllFilesWithOverlay lists that equal `rel` or lie under `rel/`, for
 * each of `rels` (root-relative, normalized), from a sorted copy kept with the list: a
 * one-file or one-directory --in scope without scanning 60k paths. Sorted, not in list order
 * (bareGrep sorts the matches). Null when there is no list.
 */
export function getSparseGramFilesUnder(searcher, sparseGramIndex, options, rels) {
  const entry = allFilesEntry(searcher, sparseGramIndex, options);
  if (!Array.isArray(entry?.files)) return null;
  entry.sorted ??= [...entry.files].sort();
  entry.set ??= new Set(entry.files);
  const out = new Set();
  for (const rel of rels) {
    if (entry.set.has(rel)) out.add(rel);
    const prefix = `${rel}/`;
    let lo = 0;
    let hi = entry.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (entry.sorted[mid] < prefix) lo = mid + 1; else hi = mid;
    }
    for (let i = lo; i < entry.sorted.length && entry.sorted[i].startsWith(prefix); i++) out.add(entry.sorted[i]);
  }
  return [...out];
}

function allFilesEntry(searcher, sparseGramIndex, options = {}) {
  const symbolMask = _resolveSparseSymbolMask(resolveSearchSymbolFilter(options)) || 0;
  const projectRoot = searcher?.projectRoot || options.projectRoot || PROJECT_ROOT;
  const indexKey = sparseGramIndex !== null && typeof sparseGramIndex === 'object' ? sparseGramIndex : null;
  const cached = indexKey ? _allFilesByIndex.get(indexKey) : null;
  if (cached) {
    const overlay = loadSparseDeltaOverlay(searcher, options);
    if (cached.hidden === overlay?.hidden && cached.live === overlay?.live
        && cached.symbolMask === symbolMask && cached.projectRoot === projectRoot) {
      return cached;
    }
  }
  const baseFiles = _getSparseGramAllFiles(sparseGramIndex);
  if (!Array.isArray(baseFiles)) return { files: baseFiles };
  const overlay = loadSparseDeltaOverlay(searcher, options);
  const files = applySparseDeltaOverlay(baseFiles, overlay, symbolMask, projectRoot);
  const entry = { hidden: overlay?.hidden, live: overlay?.live, symbolMask, projectRoot, files };
  if (indexKey) _allFilesByIndex.set(indexKey, entry);
  return entry;
}
