// Stand-in for core/indexing/encoder-ops.mjs in the shared query-model server tests.
export async function runEncoderOp(op, texts, { options = {} } = {}) {
  if (op === 'pid') return process.pid;
  if (op === 'echo') return texts.map((t) => Float32Array.from([t.length, options.scale ?? 1]));
  if (op === 'env') return process.env[texts[0]] ?? null;
  if (op === 'fail') throw new Error('fake failure');
  if (op === 'exit') setTimeout(() => process.exit(0), 10);
  return null;
}
