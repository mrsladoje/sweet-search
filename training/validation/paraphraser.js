#!/usr/bin/env node

/**
 * LLM-based Paraphraser for Training Data Augmentation
 *
 * Generates diverse paraphrases of training queries using LLM (Cerebras GLM or fallback).
 * Maintains semantic meaning while varying surface form for better generalization.
 *
 * Usage:
 *   node paraphraser.js --input training.json --output augmented.json
 *   node paraphraser.js --input training.json --samples 100 --variations 3
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.join(__dirname, '../../evaluation/query-sets');

/**
 * P0 Fix: Load eval queries to prevent leaks from paraphrased content
 * This MUST be checked after paraphrasing, not before
 */
function loadEvalQueriesForLeakCheck() {
  const evalQueries = new Set();
  const evalFiles = [
    'identifier.json',
    'structural.json',
    'conceptual.json',
    'mixed.json',
    'multilingual-identifier.json',
    'multilingual-structural.json',
    'multilingual-semantic.json',
    'multilingual-hybrid.json',
  ];

  for (const file of evalFiles) {
    const filePath = path.join(EVAL_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const queries = data.queries || [];
      for (const item of queries) {
        const query = typeof item === 'string' ? item : item.query;
        if (query) {
          // Normalize for comparison
          evalQueries.add(query.toLowerCase().replace(/\s+/g, ' ').trim());
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  return evalQueries;
}

/**
 * Check if a paraphrase would leak into the eval set
 */
function isEvalLeak(paraphrase, evalQueries) {
  const normalized = paraphrase.toLowerCase().replace(/\s+/g, ' ').trim();
  return evalQueries.has(normalized);
}

// Default configuration
const DEFAULT_CONFIG = {
  variations: 3,           // Number of paraphrases per query
  maxSamples: 100,         // Max samples to paraphrase
  batchSize: 10,           // Queries per LLM call
  temperature: 0.8,        // LLM temperature
  maxTokens: 2048,         // Max tokens per response
};

// Language-specific paraphrase instructions
const PARAPHRASE_INSTRUCTIONS = {
  en: 'Paraphrase each query maintaining its meaning but varying word choice and structure.',
  sr: 'Parafraziraj svaki upit zadržavajući značenje ali varirajući izbor reči i strukturu.',
  de: 'Paraphrasiere jede Anfrage unter Beibehaltung der Bedeutung aber mit variierenden Worten und Struktur.',
  zh: '在保持原意的同时，用不同的词汇和结构改写每个查询。',
  ja: '意味を保ちながら、言葉の選択と構造を変えて各クエリを言い換えてください。',
  ru: 'Перефразируйте каждый запрос, сохраняя смысл, но варьируя выбор слов и структуру.',
  es: 'Parafrasea cada consulta manteniendo su significado pero variando la elección de palabras y estructura.',
  ko: '의미를 유지하면서 단어 선택과 구조를 변경하여 각 쿼리를 다시 표현하세요.',
  ar: 'أعد صياغة كل استعلام مع الحفاظ على المعنى ولكن مع تغيير اختيار الكلمات والبنية.',
  default: 'Paraphrase each query maintaining its meaning but varying word choice and structure.',
};

// P1 Fix: Configurable model name via environment variable
const PARAPHRASE_MODEL = process.env.PARAPHRASE_MODEL || 'llama-4-scout-17b-16e-instruct';

// P1 Fix: Maximum response size to prevent memory issues
const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB

/**
 * Call Cerebras API for paraphrasing
 *
 * P1 Fixes:
 * - Configurable model name via PARAPHRASE_MODEL env var
 * - Response size limit
 * - Better error handling
 */
async function callCerebras(prompt, config = {}) {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    return null;
  }

  const { temperature = 0.8, maxTokens = 2048 } = config;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: PARAPHRASE_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at paraphrasing text while preserving semantic meaning. Output valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // P1 Fix: Check response size before parsing
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      console.error(`Response too large: ${contentLength} bytes`);
      return null;
    }

    // P1 Fix: Improved error handling for JSON parse
    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error(`JSON parse failed: ${parseError.message}`);
      return null;
    }

    if (!response.ok) {
      console.error(`API error: ${response.status} - ${data?.error?.message || 'Unknown error'}`);
      return null;
    }

    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('LLM call timed out after 30s');
    } else {
      console.error(`LLM call failed: ${error.message}`);
    }
    return null;
  }
}

/**
 * Generate paraphrases for a batch of queries
 */
