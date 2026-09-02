# c12 — adversarial verify, DIFFERENTIAL and MEASURABILITY lens

**Verdict: REFUTED as a slate lever. Confidence 0.87.** The packaging facts are all true. I
re-verified every one of them by direct measurement, and I also ran the candidate's own `$0`
falsifier end-to-end. The refutation is not about the facts. It is about three things the
candidate claims that do not hold. First, the claimed effect is zero on the bench by the
candidate's own admission, so no run at any price can measure it; a candidate whose effect is
structurally invisible to the only instrument this workflow owns is a product-defect record,
not a lever. Second, the `$0` falsifier cannot fail. I ran it: a clean global install of the
real 2.7.2 tarball creates two shims and `command -v ss-grep` returns nothing. A falsifier
whose kill condition is already determined verifies the premise, never the claim; the claim is
the ceiling, and the ceiling has no falsifier at any price. Third, `register_check: New` is
wrong. The gap is already recorded as an open item under the name "ss-* PATH gap", and
`core/cli.js` carries a comment describing the owner's earlier fix for the identical defect
class. That earlier fix added a **subcommand**, not a new global name. Two further findings
make the vehicle as written harmful rather than neutral: the six wrappers are documented
in-code as benchmark instrumentation and carry benchmark environment pins, and the capability
is already reachable today under `sweet-search <subcommand>`. The defect is a **name** defect,
not a **capability** defect. Keep the finding. Rewrite the ceiling, the falsifier, the register
row, and the vehicle.

---

## 1. What I measured myself

Every number in this section is `[M]` unless marked `[C]` (read from code). Commands are given
so the synthesis can re-run them.

### 1.1 The packaging facts are correct

| fact | value | how |
|---|---|---|
| package version | 2.7.2 | `node -e "require('./package.json')"` `[M]` |
| `bin` entries | exactly 2: `sweet-search` → `core/cli.js`, `sweet-search-mcp` → `mcp/server.js` | same `[M]` |
| `directories` field | absent (`null`) — so no `directories.bin` fallback | `tar -xzOf <tgz> package/package.json` `[M]` |
| wrappers in `files` | 6 wrappers + 3 helpers | `npm pack --dry-run --json` `[M]` |
| `ss-batch` in tarball | **absent** | same `[M]` |
| tarball | `sweet-search-2.7.2.tgz`, 1,981,758 bytes packed, 9,973,438 unpacked, 284 files | `npm pack` `[M]` |
| `PATH` handling in `scripts/init.js` | **0 lines** | `grep -c PATH scripts/init.js` `[M]` |
| `PATH` handling in the 4 installer scripts | **0 lines each** (`inject-agent-instructions.js`, `write-claude-rules.js`, `install-claude-system-prompt.js`, `install-mcp-server.js`) | `grep -c PATH <file>` `[M]` |
| `install-tool-enforcement.js` | writes `permissions.deny` only (lines 142–155); returns `skipped` when `--enforce-tools` is off (line 38) | `[C]` |
| `resolveActiveHarnesses` | defaults to `claude-code` only | `scripts/init.js:245` `[C]` |
| bench `PATH` prepend | sweet arm only | `agent-runner-shared.mjs:137–141` `[C]` (the candidate cites 134–142; the comment is at 133, the function at 137, the `PATH` line at 141) |
| bench permission mode | `--permission-mode bypassPermissions` | `claude-code-task-runner.mjs:95` `[C]` |

### 1.2 I ran the candidate's own falsifier. It does not fire.

```
npm pack --pack-destination $S
npm install -g --prefix $S/prefix --ignore-scripts --omit=optional $S/sweet-search-2.7.2.tgz
PATH=$S/prefix/bin:$PATH command -v ss-grep …
```

Result `[M]`:

- `prefix/bin` holds exactly two symlinks: `sweet-search` and `sweet-search-mcp`.
- `ss-grep`, `ss-search`, `ss-read`, `ss-find`, `ss-semantic`, `ss-trace`, `ss-batch` — all
  seven return `NOT-FOUND`.
- The six wrappers **are** installed and executable (mode 755) at
  `prefix/lib/node_modules/sweet-search/eval/agent-read-workflows/bin/`. They are present and
  unreachable at the same time.

