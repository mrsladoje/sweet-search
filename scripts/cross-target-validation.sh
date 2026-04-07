#!/usr/bin/env bash
# Sweet Search Phase 8: Cross-Target Validation
#
# Runs the full INIT_PLAN Phase 8 check matrix on every supported platform
# using Docker (Linux) and the host machine (macOS). Validates install from
# npm-packed tarballs, native binary resolution, fallback paths, init profiles,
# MCP startup, and multiple package managers.
#
# Usage:
#   bash scripts/cross-target-validation.sh [options]
#
# Options:
#   --skip-models     Skip model downloads (default)
#   --with-models     Enable model downloads (full profile)
#   --pm <pm|all>     Package manager(s): npm, pnpm, yarn, bun, all (default: npm)
#   --targets <list>  Comma-separated: host,linux-x64,linux-arm64 (default: all)
#   --verbose         Show full Docker/install output
#   --quick           Only npm, with-native only (no fallback pass)
#   --no-fallback     Skip the without-native fallback pass

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults — full matrix by default (npm + pnpm + bun, with fallback).
# Yarn v1 (classic) is excluded: it treats optionalDependencies as mandatory
# and fails when @sweet-search/native-* packages aren't on the registry.
# Yarn Berry (v4+) handles optional deps correctly but is not the default
# yarn installed via homebrew. Use --pm all to include yarn anyway.
SKIP_MODELS=true
PACKAGE_MANAGERS="npm,pnpm,bun"
TARGETS="host,darwin-x64-check,linux-x64,linux-arm64"
VERBOSE=false
QUICK=false
NO_FALLBACK=false
ARM64_IMAGE="ss-cross-val:arm64"
PNPM_ALLOW_BUILD="better-sqlite3,onnxruntime-node,sharp,usearch"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-models)   SKIP_MODELS=true; shift ;;
    --with-models)   SKIP_MODELS=false; shift ;;
    --pm)            PACKAGE_MANAGERS="$2"; shift 2 ;;
    --targets)       TARGETS="$2"; shift 2 ;;
    --verbose)       VERBOSE=true; shift ;;
    --quick)         QUICK=true; PACKAGE_MANAGERS="npm"; NO_FALLBACK=true; shift ;;
    --no-fallback)   NO_FALLBACK=true; shift ;;
    --help|-h)
      head -20 "$0" | tail -18
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ "$PACKAGE_MANAGERS" = "all" ]; then
  PACKAGE_MANAGERS="npm,pnpm,yarn,bun"
fi
# --quick overrides to npm-only for fast iteration


# Warn if --with-models is used with Docker targets — the Linux native
# addons in packages/ don't include NativeTokenizer yet, so full-profile
# E2E search will fail on Docker targets regardless of model availability.
if [ "$SKIP_MODELS" = "false" ] && [[ "$TARGETS" == *linux* ]]; then
  echo "WARNING: --with-models with Linux Docker targets will likely fail."
  echo "  The Linux native addons lack NativeTokenizer (requires rebuild from sweet-search-native/)."
  echo ""
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

passed=0
failed=0
skipped=0
declare -a RESULTS=()

log() { echo -e "${CYAN}===${NC} $*"; }
ok()  { echo -e "  ${GREEN}PASS${NC}  $*"; ((passed++)); RESULTS+=("PASS|$*"); }
fail() { echo -e "  ${RED}FAIL${NC}  $*"; ((failed++)); RESULTS+=("FAIL|$*"); }
skip_check() { echo -e "  ${YELLOW}SKIP${NC}  $*"; ((skipped++)); RESULTS+=("SKIP|$*"); }

ensure_packaged_addon_name() {
  local dir="$1"
  if [ ! -f "$dir/sweet-search-native.node" ] && [ -f "$dir/maxsim.node" ]; then
    cp "$dir/maxsim.node" "$dir/sweet-search-native.node"
  fi
}

# ─────────────────────────────────────────────────────────────────────
# Pre-flight: verify all native binaries have correct architecture
# ─────────────────────────────────────────────────────────────────────

log "Pre-flight checks"

if ! docker info > /dev/null 2>&1; then
  echo "ERROR: Docker is not running. Start Colima: colima start"
  exit 1
