import { describe, it, expect } from 'vitest';
import {
  containsToken,
  looksLikeIdentifierToken,
  regexLiteralRuns,
  informativeSubtokens,
  extractQueryEvidence,
  assessQueryEvidence,
  computeSufficiencyVerdict,
} from '../../core/search/query-sufficiency.js';
import { formatRouteMetadata } from '../../core/search/search-format.js';
import { renderSufficiency } from '../../eval/agent-read-workflows/bin/_ss-argparse.mjs';

describe('containsToken (word-boundary substring)', () => {
  it('matches whole identifiers only', () => {
    expect(containsToken('const ChunkerParams = 1;', 'ChunkerParams')).toBe(true);
    expect(containsToken('const ChunkerParamsList = 1;', 'ChunkerParams')).toBe(false);
    expect(containsToken('myChunkerParams', 'ChunkerParams')).toBe(false);
  });
  it('supports case-insensitive matching', () => {
    expect(containsToken('const chunkerparams = 1;', 'ChunkerParams', { caseSensitive: false })).toBe(true);
    expect(containsToken('const chunkerparams = 1;', 'ChunkerParams', { caseSensitive: true })).toBe(false);
  });
});

describe('looksLikeIdentifierToken (shape, not word lists)', () => {
  it('accepts code-shaped tokens', () => {
    for (const tok of ['ChunkerParams', 'assignFshCode', 'parse_config', 'utf8Decode',
      'MAX_RETRIES', 'foo.bar', 'src/fhirtypes/common.ts', 'HNSW2', '$scope']) {
      expect(looksLikeIdentifierToken(tok), tok).toBe(true);
    }
  });
  it('rejects plain lowercase English words', () => {
    for (const tok of ['parse', 'config', 'the', 'complete', 'severity']) {
      expect(looksLikeIdentifierToken(tok), tok).toBe(false);
    }
  });
});

describe('regexLiteralRuns', () => {
  it('extracts literal runs from anchored regexes', () => {
    expect(regexLiteralRuns('\\bChunkerParams\\b')).toEqual(['ChunkerParams']);
    expect(regexLiteralRuns('parseConfig\\(')).toEqual(['parseConfig']);
    expect(regexLiteralRuns('(foo|barBaz)\\.qux')).toEqual(['foo', 'barBaz', 'qux']);
  });
  it('returns nothing for pure metachar patterns', () => {
    expect(regexLiteralRuns('\\b\\w+\\b')).toEqual([]);
  });
});

describe('informativeSubtokens', () => {
  it('splits camelCase and snake_case, drops stopwords and shorties', () => {
    const toks = informativeSubtokens('how is the ChunkerParams default_size resolved');
    expect(toks.has('chunker')).toBe(true);
    expect(toks.has('params')).toBe(true);
    expect(toks.has('default')).toBe(true);
    expect(toks.has('size')).toBe(true);
    expect(toks.has('resolved')).toBe(true);
    expect(toks.has('the')).toBe(false);
    expect(toks.has('is')).toBe(false);
  });
});

describe('extractQueryEvidence', () => {
  it('collects quoted literals, identifier-shaped tokens, and regex runs', () => {
    const { anchors } = extractQueryEvidence(
      'where is "unhandled error" raised in parseConfig', '\\bDefault\\b');
    expect(anchors).toContain('unhandled error');
    expect(anchors).toContain('parseConfig');
    expect(anchors).toContain('Default');
  });
});

const SUSHI_LIKE_TOP1 = {
  // Well-formed complete function, resolved imports — but off-topic for the
  // query below. The old structural rule labelled this YES.
  symbol: 'printResults',
  file: 'src/utils/Processing.ts',
  presentation: 'full',
  code: 'export function printResults(pkg: Package) {\n  console.log(pkg.count);\n}',
  headerContext: "import { Package } from '../export';",
  neighbors: { count: 2, rendered: 'x', tokens: 40 },
};

