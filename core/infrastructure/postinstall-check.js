import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Mirrors crates/sweet-search-cli/src/main.rs INSTALL_NODE_FILE. */
export const INSTALL_NODE_FILE = '.install-node';

/**
 * npm 11+ can skip install scripts. The postinstall step writes <package>/.install-node,
 * so an installed package without it did not run postinstall. Null when the check does
 * not apply (development checkout, unsupported platform).
 */
export function detectSkippedPostinstall(packageRoot, platform = process.platform, exists = existsSync) {
  if (platform !== 'darwin' && platform !== 'linux') return null;
  if (!packageRoot.split(/[\\/]/).includes('node_modules')) return null;
  if (exists(join(packageRoot, INSTALL_NODE_FILE))) return null;
  const global = /[\\/]lib[\\/]node_modules[\\/]sweet-search$/.test(packageRoot);
  return {
    global,
    fix: `npm install ${global ? '-g ' : ''}sweet-search --allow-scripts=sweet-search,onnxruntime-node`,
  };
}