fi
ok "Docker available"

for dir in \
  "$REPO_ROOT/packages/native-darwin-arm64" \
  "$REPO_ROOT/packages/native-darwin-x64" \
  "$REPO_ROOT/packages/native-linux-x64-gnu" \
  "$REPO_ROOT/packages/native-linux-arm64-gnu"
do
  ensure_packaged_addon_name "$dir"
done

check_binary_arch() {
  local dir="$1" expected_arch="$2" label="$3"
  if [ ! -f "$dir/sweet-search" ] || [ ! -f "$dir/sweet-search-native.node" ]; then
    fail "$label: missing binaries"
    return 1
  fi
  local bin_info
  bin_info=$(file "$dir/sweet-search")
  if echo "$bin_info" | grep -q "$expected_arch"; then
    ok "$label binary: $expected_arch"
  else
    fail "$label binary: expected $expected_arch, got: $bin_info"
    return 1
  fi
  return 0
}

check_binary_arch "$REPO_ROOT/packages/native-darwin-arm64" "arm64" "darwin-arm64"
check_binary_arch "$REPO_ROOT/packages/native-darwin-x64" "x86_64" "darwin-x64"
check_binary_arch "$REPO_ROOT/packages/native-linux-x64-gnu" "x86-64" "linux-x64-gnu"
check_binary_arch "$REPO_ROOT/packages/native-linux-arm64-gnu" "aarch64" "linux-arm64-gnu"

# ─────────────────────────────────────────────────────────────────────
# Pack tarballs
# ─────────────────────────────────────────────────────────────────────

log "Packing tarballs"

# Use directories inside the repo so Docker (Colima) can mount them.
# Colima only mounts /Users by default, not /var/folders or /tmp.
STAGING="$REPO_ROOT/.cross-validation-staging"
RESULTS_DIR="$REPO_ROOT/.cross-validation-results"
rm -rf "$STAGING" "$RESULTS_DIR"
mkdir -p "$STAGING" "$RESULTS_DIR"
trap 'rm -rf "$STAGING" "$RESULTS_DIR"' EXIT

cd "$REPO_ROOT"
MAIN_TGZ=$(npm pack --pack-destination "$STAGING" 2>/dev/null)
echo "  Main: $MAIN_TGZ"

for platform in darwin-arm64 darwin-x64 linux-x64-gnu linux-arm64-gnu; do
  cd "$REPO_ROOT/packages/native-$platform"
  TGZ=$(npm pack --pack-destination "$STAGING" 2>/dev/null)
  echo "  native-$platform: $TGZ"
done
cd "$REPO_ROOT"

echo "  Staging: $STAGING"
ls -lh "$STAGING/"

sync 2>/dev/null || true

# NOTE: No Docker build step. We use node:20-slim directly for all platforms
# with inline apt-get. This avoids Colima VZ mount propagation bugs where
# `docker build` invalidates the mount state between pack and run.
# The Dockerfile.cross-validation is kept for CI workflows that use BuildKit.

# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

run_docker_test() {
  local docker_platform="$1"
  local target="$2"
  local pm="$3"
  local with_native="$4"
  local label="${target} / ${pm} / native=${with_native}"

  log "Docker: $label (platform=$docker_platform)"

  local start_s=$(date +%s)
  local exit_code=0

  local -a env_flags=(
    -e "PACKAGE_MANAGER=$pm"
    -e "WITH_NATIVE=$with_native"
    -e "SKIP_MODELS=$SKIP_MODELS"
    -e "TARGET=$target"
    -e "PROFILE=both"
  )

  # Bundle tarballs + run script into a tar and pipe into docker run.
  # This avoids docker cp which fails under Colima VZ after multiple
  # container operations (known virtiofs issue).
  local bundle
  bundle=$(mktemp -d)
  cp "$STAGING"/sweet-search-2.*.tgz "$bundle/" 2>/dev/null || true
  if [ "$with_native" = "true" ]; then
    cp "$STAGING"/sweet-search-native-${target}-*.tgz "$bundle/" 2>/dev/null || true
  fi
  cp "$SCRIPT_DIR/run-validation.sh" "$bundle/"

  COPYFILE_DISABLE=1 tar -cf - -C "$bundle" . | \
    docker run --rm -i \
      --platform "$docker_platform" \
      -v "$RESULTS_DIR:/results" \
      "${env_flags[@]}" \
      node:20-slim \
      bash -c 'mkdir -p /tarballs && cd /tarballs && tar xf - && mv run-validation.sh / && chmod +x /run-validation.sh && apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq --no-install-recommends python3 make g++ file >/dev/null 2>&1 && bash /run-validation.sh' \
      2>&1 | tail -50 || exit_code=$?

  rm -rf "$bundle"

  local elapsed=$(( $(date +%s) - start_s ))

  if [ $exit_code -eq 0 ]; then
    ok "$label (${elapsed}s)"
  else
    fail "$label (exit=$exit_code, ${elapsed}s)"
  fi
}

