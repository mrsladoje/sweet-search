/* eslint-disable */
// Loader for @sweet-search/bg-priority napi addon.
//
// Resolves the per-platform prebuilt binary: a locally-built `.node` (dev /
// `npm run build:bg-priority`) takes precedence, otherwise the matching
// per-platform optionalDependency package. If neither is present this module
// throws on require — which is exactly what os-priority.mjs's
// `loadNativePriorityAddon()` catches to fall back to the spawn-based levers.
//
// napi-rs (v3) emits the cdylib `.node` but not always this JS shim, so it is
// committed alongside the crate sources.

const { existsSync } = require('fs');
const { join } = require('path');

const { platform, arch } = process;

function localBinary(name) {
  return join(__dirname, name);
}

function tryLoad(localName, pkgName) {
  const local = localBinary(localName);
  if (existsSync(local)) return require(local);
  return require(pkgName);
}

let binding = null;

switch (platform) {
  case 'darwin':
    if (arch === 'arm64') {
      binding = tryLoad(
        'sweet-search-bg-priority.darwin-arm64.node',
        '@sweet-search/bg-priority-darwin-arm64',
      );
    } else if (arch === 'x64') {
      binding = tryLoad(
        'sweet-search-bg-priority.darwin-x64.node',
        '@sweet-search/bg-priority-darwin-x64',
      );
    } else {
      throw new Error(`Unsupported macOS arch for bg-priority: ${arch}`);
    }
    break;
  case 'win32':
    if (arch === 'x64') {
      binding = tryLoad(
        'sweet-search-bg-priority.win32-x64-msvc.node',
        '@sweet-search/bg-priority-win32-x64-msvc',
      );
    } else if (arch === 'arm64') {
      binding = tryLoad(
        'sweet-search-bg-priority.win32-arm64-msvc.node',
        '@sweet-search/bg-priority-win32-arm64-msvc',
      );
    } else {
      throw new Error(`Unsupported Windows arch for bg-priority: ${arch}`);
    }
    break;
  case 'linux':
    if (arch === 'x64') {
      binding = tryLoad(
        'sweet-search-bg-priority.linux-x64-gnu.node',
        '@sweet-search/bg-priority-linux-x64-gnu',
      );
    } else if (arch === 'arm64') {
      binding = tryLoad(
        'sweet-search-bg-priority.linux-arm64-gnu.node',
        '@sweet-search/bg-priority-linux-arm64-gnu',
      );
    } else {
      throw new Error(`Unsupported Linux arch for bg-priority: ${arch}`);
    }
    break;
  default:
    throw new Error(`Unsupported platform for bg-priority: ${platform}`);
}

module.exports.setBackgroundMode = binding.setBackgroundMode;
