/**
 * Benchmark index builds run on the accelerator, never by the index-device
 * speed test (one test on a busy machine could move them to the CPU). A host
 * with no accelerator still indexes on ORT CPU: the pin only removes the test.
 *
 * No core imports: importing core config here would fix its paths to the
 * launching directory before a benchmark selects its corpus.
 */

const ACCELERATOR_VALUES = ['accelerator', 'gpu', 'metal', 'cuda'];

/**
 * The SWEET_SEARCH_INDEX_DEVICE value for a benchmark indexer. Throws when the
 * environment asks for anything else, so a CPU build is never silent.
 */
export function benchIndexDevice(env = process.env) {
  const raw = (env.SWEET_SEARCH_INDEX_DEVICE ?? '').trim().toLowerCase();
  if (raw && !ACCELERATOR_VALUES.includes(raw)) {
    throw new Error(
      `SWEET_SEARCH_INDEX_DEVICE="${env.SWEET_SEARCH_INDEX_DEVICE}" is not allowed for benchmark indexes `
      + '(they are always built on the accelerator). Unset it.',
    );
  }
  return 'accelerator';
}