So the defect is real. The kill condition (`withdraw if command -v ss-grep resolves`) is
determined false before the lever is written.

### 1.3 The capability is already reachable. Only the names are not.

The installed CLI's own help text, printed from the scratch prefix `[M]`:

```
sweet-search <query>                  Search the indexed codebase
sweet-search trace <symbol>           Structural context: callers, callees, impact
sweet-search read <file...>           Filesystem-grounded read (1-20 files)
sweet-search read-semantic <f> <q>    Return only file spans relevant to a query
sweet-search batch '<json>'           Run 2-3 typed read-only operations
sweet-search index [options]          Build / update the codebase index
```

Dispatch sites `[C]`: `read` `core/cli.js:31`, `read-semantic` `:46`, `trace` `:61`,
`batch` `:75`, `index` `:93`, default search in the `else` branch. The native binary adds the
two missing names: a `grep` subcommand at `crates/sweet-search-cli/src/main.rs:647–651`, and
`-e/--regex` pattern mode (the `ss-find` equivalent) at `:614` and `:688–694` `[C]`.

Every one of the six guide names therefore has a working production equivalent today. A user
who reads the README and types `sweet-search read foo.js 10 20` gets a result. A user who
types `ss-read foo.js 10 20` gets "command not found". That is the whole defect.

---

## 2. Refutation grounds

### 2.1 The effect is not detectable at any price, not merely below the noise floor

The lens asks whether the claimed effect clears the bench's noise: ±6 rollouts of 66 for
solves, about ±$0.001–0.005 per rollout for cost. This candidate does not sit near that floor.
It sits at exactly zero. The bench prepends `ssBinDir` to `PATH` for the sweet arm
(`agent-runner-shared.mjs:141` `[C]`), so the bench **already runs the fixed state**. Applying
the fix moves the bench by no tokens and no requests.

Read the other way, the fresh-pool table is already the measurement of a world where the fix
has shipped: +0.3% codex, +3.3% opencode, −3.9% claude-code (BRIEF §1). The candidate does not
add a number to that table. It explains why the table describes nobody's installation.

`DEDUP.md` already tiers c12 as "Tier 3 — real-user correctness, zero effect on the bench", so
the synthesis knows this. My objection is that the candidate JSON still carries a `ceiling`
field with percentages in it. A row with an unmeasurable ceiling and a percentage in the
ceiling field will be read as a lever.

### 2.2 The falsifier is a premise check, and its kill condition has no number

The lens asks three questions about the falsifier. Is it real? Yes — I ran it. Is it
pre-registrable? Yes. Does its kill condition have a number? **No.** It is a binary: a command
resolves or it does not. Part (b)'s condition is also binary: an allow entry exists or it does
not.

Worse, I have now determined both outcomes in advance (§1.2, and `grep -c PATH scripts/init.js`
= 0). Neither branch can fire. A test that cannot fail is not a falsifier of the candidate's
claim. It is a confirmation of the candidate's premise.

The claim that carries the numbers — "+3.1% to +4.4% paid for nothing, plus ~10.1% of the
claude-code cell in failed discovery" — has **no falsifier at all**, at `$0` or at any price,
because the bench cannot express the unfixed state. The only instrument that could price it is
a real-user telemetry study, which does not exist and is not `$0`.

### 2.3 `register_check: New` is false in two places

**First.** The gap is already recorded, open, in project memory. `project_ss_tools_native_vs_eval_dispatch.md`
(verified 2026-06-19/20) ends with: *"Open: the agent-facing `ss-*` shims live sessions invoke
weren't found in-repo (the 'ss-* PATH gap'); whether session ss-grep/ss-find hit native vs the
eval wrappers is unconfirmed."* `[C]` That is this candidate's finding, named, two and a half
months earlier.

**Second.** The owner has already fixed the same defect class once, and the fix was not a new
global name. `core/cli.js:96–100` `[C]`:

> *"Without this subcommand, npm-installed users had no way to invoke indexing —
> `node ./node_modules/sweet-search/core/indexing/index-codebase-v21.js` was a silent no-op
> (direct-run guard mismatched under symlinked installs) and the bin had no `index` entry at
> all."*

