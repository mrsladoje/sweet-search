# Security Review — Indexing Optimization Series

**Branch:** `main`
**HEAD:** `34089b2`
**Range:** `8be7e09..34089b2`
**Date:** 2026-04-15
**Reviewer:** Claude (qe-security-reviewer)
**Audience:** Codex (human reviewer)
**Scope:** indexing optimization series (CoreML cascade HF distribution, H6
SHA256 verification cache, LI skip policy, atomic LI swap, summary disk
backup, content-hash mlmodelc cache). Excludes incremental indexing.

---

## 1. Threat model

Sweet Search is a developer code-search tool distributed via npm. The user
runs it on their own workstation with their own permissions. The cache lives
in `~/.cache/sweet-search/models/` (default), mode 755 (`feedback`: confirmed
on this machine — `drwxr-xr-x admin staff`). With this in mind, the relevant
attackers are:

| Attacker | Capability | Bar to clear | Likelihood |
|---|---|---|---|
| **A1 — Local same-user process** | Read/write to `$HOME` | Already logged in or running with user's UID (e.g., a malicious npm postinstall, a compromised editor extension, a sandboxed VS Code task). No root needed. | **Real but small.** Code-search tools live next to source code, which itself is the bigger prize. But cache poisoning gives them code-execution-via-model-load. |
| **A2 — Network MITM** | Intercept HTTPS to `huggingface.co` | Working CA compromise / corporate MITM proxy / `--insecure` client. SHA256 in registry blunts this. | Low for default install (Node `fetch` validates TLS), higher behind enterprise MITM proxies that the user has trusted. |
| **A3 — Supply chain — npm package** | Modify files inside the published `sweet-search` package (`coreml-cascade.json`, registry, `model-fetcher.js`) | Account compromise on the publishing pipeline. | Catastrophic if it lands; the package is the trust root. Out of scope for THIS review except where the new code expands the blast radius. |
| **A4 — Supply chain — HF tarball repo** | Push to `huggingface.co/mrsladoje/sweet-search-coreml-cascade` | Compromise of one personal HF account. SHA256 pin in `coreml-cascade.json` blunts this **only if** the hash file is intact. | **Plausible**, single-point-of-failure on a personal account. |
| **A5 — Malicious tarball contents** | Hand-crafted `.tar.gz` that abuses extraction | Requires A2 OR A3 OR A4 OR a checksum collision (infeasible for SHA256). | Low because all paths through `extractVariantTarball` require checksum match in `fetchModelFile` first. |

Trust anchors in the new code:

1. **`MODEL_REGISTRY` SHA256 hex strings** — embedded in
   `core/infrastructure/model-registry.js`, reviewed via git. Trust root for
   the regular models.
2. **`coreml-cascade.json` SHA256 hex strings** — embedded in
   `core/infrastructure/coreml-cascade.json`, reviewed via git. Trust root
   for the 12 cascade tarballs.
3. **Verification sidecars** (`.verified.json`) under the cache dir, written
   by Node, plain JSON, no integrity tag. Memoization layer, not a trust
   anchor (per source comment line 45).

The H6 fix introduced (3) as a memoization layer. The CRITICAL finding
below is that under one concrete attack vector (A1), this memoization is
exploitable as a trust anchor because the loader path never re-verifies.

---

## 2. Findings

### CRITICAL — C1: Verification-cache sidecar can be forged by local same-user attacker (CWE-345 — Insufficient Verification of Data Authenticity)

**File:** `core/infrastructure/model-fetcher.js:100-127`

**Exploit:** `isVerified` returns `true` purely on a comparison of three
fields read from a JSON sidecar file:

```
sidecar.sha256 === expectedSha256
&& sidecar.size === stat.size
&& sidecar.mtimeMs === stat.mtimeMs
```

It does **not** re-hash the file's contents. An attacker A1 who can write
to `~/.cache/sweet-search/models/<model>/` can:

