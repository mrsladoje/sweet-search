#!/usr/bin/env node

/**
 * Spot-Check Sampler for Training Data QA
 *
 * Generates stratified samples for manual quality review.
 * Ensures coverage across:
 * - All labels (LEXICAL, SEMANTIC, STRUCTURAL, HYBRID)
 * - All languages
 * - All difficulty levels
 * - Edge cases (shortest, longest, highest outlier scores)
 *
 * Usage:
 *   node spot-check-sampler.js --input training.json --samples 50
 *   node spot-check-sampler.js --input training.json --format markdown --output review.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sampling configuration
const SAMPLING_CONFIG = {
  defaultSamples: 50,
  minPerCategory: 3,    // Minimum samples per label/language
  edgeCaseRatio: 0.2,   // 20% edge cases
  formatOptions: ['json', 'markdown', 'csv', 'interactive'],
};

/**
 * Stratified sampling
 */
function stratifiedSample(samples, n, stratifyBy) {
  const groups = {};

  // Group by stratification key
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const key = stratifyBy(sample);
    if (!groups[key]) groups[key] = [];
    groups[key].push({ index: i, sample });
  }

  // Calculate samples per group
  const numGroups = Object.keys(groups).length;
  const perGroup = Math.max(SAMPLING_CONFIG.minPerCategory, Math.floor(n / numGroups));
  const remainder = n - (perGroup * numGroups);

  // Sample from each group
  const sampled = [];
  let extra = remainder;

  for (const [key, items] of Object.entries(groups)) {
    const shuffled = items.sort(() => Math.random() - 0.5);
    const take = perGroup + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;

    sampled.push(...shuffled.slice(0, Math.min(take, shuffled.length)));
  }

  return sampled;
}

/**
 * Select edge cases
 */
