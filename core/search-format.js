/**
 * Search Format Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains all result formatting logic for display and output.
 *
 * Functions that use `this` are regular function declarations (not arrows)
 * so they work correctly when wired onto SweetSearch.prototype.
 */


// =============================================================================
// Result formatting
// =============================================================================

/**
 * Format structural results for display
 * Uses `this` — calls this methods (none currently, but kept as regular fn).
 */
export function formatStructuralResults(results, stats) {
  if (!results.length) return `No results found for ${stats.targetEntity || 'query'}`;

  const type = results[0].structuralType;
  let out = `\n${'='.repeat(70)}\n`;
  out += `${type.toUpperCase()}: ${stats.targetEntity || ''} (${results.length} found)\n`;
  out += `${'='.repeat(70)}\n\n`;

  for (const r of results.slice(0, 30)) {
    out += `• ${r.name} (${r.type})`;
    if (r.depth > 1) out += ` [depth: ${r.depth}]`;
    if (r.riskScore) out += ` [risk: ${r.riskScore.toFixed(2)}]`;
    out += `\n`;
    out += `  ${r.file_path}:${r.start_line}`;
    if (r.call_line) out += ` (call at :${r.call_line})`;
    out += `\n`;
    if (r.summary) out += `  "${r.summary}"\n`;
    out += `\n`;
  }

  return out;
}

/**
 * Format results for display
 * Uses `this` — calls this.formatStructuralResults.
 */
export function formatResults(results, stats = {}) {
  // Check if this is structural results
  if (results.length > 0 && results[0].searchPath === 'structural') {
    return this.formatStructuralResults(results, stats);
  }

  if (results.length === 0) {
    return 'No results found';
  }

  let output = `\n${'='.repeat(80)}\n`;
  output += `TOP ${results.length} RESULTS\n`;
  output += `${'='.repeat(80)}\n\n`;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = r.name || r.metadata?.name || 'Unknown';
    const file = r.file || r.metadata?.file || r.id || '';
    const type = r.type || r.metadata?.type || '';
    const line = r.startLine || r.metadata?.startLine || '';

    output += `${i + 1}. ${name}${type ? ` (${type})` : ''}\n`;
    output += `   File: ${file}${line ? `:${line}` : ''}\n`;
    output += `   Path: ${r.searchPath}\n`;

    if (r.hybridScore !== undefined && r.rrfScore !== undefined) {
      // RRF hybrid results - show rank contributions
      const rankInfo = [];
      if (r.lexicalRank) rankInfo.push(`L#${r.lexicalRank}`);
      if (r.semanticRank) rankInfo.push(`S#${r.semanticRank}`);
      output += `   RRF: ${r.rrfScore.toFixed(4)} [${rankInfo.join(', ')}] (${r.sources?.join('+')})\n`;
    } else if (r.hybridScore !== undefined) {
      output += `   Score: ${r.hybridScore.toFixed(4)} (sources: ${r.sources?.join(', ')})\n`;
    } else if (r.rerankScore !== undefined) {
      output += `   Score: ${r.rerankScore.toFixed(4)} (reranked from ${r.originalScore?.toFixed(4)})\n`;
      if (r.lateInteractionScore !== undefined && r.preLateInteractionScore !== undefined) {
        output += `   LateInteraction: ${r.lateInteractionScore.toFixed(4)} (boosted from ${r.preLateInteractionScore.toFixed(4)})\n`;
      }
    } else if (r.lateInteractionScore !== undefined && r.preLateInteractionScore !== undefined) {
      output += `   Score: ${r.int8Score?.toFixed(4)} (LateInteraction: ${r.lateInteractionScore.toFixed(4)}, pre: ${r.preLateInteractionScore.toFixed(4)})\n`;
    } else {
      output += `   Score: ${r.score?.toFixed(4)}\n`;
    }

    // HCGS Summary-first: show summary before content
    if (r.summary) {
      output += `   Summary: ${r.summary}\n`;
    }

    const content = r.content || r.text || r.signature || '';
    const preview = content.slice(0, 150).replace(/\n/g, ' ').trim();
    if (preview) {
      output += `   ${preview}${content.length > 150 ? '...' : ''}\n`;
    }

    output += '\n';
  }

  return output;
}

/**
 * HCGS: Enrich results with summaries from graph database
 *
 * Returns results in summary-first format:
 * 1. Summary (10x fewer tokens than full code)
 * 2. File location for drill-down
 * 3. Full code only if needed
 *
 * Uses `this` — reads this.hasGraphIndex, this.log, this.graphSearch.
 */
