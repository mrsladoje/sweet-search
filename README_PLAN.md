# sweet-search README → star-maximization report

## ✅ Progress tracker (updated 2026-06-18)

**Stage 1 — credibility hygiene (before any launch): DONE ✅**
- [x] **§7.1 Stale version string** — removed the `v2.5.5` callout entirely (npm badge carries the live version). Committed + pushed `051cf3e`.
- [x] **§7.3 WASM kernel size** — *false alarm*: README's "~4 KB (~1.6 KB gzipped)" matches the real 4409-byte artifact. The stale one was `docs/MAXSIM_OPTIMIZATION.md` (said 2.9KB + wrong path) — fixed in `051cf3e`.
- [x] **§7.2 Router latency** — decision: **keep ~10 µs** in README. The "2.6 µs" is a best-case GenCSN p50; ~10 µs is the honest/typical figure (HN-safe). No change.
- [x] **§9 Topic tags** — already set, verified solid (20/20 slots, covers the high-value cluster).
- [x] **§2/§8 GitHub description** — rewritten + live: *"Local code search for AI agents: six fast, purpose-built tools that return ranked answers, not raw grep. Because maybe grep isn't all you need… 🍬"* (no "SOTA", no "semantic" overclaim, definition-first, candy hook last).

**Remaining minor hygiene:**
- [ ] **§7.2 tail** — reconcile the `498` vs `499` tree-count straggler in `lib.rs` / `PAPER_RANKING.md` (README's 498 is correct; this is internal consistency only).

**Stage 2 — the rewrite (the star work): NOT STARTED**
- [ ] §2 Above-the-fold redesign (definition-first ordering, stars badge up top, drop node badge)
- [ ] §3 De-LLM the prose (cut em-dash density ~70%, break triads / "not just X—Y" / uniform bold-bullets, emoji down to ~1 per section)
- [ ] §4 Cut/move/compress to ~250–350 visible lines (TOC, benchmark prose, engine internals → `/docs` or `<details>`)
- [ ] §6 Elevate the 5 gems (Metal NaN bug, cache-aware batching, the shipped negative result, 8GB-laptop framing, `ss-trace` → flagship); demote internals
- [ ] §8 Add the comparison table (vs claude-context / grepai / Cursor)

**Stage 3 — the asset (highest single ROI): NOT STARTED**
- [ ] §5 Record the demo GIF (Quickstart payoff; `assets/demo.gif`) — *requires a screen recording, so this one's on you to capture*

**Stage 4 — launch: NOT STARTED**
- [ ] §9 HN/Reddit launch, "How it works" blog (NaN-bug + cache-batching stories), star-history chart once the curve bends

---

## TL;DR — the verdict

Your README is **excellent documentation and a mediocre landing page**. It's honest, deep, and technically credible — but it's ~811 lines where a star-converting front page wants ~250–350, it makes a cold visitor work for ~2 scrolls before they understand what the thing is, and (ironically, given how much of this engine is genuinely hand-built) **its prose reads as obviously LLM-generated**, which quietly undercuts the indie-craft story that earns stars.

The six highest-leverage moves, ranked:

1. **Add a demo GIF** of `sweet-search "where do we validate JWT?"` returning ranked code blocks, right after Quickstart. Single biggest "is this real?" lever for a CLI/agent tool. You currently have zero motion on the page.
2. **Promote the plain one-liner above the two flavor taglines** so what/why/who lands in the first sentence, not the third.
3. **Cut em-dashes ~70% and break the other AI-tells** (more below — this directly answers your question).
4. **Move the giant Benchmarks block and the 4-column Table of Contents down**; lead with the product, not the FDR methodology.
5. **Push the engine-internals deep-dives to `/docs` or a blog** with 2-line teasers (and elevate ~4 specific gems instead).
6. **Fix three stale/inconsistent numbers before any launch** (the version string is the worst offender).

There's also genuine **competitive urgency**, which is good news: this exact framing is winning *right now*. `DeusData/codebase-memory-mcp` took **+718 stars in a single day** on "code intelligence MCP, 99% fewer tokens, 100% local"; `zilliztech/claude-context` is trending on the same pitch **but requires an API key + a Milvus vector DB**. You have a deeper product than either and you're under-marketing it. The window is open.

---

## 1. The core problem, stated plainly

Two things are fighting your star conversion:

- **It reads like a spec, not a pitch.** The benchmark section (~162 lines, with Benjamini–Hochberg FDR and auMRRc curves) appears *before* the reader has seen what the six tools even are. A visitor meets your methodology before your product.
- **It reads machine-written.** This matters because your whole differentiator is *hand-built craft* — bespoke SIMD kernels, a Metal NaN bug you hunted down. When the prose pattern-matches to "ChatGPT wrote this," a skeptical developer discounts the craft claims. The medium contradicts the message.

Everything below serves fixing those two things without losing the honesty that is, genuinely, your best asset.

---

## 2. Above-the-fold redesign (the most important section)

Right now the first screenful is: full-width banner → `Maybe grep isn't all you need… 🍬` → `…challenges the narrative 😎` → **then** the real definition on line 10. A skimmer who bounces at the banner never reaches the value prop.

**Target first screen, in order:**

1. Banner (keep it, it's good brand identity — the candy theme is a real asset in a category of grey "grep/grok/context" names).
2. **The plain definition, first readable line:** *"Local semantic code search for AI coding agents — six tools that hand Claude Code, Codex, Cursor & Gemini CLI ranked, ready-to-use answers instead of raw grep. SOTA retrieval, faster-than-ripgrep grep, zero API keys, 100% on-device."*
3. The witty tagline (`Maybe grep isn't all you need…`) as the **secondary** line — keep it, it's a sharp "Attention Is All You Need" play that the AI/ML crowd (your star base) will catch. It's a vibe, not a value prop, so it can't go *first*.
4. Badge row — **add a GitHub stars badge here** (yours is currently exiled to the very last line of the file). Drop the `node ≥18` badge (low signal for a star decision).
5. The demo GIF (§5).
6. Quickstart.

The GitHub **repo description field** matters as much as the H1 — Trending and search show it verbatim. Make it the keyword-dense definition, because "sweet-search" tells a stranger nothing on its own.

---

## 3. The em-dash question — direct answer

You asked specifically. Here's the evidence and the verdict.

**The counts in your current README:** 188 em-dashes (≈23 per 100 lines — it's the document's dominant punctuation), 182 emoji glyphs with **84% of headings carrying a leading emoji**, and the identical `- **Bold phrase** — explanation` bullet template used 29 times.

**The verdict: don't purge em-dashes, but cut their density hard, and fix the company they keep.**

- The "em dash = AI" perception is **real and widespread** in 2024–2026 (it went viral via r/ChatGPT and a Gen-Z "ChatGPT hyphen" meme; a YouGov survey found only ~15% of people use dashes often, so heavy use *stands out*). Developers now make this accusation reflexively.
- **But the dash alone is a myth-tell** (Grammar Girl explicitly: em dashes are *not* a sign of AI writing). The real signal is **density + co-occurrence**. A document that is dense with em-dashes **and** emoji **and** rule-of-three triads **and** uniform bolded bullet lead-ins reads as machine-written no matter how honest the content. Your README hits all four simultaneously — that combination is the high-signal pattern, not the dash by itself.

So your instinct is correct but partial. Removing dashes while keeping the cadence will help only a little. The actual fixes, in order of impact:

1. **Kill the rhythm, not just the symbol.** The tells that out-rank em-dashes per the research: rule-of-three triads (`edit, save, search`; `Same model, same tasks, same judge`), the "not just X — Y" / negation-reframe (`Denser, not just longer`; `understands your modules, not just your directories`), and appositive stacking (`— a strictly harder setting —` appears four times). Vary sentence shape. Let some sentences be short. Start one with "But."
2. **Em-dashes: cut ~70%.** Replace most mid-sentence dashes with periods, commas, colons, or parentheses. Keep a handful for genuine asides. The goal is to stop the dash being the *default* connector.
3. **Emoji: from 84% of headings down to ~1 marquee emoji per top-level section.** Drop the hype emoji on benchmark numbers (`🔥` after `0.866`) — those numbers are strong enough to stand without cheerleading, and the emoji *cheapens* them.
4. **Break the `- **Bold** — clause` bullet monotony.** It's listed as a specific AI formatting tell. Vary it.
5. **Scan for hallmark vocabulary** (delve, leverage, seamless, robust, foster, streamline, harness, elevate) and Title-Case headings (use sentence case).

The payoff: your honesty-forward, first-person voice with real caveats is *the antidote* to the AI-tell — it's the most human thing in the document. Preserve that; trim the formatting tics around it.

---

## 4. Structure: cut / move / compress

| Section (approx lines) | Action | Why |
|---|---|---|
| Table of Contents, 4-col table (33–91) | **Cut** | Delays Quickstart; GitHub auto-renders a TOC from the hamburger menu. A docs-site pattern, not a landing-page one. |
| `Latest release: v2.5.5` callout (108–110) | **Cut** | Changelog noise — and it's **stale** (repo is at v2.5.14). See §6. |
| Benchmarks deep prose (129–291, ~162 lines) | **Move down + shrink** | Keep a 4-stat headline strip up top; relocate the FDR/auMRRc/per-benchmark prose below the Six Tools. Fold the per-dataset blocks (which duplicate the table) into the existing `<details>`. |
| GPU-Accelerated Indexing internals (580–663) | **Move to /docs or blog** | Brilliant, but landing-page-irrelevant. 2-line teaser + link. (Elevate *one* gem from here — §5.) |
| The Native Engine Room (689–727) | **Move to /docs** | Four-crate table + INT4/SSLX internals = pure depth. |
| Per-tool essays for ss-semantic/trace/read (456–530) | **Compress** | The I/O table already conveys each tool; each gets a 6–10 line essay it doesn't need up front. |
| GEPA prompt-evolution `<details>` (568–578) | **Trim** | You currently *over-tell* the operator mechanics. Keep the result, cut the operator zoo. |

**Net target: ~250–350 visible lines, everything else behind dropdowns or doc links.** Every successful exemplar (ripgrep, fzf, ast-grep, aider, the trending rivals) is far shorter and hands off to docs/a site for depth. This validates your own instinct to keep depth back.

---

## 5. The missing demo (the #1 lever)

You have a banner SVG, two stat SVGs, and a Mermaid diagram — **zero motion, zero terminal output**. For a CLI/agent tool the working demo is table stakes. Ranked:

1. **A 10–15s GIF of the Quickstart payoff** — the literal `sweet-search "where do we validate JWT tokens?"` command you already show, returning 2–3 ranked, self-contained code blocks with `file:line` headers. Show the *output*; that's the proof. (Use a GIF, not asciinema — GIFs autoplay in GitHub's rendered README; commit it as `assets/demo.gif` so it survives clones.)
2. **A side-by-side "agent without vs. with" cast** — same task, native grep loop flooding 37k tokens vs. sweet-search's capped ~3k. This *visualizes* your headline benchmark far more persuasively than the FDR tables.
3. **A GIF of `ss-trace`** showing callers + callees + impact in one call — your most visually distinctive tool.

A good GIF at the top will likely outperform every prose change combined.

---

## 6. Hidden gems — what to ELEVATE vs. KEEP BACK

You were right that there's under-marketed brilliance. The mining agent verified 17 gems against source. Here's my judgment on each, which is the part you asked me to own.

### Elevate into the README (proof of depth that earns stars)

| Gem | The one-line pitch to use | Why it earns its place |
|---|---|---|
| **The Metal NaN bug** (`modernbert_sdpa.rs:431–467`) | *"Apple's GPU silently rounded our attention mask to fp16, turned −∞ into NaN, and collapsed retrieval quality to 25%. We found it, clamped the mask, fixed it."* | The single best credibility artifact in the repo. A short war-story callout proves you operate a layer below where competitors stop. Currently buried in a `<details>`. |
| **Cache-aware batching** (`onnx-session-utils.js:76–159`) | *"We read your CPU's last-level cache size before we batch, so a transformer layer stays resident instead of spilling to RAM."* | Tweetable systems-depth flex; the P-cluster-vs-E-cluster detail is the punchline for skeptics who click in. |
| **The negative result you ship anyway** (`ranking.js:136–142`) | *"We built a full cross-encoder rerank cascade, measured it, found it lost to the simpler path at 3× the latency — so we ship it off."* | Honesty-as-feature, perfectly on-brand. Stars reward this. |
| **Streaming indexer outcome** (`DISK_FLUSHING_STRATEGY.md:411–417`) | *"Indexes large repos on an 8 GB laptop"* (reframe the 785→213 MB heap win as the user benefit). | Turns an internal into a "it just won't crash" promise. |
| **`ss-trace` → flagship** | Promote graph trace from "6th tool in a list" to a named differentiator. | Practitioners say *"for code, graph signals dominate — callers, callees, type-signatures — most tools stop short."* This is exactly where you beat the field; don't bury it. |

### Mention in one line (in the engine/pipeline section)

SIMD posting-list intersection (the *why* behind "10× grep"), Leiden community detection (*"understands your modules, not your directories"*), zero-GC search, mmap-HNSW (0 MB heap), score-spread adaptive pooling. These are strong proof-of-rigor but too micro to headline.

### Keep hidden / save for a blog (your instinct was right)

- **Dedup correctness internals** (union-find + pairwise re-validation + the "best sibling takes the exemplar slot" trick) — keep only the one-phrase *guarantee* ("collapsing copies never hides the right answer"); the mechanism is a 600-word blog post.
- **FNV-1a socket derivation, worktree lockfiles, SSLX byte layout / CRC32 polynomial** — plumbing that reads as noise on a landing page.
- **The full GEPA operator zoo** (Maximin, trajectory crossover, tool-name masking, M++ pass) — keep the *result* (an evolved prompt that generalizes to unseen models and languages), cut the mechanics. You currently over-tell this.
- **Actual moats — name the idea, never the recipe:** the per-codebase adaptive sparse-gram frequency thresholds and the per-language enrichment policy matrix. You already credit the *ideas* (Blackbird, Cursor, Anthropic Contextual Retrieval); do **not** publish the tuned thresholds or the per-language policy table. Those are the recipe competitors would copy.

The two best **WOW stories** to build a "How it works" blog post around (which doubles as a Show HN / launch artifact): the NaN-bug hunt, and "we read your CPU cache before we batch."

---

## 7. Honesty flags to fix before any launch

Your README *under*-claims more often than it over-claims (which is rare and good). But four cosmetic issues will be screenshotted by a critic if left:

1. **Stale version — fix now.** README says `Latest release: v2.5.5`; repo is at **v2.5.14**. A wrong version on the front page erodes exactly the credibility your honesty voice is building. Either keep it current automatically or drop the version callout entirely.
2. **Router latency understated.** README implies ~10 µs routing; internal docs say it's actually **~2.6 µs**. You're under-selling by 4×. Use the better number or drop the figure. (Also reconcile the **498 vs 499** tree-count straggler in `lib.rs` / `PAPER_RANKING.md` — the README's 498 is correct.)
3. **WASM kernel size mismatch.** README says "~4 KB (~1.6 KB gzipped)"; `MAXSIM_OPTIMIZATION.md` says 2.9 KB. Reconcile before you make "tiny kernel" a headline brag.
4. **Hook vs. table gap.** The hero says "up to 34% cheaper, 56% fewer tool calls" while the honest table shows Claude Code can be **+14% more expensive**. The "up to" is defensible — but the *jCodeMunch lesson* from the research is sharp here: a reviewer praised an "otherwise honest project" yet singled out its inflated headline number as the one thing that undercut it. Keep "up to," and consider leading with a *representative* number alongside the best-case.

Everything else checks out against source: the 10.2× grep (353W/0L), 47× MaxSim, the SOTA benchmark numbers, TurboQuant correctly disclosed as "researched but deferred," cross-encoder genuinely off-by-default, HNSW config. Your benchmark honesty is a real moat — keep the spine, just move the *self-flagellation* (the CrossCodeEval 0.12 on a task you don't target; the doubled AdvTest disclosure) into dropdowns so it stops diluting a strong pitch.

---

## 8. Positioning, one-liner, and the comparison table

**Category label — adopt:** *"a local semantic code-search engine for AI coding agents."* Your current line is 90% there; just insert **"semantic"** so that keyword isn't buried. Every load-bearing search term is present: *local* (your #1 differentiator and the most-searched constraint), *semantic code search* (the literal SEO category term), *engine* (the thing under your agent, not another assistant), *AI coding agents* (the buyer).

**Best one-liner draft (of 5 the agent ranked):**
> *"Local semantic code search for AI coding agents — six purpose-built tools that hand Claude Code, Codex, Cursor & Gemini CLI ranked, ready-to-use answers instead of raw grep. SOTA retrieval, faster-than-ripgrep grep, zero API keys, 100% on-device."*

**Add a short comparison table** — comparison-keyword pages rank well and convert skeptics. Your unique white space: *local + zero-API-key + zero-external-DB + agent-native + SOTA hybrid/ColBERT + faster-than-ripgrep grep, in one `npm i -g`.* **No competitor holds more than 3 of those 6.** The head-to-head to win:

| | sweet-search | claude-context (trending) | grepai (~1.7k★) | Cursor index |
|---|---|---|---|---|
| 100% local / on-device | ✅ | ❌ needs OpenAI/Voyage key | ⚠️ needs Ollama | ⚠️ editor-locked |
| External vector DB | none | ❌ Milvus/Zilliz | none | proprietary |
| Faster-than-ripgrep grep | ✅ | ❌ | ❌ | ❌ |
| ColBERT late-interaction rerank | ✅ | ❌ | ❌ | ❌ |
| Works in terminal agents (CC/Codex/Gemini) | ✅ | ✅ | ✅ | ❌ |

Lead the contrast with **claude-context** specifically — it's the trending leader and its weakness (API key + Milvus) is your exact strength.

---

## 9. Off-README levers for "repo of the day"

GitHub Trending ranks **star velocity vs. your own baseline**, not absolute stars — so a launch-day spike is the whole game, and a brand-new repo going 0→300 in a day beats an old one going 50→110.

- **Set 12 topic tags** (repo settings, not README), ranked: `code-search`, `mcp`, `claude-code`, `semantic-search`, `ai-agents`, `code-rag`, `developer-tools`, `rust`, `embeddings`, `colbert`, `ripgrep`, `local-first`. The `mcp` / `local-first` / `ai-agents` cluster is where the current star velocity lives (Octoverse 2025).
- **Hacker News is the biggest launch-day multiplier.** Title: 45–65 chars, **factual, no superlatives** (HN reflexively downvotes "fastest/best/SOTA"); link directly to the repo; post Tue–Thu 08:00–10:00 PT; answer every comment in the first hour. The copy-paste offline one-liner *is* your HN demo. There's a "second-chance pool," so a flat first launch isn't fatal.
- **Compatibility wall as day-one social proof:** a "Works with Claude Code · Codex · Cursor · Gemini CLI" logo strip is honest social proof you can show now, before you have user logos.
- **star-history.com chart:** add it **only once the curve bends upward** (it's anti-proof when flat). Use their static SVG `<picture>` embed.
- **Build the "How it works" blog** around the NaN-bug and cache-batching stories — it's both a launch artifact and the home for everything you're pulling out of the README.

---

## 10. Suggested order of operations

**Before any launch (credibility hygiene): ✅ DONE** — fixed the version string (#7.1, removed callout), reconciled the kernel-size number (#7.3, doc was the stale one), decided to keep ~10 µs latency (#7.2), set the repo description, topic tags already in place. *(Remaining: the 498/499 tree-count straggler in `lib.rs`/`PAPER_RANKING.md` — README is already correct.)*

**The rewrite (the star work): ⏳ NEXT** — restructure above-the-fold (§2), de-LLM the prose (§3), cut/move/compress to ~300 lines (§4), elevate the 5 gems + demote internals (§6), add the comparison table (§8).

**The asset (highest single ROI): ⬜ TODO** — record the demo GIF (§5). *Needs a screen recording — user-captured.*

**Then launch: ⬜ TODO** — HN/Reddit per §9, with the blog post live as the depth link.
