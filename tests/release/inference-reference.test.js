/**
 * Independent inference reference fixtures (eval/inference-reference/).
 *
 * Fast part (always runs): the fixtures are well formed and pin the same
 * weights as the model registry, so a model update without regenerated
 * fixtures fails here.
 *
 * Heavy part (SWEET_SEARCH_EXTRA_TESTS=1, models cached): the native CPU
 * backend matches the fixtures for every model. Other backends run with
 * `node scripts/check-inference-reference.mjs` on hardware that has them.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { getModelEntry } from '../../core/infrastructure/model-registry.js';
import { getModelCacheDir } from '../../core/infrastructure/model-fetcher.js';

const ROOT = join(import.meta.dirname, '../..');
const DIR = join(ROOT, 'tests/__test_fixtures__/inference-reference');
const REGISTRY_KEY = {
  coderankembed: 'coderankembed-fp32',
  'lateon-code': 'lateon-code-fp32',
  'lateon-code-edge': 'lateon-code-edge-fp32',
};
const load = (m) => JSON.parse(readFileSync(join(DIR, `${m}.json`), 'utf8'));

describe('inference reference fixtures', () => {
  for (const [model, key] of Object.entries(REGISTRY_KEY)) {
    it(`${model}: pins the registry weights and is well formed`, () => {
      const fx = load(model);
      const entry = getModelEntry(key);
      expect(fx.hf_id).toBe(entry.hfId);
      const weights = entry.files.find((f) => f.path === 'model.safetensors');
      expect(fx.weights_sha256).toBe(weights.sha256);
      for (const d of fx.dense) {
        expect(entry.files.find((f) => f.path === d.path)?.sha256).toBe(d.sha256);
      }
      const ids = new Set(fx.cases.map((c) => c.id));
      for (const batch of fx.batches) for (const id of batch) expect(ids.has(id)).toBe(true);
      for (const c of fx.cases) {
        expect(c.input_ids.length).toBeGreaterThan(0);
        expect(c.input_ids.length).toBeLessThanOrEqual(c.max_length);
        if (c.ids_only) continue;
        const floats = Buffer.from(c.output, 'base64').byteLength / 4;
        expect(floats).toBe(c.shape.reduce((a, b) => a * b, 1));
        if (fx.kind === 'late_interaction') expect(c.shape[0]).toBe(c.input_ids.length);
      }
    });
  }

  it('has tolerances for every model on the CPU backend', () => {
    const tol = JSON.parse(readFileSync(join(DIR, 'tolerances.json'), 'utf8'));
    for (const model of Object.keys(REGISTRY_KEY)) expect(tol[model]?.['cpu/f32']).toBeTruthy();
  });
});

const modelsCached = Object.values(REGISTRY_KEY).every((key) =>
  existsSync(join(getModelCacheDir(getModelEntry(key).hfId), 'model.safetensors')),
);
const heavy = process.env.SWEET_SEARCH_EXTRA_TESTS && modelsCached;

describe.skipIf(!heavy)('native CPU backend vs reference fixtures', () => {
  it('matches every model', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/check-inference-reference.mjs'), '--backend', 'cpu'], {
      encoding: 'utf8',
      maxBuffer: 64 << 20,
    });
    expect(r.stdout).not.toContain('✗');
    expect(r.status).toBe(0);
  }, 600000);
});
