import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  PRUNER_PLACEHOLDER_MARKER,
  RESTART_EXTRA_SEEDS,
  buildPrunerPlaceholderVariant,
  buildRestartVariants,
  conservativeLocalPrune,
  normalizeParetoPrompt,
  pickJointBest,
  renderVariantMd,
  writeRestartVariants,
} from '../../../core/prompt-optimization/sweep/gepa-restart-scaffold.mjs';
import { hashContent } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';
import {
  loadVariantsFromDir,
  parseFrontMatter,
  splitFrontMatter,
  validateVariant,
} from '../../../core/prompt-optimization/sweep/variant-loader.mjs';
import {
  makeDryRunCallModel,
  makeDryRunEvaluate,
  normalizeVariant,
  runGepa,
} from '../../../core/prompt-optimization/sweep/gepa.mjs';

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
    // Derived from the highest-finalScore member (old-plain at 0.5). The
    // placeholder body is the joint-best body + PRUNER_PLACEHOLDER_MARKER
    // (D2 fix) so the hash always differs from the parent.
    expect(placeholder.body).toContain('plain [[ss-grep]] [[no-match]]');
    expect(placeholder.body).toContain('pruner-placeholder');
    expect(placeholder.body).not.toBe('plain [[ss-grep]] [[no-match]]');

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

  // D2 regression: T8 pruner-placeholder hash must differ from T3 (joint-best)
  // even on a byte-identical, already-clean parent prompt where
  // conservativeLocalPrune is a no-op. Without this, gepa-pareto.mjs:64's
  // hash-dedup silently evicts T8 (observed in the Stage 1 smoke against
  // pareto hash 0x57d1d3600aaf18a8).
  it('buildPrunerPlaceholderVariant body hashes differently from a byte-identical, already-clean parent (D2 regression)', () => {
    // Use an already-clean prompt (no trailing whitespace, no blank-line
    // runs) so conservativeLocalPrune produces the same string as input.
    const cleanPrompt = 'You are a code search agent. [[ss-search]] first, then [[ss-find]] for symbols.';
    expect(conservativeLocalPrune(cleanPrompt)).toBe(cleanPrompt);

    const pareto = { front: [{ id: 'jb', hash: '0xfeed', finalScore: 0.6, prompt: cleanPrompt }] };
    const front = pareto.front;
    const placeholder = buildPrunerPlaceholderVariant(pareto, 8);
    expect(placeholder).not.toBeNull();

    const jbHash = hashContent(cleanPrompt);
    const phHash = hashContent(placeholder.body);
    expect(phHash).not.toBe(jbHash);
    // The marker must be present and at the end.
    expect(placeholder.body.endsWith(PRUNER_PLACEHOLDER_MARKER.trimEnd())).toBe(true);
    // The original prompt content survives byte-identical at the start.
    expect(placeholder.body.startsWith(cleanPrompt)).toBe(true);
    // Sanity: even with the marker, the prompt remains short — the marker
    // is small overhead (< 100 chars) so length-penalty impact is minimal.
    expect(placeholder.body.length - cleanPrompt.length).toBeLessThan(100);
    // Front-member hash collision sanity: simulate buildRestartVariants's
    // dedup hazard. With the fix, T_front (built from same prompt) and
    // the placeholder should have distinct hashes.
    const frontVariantBody = (front[0].prompt || '').trim();
    expect(hashContent(frontVariantBody)).not.toBe(hashContent(placeholder.body));
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

  // End-to-end: buildRestartVariants → writeRestartVariants → loadVariantsFromDir
  // → driver consumption. This is the Stage-0 launch-readiness test for
  // gen-1b: it pins the wiring contract between scaffold output, the loader,
  // and the driver's `variants` input. If a contract mismatch were introduced
  // (frontmatter rename, body trimming semantics change, normalizeVariant
  // signature change), this test fails BEFORE a real run discovers it.
  it('end-to-end: scaffold writes → loader reads → runGepa dry-run consumes the slate without crash', async () => {
    // 1. Build a small slate (1 front member + pruner placeholder = 2
    //    variants). Hand seeds are off to keep the test fast and focused on
    //    the wiring rather than seed body validation (covered above).
    const pareto = {
      front: [{ id: 'jb', hash: '0xfeed', finalScore: 0.5, prompt: 'jb prompt [[ss-search]] [[ss-grep]]' }],
    };
    const variants = buildRestartVariants({ pareto, includeExtraSeeds: false, includePrunerPlaceholder: true });
    expect(variants.length).toBeGreaterThanOrEqual(2);

    // 2. Write to a tmp slate dir (under the project's results dir so the
    //    cleanup pattern stays consistent with the rest of this file).
    tmpDir = mkdtempSync(path.join(process.cwd(), 'core/prompt-optimization/data/results/p7-stage0-e2e-'));
    const slateDir = path.join(tmpDir, 'slate');
    const written = writeRestartVariants({ variants, outDir: slateDir });
    expect(written.length).toBe(variants.length);
    for (const f of written) expect(existsSync(f)).toBe(true);

    // 3. Load via the same loader the driver uses in --variants-dir mode.
    //    Catches frontmatter/body contract drift between scaffold and loader.
    const loaded = loadVariantsFromDir(slateDir);
    expect(loaded.map((v) => v.id)).toEqual(variants.map((v) => v.id));
    // The pruner placeholder must round-trip with its label intact, so the
    // operator/gate can identify it later as "unverified-until-round-0".
    const ph = loaded.find((v) => v.frontMatter?.source_id === 'pruner-placeholder-joint-best');
    expect(ph).toBeTruthy();

    // 4. Normalize like gepa-cli.mjs does in both dry-run and real-run paths.
    const normalized = loaded.map((v) => normalizeVariant(v));
    for (const v of normalized) {
      expect(v.id).toMatch(/^T\d+$/);
      expect(typeof v.prompt).toBe('string');
      expect(v.prompt.length).toBeGreaterThan(0);
    }

    // 5. Run a 1-round dry-run through the actual driver with offline
    //    evaluator + model. Paths point into tmpDir to avoid polluting the
    //    real results directory. concurrency=1 keeps the run deterministic.
    const dryProbes = [
      { id: 'p-lit', stratum: 'literal-lookup', repo: 'gin', query: 'find Engine.New', language: 'go', expectedFiles: [], expected_call_window: [1, 3] },
      { id: 'p-flow', stratum: 'multi-file-flow', repo: 'gin', query: 'how does Run dispatch?', language: 'go', expectedFiles: [], expected_call_window: [2, 6] },
    ];
    const paths = {
      trajectory: path.join(tmpDir, 'trajectory.jsonl'),
      promptBank: path.join(tmpDir, 'prompt-bank.jsonl'),
      paretoCurrent: path.join(tmpDir, 'pareto-current.json'),
    };
    const result = await runGepa({
      runId: 'p7-stage0-e2e',
      variants: normalized,
      devProbes: dryProbes,
      evaluateCandidate: makeDryRunEvaluate(),
      callModel: makeDryRunCallModel(),
      maxRounds: 1,
      patience: 5,
      paths,
      logPath: path.join(tmpDir, 'run.log'),
      concurrency: 1,
    });

    // 6. Driver returned a populated front + persisted both trajectory and
    //    pareto-current. The slate was actually consumed.
    expect(result).toBeDefined();
    expect(Array.isArray(result.front)).toBe(true);
    expect(result.front.length).toBeGreaterThan(0);
    expect(existsSync(paths.trajectory)).toBe(true);
    expect(existsSync(paths.paretoCurrent)).toBe(true);

    // 7. Trajectory contains at least one event with a recognized _kind.
    //    Non-empty trajectory confirms the variants actually entered the loop.
    const trajLines = readFileSync(paths.trajectory, 'utf8').trim().split('\n').filter(Boolean);
    expect(trajLines.length).toBeGreaterThan(0);
    const events = trajLines.map((l) => JSON.parse(l));
    expect(events.some((e) => typeof e._kind === 'string')).toBe(true);
  });
});