Same defect (ships in `files`, no way to call it), same population (npm-installed users), and
a recorded remedy: **one bin name plus a subcommand**. The candidate proposes six new bin
names without engaging that precedent. `needs_user_decision: yes` is correctly flagged, but the
decision is framed as "six global names vs MCP" when the record shows a third option the owner
already chose once.

### 2.4 The vehicle as specified ships benchmark instrumentation to real users

This is the finding I did not expect and it is the strongest one. The six wrappers are not a
product surface that was accidentally left off `bin`. They are documented in-code as benchmark
instrumentation, and they carry benchmark state.

`eval/agent-read-workflows/bin/_ss-env.sh` opens with `[C]`:

> *"COMMON BENCHMARK-HARNESS ENVIRONMENT. Sourced by EVERY executable in this directory,
> before it hands off to node."*

It exports four pins that every wrapper inherits `[C]`:

| pin | wrapper value | production value | consequence if shipped |
|---|---|---|---|
| `SWEET_SEARCH_INTRA_OP_THREADS` | 8 | fleet-derived share | a fixed 8-thread ORT pool on every host, chosen because "8 is inside the unshared band on **every bench box we use**" |
| `SWEET_SEARCH_MAX_DAEMONS` | 3 | RAM tier 2 / 3 / 6 | a hard 3-daemon cap regardless of the user's RAM |
| `SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS` | 120,000 (2 min) | 30 min | maintainers evicted 15× more often |
| `SS_QUIET_BOOT` | 1 | unset for human CLI | boot banners suppressed for humans too |

`_ss-helpers.mjs:992` writes a `<<SS_TRACE_META>>` JSON trailer to stdout `[C]` — bench
telemetry a real user would see on every `ss-trace`.

And `_ss-helpers.mjs:141–144` `[C]` prints, on a missing index, the instruction
`node <pkg>/core/indexing/index-codebase-v21.js --full --sqlite-fast`. That is exactly the
command `core/cli.js:98` documents as *"a silent no-op … under symlinked installs"*. A global
npm install is symlinked. So the first thing a real user hitting an unindexed repository would
be told to run is a documented no-op.

Finally, routing. `_ss-helpers.mjs:283–284` cold-constructs `new SweetSearch()` per call `[C]`.
Production routes through the native binary to a warm daemon. Measured 9-rep medians
(`project_ss_tools_native_vs_eval_dispatch.md`, 2026-06-19) `[M, that note]`:

| operation | production (native → warm daemon) | eval wrapper (cold node) |
|---|---:|---:|
| read | < 10 ms | 194 ms |
| read-semantic | ~80 ms | 8,443 ms |
| trace | ~280 ms | 364 ms |
| grep | 11 ms | — |

Publishing the wrappers as global bins would put every real user on the slower path, at up to
105× on `read-semantic`. The same note warns in plain words: *"A latency workflow that puts
SS_BIN on PATH measures THIS, not production."*

So the vehicle "add six bin entries pointing at the existing wrappers" is a product regression.
A correct vehicle would be six thin shims over `core/cli.js` subcommands, which is a different
and larger piece of work than "hours".

### 2.5 The ceiling arithmetic does not divide, and its second term is invented

**The guide term.** `DEDUP.md` c12 states "$0.00042/$0.00041/$0.00051 per rollout =
3.4%/4.4%/3.1%". Two of three divide. The claude one does not. Using BRIEF §1 sweet costs:

- codex: 0.00042 / 0.012330 = **3.41%** ✓
- opencode: 0.00041 / 0.009265 = **4.43%** ✓
- claude-code: 0.00051 / 0.020727 = **2.46%**, not 3.1% ✗

So the honest range is **+2.5% to +4.4%**, not "+3.1% to +4.4%". The candidate JSON carries the
wrong low end. The 3.1% figure appears to be borrowed from `agent-efficiency F5`, which uses a
different denominator; mixing the two produces a dollar figure and a percentage that contradict
each other in the same sentence.

Separately, this is not a new measurement. Register row B2 already records the guide constant
as "+1,457 tokens = 2.6–4.5% of sweet spend". The ceiling restates a registered constant.

(Minor: the shipped guide's own front matter says `token_count: 1307`
(`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`) `[C]`, while BRIEF and
DEDUP both say 1,457. Someone should reconcile that once; it is not load-bearing here.)

