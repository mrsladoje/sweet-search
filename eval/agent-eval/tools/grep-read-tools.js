/**
 * Tool adapter: rg+read baseline.
 *
 * Tools available to the agent:
 *   - grep(regex, dir) → file:line matches
 *   - read(file, startLine, endLine) → code content
 *
 * This is the standard agent workflow — grep, read files, build understanding.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

export const TOOL_DEFINITIONS = [
  {
    name: 'grep',
    description: 'Search for a regex pattern in the codebase. Returns file:line matches.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        max_results: { type: 'number', description: 'Max results to return (default: 20)' },
      },
      required: ['pattern'],
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

export function createToolExecutor(projectRoot) {
  return function executeTool(toolName, input) {
    if (toolName === 'grep') {
      try {
        const maxResults = input.max_results || 20;
        const result = execSync(
          `rg --json -m ${maxResults} ${JSON.stringify(input.pattern)} .`,
          { cwd: projectRoot, timeout: 10000, encoding: 'utf8', maxBuffer: 1024 * 1024 }
        );
        const matches = result.split('\n')
          .filter(l => l.trim())
          .map(l => { try { return JSON.parse(l); } catch { return null; } })
          .filter(o => o?.type === 'match')
          .map(o => `${o.data?.path?.text}:${o.data?.line_number}: ${o.data?.lines?.text?.trim()}`)
          .slice(0, maxResults);
        return matches.join('\n') || 'No matches found.';
      } catch (err) {
        if (err.status === 1) return 'No matches found.';
        return `Error: ${err.message?.split('\n')[0]}`;
      }
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
