import { describe, it, expect } from 'vitest';
import { injectAnchorCandidates, extractStrictAnchorNames } from '../../core/search/search-anchor.js';

describe('extractStrictAnchorNames', () => {
  it('captures PascalCase and camelCase identifiers', () => {
    const out = extractStrictAnchorNames('how does the FastifyInstance interface expose handleHTTPRequest for kSchemaParams');
    expect([...out]).toEqual(expect.arrayContaining(['FastifyInstance', 'handleHTTPRequest', 'kSchemaParams']));
  });

  it('captures snake_case identifiers', () => {
    const out = extractStrictAnchorNames('where is calculate_path defined');
    expect([...out]).toContain('calculate_path');
  });

  it('does NOT fire on plain English words', () => {
    const out = extractStrictAnchorNames('how does request lifecycle work and what does config default mean');
    // None of these have uppercase or underscore
    expect([...out]).toEqual([]);
  });

  it('captures ALL_CAPS constants', () => {
    const out = extractStrictAnchorNames('what is MAX_BUFFER_SIZE');
    expect([...out]).toContain('MAX_BUFFER_SIZE');
  });

  it('rejects tokens shorter than 3 chars even if uppercased', () => {
    const out = extractStrictAnchorNames('is X y AB or CD');
    expect([...out]).toEqual([]);
  });
});

// Minimal mocks for CodeGraphRepository and LateInteractionIndex.
// IAR works against a stable contract: findEntitiesByAnyName(names) returns
// a small list of entity records; documents Map maps id → { metadata }.

function mockRepo(entitiesByName) {
  return {
    findEntitiesByAnyName(names) {
      const wantSet = new Set(names.map(s => String(s).toLowerCase()));
      const out = [];
      for (const [name, list] of Object.entries(entitiesByName)) {
        if (!wantSet.has(name.toLowerCase())) continue;
        out.push(...list);
      }
      return out;
    },
  };
}

function mockLi(docs) {
  return {
    documents: new Map(docs.map((d, i) => [d.id || `c${i + 1}`, {
      metadata: d.metadata,
      content: d.content || '',
    }])),
  };
}

