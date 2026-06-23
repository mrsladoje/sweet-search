/**
 * Smoke test for the optional native bg-priority addon
 * (native/bg-priority, research §4.A A.5/A.6).
 *
 * The addon is an OPTIONAL per-platform prebuilt; it may not be compiled in
 * every environment. These tests therefore SKIP when the locally-built `.node`
 * is absent, and only assert the load + call contract when it IS present:
 *   - the module exports `setBackgroundMode`,
 *   - `setBackgroundMode(true)` / `setBackgroundMode(false)` return a boolean
 *     and NEVER throw (it is a best-effort scheduling hint).
 *
 * When the addon is absent the functional behavior is fully covered by the JS
 * fallback exercised in os-priority.test.js (setNativeBackgroundMode → false).
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Locate a locally-built binary for the current platform/arch. We only smoke
// the darwin-arm64 / darwin-x64 / linux / win32 names the loader knows about.
const addonDir = join(__dirname, '../../native/bg-priority');
const candidates = [
  `sweet-search-bg-priority.${process.platform}-${process.arch}.node`,
  `sweet-search-bg-priority.${process.platform}-${process.arch}-gnu.node`,
  `sweet-search-bg-priority.${process.platform}-${process.arch}-msvc.node`,
];
const builtBinary = candidates
  .map((n) => join(addonDir, n))
  .find((p) => existsSync(p));

describe.skipIf(!builtBinary)('bg-priority native addon (when built)', () => {
  it('loads and exports setBackgroundMode', () => {
    const mod = require(builtBinary);
    expect(typeof mod.setBackgroundMode).toBe('function');
  });

  it('setBackgroundMode(true)/(false) return a boolean and never throw', () => {
    const mod = require(builtBinary);
    let onResult;
    let offResult;
    expect(() => {
      onResult = mod.setBackgroundMode(true);
      offResult = mod.setBackgroundMode(false);
    }).not.toThrow();
    expect(typeof onResult).toBe('boolean');
    expect(typeof offResult).toBe('boolean');
  });
});
