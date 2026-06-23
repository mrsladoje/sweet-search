/* eslint-disable */
// Loader for @sweet-search/mem-pressure napi addon (SCAFFOLD).
//
// macOS-only optional addon for DISPATCH_SOURCE_TYPE_MEMORYPRESSURE callbacks
// (research §4.D D.4). Currently a no-op scaffold: even when the binary is
// present, `startMemoryPressureMonitor()` returns false, so G7's pure-JS RSS
// poller (core/indexing/rss-budget.mjs) stays the active macOS path.
//
// Resolves a locally-built `.node` first, otherwise the per-platform
// optionalDependency. If neither is present this throws on require — callers
// catch that and keep the JS RSS poller.

const { existsSync } = require('fs');
const { join } = require('path');

const { platform, arch } = process;

function tryLoad(localName, pkgName) {
  const local = join(__dirname, localName);
  if (existsSync(local)) return require(local);
  return require(pkgName);
}

let binding = null;

if (platform === 'darwin' && arch === 'arm64') {
  binding = tryLoad(
    'sweet-search-mem-pressure.darwin-arm64.node',
    '@sweet-search/mem-pressure-darwin-arm64',
  );
} else if (platform === 'darwin' && arch === 'x64') {
  binding = tryLoad(
    'sweet-search-mem-pressure.darwin-x64.node',
    '@sweet-search/mem-pressure-darwin-x64',
  );
} else {
  // No native memory-pressure source off macOS — Linux uses /proc/pressure/memory
  // (pure JS, G7). Signal unavailability the same way a missing binary would.
  throw new Error(`mem-pressure addon not available on ${platform}/${arch}`);
}

module.exports.startMemoryPressureMonitor = binding.startMemoryPressureMonitor;
module.exports.isSupported = binding.isSupported;
