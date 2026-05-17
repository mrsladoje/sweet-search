/**
 * Deterministic exemplar selection per cluster.
 *
 * Tiebreak order:
 *   1. Longest text (prefer the fuller version of a near-duplicate).
 *   2. Smallest path lex (stable, file-system-agnostic choice).
 *   3. Smallest chunk hash (final tiebreak).
 *
 * Guarantees: identical corpora produce identical exemplars across runs,
 * so re-indexing (incremental or full) does not churn cluster assignments
 * and downstream alias embeddings remain stable.
 */

function lengthOf(chunk) {
  return (chunk.text || chunk.content || '').length;
}

function pathOf(chunk) {
  return firstSafeRelativePath(
    chunk.metadata?.relative_path,
    chunk.metadata?.path,
    chunk.metadata?.file_path,
    chunk.file,
    chunk.metadata?.file,
  ) || '';
}

function firstSafeRelativePath(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
    if (!normalized || normalized === '.' || normalized.startsWith('/')) continue;
    if (/^[A-Za-z]:\//.test(normalized)) continue;
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) continue;
    return normalized;
  }
  return null;
}

function hashOf(chunk) {
  return chunk.metadata?.hash || chunk.id || '';
}

export function selectExemplar(members) {
  if (!members || members.length === 0) {
    throw new Error('selectExemplar: empty cluster');
  }
  if (members.length === 1) return members[0];

  let best = members[0];
  let bestLen = lengthOf(best.chunk);
  let bestPath = pathOf(best.chunk);
  let bestHash = hashOf(best.chunk);

  for (let i = 1; i < members.length; i++) {
    const m = members[i];
    const len = lengthOf(m.chunk);
    if (len > bestLen) {
      best = m;
      bestLen = len;
      bestPath = pathOf(m.chunk);
      bestHash = hashOf(m.chunk);
      continue;
    }
    if (len < bestLen) continue;

    const mp = pathOf(m.chunk);
    if (mp < bestPath) {
      best = m;
      bestPath = mp;
      bestHash = hashOf(m.chunk);
      continue;
    }
    if (mp > bestPath) continue;

    const mh = hashOf(m.chunk);
    if (mh < bestHash) {
      best = m;
      bestHash = mh;
    }
  }
  return best;
}
