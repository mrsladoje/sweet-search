# c12 — adversarial verify, HISTORY lens

**Verdict: REFUTED as written, confidence 0.80.** The defect c12 names is real and I confirmed it
by measurement. The remedy c12 specifies is wrong, and I falsified it on this machine at `$0`. The
record already named this gap once, on 2026-06-19, as "the `ss-*` PATH gap", and the same note
carries the fact that kills c12's vehicle: the six files c12 wants to put on a user's PATH are
benchmark instrumentation, not the production surface. c12 does not cite that note, and nothing it
cites post-dates or bypasses it. c12's headline cost number (`~10.1%` of the claude-code cell) is
inferred and is about an order of magnitude above the only measured analogue in the whole evidence
set. c12 also declares its own bench effect to be zero, so it cannot move any of the three cells
this workflow exists to move.

What survives is one **product-defect row for the register**, not a lever, and not this fix.

---

## 1. What I confirmed (the defect is real)

### 1.1 Nothing puts the six commands on a user's PATH

`[C]` `package.json` v2.7.2 `bin` = `{"sweet-search": "core/cli.js", "sweet-search-mcp":
"mcp/server.js"}`. No `directories.bin`.

`[M]` `npm pack --dry-run --json` in `/Users/admin/Projects/sweet-search-private` (284 files,
`sweet-search@2.7.2`) ships exactly these under `eval/agent-read-workflows/bin/`:
`ss-find ss-grep ss-read ss-search ss-semantic ss-trace` plus `_ss-argparse.mjs _ss-env.sh
_ss-helpers.mjs`. `ss-batch` and the local `sweet-search` bench wrapper do **not** ship.
Output kept at
`/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f/scratchpad/pack.json`.

`[M]` `grep -n -E "\bPATH\b" scripts/init.js` returns **0 lines**. `ss-` appears in `init.js` only
in help text (lines 1497, 1498, 2145).

`[M]` A synthetic offline probe settles npm's rule mechanically rather than by citation. I built a
zero-dependency package with `bin: {"bp-linked": "sub/bp-linked"}` and `files: ["sub/"]`, containing
both `bp-linked` and `bp-notlinked`, and ran
`npm install -g --prefix <scratch>/prefix <scratch>/fake`. Result: `<prefix>/bin` holds exactly one
entry, `bp-linked -> ../lib/node_modules/binprobe/sub/bp-linked`; `command -v bp-notlinked` fails.
**A file listed in `files` but absent from `bin` is never a command.** Script and output under the
scratchpad path above (`fake/`, `prefix/`).

`[C]` No `ss-*` key has ever existed in `bin`: `git log -p --all -- package.json | grep -E
'^[+-].*"ss-'` returns nothing across the whole history. So this is an omission, never a decision
that was taken and later reversed.

### 1.2 The default install still tells the agent to call those commands

`[C]` `scripts/inject-agent-instructions.js:115,118` — default variant is `'cli'`.
`[C]` `scripts/write-claude-rules.js:26,34,48` — a default `sweet-search init` writes
`.claude/rules/sweet-search.md` from `getPolicyBody('cli')`.
`[C]` That body (`core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`) says
"Use the `ss-*` tools for all code search and navigation", heads its tool list "## Tools (search
commands, invoked via Bash)", and lists bare names `ss-search`, `ss-grep`, `ss-read`, and so on.
`[C]` `scripts/install-claude-system-prompt.js:23` appends: "you MUST follow the sweet-search
guidance in `.claude/rules/sweet-search.md` and use its `ss-*` CLI commands."
`[C]` `README.md` sells the same six names as "The Six Tools" (lines 424-434) and its "Works With
Your Agent" section (lines 876-905) lists MCP, harness injection, and hooks — never a PATH step.
`[C]` `scripts/init.js` never checks that an `ss-*` command resolves. There is no doctor step for it.

**So the default product path instructs an agent to run six commands that the package manager
never installs.** That much of c12 is correct and I found no record contradicting it.

### 1.3 No `permissions.allow` is ever written

