# Slate C — ideation, lens "real-user-product"

**Task:** find what costs a real sweet-search user money or solves that the luna benchmark
cannot see. **Date:** 2026-09-02. **Spend:** `$0`. No rollout was launched, no product or
bench code was edited, nothing was written under the evidence box's `results/`. Box scratch:
`/tmp/wf-slatec/real-user-product/`. Local scratch:
`/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f/scratchpad/`.

Tags on every number: `[M]` measured here with the named script or command · `[C]` read from
shipped code or a deployed binary · `[W]` web source with a URL · `[I]` inferred arithmetic.

---

## 0. Verdict

**The benchmark measures a contact surface the product does not install.** The published npm
package declares two executables, `sweet-search` and `sweet-search-mcp`. It ships the six
`ss-*` wrappers as ordinary files with **no `bin` entry and no `init` step that puts them on a
`PATH`** `[C]`. The bench supplies the missing `PATH` itself, in
`agent-runner-shared.mjs:134-142` `[C]`. So every number in the brief describes a session a
default `npm install -g sweet-search && sweet-search init` cannot produce. Three smaller
real-user gaps sit behind it, all invisible for the same reason — the harness supplies what
the product does not: the bench pins `SWEET_SEARCH_PROJECT_ROOT`, so it never sees that `ss-*`
exit 2 inside a git worktree; the bench runs `--permission-mode bypassPermissions`, so it
never sees a permission prompt; the bench marks all 1,158 run directories trusted `[M]`, so it
never sees codex 0.150.0 withhold a project `AGENTS.md`.

Two further findings correct sibling reports. First, claude-code's built-in `Explore`
subagent — **86.4% of all delegations in the fresh pool, 38 of 44** `[M]` — **does have
Bash and did call `ss-*`** (11 sweet subagent transcripts, 14 to 61 Bash calls each) `[M]`.
The documentation's "Read, Grep, Glob" is a simplification; the binary defines `Explore` with
a `disallowedTools` deny list and no positive allowlist `[C]`. The real gap is
`omitClaudeMd: true` — the guide reaches 0 of 38 `Explore` subagents. Second, the
claude-code tool-result **persistence** path fails its own pre-registered screen: 2 of 66
sweet rollouts, against a kill line of 3 `[M]`.

The read-before-edit gate is retired for current Anthropic models and alive for ten legacy
ids. The Anthropic cache-write surcharge, which the bench price vector does not contain, is
the larger real-user money fact.

---

## 1. What the product actually installs, and what the bench adds

### 1.1 The six `ss-*` commands are not on a real user's `PATH`

`[C]` `package.json` at v2.7.2:

```
bin          = { "sweet-search": "core/cli.js", "sweet-search-mcp": "mcp/server.js" }
directories  = undefined
files        includes eval/agent-read-workflows/bin/{ss-search,ss-find,ss-grep,ss-semantic,
             ss-trace,ss-read,_ss-helpers.mjs,_ss-argparse.mjs,_ss-env.sh}
```

npm creates command shims only from `bin` (or `directories.bin`). Neither names an `ss-*`
wrapper. `[M]` `grep -n "PATH" scripts/init.js` returns **zero lines**. The only `symlinkSync`
in the init path is `scripts/inject-agent-instructions.js:237`, which points `GEMINI.md` at
`AGENTS.md` `[C]`. `[M]` The README quickstart (lines 97-146) and the "Works With Your Agent"
section (lines 876-900) never mention a `PATH` step.

Meanwhile the shipped guide, written verbatim into `.claude/rules/sweet-search.md` by
`scripts/write-claude-rules.js` `[C]`, says: *"## Tools (search commands, invoked via Bash)"*
and then lists `ss-search "<query>" [-k N]`, `ss-grep "<regex>" [-k N]`, `ss-read <file>
[start] [end]` as bare command names `[C]`.

The bench closes the gap itself:

```js
// eval/task-completion-bench/harness/agent-runner-shared.mjs:134-142   [C]
// PATH = [binDir, ss-* (sweet only), ...host]; + SWEET_SEARCH_PROJECT_ROOT + DOCKER_HOST.
const pathDirs = [binDir, sweet ? ssBinDir : null].filter(Boolean);
PATH: [...pathDirs, process.env.PATH].join(':'),
SWEET_SEARCH_PROJECT_ROOT: rundir,
```

`ss-batch` is not in the `files` list at all, which matches register **A2** (deployed, called
0 times) `[C]`.

### 1.2 Default `init` writes claude-code files only

`[C]` `scripts/init.js:245-253`:

```js
export function resolveActiveHarnesses({ optInHarnesses, noClaude = false } = {}) {
  const active = new Set();
  if (!noClaude) active.add('claude-code');
  for (const h of optIn) active.add(h);        // {agents, gemini, cursor} are OPT-IN
  return ALL_HARNESSES.filter(h => active.has(h));
}
```

So a default install gives a codex or opencode user **no guide and no tools**. `AGENTS.md`
needs `--agents` or `--codex`. The README states this in the flags block; the quickstart does
not.

### 1.3 The routing override ships through a different vehicle than the bench uses

`[C]` The product installs the override as a Claude Code **output style**
(`.claude/output-styles/sweet-search.md`, selected in `.claude/settings.json`;
`scripts/install-claude-system-prompt.js`). The bench passes the identical string through
`--append-system-prompt` (`claude-code-task-runner.mjs:52-58`) `[C]`. Both land in the system
prompt on the main thread, so the main-thread measurement transfers.

It does not transfer to subagents. `[W]` <https://code.claude.com/docs/en/sub-agents> states
that **output style and auto memory never reach a subagent**. So on the real-user path no
subagent of any type receives the routing override — not even the `general-purpose` subagents
that do receive the rules file.

