/**
 * Indexer Worker — worker_thread entry point for ORT inference.
 *
 * Loads a model (embedding or LI) and processes batches received from
 * the main thread. Each worker owns its own ORT session with an
 * independent thread pool for true CPU parallelism.
 */

import { parentPort, workerData } from 'worker_threads';

const { modelType, intraOpThreads, workerIndex } = workerData;

if (modelType === 'embedding') {
  await initEmbeddingWorker();
} else if (modelType === 'late-interaction') {
  await initLateInteractionWorker();
} else {
  parentPort.postMessage({ type: 'error', message: `Unknown model type: ${modelType}` });
  process.exit(1);
}

async function initEmbeddingWorker() {
  const { initOrt, buildFeed } = await import('../infrastructure/ort-pipeline.js');
  const { createTokenizer } = await import('../infrastructure/native-tokenizer.js');
  const { fetchModel, getModelCacheDir } = await import('../infrastructure/model-fetcher.js');
  const { getModelEntry } = await import('../infrastructure/model-registry.js');
  const { extractPooledEmbeddings, buildLocalSessionOptions } = await import('../embedding/embedding-local-model.js');
  const { join } = await import('path');

  const INDEXING_MAX_LENGTH = parseInt(process.env.SWEET_SEARCH_INDEXING_MAX_LENGTH || '512', 10);

  // Load model
  await fetchModel('coderankembed-int8');
  const ort = await initOrt();
  const entry = getModelEntry('coderankembed-int8');
  const onnxPath = join(getModelCacheDir(entry.hfId), entry.files.find(f => f.path.endsWith('.onnx')).path);
  const tokenizerPath = join(getModelCacheDir(entry.hfId), 'tokenizer.json');
  const tokenizer = await createTokenizer(tokenizerPath);

  const sessionOptions = buildLocalSessionOptions('q8', false, { intraOpThreads });
  delete sessionOptions.executionProviders;
  const session = await ort.InferenceSession.create(onnxPath, sessionOptions);

  // Two-pass warmup
  const warmupTexts = [
    'export class AuthService { constructor(private jwtProvider) {} }',
    'function buildIndex(vectors) { return new HNSWIndex({ dimension: 256 }); }',
  ];
  for (let pass = 0; pass < 2; pass++) {
    const tk = tokenizer(warmupTexts, { padding: true, truncation: true, max_length: INDEXING_MAX_LENGTH });
    await session.run(buildFeed(tk, session.inputNames));
  }

  parentPort.postMessage({ type: 'ready', workerIndex });

  // Handle inference requests
  parentPort.on('message', async (msg) => {
    if (msg.type === 'embed') {
      try {
        const { texts, maxLength, batchId } = msg;
        const tokenized = tokenizer(texts, {
          padding: true,
          truncation: true,
          max_length: maxLength || INDEXING_MAX_LENGTH,
        });
        const feed = buildFeed(tokenized, session.inputNames);
        const outputs = await session.run(feed);
        const pooled = extractPooledEmbeddings(outputs, tokenized.attention_mask, true);

        // Transfer the embedding buffer to avoid copying
        const buffer = pooled.data.buffer;
        parentPort.postMessage(
          {
            type: 'embedResult',
            batchId,
            buffer,
            dim: pooled.dim,
            count: pooled.batchSize,
          },
          [buffer], // transferList: zero-copy
        );
      } catch (err) {
        parentPort.postMessage({
          type: 'embedResult',
          batchId: msg.batchId,
          error: err.message,
        });
      }
    }
  });
}

async function initLateInteractionWorker() {
  const {
    configureLateInteractionRuntime,
    getLateInteractionPipeline,
    encodeDocuments,
  } = await import('../ranking/late-interaction-model.js');

  configureLateInteractionRuntime({ intraOpThreads });
  await getLateInteractionPipeline();
  parentPort.postMessage({ type: 'ready', workerIndex });

  parentPort.on('message', async (msg) => {
    if (msg.type === 'encodeDocuments') {
      try {
        const { texts, poolFactor, extendedSkiplist, batchId } = msg;
        const docs = await encodeDocuments(texts, { poolFactor, extendedSkiplist });
        const firstToken = docs.find(doc => doc.length > 0)?.[0];
        const dim = firstToken?.length || 0;
        const tokenCounts = new Uint32Array(docs.length);
        const totalTokens = docs.reduce((sum, doc, index) => {
          tokenCounts[index] = doc.length;
          return sum + doc.length;
        }, 0);

        const vectors = new Float32Array(totalTokens * dim);
        const preNorms = new Float32Array(totalTokens);
        let tokenOffset = 0;
        for (const doc of docs) {
          const docPreNorms = doc.preNorms;
          for (let i = 0; i < doc.length; i++) {
            if (dim > 0) vectors.set(doc[i], tokenOffset * dim);
            preNorms[tokenOffset] = docPreNorms?.[i] ?? 0;
            tokenOffset++;
          }
        }

        parentPort.postMessage({
          type: 'encodeDocumentsResult',
          batchId,
          dim,
          count: docs.length,
          totalTokens,
          tokenCountsBuffer: tokenCounts.buffer,
          vectorsBuffer: vectors.buffer,
          preNormsBuffer: preNorms.buffer,
        }, [tokenCounts.buffer, vectors.buffer, preNorms.buffer]);
      } catch (err) {
        parentPort.postMessage({
          type: 'encodeDocumentsResult',
          batchId: msg.batchId,
          error: err.message,
        });
      }
    }
  });
}
