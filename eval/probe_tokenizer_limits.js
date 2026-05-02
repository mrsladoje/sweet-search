#!/usr/bin/env node
/**
 * probe_tokenizer_limits.js
 *
 * Pre-flight check for the chunk-overflow ablation.
 *
 * Question: when we slice embedding_text at 2000 chars, how does that compare
 * to the production tokenizer's truncation cap?
 *
 *   - Bi-encoder (coderankembed) tokenizer: max_length=512 in production
 *     (see core/embedding/embedding-local-model.js:23 INDEXING_MAX_LENGTH).
 *   - LI (lateon-code) tokenizer: max_length=2048 in production
 *     (see core/infrastructure/config/ranking.js maxDocLength).
 *
 * This script measures the actual char↔token ratio on a real code sample
 * (the 50 worst overflow offenders identified by audit_chunk_overflow.js)
 * to determine whether 2000 chars is already token-truncated, and whether
 * raising the cap to 2200 would change what the model actually sees.
 *
 * Output: eval/results/tokenizer-limit-probe.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');

async function loadTokenizers() {
  const [{ getModelEntry }, { getModelCacheDir }] = await Promise.all([
    import('../core/infrastructure/model-registry.js'),
    import('../core/infrastructure/model-fetcher.js'),
  ]);
  const { createTokenizer } = await import('../core/infrastructure/native-tokenizer.js');

  // Bi-encoder tokenizer — production uses the INT8 model's tokenizer.json
  // (same vocab as FP32). See native-inference.js:getEmbTokenizer.
  const embEntry = getModelEntry('coderankembed-int8');
  const embTokenizerPath = path.join(getModelCacheDir(embEntry.hfId), 'tokenizer.json');
  const embTok = await createTokenizer(embTokenizerPath);

  // LI tokenizer (lateon-code)
  const liEntry = getModelEntry('lateon-code-fp32');
  let liTok = null;
  try {
    const liTokenizerPath = path.join(getModelCacheDir(liEntry.hfId), 'tokenizer.json');
    liTok = await createTokenizer(liTokenizerPath);
  } catch (err) {
    console.error(`[probe] LI tokenizer unavailable: ${err.message}`);
  }

  return { embTok, liTok };
}

function tokenizeNoTruncate(tokenizer, text) {
  // truncation: false => maxLen 1_000_000 inside native-tokenizer wrapper
  const result = tokenizer(text, { truncation: false, padding: false });
  return result.input_ids.dims[1];
}

function quantiles(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    n: sorted.length,
    p10: pick(10), p50: pick(50), p90: pick(90), p95: pick(95), p99: pick(99),
    mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    max: sorted[sorted.length - 1],
  };
}

async function loadOffenderSamples() {
  // Pull text from the chunk-overflow audit JSON: the top offenders contain
  // path + line range. Read those file regions to build real samples.
  // Falls back to corpus.jsonl entries if audit isn't present.
  const samples = [];

  const auditPath = path.join(RESULTS_DIR, 'chunk-overflow-audit.json');
  if (await fs.access(auditPath).then(() => true, () => false)) {
    const audit = JSON.parse(await fs.readFile(auditPath, 'utf-8'));
    const repoLookup = {
      core: path.resolve(__dirname, '..', 'core'),
      fastify: path.resolve(__dirname, 'repos', 'fastify'),
      flask: path.resolve(__dirname, 'repos', 'flask'),
      ripgrep: path.resolve(__dirname, 'repos', 'ripgrep'),
    };
    for (const repo of audit.repos || []) {
      const root = repoLookup[repo.repoTag];
      if (!root) continue;
      for (const o of repo.topOffenders.slice(0, 20)) {
        try {
          const abs = path.join(root, o.path);
          const content = await fs.readFile(abs, 'utf-8');
          const lines = content.split('\n');
          const start = Math.max(0, (o.line_start || 1) - 1);
          const end = Math.min(lines.length, (o.line_end || lines.length));
          const text = lines.slice(start, end).join('\n');
          samples.push({ repo: repo.repoTag, path: o.path, language: o.language, text });
        } catch {
          // skip
        }
      }
    }
  }

  // Always also pull a representative GenCodeSearchNet sample.
  const corpusPath = path.join(__dirname, 'data', 'gencodesearchnet', 'corpus.jsonl');
  if (await fs.access(corpusPath).then(() => true, () => false)) {
    const lines = (await fs.readFile(corpusPath, 'utf-8')).split('\n').filter(Boolean);
    // Sample every 60th doc -> ~100 samples
    for (let i = 0; i < lines.length; i += Math.floor(lines.length / 100)) {
      try {
        const obj = JSON.parse(lines[i]);
        const text = obj.text || obj.code || obj.body || '';
        if (text.length >= 500) samples.push({ repo: 'gencodesearchnet', path: `doc_${i}`, language: obj.language || 'unknown', text });
      } catch {}
    }
  }

  return samples;
}

function buildEmbeddingTextLike(text, fakeMeta = {}) {
  // Mimic production bi-encoder embedding text shape: 4 header lines + content.
  // This matches buildEmbeddingText 'current' variant.
  const parts = [];
  parts.push(`# ${fakeMeta.path || 'src/example/file.py'}`);
  if (fakeMeta.parentSymbol) parts.push(`# Parent: class ${fakeMeta.parentSymbol}`);
  parts.push(`# function: ${fakeMeta.symbol || 'do_thing'}`);
  parts.push(`# Language: ${fakeMeta.language || 'python'}`);
  parts.push(text.trim());
  return parts.join('\n');
}

async function main() {
  await fs.mkdir(RESULTS_DIR, { recursive: true });

  console.error('[probe] Loading tokenizers...');
  const { embTok, liTok } = await loadTokenizers();

  console.error('[probe] Loading samples (real offender chunks + GenCodeSearchNet docs)...');
  const samples = await loadOffenderSamples();
  console.error(`[probe] ${samples.length} samples`);

  if (!samples.length) {
    console.error('[probe] No samples loaded; aborting.');
    process.exit(1);
  }

  // Buckets for analysis
  const records = [];

  for (const s of samples) {
    const fullText = buildEmbeddingTextLike(s.text, { language: s.language });

    // Slice variants
    const at2000 = fullText.slice(0, 2000);
    const at2200 = fullText.slice(0, 2200);
    const at2400 = fullText.slice(0, 2400);

    // Token counts (no truncation, so we see the natural length)
    const tokFull = tokenizeNoTruncate(embTok, fullText);
    const tok2000 = tokenizeNoTruncate(embTok, at2000);
    const tok2200 = tokenizeNoTruncate(embTok, at2200);
    const tok2400 = tokenizeNoTruncate(embTok, at2400);

    // What the bi-encoder actually receives at production max_length=512:
    // it's min(actual, 512). So for chars 2000 vs 2200 to matter, the
    // 2000-char slice must produce <512 tokens.
    const charsPerToken = fullText.length / Math.max(1, tokFull);
    const truncatedAt2000 = tok2000 >= 512;

    let liTokFull = null, liTok2000 = null, liTok2200 = null;
    if (liTok) {
      liTokFull = tokenizeNoTruncate(liTok, fullText);
      liTok2000 = tokenizeNoTruncate(liTok, at2000);
      liTok2200 = tokenizeNoTruncate(liTok, at2200);
    }

    records.push({
      repo: s.repo,
      path: s.path,
      language: s.language,
      fullChars: fullText.length,
      embTokensFull: tokFull,
      embTokensAt2000: tok2000,
      embTokensAt2200: tok2200,
      embTokensAt2400: tok2400,
      liTokensFull: liTokFull,
      liTokensAt2000: liTok2000,
      liTokensAt2200: liTok2200,
      charsPerToken: Number(charsPerToken.toFixed(2)),
      bi_truncated_at_2000: truncatedAt2000,
    });
  }

  // Aggregate
  const charsPerTokenVals = records.map(r => r.charsPerToken);
  const embAt2000Vals = records.map(r => r.embTokensAt2000);
  const embFullVals = records.map(r => r.embTokensFull);
  const liAt2000Vals = records.map(r => r.liTokensAt2000).filter(v => v != null);

  // Did the 2200 slice change biencoder token count given truncation@512?
  // Effective tokens = min(tokensAt..., 512)
  let effDifferEmb = 0;
  let effDifferLi = 0;
  let truncatedAt2000Embed = 0;
  let truncatedAt2000Li = 0;
  let chunksWithTailVisible = 0;
  for (const r of records) {
    const eff2000 = Math.min(r.embTokensAt2000, 512);
    const eff2200 = Math.min(r.embTokensAt2200, 512);
    if (eff2200 !== eff2000) effDifferEmb++;
    if (r.embTokensAt2000 >= 512) truncatedAt2000Embed++;
    else chunksWithTailVisible++;

    if (r.liTokensAt2000 != null) {
      const lieff2000 = Math.min(r.liTokensAt2000, 2048);
      const lieff2200 = Math.min(r.liTokensAt2200, 2048);
      if (lieff2000 !== lieff2200) effDifferLi++;
      if (r.liTokensAt2000 >= 2048) truncatedAt2000Li++;
    }
  }

  const summary = {
    samples: records.length,
    biencoder: {
      productionMaxTokens: 512,
      charsPerToken: quantiles(charsPerTokenVals),
      tokensAt2000Chars: quantiles(embAt2000Vals),
      tokensFullText: quantiles(embFullVals),
      truncatedAt2000Slice: truncatedAt2000Embed,
      truncatedPct: +(100 * truncatedAt2000Embed / records.length).toFixed(1),
      chunksWhereTailWouldBeVisible: chunksWithTailVisible,
      chunksWhereRaisingTo2200WouldChangeTokens: effDifferEmb,
      verdict: effDifferEmb === 0
        ? 'Raising cap from 2000→2200 chars CANNOT change biencoder input — already token-truncated at 512 in every sample.'
        : `Raising cap from 2000→2200 chars changes biencoder input on ${effDifferEmb}/${records.length} (${(100 * effDifferEmb / records.length).toFixed(1)}%) of samples.`,
    },
    li: liTok ? {
      productionMaxTokens: 2048,
      tokensAt2000Chars: quantiles(liAt2000Vals),
      truncatedAt2000Slice: truncatedAt2000Li,
      truncatedPct: +(100 * truncatedAt2000Li / records.length).toFixed(1),
      chunksWhereRaisingTo2200WouldChangeTokens: effDifferLi,
      verdict: effDifferLi === 0
        ? 'Raising cap from 2000→2200 chars makes no LI difference (already truncated at 2048).'
        : `Raising cap from 2000→2200 chars changes LI input on ${effDifferLi}/${records.length} (${(100 * effDifferLi / records.length).toFixed(1)}%) of samples.`,
    } : { unavailable: 'LI tokenizer not loaded' },
  };

  // Print headline result
  console.error('');
  console.error('======== Tokenizer-limit probe ========');
  console.error(`samples: ${summary.samples}`);
  console.error(`chars/token p50/p90/p99: ${summary.biencoder.charsPerToken.p50}/${summary.biencoder.charsPerToken.p90}/${summary.biencoder.charsPerToken.p99}`);
  console.error(`Bi-encoder tokens at 2000-char slice  p50/p90/p99: ${summary.biencoder.tokensAt2000Chars.p50}/${summary.biencoder.tokensAt2000Chars.p90}/${summary.biencoder.tokensAt2000Chars.p99}`);
  console.error(`Bi-encoder truncated at 2000-char slice: ${summary.biencoder.truncatedAt2000Slice}/${summary.samples} (${summary.biencoder.truncatedPct}%)`);
  console.error(`Bi-encoder verdict: ${summary.biencoder.verdict}`);
  if (summary.li.productionMaxTokens) {
    console.error(`LI tokens at 2000-char slice p50/p90/p99: ${summary.li.tokensAt2000Chars.p50}/${summary.li.tokensAt2000Chars.p90}/${summary.li.tokensAt2000Chars.p99}`);
    console.error(`LI verdict: ${summary.li.verdict}`);
  }
  console.error('=======================================');

  const outPath = path.join(RESULTS_DIR, 'tokenizer-limit-probe.json');
  await fs.writeFile(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    summary,
    samples: records,
  }, null, 2));
  console.error(`\nWrote ${outPath}`);
}

main().catch(err => {
  console.error('[probe] failed:', err);
  process.exit(1);
});
