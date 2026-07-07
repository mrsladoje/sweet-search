import { z } from 'zod';

const ReadFileResultSchema = z.object({
  file: z.string(),
  absolutePath: z.string().optional(),
  ok: z.boolean(),
  exact: z.boolean().optional(),
  indexed: z.boolean().optional(),
  language: z.string().nullable().optional(),
  totalLines: z.number().int().optional(),
  bytes: z.number().int().optional(),
  mtimeMs: z.number().optional(),
  range: z.object({
    startLine: z.number().int(),
    endLine: z.number().int(),
  }).nullable().optional(),
  text: z.string().optional(),
  chunks: z.array(z.object({
    id: z.string(),
    symbol: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    startLine: z.number().int().nullable().optional(),
    endLine: z.number().int().nullable().optional(),
    signature: z.string().nullable().optional(),
  })).optional(),
  unreadBelow: z.object({
    startLine: z.number().int(),
    endLine: z.number().int(),
    symbols: z.array(z.object({
      symbol: z.string(),
      type: z.string().nullable().optional(),
      startLine: z.number().int().nullable().optional(),
    })),
    moreCount: z.number().int(),
  }).nullable().optional(),
  error: z.string().optional(),
  timings: z.object({ totalMs: z.number() }).optional(),
});

export const ReadOutputSchema = z.object({
  files: z.array(ReadFileResultSchema),
  totalMs: z.number(),
});

const ReadSemanticSpanSchema = z.object({
  startLine: z.number().int(),
  endLine: z.number().int(),
  score: z.number(),
  symbols: z.array(z.string()).optional(),
  types: z.array(z.string()).optional(),
  chunkIds: z.array(z.string()).optional(),
  text: z.string(),
  truncated: z.boolean().optional(),
});

export const ReadSemanticOutputSchema = z.object({
  file: z.string(),
  query: z.string(),
  ok: z.boolean(),
  indexed: z.boolean(),
  fellBack: z.boolean(),
  reason: z.string().optional(),
  language: z.string().nullable().optional(),
  totalLines: z.number().int().optional(),
  spans: z.array(ReadSemanticSpanSchema),
  charsReturned: z.number().int().optional(),
  approxTokensReturned: z.number().int().optional(),
  signals: z.record(z.string(), z.any()).optional(),
  timings: z.record(z.string(), z.number()).optional(),
});

/**
 * @param {{ files: Array<{path: string, startLine?: number, endLine?: number}>, includeMetadata?: boolean }} args
 * @param {{ PROJECT_ROOT: string }} deps
 */
export async function handleRead(args, deps) {
  try {
    const { readFiles, formatReadResults } = await import('../core/search/index.js');
    const result = await readFiles(args.files || [], {
      projectRoot: deps.PROJECT_ROOT,
      includeMetadata: args.includeMetadata !== false,
    });
    return {
      content: [{ type: 'text', text: formatReadResults(result, 'agent') }],
      structuredContent: result,
    };
  } catch (err) {
    const msg = (err.message || 'read failed').split('\n')[0];
    return { content: [{ type: 'text', text: `read error: ${msg}` }], isError: true };
  }
}

/**
 * @param {{ file: string, query: string, topK?: number, threshold?: number, contextLines?: number, maxChars?: number, maxTokens?: number, verbose?: boolean }} args
 * @param {{ PROJECT_ROOT: string }} deps
 */
export async function handleReadSemantic(args, deps) {
  try {
    const { readSemantic, formatReadSemanticResult } = await import('../core/search/index.js');
    const result = await readSemantic({
      path: args.file,
      query: args.query,
      topK: args.topK,
      threshold: args.threshold,
      contextLines: args.contextLines,
      maxChars: args.maxChars,
      maxTokens: args.maxTokens,
      projectRoot: deps.PROJECT_ROOT,
      verbose: args.verbose,
    });
    return {
      content: [{ type: 'text', text: formatReadSemanticResult(result, 'agent') }],
      structuredContent: result,
    };
  } catch (err) {
    const msg = (err.message || 'read-semantic failed').split('\n')[0];
    return { content: [{ type: 'text', text: `read-semantic error: ${msg}` }], isError: true };
  }
}