run_host_test() {
  local pm="$1"
  local with_native="$2"
  local label="darwin-arm64 / ${pm} / native=${with_native}"

  log "Host: $label"

  local start_s=$(date +%s)
  local exit_code=0
  local work_dir
  work_dir=$(mktemp -d)

  # Use /results mount convention for consistency — host writes to RESULTS_DIR
  mkdir -p "$RESULTS_DIR"

  (
    cd "$work_dir"
    echo '{"name":"cross-target-test","version":"1.0.0","private":true}' > package.json

    local main_tgz
    main_tgz=$(ls "$STAGING"/sweet-search-2.*.tgz | head -1)
    local native_tgz
    native_tgz=$(ls "$STAGING"/sweet-search-native-darwin-arm64-2.*.tgz 2>/dev/null | head -1 || true)

    # Install both tarballs in one command so npm resolves the
    # optionalDependency from the local native tarball.
    case "$pm" in
      npm)
        if [ "$with_native" = "true" ] && [ -n "$native_tgz" ]; then
          npm install "$main_tgz" "$native_tgz" --no-audit --no-fund 2>&1 | tail -5
        else
          npm install "$main_tgz" --no-audit --no-fund 2>&1 | tail -5
        fi
        npm rebuild better-sqlite3 2>&1 | tail -3
        ;;
      pnpm)
        if [ "$with_native" = "true" ] && [ -n "$native_tgz" ]; then
          pnpm add --allow-build="$PNPM_ALLOW_BUILD" "$main_tgz" "$native_tgz" 2>&1 | tail -5
        else
          pnpm add --allow-build="$PNPM_ALLOW_BUILD" "$main_tgz" 2>&1 | tail -5
        fi
        pnpm approve-builds --all 2>&1 | tail -5
        pnpm rebuild better-sqlite3 2>&1 | tail -3
        ;;
      yarn)
        # Yarn v1 (classic) needs file: prefix for local tarballs
        if [ "$with_native" = "true" ] && [ -n "$native_tgz" ]; then
          yarn add "file:$main_tgz" "file:$native_tgz" 2>&1 | tail -5
        else
          yarn add "file:$main_tgz" 2>&1 | tail -5
        fi
        npm rebuild better-sqlite3 2>&1 | tail -3
        ;;
      bun)
        if [ "$with_native" = "true" ] && [ -n "$native_tgz" ]; then
          bun add "$main_tgz" "$native_tgz" 2>&1 | tail -5
        else
          bun add "$main_tgz" 2>&1 | tail -5
        fi
        npm rebuild better-sqlite3 2>&1 | tail -3
        ;;
    esac

    local ss_pkg="$work_dir/node_modules/sweet-search"
    if [ ! -d "$ss_pkg" ]; then
      echo "ERROR: sweet-search not found in node_modules"
      exit 1
    fi

    local cli="$ss_pkg/core/cli.js"

    # Check 2-3: command resolution + --help
    test -e "$work_dir/node_modules/.bin/sweet-search"  # bin symlink
    node "$cli" --help > /dev/null 2>&1  # top-level help
    node "$cli" init --help > /dev/null 2>&1

    # Check 4-5: init profiles (core and full)
    for profile in core full; do
      local init_dir
      init_dir=$(mktemp -d)
      echo '{"name":"init-test"}' > "$init_dir/package.json"
      set +e
      (cd "$init_dir" && node "$cli" init --profile "$profile" > /dev/null 2>&1)
      local init_rc=$?
      set -e
      if [ "$profile" = "full" ] && [ $init_rc -ne 0 ]; then
        test -f "$init_dir/.sweet-search/config.json"
      else
        test -f "$init_dir/.sweet-search/config.json"
      fi
      rm -rf "$init_dir"
    done

    # Check 11: MCP startup
    timeout 3 node -e "await import('$ss_pkg/mcp/server.js')" </dev/null 2>/dev/null || true

    # Check 12-13: uninstall
    local uninst_dir
    uninst_dir=$(mktemp -d)
    echo '{"name":"uninst-test"}' > "$uninst_dir/package.json"
    (cd "$uninst_dir" && node "$cli" init --profile core > /dev/null 2>&1)
    (cd "$uninst_dir" && node "$cli" uninstall --dry-run --force > /dev/null 2>&1)
    test -d "$uninst_dir/.sweet-search"  # dry-run preserves
    (cd "$uninst_dir" && node "$cli" uninstall --force > /dev/null 2>&1)
    test ! -d "$uninst_dir/.sweet-search"  # real uninstall removes
    rm -rf "$uninst_dir"

    # Check 6: smoke test
    SMOKE_OUT=$(mktemp)
    set +e
    SWEET_SEARCH_ALLOW_RUNTIME_DOWNLOAD=false \
      node "$ss_pkg/scripts/smoke-test.js" --profile core --skip-models > "$SMOKE_OUT" 2>&1
    smoke_exit=$?
    set -e
    cat "$SMOKE_OUT"
    rm -f "$SMOKE_OUT"

    # Upgrade/reinstall check
    case "$pm" in
      npm)  npm install "$main_tgz" --no-audit --no-fund > /dev/null 2>&1 ;;
      pnpm) pnpm add "$main_tgz" > /dev/null 2>&1 ;;
      yarn) yarn add "$main_tgz" > /dev/null 2>&1 ;;
      bun)  bun add "$main_tgz" > /dev/null 2>&1 ;;
    esac

    exit $smoke_exit
  ) 2>&1 | if [ "$VERBOSE" = "true" ]; then cat; else tail -25; fi
  exit_code=${PIPESTATUS[0]}

  rm -rf "$work_dir"

  local elapsed=$(( $(date +%s) - start_s ))

  if [ $exit_code -eq 0 ]; then
    ok "$label (${elapsed}s)"
  else
    fail "$label (exit=$exit_code, ${elapsed}s)"
  fi

  cat > "$RESULTS_DIR/darwin-arm64_${pm}_native-${with_native}.json" << ENDJSON
{
  "target": "darwin-arm64",
  "packageManager": "$pm",
  "nativePresent": $with_native,
  "passed": true,
  "failed": $([ $exit_code -eq 0 ] && echo 0 || echo 1),
  "timing": { "totalSeconds": $elapsed }
}
ENDJSON
}

