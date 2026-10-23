import { describe, it, expect, beforeEach } from 'vitest';
import {
  INFERENCE_REVISION,
  applyProvenance,
  classifyProvenance,
  describeEncoders,
  recordEncode,
  takeProvenance,
} from '../../core/infrastructure/inference-provenance.js';

describe('inference provenance', () => {
  beforeEach(() => {
    takeProvenance();
  });

  it('counts encodes per kind and label, then clears on take', () => {
    recordEncode('dense', 'cuda/bf16', 64);
    recordEncode('dense', 'cuda/bf16', 36);
    recordEncode('dense', 'ort-q8/cpu', 5);
    recordEncode('li', 'cuda/f32', 100);
    recordEncode('li', null, 2);
    recordEncode('dense', 'cuda/bf16', 0);
    recordEncode('other', 'x', 1);
    expect(takeProvenance()).toEqual({
      dense: { 'cuda/bf16': 100, 'ort-q8/cpu': 5 },
      li: { 'cuda/f32': 100, unknown: 2 },
    });
    expect(takeProvenance()).toEqual({ dense: {}, li: {} });
  });

  it('a full rebuild replaces the counts; other publishes add to them', () => {
    const full = applyProvenance({ vectors: { path: 'v' }, lateInteraction: {} }, { dense: { 'metal/bf16': 10 }, li: { 'coreml+metal/bf16': 10 } }, { replace: true });
    expect(full.vectors).toEqual({ path: 'v', encoders: { revision: INFERENCE_REVISION, counts: { 'metal/bf16': 10 } } });

    const tick = applyProvenance(structuredClone(full), { dense: { 'ort-q8/cpu': 3 }, li: {} });
    expect(tick.vectors.encoders.counts).toEqual({ 'metal/bf16': 10, 'ort-q8/cpu': 3 });
    expect(tick.lateInteraction.encoders.counts).toEqual({ 'coreml+metal/bf16': 10 });

    const rebuilt = applyProvenance(structuredClone(tick), { dense: { 'metal/bf16': 7 }, li: {} }, { replace: true });
    expect(rebuilt.vectors.encoders.counts).toEqual({ 'metal/bf16': 7 });
    expect(rebuilt.lateInteraction.encoders.counts).toEqual({});
  });

  it('leaves a tier untouched when nothing was recorded and it is not a rebuild', () => {
    const m = { vectors: { epoch: 3 }, lateInteraction: { epoch: 3 } };
    expect(applyProvenance(structuredClone(m), { dense: {}, li: {} })).toEqual(m);
  });

  it('keeps counts from an older inference revision apart', () => {
    const old = { vectors: { encoders: { revision: 0, counts: { 'cuda/bf16': 50 } } } };
    const out = applyProvenance(old, { dense: { 'cuda/bf16': 4 }, li: {} });
    expect(out.vectors.encoders.counts).toEqual({ 'cuda/bf16': 4 });
    expect(out.vectors.encoders.olderRevisions).toEqual({ 0: { 'cuda/bf16': 50 } });
    expect(classifyProvenance(out).notes.join(' ')).toMatch(/cuda\/bf16 encodes from inference revision 0 predate numerics fixes/);
  });

  it('classifies legacy and recorded indexes; a GPU baseline with ORT daemon writes needs no note', () => {
    const legacy = classifyProvenance({ vectors: {}, lateInteraction: {} });
    expect(legacy.state).toBe('unknown');
    expect(legacy.notes.join(' ')).toMatch(/not recorded/);

    const mixed = classifyProvenance({
      vectors: { encoders: { revision: 1, counts: { 'cuda/bf16': 90, 'ort-q8/cpu': 10 } } },
      lateInteraction: { encoders: { revision: 1, counts: { 'cuda/f32': 90 } } },
    });
    expect(mixed.state).toBe('recorded');
    expect(mixed.notes).toEqual([]);
  });

  it('describes a tier by count, largest first', () => {
    expect(describeEncoders({ counts: { 'ort-q8/cpu': 2, 'metal/bf16': 9 } })).toBe('metal/bf16 ×9, ort-q8/cpu ×2');
    expect(describeEncoders(null)).toBe(null);
  });
});
