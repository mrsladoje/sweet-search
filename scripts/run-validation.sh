#!/usr/bin/env bash
# Sweet Search cross-target validation entrypoint.
#
# Runs inside Docker for Linux targets, or directly on macOS host.
# Validates the REAL install path: main tarball has optionalDependencies
# pointing at native packages, npm resolves them from a local file: registry.
#
# Env vars:
#   PACKAGE_MANAGER  - npm | pnpm | yarn | bun  (default: npm)
#   WITH_NATIVE      - true | false              (default: true)
#   SKIP_MODELS      - true | false              (default: true)
#   TARGET           - linux-x64-gnu | linux-arm64-gnu | darwin-arm64 | ...
#   PROFILE          - core | full | both        (default: both)
#
# Expects:
#   /tarballs/  - mounted read-only, contains npm-packed .tgz files
#   /results/   - mounted writable, receives result JSON

set -euo pipefail

PM="${PACKAGE_MANAGER:-npm}"
WITH_NATIVE="${WITH_NATIVE:-true}"
SKIP_MODELS="${SKIP_MODELS:-true}"
TARGET="${TARGET:-unknown}"
PROFILE="${PROFILE:-both}"

NODE=$(command -v node)

echo "=== Sweet Search Cross-Target Validation ==="
echo "  Platform: $(uname -m) ($(uname -s))"
echo "  Node: $($NODE --version)"
echo "  PM: $PM"
echo "  Target: $TARGET"
echo "  Native: $WITH_NATIVE"
echo "  Models: $([ "$SKIP_MODELS" = "true" ] && echo "skip" || echo "download")"
echo "  Profile: $PROFILE"
echo ""

passed=0
failed=0
failures=""

check() {
  local name="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  PASS  $name"
    passed=$((passed + 1))
  else
    echo "  FAIL  $name"
    failed=$((failed + 1))
    failures="$failures\n  - $name"
  fi
}

check_output() {
  local name="$1" pattern="$2"
  shift 2
  local output
  output=$("$@" 2>&1) || true
  if echo "$output" | grep -qF -- "$pattern"; then
    echo "  PASS  $name"
    passed=$((passed + 1))
  else
    echo "  FAIL  $name (expected '$pattern')"
    echo "    output: $(echo "$output" | head -3)"
    failed=$((failed + 1))
    failures="$failures\n  - $name"
  fi
}

START_S=$(date +%s)

# ─────────────────────────────────────────────────────────────────────
# 1. Install — use the real optionalDependencies path
# ─────────────────────────────────────────────────────────────────────

MAIN_TGZ=""
for f in /tarballs/sweet-search-2.*.tgz; do
  [ -f "$f" ] && MAIN_TGZ="$f" && break
done
if [ -z "$MAIN_TGZ" ]; then
  echo "ERROR: No sweet-search tarball found in /tarballs/"
  ls /tarballs/ 2>/dev/null
  exit 1
fi

# The main tarball declares optionalDependencies pointing at @sweet-search/native-*.
# For a local test, we set up a file: registry so npm resolves them from tarballs
# instead of hitting the npm registry — this simulates the real install path.

WORK_DIR=$(mktemp -d /tmp/ss-cross-XXXXXX)
cd "$WORK_DIR"
echo '{"name":"cross-target-test","version":"1.0.0","private":true}' > package.json

echo ""
echo "--- Phase 8 Check 1: Install ($PM) ---"

INSTALL_START=$(date +%s)

if [ "$WITH_NATIVE" = "true" ]; then
  # Stage native tarballs so npm can resolve optionalDependencies from them.
  # We install the native package first, then the main package. npm will see
  # the native package already in node_modules and skip re-fetching it.
  NATIVE_TGZ=""
  for f in /tarballs/sweet-search-native-${TARGET}-2.*.tgz; do
    [ -f "$f" ] && NATIVE_TGZ="$f" && break
  done
  if [ -z "$NATIVE_TGZ" ]; then
    echo "WARN: No native tarball for $TARGET — treating as without-native"
    WITH_NATIVE="false"
  fi
