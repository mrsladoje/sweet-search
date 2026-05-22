/**
 * Unit tests for core/prompt-optimization/sweep/author-probes.mjs.
 *
 * Covers:
 *  1. Smoke probes: all smoke:true, no duplicate IDs, valid against ProbeSchema.
 *  2. stratifiedSplit determinism: same seed → identical split; different seed → different.
 *  3. Language stratification: each language's probes distributed across partitions
 *     in the expected proportions (dev/heldout/vault). The split produces ONLY
 *     dev/held-out/vault — NO `rotation` bucket (M12, §5.3 is a standalone file).
 *  4. Per-language vault count: number (uniform) OR { language: count } map summing
 *     to 25 across 10 languages (§5.8). Leftover/shortfall surfaces as a RangeError.
 *  5. On-disk smoke fixture loads and validates cleanly.
 *
 * DOES NOT test real prereg probe content — that is a separate human workstream.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import {
  generateSmokeProbes,
  stratifiedSplit,
  validate,
  OOD_LANGUAGES,
  IN_DISTRIBUTION,
  COUNTER_PROBE_REWRITE_PROMPT,
  makePathologyProbeTemplate,
  makeDistractorProbeTemplate,
} from '../../../core/prompt-optimization/sweep/author-probes.mjs';

import { ProbeSchema, validateProbes, STRATA, DIFFICULTIES } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal valid probe for split-testing; id must be unique. */
function makeProbe(id, language, stratum = 'literal-lookup', difficulty = 'easy') {
  return {
    id,
    repo: `test-${language}-repo`,
    language,
    stratum,
    difficulty,
    query: `Find something in ${id}`,
    expectedFiles: [],
    expectedSymbols: [],
    expectedFacts: [],
    expectedNoMatch: false,
    max_turns: 3,
  };
}

/** Build a synthetic probe set: n probes per language for each of the given languages. */
function makeProbeSet(languages, nPerLang, baseStratum = 'literal-lookup') {
  const probes = [];
  languages.forEach((lang, li) => {
    for (let i = 0; i < nPerLang; i++) {
      const stratum = STRATA[i % STRATA.length];
      const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
      probes.push(makeProbe(`${lang}-probe-${i}`, lang, stratum, difficulty));
    }
  });
  return probes;
}

// ─── 1. Smoke probe validation ────────────────────────────────────────────────