### 1.4 `ss-*` exit 2 inside a git worktree

`[C]` `eval/agent-read-workflows/bin/_ss-helpers.mjs:139-146`:

```js
const PROJECT_ROOT = process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
if (!existsSync(path.join(PROJECT_ROOT, '.sweet-search', 'codebase.db'))) {
  process.stderr.write(`[ss-*] no Sweet Search index at ${PROJECT_ROOT}/.sweet-search/codebase.db\n` + ...);
  process.exit(2);
}
```

A git worktree has its own working directory and no `.sweet-search/`. Claude Code spawns
subagents into `<repo>/.claude/worktrees/agent-<id>` — **44 of 44 subagent launches in the
fresh pool carried `isolation: 'worktree'`** `[M, claude-subagents.md F4]`. The bench never
saw the failure because the runner pins `SWEET_SEARCH_PROJECT_ROOT` to the parent checkout
`[C]`. Humans hit the same path whenever they run an agent inside `git worktree add`.

### 1.5 Permissions: the bench bypasses them, the product writes none

`[C]` `claude-code-task-runner.mjs:95` passes `--permission-mode bypassPermissions`.
`[C]` `scripts/install-tool-enforcement.js` writes `permissions.deny: ["Grep"]` — and only
under the opt-in `--enforce-tools` flag. **`init` never writes a `permissions.allow` entry for
any `ss-*` command.**

`[M]` Shape of the traffic a real user would have to approve, over 71 sweet claude-code
transcripts of `fp-claudecode-tab-20260826` (script
`/tmp/wf-slatec/real-user-product/perm.py`):

| quantity | value |
|---|---|
| Bash envelopes per rollout | mean 16.04, median 14, total 1,139 |
| envelopes containing `&&`, `;` or `\|` | 354 = **31.1%** |
| distinct `ss-*` command names per rollout | mean 3.46, median 3, max 6 |

A user who answers "don't ask again" builds prefix rules such as `Bash(ss-search:*)`. Those
rules are written once per project, so the friction is a first-session cost of roughly three
to six dialogs, not a per-call tax. `[I]` A compound envelope needs every part allowed, so a
prefix allowlist built from single commands does not obviously cover the 31.1% that chain;
I did not verify Claude Code's compound-command analyser, so treat that half as unproven.

