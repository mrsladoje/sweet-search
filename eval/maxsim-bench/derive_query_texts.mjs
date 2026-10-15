// node derive_query_texts.mjs <calls.json>  ->  stdout JSON { repo: [ {tool, qid, text|null, numQ|null, why} ] }
// For each replayed ss-* call: the text the tool hands to the late-interaction query
// encoder, derived with the tools' own argument parser (eval/agent-read-workflows/bin/
// _ss-argparse.mjs, same steps as cmdAgentSearch / cmdSemantic / cmdFind in
// _ss-helpers.mjs), and its token count under the production tokenizer (prefix, special
// tokens, truncation). text = null when the tool exits on a usage error before searching.
// Only the tokenizer runs; the neural model is never loaded.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const AP = await import(`${ROOT}/eval/agent-read-workflows/bin/_ss-argparse.mjs`);
const { mergeRegexIntoQuery } = await import(`${ROOT}/core/search/search-pattern.js`);
const { LATE_INTERACTION_CONFIG } = await import(`${ROOT}/core/infrastructure/config/index.js`);
const { getModelCacheDir } = await import(`${ROOT}/core/infrastructure/model-fetcher.js`);
const { createTokenizer } = await import(`${ROOT}/core/infrastructure/native-tokenizer.js`);
const M = LATE_INTERACTION_CONFIG.activeModel;
const tok = await createTokenizer(path.join(getModelCacheDir(M.hfId), 'tokenizer.json'));
const count = t => tok(M.queryPrefix + t, { padding: true, truncation: true, max_length: M.maxQueryLength }).input_ids.dims[1];

const positive = (args, names, fb) => { const p = AP.parsePositiveIntFlag(args, names, fb); return p; };
function search(raw) {
  const args = AP.normalizeArgs(raw);
  for (const f of ['--full', '--xl']) if (args.includes(f)) args.splice(args.indexOf(f), 1);
  if (positive(args, ['-k', '--top'], 5).error) return [null, 'usage:k'];
  if (AP.parseValueFlag(args, '--mode', 'auto').error) return [null, 'usage:mode'];
  const { pattern, unknownFlag } = AP.extractPositional(args);
  if (unknownFlag || !pattern) return [null, 'usage:pos'];
  return [pattern, 'ok'];
}
function semantic(raw) {
  const args = AP.normalizeArgs(raw);
  if (AP.parseValueFlag(args, '--max-tokens', null).error) return [null, 'usage:mt'];
  const at = args.findIndex(a => /^-k\d+$/.test(a));
  if (at !== -1) args.splice(at, 1, '-k', args[at].slice(2));
  if (positive(args, ['-k', '--top'], null).error) return [null, 'usage:k'];
  const inf = AP.parseValueFlag(args, ['--in', '--file'], null);
  if (inf.error) return [null, 'usage:in'];
  if (args.find(AP.looksLikeOption)) return [null, 'usage:opt'];
  if (inf.value && args.length > 1) return [null, 'usage:both'];
  const query = inf.value ? args[0] : args[1];
  const file = inf.value ?? args[0];
  if (!file || !query) return [null, 'usage:pos'];
  return [query, 'ok'];
}
function find(raw) {
  const args = AP.normalizeArgs(raw);
  for (const f of ['--full', '--xl']) if (args.includes(f)) args.splice(args.indexOf(f), 1);
  const ic = AP.parseBoolFlag(args, ['-i', '--ignore-case']);
  const wb = AP.parseBoolFlag(args, ['-w', '--word-regexp']);
  const fx = AP.parseBoolFlag(args, ['-F', '--fixed-strings']);
  if (positive(args, ['-k', '--top'], 6).error) return [null, 'usage:k'];
  const rx = AP.parseValueFlag(args, '--regex', '', { allowOptionValue: true });
  if (rx.error) return [null, 'usage:rx'];
  const ins = AP.parseRepeatedValueFlag(args, '--in'); if (ins.error) return [null, 'usage:in'];
  const gl = AP.parseGlobFlags(args); if (gl.error) return [null, 'usage:glob'];
  AP.stripInertFlags(args);
  const { pattern, unknownFlag } = AP.extractPositional(args);
  if (unknownFlag || !pattern) return [null, 'usage:pos'];
  const eff = AP.buildGrepPattern(rx.value || '', { ignoreCase: ic, wordBound: wb, fixedString: fx }) || `\\b\\w+\\b`;
  return [mergeRegexIntoQuery(pattern, eff), 'ok', pattern];
}
const calls = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const [repo, list] of Object.entries(calls)) {
  out[repo] = list.map(c => {
    const [text, why, raw] = { 'ss-search': search, 'ss-semantic': semantic, 'ss-find': find }[c.tool]([...c.args]);
    return { tool: c.tool, qid: c.qid, text, why, numQ: text == null ? null : count(text), rawText: raw ?? text, rawNumQ: raw == null ? null : count(raw) };
  });
}
process.stdout.write(JSON.stringify(out));
