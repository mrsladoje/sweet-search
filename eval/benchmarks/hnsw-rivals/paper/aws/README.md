# AWS and GPU scripts of the HNSW paper benchmark

This folder holds the scripts for steps S2 to S4, S5b, S8 and S13 of `PAPER_PLAN.md`.
Every script reads the account values from `env.local`. That file stays out of git.
Results go under `s3://<bucket>/hnsw/`, apart from the MaxSim prefixes.
Region is `us-east-1` only. Every resource carries the tags `Project=hnsw-bench` and `Name=hnsw-<name>`.

## Order of use

1. `make_bundles.sh` builds the code and data bundles on the Mac. It uploads nothing.
2. The owner approves the upload. Then run the printed `aws s3 cp` commands. **Needs the owner's go.**
3. `runpod_embed.sh` embeds the sets on a GPU. The owner rents the pod first. **Needs the owner's go.**
4. `launch.sh <name> <type> <amd64|arm64> <mode-chain>` starts one machine. **Every launch needs the owner's go.**
5. The machine runs `bootstrap.sh`, then `run.sh` by itself. It shuts down after the last mode.
6. `collect.sh` copies the results to `~/.ss-eval/hnsw-cloud/`. It only reads S3.
7. `teardown.sh` ends every instance with the project tag. `teardown.sh --all` also copies the bucket data.
   **`--all` needs the owner's go.** It deletes no shared resource. Apply `RESTORE.md` by hand at the end.

## Modes of `run.sh`

| Mode | Step | What it does |
|---|---|---|
| `build` | S4 | Builds every index of the plan files. A build starts only when its peak memory fits in free memory minus 10%. |
| `build-isolated` | S4 | The same, one build at a time. Only these runs give build-cost numbers. |
| `smoke` | S3a | Runs a `--limit 50` dev plan, then `test_harness.sh`. It builds its own small builds only on a build machine (`SMOKE_BUILD=1` or a build mode in the chain). |
| `dev` | S5b | Runs the dev plans. It refuses held-out jobs. |
| `heldout` | S8 | Runs the held-out plans. It needs `FREEZE.json` and a matching code hash. |
| `aa` | S5b, S6 | Runs the A/A plans (two arms of one build, 5 rounds). They give R per machine. Dev split. |
| `hold` | — | The machine does not shut down. The idle watchdog still ends it after 60 idle minutes. |

Example: `./launch.sh intel c8i.4xlarge amd64 build-isolated,smoke DATA=sets-gcsn.tar.zst,emb-CodeRankEmbed-gcsn.tar.zst`.

## Safety limits

- A 72-hour stop starts first in the user data.
- The watchdog ends a machine after 60 minutes without a benchmark process or SSH session.
- `run.sh` prints `done` only when every plan passed. Any failure prints `FAILED: ...` and exits with 1.

## Test without AWS

- `launch.sh --dry ...` prints the command and the user data. It calls no AWS API.
- `SS_LOCAL=1 MACHINE=<name> DATA=<dir> ROOT=<dir> RESULTS=<dir> ./run.sh smoke` runs without S3, without shutdown and without a change of governor or THP.
- `runpod_embed.sh --dry ...` prints every ssh and rsync command.

## Plan files

`run.sh` reads plans from `plans/<machine>/<mode>/*.json`, then `plans/<mode>/*.json`, then `$PLAN_DIR`.
Otherwise it calls `plan.py --mode build|smoke|dev|aa|heldout --machine X --data D --out DIR`.
It adds `--limit 50` for smoke, `--families $RESULTS/<machine>/families.txt` and, for held-out, `--shortlist $SHORTLIST`.
The modes smoke, dev and aa need `k_v` in `sets/<set>/set.json` as `{"k_v": {"<model>": n}}`. `kv.py` computes it on dev after `gt.py`.

## Builds: made once, copied everywhere

- Rival builds live in `$DATA/builds/shared/<set>/<model>/<family>/<hash>`. The hash does not hold the machine or the binary (`jobs.build_dir`).
  The store syncs with `s3://$BUCKET/hnsw/builds/shared/`.
- Our indexes (`build_ours.mjs` into `$DATA/emb/<model>/<set>/index`) sync with `s3://$BUCKET/hnsw/emb/`.
- A build machine uploads what it builds. A timing machine downloads before it times and never builds.
- `SHARD=i/n` lets several build machines work in parallel. A build belongs to shard `int(hash, 16) % n`. Each machine uploads its builds.
- Variance builds (seed 43) are more builds in the same store. Ours needs an explicit `index` path in the job for a seed other than 42.
- `librescore5.so` lives next to `rivals5` in `$ROOT/build`. `run.py` passes it to `py5.py` as `LIBRESCORE5`.

## GPU embedding

`runpod_embed.sh` runs `embed.py --check` in the pod, then `embed_all.sh <DATA> cuda` for all 7 sets and 3 models.
