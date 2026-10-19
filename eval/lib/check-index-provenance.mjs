#!/usr/bin/env node
/**
 * Exit 1 (message on stderr) when the index at argv[2] was written by CPU
 * encoders on a host that has an accelerator. Runs in its own process with
 * SWEET_SEARCH_PROJECT_ROOT set to the corpus, so loading core config here
 * cannot fix the paths of the process that runs the benchmark.
 */
import fs from 'node:fs';
import path from 'node:path';

import { hasIndexAcceleratorHardware } from '../../core/indexing/model-pool.js';
import { acceleratorProvenanceProblem } from '../../core/indexing/index-device-choice.js';

const corpusDir = process.argv[2];
if (!hasIndexAcceleratorHardware()) process.exit(0);
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(corpusDir, '.sweet-search', 'reconcile-manifest.json'), 'utf8'));
} catch {
  process.exit(0); // no manifest (old layout): nothing recorded to check
}
const problem = acceleratorProvenanceProblem(manifest);
if (problem) {
  process.stderr.write(`${problem}\n`);
  process.exit(1);
}
process.exit(0);