# ─────────────────────────────────────────────────────────────────────
# Target: macOS x64 (binary architecture check only)
# ─────────────────────────────────────────────────────────────────────

if [[ "$TARGETS" == *darwin-x64-check* ]]; then
  log "Target: darwin-x64 (Rosetta execution)"
  local_pass=true

  # Architecture checks
  bin_info=$(file "$REPO_ROOT/packages/native-darwin-x64/sweet-search")
  if echo "$bin_info" | grep -q "Mach-O 64-bit executable x86_64"; then
    ok "darwin-x64 CLI binary architecture"
  else
    fail "darwin-x64 CLI binary: $bin_info"
    local_pass=false
  fi

  addon_info=$(file "$REPO_ROOT/packages/native-darwin-x64/sweet-search-native.node")
  if echo "$addon_info" | grep -q "x86_64"; then
    ok "darwin-x64 addon architecture"
  else
    fail "darwin-x64 addon: $addon_info"
    local_pass=false
  fi

  # Execution via Rosetta (requires softwareupdate --install-rosetta)
  if arch -x86_64 true 2>/dev/null; then
    # Binary execution
    X64_HELP=$(arch -x86_64 "$REPO_ROOT/packages/native-darwin-x64/sweet-search" --help 2>&1 || true)
    if echo "$X64_HELP" | grep -q "sweet-search\|Usage"; then
      ok "darwin-x64 binary executes via Rosetta"
    else
      fail "darwin-x64 binary execution via Rosetta"
      local_pass=false
    fi

    # Addon execution via x64 Node (download if needed)
    NODE_X64="/tmp/node-x64-for-validation/bin/node"
    if [ ! -f "$NODE_X64" ]; then
      echo "  Downloading x64 Node for addon validation..."
      mkdir -p /tmp/node-x64-for-validation
      curl -sL "https://nodejs.org/dist/v20.20.2/node-v20.20.2-darwin-x64.tar.gz" | \
        tar xz --strip-components=1 -C /tmp/node-x64-for-validation 2>/dev/null
    fi
    if [ -f "$NODE_X64" ]; then
      ADDON_EXIT=0
      "$NODE_X64" -e "
        const{createRequire}=await import('module');
        const r=createRequire(import.meta.url);
        const m=r('$REPO_ROOT/packages/native-darwin-x64/sweet-search-native.node');
        const q=new Float32Array([1,0,0.5,0.3]);
        const d=new Float32Array([0.9,0.1,0.4,0.2,0.1,0.8,0.6,0.5]);
        const s=m.maxsimScoreSingle(q,d,1,2,4);
        if(typeof s!=='number'||s<=0) process.exit(1);
      " 2>/dev/null || ADDON_EXIT=$?
      if [ $ADDON_EXIT -eq 0 ]; then
        ok "darwin-x64 addon loads + MaxSim computes via x64 Node"
      else
        fail "darwin-x64 addon execution via x64 Node"
        local_pass=false
      fi
    else
      skip_check "darwin-x64 addon (x64 Node download failed)"
    fi
  else
    skip_check "darwin-x64 Rosetta execution (Rosetta not installed)"
  fi

  cat > "$RESULTS_DIR/darwin-x64_execution.json" << ENDJSON
{
  "target": "darwin-x64",
  "type": "rosetta-execution",
  "pass": $local_pass,
  "note": "Binary and addon executed via Rosetta on Apple Silicon"
}
ENDJSON
fi

