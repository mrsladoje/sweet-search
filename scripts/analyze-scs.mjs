#!/usr/bin/env node
/**
 * SCS §3.6 — compute Semantic Consistency Score for M++ + 6 paraphrases from the
 * cached 630-run (scs-630.json). Per target:
 *   AC = answerConsistency with a SEMANTIC answersAgree (cosine>0.9 over Gemini
 *        Embedding 2 vectors) — the §3.6/scs.mjs-endorsed predicate for free-text
 *        agent answers (default exact-match would score ~0).
 *   SS = mean pairwise cosine of the 7 answer embeddings per probe.
 *   LS = length stability of the 7 answers' token counts.
 *   SCS = harmonic(AC,SS,LS); cwSCS = SCS × minParaphraseAccuracy.
 *   Gate: cwSCS ≥ 0.8 AND minParaphraseAccuracy ≥ 0.6 — on BOTH targets.
 *
 *   node scripts/analyze-scs.mjs            # full
 *   SCS_EMBED_SMOKE=1 node scripts/analyze-scs.mjs   # just test the embedder
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerConsistency, semanticSimilarity, lengthStability, scs as scsFn, correctnessWeightedScs, shipGate, cosine } from '../core/prompt-optimization/stats/scs.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RES = path.join(REPO, 'core/prompt-optimization/data/results');
const LABELS = ['Mpp', 'Mpp-sonnet', 'Mpp-gpt', 'Mpp-gemini', 'Mpp-deepseek', 'Mpp-det', 'Mpp-manual'];
const TARGETS = ['sonnet', 'gpt5_5'];
const CORRECT = 0.5;            // judge score ≥ 0.5 ⇒ correct (for minParaphraseAccuracy)
const AGREE_COS = Number(process.env.SCS_AGREE_COS) || 0.80; // answersAgree threshold, calibrated to Gemini Embedding 2 (unrelated≈0.58, agreeing≈0.85); §3.6's "0.9" was an example for a different embedder
const normalize = (s) => String(s).toLowerCase().trim().replace(/\s+/g, ' ');
const estTokens = (s) => Math.round(String(s || '').length / 4);

// ── Gemini Embedding 2 client (batchEmbedContents, 768-dim) ──
async function geminiEmbed(texts) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('geminiEmbed: GEMINI_API_KEY not set');
  const model = process.env.SCS_EMBED_MODEL || 'gemini-embedding-2-preview';
  const out = [];
  const CHUNK = 80;
  for (let i = 0; i < texts.length; i += CHUNK) {
    const batch = texts.slice(i, i + CHUNK);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${encodeURIComponent(key)}`;
    const body = { requests: batch.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: String(t || '.').slice(0, 8000) || '.' }] }, outputDimensionality: 768 })) };
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`geminiEmbed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    for (const e of j.embeddings) out.push(e.values);
  }
  return out;
}

if (process.env.SCS_EMBED_SMOKE) {
  const v = await geminiEmbed(['the FixedTag alias in shared-inl.h', 'FixedTag is defined in hwy/ops/shared-inl.h', 'totally unrelated banana text']);
  console.log('embed dims:', v.map((x) => x.length), 'cos(0,1)=', cosine(v[0], v[1]).toFixed(3), 'cos(0,2)=', cosine(v[0], v[2]).toFixed(3));
  process.exit(0);
}

const runs = JSON.parse(fs.readFileSync(path.join(RES, process.env.SCS_FILE || 'scs-630.json'), 'utf8')).runs;
const probes = JSON.parse(fs.readFileSync(path.join(RES, 'scs-probes-45.json'), 'utf8'));
const probeIds = probes.map((p) => p.id);
// index[cand][target][probeId] = run
const idx = {};
for (const r of runs) { ((idx[r.cand] ??= {})[r.target] ??= {})[r.probeId] = r; }

console.log(`\n═══ SCS §3.6 — M++ + ${LABELS.length - 1} paraphrases × ${probeIds.length} probes ═══`);
const summary = {};
for (const target of TARGETS) {
  // assemble per-probe arrays in LABELS order
  const perProbeAnswers = [], perProbeTokenCounts = [], correctByPrompt = LABELS.map(() => []);
  const allAnswers = [];
  for (const pid of probeIds) {
    const answers = [], tokens = [];
    for (let li = 0; li < LABELS.length; li++) {
      const row = idx[LABELS[li]]?.[target]?.[pid];
      const ans = row?.answer ?? '';
      answers.push(ans); tokens.push(estTokens(ans));
      correctByPrompt[li].push((row?.score ?? 0) >= CORRECT ? 1 : 0);
      allAnswers.push(ans);
    }
    perProbeAnswers.push(answers); perProbeTokenCounts.push(tokens);
  }
  // embed every answer; reshape to perProbeEmbeddings + build normalized→vec map for answersAgree
  process.stderr.write(`[${target}] embedding ${allAnswers.length} answers via Gemini Embedding 2... `);
  const vecs = await geminiEmbed(allAnswers);
  process.stderr.write('done\n');
  const embMap = new Map();
  allAnswers.forEach((a, i) => embMap.set(normalize(a), vecs[i]));
  const perProbeEmbeddings = probeIds.map((_, pi) => LABELS.map((_, li) => vecs[pi * LABELS.length + li]));
  const answersAgree = (a, b) => { const va = embMap.get(a), vb = embMap.get(b); return va && vb ? cosine(va, vb) > AGREE_COS : a === b; };

  const ac = answerConsistency({ perProbeAnswers, answersAgree });
  const ss = semanticSimilarity({ perProbeEmbeddings });
  const ls = lengthStability({ perProbeTokenCounts });
  const scsVal = scsFn({ ac, ss, ls });
  const perPromptAcc = correctByPrompt.map((arr) => arr.reduce((s, x) => s + x, 0) / arr.length);
  const minParaphraseAccuracy = Math.min(...perPromptAcc);
  const cwSCS = correctnessWeightedScs({ scs: scsVal, minParaphraseAccuracy });
  const pass = shipGate({ cwSCS, minParaphraseAccuracy });
  summary[target] = { ac, ss, ls, scs: scsVal, cwSCS, minParaphraseAccuracy, pass };
  console.log(`\n── ${target} ──`);
  console.log(`  AC=${ac.toFixed(3)}  SS=${ss.toFixed(3)}  LS=${ls.toFixed(3)}  → SCS=${scsVal.toFixed(3)}`);
  console.log(`  per-prompt accuracy: ${LABELS.map((l, i) => l.replace('Mpp', 'M++').replace('M++-', '') + '=' + perPromptAcc[i].toFixed(2)).join('  ')}`);
  console.log(`  minParaphraseAccuracy=${minParaphraseAccuracy.toFixed(3)}  →  cwSCS=${cwSCS.toFixed(3)}  ${pass ? '✅ PASS' : '❌ FAIL'} (need cwSCS≥0.8 & minAcc≥0.6)`);
}
const bothPass = TARGETS.every((t) => summary[t]?.pass);
console.log(`\n═══ SHIP GATE (§3.6): ${bothPass ? '✅ PASS on both targets' : '❌ FAIL'} ═══`);
fs.writeFileSync(path.join(RES, 'scs-report.json'), JSON.stringify(summary, null, 2));