describe('computeSufficiencyVerdict', () => {
  const structuralOk = { isComplete: true, hasResolution: true };
  const structuralWeak = { isComplete: false, hasResolution: false };

  it('literal match + high confidence → yes', () => {
    const top = { symbol: 'ChunkerParams', file: 'src/archiver.py', presentation: 'full',
      code: 'class ChunkerParams:\n    def validate(self): pass' };
    const v = computeSufficiencyVerdict({
      topResult: top, confidenceInfo: { confidence: 'high' },
      query: 'ChunkerParams validation', regex: '', structural: structuralOk,
    });
    expect(v.verdict).toBe('yes');
    expect(v.evidence.exactHit).toBe(true);
  });

  it('well-formed but off-topic → no (never YES from packaging alone)', () => {
    const v = computeSufficiencyVerdict({
      topResult: SUSHI_LIKE_TOP1, confidenceInfo: { confidence: 'medium' },
      query: 'fixedValue assignment nested extension slices', regex: '',
      structural: structuralOk,
    });
    expect(v.verdict).toBe('no');
    expect(v.reason).toBe('no_query_evidence');
  });

  it('confidence=low can never be yes, even with strong evidence', () => {
    const top = { symbol: 'ChunkerParams', file: 'a.py', presentation: 'full',
      code: 'class ChunkerParams: pass' };
    const v = computeSufficiencyVerdict({
      topResult: top, confidenceInfo: { confidence: 'low' },
      query: 'ChunkerParams', regex: '', structural: structuralOk,
    });
    expect(v.verdict).toBe('unknown');
    expect(v.reason).toBe('evidence_without_margin');
  });

  it('no-side correction: literal hit + clear margin → yes without structural resolution', () => {
    const top = { symbol: 'ChunkerParams', file: 'a.py', presentation: 'full',
      code: 'ChunkerParams = namedtuple("ChunkerParams", "algo")' };
    const v = computeSufficiencyVerdict({
      topResult: top, confidenceInfo: { confidence: 'high' },
      query: 'ChunkerParams', regex: '\\bChunkerParams\\b', structural: structuralWeak,
    });
    expect(v.verdict).toBe('yes');
  });

  it('ambiguous partial overlap → unknown', () => {
    const top = { symbol: 'parseConfig', file: 'config.go', presentation: 'full',
      code: 'func parseConfig(path string) (*Config, error) { return toml.Parse(path) }' };
    const v = computeSufficiencyVerdict({
      topResult: top, confidenceInfo: { confidence: 'medium' },
      query: 'rule severity config mapping', regex: '', structural: structuralWeak,
    });
    expect(v.verdict).toBe('unknown');
  });

  it('single weak NL token never earns a discouraging no', () => {
    const top = { symbol: 'frobnicate', file: 'x.js', presentation: 'full',
      code: 'function frobnicate() {}' };
    const v = computeSufficiencyVerdict({
      topResult: top, confidenceInfo: { confidence: 'low' },
      query: 'widget', regex: '', structural: structuralWeak,
    });
    expect(v.verdict).toBe('unknown');
  });

  it('softens no → unknown when a lower code-bearing hit matches strongly', () => {
    const offTopicTop = { symbol: 'push', file: 'core/embedding/model-client.mjs',
      presentation: 'full', code: 'push(job) { this.queue.push(job); }' };
    const rank2 = { symbol: 'computeSufficiency', file: 'core/search/context-expander.js',
      presentation: 'preview', code: 'export function computeSufficiency(topResult) {}' };
    const v = computeSufficiencyVerdict({
      topResult: offTopicTop, confidenceInfo: { confidence: 'medium' },
      query: 'computeSufficiency verdict', regex: '', structural: structuralOk,
      lowerResults: [rank2],
    });
    expect(v.verdict).toBe('unknown');
    expect(v.reason).toBe('evidence_below_top1');
  });

  it('lower-rank evidence never grants yes', () => {
    const offTopicTop = { symbol: 'push', file: 'q.js', presentation: 'full',
      code: 'push(job) { this.queue.push(job); }' };
    const rank2 = { symbol: 'ChunkerParams', file: 'a.py', presentation: 'preview',
      code: 'class ChunkerParams: pass' };
    const v = computeSufficiencyVerdict({
      topResult: offTopicTop, confidenceInfo: { confidence: 'high' },
      query: 'ChunkerParams', regex: '', structural: structuralOk,
      lowerResults: [rank2],
    });
    expect(v.verdict).toBe('unknown');
  });

  it('no results → no', () => {
    const v = computeSufficiencyVerdict({
      topResult: null, confidenceInfo: null, query: 'anything', regex: '',
      structural: structuralWeak,
    });
    expect(v.verdict).toBe('no');
    expect(v.reason).toBe('no_results');
  });

  it('summary-only top-1 with matching evidence → unknown, never yes', () => {
    const top = { symbol: 'ChunkerParams', file: 'a.py', presentation: 'summary',
      code: null, summary: 'a.py:10 — ChunkerParams (class)' };
    const v = computeSufficiencyVerdict({
      topResult: top, confidenceInfo: { confidence: 'high' },
      query: 'ChunkerParams', regex: '', structural: structuralWeak,
    });
    expect(v.verdict).toBe('unknown');
    expect(v.reason).toBe('top_summary_only');
  });
});

