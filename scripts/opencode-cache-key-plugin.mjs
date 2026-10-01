// opencode plugin, bench only (SS_VARIANT_OC_CACHE_KEY=repo; scripts/retrieval-bench-282.mjs).
// Pins the per-session routing headers of OpenAI requests to ONE per-repo value (options.key), the same
// value the runner puts in promptCacheKey. opencode 1.18.4 builds request headers as
//   { 'x-session-affinity': sessionID, 'X-Session-Id': sessionID, 'User-Agent', ...model.headers, ...hookHeaders }
// where hookHeaders is the output of every plugin's `chat.headers` hook; the built-in OpenAI/ChatGPT plugin
// also sets hookHeaders['session-id'] = sessionID. The hook order between that plugin and this one is not
// fixed by us, so each header is defined as an accessor whose setter ignores later writes: whichever hook
// runs last, the per-repo value is what the request carries. Self-contained (no imports): the file is
// loaded from this repo by absolute file:// URL.
const HEADERS = ['session-id', 'x-session-affinity', 'X-Session-Id'];

export default async (_input, options = {}) => {
  const key = typeof options.key === 'string' ? options.key : '';
  if (!key) return {};
  return {
    'chat.headers': async (input, output) => {
      if (input?.model?.providerID !== 'openai' || !output?.headers) return;
      for (const name of HEADERS) {
        const d = Object.getOwnPropertyDescriptor(output.headers, name);
        if (d && !d.configurable) continue;
        Object.defineProperty(output.headers, name, { get: () => key, set: () => {}, enumerable: true, configurable: false });
      }
    },
  };
};