async function paraphraseBatch(queries, variations, language) {
  const instruction = PARAPHRASE_INSTRUCTIONS[language] || PARAPHRASE_INSTRUCTIONS.default;

  const prompt = `${instruction}

For each query below, generate ${variations} paraphrases. Return as a JSON array with objects containing:
- "original": the original query
- "paraphrases": array of ${variations} paraphrased versions

Queries:
${queries.map((q, i) => `${i + 1}. "${q}"`).join('\n')}

Return ONLY valid JSON, no explanations.`;

  const response = await callCerebras(prompt);

  if (!response) {
    return null;
  }

  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error(`Failed to parse paraphrase response: ${e.message}`);
  }

  return null;
}

/**
 * Deterministic paraphraser (no LLM required)
 * Applies rule-based transformations for augmentation.
 */
function deterministicParaphrase(query, label, language) {
  const paraphrases = [];
  const lower = query.toLowerCase();

  // English transformations
  if (language === 'en') {
    // Question reordering
    if (lower.startsWith('how does ')) {
      const rest = query.substring(9);
      paraphrases.push(`in what way does ${rest}`);
      paraphrases.push(`what is the mechanism of ${rest.replace(' work', '')}`);
    }

    // What to how
    if (lower.startsWith('what is ')) {
      const rest = query.substring(8);
      paraphrases.push(`describe ${rest}`);
      paraphrases.push(`explain ${rest}`);
    }

    // Callers pattern variations
    if (/what calls (\w+)/i.test(query)) {
      const match = query.match(/what calls (\w+)/i);
      paraphrases.push(`callers of ${match[1]}`);
      paraphrases.push(`usages of ${match[1]}`);
      paraphrases.push(`who uses ${match[1]}`);
    }

    // Dependencies pattern
    if (/what does (\w+) call/i.test(query)) {
      const match = query.match(/what does (\w+) call/i);
      paraphrases.push(`dependencies of ${match[1]}`);
      paraphrases.push(`callees of ${match[1]}`);
    }

    // Flow/process synonyms
    if (query.includes(' flow')) {
      paraphrases.push(query.replace(' flow', ' process'));
      paraphrases.push(query.replace(' flow', ' workflow'));
    }

    // Add generic variations
    if (paraphrases.length === 0) {
      // Add prefix
      paraphrases.push(`find ${query}`);
      paraphrases.push(`search for ${query}`);
    }
  }

  // Serbian transformations
  if (language === 'sr') {
    if (lower.startsWith('како ')) {
      paraphrases.push(query.replace(/^како/i, 'на који начин'));
      paraphrases.push(query.replace(/^како/i, 'објасни како'));
    }
    if (lower.startsWith('шта ')) {
      paraphrases.push(query.replace(/^шта/i, 'који'));
    }
  }

  // German transformations
  if (language === 'de') {
    if (lower.startsWith('wie ')) {
      paraphrases.push(query.replace(/^wie/i, 'auf welche Weise'));
      paraphrases.push(query.replace(/^wie/i, 'erkläre wie'));
    }
  }

  // Chinese transformations
  if (language === 'zh') {
    if (query.includes('如何')) {
      paraphrases.push(query.replace('如何', '怎样'));
      paraphrases.push(query.replace('如何', '怎么'));
    }
  }

  // Filter out duplicates and original
  return paraphrases
    .filter(p => p.toLowerCase() !== lower)
    .slice(0, 3);
}

/**
 * Process training data with paraphrasing
 */
