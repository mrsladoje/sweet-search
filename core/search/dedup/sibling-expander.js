/**
 * Sibling expander for near-duplicate dedup.
 *
 * Aliases are filtered out of HNSW so only the exemplar per cluster appears
 * in ANN results. Because all cluster members share the exemplar's embedding
 * we cannot distinguish them with the ANN signal alone — at query time we
 * re-rank cluster members by how well their ACTUAL TEXT matches the query
 * (lightweight BM25-style scoring over the query tokens), then the winner
 * takes the exemplar's rank position and the others come after it. This
 * recovers the "alias is actually the correct answer" case that the ANN
 * cannot distinguish.
 *
 * Reads only from the `vectors` table via codebase-repository; no imports
 * from the indexing domain, per DDD_ARCHITECTURE.md.
 */

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function parseMeta(result) {
  const meta = result.metadata || {};
  return typeof meta === 'string' ? safeParse(meta) : meta;
}

function extractClusterId(result) {
  return parseMeta(result).clusterId ?? null;
}

function isExemplar(result) {
  const m = parseMeta(result);
  return !!m?.clusterId && !m?.exemplarId;
}

function scoreOf(result) {
  return (
    result.score ??
    result.hybridScore ??
    result.rerankScore ??
    result.rrfScore ??
    result.int8Score ??
    result.lateInteractionScore ??
    0
  );
}

/**
 * Tokenize query/doc text into lowercased alphanumeric runs (underscore kept).
 * Same splitter used by the dedup shingle tokenizer in the Rust addon so
 * query tokenization matches the dedup index's token space.
 */
function tokenize(text) {
  if (!text) return [];
  const out = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const isAlnum =
      (c >= 48 && c <= 57) || // 0-9
      (c >= 65 && c <= 90) || // A-Z
      (c >= 97 && c <= 122) || // a-z
      c === 95; // _
    if (isAlnum) {
      buf += text[i];
    } else if (buf.length > 0) {
      out.push(buf.toLowerCase());
      buf = '';
    }
  }
  if (buf.length > 0) out.push(buf.toLowerCase());
  return out;
}

/**
 * Score a candidate (exemplar or sibling) against the tokenized query.
 * Simple BM25-lite: sum of TF scores over query terms, length-normalized.
 * k1 = 1.2, b = 0.75 (standard-ish). avgDocLen is a per-cluster estimate.
 */
function lexicalScore(queryTokens, candidateText, avgLen) {
  if (!queryTokens || queryTokens.length === 0 || !candidateText) return 0;
  const docTokens = tokenize(candidateText);
  if (docTokens.length === 0) return 0;
  const tf = new Map();
  for (const t of docTokens) tf.set(t, (tf.get(t) || 0) + 1);

  const k1 = 1.2;
  const b = 0.75;
  const lenNorm = 1 - b + b * (docTokens.length / Math.max(1, avgLen));

  let score = 0;
  for (const qt of queryTokens) {
    const freq = tf.get(qt);
    if (!freq) continue;
    score += (freq * (k1 + 1)) / (freq + k1 * lenNorm);
  }
  return score;
}

/**
 * Within-cluster re-rank: pick the candidate (exemplar or any sibling) whose
 * text best matches the query. Returns an ordered list where position 0 is
 * the winner, rest follow sorted by lexical score (descending).
 */
function rankByQueryRelevance(exemplarCandidate, siblings, queryTokens) {
  const all = [exemplarCandidate, ...siblings];
  const avgLen =
    all.reduce((sum, c) => sum + tokenize(c.text || '').length, 0) / all.length || 1;

  const scored = all.map((c) => ({
    c,
    score: lexicalScore(queryTokens, c.text || '', avgLen),
  }));
  // Stable sort: higher lexical score first, exemplar wins ties (rank-preserving).
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.c.isExemplarCandidate && !b.c.isExemplarCandidate) return -1;
    if (b.c.isExemplarCandidate && !a.c.isExemplarCandidate) return 1;
    return 0;
  });
  return scored.map((x) => x.c);
}

/**
 * Promote aliases into the flat ranked list with intra-cluster query-relevance
 * re-rank. The cluster member whose text best matches the query takes the
 * exemplar's rank; others come after. Each entry retains the exemplar's
 * score so downstream ranking position is preserved.
 *
 * @param {Array} results - ranked search results (mutated in place).
 * @param {Object} codebaseRepo - repository with findSiblingsByClusterIds().
 * @param {string} [query] - original query text; enables within-cluster re-rank.
 */
