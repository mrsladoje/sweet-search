// Reads the fields of a search result (path, text, name, type, line count) and the source text behind it,
// including the disk reads for chunk spans and whole files.

import { readFileSync } from 'fs';
import path from 'path';

export function resolveFilePath(r) {
  return r?.file
    || r?.file_path
    || r?.path
    || r?.metadata?.file
    || r?.metadata?.file_path
    || r?.metadata?.path
    || '';
}

export function inferLineCount(r) {
  const meta = r?.metadata || {};
  const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
  const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line;
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    return end - start + 1;
  }

  const text = r?.text || r?.content || r?.code || r?.snippet || '';
  if (typeof text === 'string' && text.length > 0) {
    return text.split(/\r?\n/).length;
  }

  return Infinity;
}

function readResultSpan(r, opts = {}) {
  if (!opts.projectRoot) return '';
  const file = resolveFilePath(r);
  if (!file) return '';
  const meta = r?.metadata || {};
  const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
  const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  try {
    const abs = path.resolve(opts.projectRoot, file);
    const root = path.resolve(opts.projectRoot);
    if (abs !== root && !abs.startsWith(root + path.sep)) return '';
    const lines = readFileSync(abs, 'utf8').split('\n');
    const contextStart = Math.max(1, start - 2);
    return lines.slice(contextStart - 1, end).join('\n');
  } catch {
    return '';
  }
}

export function resolveResultText(r, opts = {}) {
  const inline = r?.content || r?.text || r?.code || r?.snippet;
  if (inline) return inline;
  // Per-call cache: this function is hit by 5+ demotion sub-rules per result
  // (bodyDensity, isTestChunk fallback, anomalousChunk, docCommentOnly,
  //  inferEntityKindFromText). Without memoization, each cache miss triggers
  // a full readFileSync + split('\n') on the chunk's source file — 5 file
  // reads per result × 100 results = ~500 disk reads per applyResultDemotions
  // call, which dominates the 6ms p50 cost.
  const cache = opts._resultTextCache;
  if (cache) {
    const file = resolveFilePath(r);
    const meta = r?.metadata || {};
    const start = r?.startLine ?? r?.start_line ?? meta.startLine ?? meta.start_line;
    const end = r?.endLine ?? r?.end_line ?? meta.endLine ?? meta.end_line ?? start;
    if (file && Number.isFinite(start)) {
      const key = `${file}|${start}|${Number.isFinite(end) ? end : start}`;
      if (cache.has(key)) return cache.get(key);
      const text = readResultSpan(r, opts);
      cache.set(key, text);
      return text;
    }
  }
  return readResultSpan(r, opts);
}

export function resolveResultName(r) {
  return r?.metadata?.name || r?.name || '';
}

export function resolveResultType(r) {
  return r?.metadata?.type || r?.type || '';
}

export function normalizeType(type) {
  return String(type || '').toLowerCase();
}

export function hasAblation(ablations, name) {
  return ablations instanceof Set ? ablations.has(name) : Array.isArray(ablations) && ablations.includes(name);
}

export function resolveFullFileText(r, opts = {}) {
  if (!opts.projectRoot) return '';
  const file = resolveFilePath(r);
  if (!file) return '';
  // Per-call cache: this fires once per result × per isTestChunk site
  // (hybrid + postprocess). Without memoization a query touching N
  // distinct files reads each one fully ~2× per result that hits the
  // file. Keyed by file path — the file content is immutable for the
  // duration of one search() call.
  const cache = opts._fullFileTextCache;
  if (cache && cache.has(file)) return cache.get(file);
  try {
    const root = path.resolve(opts.projectRoot);
    const abs = path.resolve(root, file);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      if (cache) cache.set(file, '');
      return '';
    }
    const text = readFileSync(abs, 'utf8');
    if (cache) cache.set(file, text);
    return text;
  } catch {
    if (cache) cache.set(file, '');
    return '';
  }
}