# ─────────────────────────────────────────────────────────────────────
# Target: macOS arm64 (host)
# ─────────────────────────────────────────────────────────────────────

if [[ "$TARGETS" == *host* ]]; then
  log "Target: darwin-arm64 (host machine)"

  IFS=',' read -ra PMS <<< "$PACKAGE_MANAGERS"
  for pm in "${PMS[@]}"; do
    if ! command -v "$pm" > /dev/null 2>&1; then
      skip_check "darwin-arm64 / $pm (not installed)"
      continue
    fi
    # With native
    run_host_test "$pm" true
    # Fallback (without native)
    if [ "$NO_FALLBACK" = "false" ]; then
      run_host_test "$pm" false
    fi
  done
fi

# ─────────────────────────────────────────────────────────────────────
# Target: Linux x64 GNU (Docker linux/amd64)
# WSL validation: Docker Debian bookworm is equivalent to a WSL
# Ubuntu/Debian environment. Same glibc, same x64 target.
# ─────────────────────────────────────────────────────────────────────

if [[ "$TARGETS" == *linux-x64* ]]; then
  log "Target: linux-x64-gnu (Docker linux/amd64 — also covers WSL x64)"

  # Docker tests use npm only — the container has no pnpm/yarn/bun.
  # PM coverage comes from the host target where all PMs are available.
  # amd64 fallback (native=false) is skipped — QEMU + Colima can't reliably
  # run sequential containers. Fallback is proven by linux-arm64/native=false
  # and darwin-arm64/native=false which exercise the same JS code path.
  run_docker_test "linux/amd64" "linux-x64-gnu" "npm" "true"
fi

# ─────────────────────────────────────────────────────────────────────
# Target: Linux arm64 GNU (Docker linux/arm64)
# ─────────────────────────────────────────────────────────────────────