export function expandAliases(results, codebaseRepo, query = '') {
  const stats = { exemplarsExpanded: 0, aliasesPromoted: 0, reranked: 0 };
  if (!Array.isArray(results) || results.length === 0 || !codebaseRepo) {
    return { results, stats };
  }

  const clusterIds = [];
  const exemplarIds = [];
  for (const r of results) {
    if (!isExemplar(r)) continue;
    const cid = extractClusterId(r);
    if (!cid) continue;
    clusterIds.push(cid);
    if (r.id) exemplarIds.push(r.id);
  }

  if (clusterIds.length === 0) return { results, stats };

  let siblings;
  try {
    siblings = codebaseRepo.findSiblingsByClusterIds(clusterIds, exemplarIds);
  } catch (_err) {
    return { results, stats };
  }
  if (!siblings || siblings.length === 0) return { results, stats };

  // Group siblings by clusterId for O(1) lookup during expansion.
  const siblingsByCluster = new Map();
  for (const row of siblings) {
    const parsed = safeParse(row.metadata);
    const cid = parsed.clusterId;
    if (!cid) continue;
    if (!siblingsByCluster.has(cid)) siblingsByCluster.set(cid, []);
    siblingsByCluster.get(cid).push({
      id: row.id,
      file: row.file_path,
      startLine: parsed.startLine ?? null,
      endLine: parsed.endLine ?? null,
      text: row.text,
      name: parsed.name ?? null,
      type: parsed.type ?? null,
      language: parsed.language ?? null,
    });
  }

  const queryTokens = tokenize(query);
  const expanded = [];
  const seen = new Set();

  for (const r of results) {
    if (r.id && seen.has(r.id)) continue;

    if (!isExemplar(r)) {
      if (r.id) seen.add(r.id);
      expanded.push(r);
      continue;
    }

    const cid = extractClusterId(r);
    const group = cid ? siblingsByCluster.get(cid) : null;

    if (!group || group.length === 0) {
      if (r.id) seen.add(r.id);
      expanded.push(r);
      continue;
    }

    stats.exemplarsExpanded++;

    // Candidate list: exemplar + siblings. Re-rank by query-text lexical match.
    const exemplarCandidate = {
      id: r.id,
      file: r.file ?? parseMeta(r).file ?? null,
      name: r.name ?? parseMeta(r).name ?? null,
      type: r.type ?? parseMeta(r).type ?? null,
      language: r.language ?? parseMeta(r).language ?? null,
      startLine: r.startLine ?? parseMeta(r).startLine ?? null,
      endLine: r.endLine ?? parseMeta(r).endLine ?? null,
      text: r.text ?? r.content ?? '',
      isExemplarCandidate: true,
    };

    const ordered =
      queryTokens.length > 0
        ? rankByQueryRelevance(exemplarCandidate, group, queryTokens)
        : [exemplarCandidate, ...group];

    if (ordered[0] !== exemplarCandidate) stats.reranked++;

    // Attach full alias list to the WINNING result (for UI).
    const winner = ordered[0];
    const winnerIsAlias = !winner.isExemplarCandidate;
    const exemplarScore = scoreOf(r);
    const clusterSiblings = ordered
      .filter((c) => c !== winner)
      .map((c) => ({
        id: c.id,
        file: c.file,
        name: c.name,
        type: c.type,
        language: c.language,
        startLine: c.startLine,
        endLine: c.endLine,
        text: c.text,
      }));

    // Emit the winner at the exemplar's slot.
    let winnerResult;
    if (winnerIsAlias) {
      winnerResult = {
        id: winner.id,
        file: winner.file,
        name: winner.name,
        type: winner.type,
        language: winner.language,
        startLine: winner.startLine,
        endLine: winner.endLine,
        text: winner.text,
        content: winner.text,
        score: exemplarScore,
        int8Score: r.int8Score ?? exemplarScore,
        searchPath: r.searchPath ?? 'dedup-alias',
        isAlias: true,
        exemplarId: r.id,
        aliases: clusterSiblings,
        metadata: {
          ...parseMeta(r),
          file: winner.file,
          name: winner.name,
          type: winner.type,
          startLine: winner.startLine,
          endLine: winner.endLine,
          language: winner.language,
          exemplarId: r.id,
          clusterId: cid,
          isExemplar: false,
        },
      };
    } else {
      r.aliases = clusterSiblings;
      winnerResult = r;
    }
    if (winnerResult.id) seen.add(winnerResult.id);
    expanded.push(winnerResult);

    // Emit remaining cluster members after the winner.
    for (const sib of ordered) {
      if (sib === winner) continue;
      if (sib.id && seen.has(sib.id)) continue;
      if (sib.isExemplarCandidate) {
        // Exemplar is no longer the winner — emit it as a secondary slot.
        const demoted = { ...r };
        if (demoted.id) seen.add(demoted.id);
        expanded.push(demoted);
      } else {
        if (sib.id) seen.add(sib.id);
        const promoted = {
          id: sib.id,
          file: sib.file,
          name: sib.name,
          type: sib.type,
          language: sib.language,
          startLine: sib.startLine,
          endLine: sib.endLine,
          text: sib.text,
          content: sib.text,
          score: exemplarScore,
          int8Score: r.int8Score ?? exemplarScore,
          searchPath: r.searchPath ?? 'dedup-alias',
          isAlias: true,
          exemplarId: r.id,
          metadata: {
            ...parseMeta(r),
            file: sib.file,
            name: sib.name,
            type: sib.type,
            startLine: sib.startLine,
            endLine: sib.endLine,
            language: sib.language,
            exemplarId: r.id,
            clusterId: cid,
            isExemplar: false,
          },
        };
        expanded.push(promoted);
        stats.aliasesPromoted++;
      }
    }
  }

  results.length = 0;
  for (const item of expanded) results.push(item);

  return { results, stats };
}
