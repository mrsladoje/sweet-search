/**
 * Repo-path resolution for the GEPA evaluator (gepa-evaluate.resolveRepoCwd).
 *
 * Regression guard for a run-corrupting bug found pre-$400-run: the
 * dev/held-out/vault probe sets span 10 languages across 10 repos. Five live
 * under eval/repos/<repo> (P6 anchors); five live under
 * eval/ast-tester-probes/_repos/<language> (SHA-locked ast-tester repos). The
 * evaluator previously did path.join('eval/repos', probe.repo), which finds only
 * the anchors — so every cpp/csharp/java/kotlin/ruby probe (~50% of each set)
 * resolved to a nonexistent dir, the ss-* shims exit(2) "no index", and the
 * probe silently scored ~0. resolveRepoCwd now consults author-probes
 * IN_DISTRIBUTION (single source of truth) and falls back to <reposDir>/<repo>.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRepoCwd } from '../../../core/prompt-optimization/sweep/gepa-evaluate.mjs';
import { IN_DISTRIBUTION } from '../../../core/prompt-optimization/sweep/author-probes.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_REPOS = path.join(REPO_ROOT, 'eval', 'repos');

function loadProbes(rel) {
  const doc = JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
  return doc.probes ?? doc;
}

const TIERS = [
  ['dev', 'core/prompt-optimization/data/p7-dev-probes.json'],
  ['heldout', 'core/prompt-optimization/data/frozen/p7-heldout-probes.json'],
  ['vault', 'core/prompt-optimization/data/frozen/p7-vault-probes.json'],
  ['smoke', 'core/prompt-optimization/data/p7-smoke-probes.json'],
];

// Expected absolute path per (language:repo), straight from the single source of truth.
const EXPECTED = new Map(IN_DISTRIBUTION.map((x) => [`${x.language}:${x.repo}`, path.resolve(REPO_ROOT, x.path)]));

// ─── known mappings (hermetic) ────────────────────────────────────────────────

describe('resolveRepoCwd — known mappings', () => {
  it('maps the 5 P6 anchors to eval/repos/<repo>', () => {
    expect(resolveRepoCwd({ repo: 'flask', language: 'python' }, { reposDir: DEFAULT_REPOS }))
      .toBe(path.join(REPO_ROOT, 'eval/repos/flask'));
    expect(resolveRepoCwd({ repo: 'ripgrep', language: 'rust' }, { reposDir: DEFAULT_REPOS }))
      .toBe(path.join(REPO_ROOT, 'eval/repos/ripgrep'));
  });

  it('maps the 5 ast-tester repos to eval/ast-tester-probes/_repos/<language>', () => {
    const cases = [
      ['highway', 'cpp', 'eval/ast-tester-probes/_repos/cpp'],
      ['gson', 'java', 'eval/ast-tester-probes/_repos/java'],
      ['garnet', 'csharp', 'eval/ast-tester-probes/_repos/csharp'],
      ['kotlinx.coroutines', 'kotlin', 'eval/ast-tester-probes/_repos/kotlin'],
      ['sinatra', 'ruby', 'eval/ast-tester-probes/_repos/ruby'],
    ];
    for (const [repo, language, rel] of cases) {
      expect(resolveRepoCwd({ repo, language }, { reposDir: DEFAULT_REPOS }))
        .toBe(path.join(REPO_ROOT, rel));
    }
  });

  it('resolves by repo name even when language is absent', () => {
    expect(resolveRepoCwd({ repo: 'highway' }, { reposDir: DEFAULT_REPOS }))
      .toBe(path.join(REPO_ROOT, 'eval/ast-tester-probes/_repos/cpp'));
  });

  it('falls back to <reposDir>/<repo> for an unknown repo', () => {
    expect(resolveRepoCwd({ repo: 'future-repo', language: 'go' }, { reposDir: DEFAULT_REPOS }))
      .toBe(path.join(DEFAULT_REPOS, 'future-repo'));
  });

  it('throws when probe.repo is missing', () => {
    expect(() => resolveRepoCwd({}, { reposDir: DEFAULT_REPOS })).toThrow(TypeError);
  });
});

// ─── every authored probe resolves via the map, never the naive fallback ───────

describe('every authored probe resolves to its IN_DISTRIBUTION path (hermetic)', () => {
  for (const [tier, rel] of TIERS) {
    it(`${tier}: no probe falls through to eval/repos/<repo> by mistake`, () => {
      const probes = loadProbes(rel);
      expect(probes.length).toBeGreaterThan(0);
      const wrong = [];
      for (const p of probes) {
        const key = `${p.language}:${p.repo}`;
        const expected = EXPECTED.get(key);
        const got = resolveRepoCwd(p, { reposDir: DEFAULT_REPOS });
        if (!expected) {
          wrong.push(`${p.id} (${key}) not in IN_DISTRIBUTION`);
        } else if (got !== expected) {
          wrong.push(`${p.id} (${key}) -> ${got} (expected ${expected})`);
        }
      }
      expect(wrong, `mis-resolved probes:\n${wrong.join('\n')}`).toEqual([]);
    });
  }
});

// ─── readiness: resolved dirs exist + are line-span indexed (env-dependent) ─────
// Skipped automatically where the local indexes are absent (e.g. CI). On an
// indexed dev box this is the "safe to spend the $400" gate.

const INDEXES_PRESENT = existsSync(path.join(REPO_ROOT, 'eval/repos/flask/.sweet-search/codebase.db'));

describe.skipIf(!INDEXES_PRESENT)('readiness — every probe repo is indexed with line-span LI', () => {
  for (const [tier, rel] of TIERS) {
    it(`${tier}: all probe repos have codebase.db + line-span LI`, () => {
      const probes = loadProbes(rel);
      const bad = [];
      for (const p of probes) {
        const cwd = resolveRepoCwd(p, { reposDir: DEFAULT_REPOS });
        const cb = existsSync(path.join(cwd, '.sweet-search', 'codebase.db'));
        const li = existsSync(path.join(cwd, '.sweet-search', 'codebase-late-interaction.db'));
        if (!cb || !li) {
          bad.push(`${p.id} (${p.language}/${p.repo}) -> ${cwd} [${cb ? '' : 'no codebase.db '}${li ? '' : 'no LI'}]`);
        }
      }
      expect(bad, `unindexed probe repos:\n${bad.join('\n')}`).toEqual([]);
    });
  }
});
