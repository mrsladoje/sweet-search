import { describe, expect, it } from 'vitest';
import { handleSearch, SearchOutputSchema } from '../../mcp/tool-handlers.js';

describe('MCP agent pack completion output', () => {
  it('renders and types a complete continuation plus indexed family manifest', async () => {
    const searchResult = {
      format: 'agent',
      subMode: 'agent_preview',
      query: 'integer vectors',
      regex: '[IU]Vec[234]',
      mode: 'pattern',
      totalResults: 1,
      tokenBudget: 3000,
      tokensUsed: 120,
      confidence: 'medium',
      confidenceReason: 'close_scores',
      sufficient: false,
      sufficiencyVerdict: 'unknown',
      sufficiencyReason: 'partial_query_evidence',
      sufficiencyReasons: [],
      packagingMs: 1,
      latencyMs: 2,
      results: [{
        rank: 1,
        file: 'src/ivec2.rs',
        startLine: 1,
        endLine: 10,
        symbol: 'IVec2',
        symbolType: 'struct',
        score: 0.9,
        presentation: 'full',
        code: 'pub struct IVec2;',
        codeTokens: 6,
        continuation: {
          kind: 'symbol',
          file: 'src/ivec2.rs',
          startLine: 14,
          endLine: 16,
          symbol: 'impl_i64',
          symbolType: 'function',
          code: 'fn impl_i64() {}\n// body\n}',
          rendered: '# continues at src/ivec2.rs:14 impl_i64',
          tokens: 14,
        },
        familyManifest: {
          rendered: '# indexed family: IVec{2,3,4} · UVec{2,3,4}',
          tokens: 15,
          groups: ['IVec{2,3,4}', 'UVec{2,3,4}'],
          members: [],
        },
      }],
    };
    const result = await handleSearch({
      query: 'integer vectors',
      k: 10,
      mode: 'pattern',
      format: 'agent',
    }, {
      getSearcher: async () => ({ search: async () => searchResult }),
      PROJECT_ROOT: '/repo',
    });

    expect(result.content[0].text).toContain('continues at src/ivec2.rs:14 impl_i64');
    expect(result.content[0].text).toContain('indexed family: IVec{2,3,4} · UVec{2,3,4}');
    expect(result.structuredContent.results[0].continuation.symbol).toBe('impl_i64');
    expect(result.structuredContent.results[0].familyManifest.groups).toEqual([
      'IVec{2,3,4}', 'UVec{2,3,4}',
    ]);
    expect(() => SearchOutputSchema.parse(result.structuredContent)).not.toThrow();
  });
});