describe('injectAnchorCandidates', () => {
  it('injects a missing entity chunk when query names it', () => {
    const repo = mockRepo({
      Default: [
        { name: 'Default', type: 'function', filePath: 'gin.go', startLine: 235, endLine: 241 },
      ],
    });
    const li = mockLi([
      { id: 'cA', metadata: { file: 'gin.go', startLine: 230, endLine: 260, name: null, type: 'code' }, content: 'func Default(...) ...' },
      // a distractor chunk in same file
      { id: 'cB', metadata: { file: 'gin.go', startLine: 60, endLine: 95, name: null, type: 'code' }, content: 'RouteInfo etc' },
    ]);
    const fused = [
      // Distractor wins on dense — IAR must inject the right chunk
      { id: 'cB', metadata: { file: 'gin.go', startLine: 60, endLine: 95 }, score: 0.55 },
    ];
    const { results, stats } = injectAnchorCandidates(fused, 'what is the Default function', {
      codeGraphRepo: repo,
      lateInteractionIndex: li,
    });
    expect(stats.entitiesFound).toBe(1);
    expect(stats.newCandidates).toBe(1);
    const injected = results.find(r => r._anchorInjected);
    expect(injected).toBeTruthy();
    expect(injected.metadata.file).toBe('gin.go');
    expect(injected.metadata.startLine).toBe(230);
    expect(injected.metadata.endLine).toBe(260);
    // Score competes but doesn't blow past a reasonable cap
    expect(injected.score).toBeGreaterThanOrEqual(0.5);
    expect(injected.score).toBeLessThanOrEqual(0.85);
  });

  it('boosts an existing fused result instead of double-adding it', () => {
    const repo = mockRepo({
      bsonBinding: [
        { name: 'bsonBinding', type: 'typeAlias', filePath: 'binding/bson.go', startLine: 14, endLine: 14 },
      ],
    });
    const li = mockLi([
      { id: 'cBson', metadata: { file: 'binding/bson.go', startLine: 1, endLine: 31, name: null, type: 'struct' } },
    ]);
    const fused = [
      { id: 'cBson', metadata: { file: 'binding/bson.go', startLine: 1, endLine: 31 }, score: 0.50 },
    ];
    const { results, stats } = injectAnchorCandidates(fused, 'what is bsonBinding', {
      codeGraphRepo: repo,
      lateInteractionIndex: li,
    });
    expect(stats.newCandidates).toBe(0);
    expect(stats.existingBoosted).toBe(1);
    expect(results.length).toBe(1);
    expect(results[0].score).toBeGreaterThan(0.50);
    expect(results[0]._anchorBoosted).toBe(true);
  });

  it('does NOT inject for plain English words even when an entity matches', () => {
    // The "request lifecycle" failure mode: query has no PascalCase/camelCase,
    // so IAR must not fire even if a `Request` entity exists.
    const repo = mockRepo({
      Request: [{ name: 'Request', type: 'function', filePath: 'lib/request.js', startLine: 1, endLine: 68 }],
    });
    const li = mockLi([{ id: 'cReq', metadata: { file: 'lib/request.js', startLine: 1, endLine: 68 } }]);
    const fused = [{ id: 'cI', metadata: { file: 'types/instance.d.ts', startLine: 120, endLine: 609 }, score: 0.7 }];
    const { results, stats } = injectAnchorCandidates(fused, 'how does the request lifecycle work', {
      codeGraphRepo: repo,
      lateInteractionIndex: li,
    });
    // Query has no strict-anchor tokens — Request shouldn't be pulled in
    expect(stats.hintCount).toBe(0);
    expect(stats.newCandidates).toBe(0);
    expect(results).toBe(fused);
  });

  it('is a no-op when query has no identifier-shaped tokens', () => {
    const repo = mockRepo({
      Default: [{ name: 'Default', type: 'function', filePath: 'a.go', startLine: 1, endLine: 5 }],
    });
    const li = mockLi([{ id: 'cA', metadata: { file: 'a.go', startLine: 1, endLine: 5 } }]);
    const fused = [{ id: 'cX', metadata: { file: 'b.go', startLine: 1, endLine: 5 }, score: 0.4 }];
    const { results, stats } = injectAnchorCandidates(fused, 'how to do it', {
      codeGraphRepo: repo,
      lateInteractionIndex: li,
    });
    expect(stats.hintCount).toBe(0);
    expect(stats.newCandidates).toBe(0);
    expect(results).toBe(fused);
  });

  it('returns the fused list untouched when ablation is set', () => {
    const repo = mockRepo({
      Mode: [{ name: 'Mode', type: 'enum', filePath: 'lowargs.rs', startLine: 100, endLine: 170 }],
    });
    const li = mockLi([{ id: 'c1', metadata: { file: 'lowargs.rs', startLine: 100, endLine: 170 } }]);
    const fused = [{ id: 'cX', metadata: { file: 'other.rs', startLine: 1, endLine: 5 }, score: 0.4 }];
    const { results, stats } = injectAnchorCandidates(fused, 'enum Mode', {
      codeGraphRepo: repo,
      lateInteractionIndex: li,
      ablations: new Set(['no-anchor-injection']),
    });
    expect(results).toBe(fused);
    expect(stats.entitiesFound).toBe(0);
  });

  it('prefers the smallest enclosing chunk when several overlap', () => {
    const repo = mockRepo({
      calculateAbsolutePath: [{
        name: 'calculateAbsolutePath', type: 'method',
        filePath: 'routergroup.go', startLine: 250, endLine: 260,
      }],
    });
    const li = mockLi([
      // two overlapping chunks; the tighter one should win
      { id: 'cBig', metadata: { file: 'routergroup.go', startLine: 1, endLine: 400, name: null, type: 'file' } },
      { id: 'cTight', metadata: { file: 'routergroup.go', startLine: 240, endLine: 280, name: null, type: 'method' } },
    ]);
    const { results } = injectAnchorCandidates(
      [],
      'where does it calculateAbsolutePath',
      { codeGraphRepo: repo, lateInteractionIndex: li }
    );
    const injected = results.find(r => r._anchorInjected);
    expect(injected.metadata.startLine).toBe(240);
    expect(injected.metadata.endLine).toBe(280);
  });

  it('handles missing repo or LI index gracefully', () => {
    const fused = [{ id: 'x', metadata: { file: 'a', startLine: 1, endLine: 5 }, score: 0.4 }];
    expect(injectAnchorCandidates(fused, 'Mode', {}).results).toBe(fused);
    expect(injectAnchorCandidates(fused, 'Mode', { codeGraphRepo: {} }).results).toBe(fused);
    expect(injectAnchorCandidates(fused, 'Mode', {
      codeGraphRepo: { findEntitiesByAnyName: () => [] },
      lateInteractionIndex: { documents: new Map() },
    }).stats.entitiesFound).toBe(0);
  });
});

// =============================================================================
// IAR uniqueness gate (KPR/SPAR pattern). See search-anchor.js for rationale.
// =============================================================================

function repoWithCounts(entitiesByName, countsByName) {
  return {
    findEntitiesByAnyName(names) {
      const wantSet = new Set(names.map(s => String(s).toLowerCase()));
      const out = [];
      for (const [name, list] of Object.entries(entitiesByName)) {
        if (!wantSet.has(name.toLowerCase())) continue;
        out.push(...list);
      }
      return out;
    },
    countEntitiesByAnyName(names) {
      const m = new Map();
      for (const n of names) {
        const lc = String(n).toLowerCase();
        if (countsByName[lc] != null) m.set(lc, countsByName[lc]);
      }
      return m;
    },
  };
}