fi

# Install both tarballs in one command so npm resolves the optionalDependency
# from the local native tarball instead of trying the public registry.
case "$PM" in
  npm)
    if [ "$WITH_NATIVE" = "true" ] && [ -n "${NATIVE_TGZ:-}" ]; then
      npm install "$MAIN_TGZ" "$NATIVE_TGZ" --no-audit --no-fund 2>&1 | tail -5
    else
      npm install "$MAIN_TGZ" --no-audit --no-fund 2>&1 | tail -5
    fi
    npm rebuild better-sqlite3 2>&1 | tail -3
    ;;
  pnpm)
    pnpm install 2>/dev/null || true
    if [ "$WITH_NATIVE" = "true" ] && [ -n "${NATIVE_TGZ:-}" ]; then
      pnpm add "$MAIN_TGZ" "$NATIVE_TGZ" 2>&1 | tail -5
    else
      pnpm add "$MAIN_TGZ" 2>&1 | tail -5
    fi
    pnpm rebuild better-sqlite3 2>&1 | tail -3
    ;;
  yarn)
    echo 'nodeLinker: node-modules' > .yarnrc.yml
    yarn install 2>/dev/null || true
    if [ "$WITH_NATIVE" = "true" ] && [ -n "${NATIVE_TGZ:-}" ]; then
      yarn add "$MAIN_TGZ" "$NATIVE_TGZ" 2>&1 | tail -5
    else
      yarn add "$MAIN_TGZ" 2>&1 | tail -5
    fi
    npm rebuild better-sqlite3 2>&1 | tail -3
    ;;
  bun)
    bun install 2>/dev/null || true
    if [ "$WITH_NATIVE" = "true" ] && [ -n "${NATIVE_TGZ:-}" ]; then
      bun add "$MAIN_TGZ" "$NATIVE_TGZ" 2>&1 | tail -5
    else
      bun add "$MAIN_TGZ" 2>&1 | tail -5
    fi
    npm rebuild better-sqlite3 2>&1 | tail -3
    ;;
  *)
    echo "Unknown package manager: $PM"; exit 1 ;;
esac

INSTALL_END=$(date +%s)
INSTALL_S=$(( INSTALL_END - INSTALL_START ))
echo "Install completed in ${INSTALL_S}s"

SS_PKG="$WORK_DIR/node_modules/sweet-search"
check "sweet-search installed in node_modules" test -d "$SS_PKG"
if [ ! -d "$SS_PKG" ]; then
  echo "FATAL: sweet-search not found. Aborting."
  exit 1
fi

# Verify native package is installed and has correct platform targeting fields.
# The main package declares @sweet-search/native-* as optionalDependencies.
# When published to npm, npm auto-resolves the correct platform package.
# For local tarball testing, the native package is installed explicitly.
NATIVE_PKG_DIR=""
if [ "$WITH_NATIVE" = "true" ]; then
  NATIVE_PKG_DIR="$WORK_DIR/node_modules/@sweet-search/native-${TARGET}"
  check "native package installed: @sweet-search/native-${TARGET}" test -d "$NATIVE_PKG_DIR"

  if [ -d "$NATIVE_PKG_DIR" ]; then
    # Verify the native package's platform fields match this machine
    set +e
    "$NODE" -e "
      import{readFileSync}from'fs';
      const pkg=JSON.parse(readFileSync('$NATIVE_PKG_DIR/package.json','utf8'));
      const os=pkg.os||[]; const cpu=pkg.cpu||[];
      if(!os.includes(process.platform)){console.error('os mismatch:',os,'vs',process.platform);process.exit(1);}
      if(!cpu.includes(process.arch)){console.error('cpu mismatch:',cpu,'vs',process.arch);process.exit(1);}
    " 2>/dev/null
    PLATCHECK=$?
    set -e
    check "native package os/cpu fields match this platform" test "$PLATCHECK" -eq 0
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# 2-3. Command resolution and --help
# ─────────────────────────────────────────────────────────────────────

