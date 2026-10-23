import { afterEach, describe, expect, it } from 'vitest';

import { callLocalModel, unloadLocalModel } from '../../core/embedding/embedding-local-model.js';
import { encodeQuery, unloadLateInteractionModel } from '../../core/ranking/late-interaction-model.js';
import { startQueryEncoder, stopQueryEncoder, queryModelIdleMs, DEFAULT_QUERY_MODEL_IDLE_MS } from '../../core/search/query-encoder.mjs';
import { applyPersistedLiModel } from '../../core/infrastructure/init-config.js';

// The daemon held both query models for life (~940 MB); an in-process release gave back
// ~650 MB and leaked ~220 MB per reload. They now run in an idle-exiting child. Its output
// must equal the in-process models' exactly.
const flat = (rows) => rows.map((r) => Array.from(r));

describe('query encoder child', () => {
  let client = null;
  afterEach(async () => {
    stopQueryEncoder(client);
    client = null;
  });

  it('defaults to 15 min idle; the env overrides it', () => {
    expect(queryModelIdleMs({})).toBe(DEFAULT_QUERY_MODEL_IDLE_MS);
    expect(DEFAULT_QUERY_MODEL_IDLE_MS).toBe(15 * 60_000);
    expect(queryModelIdleMs({ SWEET_SEARCH_QUERY_MODEL_IDLE_MS: '5000' })).toBe(5000);
  });

  it('gives the same vectors as the in-process models, exits when idle and restarts', async () => {
    const text = 'search_query: how is the invoice total computed';
    let local;
    let li;
    // The child applies the project's persisted LI model (encoder-host.mjs), as
    // SweetSearch does in the daemon; the in-process baseline must use the same one.
    applyPersistedLiModel(process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd());
    try {
      local = await callLocalModel([text], { maxLength: 128 });
      li = await encodeQuery('how is the invoice total computed');
    } catch {
      return; // models not installed on this machine
    }
    await unloadLocalModel();
    await unloadLateInteractionModel();

    client = startQueryEncoder({ env: { ...process.env, SWEET_SEARCH_QUERY_MODEL_IDLE_MS: '1500' } });
    const viaChild = await callLocalModel([text], { maxLength: 128 });
    const liViaChild = await encodeQuery('how is the invoice total computed');
    expect(flat(viaChild)).toEqual(flat(local));
    expect(flat(liViaChild)).toEqual(flat(li));
    expect(client.pid).toBeGreaterThan(0);

    for (let i = 0; i < 300 && client.pid !== null; i++) await new Promise((r) => setTimeout(r, 100));
    expect(client.pid).toBeNull(); // idle: the process exited, its memory with it
    client.prewarm(); // an agent call before the search starts it again
    expect(client.pid).toBeGreaterThan(0);
    expect(flat(await encodeQuery('how is the invoice total computed'))).toEqual(flat(li));
    expect(client.spawns).toBe(2);
  }, 120_000);
});
