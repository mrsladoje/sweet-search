# Held-out 2 — RunPod golden-indexing handoff

Everything below runs on **your** side: the pod builds and indexes the goldens, the Mac
vaults them. Nothing here touches the eval box, and no agent or API call is involved.

Regenerate the inputs any time with `node select/make_pod_specs.mjs` (idempotent — it
re-reads the vault and re-reports what is still missing).

## What has to be built

| | |
|---|---|
| tasks | 267 — 200 primary + 67 reserve |
| unique cache keys | **267** (no two tasks share a `repo@commit`) |
| already in the Mac vault | **0** |
| to build on the pod | **267** — 200 primary first, then 67 reserve |

Sixteen of the 267 are repos the vault already holds *at a different commit*
(`redis/redis`, `devlooped/moq`, `ant-design-blazor`, `locationtech/jts`, …). The cache key
includes the base commit, so none of them is reusable — they are fresh builds.

Rough sizing from the existing vault: 239 keys ≈ 71 GB, so ~300 MB per golden and **~80 GB**
for this fleet. The Mac has 3.2 TB free. The pod never holds more than one at a time — the
driver deletes each key after the Mac has pulled it.

**Reserve tranche:** the reserve only gets used if a primary fails the ledger, so it is
optional. Building it in the same session is cheaper than a second pod rental, and the
ordering means a session cut short still leaves all 200 primaries done. Your call.

## Inputs (both generated, gold-free)

- `select/.cache/heldout2_pod_specs.json` — 267 specs, **instance_id / repo / base_commit /
  language only**. No gold patches, no hidden tests: `golden-build.mjs` needs nothing else,
  and a rented GPU box should never hold the answer key.
- `select/.cache/heldout2_golden_keys.tsv` — `instance_id · cache_key · tranche ·
  vault_state`, the audit list for checking the fleet afterwards.

## Run it

```bash
cd ~/Projects/sweet-search-private/eval/task-completion-bench

# 1. point at the pod (defaults are the previous pod — update host/port)
export SS_POD=root@<POD_HOST> SS_POD_PORT=<PORT> SS_POD_KEY=~/.ssh/id_ed25519

# 2. ship the repo checkout + the gold-free specs to the pod
rsync -aH --exclude .git --exclude node_modules -e "ssh -p $SS_POD_PORT -i $SS_POD_KEY" \
      ~/Projects/sweet-search-private/ "$SS_POD:/root/ss/"
scp -P "$SS_POD_PORT" -i "$SS_POD_KEY" \
    select/.cache/heldout2_pod_specs.json "$SS_POD:/root/ss/heldout2_specs.json"

# 3. drive the fleet from the Mac (serial on the pod, one repo at a time —
#    indexer discipline; resume-safe, re-run it after any interruption)
export SS_POD_SPECS=heldout2_specs.json
harness/pod-golden-fleet.sh select/.cache/heldout2_pod_specs.json
```

`pod-golden-fleet.sh` per key: build on the pod (2 attempts) → rsync into
`~/.ss-eval/vault/golden/<key>/` (2 attempts) → write `.vault-manifest.sha256` → delete the
pod copy. Keys already carrying a manifest are skipped, so re-running after a dropped SSH
session costs nothing. Failures land in `~/.ss-eval/vault/fleet-failed.tsv` with the stage
that failed.

`SS_POD_SPECS` is new — the driver used to hardcode `heldout_specs.json`. That is still the
default, so held-out 1's flow is unchanged.

**Measured rate (2026-07-31, A100 SXM):** mean 3.80 min/key, median 3.48, range 0.1–9.1 min
→ **~12.7 h for the 200 primaries, ~16.9 h for all 267** (~$19 / ~$25 at $1.49/hr). An earlier
"~3 h" estimate here came from the previous fleet's header comment rather than a measurement
and was wrong by roughly 5x. GPU utilisation is near zero during large-repo indexing — most of
the per-key time is clone plus CPU parse/chunk.

## When it finishes

Tell me, and I pick up from there:

1. verify vault integrity — every key present, `.sweet-search/codebase.db` + `.git` in place,
   per-key sha256 manifests re-checked;
2. `golden-vault.sh push --verify` all 200 primaries to the box, locked read-only;
3. golden-presence preflight for all 200 (the check whose absence killed the last run at
   14/200);
4. green ledger — gold-FULL for all 200 under the exact run config, 4-wide on the box.

If some keys fail to build, hand me the `fleet-failed.tsv` and I will run the mechanical
replacement policy: a build failure is one of the three arm-neutral reasons a task may be
swapped for its reserve, and every swap gets logged with its reason.
