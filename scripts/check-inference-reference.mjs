#!/usr/bin/env node
/**
 * Check native inference against the independent reference fixtures.
 *
 * Fixtures (tests/__test_fixtures__/inference-reference/<model>.json) come
 * from eval/inference-reference/make_fixtures.py: upstream model code at a
 * pinned revision, float32 CPU, each text alone. They share no code with
 * crates/sweet-search-native.
 *
 * For every model x backend this checks:
 *   1. Tokenizer: the product tokenizer gives the pinned ids for each text
 *      (including the truncation case).
 *   2. Each text alone: output vs reference.
 *   3. Each text inside the fixture's mixed-length padded batches: output
 *      vs the same reference (padding must not change a text's output).
 * Comparisons use core/infrastructure/inference-parity.js; tolerances are
 * fixed per model and backend class in tolerances.json next to the
 * fixtures. A backend that does not report the requested device fails.
 *
 * Usage:
 *   node scripts/check-inference-reference.mjs                 # every model x available backend
 *   node scripts/check-inference-reference.mjs --model lateon-code --backend metal
 *   node scripts/check-inference-reference.mjs --measure       # print stats, ignore tolerances
 *
 * Backends: cpu, metal (candle Metal, CoreML off), coreml (CoreML cascade
 * with candle Metal fallback), cuda. Each model x backend runs in its own
 * process so one broken GPU context cannot affect the next.
 *
 * Exit codes: 0 all pass, 1 any failure, 2 nothing could run.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(ROOT, 'tests/__test_fixtures__/inference-reference');
const MODELS = ['coderankembed', 'lateon-code', 'lateon-code-edge'];
const LI_VARIANT_ENV = { 'lateon-code': 'lateon-code', 'lateon-code-edge': 'lateon-code-edge' };

function parseArgs(argv) {
  const args = { model: null, backend: null, measure: false, child: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') args.model = argv[++i];
    else if (argv[i] === '--backend') args.backend = argv[++i];
    else if (argv[i] === '--measure') args.measure = true;
    else if (argv[i] === '--child') args.child = true;
  }
  return args;
}

function decode(b64, shape) {
  const buf = Buffer.from(b64, 'base64');
  const flat = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  if (shape.length === 1) return Float32Array.from(flat);
  const [rows, dim] = shape;
  return Array.from({ length: rows }, (_, r) => flat.slice(r * dim, (r + 1) * dim));
}

/**
 * Tolerance class for a backend label: "coreml" when the CoreML cascade is
 * armed (its runs include candle Metal for shapes no variant fits),
 * otherwise "<device>/<dtype>" such as "metal/bf16" or "cuda/f32". A class
 * without measured tolerances fails, so a new device or dtype must be
 * measured (--measure) before it can pass.
 */
function toleranceClass(backend) {
  if (backend.startsWith('coreml+')) return 'coreml';
  return backend;
}

async function availableBackends() {
  const { detectHardwareCapability } = await import('../core/infrastructure/hardware-capability.js');
  const hw = detectHardwareCapability();
  const list = ['cpu'];
  if (hw.platform === 'darwin' && hw.arch === 'arm64') list.push('metal', 'coreml');
  if (hw.cudaAvailable) list.push('cuda');
  return list;
}

