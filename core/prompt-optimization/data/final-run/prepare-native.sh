#!/usr/bin/env bash
# prepare-native.sh ($0) — build each checkout's native parts from ITS OWN source, once per source tree.
#
# Why: a fresh worktree has neither crates/sweet-search-native/sweet-search-native.darwin-arm64.node
# nor crates/sweet-search-cli/target/release/sweet-search. It then loads the committed
# packages/native-darwin-arm64 addon (no NativeEmbeddingModel → no Metal/CoreML: the indexer and the
# daemons fall back to ORT CPU) and the main checkout's node_modules 2.8.1 CLI (no agent-tools marker →
# every ss-* call runs the in-process JS fallback). The product a user installs has both native parts,
# so each arm gets them, built from its own commit:
#   addon  npm run build:native  (napi --release --platform --features coreml,accelerate)
#   client npm run build:cli     (cargo build --release; the client finds its daemon entry,
#          <checkout>/core/start-server.js, by walking up from its own path)
# A stamp ($FR_STATE/native-<arm>.json) records the git tree ids of both crates; an unchanged
# tree is not rebuilt, so this is cheap to call before every launch (merges into final-prep included).
#   bash prepare-native.sh [final|before|both]   (default both)
set -euo pipefail
. "$(dirname "$0")/config.sh"
WHICH="${1:-both}"
mkdir -p "$FR_STATE/cargo"
build_one() { # <name> <root>
  local name=$1 root=$2
  local ntree ctree stamp
  ntree=$(git -C "$root" rev-parse HEAD:crates/sweet-search-native)
  ctree=$(git -C "$root" rev-parse HEAD:crates/sweet-search-cli)
  [ -z "$(git -C "$root" status --porcelain -- crates/sweet-search-native/src crates/sweet-search-cli/src)" ] || { echo "[$name] crates have uncommitted changes in $root — refusing"; exit 2; }
  stamp="$FR_STATE/native-$name.json"
  local addon="$root/crates/sweet-search-native/sweet-search-native.darwin-arm64.node"
  local cli="$root/crates/sweet-search-cli/target/release/sweet-search"
  if [ -f "$stamp" ] && [ -f "$addon" ] && [ -f "$cli" ] && node -e '
      const s=require(process.argv[1]); process.exit(s.nativeTree===process.argv[2] && s.cliTree===process.argv[3] ? 0 : 1)' "$stamp" "$ntree" "$ctree"; then
    echo "[$name] native parts current (native tree ${ntree:0:8}, cli tree ${ctree:0:8})"
  else
    echo "[$name] building native addon (tree ${ntree:0:8}) in $root"
    # Separate target dir per checkout: no cross-checkout artifact reuse, and the main checkout's target is never touched.
    ( cd "$root/crates/sweet-search-native" && CARGO_TARGET_DIR="$FR_STATE/cargo/native-$name" nice -n 10 npx napi build --release --platform --features coreml,accelerate )
    echo "[$name] building native ss-* client (tree ${ctree:0:8})"
    ( cd "$root/crates/sweet-search-cli" && nice -n 10 cargo build --release )
    node -e '
      const [f, n, c, a, b] = process.argv.slice(1); const crypto = require("crypto"), fs = require("fs");
      const h = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
      fs.writeFileSync(f, JSON.stringify({ nativeTree: n, cliTree: c, addonSha256: h(a), cliSha256: h(b), builtAt: new Date().toISOString() }, null, 1) + "\n");
    ' "$stamp" "$ntree" "$ctree" "$addon" "$cli"
  fi
  # Verify what the checkout will actually load.
  ( cd "$root" && node --input-type=module -e '
    import { loadNativeAddon, resolveNativeBinary, nativeBinarySupportsAgentTools } from "./core/infrastructure/native-resolver.js";
    import fs from "node:fs";
    const root = process.cwd(), errs = [];
    const a = loadNativeAddon();
    if (!a || fs.realpathSync(a.path) !== fs.realpathSync(root + "/crates/sweet-search-native/sweet-search-native.darwin-arm64.node")) errs.push(`addon resolves to ${a?.path}`);
    if (typeof a?.mod?.NativeEmbeddingModel?.load !== "function") errs.push("addon has no NativeEmbeddingModel (no Metal/CoreML inference)");
    const b = resolveNativeBinary();
    if (!b || fs.realpathSync(b) !== fs.realpathSync(root + "/crates/sweet-search-cli/target/release/sweet-search")) errs.push(`client resolves to ${b}`);
    if (b && !nativeBinarySupportsAgentTools(b)) errs.push("client has no agent tools");
    if (errs.length) { console.error("  VERIFY FAIL: " + errs.join("; ")); process.exit(1); }
    console.log(`  addon  ${a.path}\n  client ${b}`);
  ' )
}
case "$WHICH" in
  final) build_one final "$FINAL_ROOT" ;;
  before) build_one before "$BEFORE_ROOT" ;;
  both) build_one final "$FINAL_ROOT"; build_one before "$BEFORE_ROOT" ;;
  *) echo "usage: prepare-native.sh [final|before|both]"; exit 2 ;;
esac