function selectEdgeCases(samples, n) {
  const edgeCases = [];

  // Sort by length
  const byLength = [...samples].sort((a, b) => a.query.length - b.query.length);

  // Shortest queries
  const shortestCount = Math.ceil(n / 4);
  for (let i = 0; i < Math.min(shortestCount, byLength.length); i++) {
    edgeCases.push({
      ...byLength[i],
      edgeType: 'shortest',
      edgeReason: `Length: ${byLength[i].query.length} chars`,
    });
  }

  // Longest queries
  const longestCount = Math.ceil(n / 4);
  for (let i = 0; i < Math.min(longestCount, byLength.length); i++) {
    const sample = byLength[byLength.length - 1 - i];
    edgeCases.push({
      ...sample,
      edgeType: 'longest',
      edgeReason: `Length: ${sample.query.length} chars`,
    });
  }

  // Highest non-ASCII ratio
  const byNonAscii = [...samples].sort((a, b) => {
    const ratioA = (a.query.match(/[^\x00-\x7F]/g) || []).length / Math.max(1, a.query.length);
    const ratioB = (b.query.match(/[^\x00-\x7F]/g) || []).length / Math.max(1, b.query.length);
    return ratioB - ratioA;
  });

  const nonAsciiCount = Math.ceil(n / 4);
  for (let i = 0; i < Math.min(nonAsciiCount, byNonAscii.length); i++) {
    const sample = byNonAscii[i];
    const ratio = (sample.query.match(/[^\x00-\x7F]/g) || []).length / Math.max(1, sample.query.length);
    if (ratio > 0) {
      edgeCases.push({
        ...sample,
        edgeType: 'non_ascii',
        edgeReason: `Non-ASCII ratio: ${(ratio * 100).toFixed(1)}%`,
      });
    }
  }

  // Most tokens
  const byTokens = [...samples].sort((a, b) => {
    const tokensA = a.query.split(/\s+/).length;
    const tokensB = b.query.split(/\s+/).length;
    return tokensB - tokensA;
  });

  const tokenCount = Math.ceil(n / 4);
  for (let i = 0; i < Math.min(tokenCount, byTokens.length); i++) {
    const sample = byTokens[i];
    edgeCases.push({
      ...sample,
      edgeType: 'most_tokens',
      edgeReason: `Tokens: ${sample.query.split(/\s+/).length}`,
    });
  }

  // Deduplicate
  const seen = new Set();
  return edgeCases.filter(e => {
    const key = e.query;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, n);
}

/**
 * Generate spot-check sample
 */
function generateSpotCheck(samples, options = {}) {
  const {
    sampleCount = SAMPLING_CONFIG.defaultSamples,
    includeEdgeCases = true,
    verbose = false,
  } = options;

  // Calculate counts
  const edgeCaseCount = includeEdgeCases
    ? Math.ceil(sampleCount * SAMPLING_CONFIG.edgeCaseRatio)
    : 0;
  const stratifiedCount = sampleCount - edgeCaseCount;

  // Get stratified sample by label
  const byLabelSample = stratifiedSample(
    samples,
    Math.ceil(stratifiedCount / 2),
    s => s.label
  );

  // Get stratified sample by language
  const byLangSample = stratifiedSample(
    samples,
    Math.ceil(stratifiedCount / 2),
    s => s.language || 'en'
  );

  // Get edge cases
  const edgeCases = includeEdgeCases
    ? selectEdgeCases(samples, edgeCaseCount)
    : [];

  // Combine and deduplicate
  const seen = new Set();
  const combined = [];

  const addIfNew = (item, source) => {
    const key = item.sample ? item.sample.query : item.query;
    if (!seen.has(key)) {
      seen.add(key);
      combined.push({
        ...item,
        source,
      });
    }
  };

  for (const item of byLabelSample) {
    addIfNew(item, 'label_stratified');
  }
  for (const item of byLangSample) {
    addIfNew(item, 'language_stratified');
  }
  for (const item of edgeCases) {
    addIfNew(item, 'edge_case');
  }

  // Trim to exact count
  const finalSample = combined.slice(0, sampleCount);

  // Calculate coverage
  const coverage = {
    labels: new Set(),
    languages: new Set(),
    sources: new Set(),
  };

  for (const item of finalSample) {
    const sample = item.sample || item;
    coverage.labels.add(sample.label);
    coverage.languages.add(sample.language || 'en');
    coverage.sources.add(item.source);
  }

  return {
    samples: finalSample.map((item, idx) => ({
      id: idx + 1,
      index: item.index,
      query: item.sample ? item.sample.query : item.query,
      label: item.sample ? item.sample.label : item.label,
      language: (item.sample ? item.sample.language : item.language) || 'en',
      source: item.source,
      edgeType: item.edgeType || null,
      edgeReason: item.edgeReason || null,
    })),
    coverage: {
      labels: Array.from(coverage.labels),
      languages: Array.from(coverage.languages),
      sources: Array.from(coverage.sources),
    },
    stats: {
      total: finalSample.length,
      byLabel: Object.fromEntries(
        Array.from(coverage.labels).map(l => [
          l,
          finalSample.filter(i => (i.sample?.label || i.label) === l).length,
        ])
      ),
      byLanguage: Object.fromEntries(
        Array.from(coverage.languages).map(l => [
          l,
          finalSample.filter(i => (i.sample?.language || i.language || 'en') === l).length,
        ])
      ),
      edgeCases: finalSample.filter(i => i.edgeType).length,
    },
  };
}

/**
 * Format as Markdown
 */
function formatMarkdown(spotCheck) {
  let md = `# Training Data Spot-Check Review

Generated: ${new Date().toISOString()}

## Coverage

- **Labels**: ${spotCheck.coverage.labels.join(', ')}
- **Languages**: ${spotCheck.coverage.languages.join(', ')}
- **Total samples**: ${spotCheck.stats.total}
- **Edge cases**: ${spotCheck.stats.edgeCases}

## Distribution

### By Label
${Object.entries(spotCheck.stats.byLabel).map(([l, c]) => `- ${l}: ${c}`).join('\n')}

### By Language
${Object.entries(spotCheck.stats.byLanguage).map(([l, c]) => `- ${l}: ${c}`).join('\n')}

## Samples for Review

| # | Query | Label | Language | Source | Notes |
|---|-------|-------|----------|--------|-------|
`;

  for (const s of spotCheck.samples) {
    const query = s.query.length > 50 ? s.query.substring(0, 47) + '...' : s.query;
    const notes = s.edgeReason || '';
    md += `| ${s.id} | \`${query.replace(/\|/g, '\\|')}\` | ${s.label} | ${s.language} | ${s.source} | ${notes} |\n`;
  }

  md += `
## Review Checklist

For each sample, verify:

- [ ] **Label correctness**: Does the query match the assigned category?
- [ ] **Language accuracy**: Is the language tag correct?
- [ ] **Query quality**: Is this a realistic query a user would type?
- [ ] **No PII**: No sensitive information in the query

### Feedback Template

\`\`\`
Sample #[ID]:
- Correct: [Yes/No]
- Suggested label: [if different]
- Notes: [any issues]
\`\`\`
`;

  return md;
}

/**
 * Format as CSV
 */
function formatCSV(spotCheck) {
  const headers = ['id', 'query', 'label', 'language', 'source', 'edge_type', 'edge_reason', 'correct', 'notes'];
  let csv = headers.join(',') + '\n';

  for (const s of spotCheck.samples) {
    const row = [
      s.id,
      `"${s.query.replace(/"/g, '""')}"`,
      s.label,
      s.language,
      s.source,
      s.edgeType || '',
      s.edgeReason || '',
      '',  // correct (for reviewer)
      '',  // notes (for reviewer)
    ];
    csv += row.join(',') + '\n';
  }

  return csv;
}

/**
 * Interactive console review
 */
async function interactiveReview(spotCheck) {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

  console.log('\n' + '='.repeat(60));
  console.log('Interactive Spot-Check Review');
  console.log('='.repeat(60));
  console.log(`${spotCheck.samples.length} samples to review`);
  console.log('Commands: y=correct, n=incorrect, s=skip, q=quit\n');

  const results = [];
  let reviewed = 0;
  let correct = 0;
  let incorrect = 0;

  for (const s of spotCheck.samples) {
    console.log(`\n[${ s.id}/${spotCheck.samples.length}]`);
    console.log(`  Query:    "${s.query}"`);
    console.log(`  Label:    ${s.label}`);
    console.log(`  Language: ${s.language}`);
    if (s.edgeReason) console.log(`  Edge:     ${s.edgeReason}`);

    const answer = await question('  Correct? [y/n/s/q]: ');

    if (answer.toLowerCase() === 'q') break;
    if (answer.toLowerCase() === 's') continue;

    reviewed++;
    const isCorrect = answer.toLowerCase() === 'y';

    if (isCorrect) {
      correct++;
    } else {
      incorrect++;
      const suggestedLabel = await question('  Suggested label (or Enter to skip): ');
      const notes = await question('  Notes: ');
      results.push({
        id: s.id,
        query: s.query,
        originalLabel: s.label,
        suggestedLabel: suggestedLabel || null,
        notes: notes || null,
      });
    }
  }

  rl.close();

  console.log('\n' + '='.repeat(60));
  console.log('Review Summary');
  console.log('='.repeat(60));
  console.log(`  Reviewed: ${reviewed}`);
  console.log(`  Correct:  ${correct} (${(correct / reviewed * 100).toFixed(1)}%)`);
  console.log(`  Incorrect: ${incorrect}`);

  if (results.length > 0) {
    console.log('\nIssues Found:');
    for (const r of results) {
      console.log(`  - [${r.id}] "${r.query.substring(0, 40)}..."`);
      if (r.suggestedLabel) console.log(`    Suggested: ${r.suggestedLabel}`);
      if (r.notes) console.log(`    Notes: ${r.notes}`);
    }
  }

  return { reviewed, correct, incorrect, issues: results };
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);

  let inputPath = null;
  let outputPath = null;
  let sampleCount = SAMPLING_CONFIG.defaultSamples;
  let format = 'json';
  let interactive = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[++i];
    } else if (args[i] === '--samples' && args[i + 1]) {
      sampleCount = parseInt(args[++i], 10);
    } else if (args[i] === '--format' && args[i + 1]) {
      format = args[++i];
    } else if (args[i] === '--interactive' || args[i] === '-i') {
      interactive = true;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Spot-Check Sampler for Training Data QA

Usage:
  node spot-check-sampler.js --input training.json --samples 50
  node spot-check-sampler.js --input training.json --format markdown --output review.md
  node spot-check-sampler.js --input training.json --interactive

Options:
  --input <file>     Input training data JSON file
  --output <file>    Output file (format depends on --format)
  --samples <n>      Number of samples (default: ${SAMPLING_CONFIG.defaultSamples})
  --format <type>    Output format: ${SAMPLING_CONFIG.formatOptions.join(', ')} (default: json)
  --interactive, -i  Interactive review mode
  --verbose, -v      Show verbose output

Sampling Strategy:
  - 50% stratified by label
  - 30% stratified by language
  - 20% edge cases (shortest, longest, highest non-ASCII)

Examples:
  node spot-check-sampler.js --input train.json --samples 100
  node spot-check-sampler.js --input train.json --format markdown --output review.md
  node spot-check-sampler.js --input train.json -i
`);
      process.exit(0);
    }
  }

  if (!inputPath) {
    console.error('Error: --input is required');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(50));
  console.log('Spot-Check Sampler');
  console.log('='.repeat(50));
  console.log(`Input: ${inputPath}`);
  console.log(`Samples: ${sampleCount}`);
  console.log(`Format: ${format}`);
  console.log();

  // Load data
  const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const samples = rawData.data || rawData;

  console.log(`Loaded ${samples.length} samples\n`);

  // Generate spot-check
  const spotCheck = generateSpotCheck(samples, { sampleCount, verbose });

  console.log('Spot-Check Summary:');
  console.log(`  Total samples: ${spotCheck.stats.total}`);
  console.log(`  Labels covered: ${spotCheck.coverage.labels.join(', ')}`);
  console.log(`  Languages covered: ${spotCheck.coverage.languages.join(', ')}`);
  console.log(`  Edge cases: ${spotCheck.stats.edgeCases}`);

  // Interactive mode
  if (interactive) {
    await interactiveReview(spotCheck);
    return;
  }

  // Format and output
  let output;
  let ext = '.json';

  switch (format) {
    case 'markdown':
    case 'md':
      output = formatMarkdown(spotCheck);
      ext = '.md';
      break;
    case 'csv':
      output = formatCSV(spotCheck);
      ext = '.csv';
      break;
    default:
      output = JSON.stringify(spotCheck, null, 2);
      ext = '.json';
  }

  if (outputPath) {
    fs.writeFileSync(outputPath, output);
    console.log(`\n✓ Saved to ${outputPath}`);
  } else {
    const defaultOutput = inputPath.replace('.json', `_spotcheck${ext}`);
    fs.writeFileSync(defaultOutput, output);
    console.log(`\n✓ Saved to ${defaultOutput}`);
  }
}

main().catch(console.error);

export {
  generateSpotCheck,
  stratifiedSample,
  selectEdgeCases,
  formatMarkdown,
  formatCSV,
  SAMPLING_CONFIG,
};