`[W]` One cache fact makes the fix safe: a **bare tool-name deny rule** (`Bash`) removes the
tool from the system prompt and invalidates the whole cache, while scoped `allow` rules do not
(<https://code.claude.com/docs/en/prompt-caching>, fetched 2026-09-02).

### 1.6 Codex withholds the guide in an untrusted project

`[W]` Codex 0.150.0 (2026-08-26), PR #39837: *"Untrusted projects no longer supply
project-level `AGENTS.md` instructions."* `[M]` The evidence box's `/root/.codex/config.toml`
carries **1,158** `trust_level = "trusted"` entries — one per run directory. So the bench can
never observe this. A real codex user opening a repository for the first time gets `ss-*` with
no guide.

`[M, claude-subagents.md F3]` The closest measurement of guide-less behaviour: 8 `Explore`
subagents made 215 `ss-*` calls, 200 of them by absolute path, plus 13 discovery calls
(`command -v`, `find -name 'ss-*'`) and 12 rejected `--help` calls, and failed **14.0%** of
`ss-*` calls against 4.8% in the guided main thread and 5.9% in guided `general-purpose`
subagents.

---

## 2. Corrections to sibling Slate C reports

| # | report | statement | correction | evidence |
|---|---|---|---|---|
| 1 | `research/anthropic-model-product-path.md` §5.2, candidate C-A4 | "Explore has no Bash — sweet is structurally unreachable in the main delegation path" | **Wrong for the deployed builds.** 2.1.258 defines `Explore` as `{agentType:"Explore", disallowedTools:[yt,...Iie,r_,zt,jn,fc], omitClaudeMd:!0}` with **no positive `tools` allowlist**; `Plan` copies `tools: O0.tools`, which is `undefined`. In the bench, 11 sweet subagent transcripts made 14-61 Bash calls and 25-95 `ss-*` calls each. The gap is `omitClaudeMd`, not the tool list. | `[C]` local binary 2.1.258 offset ~162228062; `[M]` `/tmp/wf-slatec/real-user-product/` grep of `fp-claudecode-tab-20260826/agent-state/*-sweet/**/subagents/agent-*.jsonl` |
| 2 | same, candidate C-A2 | "keep every `ss-*` result under claude-code's persistence threshold"; kill if fewer than 3 of 66 sweet rollouts show `<persisted-output>` or a truncation marker | **The candidate fails its own kill line.** 7 persistence events across 132 rollouts: native 5 (4 rollouts), sweet **2** (2 rollouts). Truncation markers: native 6, sweet 0. Both sweet events are large-span reads of one index-excluded bundle and one chained envelope. Native hits the path more often than sweet. | `[M]` `/tmp/wf-slatec/real-user-product/cc2.py` |
| 3 | same, candidate C-A4 falsifier | "kill if fewer than half [of native's subagents] are `Explore` or `Plan`" | **Passes decisively.** `Explore` 38 of 44 launches (86.4%); native 30 of 33, sweet 8 of 11. `general-purpose` 6. | `[M]` `/tmp/wf-slatec/real-user-product/cc.py` |
| 4 | `research/harness-changelogs.md` F1, `research/structured-vs-shell-parallelism.md` seed 1 | an MCP or plugin structured surface delivers `ss-*` | **The shipped MCP surface cannot carry a quarter to a third of sweet's traffic.** `mcp/server.js` registers 8 tools — `search`, `trace`, `index`, `health`, `repo-map`, `vocab-prewarm`, `read`, `read-semantic` — and **no `grep` and no `find`**. `ss-grep` plus `ss-find` are 25.4% of codex, 29.2% of opencode and 38.0% of claude-code `ss-*` operations. | `[C]` `mcp/server.js:170-341`; `[M]` `/tmp/wf-slatec/real-user-product/census.py` |

### 2.1 The `ss-*` verb census

`[M]` Over the three fresh-pool sweet arms (`fp-codex-tab-20260826`,
`fp-opencode-tab-20260826` + `rp-oc-tab-20260827`, `fp-claudecode-tab-20260826`), counting
verb occurrences inside recorded command strings, so an `&&` chain counts each operation:

| verb | calls | share | MCP equivalent |
|---|---:|---:|---|
| `ss-read` | 1,687 | 51.5% | `read` |
| `ss-grep` | 860 | 26.3% | **none** |
| `ss-search` | 467 | 14.3% | `search` |
| `ss-find` | 154 | 4.7% | **none** |
| `ss-semantic` | 65 | 2.0% | `read-semantic` |
| `ss-trace` | 40 | 1.2% | `trace` |
| **total** | **3,273** | | |

Per harness, the share with no MCP equivalent: **codex 25.4%** (246 of 970), **opencode 29.2%**
(357 of 1,222), **claude-code 38.0%** (411 of 1,081).

`[M]` The MCP guide variant is also larger: `sweet-search-system-prompt-mcp.md` is 1,257 words
and 7,993 bytes against the CLI champion's 1,016 words and 6,433 bytes (+23.7% words).

---

## 3. The two money facts the benchmark price vector cannot carry

### 3.1 Read-before-edit: retired for current models, alive for ten legacy ids

`[C, anthropic-model-product-path.md §1; claude-main-thread.md F5]` Claude Code enforces
"File has not been read yet" only for `claude-opus-4-6`, `claude-haiku-4-5`,
`claude-opus-4-5/4-1/4-0`, `claude-sonnet-4-5/4-0`, `claude-3-7-sonnet`, `claude-3-5-sonnet`,
`claude-3-5-haiku`. The set is byte-identical in 2.1.218 (the build that ran every
`fp-claudecode-*` cell) and in 2.1.247 through 2.1.258. Opus 5, Opus 4.8, Opus 4.7, Sonnet 5,
Sonnet 4.6 and the Fable family are absent.

`[M, claude-main-thread.md F6]` Where it does bind, sweet would pay one failed `Edit` plus one
`Read` for **68 files in 56 of 66 rollouts** = **+$0.00127 to +$0.00153 per rollout** = **7.8%
to 9.4%** of the sweet main-only claude-code arm. Native pays nothing (92 of 92 first edits had
a prior `Read`).

`[C, anthropic-model-product-path.md §2]` **Nothing sweet can ship makes `ss-read` count as a
`Read`.** All 14 writers of `readFileState` were enumerated: the native readers, a successful
write, memory-file seeding, an internal `sed` path, the artifact tool, and the Agent-SDK
control message `seed_read_state`. No hook output field and no settings key touches it. The
SDK route is unavailable to a person running the `claude` CLI.

Register **H1** / draft **D6** said *"Real Claude users of sweet-search would pay one failed
Edit plus one native Read per edited file."* That is now measured and **half wrong**: legacy
models pay it, current models do not. H1's revival condition (a `$0` price plus a static
check) is met, and the correct disposition is a documentation line plus a model-conditional
note, not a lever.

### 3.2 Anthropic bills cache **writes**; the bench vector has no write term

`[W, anthropic-model-product-path.md §4.1]` Anthropic charges 1.25x the input rate for a
5-minute cache entry and 2x for a 1-hour entry; reads are 0.1x, or 0.025x on Fable 5.1. `[C]`
The registered luna vector is `$0.10 / $0.01 / $0.60` with no write term at all; only the
claude-code accounting module supplies a 1.25x write field, which is register **G17**
(UNMEASURED) and open threads 14 and 15.

`[I, anthropic §4.4, on measured fresh-pool shares]` Repricing the same token counts:

| price vector | sweet main-only | native main-only | sweet − native |
|---|---:|---:|---:|
| luna, as registered | $0.017411 | $0.017031 | **+2.2%** |
| Opus 5, 5-minute TTL | $0.896444 | $0.866810 | **+3.4%** |
| Opus 5, 1-hour TTL | $1.067440 | $1.020410 | **+4.6%** |
| Fable 5.1, 5-minute TTL | $1.108888 | $1.086880 | **+2.0%** |

Mechanism in one sentence: sweet ingests about 11.3% more tokens than native on claude-code
and re-sends each of them 5.0% fewer times, the two cancel under luna, and Anthropic reprices
ingest upward while leaving the read rate alone.

`[C/W, anthropic §4.2, §4.6]` A Claude subscription puts the **main conversation** on the
1-hour TTL and **subagents** on 5 minutes — a 1.60x write-price ratio that penalises the arm
which delegates less. Sweet delegated in 6 of 22 claude-code task-cells, native in 15
`[M, doc 06 §5.4]`. `[I]` The 1-hour TTL costs 19.1% more than the 5-minute one for an agent
loop whose turns are seconds apart; the surcharge is 16.0% of that larger bill.

---

## 4. Candidates

Every candidate names its mechanism, harnesses, vehicle, evidence, ceiling arithmetic, the
cheapest `$0` falsifier with a pre-registered kill number, build cost, register check, and
both decision flags.

---

### RU-1 — Make the shipped contact surface reachable: `bin` entries for `ss-*`, and an `init`-written permission allowlist

**Family:** packaging and contact surface. **Harnesses:** codex, opencode, claude-code.

