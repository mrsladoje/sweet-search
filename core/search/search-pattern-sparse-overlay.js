import fs from 'fs';
import path from 'path';
import {
  extractSparseGramRequiredGrams,
  getSparseGramAllFiles as _getSparseGramAllFiles,
  resolveSparseSymbolMask as _resolveSparseSymbolMask,
} from '../infrastructure/native-sparse-gram.js';
import { resolveLatestSparseGramDeltaRecords } from '../infrastructure/sparse-gram-delta-reader.js';
import { DB_PATHS, PROJECT_ROOT } from '../infrastructure/config/index.js';
import { isRipgrepCodePath, resolveSearchSymbolFilter } from './search-pattern-chunks.js';

const RECONCILE_MANIFEST_FILENAME = 'reconcile-manifest.json';

function sparseGramIndexPath(searcher, options = {}) {
  return options.sparseGramIndexPath || searcher?.sparseGramIndexPath || DB_PATHS.sparseGramIndex;
}

function normalizeDeltaPath(filePath, projectRoot = PROJECT_ROOT) {
  if (!filePath || typeof filePath !== 'string') return null;
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

function readSparseManifest(searcher, options, indexPath) {
  const dirs = sparseManifestStateDirs(searcher, options, indexPath);
  for (const dir of dirs) {
    const manifest = readSparseManifestFromDir(dir);
    if (manifest) return manifest;
  }
  return null;
}

function readSparseManifestFromDir(dir) {
  try {
    const manifestPath = path.join(dir, RECONCILE_MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
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

function normalizeRecordGrams(grams) {
  if (!Array.isArray(grams) || grams.length === 0) return null;
  const out = new Set();
  for (const entry of grams) {
    const gram = Array.isArray(entry) ? entry[0] : entry;
    if (typeof gram === 'string' && gram.length > 0) out.add(gram);
  }
  return out.size > 0 ? out : null;
}

function recordMatchesClause(record, literals, sparseGramIndex) {
  if (!Array.isArray(literals)) return true;
  if (!record.grams) return true;
  const required = extractSparseGramRequiredGrams(sparseGramIndex, literals);
  if (!required) return true;
  if (!required.eligible || !Array.isArray(required.grams) || required.grams.length === 0) return false;
  return required.grams.every((gram) => record.grams.has(gram));
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
  const latest = resolveLatestSparseGramDeltaRecords(indexPath, {
    ...(Number.isInteger(maxEpoch) ? { maxEpoch } : {}),
    segments,
  });
  if (latest.size === 0) return null;

  const hidden = new Set();
  const live = [];
  const projectRoot = searcher?.projectRoot || options.projectRoot || PROJECT_ROOT;
  const expectedWeightsId = sparseWeightsId(searcher, options, manifestInfo);
  for (const { record } of latest.values()) {
    if (expectedWeightsId && record.weightsId !== expectedWeightsId) continue;
    const filePath = normalizeDeltaPath(record.filePath, projectRoot);
    if (!filePath) continue;
    hidden.add(filePath);
    if (!record.deleted) {
      live.push({
        filePath,
        symbolMask: Number.isInteger(record.symbolMask) ? record.symbolMask : 0,
        grams: normalizeRecordGrams(record.grams),
      });
    }
  }
  if (hidden.size === 0 && live.length === 0) return null;
  return { hidden, live, maxEpoch };
}

export function sparseDeltaOverlayHasChanges(searcher, options = {}) {
  const overlay = loadSparseDeltaOverlay(searcher, options);
  return !!overlay && (overlay.hidden.size > 0 || overlay.live.length > 0);
}

export function liveOverlayFiles(overlay, symbolMask = 0, literals = null, sparseGramIndex = null) {
  if (!overlay) return [];
  const out = [];
  for (const record of overlay.live) {
    if (!isRipgrepCodePath(record.filePath)) continue;
    if (symbolMask && record.symbolMask && (record.symbolMask & symbolMask) === 0) continue;
    if (!recordMatchesClause(record, literals, sparseGramIndex)) continue;
    out.push(record.filePath);
  }
  return out;
}

export function applySparseDeltaOverlay(files, overlay, symbolMask = 0, projectRoot = PROJECT_ROOT, literals = null, sparseGramIndex = null) {
  if (!overlay) return Array.isArray(files) ? files : [];
  const merged = new Set();
  for (const file of Array.isArray(files) ? files : []) {
    const normalized = normalizeDeltaPath(file, projectRoot);
    if (normalized && !overlay.hidden.has(normalized) && isRipgrepCodePath(normalized)) {
      merged.add(normalized);
    }
  }
  for (const file of liveOverlayFiles(overlay, symbolMask, literals, sparseGramIndex)) {
    merged.add(file);
  }
  return [...merged];
}

export function getSparseGramAllFilesWithOverlay(searcher, sparseGramIndex, options = {}) {
  const baseFiles = _getSparseGramAllFiles(sparseGramIndex);
  if (!Array.isArray(baseFiles)) return baseFiles;
  const symbolMask = _resolveSparseSymbolMask(resolveSearchSymbolFilter(options));
  const projectRoot = searcher?.projectRoot || options.projectRoot || PROJECT_ROOT;
  return applySparseDeltaOverlay(baseFiles, loadSparseDeltaOverlay(searcher, options), symbolMask || 0, projectRoot);
}
