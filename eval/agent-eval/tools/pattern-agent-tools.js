/**
 * Tool adapter: pattern+agent (treatment).
 *
 * Tools available to the agent:
 *   - pattern_search(regex, query) → ranked code blocks with confidence signals
 *
 * No read() tool — the agent gets code directly in the search result.
 * This is the system under test.
 */

export const TOOL_DEFINITIONS = [
  {
    name: 'pattern_search',
    description: 'Search for code using regex + semantic ranking (ColGrep). Returns ranked results with FULL CODE BLOCKS, confidence signals, and token usage. You do NOT need to read files — the code is included in the results.',
    input_schema: {
      type: 'object',
      properties: {
        regex: { type: 'string', description: 'Regex pattern for candidate generation' },
        query: { type: 'string', description: 'Semantic query for MaxSim ranking' },
        k: { type: 'number', description: 'Number of results (default: 5)' },
      },
      required: ['regex', 'query'],
    },
  },
];

export function createToolExecutor(projectRoot, searchInstance) {
  return async function executeTool(toolName, input) {
    if (toolName === 'pattern_search') {
      const result = await searchInstance.search(input.query, {
        k: input.k || 5,
        mode: 'pattern',
        regex: input.regex,
        format: 'agent',
      });

      // Format the agent response as tool output
      const lines = [];
      lines.push(`Confidence: ${result.confidence} (${result.confidenceReason})`);
      lines.push(`Sufficient: ${result.sufficient}`);
      lines.push(`Tokens: ${result.tokensUsed}/${result.tokenBudget}`);
      lines.push('');

      for (const r of result.results || []) {
        if (r.presentation === 'summary') {
          lines.push(`#${r.rank} [summary] ${r.summary}`);
        } else {
          lines.push(`#${r.rank} ${r.file}:${r.startLine}-${r.endLine} (score: ${(r.score || 0).toFixed(3)}, ${r.presentation})`);
          if (r.symbol) lines.push(`  Symbol: ${r.symbolType || 'symbol'} ${r.symbol}`);
          if (r.headerContext) lines.push(`  Imports: ${r.headerContext}`);
          if (r.code) lines.push('```', r.code, '```');
        }
        lines.push('');
      }

      return lines.join('\n') || 'No results found.';
    }

    return `Unknown tool: ${toolName}`;
  };
}