**The discovery term.** "Three failed discovery requests … $0.0021 = 10.1%" is tagged `[I]`.
The arithmetic is internally consistent (0.0021 / 0.020727 = 10.13%). The input is not. The two
measured anchors in the same evidence chain are **13 discovery calls across 8 guide-less
subagents** (1.6 per agent) and **5.8 discovery requests per guide-less agent**
(`DEDUP.md` lines 159 and 174, both `[M claude-subagents F3]`). "Three" matches neither, and no
derivation is given. Taking the higher measured anchor instead gives 5.8 × $0.00070 = $0.00406
= 19.6% of the claude cell — so the chosen figure is not conservative either. It is arbitrary.

### 2.6 The supporting failure rate is a pre-fix number

The candidate leans on "guide-less callers … fail 14.0%". `c08-history.md` §2.8 establishes
that this rate predates the shipped hygiene fix: the fresh pool ran 2026-08-26/27, and `36b802e`
landed 2026-08-28 16:41:50 +0200 `[M]`. That commit removes 9 to 16 of the 36 measured subagent
failures (25% to 44%), putting the post-fix rate at 7.9% to 10.5% `[I]`. BRIEF §2.2: *"Never
pool runs across a shipped fix."* The 14.0% figure must carry that caveat wherever it is
reused.

---

## 3. What survives, and what it is worth

The **defect** survives intact and is worth recording. Concretely:

1. The README documents `ss-search` and `ss-grep` as first-class user tools — README:428–429
   even calls `ss-search` *"the same binary you install"* `[C]` — and the shipped guide names
   bare `ss-*` under "Tools (search commands, invoked via Bash)" `[C]`. Neither name installs.
2. `ss-batch` is in neither `bin` nor `files`, so a real install never receives it at all
   `[M]`. Register §0.2 should record this; A2 records `ss-batch` as deployed and called zero
   times, which is a weaker version of the same fact.
3. A default `sweet-search init` activates `claude-code` only (`init.js:245` `[C]`), so codex
   and opencode users receive no guide unless they pass `--agents`.
4. No `permissions.allow` for `ss-*` is written anywhere in the repository `[M]`.

None of that is a lever. All of it belongs in a product-defect appendix with an explicit "not
measurable on this bench, at any price" stamp.

**Rule compliance, for the record.** The candidate violates no hard rule. It does not touch
HO2. It uses no gold or task identity at runtime. It adds no ranking signal, so the
`_isAgentFormat` gate does not apply. It correctly flags `needs_user_decision`. Its vehicle is
genuinely sweet-only, so it does not fall foul of the differential rule (§0.6) — it fails a
different test, which is that the bench already supplies the fix. It is not a banned
same-information compaction: in production it changes whether calls happen at all. My
refutation rests on measurability, falsifier quality, register accuracy, and vehicle
correctness — not on a rule breach.

---

## 4. Corrections the synthesis must adopt

1. **Reclassify.** Move c12 out of the candidate slate into a "product defects, zero bench
   differential" appendix. Delete the `ceiling` percentages or restate them as "not measurable
   on this bench at any price".
2. **Fix the ceiling range.** "+3.1% to +4.4%" → **"+2.5% to +4.4%"**. The claude term is
   $0.00051 / $0.020727 = 2.46%, not 3.1%. State the per-harness values: codex 3.41%, opencode
   4.43%, claude-code 2.46%.
3. **Fix the discovery term.** Replace the invented "three failed discovery requests" with a
   measured anchor: 13 discovery calls across 8 guide-less subagents (1.6 per agent), or 5.8
   discovery requests per guide-less agent. Say which, and label the resulting dollar figure
   `[I]` with its arithmetic shown.
4. **Caveat the 14.0%.** Add: pre-`36b802e`; post-fix estimate 7.9% to 10.5% `[I]` per
   `c08-history.md` §2.8.
5. **Correct `register_check`.** Replace "**New**" with: nearest recorded item is the open
   "ss-* PATH gap" in `project_ss_tools_native_vs_eval_dispatch.md` (2026-06-20); the owner's
   recorded remedy for the identical defect class is `core/cli.js:96–100`, which added a
   subcommand, not a bin name. Add the §0.2 correction that `ss-batch` is in neither `bin` nor
   `files`.