async function processTrainingData(inputPath, options = {}) {
  const {
    variations = DEFAULT_CONFIG.variations,
    maxSamples = DEFAULT_CONFIG.maxSamples,
    batchSize = DEFAULT_CONFIG.batchSize,
    useLLM = true,
    verbose = false,
  } = options;

  // Load training data
  const rawData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const samples = rawData.data || rawData;

  console.log(`Loaded ${samples.length} samples from ${inputPath}`);

  // P0 Fix: Load eval queries BEFORE processing to check AFTER paraphrasing
  const evalQueries = loadEvalQueriesForLeakCheck();
  console.log(`Loaded ${evalQueries.size} eval queries for leak prevention`);
  let leaksBlocked = 0;

  // Select samples for paraphrasing (stratified by label)
  const samplesByLabel = {};
  for (const sample of samples) {
    const label = sample.label;
    if (!samplesByLabel[label]) samplesByLabel[label] = [];
    samplesByLabel[label].push(sample);
  }

  const selectedSamples = [];
  const perLabel = Math.ceil(maxSamples / Object.keys(samplesByLabel).length);

  for (const [label, labelSamples] of Object.entries(samplesByLabel)) {
    const shuffled = labelSamples.sort(() => Math.random() - 0.5);
    selectedSamples.push(...shuffled.slice(0, perLabel));
  }

  console.log(`Selected ${selectedSamples.length} samples for paraphrasing`);

  // Generate paraphrases
  const augmented = [];
  let processed = 0;

  for (const sample of selectedSamples) {
    const query = sample.query;
    const language = sample.language || 'en';
    let paraphrases = [];

    // Try LLM paraphrasing first
    if (useLLM && process.env.CEREBRAS_API_KEY) {
      const result = await paraphraseBatch([query], variations, language);
      if (result && result[0]?.paraphrases) {
        paraphrases = result[0].paraphrases;
      }
    }

    // Fall back to deterministic paraphrasing
    if (paraphrases.length === 0) {
      paraphrases = deterministicParaphrase(query, sample.label, language);
    }

    // Add original and paraphrases
    augmented.push(sample);

    for (const p of paraphrases) {
      if (p && p.trim()) {
        // P0 Fix: Check if paraphrase would leak into eval set
        if (isEvalLeak(p, evalQueries)) {
          leaksBlocked++;
          if (verbose) {
            console.log(`  BLOCKED LEAK: "${p.trim().substring(0, 50)}..."`);
          }
          continue; // Skip this paraphrase
        }

        augmented.push({
          ...sample,
          query: p.trim(),
          source: 'paraphrased',
          originalQuery: query,
        });
      }
    }

    processed++;
    if (verbose || processed % 20 === 0) {
      console.log(`  Processed ${processed}/${selectedSamples.length} (${augmented.length} total)`);
    }
  }

  if (leaksBlocked > 0) {
    console.log(`  ⚠ Blocked ${leaksBlocked} paraphrases that would leak into eval set`);
  }

  // Add remaining original samples
  const selectedSet = new Set(selectedSamples.map(s => s.query));
  for (const sample of samples) {
    if (!selectedSet.has(sample.query)) {
      augmented.push(sample);
    }
  }

  return augmented;
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);

  let inputPath = null;
  let outputPath = null;
  let variations = DEFAULT_CONFIG.variations;
  let maxSamples = DEFAULT_CONFIG.maxSamples;
  let useLLM = true;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[++i];
    } else if (args[i] === '--variations' && args[i + 1]) {
      variations = parseInt(args[++i], 10);
    } else if (args[i] === '--samples' && args[i + 1]) {
      maxSamples = parseInt(args[++i], 10);
    } else if (args[i] === '--no-llm') {
      useLLM = false;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
LLM Paraphraser for Training Data Augmentation

Usage:
  node paraphraser.js --input training.json --output augmented.json
  node paraphraser.js --input data.json --samples 100 --variations 3

Options:
  --input <file>      Input training data JSON file
  --output <file>     Output augmented data file
  --variations <n>    Number of paraphrases per query (default: ${DEFAULT_CONFIG.variations})
  --samples <n>       Max samples to paraphrase (default: ${DEFAULT_CONFIG.maxSamples})
  --no-llm            Use only deterministic paraphrasing (no API calls)
  --verbose, -v       Show verbose output

Environment:
  CEREBRAS_API_KEY    Required for LLM-based paraphrasing

Examples:
  node paraphraser.js --input train.json --output train_aug.json
  node paraphraser.js --input train.json --no-llm --samples 200
`);
      process.exit(0);
    }
  }

  if (!inputPath) {
    console.error('Error: --input is required');
    process.exit(1);
  }

  if (!outputPath) {
    outputPath = inputPath.replace('.json', '_augmented.json');
  }

  console.log('\n' + '='.repeat(50));
  console.log('Training Data Paraphraser');
  console.log('='.repeat(50));
  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Variations: ${variations}`);
  console.log(`Max samples: ${maxSamples}`);
  console.log(`Use LLM: ${useLLM && process.env.CEREBRAS_API_KEY ? 'yes' : 'no (deterministic only)'}`);
  console.log();

  const startTime = performance.now();

  const augmented = await processTrainingData(inputPath, {
    variations,
    maxSamples,
    useLLM,
    verbose,
  });

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`\nGenerated ${augmented.length} samples in ${elapsed}s`);

  // Calculate stats
  const originalCount = augmented.filter(s => s.source !== 'paraphrased').length;
  const paraphrasedCount = augmented.filter(s => s.source === 'paraphrased').length;

  console.log(`  Original: ${originalCount}`);
  console.log(`  Paraphrased: ${paraphrasedCount}`);

  // Write output
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalSamples: augmented.length,
      originalCount,
      paraphrasedCount,
      variations,
      maxSamples,
      version: '1.0',
    },
    data: augmented,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Saved to ${outputPath}`);
}

main().catch(console.error);

export {
  processTrainingData,
  paraphraseBatch,
  deterministicParaphrase,
  DEFAULT_CONFIG,
};
