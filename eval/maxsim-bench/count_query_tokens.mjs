// stdin: JSON array of query texts -> stdout: JSON array of token counts, exactly as
// the production late-interaction query encoder would produce (prefix, special tokens,
// truncation at maxQueryLength). Uses only the tokenizer; no neural model is loaded.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { LATE_INTERACTION_CONFIG } = await import(`${ROOT}/core/infrastructure/config/index.js`);
const { getModelCacheDir } = await import(`${ROOT}/core/infrastructure/model-fetcher.js`);
const { createTokenizer } = await import(`${ROOT}/core/infrastructure/native-tokenizer.js`);
const m = LATE_INTERACTION_CONFIG.activeModel;
const tok = await createTokenizer(path.join(getModelCacheDir(m.hfId), 'tokenizer.json'));
let s = ''; for await (const c of process.stdin) s += c;
const texts = JSON.parse(s);
const out = texts.map(t => {
  const r = tok(m.queryPrefix + t, { padding: true, truncation: true, max_length: m.maxQueryLength });
  return r.input_ids.dims[1];
});
process.stdout.write(JSON.stringify(out));
