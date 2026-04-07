/**
 * Tool adapter: pattern+meta baseline.
 *
 * Tools available to the agent:
 *   - pattern_search(regex, query) → ranked chunk metadata (no code)
 *   - read(file, startLine, endLine) → code content
 *
 * The agent gets ranking but must still Read to see actual code.
 */

import { readFileSync } from 'fs';
import path from 'path';

export const TOOL_DEFINITIONS = [
  {
    name: 'pattern_search',
    description: 'Search for code using regex + semantic ranking (ColGrep). Returns ranked results with file locations and scores but NO code content — use read() to see the actual code.',
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
  {
    name: 'read',
    description: 'Read lines from a file. Returns the code content.',
    input_schema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path (relative to repo root)' },
        start_line: { type: 'number', description: 'Start line (1-indexed)' },
        end_line: { type: 'number', description: 'End line (1-indexed, inclusive)' },
      },
      required: ['file'],
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
        format: 'benchmark', // metadata only, no code
      });
      return result.results.map((r, i) =>
        `${i + 1}. ${r.file}:${r.startLine}-${r.endLine} (score: ${(r.score || 0).toFixed(3)}) ${r.name || ''}`
      ).join('\n') || 'No results found.';
    }

    if (toolName === 'read') {
      try {
        const absPath = path.resolve(projectRoot, input.file);
        if (!absPath.startsWith(path.resolve(projectRoot))) return 'Error: path outside repo';
        const content = readFileSync(absPath, 'utf8');
        const lines = content.split('\n');
        const start = (input.start_line || 1) - 1;
        const end = input.end_line || Math.min(start + 50, lines.length);
        return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
      } catch (err) {
        return `Error: ${err.message?.split('\n')[0]}`;
      }
    }

    return `Unknown tool: ${toolName}`;
  };
}