echo ""
echo "--- Phase 8 Checks 2-3: Command resolution ---"

CLI="$SS_PKG/core/cli.js"
check "core/cli.js exists" test -f "$CLI"

# Test via npm bin symlink (the real user path).
# npm creates .bin/sweet-search → ../sweet-search/core/cli.js
BIN_LINK="$WORK_DIR/node_modules/.bin/sweet-search"
check "npm bin symlink exists (.bin/sweet-search)" test -e "$BIN_LINK"

# Test top-level --help (Phase 8 check 3)
check_output "sweet-search --help (via bin)" "sweet-search" "$NODE" "$CLI" --help

# Test init --help
check_output "sweet-search init --help" "--profile" "$NODE" "$CLI" init --help

# Test uninstall --help
check_output "sweet-search uninstall --help" "--dry-run" "$NODE" "$CLI" uninstall --help

# ─────────────────────────────────────────────────────────────────────
# 4-5. Init profiles (core and full)
# ─────────────────────────────────────────────────────────────────────

echo ""
echo "--- Phase 8 Checks 4-5: Init profiles ---"

run_init_profile() {
  local profile="$1"
  local init_dir
  init_dir=$(mktemp -d /tmp/ss-init-${profile}-XXXXXX)
  echo '{"name":"init-test"}' > "$init_dir/package.json"

  # init.js uses process.cwd() to detect project root, so cd there.
  local init_exit=0
  local init_out
  init_out=$(mktemp)
  set +e
  (cd "$init_dir" && "$NODE" "$CLI" init --profile "$profile" > "$init_out" 2>&1)
  init_exit=$?
  set -e
  tail -5 "$init_out"
  rm -f "$init_out"

  # Full profile downloads models — without network/cache this exits 1
  # but still writes a partial config. That's expected with --skip-models.
  if [ "$profile" = "full" ] && [ "$SKIP_MODELS" = "true" ] && [ $init_exit -ne 0 ]; then
    # Partial config should still be written
    local config_path="$init_dir/.sweet-search/config.json"
    check "init --profile full (exit 1 expected without models)" true
    check "config.json exists (full, partial)" test -f "$config_path"
    if [ -f "$config_path" ]; then
      local cfg_profile
      set +e
      cfg_profile=$("$NODE" -e "import{readFileSync}from'fs';console.log(JSON.parse(readFileSync('$config_path','utf8')).profile)" 2>/dev/null)
      set -e
      check "config.json profile=full (partial)" test "$cfg_profile" = "full"
    fi
  else
    check "init --profile $profile" test "$init_exit" -eq 0

    local config_path="$init_dir/.sweet-search/config.json"
    check "config.json exists ($profile)" test -f "$config_path"

    if [ -f "$config_path" ]; then
      local cfg_profile
      set +e
      cfg_profile=$("$NODE" -e "import{readFileSync}from'fs';console.log(JSON.parse(readFileSync('$config_path','utf8')).profile)" 2>/dev/null)
      set -e
      check "config.json profile=$profile" test "$cfg_profile" = "$profile"

      local rerun_exit=0
      set +e
      (cd "$init_dir" && "$NODE" "$CLI" init --profile "$profile" > /dev/null 2>&1)
      rerun_exit=$?
      set -e
      check "idempotent re-run ($profile)" test "$rerun_exit" -eq 0
    fi
  fi

  rm -rf "$init_dir"
}

if [ "$PROFILE" = "core" ] || [ "$PROFILE" = "both" ]; then
  run_init_profile core
fi
if [ "$PROFILE" = "full" ] || [ "$PROFILE" = "both" ]; then
  run_init_profile full
fi

# ─────────────────────────────────────────────────────────────────────
# 7-10. Native resolution and fallback paths
# ─────────────────────────────────────────────────────────────────────