async function runChild({ model, backend, measure }) {
  const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, `${model}.json`), 'utf8'));
  const tolerances = JSON.parse(readFileSync(join(FIXTURE_DIR, 'tolerances.json'), 'utf8'));
  const parity = await import('../core/infrastructure/inference-parity.js');
  const ni = await import('../core/infrastructure/native-inference.js');
  const { createTokenizer } = await import('../core/infrastructure/native-tokenizer.js');
  const { getModelCacheDir } = await import('../core/infrastructure/model-fetcher.js');
  const { getModelEntry } = await import('../core/infrastructure/model-registry.js');

  const reasons = [];
  const isEmbed = fixture.kind === 'embedding';
  const device = backend === 'coreml' ? 'metal' : backend;

  // 1. Tokenizer.
  const tokKey = isEmbed ? 'coderankembed-int8' : model;
  const tokenizer = await createTokenizer(join(getModelCacheDir(getModelEntry(tokKey).hfId), 'tokenizer.json'));
  for (const c of fixture.cases) {
    const t = tokenizer([c.text], { padding: true, truncation: true, max_length: c.max_length });
    const ids = Array.from(t.input_ids.data, Number);
    const same = ids.length === c.input_ids.length && ids.every((v, i) => v === c.input_ids[i]);
    if (!same) {
      const at = ids.findIndex((v, i) => v !== c.input_ids[i]);
      reasons.push(`tokenizer_mismatch: ${c.id} got ${ids.length} ids, expected ${c.input_ids.length} (first difference at ${at})`);
    }
  }

  // 2 + 3. Model output, alone and in padded batches.
  const loaded = isEmbed
    ? await ni.loadNativeEmbeddingModelWithDevice(device)
    : await ni.loadNativeLiModelWithDevice(device);
  const wantCoreml = backend === 'coreml';
  const label = loaded?.backend ?? '';
  reasons.push(...parity.checkBackend(loaded, device).reasons);
  if (label && wantCoreml !== label.startsWith('coreml+')) {
    reasons.push(`backend_mismatch: requested ${backend}, model runs on ${label}`);
  }
  const tolClass = label ? toleranceClass(label) : 'unknown';
  const tol = tolerances[model]?.[tolClass];
  if (!tol && !measure) reasons.push(`no_tolerance: ${model} has no tolerances for ${tolClass}`);

  const cases = fixture.cases.filter((c) => c.output);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const reference = cases.map((c) => decode(c.output, c.shape));

  async function encode(group) {
    const len = Math.max(...group.map((c) => c.input_ids.length));
    const ids = group.map((c) => [...c.input_ids, ...Array(len - c.input_ids.length).fill(fixture.pad_id)]);
    const mask = group.map((c) => [...Array(c.input_ids.length).fill(1), ...Array(len - c.input_ids.length).fill(0)]);
    if (isEmbed) {
      const flat = await loaded.embedBatch(ids, mask);
      const dim = loaded.dim;
      return group.map((_, i) => flat.slice(i * dim, (i + 1) * dim));
    }
    const { vectors, tokenCounts } = await loaded.encodeBatch(ids, mask);
    const dim = loaded.dim;
    const out = [];
    let offset = 0;
    for (const n of tokenCounts) {
      out.push(Array.from({ length: n }, (_, t) => vectors.slice(offset + t * dim, offset + (t + 1) * dim)));
      offset += n * dim;
    }
    return out;
  }

  const runs = [{ name: 'alone', cases, outputs: [] }];
  for (const c of cases) runs[0].outputs.push(...(await encode([c])));
  for (const ids of fixture.batches) {
    const group = ids.map((id) => byId.get(id));
    runs.push({ name: `batch[${ids.join(',')}]`, cases: group, outputs: await encode(group) });
  }

  const report = [];
  for (const run of runs) {
    const refs = run.cases.map((c) => reference[cases.indexOf(c)]);
    let res;
    if (isEmbed) {
      res = parity.compareEmbeddings(run.outputs, refs, {
        minCosine: measure ? -1 : tol?.minCosine ?? 1,
        meanCosine: measure ? -1 : tol?.meanCosine ?? 1,
      });
      report.push(`${run.name}: min ${res.stats?.min.toFixed(6)} mean ${res.stats?.mean.toFixed(6)}`);
    } else {
      const queryIndices = run.cases
        .map((c, i) => (c.input_ids.length <= 129 ? i : -1))
        .filter((i) => i >= 0);
      res = parity.compareLateInteraction(run.outputs, refs, {
        minTokenCosine: measure ? -1 : tol?.minTokenCosine ?? 1,
        meanTokenCosine: measure ? -1 : tol?.meanTokenCosine ?? 1,
        maxSimRelTol: measure ? Infinity : tol?.maxSimRelTol ?? 0,
        queryIndices,
      });
      report.push(`${run.name}: token min ${res.tokenStats?.min.toFixed(6)} mean ${res.tokenStats?.mean.toFixed(6)} maxsim rel ${res.maxSim?.maxRelDiff.toExponential(2)} flips ${res.maxSim?.flips}`);
      if (measure && res.tokenStats) {
        // Per-case minimum, to see where the drift sits.
        const per = run.cases.map((c, i) => {
          let m = Infinity;
          const o = run.outputs[i];
          const r = refs[i];
          if (o.length !== r.length) return `${c.id}:count`;
          for (let t = 0; t < r.length; t++) {
            let d = 0;
            let no = 0;
            let nr = 0;
            for (let k = 0; k < r[t].length; k++) {
              d += o[t][k] * r[t][k];
              no += o[t][k] * o[t][k];
              nr += r[t][k] * r[t][k];
            }
            m = Math.min(m, d / Math.sqrt(no * nr));
          }
          return `${c.id}:${m.toFixed(4)}`;
        });
        report.push(`    per-case min ${per.join(' ')}`);
      }
    }
    reasons.push(...res.reasons.map((r) => `${run.name} ${r}`));
  }

  ni.unloadNativeModels();
  const ok = measure ? reasons.filter((r) => !r.includes('cosine') && !r.includes('maxsim')).length === 0 : reasons.length === 0;
  console.log(JSON.stringify({ model, backend, label, tolClass, ok, report, reasons }));
  process.exit(ok ? 0 : 1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.child) return runChild(args);

  const models = args.model ? [args.model] : MODELS;
  const backends = args.backend ? [args.backend] : await availableBackends();
  let failed = 0;
  let ran = 0;
  for (const model of models) {
    for (const backend of backends) {
      const env = { ...process.env };
      if (LI_VARIANT_ENV[model]) env.SWEET_SEARCH_LATE_INTERACTION_MODEL = LI_VARIANT_ENV[model];
      env.SWEET_SEARCH_COREML_CASCADE = backend === 'coreml' ? '1' : '0';
      const argv = [fileURLToPath(import.meta.url), '--child', '--model', model, '--backend', backend];
      if (args.measure) argv.push('--measure');
      const r = spawnSync(process.execPath, argv, { env, encoding: 'utf8', maxBuffer: 64 << 20 });
      // Backend decisions (flash-attn self-check, CUDA refusal, CoreML
      // probes) are logged by the addon; show them with the result.
      for (const l of (r.stderr || '').split('\n')) {
        if (/\[NativeInference\]|flash-attn|CoreML/.test(l)) console.error(`    [${model} × ${backend}] ${l.trim()}`);
      }
      const line = (r.stdout || '').trim().split('\n').reverse().find((l) => l.startsWith('{'));
      if (!line) {
        failed++;
        console.log(`✗ ${model} × ${backend}: no result (exit ${r.status})`);
        console.log((r.stderr || '').split('\n').filter((l) => /error|Error|panic/.test(l)).slice(0, 5).join('\n'));
        continue;
      }
      ran++;
      const res = JSON.parse(line);
      if (!res.ok) failed++;
      console.log(`${res.ok ? '✓' : '✗'} ${model} × ${backend} (${res.label || 'no backend'}, tolerances: ${res.tolClass})`);
      for (const l of res.report) console.log(`    ${l}`);
      for (const l of res.reasons) console.log(`    FAIL ${l}`);
    }
  }
  if (ran === 0) process.exit(2);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('check-inference-reference FAILED with error:', err);
  process.exit(1);
});
