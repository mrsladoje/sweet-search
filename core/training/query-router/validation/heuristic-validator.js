#!/usr/bin/env node

/**
 * Heuristic Validator for Training Data Quality
 *
 * Applies rule-based validation to ensure training data quality.
 * Checks for:
 * - Label consistency (query matches expected category patterns)
 * - Length constraints
 * - Language-label alignment
 * - Duplicate detection
 * - Structural query validation
 *
 * Usage:
 *   node heuristic-validator.js --input training.json
 *   node heuristic-validator.js --input training.json --fix --output fixed.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Validation rules
const VALIDATION_RULES = {
  // Minimum/maximum query lengths
  minLength: 2,
  maxLength: 200,

  // Maximum ratio of identical queries
  maxDuplicateRatio: 0.05,

  // Confidence threshold for label heuristics
  labelConfidenceThreshold: 0.6,
};

// Label heuristics patterns
const LABEL_HEURISTICS = {
  LEXICAL: {
    patterns: [
      // PascalCase
      /^[A-Z][a-z]+([A-Z][a-z]+)+$/,
      // camelCase
      /^[a-z]+([A-Z][a-z]+)+$/,
      // snake_case
      /^[a-z]+(_[a-z]+)+$/,
      // SCREAMING_SNAKE
      /^[A-Z]+(_[A-Z]+)+$/,
      // File extensions
      /\.(java|ts|tsx|js|jsx|py|go|rs|cpp|proto|yml)$/i,
      // Path separators
      /[/\\]/,
      // Glob patterns
      /\*\*/,
      // Package names
      /^[a-z]+\.[a-z]+(\.[a-z]+)*$/,
      // Non-ASCII identifiers (Cyrillic PascalCase, CJK)
      /^[\u0400-\u04ff][\u0400-\u04ff]+$/,  // Pure Cyrillic
      /^[\u4e00-\u9fff]+$/,                  // CJK
    ],
    antiPatterns: [
      // Question words
      /^(how|what|why|where|when|who|can|does|is|are)\s/i,
      // Multiple spaces (natural language)
      /\s{2,}/,
    ],
  },

  SEMANTIC: {
    patterns: [
      // Question words
      /^(how|what|why|where|when|which|who|can|does|is|are|should)\s/i,
      // Question marks
      /\?$/,
      // Explanation requests
      /\b(explain|describe|understand|overview)\b/i,
      // Process/flow words
      /\b(flow|process|mechanism|strategy|pattern|architecture)\b/i,
      // Non-English question words
      /^(как|что|почему|зачем|где|šta|како|зашто|wie|was|warum|cómo|qué|por qué|comment|qu'est-ce)\b/i,
    ],
    antiPatterns: [
      // Pure identifiers (PascalCase without spaces)
      /^[A-Z][a-z]+([A-Z][a-z]+)+$/,
      // Single token
      /^[^\s]+$/,
    ],
  },

  STRUCTURAL: {
    patterns: [
      // Caller patterns
      /\b(callers?\s+of|what\s+calls|who\s+calls|usages?\s+of|references?\s+to)\b/i,
      // Callee patterns
      /\b(callees?\s+of|what\s+does\s+\w+\s+call|dependencies\s+of)\b/i,
      // Implementation patterns
      /\b(implementations?\s+of|classes?\s+implementing|who\s+extends)\b/i,
      // Impact patterns
      /\b(impact\s+of|affected\s+by|depends?\s+on)\b/i,
      // Non-English structural (Serbian, Russian, German, Chinese)
      /\b(шта\s+позива|что\s+вызывает|was\s+ruft|什么调用)\b/i,
      /\b(зависности|зависимости|Abhängigkeiten|依赖)\b/i,
    ],
    antiPatterns: [],
  },

  HYBRID: {
    patterns: [
      // Identifier followed by natural language
      /^[A-Z][a-z]+([A-Z][a-z]+)?\s+[a-z]/,
      // Two word queries without clear pattern
      /^[a-z]+\s+[a-z]+$/,
    ],
    antiPatterns: [
      // Clear semantic patterns
      /^(how|what|why)\s/i,
      // Clear structural patterns
      /\b(callers?\s+of|implementations?\s+of)\b/i,
    ],
  },
};

/**
 * Calculate label confidence for a query
 */