export async function enrichWithSummaries(results) {
  if (!this.hasGraphIndex || results.length === 0) {
    return results;
  }

  try {
    if (!this.graphSearch.db) {
      await this.graphSearch.init();
    }

    const db = this.graphSearch.db;

    const stmtByName = db.prepare(`
      SELECT id, name, type, signature, summary, file_path, start_line
      FROM entities
      WHERE name = ?
        AND stale_since IS NULL
      LIMIT 1
    `);

    const stmtByLocation = db.prepare(`
      SELECT id, name, type, signature, summary, file_path, start_line
      FROM entities
      WHERE file_path LIKE ? AND start_line <= ? AND end_line >= ?
        AND stale_since IS NULL
      LIMIT 1
    `);

    const enriched = [];

    for (const result of results) {
      // Try to find matching entity by name or file:line
      const name = result.name || result.metadata?.name;
      const file = result.file || result.metadata?.file;
      const line = result.startLine || result.metadata?.startLine;

      let entity = null;

      if (name) {
        entity = stmtByName.get(name) || null;
      }

      if (!entity && file && line) {
        entity = stmtByLocation.get(`%${file}%`, line, line) || null;
      }

      if (entity && entity.summary) {
        enriched.push({
          ...result,
          summary: entity.summary,
          hasSummary: true,
        });
      } else {
        enriched.push(result);
      }
    }

    return enriched;
  } catch (err) {
    this.log(`Summary enrichment failed: ${err.message}`);
    return results;
  }
}

/**
 * HCGS: Format results with summary-first output (10x token reduction)
 */
export function formatSummaryFirst(results) {
  if (results.length === 0) {
    return 'No results found';
  }

  let output = `\n${'='.repeat(60)}\n`;
  output += `SEARCH RESULTS (${results.length}) - Summary View\n`;
  output += `${'='.repeat(60)}\n\n`;

  let totalTokens = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = r.name || r.metadata?.name || 'Unknown';
    const file = r.file || r.metadata?.file || r.id || '';
    const type = r.type || r.metadata?.type || '';
    const line = r.startLine || r.metadata?.startLine || '';
    const location = `${file}${line ? `:${line}` : ''}`;

    // Compact format with summary
    if (r.summary) {
      output += `${i + 1}. [${type}] ${name} @ ${location}\n`;
      output += `   ${r.summary}\n\n`;
      totalTokens += Math.ceil(r.summary.length / 4); // Rough token estimate
    } else {
      // Fallback to signature if no summary
      const sig = r.signature || r.content?.slice(0, 100) || '';
      output += `${i + 1}. [${type}] ${name} @ ${location}\n`;
      if (sig) output += `   ${sig.replace(/\n/g, ' ')}\n\n`;
      totalTokens += Math.ceil(sig.length / 4);
    }
  }

  output += `${'='.repeat(60)}\n`;
  output += `Est. tokens: ~${totalTokens} (vs ~${totalTokens * 10} for full code)\n`;
  output += `Use: Read <file:line> for full code\n`;

  return output;
}

/**
 * Middle-Res View: Signature + Docstring (5x token reduction)
 */
export function formatMiddleRes(results) {
  if (results.length === 0) {
    return 'No results found';
  }

  let output = `\n${'='.repeat(70)}\n`;
  output += `SEARCH RESULTS (${results.length}) - Middle-Res View (Signature + Doc)\n`;
  output += `${'='.repeat(70)}\n\n`;

  let totalTokens = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = r.name || r.metadata?.name || 'Unknown';
    const file = r.file || r.metadata?.file || r.id || '';
    const type = r.type || r.metadata?.type || '';
    const line = r.startLine || r.metadata?.startLine || '';
    const location = `${file}${line ? `:${line}` : ''}`;

    output += `${i + 1}. [${type}] ${name}\n`;
    output += `   loc: ${location}\n`;

    // Full signature
    const sig = r.signature || '';
    if (sig) {
      output += `   sig: ${sig}\n`;
      totalTokens += Math.ceil(sig.length / 4);
    }

    // Docstring/comment (truncated)
    const doc = r.docComment || r.doc_comment || '';
    if (doc) {
      const truncDoc = doc.length > 200 ? doc.slice(0, 200) + '...' : doc;
      output += `   doc: ${truncDoc.replace(/\n/g, ' ')}\n`;
      totalTokens += Math.ceil(truncDoc.length / 4);
    }

    // Summary if available
    if (r.summary) {
      output += `   sum: ${r.summary}\n`;
      totalTokens += Math.ceil(r.summary.length / 4);
    }

    output += '\n';
  }

  output += `${'='.repeat(70)}\n`;
  output += `Est. tokens: ~${totalTokens} (5x less than full code)\n`;
  output += `Use: Read <file:line> for implementation details\n`;

  return output;
}
