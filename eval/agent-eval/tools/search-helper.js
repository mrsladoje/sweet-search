#!/usr/bin/env node
/**
 * Lightweight search helper for B2 evaluation.
 * Thin client over the warm server on localhost:9876.
 *
 * Does NOT instantiate SweetSearch — uses the already-running warm server.
 * This avoids the ~20s cold-start per invocation that caused B2 timeouts.
 *
 * Usage:
 *   node eval/agent-eval/tools/search-helper.js --query="HTTP server" --regex="function\s+\w+" [--format=agent] [--k=5] [--port=9876]
 */

const args = process.argv.slice(2);
const opts = {};
for (const arg of args) {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  opts[key] = rest.join('=') || 'true';
}

if (!opts.query) {
  console.error('Usage: --query="..." --regex="..." [--format=agent] [--k=5] [--port=9876]');
  process.exit(1);
}

const port = opts.port || process.env.SEARCH_HELPER_PORT || '9876';
const params = new URLSearchParams({ q: opts.query, k: opts.k || '5' });
if (opts.regex) params.set('regex', opts.regex);
if (opts.format) params.set('format', opts.format);
if (opts.budget) params.set('budget', opts.budget);

const url = `http://localhost:${port}/search?${params}`;

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await response.json();

  // Agent format: compact output for the agent
  if (data.format === 'agent') {
    console.log(JSON.stringify({
      confidence: data.confidence,
      sufficient: data.sufficient,
      tokensUsed: data.tokensUsed,
      results: (data.results || []).map(r => {
        // Tight payload: rank 1 gets 1500 chars, rank 2+ gets 500
        const codeLimit = r.rank === 1 ? 1500 : 500;
        return {
          rank: r.rank,
          file: r.file,
          startLine: r.startLine,
          endLine: r.endLine,
          score: r.score,
          symbol: r.symbol,
          presentation: r.presentation,
          code: r.code?.slice(0, codeLimit) || null,
          summary: r.summary || null,
        };
      }),
    }));
  } else {
    // Benchmark format: just file/line/score
    const results = (data.results || []).slice(0, parseInt(opts.k || '5'));
    console.log(JSON.stringify({
      results: results.map(r => ({
        file: r.file,
        startLine: r.startLine || r.start_line,
        endLine: r.endLine || r.end_line,
        score: r.score || 0,
        name: r.name || null,
      })),
    }));
  }
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}
