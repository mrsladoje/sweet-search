/**
 * Worker thread for the maintainer's vocabulary refresh: runs computeVocabulary (community
 * detection, mining, ranking — seconds of synchronous work on a large repo) off the
 * maintainer's event loop and posts the plain-data result back.
 */
import { parentPort, workerData } from 'worker_threads';
import { computeVocabulary } from './vocab-warmup-orchestrator.js';

try {
  parentPort.postMessage({ ok: true, result: computeVocabulary(workerData) });
} catch (err) {
  parentPort.postMessage({ ok: false, error: err?.message || String(err) });
}