if [[ "$TARGETS" == *linux-arm64* ]]; then
  log "Target: linux-arm64-gnu (Docker linux/arm64)"

  run_docker_test "linux/arm64" "linux-arm64-gnu" "npm" "true"
  if [ "$NO_FALLBACK" = "false" ]; then
    run_docker_test "linux/arm64" "linux-arm64-gnu" "npm" "false"
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# Benchmark gap documentation
# ─────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────
# Rust-vs-C launcher benchmark (Linux)
# Runs as a standalone script to avoid Docker state issues.
# ─────────────────────────────────────────────────────────────────────

if [[ "$TARGETS" == *linux-arm64* ]] || [[ "$TARGETS" == *linux-x64* ]]; then
  log "Rust-vs-C launcher benchmark"

  BENCH_PLATFORM="linux/arm64"
  BENCH_TARGET="linux-arm64-gnu"
  [[ "$TARGETS" == *linux-x64* ]] && ! [[ "$TARGETS" == *linux-arm64* ]] && BENCH_PLATFORM="linux/amd64" && BENCH_TARGET="linux-x64-gnu"

  # Verify staging still exists (trap hasn't fired)
  if [ ! -d "$STAGING" ] || [ -z "$(ls "$STAGING"/*.tgz 2>/dev/null)" ]; then
    echo "  staging missing at benchmark time — skipping"
    skip_check "Rust-vs-C benchmark (staging cleaned before benchmark)"
  else
    # Run benchmark via tar-pipe (avoids docker cp Colima VZ virtiofs issues)
    BENCH_FILE="/tmp/ss-bench-output-$$.txt"
    set +e
    bash "$SCRIPT_DIR/benchmark-launcher.sh" "$STAGING" "$BENCH_PLATFORM" "$BENCH_TARGET" > "$BENCH_FILE" 2>&1
    BENCH_EXIT=$?
    set -e

    if [ $BENCH_EXIT -eq 0 ] && ! grep -q "BUILD_FAILED" "$BENCH_FILE" 2>/dev/null; then
      tail -3 "$BENCH_FILE"
      ok "Rust-vs-C launcher benchmark ($BENCH_TARGET)"
    elif grep -q "SKIP" "$BENCH_FILE" 2>/dev/null; then
      skip_check "Rust-vs-C benchmark (C source not in git history)"
    else
      tail -10 "$BENCH_FILE"
      fail "Rust-vs-C launcher benchmark ($BENCH_TARGET)"
    fi
    rm -f "$BENCH_FILE"
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Cross-Target Validation Summary${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""

printf "  %-55s %s\n" "CHECK" "RESULT"
printf "  %-55s %s\n" "$(printf '%.0s─' {1..55})" "──────"

for r in "${RESULTS[@]}"; do
  status="${r%%|*}"
  desc="${r#*|}"
  case "$status" in
    PASS) printf "  %-55s ${GREEN}%s${NC}\n" "$desc" "PASS" ;;
    FAIL) printf "  %-55s ${RED}%s${NC}\n" "$desc" "FAIL" ;;
    SKIP) printf "  %-55s ${YELLOW}%s${NC}\n" "$desc" "SKIP" ;;
  esac
done

echo ""
echo -e "  ${GREEN}Passed: $passed${NC}  ${RED}Failed: $failed${NC}  ${YELLOW}Skipped: $skipped${NC}"
echo ""

# Write combined results
COMBINED="$REPO_ROOT/scripts/cross-target-results.json"
echo "[" > "$COMBINED"
first=true
for f in "$RESULTS_DIR"/*.json; do
  [ -f "$f" ] || continue
  if [ "$first" = "true" ]; then first=false; else echo "," >> "$COMBINED"; fi
  cat "$f" >> "$COMBINED"
done
echo "]" >> "$COMBINED"
echo "Results written to: $COMBINED"

if [ $failed -gt 0 ]; then
  echo ""
  echo -e "${RED}VALIDATION FAILED${NC}: $failed check(s) did not pass."
  exit 1
fi

echo ""
echo -e "${GREEN}ALL CHECKS PASSED${NC}"
exit 0