1. Write a malicious `model.safetensors` (any size, any mtime).
2. Write `model.safetensors.verified.json` with
   `{"sha256":"<registry_hash>","size":<malicious_size>,"mtimeMs":<malicious_mtime>,"verifiedAt":1}`.
   The registry hash is **public** (it lives in
   `core/infrastructure/model-registry.js` and is reviewed via git).
3. On the next sweet-search invocation, `isCacheValid` calls `isVerified`,
   the three-field comparison succeeds, and the path short-circuits the
   stream-hash on line 181 entirely. The malicious file is mmap'd by
   the Rust loader at `crates/sweet-search-native/src/inference/embedding_model.rs:333-337`
   (`from_mmaped_safetensors`) and `li_model.rs:333-337` with **no
   re-verification**.

**Impact:** Code execution via tampered model weights is unlikely — the
Rust loader doesn't `eval` the bytes, it interprets them as f32 tensors —
but the impact tier is still **HIGH** because:

- (a) Adversarially crafted weights can degrade embedding quality
  silently (no MRR alarm); a code-search tool serves code as input, so
  this becomes a **silent quality regression** with no detection.
- (b) Tampered LI weights can produce activation patterns that, when
  printed back to the user as part of a search result preview, encode
  bytes from confidential code in surrounding hits — a side-channel
  exfiltration vector. Low likelihood, but the threat model matters
  because sweet-search is trusted with source code.
- (c) `safetensors` parsing in the candle stack has had memory-safety
  bugs historically; mmap'ing attacker-controlled bytes that pass
  no cryptographic check enlarges the attack surface for any future
  parser bug.

**Why the existing comment is wrong:** Lines 45-56 claim:

> The cache never skips verification against a NEW expected hash, only
> against a previously-verified hash for an unchanged file.

This is true *if* the sidecar is written only by `recordVerified`. But
the sidecar is a plain JSON file in a directory the user has write
access to — it can be forged. The comment conflates "cached fact about
a previous verification" with "sidecar contents on disk", and the latter
is attacker-controlled.

**Likelihood:** A1 needs same-user write access. Bar is low if the user
runs *anything* compromised under their UID (malicious VS Code extension,
postinstall script in a transitive dep). Bar is moderate on a clean
workstation.

**Suggested mitigations (do not implement):**

1. **Re-hash on cold start only** — keep the in-memory cache, drop the
   on-disk sidecar. The N-worker stall this fix targets is intra-process
   (worker_threads share state via the parent). Cold-start re-verification
   is the price of trust.
2. **HMAC the sidecar with a per-install secret** stored in
   `.sweet-search/install-secret` (mode 600). Reject sidecars whose HMAC
   doesn't validate. Local attacker can't forge without the secret.
3. **Re-verify in the Rust loader** at `embedding_model.rs::load` and
   `li_model.rs::load` before mmap. The expected hash is already in the
   registry; pass it through. This is defense-in-depth that survives
   any Node-side cache compromise.
4. **At minimum:** also store the **inode number** in the sidecar. Local
   attackers replacing the file via `unlink + write` get a new inode, so
   `stat.ino !== sidecar.ino` would invalidate. This raises the bar
   modestly without breaking the fast path.

---

### HIGH — H1: Tarball decompression bomb fills disk (CWE-409 — Improper Handling of Highly Compressed Data)

**File:** `core/infrastructure/coreml-cascade.js:417-462`
(`extractVariantTarball`)

**Exploit:** `fetchModelFile` validates the tarball's *download size* and
SHA256 against `coreml-cascade.json`. Both checks happen on the
**compressed** bytes. `extractVariantTarball` then runs
`tar -xzf <tarball> -C <stagingDir>` with no extracted-size cap.

If A4 (HF account compromise) replaces a tarball with a high-ratio gzip
bomb — say, 250 MiB compressed → 2 TiB extracted, with a checksum that
A4 also rewrites in `coreml-cascade.json` IF they additionally compromise
the npm package (so requires A4+A3 together) — extraction will fill the
disk before the "exactly one top-level entry" check at line 438 ever
runs.