`[C]` A grep for `permissions` across `scripts/`, `core/`, `mcp/` finds an `allow` writer nowhere.
`[C]` `scripts/install-tool-enforcement.js` writes `permissions.deny: ["Grep"]` (line 24
`GREP_DENY_VALUE = 'Grep'`, lines 140-155), and only under the opt-in `--enforce-tools`.
`[C]` `harness/claude-code-task-runner.mjs:95` passes `--permission-mode bypassPermissions`, so the
bench never meets a prompt.
`[C]` `harness/agent-runner-shared.mjs:137-142` prepends `ssBinDir` to PATH for the sweet arm only.

Compounding fact worth recording: with `init --enforce-tools` a real user's Claude Code loses native
`Grep` **and** has no `ss-grep`. The strict mode removes the only working option.

### 1.4 The permission-surface measurement reproduces

`[M]` I re-ran the source script on the evidence box, from my own scratch copy
(`/tmp/wf-slatec/c12-history/perm-rerun.py`, copied from `/tmp/wf-slatec/real-user-product/perm.py`;
source run `fp-claudecode-tab-20260826`, sweet arm, 71 transcripts):

```
Bash envelopes/rollout: mean 16.04 median 14.0  total 1139
chained (&&,;,|) envelopes: 354 = 31.1% of Bash envelopes
distinct ss-* command names per rollout: mean 3.46 median 3.0 max 6
distribution: {3:30, 4:22, 5:9, 2:8, 6:1, 1:1}
```

Exact match to c12's cited figures. One caveat the synthesis must carry: the 31.1% counts `|` pipes
as well as `&&`, `||` and `;`, so it is the share of compound envelopes, not of `&&` chains.

---

## 2. Why c12 is refuted anyway

### 2.1 A recorded fact kills the specified vehicle

Source: `/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/memory/project_ss_tools_native_vs_eval_dispatch.md`,
verified 2026-06-19, updated 2026-06-20.

It records two things c12 never mentions.

**(a) The name.** "Open: the agent-facing `ss-*` shims live sessions invoke weren't found in-repo
(the "`ss-*` PATH gap")". So the gap was observed and named more than two months before c12. It was
left OPEN. It was never gated and never killed. c12's `register_check: "New."` is therefore wrong on
the observation, though right that the canonical register has no row (I grepped
`register/DEAD-LEVER-REGISTER.md` for `reachab|packag|npm|install|allowlist|permission|PATH|contact
surface|bin entr|discover` — the only hits are E2, E15, D1b, G7, G18, G19, none about callability).

**(b) The killing fact.** The same note states that there are two distinct `ss-*` surfaces and that
`eval/agent-read-workflows/bin/ss-*` is "**BENCH INSTRUMENTATION only**", and warns in terms: "A
latency workflow that puts `SS_BIN` on PATH measures THIS, not production — overstates cold cost,
hides that production grep/find are warm-native." c12 proposes to put exactly those files on a real
user's PATH. Its own cited evidence is the bench harness PATH prepend, which is the very case the
note warns about. Nothing c12 cites post-dates or bypasses this.

Three code facts make the harm concrete, all `[C]` in
`eval/agent-read-workflows/bin/`:

1. `_ss-env.sh` calls itself "COMMON BENCHMARK-HARNESS ENVIRONMENT. Sourced by EVERY executable in
   this directory". It pins `SWEET_SEARCH_INTRA_OP_THREADS=8`, `SWEET_SEARCH_MAX_DAEMONS=3` and
   `SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS=120000`. Its own comments say production defaults the daemon
   cap to a RAM tier of 2/3/6 and the maintainer idle time to 30 minutes. Shipping these as `bin`
   entries would override the production RAM tier and the ORT thread policy on every user machine.
2. `_ss-helpers.mjs:992` writes `\n<<SS_TRACE_META>>{json}\n` to stdout on **every** `ss-trace` call,
   with no env gate (the only env reads in that file are `SWEET_SEARCH_ROUTE_META_DEBUG`,
   `SWEET_SEARCH_PROJECT_ROOT`, `SS_SMOKE_*`, `SS_READ_*`, and the three pins). A real user would see
   a benchmark trailer in normal output.
3. The wrappers are single-repo bench shims, not the warm-native production path the memory note
   describes for `search`/`grep`/`find`.

### 2.2 The fix, applied literally, does not work — measured

Every wrapper starts `DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"` and then sources
`"$DIR/_ss-env.sh"` and runs `node "$DIR/_ss-helpers.mjs"`. `[M]` All seven use `${BASH_SOURCE[0]}`
once and none calls `readlink` or `realpath`.