**Mechanism.** Two edits in two files. (a) `package.json`: add six `bin` entries mapping
`ss-search`, `ss-grep`, `ss-find`, `ss-read`, `ss-semantic`, `ss-trace` to the shipped
wrappers, so a global or project install creates the shims the guide already names. (b)
`scripts/init.js`: write scoped `permissions.allow` entries for those six commands into the
`.claude/settings.json` that `init` already owns, and add the equivalent codex and opencode
entries when those harnesses are selected. A third, smaller edit: make the default `init`
report say plainly which harnesses were wired, because `AGENTS.md` is opt-in.

**Why native cannot match it.** Not applicable — this is a sweet-only defect, not a lever
against native. Native uses the harness's built-in tools, which are always present.

**Evidence.** `[C]` `package.json` v2.7.2 `bin` has two entries and `directories` is
undefined; the six wrappers appear only in `files`. `[M]` `grep -n "PATH" scripts/init.js`
returns zero lines; the sole `symlinkSync` is `inject-agent-instructions.js:237`
(`GEMINI.md` → `AGENTS.md`). `[C]` The guide names bare `ss-*` commands
(`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`, "Tools (search
commands, invoked via Bash)"). `[C]` The bench supplies the missing `PATH` in
`agent-runner-shared.mjs:134-142`. `[C]` `scripts/init.js:245-253` makes `agents` opt-in.
`[C]` `scripts/install-tool-enforcement.js` writes only a `deny`, only under `--enforce-tools`.
`[M]` Permission-surface shape: 16.04 Bash envelopes per rollout, 31.1% compound, median 3
distinct `ss-*` names (`/tmp/wf-slatec/real-user-product/perm.py`, 71 sweet transcripts).
`[M, claude-subagents.md F3]` Guide-less and discovery-less behaviour costs 13 discovery calls
and a 14.0% `ss-*` failure rate against 4.8%.

**Ceiling.** This is not a percentage lever; it is the precondition for every percentage in
the brief. `[M, doc 06 §8]` A user who installs today pays the guide — $0.00042 on codex
(3.4%), $0.00041 on opencode (4.4%), $0.00051 on claude-code (3.1%) per rollout — plus the
output-style override, and receives native retrieval. So sweet-minus-native for a default
install is **at best +3.1% to +4.4% and never negative**, before the agent wastes any request
hunting for a command that does not exist. `[I]` Three failed discovery requests on
claude-code at $0.00070 per request is a further $0.0021 = 10.1% of the $0.020727 sweet cell.
Solves: the fresh pool's 120 of 198 sweet solves assume the tools run; with no tools the sweet
arm degenerates to native's 125 of 198 minus a confused opening.

**`$0` falsifier.** `npm pack --dry-run --json` in the repository, then install the tarball
into a scratch prefix and run `command -v ss-grep` and `command -v ss-search`. No model, no
network beyond the local tarball.

**Kill condition.** If `command -v ss-grep` resolves after a clean
`npm install -g <tarball>`, the finding is void and this candidate is withdrawn entirely.
Secondary kill for part (b): if a fresh `sweet-search init` already writes any
`permissions.allow` entry naming an `ss-*` command, drop (b).

**Build cost.** Hours. Six `bin` keys; about twenty lines in `init.js` for the allowlist;
one report line.

**Register check.** Nothing on the register covers reachability. §0.2 inventories which tools
exist; **E2** shipped wrapper *behaviour* fixes (regex crash, positional path, ENOENT hint,
"not indexed", banner) and never asked whether the wrappers are callable. **B17** is the
opposite direction (removing harness tool schemas). **A2** notes `ss-batch` is deployed and
called zero times; this explains a harsher version of the same class.

**`new_tool`:** false — the six executables already exist and already ship; only the `bin`
mapping is missing. **`needs_user_decision`:** yes — six new global command names is a
namespace decision, and the owner may intend MCP (`init --mcp --no-cli`) as the real contact
surface, in which case the CLI guide should stop being the default.

**Solve risk.** None from the fix. The risk is the present state.

---

### RU-2 — Put the guide inside claude-code's delegation path with a project agent definition

**Family:** harness adaptation, claude-code only. **Harnesses:** claude-code.

**Mechanism.** `init` writes a project agent file under `.claude/agents/`. Two shapes, and
the owner must pick one. Shape A overrides the built-in name (`.claude/agents/Explore.md`), so
every existing delegation inherits the sweet guide with no change to the main thread's
behaviour; project agents beat built-ins by location priority, and a user-authored agent
**always** inherits the CLAUDE.md hierarchy because `omitClaudeMd` is not a field of the
user-facing frontmatter schema `[C, anthropic §5.1]`. Shape B adds a differently-named
`sweet-explore` agent, which is safer but only helps if the model chooses it. Frontmatter in
either shape: `tools: Bash, Read, Grep, Glob`, `model: inherit`, the guide as the `prompt`,
and no `isolation`.

**Why native cannot match it.** Native has nothing to deliver; its tools are the harness's own
and are present in every subagent by construction. The asymmetry is that sweet's tools need an
instruction the built-in `Explore` deliberately drops.

