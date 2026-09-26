# confirm10 — 10-task confirm set for overnight A/B micro-smokes

Built 2026-09-26 on the Mac. Model spend: **$0** (no model calls).

**IDs (comma list, for `INSTANCES=`):**

```
smooth-code__svgr-10,maxgraph__maxgraph-365,rokucommunity__brighterscript-1050,dbader__node-datadog-metrics-73,fastify__fastify-cors-285,superlistapp__super_editor-2516,joshuakgoldberg__bingo-271,mwouts__jupytext-360,zmap__zlint-299,ember-cli__eslint-plugin-ember-551
```

- Specs: `results/confirm10/specs.json` (full task records, same shape as `tasks_full_heldout.json`)
- IDs + golden keys: `results/confirm10/ids.json`
- Env ledger: `results/confirm10/ledger/ledger.jsonl` (all 10 are `FULL gold-valid` under `--network none`)
- Image tars: `~/.ss-eval/image-tars/docker.io_swerebenchv2_<name>_<tag>.tar` (10 tars, kept)

## The 10 tasks

Grade time = wall time of one gold-grading pass (`env-ledger-sweep.mjs`, batch 1, one worker),
container start included, x86 emulation on Colima. Another benchmark run was active on the
machine during every measurement, so these times are upper bounds.

| task | lang | tracked files | source size | F2P | gold patch | grade time | pool |
|---|---|---:|---:|---:|---|---:|---|
| `smooth-code__svgr-10` | js | 48 | 0.3 MB | 1 | 93 lines / 6 files | 37 s | DEV-RET |
| `maxgraph__maxgraph-365` | ts | 784 | 7.6 MB | 2 | 25 lines / 2 files | 41 s | DEV-RET |
| `rokucommunity__brighterscript-1050` | ts | 248 | 6.0 MB | 2 | 248 lines / 4 files | 253 s | DEV-RET |
| `dbader__node-datadog-metrics-73` | js | 19 | 0.1 MB | 1 | 117 lines / 3 files | 120 s | DEV-RET |
| `fastify__fastify-cors-285` | js | 22 | 0.1 MB | 10 | 13 lines / 1 file | 161 s | DEV-RET |
| `superlistapp__super_editor-2516` | dart | 1724 | 33.8 MB | 2 | 39 lines / 1 file | 49 s | multilingual (dev) |
| `joshuakgoldberg__bingo-271` | ts | 379 | 1.1 MB | 8 | 420 lines / 10 files | 165 s | DEV-RET |
| `mwouts__jupytext-360` | python | 438 | 12.8 MB | 33 | 330 lines / 4 files | 73 s | DEV-RET |
| `zmap__zlint-299` | go | 1530 | 13.3 MB | 2 | 18 lines / 1 file | 88 s | DEV-RET |
| `ember-cli__eslint-plugin-ember-551` | js | 192 | 0.8 MB | 2 | 122 lines / 5 files | 20 s | DEV-RET |

DEV-RET = `select/.cache/tasks_full_heldout.json` (the first held-out 200, retired to dev).

Languages: 4 js, 3 ts, 1 python, 1 go, 1 dart. **No Rust and no Java task qualified** (see below).

## Caveats

1. **The language mix is JS/TS-heavy (7 of 10).** Every Rust and Java candidate with a local
   golden either needs a box-built "warm" image or fails gold grading offline here.
2. **Two repos are very small**: `node-datadog-metrics` (19 files) and `fastify-cors` (22 files).
   Retrieval has little to do on them. Gold-valid alternates that are larger but need a golden
   build first: `rrd108__vue-mess-detector-129` (ts, grade 47 s, no index yet) and
   `zestedesavoir__zmarkdown-248` (js, grade 26 s, index needs a rebuild).
3. **`zmap__zlint-299` is a control task** (adopted in `CONTROL-REPLACEMENT-RESULTS.md`, 2026-08-24):
   both arms solved it in every recorded rollout. It will not flip. Swap it if the smoke needs
   every task to be able to move.
4. **`brighterscript-1050` grading took 253 s.** The other nine took 20–165 s.
5. **Difficulty is not measured** for these 10. No per-task solve rates for them are stored on
   this Mac. The patch sizes (13–420 lines, 1–10 files) suggest a spread.
6. All 10 passed the name-lock screen (`stamp-name-lock.mjs --report-only`, base trees under
   `~/.ss-eval/golden`) and the vacuity markers from `vacuity-prescreen.mjs` (square-bracket
   timing marker included). None has `excludeFromAgentRuns`. None is a held-out-2 task.

