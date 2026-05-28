import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  RESTART_EXTRA_SEEDS,
  buildPrunerPlaceholderVariant,
  buildRestartVariants,
  conservativeLocalPrune,
  normalizeParetoPrompt,
  pickJointBest,
  renderVariantMd,
  writeRestartVariants,
} from '../../../core/prompt-optimization/sweep/gepa-restart-scaffold.mjs';
import {
  loadVariantsFromDir,
  parseFrontMatter,
  splitFrontMatter,
  validateVariant,
} from '../../../core/prompt-optimization/sweep/variant-loader.mjs';

let tmpDir = null;
afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

describe('gepa restart scaffold', () => {
  it('strips outer fences from normalized Pareto prompts', () => {
    expect(normalizeParetoPrompt('```\nhello [[ss-search]]\n```')).toBe('hello [[ss-search]]');
    expect(normalizeParetoPrompt('hello [[ss-search]]')).toBe('hello [[ss-search]]');
  });

  it('builds T_i variants from normalized front members plus three new seeds and a pruner placeholder', () => {
    const pareto = {
      front: [
        { id: 'old-fenced', hash: '0xaaa', sourceOp: 'reflective', finalScore: 0.4, prompt: '```\nfront [[ss-search]]\n```' },
        { id: 'old-plain', hash: '0xbbb', sourceOp: 'pruner', finalScore: 0.5, prompt: 'plain [[ss-grep]] [[no-match]]' },
      ],
    };
    const variants = buildRestartVariants({ pareto });
    // 2 front members + 3 extra seeds + 1 pruner placeholder = 6
    expect(variants).toHaveLength(2 + RESTART_EXTRA_SEEDS.length + 1);
    expect(variants.map((v) => v.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
    expect(variants[0].body).toBe('front [[ss-search]]');
    expect(variants[2].body).toMatch(/\[\[ss-grep\]\].*\[\[ss-find\]\].*\[\[ss-search\]\]/s);

    const placeholder = variants[variants.length - 1];
    expect(placeholder.frontMatter.source_id).toBe('pruner-placeholder-joint-best');
    expect(placeholder.frontMatter.expected_weaknesses).toContain('unverified-until-round-0-ablation');
    // Derived from the highest-finalScore member (old-plain at 0.5).
    expect(placeholder.body).toBe('plain [[ss-grep]] [[no-match]]');

    for (const variant of variants) {
      const { frontMatterBlock, body } = splitFrontMatter(renderVariantMd(variant));
      expect(body.trim().length).toBeGreaterThan(0);
      const res = validateVariant(parseFrontMatter(frontMatterBlock));
      expect(res.errors).toEqual([]);
      expect(res.ok).toBe(true);
    }
  });

  it('--no-pruner-placeholder (includePrunerPlaceholder: false) suppresses the derived seed', () => {
    const pareto = {
      front: [{ id: 'jb', hash: '0xaaa', finalScore: 0.5, prompt: 'jb [[ss-search]]' }],
    };
    const variants = buildRestartVariants({ pareto, includePrunerPlaceholder: false });
    expect(variants).toHaveLength(1 + RESTART_EXTRA_SEEDS.length);
    for (const v of variants) expect(v.frontMatter.source_id).not.toBe('pruner-placeholder-joint-best');
  });

  it('pickJointBest returns the highest-finalScore front member; null on empty front', () => {
    expect(pickJointBest({ front: [] })).toBeNull();
    expect(pickJointBest({})).toBeNull();
    const jb = pickJointBest({
      front: [
        { id: 'a', finalScore: 0.3, prompt: 'a' },
        { id: 'b', finalScore: 0.5, prompt: 'b' },
        { id: 'c', finalScore: 0.4, prompt: 'c' },
      ],
    });
    expect(jb.id).toBe('b');
  });

  it('conservativeLocalPrune is deterministic, preserves every [[token]] and code fence, only collapses blank-line runs and trims trailing whitespace', () => {
    const src = '```\nfenced [[ss-search]]\nbody\n```  \n\n\n\nrule [[ss-grep]] [[ss-grep]]   \n\n\nclose [[no-match]]';
    const pruned = conservativeLocalPrune(src);
    // [[token]] multiplicities preserved.
    const count = (s, p) => (s.match(new RegExp(p.replace(/[\[\]]/g, '\\$&'), 'g')) || []).length;
    expect(count(pruned, '[[ss-search]]')).toBe(count(src, '[[ss-search]]'));
    expect(count(pruned, '[[ss-grep]]')).toBe(count(src, '[[ss-grep]]'));
    expect(count(pruned, '[[no-match]]')).toBe(count(src, '[[no-match]]'));
    // Code fence preserved literally.
    expect(pruned).toContain('```\nfenced [[ss-search]]\nbody\n```');
    // No runs of 3+ blank lines remain.
    expect(pruned).not.toMatch(/\n{3,}/);
    // No trailing whitespace on any line.
    for (const line of pruned.split('\n')) expect(line).toBe(line.replace(/[\t ]+$/, ''));
    // Deterministic: idempotent on second pass.
    expect(conservativeLocalPrune(pruned)).toBe(pruned);
  });

  it('buildPrunerPlaceholderVariant strips outer fence, applies local prune, and labels source_id', () => {
    const pareto = {
      front: [
        { id: 'jb', hash: '0xfeed', finalScore: 0.55, prompt: '```\njb prompt [[ss-search]]\n\n\n\nrule [[ss-grep]]   \n```' },
        { id: 'other', hash: '0xbeef', finalScore: 0.42, prompt: 'other [[ss-find]]' },
      ],
    };
    const v = buildPrunerPlaceholderVariant(pareto, 7);
    expect(v).not.toBeNull();
    expect(v.id).toBe('T7');
    expect(v.frontMatter.source_id).toBe('pruner-placeholder-joint-best');
    expect(v.frontMatter.source_hash).toBe('0xfeed');
    expect(v.body).not.toMatch(/^```/);
    expect(v.body).not.toMatch(/```$/);
    expect(v.body).toContain('[[ss-search]]');
    expect(v.body).toContain('[[ss-grep]]');
    expect(v.body).not.toMatch(/\n{3,}/);
    expect(v.body.split('\n').every((line) => line === line.replace(/[\t ]+$/, ''))).toBe(true);
  });

  it('buildPrunerPlaceholderVariant returns null on empty front', () => {
    expect(buildPrunerPlaceholderVariant({ front: [] }, 1)).toBeNull();
    expect(buildPrunerPlaceholderVariant({ front: [{ id: 'x', prompt: '' }] }, 1)).toBeNull();
  });

  it('writes a restart slate that variant-loader can load from a custom directory', () => {
    tmpDir = mkdtempSync(path.join(process.cwd(), 'core/prompt-optimization/data/results/p7-restart-test-'));
    const variants = buildRestartVariants({
      pareto: { front: [{ id: 'old', hash: '0xaaa', prompt: 'plain [[ss-search]]' }] },
    });
    writeRestartVariants({ variants, outDir: tmpDir });
    const loaded = loadVariantsFromDir(tmpDir);
    expect(loaded.map((v) => v.id)).toEqual(variants.map((v) => v.id));
    expect(loaded[0].body.trim()).toBe('plain [[ss-search]]');
  });
});