A simpler variant doesn't need A3+A4 chained: an A1 local attacker can
simply replace the tarball that's been downloaded into the OS tempdir
by `fetchModelFile` (between the verification and the extraction). The
checksum was already validated, but bsdtar reads the file fresh on the
next syscall — TOCTOU. This is hard to exploit in practice (the tempdir
path is unpredictable per `mkdtempSync`), but it's a real window.

**Impact:** Denial of service via disk fill. On a developer laptop this
locks up the system. **MEDIUM** severity in practice (DoS only); **HIGH**
listing because the install path is `init`, which runs once and may run
unattended (CI), and disk-fill on CI runners is a real recurring cost.

**Suggested mitigations:**

- Use `tar -x ... --read-stdin` with `head -c <max>` upstream, OR use
  `--total-size`/`--max-size` (BSD tar has neither directly — use a
  pre-flight `tar -tzvf | awk` size sum), OR switch to a Node-native tar
  library (`tar` npm package) which exposes `maxBytes`. The added dep is
  small and is already in many indirect dep trees.
- Sum the expected `tarballSizeBytes` per variant from the spec, multiply
  by a 10× expansion fudge factor, and refuse to extract if that exceeds
  free disk space (`statvfs`).

---

### HIGH — H2: SHA256 in `coreml-cascade.json` is the only trust anchor for cascade artifacts; no signature

**File:** `core/infrastructure/coreml-cascade.json:17-43`
**File:** `core/infrastructure/coreml-cascade.js:614-624`
(`fetchAndExtractCascadeVariant`)

**Exploit:** A4 (HF account compromise of `mrsladoje/sweet-search-coreml-cascade`)
can publish replacement tarballs. The checksum embedded in `coreml-cascade.json`
inside the npm package is the ONLY check that prevents a swap. There is
no Sigstore/cosign signature, no GPG signature, no in-toto attestation,
no public-key pinning of the HF repo.

If `coreml-cascade.json` and the HF tarballs are both compromised
(requires A3+A4), the trust collapses entirely. If only one is
compromised, the other catches it.

The commit note for `cf04213` mentions "Python upload_file" was used to
push without describing any signing step.

**Impact:** A successful A4 (or A3+A4 chain) lets the attacker plant
arbitrary `.mlpackage` content on every M3+ machine running
`sweet-search init` after the compromise. Once on disk, the `.mlpackage`
is loaded by `coreml_shim.m::sweet_coreml_load` at line 284 and compiled
by `[MLModel compileModelAtURL:]` (line 356), which interprets the
mlmodel protobuf. This is **not sandboxed**. Compromised mlmodels have
been demonstrated to trigger CoreML parser bugs in the past (Apple
patches via macOS updates, but the surface exists).

**Likelihood:** A4 is **the** outstanding supply-chain risk. The repo
owner is a personal account, not a project-owned org. There is no
public statement that this is the official cascade.

**Suggested mitigations:**

- Move the HF repo to an organization account owned by the sweet-search
  project. Enable mandatory 2FA + branch protection (HF supports this
  via "trusted contributors"). Document the canonical repo in
  `docs/SECURITY.md`.