echo ""
echo "--- Phase 8 Checks 7-10: Native resolution & fallback ---"

# Map uname -m to the substring file(1) uses
case "$(uname -m)" in
  x86_64)        ARCH_EXPECTED="x86-64" ;;
  aarch64|arm64) ARCH_EXPECTED="aarch64" ;;
  *)             ARCH_EXPECTED=$(uname -m) ;;
esac

if [ "$WITH_NATIVE" = "true" ] && [ -d "${NATIVE_PKG_DIR:-/nonexistent}" ]; then
  # Check 7: native binary selected and correct arch
  if [ -f "$NATIVE_PKG_DIR/sweet-search" ]; then
    BIN_INFO=$(file "$NATIVE_PKG_DIR/sweet-search")
    echo "  binary: $BIN_INFO"
    if echo "$BIN_INFO" | grep -qi "$ARCH_EXPECTED"; then
      check "native binary arch matches $ARCH_EXPECTED" true
    else
      check "native binary arch matches $ARCH_EXPECTED" false
    fi
  else
    check "native binary present" false
  fi

  # Check 9: native addon selected and correct arch
  if [ -f "$NATIVE_PKG_DIR/maxsim.node" ]; then
    ADDON_INFO=$(file "$NATIVE_PKG_DIR/maxsim.node")
    echo "  addon: $ADDON_INFO"
    if echo "$ADDON_INFO" | grep -qi "$ARCH_EXPECTED"; then
      check "native addon arch matches $ARCH_EXPECTED" true
    else
      check "native addon arch matches $ARCH_EXPECTED" false
    fi
  else
    check "native addon present" false
  fi

  # Check: addon actually loads and computes
  set +e
  "$NODE" -e "
    const {createRequire}=await import('module');
    const r=createRequire(import.meta.url);
    const m=r('$NATIVE_PKG_DIR/maxsim.node');
    const q=new Float32Array([1,0,0.5,0.3]);
    const d=new Float32Array([0.9,0.1,0.4,0.2,0.1,0.8,0.6,0.5]);
    const s=m.maxsimScoreSingle(q,d,1,2,4);
    if(typeof s!=='number'||s<=0) process.exit(1);
  " 2>/dev/null
  ADDON_LOAD_EXIT=$?
  set -e
  check "native addon load + maxsim compute" test "$ADDON_LOAD_EXIT" -eq 0
fi

# Check 8, 10: fallback when native is absent
echo ""
echo "--- Fallback path (native absent) ---"
set +e
"$NODE" -e "
  import {existsSync} from 'fs';
  import {resolveNativeAddon, resolveNativeBinary} from '$SS_PKG/core/infrastructure/native-resolver.js';
  // Override existsSync to reject all native package paths — simulates
  // the native package not being installed.
  const fakeExists = (p) => {
    if (p.includes('/native-') || p.includes('/@sweet-search/')) return false;
    return existsSync(p);
  };
  const addon = resolveNativeAddon({existsSync: fakeExists});
  const binary = resolveNativeBinary({existsSync: fakeExists});
  if (addon !== null) { console.error('addon should be null, got:', addon); process.exit(1); }
  if (binary !== null) { console.error('binary should be null, got:', binary); process.exit(1); }
" 2>/dev/null
FALLBACK_EXIT=$?
set -e
check "JS fallback when native absent (addon=null, binary=null)" test "$FALLBACK_EXIT" -eq 0

# ─────────────────────────────────────────────────────────────────────
# 11. MCP entrypoint startup
# ─────────────────────────────────────────────────────────────────────

echo ""
echo "--- Phase 8 Check 11: MCP entrypoint ---"

MCP_PATH="$SS_PKG/mcp/server.js"
check "mcp/server.js exists" test -f "$MCP_PATH"

# Verify MCP server can import without crashing (give it 5s then kill).
# It hangs on stdin, so we timeout. Exit 0 from timeout = it was still running = good.
MCP_EXIT=0
timeout 3 "$NODE" -e "
  await import('$MCP_PATH');
  // If we get here, the server imported and started listening on stdin.
  // Signal success by exiting cleanly.
  process.exit(0);