6. **Change the vehicle.** Do not add `bin` entries pointing at
   `eval/agent-read-workflows/bin/ss-*`. Those wrappers are benchmark instrumentation:
   `_ss-env.sh` pins `SWEET_SEARCH_INTRA_OP_THREADS=8`, `SWEET_SEARCH_MAX_DAEMONS=3` and a
   2-minute maintainer TTL; `_ss-helpers.mjs:992` emits a `<<SS_TRACE_META>>` trailer;
   `_ss-helpers.mjs:141–144` prints a remediation command that `core/cli.js:98` documents as a
   no-op under symlinked installs; and the wrappers bypass the warm daemon (read-semantic 8,443
   ms cold against ~80 ms warm). The correct vehicle is six thin shims over the existing
   `core/cli.js` / native subcommands. Raise `build_cost` from "hours" accordingly.
7. **Re-scope the defect.** It is a **name** defect, not a **capability** defect. All six
   capabilities are reachable today: `sweet-search <query>` / `grep` / `-e` / `read` /
   `read-semantic` / `trace`. Say so, or the appendix will read as "sweet-search does not work
   when installed", which is false and I verified it is false.
8. **Restate the falsifier honestly.** Record that it has already been executed here and did
   not fire, so it is spent. Note that the ceiling has no falsifier at `$0` or at any price.
   If the synthesis wants a real gate, it must be a real-user telemetry question, and that is
   out of scope for this workflow.
9. **Add the fix-order note.** Fixing reachability without fixing the vehicle would make the
   product slower for every user. Both must land together.

---

## 5. What I could not finish

- I did not independently re-run `perm.py`. I confirmed it exists at
  `/tmp/wf-slatec/real-user-product/perm.py` on the evidence box `[M ssh ls]`, but I did not
  re-derive the 16.04 Bash envelopes per rollout, the 31.1% compound share, or the median 3
  distinct `ss-*` names. Those stay `[M, R13]` on that author's word. They do not change my
  verdict: they describe the permission surface a fix would need, not the size of the effect.
- I did not price a real-user session. No `$0` method exists for it, and none is proposed.
- I did not verify the `[W code.claude.com/docs/en/prompt-caching]` claim that scoped allow
  rules do not invalidate the cache. It is not load-bearing for the verdict; if part (b)
  survives, someone should open that page.
- I did not run any wrapper from the scratch install. Doing so would build an index, which is
  slow and outside the question I was asked.

## 6. Evidence I opened

Local, `/Users/admin/Projects/sweet-search-private/`:
`package.json`; `core/cli.js` (1–170); `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`;
`scripts/init.js` (230–275, 2135–2175); `scripts/install-tool-enforcement.js`;
`scripts/inject-agent-instructions.js`; `scripts/write-claude-rules.js`;
`scripts/install-claude-system-prompt.js`; `scripts/install-mcp-server.js`;
`eval/agent-read-workflows/bin/{ss-grep,ss-read,_ss-env.sh,_ss-helpers.mjs}`;
`crates/sweet-search-cli/src/main.rs`;
`eval/task-completion-bench/harness/agent-runner-shared.mjs` (125–162);
`eval/task-completion-bench/harness/claude-code-task-runner.mjs` (88–100);
`README.md` (324, 428–429, 437, 536–572);
`eval/task-completion-bench/handoffs/improve/slate-c/BRIEF.md`;
`.../slate-c/DEAD-LEVER-REGISTER-DRAFT.md`;
`.../slate-c/candidates/DEDUP.md` (27, 95–104, 159, 174, 210–232, 289, 325);
`.../slate-c/candidates/real-user-product.md` (141, 164–165, 292–295, 362, 439);
`.../slate-c/verify/c08-history.md` (236–262).

Memory: `/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/memory/project_ss_tools_native_vs_eval_dispatch.md`;
`.../project_read_tools_plan.md`.

Evidence box (read-only, `ssh root@167.233.69.121`): `ls /tmp/wf-slatec/`,
`find /tmp/wf-slatec -name 'perm*'` → `/tmp/wf-slatec/real-user-product/perm.py`. No writes.

Scratch (local, disposable):
`/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f/scratchpad/c12/`
holds `sweet-search-2.7.2.tgz`, `install.log`, and `prefix/`.