## Goldens

All 10 goldens are under `~/.ss-eval/golden/<repo__name>@<base_commit>`, and
`golden-rebuild-need.mjs` reports `no change` for 9 of them (checked 2026-09-26 01:34 UTC).
`bingo-271` shows `REBUILD` (21 build-dir sources), which is a known false alarm: its golden
already has a Mac index-build stamp (2026-09-02), and the script counts the tree's build-dir
sources, which a reindex cannot change.

Goldens built or rebuilt in this task, one at a time, only while no `run-pilot` process was
running. All forced ORT INT8 (`SWEET_SEARCH_NATIVE_INFERENCE=0 SWEET_SEARCH_COREML_CASCADE=0`),
the log shows `No inference accelerator detected — indexing on ORT INT8 CPU` and
`backend: cpu, quantized: q8`, `HEAD^{tree}` is unchanged, and each has a stamp in
`~/.ss-eval/golden/.provenance-index/`:

| golden | why | time |
|---|---|---:|
| `mwouts__jupytext@a29e91d…` | rebuild: 1 committed bundle in the old index; now 0 | 527 s |
| `ember-cli__eslint-plugin-ember@eb62f6f…` | no index existed | 414 s |
| `pdm-project__pdm@881cd4e…` | no index existed; **wasted** — pdm then failed gold grading offline | 1034 s |

The old jupytext index is kept at `~/.ss-eval/tmp/jupytext-old-index/.sweet-search`.
None of these goldens is vaulted or pushed to the box.

## Preflight

Run at 2026-09-26 01:34 UTC in a gap with zero `run-pilot` processes, with the exact command
from the brief (`PREFLIGHT_ONLY=1`, `HARNESS=codex`, `ARMS=sweet`, `ENV_LEDGER=results/confirm10/ledger/ledger.jsonl`).
Exit 0. Output:

```
[env-ledger] pre-flight OK: 10/10 selected tasks gold-FULL under current config (results/confirm10/ledger/ledger.jsonl)
[env-ledger] PREFLIGHT_ONLY=1 — exiting after pre-flight (no rollouts run).
```

The 10 images were loaded into Colima just before the preflight. The sweep deletes images after
grading, so reload them from the tars if the run starts later (the night launcher does this).

## Candidates that failed (26 screened: 24 gold-graded, 2 stopped earlier)

| task | lang | result |
|---|---|---|
| `getmoto__moto-7964` | python | name-locked |
| `s-knibbs__dataclasses-jsonschema-32` | python | image not on Docker Hub (401); repo also only 12 files |
| `diegoholiveira__jsonlogic-38` | go | needs network at test time; prep-warm gate failed (f2p 0/1, 302 P2P fail) |
| `rust-analyzer__rust-analyzer-313` | rust | needs network; prep-warm gate failed (f2p 8/9, 1 P2P fail) |
| `pajlads__dinkplugin-114` | java | needs network; prep-warm gate failed (f2p 0/155) |
| `pdm-project__pdm-2781` | python | needs network; prep-warm gate failed (f2p 0/1) |
| `aperezdc__ngx-fancyindex-118` | c | needs network |
| `stackexchange__dnscontrol-2332` | go | needs network |
| `absinthe-graphql__absinthe-998` | elixir | grading ran 874 s, stopped; graded broken |
| `firebase__firebase-tools-2933` | ts | grading over 5 min, stopped; graded broken |
| `apple__swift-nio-http2-145` | swift | grading over 5 min, stopped; graded broken |
| `dotnet__yarp-2825` | csharp | grading over 5 min, stopped; graded broken |
| `codeception__codeceptjs-367` | js | env-broken (8 P2P fail with gold) |
| `jashkenas__underscore-2757` | js | env-broken (1 P2P fail with gold) |

Not tried: every task whose override points at a `swerebenchv2-warm/*` or `-fixed/*` image.
Those images were built on the box and are not on this Mac.

## Notes for the run owner

- `prep-warm.mjs` on macOS: its in-flight disk guard calls GNU `df -BG`, reads 0 GB, and kills
  the warm container after 30 s. Pass `--min-free-inflight-gb 0` on the Mac.
- `harness/task-overrides.json` is unchanged (every warm gate failed, so nothing was wired).
- The tars for dropped candidates are in `~/.ss-eval/image-tars-confirm10-dropped/`, so the
  night-queue launcher does not load them. Delete that folder when it is no longer useful.