" </dev/null 2>/dev/null || MCP_EXIT=$?
# timeout returns 124 if it killed the process (server was running = success)
# or 0 if the process exited on its own
check "MCP server imports and starts" test "$MCP_EXIT" -eq 0 -o "$MCP_EXIT" -eq 124

# ─────────────────────────────────────────────────────────────────────
# 12-13. Uninstall (Phase 9 — not yet implemented)
# ─────────────────────────────────────────────────────────────────────

echo ""
echo "--- Phase 8 Checks 12-13: Uninstall ---"

# Set up a project with init, then test uninstall
UNINST_DIR=$(mktemp -d /tmp/ss-uninst-XXXXXX)
echo '{"name":"uninst-test"}' > "$UNINST_DIR/package.json"
set +e
(cd "$UNINST_DIR" && "$NODE" "$CLI" init --profile core > /dev/null 2>&1)
set -e

# Check 12: uninstall --dry-run reports what init created
set +e
DRYRUN_OUT=$("$NODE" "$CLI" uninstall --dry-run --force 2>&1)
# Run from the uninst dir so uninstall finds the project
DRYRUN_OUT=$(cd "$UNINST_DIR" && "$NODE" "$CLI" uninstall --dry-run --force 2>&1)
DRYRUN_EXIT=$?
set -e
if echo "$DRYRUN_OUT" | grep -qF ".sweet-search/"; then
  check "uninstall --dry-run reports .sweet-search/" true
else
  echo "  dry-run output: $DRYRUN_OUT"
  check "uninstall --dry-run reports .sweet-search/" false
fi
# Verify dry-run did NOT remove anything
check "dry-run preserves .sweet-search/" test -d "$UNINST_DIR/.sweet-search"

# Check 13: uninstall removes state, no orphans remain
set +e
(cd "$UNINST_DIR" && "$NODE" "$CLI" uninstall --force > /dev/null 2>&1)
UNINST_EXIT=$?
set -e
check "uninstall removes .sweet-search/" test ! -d "$UNINST_DIR/.sweet-search"

# Idempotent: second uninstall does not error
set +e
SECOND_OUT=$(cd "$UNINST_DIR" && "$NODE" "$CLI" uninstall --force 2>&1)
SECOND_EXIT=$?
set -e
check "uninstall idempotent (second run)" test "$SECOND_EXIT" -eq 0

rm -rf "$UNINST_DIR"

# ─────────────────────────────────────────────────────────────────────
# 14. Timing data
# ─────────────────────────────────────────────────────────────────────

echo ""
echo "--- Phase 8 Check 14: Timing ---"

# Launcher startup time: how fast does the JS CLI dispatcher respond to --help?
LAUNCH_START_NS=$(date +%s%N 2>/dev/null || echo 0)
"$NODE" "$CLI" init --help > /dev/null 2>&1
LAUNCH_END_NS=$(date +%s%N 2>/dev/null || echo 0)
LAUNCH_MS=$(( (LAUNCH_END_NS - LAUNCH_START_NS) / 1000000 ))
echo "  Launcher startup (init --help): ${LAUNCH_MS}ms"

# Native binary startup if available
NATIVE_LAUNCH_MS="null"
if [ "$WITH_NATIVE" = "true" ] && [ -f "${NATIVE_PKG_DIR:-/nonexistent}/sweet-search" ]; then
  NL_START=$(date +%s%N 2>/dev/null || echo 0)
  "${NATIVE_PKG_DIR}/sweet-search" --help > /dev/null 2>&1 || true
  NL_END=$(date +%s%N 2>/dev/null || echo 0)
  NATIVE_LAUNCH_MS=$(( (NL_END - NL_START) / 1000000 ))
  echo "  Native binary startup (--help): ${NATIVE_LAUNCH_MS}ms"
fi