- Sign the tarballs with Sigstore cosign (keyless, OIDC-bound to the
  project's CI identity). Verify in `fetchAndExtractCascadeVariant`
  before extraction.
- Drop the `.mlpackage` cache root behind a `chmod 700` to reduce A1's
  blast radius for the cached compiled `.mlmodelc` (see L1 below).

---

### MEDIUM — M1: SHA256 verification cache TOCTOU between rename and `recordVerified`

**File:** `core/infrastructure/model-fetcher.js:302-308`

**Exploit:** Lines 302-308 do (in order): `invalidateVerifiedSidecar` →
`renameSync(tmpPath, finalPath)` → `recordVerified(finalPath, sha256)`.

Between the rename and `recordVerified` writing the sidecar, an A1
attacker can:

1. Read the just-renamed file's mtime/size via `stat`.
2. Write a sidecar with the registry hash, the live mtime, the live
   size, and a `verifiedAt` of `Date.now()`.
3. The legitimate `writeFileSync` in `recordVerified` overwrites this
   with the real record — but the attacker has already learned the
   working pattern: any subsequent same-process read of the cache uses
   `_verificationMemCache`, but a SECOND process reading the disk
   sidecar gets the legitimate record. So this particular race is
   benign in isolation.

The **larger** TOCTOU is C1: between `recordVerified` writing a
legitimate sidecar and the NEXT process reading it, the attacker can
swap both files atomically. That's the path described in C1.

**Impact:** Same as C1, with a slightly tighter timing window. Folded
into C1's mitigation set; standalone severity **LOW**, but flagging at
**MEDIUM** because of the close coupling to C1 — fixing C1 may not
fully cover this race unless the in-memory and on-disk caches are
unified.

---

### MEDIUM — M2: `restoreSummaries` does not validate disk-backup schema

**File:** `core/graph/summary-manager.js:83-103`, `215-340`

**Exploit:** `readDiskBackup` parses
`{dbPath}.summaries.bak.json` as JSON, checks
`Array.isArray(parsed.summaries)`, and returns the array. Each element
is then passed to SQL prepared statements:

```js
updateBySigHashStmt.run(
  row.summary,
  row.summary_embedding,
  row.file_path,
  row.type,
  row.name,
  row.signature_hash
);
```

`row.summary` and `row.signature_hash` are read directly from
attacker-influenced JSON. better-sqlite3's prepared statements bind
positionally, so SQL injection via these fields is blocked, BUT:

- `summary` is stored as a TEXT column, no length cap. An attacker
  who plants a `.summaries.bak.json` with multi-megabyte `summary`
  strings can balloon the code-graph DB. DoS, not breach.
- `summary_embedding` is base64-decoded into a Buffer (line 60-65)
  with no length validation. A 2 GiB base64 string becomes a 1.5 GiB
  Buffer in memory, then written into BLOB column. Memory and disk
  exhaustion.
- The disk backup is read **only when the live DB has zero summaries**
  (`backupSummaries` line 165) or doesn't exist (line 139), so the
  attack window is narrow: the attacker has to plant the malicious
  backup BEFORE the user's first successful index. Not impossible
  (postinstall hook + race), but contrived.

**Impact:** **LOW** likelihood, **MEDIUM** impact (DoS via memory/disk
exhaustion).

**Suggested mitigations:**

- Cap `row.summary.length` at e.g. 64 KiB.
- Cap base64 decoded `summary_embedding.length` at hidden_dim × 4 bytes
  (768×4 = 3072 for the current model).
- Optionally HMAC the backup file the same way C1's mitigation suggests
  — same secret can cover both.

---

### LOW — L1: Cached `.mlmodelc` directories live in user-writable cache root with no integrity check

**File:** `crates/sweet-search-native/src/inference/coreml_shim.m:340-360`

**Exploit:** The CoreML cache invalidation uses
`SHA256(Manifest.json)` as the freshness key. The sidecar
`.src-sha256` lives **inside** the compiled `.mlmodelc` directory at
`{cachedPath}/.src-sha256`. An A1 attacker can:

1. Replace the `.mlmodelc` directory contents with a malicious
   compiled CoreML model.
2. Compute SHA256 of the *current* `Manifest.json` of the source
   `.mlpackage` (which they cannot modify if it came from the
   verified tarball).
3. Write that hash into `.src-sha256`.
4. The next load uses the malicious `.mlmodelc` without re-compiling.

The Obj-C source comment is explicit (lines 188-193):

> all persistence is best-effort; cache failure never breaks loading

— meaning the cache is a performance optimization. But the load path
calls `[MLModel modelWithContentsOfURL:cachedUrl]` (line 354) on an
attacker-controlled directory.

**Impact:** Code execution via CoreML parser bugs (rare, but historical
CVEs exist), or silent embedding-quality degradation. **LOW** because
A1's bar is the same as C1, and the impact via `.mlmodelc` is no worse
than via the source `.safetensors` already covered in C1 — i.e., this
is a parallel attack surface, not a new one.

**Suggested mitigation:**

- Rebuild `.src-sha256` to also include `SHA256(.mlmodelc/coremldata.bin)`
  or similar — i.e., make the sidecar tie the cache contents to the
  source contents, not just the source. Or simply scrap the
  `.mlmodelc` cache and accept the 200s cold-compile cost
  (one-time per cascade install, post-init).

---

### LOW — L2: `formatVariantFilename` and `formatVariantTarballPath` blindly interpolate JSON-supplied `batch`/`seq`

**File:** `core/infrastructure/coreml-cascade.js:108-112, 395-399`

**Exploit:** `coreml-cascade.json` declares each variant as
`{ "batch": 64, "seq": 96, ... }`. `formatVariantFilename` does:

```js
return pattern.replace('{batch}', String(batch)).replace('{seq}', String(seq));
```

If A3 ships a compromised package with `"batch": "../../../etc/passwd"`,
the formatter produces `nomic_bert_b../../../etc/passwd_s96_fp16.mlpackage`,
and `path.join(embedDir, filename)` builds a path that escapes the
cascade dir. Subsequent operations (`existsSync`, `mkdirSync`,
`renameSync`) follow the malicious path.

**Impact:** This is downstream of A3 — at which point everything is
lost. Worth noting only as **defense-in-depth**: typed integer parse
(`Number.isInteger(batch) && batch > 0 && batch <= 4096`) at JSON-load
time would block this entire class of bugs cheaply. Severity **LOW**
because the prerequisite is full package compromise.

---

### LOW — L3: `SWEET_SEARCH_LI_SKIP_FILE` reads any user-controlled path with no validation

**File:** `core/indexing/li-skip-policy.js:84-98`

**Exploit:** `loadExtraPatternsFromFile` reads
`process.env.SWEET_SEARCH_LI_SKIP_FILE` and `existsSync(path) +
readFileSync(path, 'utf8')`. No path validation, no size cap.

The user fully controls their own env vars, so this is "user shoots
themselves in the foot" rather than a vulnerability. The only
amplification scenarios are (a) running sweet-search as root from a
compromised user-controlled service (file read as root → disclosure
into stderr if the parsed globs trigger an error log), and (b)
process invocation by another tool that propagates env vars across
trust boundaries.

The bar (a) is implausible for a code-search tool. Bar (b) is real
in some CI configurations.

**Impact:** **LOW** — file is read as the current user, contents are
parsed as glob patterns (not executed), no shell expansion. Worst case:
a 10 GiB symlinked log file gets fully buffered into RAM via
`readFileSync('utf8')` → DoS.

**Suggested mitigation:**

- Cap file size: `if (statSync(path).size > 1<<20) skip with warn`.
- Refuse to read symlinks (`statSync` + `lstatSync` mismatch).
- Resolve `path.resolve(path)` and require it lives under
  `os.homedir()` or `process.cwd()`. Conservative; may break legitimate
  workflows.

---

### LOW — L4: Logging discloses absolute home-dir paths to stderr

**File:** `core/infrastructure/model-fetcher.js:261, 283, 293`
**File:** `scripts/init.js:466, 480, 490-501, 506`

**Exploit:** stderr lines like
`[ModelFetcher] Downloading model.safetensors from nomic-ai/CodeRankEmbed...`
include neither home paths nor secrets. Searches for `process.stderr.write`
in the new code paths show they all log relative model identifiers, not
absolute paths.

`writeInitConfig` (out of scope, pre-existing) writes
`.sweet-search/config.json` with absolute paths. That's pre-existing
behavior, not regressed by this series.

**Impact:** **INFORMATIONAL** — no new disclosure introduced by the
indexing series.

---

### INFO — I1: `npx sweet-search init` performs ~3.2 GiB downloads with no `--dry-run` listing

**File:** `scripts/init.js:299-343`

The help text mentions the download size but there is no
`init --dry-run` or `init --list-downloads` to enumerate URLs and sizes
**before** the network calls. `--skip-coreml-cascade` exists for
opt-out, which is the current consent mechanism.

**Impact:** **INFORMATIONAL** — not a vulnerability. But for a tool
that downloads from a personal HF account, a dry-run that prints the
exact `hfRepo` and 12 tarball URLs would let security-conscious users
diff against `coreml-cascade.json` before pulling.

---

## 3. Verified-safe (looked suspicious, are adequately mitigated)

### S1 — `extractVariantTarball` path traversal via tarball entries

**File:** `core/infrastructure/coreml-cascade.js:427`
(`spawnSync('tar', ['-xzf', tarballPath, '-C', stagingDir])`)

`bsdtar` (the system `tar` on macOS) defaults to safe extraction:

> Archive entries can have absolute pathnames. By default, tar removes
> the leading / character… Archive entries can have pathnames that
> include `..` components. By default, tar will not extract files
> containing `..` components in their pathname… If neither `-U` nor
> `-P` is specified, tar will refuse to extract the entry [whose
> intermediate symlink would be followed]. — `man tar` on macOS 26.x

The code uses neither `-P` nor `-U`, so absolute paths, `..`
components, and symlink-targeting entries are all rejected by `tar`
itself. The cascade fetch is **gated to `darwin-arm64`** at
`core/infrastructure/hardware-capability.js:113-129`, so this `tar`
invocation never runs on Linux/GNU tar (which has different defaults).

**Verified safe, with caveat:** if cascade eligibility ever extends
beyond `darwin-arm64`, this needs to be revisited — GNU tar's defaults
differ.

### S2 — `spawnSync` injection via tarball/staging paths

**File:** `core/infrastructure/coreml-cascade.js:427`

Both `tarballPath` and `stagingDir` are constructed inside Node from
`mkdtempSync` and `getCoremlCascadeRoot()`, never from user input.
`spawnSync` with an argv array (not a shell string) does not invoke
`/bin/sh`, so even if these contained metacharacters there would be
no shell injection. **Safe.**

### S3 — `renameSync` of directory containing symlinks

**File:** `core/indexing/indexer-phases.js:87-120`
(`atomicSwapLateInteractionIndex`)

`rename(2)` on POSIX moves the directory inode, not its contents. It
does not follow symlinks inside the renamed tree. macOS APFS rename
is atomic for same-filesystem same-volume moves, which is what this
code does (`finalSegDir` and `bakSegDir` are siblings).

**Safe.**

### S4 — `model-fetcher.js` retry loop bounded

`MAX_RETRIES = 3` with exponential backoff (`RETRY_BASE_MS = 1000` →
1s, 2s, 4s). No infinite loop, no runaway retries. **Safe.**

### S5 — `SQL injection via `restoreSummaries`

`better-sqlite3` prepared statements bind values positionally; no SQL
text is interpolated from `row.*`. **Safe** for SQL injection (but
see M2 for the size-bound concern).

### S6 — `fetchModelFile` HTTP redirect / SSRF

Node's `fetch` follows redirects by default but to HTTPS URLs only.
`hfEndpoint` is interpolated into the URL (`${hfEndpoint}/${hfId}/...`),
where `hfEndpoint` comes from `MODEL_DELIVERY_CONFIG.hfEndpoint` =
`process.env.SWEET_SEARCH_HF_ENDPOINT || 'https://huggingface.co'`.
The user controls their own env vars; this is consent territory.
**Safe.**

### S7 — `coreml_shim.m` stage-and-rename atomicity

The Obj-C cache writer uses `getpid()` + `CFAbsoluteTimeGetCurrent()`
for the staging suffix and `[NSFileManager moveItemAtURL:toURL:error:]`
for the final rename. Two concurrent processes both compile, one wins
the rename, the other cleans up its staging dir. **Safe** for
correctness (see L1 for trust concerns).

### S8 — `.verified.json` write race

`writeFileSync` on the sidecar is not atomic, so a concurrent reader
mid-write gets either truncated JSON (parse fails → `null` → re-hash)
or full JSON. The fall-through is always re-hashing, which is the
correct behavior. **Safe** under "any failure forces re-verify"
semantics — except that re-verify itself is what C1 demonstrates can
be bypassed if the attacker has prepared the sidecar.

---

## 4. Supply chain considerations

The **`mrsladoje/sweet-search-coreml-cascade` HF repo** is the single
biggest delta this series introduces to the project's supply-chain
risk surface. Concerns:

1. **Personal account.** The repo is owned by `mrsladoje`, not by an
   organization. If the account is compromised (phishing, credential
   stuffing, leaked HF token), the attacker can push replacement
   tarballs. The SHA256 pin in `coreml-cascade.json` blocks this **only
   for current installs**; new installs after a coordinated A3+A4
   compromise have no defense.
2. **No signing.** The commit notes mention "Python upload_file" with
   no signing step. Best-in-class would be Sigstore cosign keyless
   signing bound to a GitHub Actions OIDC identity, with verification
   in `fetchAndExtractCascadeVariant`.
3. **No public statement** in the repo's docs or README naming this
   as the "official" cascade location. A typo-squatted repo
   (`mrsladoj/...` or `mrsladoje-coreml-cascade/...`) could intercept
   confused users who type the URL by hand. Low likelihood (the URL
   is hardcoded), but worth flagging.
4. **Single point of failure.** All 12 variants are in one repo
   under one account. A single takeover compromises the entire
   cascade for every M3+ user.
5. **Checksum file is in the trust root.** `coreml-cascade.json` lives
   in the npm package, so as long as the package isn't compromised,
   the SHA256 pin holds. The trust delegation chain is:
   `npm registry → published package → coreml-cascade.json (12 hashes)
   → tarballs → mlpackages → mlmodelc cache`.

The trust chain depends critically on the npm package being intact.
The new code does not weaken that — but it does add a 13th element
(the HF repo) to the chain that previously had 12.

---

## 5. Recommended hardening (prioritized)

| # | Item | Severity addressed | Effort | Notes |
|---|---|---|---|---|
| **1** | Rust loader re-verifies SHA256 before mmap (defense-in-depth in `embedding_model.rs::load`, `li_model.rs::load`) | C1, L1 | 1-2 days | The expected hash already exists in the registry; thread it through the JS→Rust API. Trades cold-load latency for a real trust check. |
| **2** | HMAC the `.verified.json` sidecar with a per-install secret in `.sweet-search/install-secret` (mode 600) | C1, M2 | 1 day | Local attacker can no longer forge the sidecar without first reading the secret, which has 600 perms even if cache root is 755. Same secret can sign `.summaries.bak.json` (M2). |
| **3** | Cap extracted tarball size; switch to `tar` npm package or pre-flight `tar -tzvf` size sum | H1 | 0.5-1 day | Optional: also skip if free-disk < 2× expected. |
| **4** | Move HF repo to project-owned org; enable 2FA; document in `docs/SECURITY.md` | H2 | Coordination, low code | The single most impactful fix. |
| **5** | Cosign-sign cascade tarballs from CI; verify in `fetchAndExtractCascadeVariant` | H2 | 2 days | Requires a CI workflow, but Sigstore keyless OIDC makes this straightforward. |
| **6** | Cap `summary` length and `summary_embedding` size in `restoreSummaries`; fold into HMAC from #2 | M2 | 0.5 day | Minimal; the bound is known (768×4 for current model). |
| **7** | Add `--dry-run` flag to `sweet-search init` that prints all URLs + sizes + SHA256s without fetching | I1 | 0.5 day | Lets security-conscious users diff before pulling. |
| **8** | Type-validate `batch`/`seq` as positive integers when loading `coreml-cascade.json` | L2 | 0.25 day | Defense-in-depth against package compromise. Trivial. |
| **9** | Cap `SWEET_SEARCH_LI_SKIP_FILE` size to 1 MiB; reject symlinks; resolve under cwd | L3 | 0.25 day | Minimal. |
| **10** | Document the trust model in `docs/SECURITY.md` — what each SHA256 protects, what the `.verified.json` sidecar IS and IS NOT, what bsdtar's defaults provide on macOS | doc | 0.5 day | Sets correct expectations for future maintainers and reviewers. |

---

## 6. Overall security grade: **C+**

**Rationale:**

- **Correct trust model on the happy path.** Network MITM is blocked
  by SHA256 pinning + TLS; the rename-based atomic-write paths are
  correctly atomic; `bsdtar` defaults handle the path-traversal case
  the code did not explicitly defend against; SQL injection via the
  new disk backup is blocked by prepared statements; the env-var
  surface area is small and user-controlled.

- **One CRITICAL local-attack vector that the H6 fix introduced.**
  C1 turns a memoization optimization into a potential trust bypass.
  The Rust loader provides no defense-in-depth — it mmaps whatever
  the JS layer hands it. A local attacker who can write to the cache
  dir (a low bar on a developer workstation with any compromised
  user-space process) can plant arbitrary model bytes that pass all
  current checks.

- **One HIGH supply-chain decision** (H2) that's a coordination fix,
  not a code fix: the cascade is hosted on a personal HF account with
  no signing. The SHA256 pin is the only thing standing between an
  account compromise and code execution via mlmodel parsers.

- **One HIGH disk-fill DoS** (H1) in the tarball extract path.

- The series **does not regress** any pre-existing security boundary.
  All findings are about new code, and the bar for the worst of them
  (C1, H2) is moderate but not high.

- The grade would jump to **B+** with #1, #2, #3 from §5 implemented,
  and to **A-** with #4 and #5 added.

**Block recommendation:** Do **not** block the merge for this series.
File C1 as a tracked CRITICAL with a 30-day SLA, file H1 and H2 with
60-day SLAs. The series is a net improvement for performance and the
H6 cache stall it fixes is a real bug; the fix is correct except for
the trust subtlety that the comment block at lines 45-56 acknowledges
as a *constraint* but does not enforce.

**Files reviewed:**

- `/Users/admin/Projects/sweet-search-private/core/infrastructure/model-fetcher.js`
- `/Users/admin/Projects/sweet-search-private/core/infrastructure/coreml-cascade.js`
- `/Users/admin/Projects/sweet-search-private/core/infrastructure/coreml-cascade.json`
- `/Users/admin/Projects/sweet-search-private/core/infrastructure/config/platform.js`
- `/Users/admin/Projects/sweet-search-private/core/infrastructure/model-registry.js`
- `/Users/admin/Projects/sweet-search-private/core/indexing/li-skip-policy.js`
- `/Users/admin/Projects/sweet-search-private/core/indexing/indexer-phases.js`
- `/Users/admin/Projects/sweet-search-private/core/indexing/indexer-pool.js`
- `/Users/admin/Projects/sweet-search-private/core/graph/summary-manager.js`
- `/Users/admin/Projects/sweet-search-private/crates/sweet-search-native/src/inference/coreml_shim.m`
- `/Users/admin/Projects/sweet-search-private/crates/sweet-search-native/src/inference/embedding_model.rs`
- `/Users/admin/Projects/sweet-search-private/crates/sweet-search-native/src/inference/li_model.rs`
- `/Users/admin/Projects/sweet-search-private/scripts/init.js`
- `/Users/admin/Projects/sweet-search-private/scripts/build-coreml-cascade.js`