npm links a `bin` entry as a **symlink** into `<prefix>/bin`. `[M]` My probe printed:

```
BASH_SOURCE=<prefix>/bin/bp-linked
DIR=<prefix>/bin
<prefix>/bin/bp-linked: line 5: <prefix>/bin/_helper.sh: No such file or directory
```

So `$DIR` resolves to the link directory, the helper source fails, and the following `node
"$DIR/_ss-helpers.mjs"` would fail too because `_ss-helpers.mjs` is not there either. **Six `bin`
entries as specified produce six commands that are on PATH and cannot run.** The wrappers need
symlink resolution first, or a real `bin` shim that resolves the package root.

### 2.3 The pre-registered kill condition is the wrong test

c12 says: "Withdraw if `command -v ss-grep` resolves after a clean `npm install -g <tarball>`."
By §2.2, `command -v` resolves while the command is broken. The kill condition would fire a false
withdrawal on a build that is still defective. The correct falsifier is to **run** `ss-grep` in a
scratch repo from the installed prefix and check the exit status and the absence of a
`<<SS_TRACE_META>>` trailer, not to resolve the name.

### 2.4 The ceiling number is unsupported and points the wrong way

c12 asserts "three failed discovery requests add ~10.1% of the claude-code cell `[I]`".

The only measured analogue in the evidence set contradicts the size.
`[M forensics/claude-subagents.md §F3, line 65 table and line 9]` guide-less `Explore` subagents on
`fp-claudecode-tab-20260826` hunted for the binaries with **13 hunt calls and 12 rejected `--help`
calls**, invoked 200 of 215 `ss-*` calls by absolute path, and failed 14.0% of `ss-*` calls against
4.8% in the main thread. The whole dilution from that behaviour is "**at most $0.0255 of the $1.30
sweet arm, that is at most 2.0% of arm cost or $0.00039 per rollout**". Twenty-five discovery calls
across eight subagents cost at most 2.0% of the arm. Three cost far less.

Two further reasons the inference over-states. Discovery failures happen in the opening requests,
where the re-sent prefix is smallest, so an early request costs less than the mean request; the
claude-code sweet cell re-sends 20.1 tokens per ingested token (`BRIEF.md` §1.1), which back-loads
cost. And c12's own text says the user then "gets native retrieval", so the tail is the native
baseline, not a repeated discovery tax.

Replace `~10.1%` with the measured bound: **at most ~2.0% of the claude-code sweet arm for a whole
subagent's worth of discovery hunting, and well under 1% for three failed calls** `[M]`.

The guide band should also come from the brief: `BRIEF.md` §1.1 gives the tool guide as
**$0.00042-0.00051 per rollout, 2.6-4.5% of sweet spend**. c12's "+3.1% to +4.4%" is a narrower band
with no source given here.

### 2.5 It cannot serve this workflow's goal

`BRIEF.md` §0 rule 6 and §1 set the goal: move the sweet-versus-native cost and solve numbers on
codex, opencode and claude-code. c12 states its own bench effect is zero, because the bench supplies
the PATH. So it can never move a cell. The register already has the precedent for this class: **E2**
(`ss-*` wrapper hygiene) shipped as correctness with "no benchmark value claimed", and the review
panel explicitly rejected framing it as removable spend. c12 belongs in the same drawer.

### 2.6 Part (b) is only half-verified