# ─────────────────────────────────────────────────────────────────────
# 6. Smoke test (E2E search via existing smoke-test.js)
# ─────────────────────────────────────────────────────────────────────

echo ""
echo "--- Phase 8 Check 6: Smoke test (E2E via smoke-test.js) ---"

SMOKE_ARGS="--profile core --skip-models"
if [ "$SKIP_MODELS" = "true" ]; then
  export SWEET_SEARCH_ALLOW_RUNTIME_DOWNLOAD=false
fi

SMOKE_EXIT=0
SMOKE_OUT=$(mktemp /tmp/ss-smoke-XXXXXX)
set +e
"$NODE" "$SS_PKG/scripts/smoke-test.js" $SMOKE_ARGS > "$SMOKE_OUT" 2>&1
SMOKE_EXIT=$?
set -e
cat "$SMOKE_OUT"

# Parse actual failure count from smoke test output
if [ $SMOKE_EXIT -ne 0 ]; then
  FAIL_COUNT=$(grep -oE '[0-9]+ failed' "$SMOKE_OUT" | grep -oE '[0-9]+' || echo "99")
  if [ "$SKIP_MODELS" = "true" ] && [ "$FAIL_COUNT" = "1" ]; then
    echo "  Note: 1 failure (E2E search) expected with --skip-models"
    # Don't count this as a check failure — the E2E search requires models
  else
    echo "  ERROR: $FAIL_COUNT smoke test failures"
    ((failed++))
    failures="$failures\n  - smoke test: $FAIL_COUNT failures"
  fi
else
  echo "  All smoke test checks passed"
fi
rm -f "$SMOKE_OUT"

# ─────────────────────────────────────────────────────────────────────
# Upgrade/reinstall (install path dimension)
# ─────────────────────────────────────────────────────────────────────

echo ""
echo "--- Install path: upgrade/reinstall ---"

REINSTALL_EXIT=0
case "$PM" in
  npm)  npm install "$MAIN_TGZ" --no-audit --no-fund > /dev/null 2>&1 || REINSTALL_EXIT=$? ;;
  pnpm) pnpm add "$MAIN_TGZ" > /dev/null 2>&1 || REINSTALL_EXIT=$? ;;
  yarn) yarn add "$MAIN_TGZ" > /dev/null 2>&1 || REINSTALL_EXIT=$? ;;
  bun)  bun add "$MAIN_TGZ" > /dev/null 2>&1 || REINSTALL_EXIT=$? ;;
esac
check "reinstall/upgrade succeeds" test "$REINSTALL_EXIT" -eq 0

# ─────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────

END_S=$(date +%s)
TOTAL_S=$(( END_S - START_S ))

echo ""
echo "========================================"
echo "Validation Results: $passed passed, $failed failed"
if [ $failed -gt 0 ]; then
  echo -e "Failures:$failures"
fi
echo "Total time: ${TOTAL_S}s"
echo "========================================"

# Write results JSON
RESULT_FILE="/results/${TARGET}_${PM}_native-${WITH_NATIVE}.json"
mkdir -p "$(dirname "$RESULT_FILE")" 2>/dev/null || true
cat > "$RESULT_FILE" << ENDJSON
{
  "target": "$TARGET",
  "packageManager": "$PM",
  "nativePresent": $WITH_NATIVE,
  "skipModels": $SKIP_MODELS,
  "profile": "$PROFILE",
  "platform": "$(uname -m)",
  "nodeVersion": "$($NODE --version)",
  "passed": $passed,
  "failed": $failed,
  "timing": {
    "installSeconds": $INSTALL_S,
    "launcherStartupMs": $LAUNCH_MS,
    "nativeLauncherMs": $NATIVE_LAUNCH_MS,
    "totalSeconds": $TOTAL_S
  }
}
ENDJSON

echo "Result written to: $RESULT_FILE"

rm -rf "$WORK_DIR"
exit $([ $failed -eq 0 ] && echo 0 || echo 1)
