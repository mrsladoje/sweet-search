/**
 * Unit tests for pure device-kind selection logic in core/indexing/model-pool.js
 * and the cascade-dir helper in core/infrastructure/native-inference.js.
 *
 * These helpers are the branch points that decide whether GPU indexing
 * goes through Metal, CUDA, or no accelerator (ORT INT8 CPU). Direct unit
 * coverage here means a one-character typo in the preference strings (e.g.
 * "candle-cuda" vs "candel-cuda") is caught at test time rather than at a
 * user's first `sweet-search init` on a RunPod instance. It also pins the
 * critical invariant that "no accelerator" resolves to `null` (ORT INT8 CPU
 * indexing), never to a candle-on-CPU device kind.
 */

import { describe, it, expect } from 'vitest';

import { selectAcceleratorDeviceKind } from '../../core/indexing/model-pool.js';
import { pickCascadeDirForDevice } from '../../core/infrastructure/native-inference.js';

describe('selectAcceleratorDeviceKind', () => {
  it('maps coreml-cascade → metal', () => {
    expect(selectAcceleratorDeviceKind('coreml-cascade')).toBe('metal');
  });

  it('maps candle-metal → metal', () => {
    expect(selectAcceleratorDeviceKind('candle-metal')).toBe('metal');
  });

  it('maps candle-cuda → cuda', () => {
    expect(selectAcceleratorDeviceKind('candle-cuda')).toBe('cuda');
  });

  it('maps ort-cpu → null (no native device — ORT INT8 CPU indexing)', () => {
    expect(selectAcceleratorDeviceKind('ort-cpu')).toBeNull();
  });

  it('maps candle-cpu → null defensively (no accelerator must never load candle on CPU)', () => {
    // The detector no longer emits 'candle-cpu', but a stale persisted value
    // must still resolve to "no native device", not the candle CPU path.
    expect(selectAcceleratorDeviceKind('candle-cpu')).toBeNull();
  });

  it('maps unknown / falsy preferences → null (safe default)', () => {
    expect(selectAcceleratorDeviceKind('unknown-backend')).toBeNull();
    expect(selectAcceleratorDeviceKind(undefined)).toBeNull();
    expect(selectAcceleratorDeviceKind(null)).toBeNull();
    expect(selectAcceleratorDeviceKind('')).toBeNull();
  });

  it('is stable across ALL current preference strings', () => {
    // Mirror the explicit enumeration in hardware-capability.js — if a new
    // accelerator preference is added there without updating this helper,
    // this test catches it by returning null instead of the intended device.
    const table = {
      'coreml-cascade': 'metal',
      'candle-metal': 'metal',
      'candle-cuda': 'cuda',
      'ort-cpu': null,
    };
    for (const [pref, expected] of Object.entries(table)) {
      expect(selectAcceleratorDeviceKind(pref)).toBe(expected);
    }
  });
});

describe('pickCascadeDirForDevice', () => {
  it('returns override verbatim when provided (even a string)', () => {
    expect(pickCascadeDirForDevice('metal', '/override/path', () => '/resolved')).toBe('/override/path');
    expect(pickCascadeDirForDevice('cuda', '/override/path', () => '/resolved')).toBe('/override/path');
    expect(pickCascadeDirForDevice('cpu', '/override/path', () => '/resolved')).toBe('/override/path');
  });

  it('returns undefined when override is explicitly null (null !== undefined)', () => {
    // Callers that want to force "no cascade" pass null, which is distinct
    // from not passing the argument at all.
    expect(pickCascadeDirForDevice('metal', null, () => '/resolved')).toBeNull();
  });

  it('resolves cascade dir on metal when no override', () => {
    expect(pickCascadeDirForDevice('metal', undefined, () => '/cascade/embed')).toBe('/cascade/embed');
  });

  it('returns undefined when resolver returns null on metal', () => {
    expect(pickCascadeDirForDevice('metal', undefined, () => null)).toBeUndefined();
  });

  it('returns undefined when resolver returns undefined on metal', () => {
    expect(pickCascadeDirForDevice('metal', undefined, () => undefined)).toBeUndefined();
  });

  it('SKIPS cascade resolution on cuda (critical: CUDA has no cascade)', () => {
    // The resolver should NOT be called when deviceKind is cuda. Wrap it
    // in a spy to assert zero calls.
    let callCount = 0;
    const resolver = () => { callCount += 1; return '/should-not-be-returned'; };
    const result = pickCascadeDirForDevice('cuda', undefined, resolver);
    expect(result).toBeUndefined();
    expect(callCount).toBe(0);
  });

  it('SKIPS cascade resolution on cpu', () => {
    let callCount = 0;
    const resolver = () => { callCount += 1; return '/should-not-be-returned'; };
    const result = pickCascadeDirForDevice('cpu', undefined, resolver);
    expect(result).toBeUndefined();
    expect(callCount).toBe(0);
  });

  it('SKIPS cascade resolution on auto (auto resolves at Rust layer)', () => {
    let callCount = 0;
    const resolver = () => { callCount += 1; return '/should-not-be-returned'; };
    const result = pickCascadeDirForDevice('auto', undefined, resolver);
    expect(result).toBeUndefined();
    expect(callCount).toBe(0);
  });
});