describe('injectAnchorCandidates — uniqueness gate', () => {
  it('drops a hint whose entity count exceeds the ceiling', () => {
    // "Get" matches 65 entities → drop. "kSchemaCtx" matches 1 → keep.
    const repo = repoWithCounts(
      { kSchemaCtx: [{ name: 'kSchemaCtx', type: 'symbol', filePath: 'a.js', startLine: 10, endLine: 12 }] },
      { get: 65, kschemactx: 1 }
    );
    const li = mockLi([
      { id: 'cK', metadata: { file: 'a.js', startLine: 10, endLine: 12 } },
    ]);
    const { results, stats } = injectAnchorCandidates([], 'where does Get use kSchemaCtx', {
      codeGraphRepo: repo,
      lateInteractionIndex: li,
      uniquenessCeil: 8,
    });
    expect(stats.hintCount).toBe(2);
    expect(stats.hintsKept).toBe(1);
    expect(stats.droppedCommon).toEqual([{ hint: 'Get', count: 65 }]);
    // Only the kSchemaCtx-related entity gets injected
    expect(stats.entitiesFound).toBe(1);
    expect(results.find(r => r._anchorInjected)?.metadata.file).toBe('a.js');
  });

  it('keeps all hints when their counts are within the ceiling', () => {
    const repo = repoWithCounts(
      {
        kRouteContext: [{ name: 'kRouteContext', type: 'symbol', filePath: 'context.js', startLine: 5, endLine: 7 }],
        FastifyError: [{ name: 'FastifyError', type: 'class', filePath: 'errors.js', startLine: 50, endLine: 80 }],
      },
      { kroutecontext: 1, fastifyerror: 3 }
    );
    const li = mockLi([
      { id: 'c1', metadata: { file: 'context.js', startLine: 5, endLine: 7 } },
      { id: 'c2', metadata: { file: 'errors.js', startLine: 50, endLine: 80 } },
    ]);
    const { stats } = injectAnchorCandidates([], 'how does kRouteContext relate to FastifyError', {
      codeGraphRepo: repo,
      lateInteractionIndex: li,
      uniquenessCeil: 8,
    });
    expect(stats.hintCount).toBe(2);
    expect(stats.hintsKept).toBe(2);
    expect(stats.droppedCommon).toEqual([]);
    expect(stats.entitiesFound).toBe(2);
  });

  it('returns fused untouched when ALL hints exceed the ceiling', () => {
    const repo = repoWithCounts({}, { fastify: 46, reply: 27 });
    const li = mockLi([]);
    const fused = [{ id: 'orig', metadata: { file: 'x.js', startLine: 1, endLine: 5 }, score: 0.5 }];
    const { results, stats } = injectAnchorCandidates(fused, 'how does Fastify decorate Reply', {
      codeGraphRepo: repo,
      lateInteractionIndex: li,
      uniquenessCeil: 8,
    });
    expect(stats.hintsKept ?? 0).toBe(0);
    expect(stats.droppedCommon).toEqual(expect.arrayContaining([
      { hint: 'Fastify', count: 46 },
      { hint: 'Reply', count: 27 },
    ]));
    expect(results).toBe(fused);
  });

  it('disables the gate when uniquenessCeil = 0', () => {
    const repo = repoWithCounts(
      { Get: [{ name: 'Get', type: 'method', filePath: 'a.go', startLine: 1, endLine: 4 }] },
      { get: 65 }
    );
    const li = mockLi([{ id: 'cG', metadata: { file: 'a.go', startLine: 1, endLine: 4 } }]);
    const { stats } = injectAnchorCandidates([], 'what does Get do', {
      codeGraphRepo: repo,
      lateInteractionIndex: li,
      uniquenessCeil: 0,
    });
    expect(stats.droppedCommon).toEqual([]);
    expect(stats.entitiesFound).toBe(1);
  });

  it('preserves legacy behaviour when repo lacks countEntitiesByAnyName', () => {
    // Backward-compat: callers wired up before the new method must not break.
    const repoLegacy = {
      findEntitiesByAnyName(names) {
        if (names.includes('Mode') || names.some(n => n.toLowerCase() === 'mode')) {
          return [{ name: 'Mode', type: 'enum', filePath: 'a.rs', startLine: 1, endLine: 4 }];
        }
        return [];
      },
    };
    const li = mockLi([{ id: 'cM', metadata: { file: 'a.rs', startLine: 1, endLine: 4 } }]);
    const { stats } = injectAnchorCandidates([], 'enum Mode', {
      codeGraphRepo: repoLegacy,
      lateInteractionIndex: li,
      uniquenessCeil: 8,
    });
    expect(stats.entitiesFound).toBe(1);
    // No counts → empty droppedCommon, gate is a no-op.
    expect(stats.droppedCommon ?? []).toEqual([]);
  });
});
