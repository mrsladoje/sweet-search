#!/usr/bin/env node

/**
 * Outlier Detector for Training Data
 *
 * Detects anomalous samples that may be mislabeled or problematic.
 * Uses:
 * - Statistical features (length, token count, etc.)
 * - Feature vector distance from centroid
 * - Isolation forest-like scoring
 *
 * Usage:
 *   node outlier-detector.js --input training.json
 *   node outlier-detector.js --input training.json --threshold 0.9 --output outliers.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import feature extractor
let extractAllFeatures;
try {
  const extractor = await import('../features/extractor.js');
  extractAllFeatures = extractor.extractAllFeatures;
} catch (e) {
  // Fallback feature extractor
  extractAllFeatures = (query) => {
    const trimmed = query.trim();
    const tokens = trimmed.split(/\s+/);
    const chars = trimmed.replace(/\s/g, '');
    const charLen = Math.max(1, chars.length);

    return new Float32Array([
      /[a-z][A-Z]/.test(trimmed) ? 1 : 0,  // camelCase
      /_[a-z]/.test(trimmed) ? 1 : 0,       // snake_case
      /^[A-Z]/.test(trimmed) ? 1 : 0,       // PascalCase
      /[A-Z]{2,}/.test(trimmed) ? 1 : 0,    // SCREAMING
      !trimmed.includes(' ') ? 1 : 0,       // single token
      tokens.length,                         // token count
      chars.length / Math.max(1, tokens.length), // avg token length
      (chars.match(/[A-Z]/g) || []).length / charLen, // uppercase ratio
      (chars.match(/[^\x00-\x7F]/g) || []).length / charLen, // non-ASCII ratio
    ]);
  };
}

// Outlier detection configuration
const DETECTION_CONFIG = {
  // Z-score threshold for statistical outliers
  zScoreThreshold: 3.0,

  // IQR multiplier for interquartile range
  iqrMultiplier: 1.5,

  // Feature distance threshold (percentile)
  distancePercentile: 95,

  // Minimum samples per label for statistics
  minSamplesPerLabel: 10,
};

/**
 * Calculate mean and standard deviation
 */
function calculateStats(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0, min: 0, max: 0, q1: 0, median: 0, q3: 0 };

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const std = Math.sqrt(variance);

  const q1 = sorted[Math.floor(n * 0.25)];
  const median = sorted[Math.floor(n * 0.5)];
  const q3 = sorted[Math.floor(n * 0.75)];

  return {
    mean,
    std,
    min: sorted[0],
    max: sorted[n - 1],
    q1,
    median,
    q3,
    iqr: q3 - q1,
  };
}

/**
 * Calculate Euclidean distance between two feature vectors
 */
function euclideanDistance(v1, v2) {
  let sum = 0;
  const len = Math.min(v1.length, v2.length);
  for (let i = 0; i < len; i++) {
    sum += Math.pow(v1[i] - v2[i], 2);
  }
  return Math.sqrt(sum);
}

/**
 * Calculate centroid of feature vectors
 */
function calculateCentroid(features) {
  if (features.length === 0) return [];

  const dim = features[0].length;
  const centroid = new Float32Array(dim);

  for (const f of features) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += f[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    centroid[i] /= features.length;
  }

  return centroid;
}

/**
 * Calculate outlier score for a sample
 * Higher score = more likely to be an outlier
 */