**Evidence.** `[M]` `Explore` is 38 of 44 subagent launches, 86.4% (native 30 of 33, sweet 8
of 11) — `/tmp/wf-slatec/real-user-product/cc.py` over
`fp-claudecode-tab-20260826/agent-state/*/claude-home/projects/*/*.jsonl`. `[C]` 2.1.258
defines `Explore` with `omitClaudeMd:!0` and a `disallowedTools` deny list, not a positive
allowlist. `[M]` Sweet subagents did run Bash and `ss-*`: 11 transcripts, Bash 14-61 calls and
`ss-*` 25-95 calls each, for example
`bfgroup__b2-259-sweet/agent-a8d5f1d037a62e83b.jsonl` (Bash 57, `ss-*` 90) and
`asynkron__protoactor-dotnet-1909-sweet/agent-a3d311866bfc0b7cb.jsonl` (Bash 25, `ss-*` 25).
`[M, claude-subagents.md F2]` The guide adds +1,570 tokens to the main thread and +1,516 to a
`general-purpose` subagent's first request, and **0 tokens to an `Explore` subagent's**.
`[M, claude-subagents.md F3]` Guide-less `Explore` fails 14.0% of `ss-*` calls against 4.8%
in the main thread; the diluted spend is at most $0.0255 over the arm = **2.0% = $0.00039 per
rollout**. `[W]` Output style never reaches any subagent, so the routing override is absent
even from guided `general-purpose` subagents.

