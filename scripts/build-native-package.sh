#!/bin/bash
# Build native artifacts and copy into the matching packages/native-* directory.
# Usage: ./scripts/build-native-package.sh
#
# Detects the current platform and populates the correct package template.
# Built binaries are gitignored — generated locally for testing, populated by CI for publish.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Detect platform
case "$(uname -s)" in
  Darwin) PLATFORM="darwin" ;;
  Linux)  PLATFORM="linux" ;;
  *)      echo "Unsupported OS: $(uname -s)"; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64)        ARCH="x64" ;;
  *)             echo "Unsupported arch: $(uname -m)"; exit 1 ;;
esac

LIBC=""
if [ "$PLATFORM" = "linux" ]; then
  LIBC="-gnu"
fi

PKG_DIR="$REPO_ROOT/packages/native-${PLATFORM}-${ARCH}${LIBC}"

if [ ! -d "$PKG_DIR" ]; then
  echo "Error: Package directory not found: $PKG_DIR"
  exit 1
fi

echo "=== Building for ${PLATFORM}-${ARCH}${LIBC} ==="

# Build MaxSim + NativeTokenizer addon
echo "Building MaxSim addon..."
cd "$REPO_ROOT/crates/sweet-search-native"

# Per-platform feature gating:
#   darwin-arm64: coreml + metal + accelerate (full Apple Silicon GPU + ANE path)
#   darwin-x64:   accelerate (no Metal/ANE on Intel Macs in this build)
#   linux-*:      no extras (CPU-only candle for now; CUDA not yet packaged)
NAPI_FEATURES=""
if [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "arm64" ]; then
  NAPI_FEATURES="--features coreml,accelerate"
elif [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "x64" ]; then
  NAPI_FEATURES="--features accelerate"
fi

if [ -n "$NAPI_FEATURES" ]; then
  npx @napi-rs/cli build --release --platform $NAPI_FEATURES
else
  npx @napi-rs/cli build --release --platform
fi
ADDON_NAME="sweet-search-native.${PLATFORM}-${ARCH}.node"
if [ ! -f "$ADDON_NAME" ]; then
  echo "Error: Expected $ADDON_NAME not found after build"
  exit 1
fi
cp "$ADDON_NAME" "$PKG_DIR/sweet-search-native.node"
echo "  Copied $ADDON_NAME → $PKG_DIR/sweet-search-native.node"

# Build CLI binary
echo "Building CLI binary..."
cd "$REPO_ROOT/crates/sweet-search-cli"
cargo build --release
CLI_BIN="target/release/sweet-search"
if [ ! -f "$CLI_BIN" ]; then
  echo "Error: Expected $CLI_BIN not found after build"
  exit 1
fi
cp "$CLI_BIN" "$PKG_DIR/sweet-search"
echo "  Copied $CLI_BIN → $PKG_DIR/sweet-search"

echo ""
echo "=== Package populated: $PKG_DIR ==="
ls -lh "$PKG_DIR/"