function calculateOutlierScore(sample, features, labelStats, globalStats) {
  const scores = [];
  const query = sample.query || '';
  const label = sample.label;

  // 1. Length-based outlier score
  const length = query.length;
  const lengthStats = labelStats[label]?.length || globalStats.length;
  if (lengthStats.std > 0) {
    const lengthZScore = Math.abs(length - lengthStats.mean) / lengthStats.std;
    scores.push({ name: 'length_zscore', value: lengthZScore / DETECTION_CONFIG.zScoreThreshold });
  }

  // 2. Token count outlier score
  const tokenCount = query.split(/\s+/).length;
  const tokenStats = labelStats[label]?.tokenCount || globalStats.tokenCount;
  if (tokenStats.std > 0) {
    const tokenZScore = Math.abs(tokenCount - tokenStats.mean) / tokenStats.std;
    scores.push({ name: 'token_zscore', value: tokenZScore / DETECTION_CONFIG.zScoreThreshold });
  }

  // 3. Feature distance from centroid
  const centroid = labelStats[label]?.centroid || globalStats.centroid;
  if (centroid && features) {
    const distance = euclideanDistance(features, centroid);
    const distStats = labelStats[label]?.distances || globalStats.distances;
    if (distStats && distStats.std > 0) {
      const distZScore = (distance - distStats.mean) / distStats.std;
      scores.push({ name: 'centroid_distance', value: Math.max(0, distZScore) / DETECTION_CONFIG.zScoreThreshold });
    }
  }

  // 4. IQR-based outlier for length
  if (lengthStats.iqr > 0) {
    const lowerBound = lengthStats.q1 - DETECTION_CONFIG.iqrMultiplier * lengthStats.iqr;
    const upperBound = lengthStats.q3 + DETECTION_CONFIG.iqrMultiplier * lengthStats.iqr;
    if (length < lowerBound || length > upperBound) {
      const iqrScore = Math.max(
        (lowerBound - length) / lengthStats.iqr,
        (length - upperBound) / lengthStats.iqr,
        0
      );
      scores.push({ name: 'length_iqr', value: iqrScore });
    }
  }

  // 5. Non-ASCII ratio outlier (for multilingual data)
  const nonAsciiRatio = (query.match(/[^\x00-\x7F]/g) || []).length / Math.max(1, query.length);
  const nonAsciiStats = labelStats[label]?.nonAsciiRatio || globalStats.nonAsciiRatio;
  if (nonAsciiStats && nonAsciiStats.std > 0) {
    const nonAsciiZScore = Math.abs(nonAsciiRatio - nonAsciiStats.mean) / nonAsciiStats.std;
    scores.push({ name: 'nonascii_zscore', value: nonAsciiZScore / DETECTION_CONFIG.zScoreThreshold });
  }

  // Calculate composite score (max of normalized scores)
  const compositeScore = scores.length > 0
    ? Math.max(...scores.map(s => s.value))
    : 0;

  return {
    score: compositeScore,
    components: scores,
    isOutlier: compositeScore > 1.0,
  };
}

/**
 * Detect outliers in training data
 */