describe('generateSmokeProbes', () => {
  const smokeProbes = generateSmokeProbes();

  it('returns a non-empty array', () => {
    expect(Array.isArray(smokeProbes)).toBe(true);
    expect(smokeProbes.length).toBeGreaterThan(0);
  });

  it('all smoke probes have smoke:true', () => {
    for (const p of smokeProbes) {
      expect(p.smoke).toBe(true);
    }
  });

  it('no duplicate probe IDs', () => {
    const ids = smokeProbes.map(p => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all smoke probes pass ProbeSchema validation', () => {
    for (const p of smokeProbes) {
      const result = ProbeSchema.safeParse(p);
      if (!result.success) {
        throw new Error(`Probe ${p.id} failed validation: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      }
    }
  });

  it('validateProbes returns ok:true on the smoke set', () => {
    const result = validateProbes(smokeProbes);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('covers at least 2 distinct strata', () => {
    const strata = new Set(smokeProbes.map(p => p.stratum));
    expect(strata.size).toBeGreaterThanOrEqual(2);
  });

  it('includes at least one no-match probe with expectedNoMatch:true', () => {
    const noMatch = smokeProbes.filter(p => p.stratum === 'no-match');
    expect(noMatch.length).toBeGreaterThanOrEqual(1);
    for (const p of noMatch) {
      expect(p.expectedNoMatch).toBe(true);
    }
  });

  it('all non-no-match probes have expectedNoMatch:false', () => {
    const regular = smokeProbes.filter(p => p.stratum !== 'no-match');
    for (const p of regular) {
      expect(p.expectedNoMatch).toBe(false);
    }
  });

  it('all smoke probes have a non-empty id, repo, language, query', () => {
    for (const p of smokeProbes) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.repo.length).toBeGreaterThan(0);
      expect(p.language.length).toBeGreaterThan(0);
      expect(p.query.length).toBeGreaterThan(0);
    }
  });

  it('all probes have valid stratum and difficulty values', () => {
    for (const p of smokeProbes) {
      expect(STRATA).toContain(p.stratum);
      expect(DIFFICULTIES).toContain(p.difficulty);
    }
  });

  it('every smoke probe targets an in-distribution repo (§5.0 consistency)', () => {
    const inDistRepos = new Set(IN_DISTRIBUTION.map(e => e.repo));
    for (const p of smokeProbes) {
      expect(inDistRepos.has(p.repo)).toBe(true);
    }
  });

  it('no-match probes have empty gold; match probes have non-empty gold', () => {
    for (const p of smokeProbes) {
      if (p.expectedNoMatch) {
        expect(p.expectedFiles).toEqual([]);
        expect(p.expectedSymbols).toEqual([]);
      } else {
        expect(p.expectedFiles.length + p.expectedSymbols.length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── 2. stratifiedSplit determinism ──────────────────────────────────────────

describe('stratifiedSplit — determinism', () => {
  const langs = ['javascript', 'python', 'rust'];
  // Exactly dev(4)+heldout(3)+vault(2) = 9 per language — the split now enforces an
  // exact accounting (no remainder bucket), so each group must consume exactly that.
  const probes = makeProbeSet(langs, 9);

  it('same seed → identical split (ids match exactly)', () => {
    const r1 = stratifiedSplit({ probes, seed: 42 });
    const r2 = stratifiedSplit({ probes, seed: 42 });
    expect(r1.dev.map(p => p.id)).toEqual(r2.dev.map(p => p.id));
    expect(r1.heldout.map(p => p.id)).toEqual(r2.heldout.map(p => p.id));
    expect(r1.vault.map(p => p.id)).toEqual(r2.vault.map(p => p.id));
  });

  it('different seed → different split (at least one partition differs)', () => {
    const r42  = stratifiedSplit({ probes, seed: 42 });
    const r999 = stratifiedSplit({ probes, seed: 999 });
    // With 27 probes spread over 3 languages, the shuffles should differ for at
    // least one language. Assert that at least one partition's id list differs.
    const devSame = JSON.stringify(r42.dev.map(p => p.id)) === JSON.stringify(r999.dev.map(p => p.id));
    const heldSame = JSON.stringify(r42.heldout.map(p => p.id)) === JSON.stringify(r999.heldout.map(p => p.id));
    expect(devSame && heldSame).toBe(false);
  });

  it('all probes appear exactly once across all partitions', () => {
    const r = stratifiedSplit({ probes, seed: 42 });
    const all = [...r.dev, ...r.heldout, ...r.vault];
    expect(all.length).toBe(probes.length);
    const ids = new Set(all.map(p => p.id));
    expect(ids.size).toBe(probes.length);
  });

  it('returns exactly the dev/heldout/vault partitions as arrays — NO rotation key (M12)', () => {
    const r = stratifiedSplit({ probes, seed: 42 });
    expect(Array.isArray(r.dev)).toBe(true);
    expect(Array.isArray(r.heldout)).toBe(true);
    expect(Array.isArray(r.vault)).toBe(true);
    // §5.3 rotation pool is a STANDALONE file, not a split remainder — the split
    // must never emit a `rotation` bucket (or anything that could be mistaken for it).
    expect('rotation' in r).toBe(false);
    expect(r.rotation).toBeUndefined();
    expect(Object.keys(r).sort()).toEqual(['dev', 'heldout', 'vault']);
  });
});

// ─── 3. Language stratification ───────────────────────────────────────────────

describe('stratifiedSplit — language stratification', () => {
  it('each language gets exactly perLanguage.dev probes in dev', () => {
    const langs = ['go', 'rust', 'python', 'javascript'];
    const probes = makeProbeSet(langs, 9); // 4+3+2 = 9 per lang
    const r = stratifiedSplit({ probes, seed: 42, perLanguage: { dev: 4, heldout: 3, vault: 2 } });

    for (const lang of langs) {
      expect(r.dev.filter(p => p.language === lang).length).toBe(4);
    }
  });

  it('with exactly dev+heldout+vault per language, counts match perLanguage defaults', () => {
    const langs = ['go', 'rust', 'python'];
    const probes = makeProbeSet(langs, 9); // 9 per lang → 4+3+2, no remainder
    const r = stratifiedSplit({ probes, seed: 42 });

    for (const lang of langs) {
      expect(r.dev.filter(p => p.language === lang).length).toBe(4);
      expect(r.heldout.filter(p => p.language === lang).length).toBe(3);
      expect(r.vault.filter(p => p.language === lang).length).toBe(2);
    }
  });

  it('different languages do not interfere — adding a new language leaves existing splits unchanged', () => {
    const langA = ['rust'];
    const langB = ['python'];
    const probesA = makeProbeSet(langA, 9);
    const probesB = makeProbeSet(langB, 9);

    const rA    = stratifiedSplit({ probes: probesA, seed: 42 });
    const rAB   = stratifiedSplit({ probes: [...probesA, ...probesB], seed: 42 });

    // The rust partition ids must be identical regardless of python probes being present
    const rustDevA  = rA.dev.filter(p => p.language === 'rust').map(p => p.id).sort();
    const rustDevAB = rAB.dev.filter(p => p.language === 'rust').map(p => p.id).sort();
    expect(rustDevA).toEqual(rustDevAB);
  });

  it('perLanguage override is honoured', () => {
    const langs = ['go', 'rust'];
    const probes = makeProbeSet(langs, 11); // 5+4+2 = 11 per lang
    const r = stratifiedSplit({ probes, seed: 42, perLanguage: { dev: 5, heldout: 4, vault: 2 } });

    for (const lang of langs) {
      expect(r.dev.filter(p => p.language === lang).length).toBe(5);
      expect(r.heldout.filter(p => p.language === lang).length).toBe(4);
      expect(r.vault.filter(p => p.language === lang).length).toBe(2);
    }
  });

  it('empty probe array returns empty dev/heldout/vault partitions (no rotation)', () => {
    const r = stratifiedSplit({ probes: [], seed: 42 });
    expect(r.dev.length).toBe(0);
    expect(r.heldout.length).toBe(0);
    expect(r.vault.length).toBe(0);
    expect('rotation' in r).toBe(false);
  });
});

// ─── 3b. Per-language vault count (number | map) → vault total 25 (§5.8) ───────

describe('stratifiedSplit — per-language vault count (§5.8)', () => {
  // 10 in-distribution languages, vault 2–3 per language summing to 25.
  const TEN_LANGS = [
    'javascript', 'typescript', 'go', 'python', 'rust',
    'java', 'cpp', 'csharp', 'ruby', 'kotlin',
  ];
  // 3/3/3/3/3 + 2/2/2/2/2 = 25 vault across 10 langs.
  const VAULT_MAP = {
    javascript: 3, typescript: 3, go: 3, python: 3, rust: 3,
    java: 2, cpp: 2, csharp: 2, ruby: 2, kotlin: 2,
  };

  /** Build a probe set with EXACTLY dev+heldout+vault[lang] probes per language. */
  function makeBalancedSet(vaultMap, dev = 4, heldout = 3) {
    const probes = [];
    for (const lang of TEN_LANGS) {
      const n = dev + heldout + vaultMap[lang];
      for (let i = 0; i < n; i++) {
        const stratum = STRATA[i % STRATA.length];
        const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
        probes.push(makeProbe(`${lang}-probe-${i}`, lang, stratum, difficulty));
      }
    }
    return probes;
  }

  it('vault map yields dev=4/lang, heldout=3/lang, and vault per the map (totals 40/30/25)', () => {
    const probes = makeBalancedSet(VAULT_MAP);
    const r = stratifiedSplit({ probes, seed: 42, perLanguage: { dev: 4, heldout: 3, vault: VAULT_MAP } });

    expect(r.dev.length).toBe(40);     // 4 × 10
    expect(r.heldout.length).toBe(30); // 3 × 10
    expect(r.vault.length).toBe(25);   // 3×5 + 2×5

    for (const lang of TEN_LANGS) {
      expect(r.dev.filter(p => p.language === lang).length).toBe(4);
      expect(r.heldout.filter(p => p.language === lang).length).toBe(3);
      expect(r.vault.filter(p => p.language === lang).length).toBe(VAULT_MAP[lang]);
    }
    // M12: still no rotation bucket even on the canonical 40/30/25 input.
    expect('rotation' in r).toBe(false);
  });

  it('uniform numeric vault still works (vault=2/lang → 20 total)', () => {
    const uniformMap = Object.fromEntries(TEN_LANGS.map(l => [l, 2]));
    const probes = makeBalancedSet(uniformMap);
    const r = stratifiedSplit({ probes, seed: 42, perLanguage: { dev: 4, heldout: 3, vault: 2 } });
    expect(r.vault.length).toBe(20);
    for (const lang of TEN_LANGS) {
      expect(r.vault.filter(p => p.language === lang).length).toBe(2);
    }
  });

  it('vault map missing a language present in the probe set throws a clear RangeError', () => {
    const probes = makeBalancedSet(VAULT_MAP);
    const incompleteMap = { ...VAULT_MAP };
    delete incompleteMap.kotlin;
    expect(() => stratifiedSplit({
      probes, seed: 42, perLanguage: { dev: 4, heldout: 3, vault: incompleteMap },
    })).toThrow(/no entry for language "kotlin"/);
  });
});

// ─── 3c. Leftover / shortfall surface as RangeError (no silent drop) ──────────

describe('stratifiedSplit — leftover / shortfall accounting (M12)', () => {
  it('a language with MORE probes than dev+heldout+vault throws naming the language + leftover', () => {
    const langs = ['rust', 'go'];
    // 11 per lang but dev+heldout+vault = 9 → 2 leftover per language (rust sorts first).
    const probes = makeProbeSet(langs, 11);
    expect(() => stratifiedSplit({ probes, seed: 42 }))
      .toThrow(/language "go".*11 probes.*2 leftover/s);
  });

  it('leftover error does NOT silently drop probes (it throws, not truncates)', () => {
    const probes = makeProbeSet(['python'], 10); // 1 leftover (10 vs 9)
    expect(() => stratifiedSplit({ probes, seed: 42 })).toThrow(RangeError);
  });

  it('a language with FEWER probes than required throws naming the language + shortfall', () => {
    // 2 probes, dev+heldout+vault = 9 → short by 7. Old behavior dumped all to dev;
    // new behavior surfaces the shortfall instead of silently under-filling.
    const probes = [makeProbe('rust-0', 'rust'), makeProbe('rust-1', 'rust')];
    expect(() => stratifiedSplit({ probes, seed: 42 }))
      .toThrow(/language "rust".*only 2 probes.*short by 7/s);
  });

  it('exact count (dev+heldout+vault) does NOT throw', () => {
    const probes = makeProbeSet(['go'], 9);
    expect(() => stratifiedSplit({ probes, seed: 42 })).not.toThrow();
  });
});

// ─── 4. On-disk smoke fixture ─────────────────────────────────────────────────

describe('p7-smoke-probes.json on-disk fixture', () => {
  const fixturePath = fileURLToPath(
    new URL('../../../core/prompt-optimization/data/p7-smoke-probes.json', import.meta.url)
  );

  it('fixture file is loadable JSON', () => {
    const raw = readFileSync(fixturePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('fixture has a _note field warning it is DRY-RUN', () => {
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
    expect(typeof raw._note).toBe('string');
    expect(raw._note.toLowerCase()).toMatch(/dry.run|not prereg/i);
  });

  it('fixture.probes validates cleanly via validateProbes', () => {
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const probes = raw.probes ?? raw;
    const result = validateProbes(Array.isArray(probes) ? probes : []);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('all fixture probes have smoke:true', () => {
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const probes = raw.probes ?? [];
    expect(probes.length).toBeGreaterThan(0);
    for (const p of probes) {
      expect(p.smoke).toBe(true);
    }
  });

  it('fixture probe IDs match generateSmokeProbes() output', () => {
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const fileIds = (raw.probes ?? []).map(p => p.id).sort();
    const codeIds = generateSmokeProbes().map(p => p.id).sort();
    expect(fileIds).toEqual(codeIds);
  });
});

// ─── 5. validate() wrapper ────────────────────────────────────────────────────

describe('validate()', () => {
  it('returns ok:true for valid probes', () => {
    const probes = [makeProbe('v-001', 'go')];
    expect(validate(probes).ok).toBe(true);
  });

  it('returns ok:false and errors for invalid probes', () => {
    const bad = [{ id: '', repo: 'x', language: 'go' }]; // missing required fields
    const result = validate(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('detects duplicate ids', () => {
    const probes = [makeProbe('dup-001', 'go'), makeProbe('dup-001', 'rust')];
    const result = validate(probes);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.message.includes('duplicate'))).toBe(true);
  });
});

// ─── 6. Catalog constants ─────────────────────────────────────────────────────

describe('catalog constants', () => {
  it('OOD_LANGUAGES has exactly 8 entries matching §3.5.1', () => {
    expect(OOD_LANGUAGES.length).toBe(8);
    for (const lang of ['C', 'Dart', 'Elixir', 'Lua', 'PHP', 'Scala', 'Swift', 'Zig']) {
      expect(OOD_LANGUAGES).toContain(lang);
    }
  });

  it('IN_DISTRIBUTION has exactly 10 entries matching §5.0', () => {
    expect(IN_DISTRIBUTION.length).toBe(10);
    const langs = IN_DISTRIBUTION.map(e => e.language);
    for (const l of ['javascript', 'typescript', 'go', 'python', 'rust', 'java', 'cpp', 'csharp', 'ruby', 'kotlin']) {
      expect(langs).toContain(l);
    }
  });

  it('IN_DISTRIBUTION entries carry a non-empty repo and on-disk path (§5.0)', () => {
    for (const e of IN_DISTRIBUTION) {
      expect(typeof e.repo).toBe('string');
      expect(e.repo.length).toBeGreaterThan(0);
      expect(typeof e.path).toBe('string');
      expect(e.path).toMatch(/^eval\//);
      // Guard against the placeholder repo names from the prior draft.
      expect(e.repo).not.toMatch(/^ast-tester-/);
    }
  });

  it('IN_DISTRIBUTION repos match the §5.0 spec table exactly', () => {
    const byLang = Object.fromEntries(IN_DISTRIBUTION.map(e => [e.language, e.repo]));
    expect(byLang).toMatchObject({
      javascript: 'fastify',
      typescript: 'ai-chatbot',
      go: 'gin',
      python: 'flask',
      rust: 'ripgrep',
      java: 'gson',
      cpp: 'highway',
      csharp: 'garnet',
      ruby: 'sinatra',
      kotlin: 'kotlinx.coroutines',
    });
  });

  it('COUNTER_PROBE_REWRITE_PROMPT contains template placeholders', () => {
    expect(COUNTER_PROBE_REWRITE_PROMPT).toContain('{{QUERY}}');
    expect(COUNTER_PROBE_REWRITE_PROMPT).toContain('{{REPO}}');
    expect(COUNTER_PROBE_REWRITE_PROMPT).toContain('{{LANGUAGE}}');
    // §5.7: the rewrite is hostile to a NAMED P6 heuristic, injected here.
    expect(COUNTER_PROBE_REWRITE_PROMPT).toContain('{{HEURISTIC}}');
  });
});

// ─── 7. Template helpers ──────────────────────────────────────────────────────

describe('makePathologyProbeTemplate', () => {
  it('returns an object with the correct pathology kind', () => {
    for (const kind of ['wrong-extension', 'flooding', 'rabbit-hole']) {
      const t = makePathologyProbeTemplate(kind);
      expect(t.pathology).toBe(kind);
      expect(t.tier).toBe('deferred-pathology');
      expect(t.smoke).toBe(false);
    }
  });

  it('rabbit-hole template has multi-file-flow stratum', () => {
    const t = makePathologyProbeTemplate('rabbit-hole');
    expect(t.stratum).toBe('multi-file-flow');
  });
});

describe('makeDistractorProbeTemplate', () => {
  it('returns an object with distractor:true', () => {
    const t = makeDistractorProbeTemplate();
    expect(t.distractor).toBe(true);
    expect(t.smoke).toBe(false);
  });
});
