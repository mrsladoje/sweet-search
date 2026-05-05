/**
 * Cheap unit tests for the agent-read-workflows benchmark harness.
 *
 * Covers:
 *   - POLICIES has all three conditions wired
 *   - TOOL_RULES has correct allowedBashLeading per condition
 *   - audit.auditRun flags policy violations correctly per condition
 *
 * No claude API calls. No expensive bench runs.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  POLICIES, MODE_ORDER, TOOL_RULES, SWEET_CONDITIONS,
} from '../../eval/agent-read-workflows/policies.js';
import { auditRun } from '../../eval/agent-read-workflows/audit.js';
import { SweetSearch } from '../../core/search/sweet-search.js';

// ────────────────────────────────────────────────────────────────────────────
// Policy/tool-rule wiring
// ────────────────────────────────────────────────────────────────────────────

describe('agent-bench policies', () => {
  it('exposes all three conditions in MODE_ORDER', () => {
    expect(MODE_ORDER).toContain('native-rg-read');
    expect(MODE_ORDER).toContain('sweet-search-tools');
    expect(MODE_ORDER).toContain('sweet-search-auto');
  });

  it('marks sweet-flavored conditions in SWEET_CONDITIONS', () => {
    expect(SWEET_CONDITIONS.has('sweet-search-tools')).toBe(true);
    expect(SWEET_CONDITIONS.has('sweet-search-auto')).toBe(true);
    expect(SWEET_CONDITIONS.has('native-rg-read')).toBe(false);
  });

  it('has system-prompt text for every condition', () => {
    for (const m of MODE_ORDER) {
      expect(POLICIES[m]).toBeTypeOf('string');
      expect(POLICIES[m].length).toBeGreaterThan(200);
    }
  });

  it('sweet-search-auto policy mentions ss-search and forbids native rg', () => {
    const p = POLICIES['sweet-search-auto'];
    expect(p).toMatch(/ss-search/);
    expect(p).toMatch(/MUST NOT/);
    expect(p).toMatch(/rg/);
  });

  it('sweet-search-auto allows ONLY ss-search, ss-read, sweet-search and orientation', () => {
    const rules = TOOL_RULES['sweet-search-auto'];
    expect(rules.allowedBashLeading).toContain('ss-search');
    expect(rules.allowedBashLeading).toContain('ss-read');
    expect(rules.allowedBashLeading).toContain('sweet-search');
    // Crucially, NOT ss-grep / ss-find / ss-semantic — those belong to the
    // separate sweet-search-tools (colgrep) condition.
    expect(rules.allowedBashLeading).not.toContain('ss-grep');
    expect(rules.allowedBashLeading).not.toContain('ss-find');
    expect(rules.allowedBashLeading).not.toContain('ss-semantic');
    expect(rules.readToolForbidden).toBe(true);
  });

  it('sweet-search-tools (colgrep) still allows ss-grep/ss-find/ss-semantic', () => {
    const rules = TOOL_RULES['sweet-search-tools'];
    expect(rules.allowedBashLeading).toContain('ss-grep');
    expect(rules.allowedBashLeading).toContain('ss-find');
    expect(rules.allowedBashLeading).toContain('ss-semantic');
    expect(rules.readToolForbidden).toBe(true);
  });

  it('native-rg-read forbids leading sweet-search and ss-* tokens', () => {
    const rules = TOOL_RULES['native-rg-read'];
    expect(rules.forbiddenBashLeading).toContain('sweet-search');
    expect(rules.forbiddenBashLeading).toContain('ss-search');
    expect(rules.forbiddenBashLeading).toContain('ss-grep');
    expect(rules.readToolForbidden).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Audit flags violations correctly per condition
// ────────────────────────────────────────────────────────────────────────────

function bashRun(commands) {
  return {
    toolCalls: commands.map((command, tIndex) => ({
      name: 'Bash', input: { command }, tIndex,
    })),
  };
}

describe('audit per condition', () => {
  it('sweet-search-auto: ss-search call passes', () => {
    const audit = auditRun('sweet-search-auto', bashRun(['ss-search "validate request"']));
    expect(audit.violationCount).toBe(0);
  });

  it('sweet-search-auto: ss-find call IS flagged (belongs to colgrep condition)', () => {
    const audit = auditRun('sweet-search-auto', bashRun(['ss-find "x" --regex "y"']));
    expect(audit.violationCount).toBeGreaterThan(0);
    expect(audit.violations[0].kind).toBe('not-in-allowlist');
    expect(audit.violations[0].detail).toBe('ss-find');
  });

  it('sweet-search-auto: ss-grep call IS flagged', () => {
    const audit = auditRun('sweet-search-auto', bashRun(['ss-grep "FST_ERR_"']));
    expect(audit.violationCount).toBeGreaterThan(0);
  });

  it('sweet-search-auto: native rg call IS flagged', () => {
    const audit = auditRun('sweet-search-auto', bashRun(['rg "validate" lib/']));
    expect(audit.violationCount).toBeGreaterThan(0);
    expect(audit.violations[0].detail).toBe('rg');
  });

  it('sweet-search-auto: cat | ss-search trick IS flagged at the leading cat', () => {
    const audit = auditRun('sweet-search-auto', bashRun(['cat lib/foo.js | head -50']));
    expect(audit.violationCount).toBeGreaterThan(0);
    // splitShellCompound splits on |, so we expect two leading-token violations
    expect(audit.violations.some(v => v.detail === 'cat')).toBe(true);
  });

  it('sweet-search-auto: ss-read confirmation read passes', () => {
    const audit = auditRun('sweet-search-auto', bashRun(['ss-read lib/validation.js 146 203']));
    expect(audit.violationCount).toBe(0);
  });

  it('sweet-search-tools: ss-search now flagged (belongs to auto condition)', () => {
    const audit = auditRun('sweet-search-tools', bashRun(['ss-search "x"']));
    expect(audit.violationCount).toBeGreaterThan(0);
    expect(audit.violations[0].detail).toBe('ss-search');
  });

  it('native-rg-read: ss-search call IS flagged', () => {
    const audit = auditRun('native-rg-read', bashRun(['ss-search "x"']));
    expect(audit.violationCount).toBeGreaterThan(0);
    expect(audit.violations[0].detail).toBe('ss-search');
  });

  it('native-rg-read: rg call passes (denylist mode)', () => {
    const audit = auditRun('native-rg-read', bashRun(['rg "FST_ERR_" lib/']));
    expect(audit.violationCount).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Route metadata parsing — claude-runner extracts SS_ROUTE_META trailers
// ────────────────────────────────────────────────────────────────────────────

import { _internal } from '../../eval/agent-read-workflows/claude-runner.js';

describe('SS_ROUTE_META trailer extraction', () => {
  it('parses route meta from a tool_result block emitted by ss-search', () => {
    const meta = {
      routedMode: 'hybrid', routeConfidence: 0.74,
      tokenBudget: 4000, tokensUsed: 1234, subMode: 'agent_full',
      resultCount: 3, tierCounts: { full: 1, preview: 2 }, sandwichCount: 0,
      serverProjectRoot: '/repos/fastify',
      requestedProjectRoot: '/repos/fastify',
      repoMatches: true,
    };
    const toolOutputText =
      '# ss-search: routed=hybrid budget=4000 used=1234\n' +
      '## #1 lib/foo.js:1-20 ...\n' +
      `\n<<SS_ROUTE_META>>${JSON.stringify(meta)}\n`;
    const stream =
      `${JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: [{ text: toolOutputText }],
            is_error: false,
          }],
        },
      })}\n`;
    const parsed = _internal.parseStreamJson(stream);
    expect(parsed.toolResults).toHaveLength(1);
    expect(parsed.toolResults[0].routeMeta).toEqual(meta);
  });

  it('returns no routeMeta when the trailer is absent', () => {
    const stream =
      `${JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: [{ text: 'just some plain text' }],
            is_error: false,
          }],
        },
      })}\n`;
    const parsed = _internal.parseStreamJson(stream);
    expect(parsed.toolResults[0].routeMeta).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Live retrieval canaries — cheap local-index checks, no model/judge calls
// ────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const canaryReposReady = ['fastify', 'gin', 'ripgrep'].every(repo =>
  existsSync(path.join(repoRoot, 'eval/repos', repo, '.sweet-search/codebase.db'))
);

async function searchRepo(repo, query) {
  const projectRoot = path.join(repoRoot, 'eval/repos', repo);
  const data = path.join(projectRoot, '.sweet-search');
  const searcher = new SweetSearch({
    projectRoot,
    graphDbPath: path.join(data, 'code-graph.db'),
    hnswPath: path.join(data, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(data, 'codebase-binary-hnsw.idx'),
    codebaseDbPath: path.join(data, 'codebase.db'),
    sparseGramIndexPath: path.join(data, 'codebase-sparse-grams.idx'),
    lateInteractionOptions: { indexPath: path.join(data, 'codebase-late-interaction.db') },
    useLateInteraction: true,
  });
  try {
    await searcher.init();
    const result = await searcher.search(query, {
      mode: 'auto',
      k: 5,
      rerank: false,
      useLateInteraction: true,
    });
    return result.results[0];
  } finally {
    searcher.close();
  }
}

describe.skipIf(!canaryReposReady)('live retrieval canaries', () => {
  it('keeps prior failure chunks out of top-1', async () => {
    const canaries = [
      {
        repo: 'fastify',
        q: 'what is kSchemaController and what does it do',
        assertTop1: r => expect([r.startLine, r.endLine]).not.toEqual([163, 164]),
      },
      {
        repo: 'ripgrep',
        q: 'what enum represents output mode for ripgrep results',
        assertTop1: r => {
          expect(r.metadata?.type || r.type).toMatch(/enum/i);
          expect(r.metadata?.name || r.name).toBe('Mode');
        },
      },
      {
        repo: 'ripgrep',
        q: 'where is the multi-line regex search implemented',
        assertTop1: r => expect(r.file || r.metadata?.file).not.toMatch(/testutil|tests?\/|test_util/i),
      },
      {
        repo: 'gin',
        q: 'how is request binding selected based on content type',
        assertTop1: r => expect(r.metadata?.name || r.name).toBeTruthy(),
      },
      {
        repo: 'gin',
        q: 'how does Gin bind JSON request bodies to Go structs',
        assertTop1: r => {
          const name = r.metadata?.name || r.name;
          const start = r.metadata?.startLine ?? r.startLine ?? 1;
          expect(!name && start <= 3).toBe(false);
        },
      },
    ];

    for (const canary of canaries) {
      const top1 = await searchRepo(canary.repo, canary.q);
      canary.assertTop1(top1);
    }
  }, 120_000);
});