function detectOutliers(samples, options = {}) {
  const { threshold = 1.0, verbose = false } = options;

  // Extract features for all samples
  console.log('Extracting features...');
  const featuresMap = new Map();

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    try {
      const features = extractAllFeatures(sample.query || '');
      featuresMap.set(i, Array.from(features));
    } catch (e) {
      featuresMap.set(i, null);
    }
  }

  // Calculate global statistics
  console.log('Calculating statistics...');
  const lengths = samples.map(s => (s.query || '').length);
  const tokenCounts = samples.map(s => (s.query || '').split(/\s+/).length);
  const nonAsciiRatios = samples.map(s => {
    const q = s.query || '';
    return (q.match(/[^\x00-\x7F]/g) || []).length / Math.max(1, q.length);
  });

  const globalStats = {
    length: calculateStats(lengths),
    tokenCount: calculateStats(tokenCounts),
    nonAsciiRatio: calculateStats(nonAsciiRatios),
  };

  // Calculate global centroid
  const allFeatures = Array.from(featuresMap.values()).filter(f => f !== null);
  globalStats.centroid = calculateCentroid(allFeatures);

  // Calculate distances from centroid
  const distances = allFeatures.map(f => euclideanDistance(f, globalStats.centroid));
  globalStats.distances = calculateStats(distances);

  // Calculate per-label statistics
  const labelStats = {};
  const samplesByLabel = {};

  for (let i = 0; i < samples.length; i++) {
    const label = samples[i].label;
    if (!samplesByLabel[label]) samplesByLabel[label] = [];
    samplesByLabel[label].push({ index: i, sample: samples[i], features: featuresMap.get(i) });
  }

  for (const [label, labelSamples] of Object.entries(samplesByLabel)) {
    if (labelSamples.length < DETECTION_CONFIG.minSamplesPerLabel) continue;

    const labelLengths = labelSamples.map(s => (s.sample.query || '').length);
    const labelTokens = labelSamples.map(s => (s.sample.query || '').split(/\s+/).length);
    const labelNonAscii = labelSamples.map(s => {
      const q = s.sample.query || '';
      return (q.match(/[^\x00-\x7F]/g) || []).length / Math.max(1, q.length);
    });

    const labelFeatures = labelSamples.map(s => s.features).filter(f => f !== null);
    const labelCentroid = calculateCentroid(labelFeatures);
    const labelDistances = labelFeatures.map(f => euclideanDistance(f, labelCentroid));

    labelStats[label] = {
      length: calculateStats(labelLengths),
      tokenCount: calculateStats(labelTokens),
      nonAsciiRatio: calculateStats(labelNonAscii),
      centroid: labelCentroid,
      distances: calculateStats(labelDistances),
    };
  }

  // Score each sample
  console.log('Scoring samples...');
  const results = [];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const features = featuresMap.get(i);

    const outlierInfo = calculateOutlierScore(sample, features, labelStats, globalStats);

    results.push({
      index: i,
      query: sample.query,
      label: sample.label,
      language: sample.language,
      score: outlierInfo.score,
      components: outlierInfo.components,
      isOutlier: outlierInfo.score > threshold,
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Summarize
  const outliers = results.filter(r => r.isOutlier);
  const byLabel = {};

  for (const r of outliers) {
    if (!byLabel[r.label]) byLabel[r.label] = 0;
    byLabel[r.label]++;
  }

  return {
    total: samples.length,
    outlierCount: outliers.length,
    outlierRatio: outliers.length / samples.length,
    threshold,
    byLabel,
    outliers: outliers,
    allResults: results,
    globalStats,
    labelStats,
  };
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);

  let inputPath = null;
  let outputPath = null;
  let threshold = 1.0;
  let verbose = false;
  let topN = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[++i];
    } else if (args[i] === '--threshold' && args[i + 1]) {
      threshold = parseFloat(args[++i]);
    } else if (args[i] === '--top' && args[i + 1]) {
      topN = parseInt(args[++i], 10);
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Outlier Detector for Training Data

Usage:
  node outlier-detector.js --input training.json
  node outlier-detector.js --input training.json --threshold 0.8 --output outliers.json

Options:
  --input <file>       Input training data JSON file
  --output <file>      Output outliers JSON file
  --threshold <n>      Outlier score threshold (default: 1.0)
  --top <n>            Show top N outliers (default: 20)
  --verbose, -v        Show detailed output

Detection Methods:
  - Z-score on length and token count
  - IQR-based outlier detection
  - Feature vector distance from label centroid
  - Non-ASCII ratio analysis

Examples:
  node outlier-detector.js --input train.json
  node outlier-detector.js --input train.json --threshold 0.8 --top 50
`);
      process.exit(0);
    }
  }

  if (!inputPath) {
    console.error('Error: --input is required');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(50));
  console.log('Outlier Detector');
  console.log('='.repeat(50));
  console.log(`Input: ${inputPath}`);
  console.log(`Threshold: ${threshold}`);
  console.log();

  // Load data
  const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const samples = rawData.data || rawData;

  console.log(`Loaded ${samples.length} samples\n`);

  // Detect outliers
  const startTime = performance.now();
  const detection = detectOutliers(samples, { threshold, verbose });
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

  // Print summary
  console.log('\nOutlier Detection Summary:');
  console.log('='.repeat(50));
  console.log(`  Total samples:    ${detection.total}`);
  console.log(`  Outliers:         ${detection.outlierCount} (${(detection.outlierRatio * 100).toFixed(2)}%)`);
  console.log(`  Threshold:        ${detection.threshold}`);
  console.log(`  Time:             ${elapsed}s`);

  // Print by label
  if (Object.keys(detection.byLabel).length > 0) {
    console.log('\nOutliers by Label:');
    for (const [label, count] of Object.entries(detection.byLabel).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${label.padEnd(12)}: ${count}`);
    }
  }

  // Print top outliers
  console.log(`\nTop ${Math.min(topN, detection.outliers.length)} Outliers:`);
  console.log('-'.repeat(80));

  for (let i = 0; i < Math.min(topN, detection.allResults.length); i++) {
    const r = detection.allResults[i];
    const queryPreview = r.query.length > 50 ? r.query.substring(0, 50) + '...' : r.query;

    console.log(`\n  [${r.index}] Score: ${r.score.toFixed(3)} | ${r.label} | ${r.language || 'en'}`);
    console.log(`      "${queryPreview}"`);

    if (verbose && r.components.length > 0) {
      const topComponents = r.components.sort((a, b) => b.value - a.value).slice(0, 3);
      for (const c of topComponents) {
        console.log(`      - ${c.name}: ${c.value.toFixed(3)}`);
      }
    }
  }

  // Write output
  if (outputPath) {
    const output = {
      metadata: {
        detectedAt: new Date().toISOString(),
        inputFile: inputPath,
        totalSamples: detection.total,
        outlierCount: detection.outlierCount,
        threshold,
      },
      outliers: detection.outliers.map(o => ({
        index: o.index,
        query: o.query,
        label: o.label,
        language: o.language,
        score: o.score,
        components: o.components,
      })),
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n✓ Saved ${detection.outlierCount} outliers to ${outputPath}`);
  }

  // Exit with warning if too many outliers
  if (detection.outlierRatio > 0.1) {
    console.log('\n⚠ Warning: High outlier ratio (>10%) - review data quality');
    process.exit(1);
  } else {
    console.log('\n✓ Outlier detection complete');
    process.exit(0);
  }
}

main().catch(console.error);

export {
  detectOutliers,
  calculateOutlierScore,
  calculateStats,
  euclideanDistance,
  calculateCentroid,
  DETECTION_CONFIG,
};