describe('renderSufficiency (trailer line-format stability)', () => {
  it('renders 3-valued verdict with why-token', () => {
    expect(renderSufficiency({ sufficiencyVerdict: 'yes', sufficiencyReason: 'query_evidence_clear_margin' }))
      .toBe(' sufficient=YES (query_evidence_clear_margin)');
    expect(renderSufficiency({ sufficiencyVerdict: 'unknown', sufficiencyReason: 'well_formed_only' }))
      .toBe(' sufficient=unknown (well_formed_only)');
    expect(renderSufficiency({ sufficiencyVerdict: 'no', sufficiencyReason: 'no_query_evidence' }))
      .toBe(' sufficient=no (no_query_evidence)');
  });
  it('falls back to legacy boolean rendering', () => {
    expect(renderSufficiency({ sufficient: true })).toBe(' sufficient=YES');
    expect(renderSufficiency({ sufficient: false })).toBe(' sufficient=no');
  });
  it('keeps the # confidence= line shape parseable by the legacy regex', () => {
    const line = `# confidence=medium (close_top2)${renderSufficiency({
      sufficiencyVerdict: 'unknown', sufficiencyReason: 'well_formed_only' })}`;
    expect(line).toMatch(/^# confidence=(high|medium|low) \([a-z_0-9]+\) sufficient=(YES|no|unknown)( \([a-z_0-9]+\))?$/);
  });
});

describe('formatRouteMetadata', () => {
  const meta = {
    query: 'find the handler',
    routedMode: 'hybrid',
    routeMethod: 'wasm_catboost',
    routerLatency_us: 417,
    serverProjectRoot: '/private/repo',
    requestedProjectRoot: '/private/repo',
    serverPid: 1234,
    repoMatches: true,
    resultCount: 9,
    confidence: 'high',
    sufficient: true,
    sufficiencyVerdict: 'yes',
    sufficiencyReason: 'clear_margin',
  };

  it('emits one compact actionable line for agent format', () => {
    const line = formatRouteMetadata(meta, { _isAgentFormat: true });
    expect(line).toBe('route=hybrid confidence=high sufficient=YES reason=clear_margin repo=ok results=9');
    expect(line).not.toContain(meta.query);
    expect(line).not.toContain(meta.serverProjectRoot);
    expect(line).not.toContain(String(meta.serverPid));
    expect(line).not.toContain('latency');
  });

  it('preserves the full JSON marker for non-agent and debug output', () => {
    const full = `<<SS_ROUTE_META>>${JSON.stringify(meta)}`;
    expect(formatRouteMetadata(meta)).toBe(full);
    expect(formatRouteMetadata(meta, { _isAgentFormat: false })).toBe(full);
    expect(formatRouteMetadata(meta, { _isAgentFormat: true, debug: true })).toBe(full);
  });

  it('retains negative and unknown states without leaking free-form text', () => {
    expect(formatRouteMetadata({
      routedMode: 'pattern fallback',
      confidence: 'low',
      sufficiencyVerdict: 'unknown',
      sufficiencyReason: 'needs more/code',
      repoMatches: false,
      resultCount: 0,
    }, { _isAgentFormat: true })).toBe(
      'route=pattern_fallback confidence=low sufficient=unknown reason=needs_more_code repo=mismatch results=0'
    );
  });
});