function calculateLabelConfidence(query, expectedLabel) {
  const heuristics = LABEL_HEURISTICS[expectedLabel];
  if (!heuristics) return 0.5;

  let score = 0.5; // Base score

  // Check positive patterns
  for (const pattern of heuristics.patterns) {
    if (pattern.test(query)) {
      score += 0.15;
    }
  }

  // Check anti-patterns
  for (const pattern of heuristics.antiPatterns || []) {
    if (pattern.test(query)) {
      score -= 0.2;
    }
  }

  // Check other labels for conflicts
  for (const [label, otherHeuristics] of Object.entries(LABEL_HEURISTICS)) {
    if (label === expectedLabel) continue;

    for (const pattern of otherHeuristics.patterns) {
      if (pattern.test(query)) {
        score -= 0.1;
      }
    }
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Suggest better label for a query
 */
function suggestLabel(query) {
  const scores = {};

  for (const label of Object.keys(LABEL_HEURISTICS)) {
    scores[label] = calculateLabelConfidence(query, label);
  }

  // Find highest scoring label
  let bestLabel = 'LEXICAL';
  let bestScore = 0;

  for (const [label, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  }

  return { label: bestLabel, confidence: bestScore, scores };
}

/**
 * Validate a single sample
 */
function validateSample(sample, index, seenQueries) {
  const issues = [];
  const query = sample.query || '';
  const label = sample.label || 'UNKNOWN';

  // Check length constraints
  if (query.length < VALIDATION_RULES.minLength) {
    issues.push({
      type: 'length',
      severity: 'error',
      message: `Query too short (${query.length} < ${VALIDATION_RULES.minLength})`,
    });
  }

  if (query.length > VALIDATION_RULES.maxLength) {
    issues.push({
      type: 'length',
      severity: 'warning',
      message: `Query too long (${query.length} > ${VALIDATION_RULES.maxLength})`,
    });
  }

  // Check for empty or whitespace-only
  if (!query.trim()) {
    issues.push({
      type: 'empty',
      severity: 'error',
      message: 'Query is empty or whitespace-only',
    });
  }

  // Check label validity
  if (!LABEL_HEURISTICS[label]) {
    issues.push({
      type: 'label',
      severity: 'error',
      message: `Unknown label: ${label}`,
    });
  }

  // Check label consistency
  const confidence = calculateLabelConfidence(query, label);
  if (confidence < VALIDATION_RULES.labelConfidenceThreshold) {
    const suggestion = suggestLabel(query);

    issues.push({
      type: 'label_mismatch',
      severity: 'warning',
      message: `Label '${label}' confidence ${confidence.toFixed(2)} < ${VALIDATION_RULES.labelConfidenceThreshold}`,
      suggestion: suggestion.label !== label ? suggestion.label : null,
      confidenceDetails: suggestion.scores,
    });
  }

  // Check for duplicates
  const normalized = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (seenQueries.has(normalized)) {
    issues.push({
      type: 'duplicate',
      severity: 'warning',
      message: `Duplicate query (first seen at index ${seenQueries.get(normalized)})`,
    });
  } else {
    seenQueries.set(normalized, index);
  }

  // Check for control characters or unusual whitespace
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(query)) {
    issues.push({
      type: 'control_chars',
      severity: 'error',
      message: 'Query contains control characters',
    });
  }

  return {
    index,
    query,
    label,
    issues,
    isValid: issues.filter(i => i.severity === 'error').length === 0,
    hasWarnings: issues.filter(i => i.severity === 'warning').length > 0,
  };
}

/**
 * Validate training data
 */
function validateTrainingData(samples, options = {}) {
  const { verbose = false, fix = false } = options;

  const results = {
    total: samples.length,
    valid: 0,
    warnings: 0,
    errors: 0,
    duplicates: 0,
    labelMismatches: 0,
    issues: [],
    byLabel: {},
    byIssueType: {},
  };

  const seenQueries = new Map();
  const validatedSamples = [];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const validation = validateSample(sample, i, seenQueries);

    // Count results
    if (validation.isValid && !validation.hasWarnings) {
      results.valid++;
    } else if (!validation.isValid) {
      results.errors++;
      results.issues.push(validation);
    } else if (validation.hasWarnings) {
      results.warnings++;
      if (verbose) {
        results.issues.push(validation);
      }
    }

    // Track by label
    const label = sample.label || 'UNKNOWN';
    if (!results.byLabel[label]) {
      results.byLabel[label] = { total: 0, valid: 0, warnings: 0, errors: 0 };
    }
    results.byLabel[label].total++;
    if (validation.isValid && !validation.hasWarnings) {
      results.byLabel[label].valid++;
    } else if (!validation.isValid) {
      results.byLabel[label].errors++;
    } else {
      results.byLabel[label].warnings++;
    }

    // Track by issue type
    for (const issue of validation.issues) {
      if (!results.byIssueType[issue.type]) {
        results.byIssueType[issue.type] = 0;
      }
      results.byIssueType[issue.type]++;

      if (issue.type === 'duplicate') results.duplicates++;
      if (issue.type === 'label_mismatch') results.labelMismatches++;
    }

    // Fix if requested
    if (fix) {
      let fixedSample = { ...sample };
      let shouldInclude = true;

      for (const issue of validation.issues) {
        if (issue.type === 'label_mismatch' && issue.suggestion) {
          fixedSample.label = issue.suggestion;
          fixedSample.originalLabel = sample.label;
        }
        if (issue.type === 'duplicate') {
          shouldInclude = false;
        }
        if (issue.type === 'empty' || issue.type === 'control_chars') {
          shouldInclude = false;
        }
      }

      if (shouldInclude) {
        validatedSamples.push(fixedSample);
      }
    }
  }

  // Calculate duplicate ratio
  results.duplicateRatio = results.duplicates / results.total;

  return { results, validatedSamples: fix ? validatedSamples : samples };
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);

  let inputPath = null;
  let outputPath = null;
  let fix = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[++i];
    } else if (args[i] === '--fix') {
      fix = true;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Heuristic Validator for Training Data

Usage:
  node heuristic-validator.js --input training.json
  node heuristic-validator.js --input training.json --fix --output fixed.json

Options:
  --input <file>   Input training data JSON file
  --output <file>  Output fixed data file (requires --fix)
  --fix            Fix issues where possible (relabel, remove duplicates)
  --verbose, -v    Show all issues including warnings

Validation Rules:
  - Query length: ${VALIDATION_RULES.minLength}-${VALIDATION_RULES.maxLength} chars
  - Label confidence: >${VALIDATION_RULES.labelConfidenceThreshold}
  - Max duplicate ratio: ${VALIDATION_RULES.maxDuplicateRatio * 100}%

Examples:
  node heuristic-validator.js --input train.json -v
  node heuristic-validator.js --input train.json --fix --output clean.json
`);
      process.exit(0);
    }
  }

  if (!inputPath) {
    console.error('Error: --input is required');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(50));
  console.log('Heuristic Validator');
  console.log('='.repeat(50));
  console.log(`Input: ${inputPath}`);
  if (fix) console.log(`Output: ${outputPath || inputPath.replace('.json', '_fixed.json')}`);
  console.log(`Fix mode: ${fix}`);
  console.log(`Verbose: ${verbose}`);
  console.log();

  // Load data
  const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const samples = rawData.data || rawData;

  console.log(`Loaded ${samples.length} samples\n`);

  // Validate
  const startTime = performance.now();
  const { results, validatedSamples } = validateTrainingData(samples, { verbose, fix });
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

  // Print summary
  console.log('Validation Summary:');
  console.log('='.repeat(50));
  console.log(`  Total samples:    ${results.total}`);
  console.log(`  Valid:            ${results.valid} (${(results.valid / results.total * 100).toFixed(1)}%)`);
  console.log(`  Warnings:         ${results.warnings}`);
  console.log(`  Errors:           ${results.errors}`);
  console.log(`  Duplicates:       ${results.duplicates} (${(results.duplicateRatio * 100).toFixed(2)}%)`);
  console.log(`  Label mismatches: ${results.labelMismatches}`);
  console.log(`  Time:             ${elapsed}s`);

  // Print by label
  console.log('\nBy Label:');
  for (const [label, stats] of Object.entries(results.byLabel).sort()) {
    const validPct = ((stats.valid / stats.total) * 100).toFixed(1);
    console.log(`  ${label.padEnd(12)}: ${stats.total.toString().padStart(5)} total, ${stats.valid.toString().padStart(5)} valid (${validPct}%)`);
  }

  // Print by issue type
  if (Object.keys(results.byIssueType).length > 0) {
    console.log('\nBy Issue Type:');
    for (const [type, count] of Object.entries(results.byIssueType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type.padEnd(20)}: ${count}`);
    }
  }

  // Print issues if verbose
  if (verbose && results.issues.length > 0) {
    console.log('\nDetailed Issues:');
    for (const item of results.issues.slice(0, 20)) {
      console.log(`\n  [${item.index}] "${item.query.substring(0, 50)}${item.query.length > 50 ? '...' : ''}"`);
      console.log(`      Label: ${item.label}`);
      for (const issue of item.issues) {
        const icon = issue.severity === 'error' ? '✗' : '⚠';
        console.log(`      ${icon} ${issue.message}`);
        if (issue.suggestion) {
          console.log(`        → Suggested: ${issue.suggestion}`);
        }
      }
    }
    if (results.issues.length > 20) {
      console.log(`\n  ... and ${results.issues.length - 20} more issues`);
    }
  }

  // Write fixed output
  if (fix) {
    const outputFile = outputPath || inputPath.replace('.json', '_fixed.json');

    const output = {
      metadata: {
        ...rawData.metadata,
        validatedAt: new Date().toISOString(),
        originalCount: samples.length,
        validatedCount: validatedSamples.length,
        removedCount: samples.length - validatedSamples.length,
      },
      data: validatedSamples,
    };

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
    console.log(`\n✓ Fixed data saved to ${outputFile}`);
    console.log(`  Removed: ${samples.length - validatedSamples.length} samples`);
    console.log(`  Remaining: ${validatedSamples.length} samples`);
  }

  // Exit with error code if validation failed
  if (results.errors > 0) {
    console.log('\n✗ Validation FAILED');
    process.exit(1);
  } else if (results.warnings > 0) {
    console.log('\n⚠ Validation PASSED with warnings');
    process.exit(0);
  } else {
    console.log('\n✓ Validation PASSED');
    process.exit(0);
  }
}

main().catch(console.error);

export {
  validateTrainingData,
  validateSample,
  calculateLabelConfidence,
  suggestLabel,
  VALIDATION_RULES,
  LABEL_HEURISTICS,
};
