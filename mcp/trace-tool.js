import { z } from 'zod';

const TraceEntitySchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  name: z.string(),
  type: z.string(),
  filePath: z.string().nullable().optional(),
  file: z.string().nullable().optional(),
  startLine: z.number().int().nullable().optional(),
  endLine: z.number().int().nullable().optional(),
  contextLine: z.number().int().nullable().optional(),
  relationship: z.string().nullable().optional(),
  depth: z.number().int().optional(),
  importance: z.number().optional(),
  presentation: z.enum(['full', 'preview', 'summary']).optional(),
  summary: z.string().optional(),
  code: z.string().nullable().optional(),
  codeTokens: z.number().int().optional(),
});

export const TraceOutputSchema = z.object({
  format: z.literal('structural_context'),
  tool: z.literal('trace'),
  symbol: z.string(),
  target: z.any().nullable(),
  disambiguation: z.array(z.any()),
  budgetTier: z.string(),
  budgetReason: z.string(),
  tokenBudget: z.number().int(),
  tokensUsed: z.number().int(),
  maxDepth: z.number().int(),
  answerCues: z.object({
    targetTerms: z.array(z.string()),
    keySymbols: z.array(z.string()).optional(),
    branchTerms: z.array(z.string()).optional(),
    branchSnippets: z.array(z.string()).optional(),
    citationFocus: z.string().nullable().optional(),
    relatedDefinitions: z.array(z.string()).optional(),
    topCallers: z.array(z.string()),
    topCallees: z.array(z.string()),
    criticalPaths: z.array(z.string()),
  }).optional(),
  stats: z.record(z.string(), z.any()),
  sections: z.object({
    callers: z.object({ total: z.number().int(), shown: z.number().int(), items: z.array(TraceEntitySchema) }),
    callees: z.object({ total: z.number().int(), shown: z.number().int(), items: z.array(TraceEntitySchema) }),
    impact: z.object({ total: z.number().int(), shown: z.number().int(), paths: z.array(z.any()) }),
  }),
});

/**
 * @param {{ symbol: string, file?: string, query?: string, tokenBudget?: number, maxDepth?: number }} args
 * @param {{ PROJECT_ROOT: string }} deps
 */
export async function handleTrace({ symbol, file, query, tokenBudget, maxDepth }, { PROJECT_ROOT }) {
  try {
    const { traceSymbol, formatStructuralContext } = await import('../core/search/search-trace.js');
    const result = traceSymbol(symbol, {
      projectRoot: PROJECT_ROOT,
      filePath: file,
      queryHint: query,
      tokenBudget,
      maxDepth,
    });
    return {
      content: [{ type: 'text', text: formatStructuralContext(result) }],
      structuredContent: result,
      isError: !result.target,
    };
  } catch (err) {
    const safeMessage = (err.message || 'Trace failed')
      .split('\n')[0]
      .replace(/\/[^\s:]+/g, '<path>')
      .replace(/[A-Z]:\\[^\s:]+/gi, '<path>')
      .replace(/\\\\[^\s:]+/g, '<path>');
    return {
      content: [{ type: 'text', text: `Trace error: ${safeMessage}` }],
      isError: true,
    };
  }
}