The permission-allowlist half rests on an unproven assumption: that prefix rules such as
`Bash(ss-grep:*)` cover compound envelopes. `[M]` 31.1% of Bash envelopes are compound. The source
candidate document flags this itself (`candidates/real-user-product.md:148`: "a prefix allowlist
built from single commands does not obviously cover the 31.1% that chain"). c12's summary drops the
caveat. Also, "the codex/opencode equivalents" are two more configuration schemas with their own
formats and their own tests, which makes "Build cost: hours" optimistic.

---

## 3. Nearest register rows, and why c12 is not each of them

| row | why it is close | why it is not the same |
|---|---|---|
| **E2** — `ss-*` wrapper hygiene, SHIPPED | same files, same "product fix, no bench value" shape | E2 fixed how the wrappers *behave when they run*; c12 is about whether they can run at all |
| **A2** — `ss-batch` DEAD (called 0x) | `ss-batch` is also absent from `files` | A2 is a *usage* kill on a deployed-in-bench tool; c12 is a *packaging* gap |
| **A4** — MCP surface, OWNER-EXCLUDED | both are "which contact surface is real" | A4 is an owner decision about the bench arm; c12 is about the default install. Note the asymmetry: `sweet-search-mcp` **is** in `bin`, so `npx -y sweet-search-mcp` works, while the default CLI surface does not `[C]` |
| **§0.2** — inventory of which tools exist | same code area | §0.2 answers "does the file exist"; c12 asks "can a user invoke it". `ss-batch`'s absence from `files` is a genuine addition to §0.2 |
| **F3 / `HINT-LADDER`** — none | — | no resolution claim here |

**New register row proposed** (product defect, not a lever):

> **E16 — default install cannot invoke the six `ss-*` commands.** UNMEASURED PRODUCT DEFECT.
> `[C]` `bin` names only `sweet-search` and `sweet-search-mcp`; `[M]` `npm pack` ships the six
> wrappers under `files`; `[M]` an offline `npm install -g` probe shows `files` alone never creates a
> command; `[C]` the default `init` writes a guide and an appended system prompt that both name the
> six commands. First named 2026-06-19 as "the `ss-*` PATH gap" and left open.
> **Vehicle:** packaging plus `init`. **sweet-only:** yes. **Bench differential:** zero — the bench
> prepends the wrapper directory itself. **Do not fix by adding `bin` entries for the bench
> wrappers**: they source a benchmark environment file that overrides production daemon and thread
> policy, they emit an ungated `<<SS_TRACE_META>>` trailer, and their `${BASH_SOURCE[0]}` idiom
> breaks under npm's bin symlink (measured).

---

## 4. What I could not finish

- I did not install the real tarball into a scratch prefix. It pulls native dependencies, and the
  synthetic probe answers the same question offline and more cleanly. A measurability agent should
  still run the real install once, and must **execute** `ss-grep`, not only resolve it.
- I did not verify how Claude Code's Bash permission matcher treats compound commands. That decides
  whether part (b) works, and it is a `$0` question for the measurability lens.
- I did not price what a real user actually loses. The honest quantity is "pays the guide, gets
  native retrieval", and no run in the evidence set measures a no-PATH arm.
- I did not check codex or opencode permission schemas.

## 5. Evidence opened

Local: `package.json`; `scripts/init.js`; `scripts/install-tool-enforcement.js`;
`scripts/install-claude-system-prompt.js`; `scripts/write-claude-rules.js`;
`scripts/inject-agent-instructions.js`; `core/prompt-optimization/data/p7-final/sweet-search-system-prompt.md`;
`README.md` (lines 92-146, 415-445, 536-560, 876-905);
`eval/agent-read-workflows/bin/{ss-grep,ss-read,_ss-env.sh,_ss-helpers.mjs}`;
`eval/task-completion-bench/harness/agent-runner-shared.mjs` (120-150);
`eval/task-completion-bench/harness/claude-code-task-runner.mjs` (88-100);
`eval/task-completion-bench/handoffs/improve/slate-c/BRIEF.md`;
`.../DEAD-LEVER-REGISTER-DRAFT.md`; `.../register/DEAD-LEVER-REGISTER.md`;
`.../register/reader-*.md` (grep); `.../candidates/real-user-product.md`;
`.../forensics/claude-subagents.md`;
`/Users/admin/.claude/projects/-Users-admin-Projects-sweet-search-private/memory/project_ss_tools_native_vs_eval_dispatch.md`;
`.../memory/project_mcp_nocli_contact_surface.md`; `.../memory/project_npm_init_plan.md`.

Box (read-only, scratch under `/tmp/wf-slatec/c12-history/`):
`/tmp/wf-slatec/real-user-product/perm.py` (copied and re-run against
`/root/sweet-search-private/eval/task-completion-bench/results/fp-claudecode-tab-20260826`).

Scratch:
`/private/tmp/claude-501/-Users-admin-Projects-sweet-search-private/559eb8e8-f3c9-4891-b1d6-5f3d431e9f3f/scratchpad/{pack.json,fake/,prefix/}`.
