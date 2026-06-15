// Pure bi-encoder AdvTest diagnostic.
// Embeds whole raw functions (no chunking, no enrichment) and prefixed queries
// with the SAME CodeRankEmbed config we ship, then does exact cosine over the
// full 19,210-doc pool. Isolates the ENCODER from the retrieval pipeline so we
// can tell whether the ~51 vs published 59.5 gap is the encoder or the pipeline.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEmbeddings, warmup } from '../core/embedding/embedding-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data', 'advtest');
const QSAMPLE = parseInt(process.env.QSAMPLE || '3000', 10);

const docs = fs.readFileSync(path.join(DATA, 'corpus.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const queries = fs.readFileSync(path.join(DATA, 'queries.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).slice(0, QSAMPLE);
console.log(`docs=${docs.length} queries=${queries.length}`);

const docIdx = new Map(docs.map((d, i) => [d.doc_id, i]));

await warmup();

function l2norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= s; return v; }

async function embedAll(texts, isQuery) {
  const out = []; const B = 256;
  for (let i = 0; i < texts.length; i += B) {
    const batch = texts.slice(i, i + B);
    const embs = await getEmbeddings(batch, { isQuery });
    for (const e of embs) out.push(l2norm(Float32Array.from(e.embedding || e)));
    if ((i / B) % 8 === 0) process.stdout.write(`\r  ${isQuery ? 'Q' : 'D'} ${Math.min(i + B, texts.length)}/${texts.length}`);
  }
  process.stdout.write('\n');
  return out;
}

const QUERY_PREFIX = 'Represent this query for searching relevant code: ';
console.log('Embedding documents (whole raw function, no prefix)...');
const D = await embedAll(docs.map(d => d.code), false);
console.log('Embedding queries (manual prefix, since batch API does not add it)...');
const Q = await embedAll(queries.map(q => QUERY_PREFIX + q.query), false);
// sanity: vectors must be distinct and unit-norm
{ let s=0; for(let k=0;k<D[0].length;k++) s+=D[0][k]*D[1][k]; console.log(`sanity: cos(D0,D1)=${s.toFixed(4)} (should be <1, not NaN)`); }

const dim = D[0].length;
let mrr10 = 0, mrrUncapped = 0, hit1 = 0, hit10 = 0, hit100 = 0;
for (let qi = 0; qi < queries.length; qi++) {
  const goldIdx = docIdx.get(queries[qi].relevant_doc_ids[0]);
  if (goldIdx === undefined) continue;
  const q = Q[qi];
  // score of gold + count how many docs beat it (rank)
  let goldScore = 0; for (let k = 0; k < dim; k++) goldScore += q[k] * D[goldIdx][k];
  let rank = 1;
  for (let d = 0; d < D.length; d++) {
    if (d === goldIdx) continue;
    const dd = D[d]; let s = 0;
    for (let k = 0; k < dim; k++) s += q[k] * dd[k];
    if (s > goldScore) rank++;
  }
  if (rank === 1) hit1++;
  if (rank <= 10) { hit10++; mrr10 += 1 / rank; }
  if (rank <= 100) hit100++;
  mrrUncapped += 1 / rank;
  if (qi % 200 === 0) process.stdout.write(`\r  scoring ${qi}/${queries.length}`);
}
const n = queries.length;
console.log(`\n\n=== PURE BI-ENCODER (CodeRankEmbed, whole-function, full ${docs.length} pool) ===`);
console.log(`MRR@10        = ${(mrr10 / n * 100).toFixed(2)}%`);
console.log(`MRR uncapped  = ${(mrrUncapped / n * 100).toFixed(2)}%   <- compare to published 59.5 (MRR@1000)`);
console.log(`Hit@1=${(hit1/n*100).toFixed(1)}%  Recall@10=${(hit10/n*100).toFixed(1)}%  Recall@100=${(hit100/n*100).toFixed(1)}%`);
process.exit(0);
