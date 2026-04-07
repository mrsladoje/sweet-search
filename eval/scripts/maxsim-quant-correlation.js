/**
 * MaxSim Quantization Correlation Analysis
 *
 * Measures the quality impact of each quantization scheme by comparing
 * quantized MaxSim scores to float32 ground truth.
 *
 * Metrics:
 *   1. Kendall tau rank correlation
 *   2. Spearman rho rank correlation
 *   3. P(rank inversion) at various score gaps
 *
 * Usage:
 *   node eval/scripts/maxsim-quant-correlation.js [--schemes=int8,int4,wht-int8,wht-int4]
 */

import { LateInteractionIndex } from '../../core/ranking/late-interaction-index.js';

// ============================================================================
// Correlation metrics
// ============================================================================

function kendallTau(xs, ys) {
  const n = xs.length;
  let concordant = 0, discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = xs[i] - xs[j];
      const dy = ys[i] - ys[j];
      const prod = dx * dy;
      if (prod > 0) concordant++;
      else if (prod < 0) discordant++;
    }
  }
  const total = concordant + discordant;
  return total === 0 ? 1.0 : (concordant - discordant) / total;
}

function spearmanRho(xs, ys) {
  const n = xs.length;
  const rankX = computeRanks(xs);
  const rankY = computeRanks(ys);

  let sumDSq = 0;
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i];
    sumDSq += d * d;
  }
  return 1 - (6 * sumDSq) / (n * (n * n - 1));
}

function computeRanks(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Float64Array(arr.length);
  for (let i = 0; i < indexed.length; i++) ranks[indexed[i].i] = i + 1;
  return ranks;
}

function rankInversionProbability(groundTruth, quantized, gapThreshold) {
  const n = groundTruth.length;
  let inversions = 0, eligible = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gap = Math.abs(groundTruth[i] - groundTruth[j]);
      if (gap >= gapThreshold) {
        eligible++;
        const gtOrder = Math.sign(groundTruth[i] - groundTruth[j]);
        const qOrder = Math.sign(quantized[i] - quantized[j]);
        if (gtOrder !== qOrder) inversions++;
      }
    }
  }
  return eligible === 0 ? 0 : inversions / eligible;
}

// ============================================================================
// Test data generation
// ============================================================================

function generateTestTokens(dim, numTokens, seed) {
  let s = seed | 0;
  const prng = () => {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    return (s / 0x7FFFFFFF) * 2 - 1;
  };

  return Array.from({ length: numTokens }, () => {
    const arr = new Float32Array(dim);
    let normSq = 0;
    for (let i = 0; i < dim; i++) { arr[i] = prng(); normSq += arr[i] * arr[i]; }
    const norm = Math.sqrt(normSq);
    for (let i = 0; i < dim; i++) arr[i] /= norm;
    return arr;
  });
}

// ============================================================================
// Scheme configurations
// ============================================================================

const SCHEMES = {
  'float32': { useInt8: false, quantBits: 32, whtSeed: 0 },
  'int8': { useInt8: true, quantBits: 8, whtSeed: 0 },
  'int4': { useInt8: true, quantBits: 4, whtSeed: 0 },
  'wht-int8': { useInt8: true, quantBits: 8, whtSeed: 42 },
  'wht-int4': { useInt8: true, quantBits: 4, whtSeed: 42 },
};

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const schemesArg = args.find(a => a.startsWith('--schemes='));
  const schemeNames = schemesArg
    ? schemesArg.split('=')[1].split(',')
    : ['int8', 'int4', 'wht-int8', 'wht-int4'];

  const dim = 128;
  const numDocs = 50;
  const numQueryTokens = 8;
  const numDocTokens = 32;
  const gapThresholds = [0.01, 0.02, 0.03, 0.05, 0.08];

  console.log('MaxSim Quantization Correlation Analysis');
  console.log('=========================================');
  console.log(`Config: dim=${dim}, docs=${numDocs}, queryTokens=${numQueryTokens}, docTokens=${numDocTokens}`);
  console.log();

  // Build float32 ground truth index
  const gtIndex = new LateInteractionIndex({
    tokenDim: dim, useInt8: false, quantBits: 32, whtSeed: 0,
  });
  gtIndex.initialized = true;

  for (let i = 0; i < numDocs; i++) {
    await gtIndex.add(`doc-${i}`, generateTestTokens(dim, numDocTokens, i * 100));
  }

  // Score ground truth
  const queryTokens = generateTestTokens(dim, numQueryTokens, 999);
  const candidates = Array.from({ length: numDocs }, (_, i) => ({ id: `doc-${i}`, score: 1 }));
  const gtResults = await gtIndex.scoreWithLateInteraction(queryTokens, candidates);
  const gtScores = gtResults.map(r => r.lateInteractionScore);

  // Test each quantization scheme
  for (const schemeName of schemeNames) {
    const config = SCHEMES[schemeName];
    if (!config) { console.error(`Unknown scheme: ${schemeName}`); continue; }

    const index = new LateInteractionIndex({ tokenDim: dim, ...config });
    index.initialized = true;

    for (let i = 0; i < numDocs; i++) {
      await index.add(`doc-${i}`, generateTestTokens(dim, numDocTokens, i * 100));
    }

    const results = await index.scoreWithLateInteraction(queryTokens, candidates);
    // Match order to ground truth
    const qScores = new Float64Array(numDocs);
    for (const r of results) {
      const idx = parseInt(r.id.split('-')[1]);
      qScores[idx] = r.lateInteractionScore;
    }
    const gtOrdered = new Float64Array(numDocs);
    for (const r of gtResults) {
      const idx = parseInt(r.id.split('-')[1]);
      gtOrdered[idx] = r.lateInteractionScore;
    }

    const tau = kendallTau(Array.from(gtOrdered), Array.from(qScores));
    const rho = spearmanRho(Array.from(gtOrdered), Array.from(qScores));

    console.log(`--- ${schemeName} ---`);
    console.log(`  Kendall tau:  ${tau.toFixed(6)}`);
    console.log(`  Spearman rho: ${rho.toFixed(6)}`);

    for (const gap of gapThresholds) {
      const pInv = rankInversionProbability(Array.from(gtOrdered), Array.from(qScores), gap);
      console.log(`  P(rank inversion | gap >= ${gap.toFixed(2)}): ${(pInv * 100).toFixed(2)}%`);
    }
    console.log();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