**Ceiling.** claude-code only; zero on codex and opencode, which spawned no subagent in 264
rollouts `[M, claude-subagents.md F9]`. Saving at full compliance: **−$0.00039 per rollout =
−1.9% of the $0.020727 sweet cell**, in requests roughly −0.5 requests per rollout (31 pre-first-`ss`
requests plus 15 failed-`ss` requests over 66 rollouts). Cost added: sweet launched 8 `Explore`
subagents over 66 rollouts = 0.12 per rollout, and a subagent's first request never reads the
parent's cache `[W, anthropic §5.4]`, so each launch re-ingests 1,516 tokens; `[I]`
0.12 × 1,516 × ($0.10 + 14 × $0.01)/1e6 = **+$0.0000437 per rollout**. Net **≈ −$0.00035 per
rollout, −1.7%**, a roughly nine-to-one return. On Anthropic pricing both sides scale together,
so the ratio holds. Solves: sweet's own delegations flipped 0 of 6 tasks `[M,
claude-subagents.md F8]`, so no solve gain is claimed.

**`$0` falsifier.** Already run and passed: the `Explore` share must be at least half of
subagent launches. It is 86.4%. The remaining `$0` check is a listing check — on a local
Claude Code, confirm with `/agents` that a project `.claude/agents/Explore.md` is the active
`Explore`. No model call.

**Kill condition.** Kill as a cost lever if the pooled dilution is under 1% of the arm; it is
2.0%, so it survives, but book it as hygiene rather than as a headline mover. Kill Shape A
outright if a project file cannot override the built-in name in the `/agents` listing.

**Build cost.** Days. One file written at `init`, one uninstall path, documentation.

**Register check.** **F15** (delegation for sweet on claude-code, DEAD) asked sweet to
delegate *more*; this asks that sweet's guide survive a delegation the harness already
performs, and changes no delegation rate. **E10** (ephemeral coprocessor, DEAD live at +79%)
*added* a delegation step; this changes the definition of an existing one. **B18** (richer
subagent-launch brief, DEAD) was killed because subagent spend was off-ledger at the time and
exposure was 3 of 34 cells; exposure here is 38 of 44 launches and the ledger now carries
sidechains (**G1b**). **B2**/**B3** concern the guide's length and presence in the main thread.

**`new_tool`:** false. **`needs_user_decision`:** yes — writing into a user's
`.claude/agents/`, and overriding a built-in agent name, is the same class of contact-surface
decision the owner already ruled on for MCP.

**Solve risk.** Real for Shape A. Replacing the built-in `Explore` prompt could make
exploration worse and cost solves; the guide is a search policy, not an exploration policy.
Mitigate by keeping Claude Code's own `Explore` prompt text and appending only the sweet
tool block, or by choosing Shape B.

---

### RU-3 — Resolve the project root from the git common directory so `ss-*` work inside a worktree

**Family:** wrapper correctness, real-user only. **Harnesses:** all three; observed on
claude-code.

**Mechanism.** In `eval/agent-read-workflows/bin/_ss-helpers.mjs`, when the current directory
has no `.sweet-search/codebase.db` and `git rev-parse --git-common-dir` resolves to another
checkout, use that checkout's index and print one header line naming the tree the index
reflects. If no index is found there either, refuse with a message naming the main checkout
instead of the current directory. Today the wrapper takes `process.env.SWEET_SEARCH_PROJECT_ROOT
|| process.cwd()` and exits 2.

**Why native cannot match it.** Not applicable — native's tools read the filesystem and are
worktree-agnostic. This is a defect that makes sweet strictly worse than native in a common
real-user configuration.

**Evidence.** `[C]` `_ss-helpers.mjs:139-146`, quoted in §1.4: `existsSync` guard then
`process.exit(2)`. `[C]` `agent-runner-shared.mjs:134-142` pins
`SWEET_SEARCH_PROJECT_ROOT = rundir`, which is why the bench never saw it. `[M,
claude-subagents.md F4]` 44 of 44 subagents ran under `<rundir>/.claude/worktrees/agent-<id>`
with `isolation: 'worktree'`. `[M, claude-subagents.md F4]` The pin also produced a two-views
hazard inside the bench: 6 of 22 `ss-*` results in two subagents echoed the parent's
uncommitted edits while `Read` saw the clean tree
(`awslabs__aws-embedded-metrics-node-21-sweet` `agent-a0d415047c0776a3e`, 2 of 9;
`fastify__fastify-cors-285-sweet` `agent-a61852622b2fb2c36`, 4 of 13). `[M,
native-capability-gaps.md F3]` 45 of 45 worktree-scoped `ss-grep`/`ss-find` calls returned
zero, after which those subagents fell back to 87 native `Read`, 13 `grep -RInE` and 27 `find`
calls worth up to 8.7% of the claude-code sweet cost per rollout.

**Ceiling.** Inside the benchmark: zero dollars and zero solves, because the pin hid the
failure. For a real user: every `ss-*` call inside a worktree fails, so the ceiling is the
whole retrieval budget of that session — on claude-code 16.04 Bash envelopes per rollout at
$0.00070 per request `[M]`. Stated conservatively, this is correctness, not a benchmark
number.

**`$0` falsifier.** Local and instant, with no model and no daemon: `git worktree add /tmp/wt`
in an indexed repository, then run `ss-grep foo` from `/tmp/wt` and observe exit code 2 and
the `[ss-*] no Sweet Search index at /tmp/wt/.sweet-search/codebase.db` message. The guard
runs before any search, so no daemon starts. I did not execute it, to honour the standing
instruction not to run `ss-*` while developing sweet-search; the static read is conclusive.

**Kill condition.** Kill if the wrapper already resolves a worktree — that is, if `ss-grep`
run from a fresh worktree returns results instead of exit 2.

**Build cost.** Hours. One `git rev-parse --git-common-dir` probe, one fallback branch, one
header line, one test.

**Register check.** **E2** (wrapper hygiene, SHIPPED) lists six items: regex crash, positional
path as `--in`, ENOENT hint, empty body, "not indexed", banner leak. None concerns the current
directory or worktrees. **E3** (`ss-grep` working-tree freshness) is the opposite failure —
an index that is stale, not absent. `.claude/` is on the index allowlist
(`core/infrastructure/config/search.js:379` `[C, native-capability-gaps.md F3]`), so E2's
shipped "not indexed" hint does not fire here.

**`new_tool`:** false. **`needs_user_decision`:** no.

**Solve risk.** Low, and one design choice matters: reading the parent checkout's index from a
worktree shows the parent's uncommitted edits, which is wrong for the worktree. The header
line naming the tree the index reflects is therefore mandatory, not decoration.

---

### RU-4 — The MCP structured-tool surface, re-scoped by five facts that changed since 2026-07-31

**Family:** contact surface and turn economy. **Harnesses:** opencode and claude-code have a
prize; codex has none.

**Mechanism.** Expose the `ss-*` capabilities as first-class structured tools through the
already-shipped `sweet-search-mcp` server, and ship the MCP guide variant, so the model can
emit several retrieval calls in one assistant message the way it already does with the
harness's own `read`/`grep`/`glob`. `init --mcp --no-cli` already writes `.mcp.json` and swaps
the guide `[C, scripts/init.js:2014-2040]`. Two schema additions are required before this can
even be tried: an exact-literal `grep` tool and a regex-plus-query `find` tool, which the
present 8-tool surface does not have.

**Why native cannot match it.** It cannot on codex, and this is the load-bearing new fact:
`[M, structured-vs-shell-parallelism.md SP-1]` codex 0.146.1 emitted **exactly 1.000 tool calls
per request in both arms** (2,406 calls, 2,406 requests, zero multi-call requests), so there is
nothing to match and nothing to win. On opencode and claude-code native *can* match it, because
its own structured tools already batch; the differential there comes from sweet reaching the
same emission rate, not from exceeding it.

**Evidence that changed since the 2026-07-31 owner exclusion.** Five items.
1. `[M, SP-1]` Codex's packing gap is zero in both arms, so A4's stated motivation is
   opencode-specific, not general.
2. `[M, SP-4]` On claude-code the tool identity is not the causal variable: the same Bash tool
   swings from 3.5% to 41.3% parallel-companion rate between the sweet main thread and sweet
   subagents.
3. `[W, anthropic §4.7]` On claude-code, **deferred** MCP tools — the default on supported
   models — do not invalidate the conversation cache. A4's "a new tool schema changes the
   cached prefix" objection is weakened on that harness.
4. `[W, harness-changelogs.md F9]` Codex 0.152.0 adds a per-MCP-tool `output_token_limit`, the
   only route to a sweet-owned output budget that is not a shared harness setting (register
   **C8** rejected raising the shared cap).
5. `[C, anthropic §3.5]` A claude-code MCP result truncates at 25,000 tokens with a message,
   instead of being deleted and replaced by a file path as an oversized Bash result is.

**Evidence against, new and decisive.** `[C]` `mcp/server.js:170-341` registers 8 tools:
`search`, `trace`, `index`, `health`, `repo-map`, `vocab-prewarm`, `read`, `read-semantic`.
There is **no `grep` and no `find`**. `[M]` Those two verbs are 25.4% of codex, 29.2% of
opencode and 38.0% of claude-code `ss-*` operations (860 + 154 of 3,273 total). `[M]` The MCP
guide is 23.7% longer in words than the CLI champion. `[W, SP-7]` Anthropic's own MCP
efficiency features are disclaimed at this scale — Tool Search is "less beneficial when …
small tool library (<10 tools) … tool definitions are compact", and Programmatic Tool Calling
is a weak fit for "strictly sequential workflows where each call depends on Claude reasoning
over the previous result", which is search → read → edit.

**Ceiling.** `[M/I, SP-5]` If `ss-*` packed at native's own retrieval density:
opencode −3.43 requests per rollout = 18.1% of its requests = **−$0.00093 to −$0.00117 =
−10.1% to −12.7%** of the $0.009265 sweet cell, enough to move opencode from +3.3% to about
−7%; claude-code main thread −2.82 requests = **−$0.00133 to −$0.00188 = −6.4% to −9.1%** of
the $0.020727 cell; **codex $0.00 and 0.00 requests**. Subtract the MCP guide's extra ~310
tokens and 8 to 10 tool schemas from the cached prefix, and the honest net is roughly −7% on
opencode, −4% on claude-code, and zero or negative on codex. Solves: unknown, and the surface
gap below is a downside risk, not an upside.

**`$0` falsifier.** Three parts, all offline. (i) The verb census above — **already run**. (ii)
A replay: for every recorded `ss-grep` and `ss-find` call in the three fresh-pool sweet arms,
decide whether `search` plus `read` on the same index could return the same `file:line` set.
(iii) The chain-rework census that register A4 names as its own second gate, which no document
has ever run.

**Kill condition.** Kill if part (ii) shows that more than 20% of the 1,014 `ss-grep` and
`ss-find` calls cannot be answered by `search` plus `read` — because then MCP is a retrieval
capability cut, and solve is the veto. Kill the codex branch permanently if a post-0.146.1
codex run still shows 1.000 calls per request in both arms.

**Build cost.** Large. Two new tool schemas, an MCP variant of the guide re-optimised for the
new surface, and a paid A/B that A4 has never had. Weeks.

**Register check.** This **is** register **A4** (OWNER-EXCLUDED, UNBENCHMARKED, revival
condition "user decision **and** the W0.c census"). It is not new. What is new is a per-harness
ceiling, a per-harness *floor* of zero on codex, and a measured surface gap of 25 to 38% that
nobody had counted. **A1**/**A2** are the prompt-steered and CLI-batching routes, both DEAD;
this asks nothing of the model. **A3** is server-side fusion, CLOSED. **E9**'s killing fact
explicitly leaves a runtime-signal route open, which the opencode plugin route in
`research/harness-changelogs.md` F1 occupies more cheaply than MCP.

**`new_tool`:** **true** — `grep` and `find` schemas do not exist on the MCP surface, and the
surface itself is a second contact surface. **`needs_user_decision`:** **yes** — it reopens the
2026-07-31 MCP exclusion and touches the 2026-08-14 no-new-tools rule.

**Solve risk.** High and measured. Today's `init --mcp --no-cli` deletes the guide's own
cheapest route — "an exact token → ONE `ss-grep`" — for a quarter to a third of sweet's
operations. Any MCP pilot must add the two schemas first, or it measures a crippled arm.

---

### RU-5 — Price both arms on an Anthropic vector before any claude-code claim reaches a user

**Family:** measurement, with one product rider. **Harnesses:** claude-code, and any harness a
user points at an Anthropic model.

**Mechanism.** Add a shared analyzer column to
`eval/task-completion-bench/harness/ideal-cost.mjs`, in the same spirit as
`breakPricedCostUsd` (register **G2**). It rebuilds per-request usage from the raw claude
transcripts, splits main-thread from sidechain, and prices cache writes at 2.00x input on the
main thread and 1.25x on subagents, reads at 0.10x, and output at 5.00x. The product rider:
`init` already writes `.claude/settings.json`, so it can also write `promptCacheTtl: "5m"` for
users on a subscription, where the 1-hour default doubles the write price for turns that are
seconds apart.

**Why native cannot match it — or rather, it can.** This is not a differential lever. It is
arm-symmetric. Its value is that it decides whether the programme's only claude-code "win"
exists on the path a real user takes.

**Evidence.** `[W, anthropic §4.1]` Anthropic's write surcharge is 1.25x (5-minute) and 2x
(1-hour), reads 0.1x and 0.025x on Fable 5.1; the bundled `claude-api` model table and
<https://code.claude.com/docs/en/prompt-caching> agree. `[C]` The registered luna vector has no
write term. `[C/W, anthropic §4.2]` A Claude subscription puts the main conversation on 1 hour
and subagents on 5 minutes; precedence is `FORCE_PROMPT_CACHING_5M` →
`CLAUDE_CODE_PROMPT_CACHE_TTL` → the `promptCacheTtl` setting (v2.1.242+) → subagent
frontmatter (v2.1.248+) → `ENABLE_PROMPT_CACHING_1H` → the bucket default. `[M]`
`promptCacheTtl` occurs 0 times in 2.1.218, so no bench run could have used it. `[I, anthropic
§4.4]` The repricing table in §3.2 above. `[M, register G17]` Charging the existing 1.25x
uniformly already moves opencode +3.31% → +2.52% and codex +0.35% → +0.06%, and was never
recalculated for claude-code's own headline (open threads 14 and 15).

**Ceiling.** claude-code sweet-minus-native main-only moves **+2.2% → +3.4%** (5-minute TTL)
or **+4.6%** (1-hour TTL). The published inclusive claude-code figure of −3.9% is the only cell
in which sweet leads, and it is already a lower bound because 205 native delegated requests
carry no usage record (**G6**). `[I]` If the repricing survives a per-request replay, sweet
leads on **no harness** on the real-user path. The rider is worth **16.0%** of a real
subscription user's claude-code main-thread bill, with zero head-to-head differential.
Requests and solves: unchanged by construction.

**`$0` falsifier.** Rebuild per-request usage from
`fp-claudecode-tab-20260826/agent-state/*/claude-home/projects/*/*.jsonl`, taking the
usage-bearing record per `message.id` (brief §2.2 trap), separate `isSidechain` requests, apply
the write, read and output multipliers above, and recompute both arms.

**Kill condition.** Retire the concern if sweet-minus-native stays within **±1 percentage
point** of the luna figure on both TTLs. Kill the rider if a census of real session traces
shows most gaps between turns exceed five minutes, because then the 5-minute TTL costs a full
uncached re-ingest.

**Build cost.** Days for the column, hours for the rider. No new run. The green-ledger rule
applies: re-sweep after the harness change.

**Register check.** **G17** is exactly this, verdict UNMEASURED, with open threads 14 ("does
the provider actually bill cache writes at 1.25x — one web page, no bill read") and 15 ("never
recalculated for claude-code's own headline"). **G2** reprices the *suffix* after a cache
break; this reprices the *write* of every ingested token and adds a main-versus-subagent bucket
split the register has never modelled. **B6** ("cache engineering — NOTHING") was about hit
*rate*, which is 99.3-100%; this is about write *price*, which the bench vector omits. **B7**
(result diet) stays dead: the sensitivity of the bill to a byte cut moves only from 0.79X to
0.85X, so its 1.9% ceiling becomes about 2.0%.

**`new_tool`:** false. **`needs_user_decision`:** yes for the rider only — an interactive
human-in-the-loop session that idles past five minutes pays a full uncached re-ingest, so the
5-minute default is right for an agent loop and wrong for a person reading a diff.

**Solve risk.** None for the column. For the rider, none directly; the risk is a cost
regression for slow interactive users.

---

## 5. What I did not propose, and why

| idea | disposition |
|---|---|
| Keep `ss-*` output under claude-code's ~32-50 KB persistence threshold (`anthropic` C-A2) | **Killed at `$0` on its own pre-registered line.** 2 of 66 sweet rollouts, bar 3. Native hits the path more often (5 events, 4 rollouts). `[M]` |
| A claude-code Edit-protocol clause in the guide (`anthropic` C-A1) | Register **P1** kills general clauses (153 rollouts, every condition 3 of 8) and **A1** records luna's instruction-deafness. On current models the clause buys nothing and wastes a `Read`; on legacy models it converts an error turn into a planned read. It belongs in documentation, not the guide. |
| `promptCacheTtl: "5m"` as a standalone lever | Arm-universal; folded into RU-5 as a rider so it is not mistaken for a differential. |
| An opencode plugin that rewrites the built-in `read`/`grep`/`glob` output (`harness-changelogs` F1) | A better vehicle than MCP for the opencode prize, but it is the sibling report's candidate and not a real-user-product question; it changes the semantics of the harness's own tools silently. |
| More delegation for sweet on claude-code | Register **F15**, DEAD. RU-2 changes no delegation rate. |
| Making `ss-read` count as a native `Read` | Structurally impossible for a CLI user. All 14 `readFileState` writers enumerated; no hook field, no MCP path, no settings key `[C, anthropic §2]`. |

---

## 6. What I could not finish

1. **I did not execute the worktree reproduction.** The standing instruction is never to use
   `ss-*` while developing sweet-search. The static read (`existsSync` guard then
   `process.exit(2)`) is conclusive, but the observed exit code is not measured here.
2. **I did not run `npm pack`.** RU-1 rests on the `bin` and `directories` fields plus the
   absence of any `PATH` step, which is conclusive for how npm creates shims, but the
   end-to-end `command -v ss-grep` check is named as the falsifier and not run.
3. **Whether `Bash` is in `Explore`'s `disallowedTools` in 2.1.258.** The list is
   `[yt,...Iie,r_,zt,jn,fc]`, and those constants are imported across bundle chunks with
   colliding minified names. The bench measurement settles 2.1.218 empirically; the current
   build is unresolved, so RU-2's Shape A should re-check the tool list at build time.
4. **Claude Code's compound-command permission analyser.** The 31.1% chained-envelope figure is
   measured; the claim that a prefix `allow` rule fails to cover a chain is `[I]`, not read
   from the binary.
5. **The MCP replay falsifier (ii).** Deciding whether `search` plus `read` can answer each of
   the 1,014 `ss-grep`/`ss-find` calls needs the goldens and a rebuilt index on the box; it is
   `$0` but out of this task's time budget.
6. **Opencode and codex permission defaults for a real user.** I verified claude-code
   (`bypassPermissions`) and codex (1,158 trusted project entries) on the bench side only. What
   a default codex or opencode install prompts for is not measured.
7. **A token re-baseline for §3.2.** Every Anthropic dollar figure reprices `o200k_base` token
   counts; Opus 4.7 and later use a different tokenizer and no published ratio exists. The
   direction and magnitude are sound; the absolute dollars are not a forecast.

---

## 7. Scripts and paths

Local scratch (this machine):

- `…/scratchpad/probe_explore.py` — regex probe of
  `/Users/admin/.local/share/claude/versions/2.1.258` for `omitClaudeMd` and the built-in agent
  definitions.
- `…/scratchpad/census.py`, `cc.py`, `cc2.py`, `perm.py` — copied to the box and run there.

Evidence box (`root@167.233.69.121`, read-only results; scratch under
`/tmp/wf-slatec/real-user-product/`):

- `census.py` — `ss-*` verb census over
  `results/fp-codex-tab-20260826`, `results/fp-opencode-tab-20260826`,
  `results/rp-oc-tab-20260827`, `results/fp-claudecode-tab-20260826` sweet arms.
- `cc.py` — `subagent_type`, `<persisted-output>` and truncation-marker census over
  `results/fp-claudecode-tab-20260826`.
- `cc2.py` — attributes each `<persisted-output>` block to its originating tool call.
- `perm.py` — Bash envelope count, compound share and distinct `ss-*` command names per
  claude-code sweet rollout.

Product code read: `package.json`; `scripts/init.js` (lines 245-253, 960-1060, 2004-2170);
`scripts/inject-agent-instructions.js`; `scripts/write-claude-rules.js`;
`scripts/install-claude-system-prompt.js`; `scripts/install-tool-enforcement.js`;
`mcp/server.js` (lines 155-341); `eval/agent-read-workflows/bin/_ss-helpers.mjs` (lines
125-150); `eval/agent-read-workflows/bin/ss-grep`; `eval/agent-read-workflows/bin/_ss-env.sh`;
`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md` and its `-mcp.md`
variant; `eval/task-completion-bench/harness/agent-runner-shared.mjs` (lines 128-150);
`eval/task-completion-bench/harness/claude-code-task-runner.mjs` (lines 1-100);
`README.md` (lines 97-180, 420-445, 876-900).
