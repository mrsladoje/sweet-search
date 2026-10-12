/**
 * File-system probes answered once per ss-* call (callMemo in core/agent-tools/virtual-process.js).
 *
 * One ss-grep call asked the same questions many times: is the scope a file (4 times), where
 * is the project root really (6 realpaths), when was each matched file last changed (twice
 * per file). Inside a call each question now has one answer; outside a call (MCP, the human
 * CLI, the maintainer) every probe goes to the file system as before. Failures read as null
 * or false, as each caller already treated them.
 */

import fs from 'node:fs';
import { callMemo } from '../agent-tools/virtual-process.js';

/** fs.existsSync(p), once per call. */
export function callExistsSync(p) {
  return callMemo(`exists\0${p}`, () => fs.existsSync(p));
}

/** fs.statSync(p), once per call; null when it cannot be stat'ed. */
export function callStatSync(p) {
  return callMemo(`stat\0${p}`, () => {
    try { return fs.statSync(p, { throwIfNoEntry: false }) ?? null; } catch { return null; }
  });
}

/** fs.realpathSync.native(p), once per call; null when it cannot be resolved. */
export function callRealpathNative(p) {
  return callMemo(`realpath.native\0${p}`, () => {
    try { return fs.realpathSync.native(p); } catch { return null; }
  });
}

/** fs.realpathSync(p) (the JS resolver), once per call; null when it cannot be resolved. */
export function callRealpath(p) {
  return callMemo(`realpath\0${p}`, () => {
    try { return fs.realpathSync(p); } catch { return null; }
  });
}
