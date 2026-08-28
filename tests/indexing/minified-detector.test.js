import { describe, it, expect } from 'vitest';
import { looksMinified } from '../../core/indexing/minified-detector.js';

const bigLine = 'a'.repeat(60000);

describe('looksMinified — catches bundles/minified', () => {
  it('single enormous line (>=1KB)', () => {
    expect(looksMinified(bigLine, { ext: '.js' })).toMatchObject({ rule: 'single-line' });
  });
  it('median line length > 200', () => {
    const body = Array.from({ length: 20 }, () => 'x'.repeat(300)).join('\n');
    expect(looksMinified(body, { ext: '.js' })).toMatchObject({ rule: 'median-gt-200' });
  });
  it('mean > 110 for js/css even when median is lower', () => {
    // many short lines + a few very long ones → mean over 110, median under 200
    const body = [...Array(6).fill('x'.repeat(20)), 'y'.repeat(900)].join('\n');
    const v = looksMinified(body, { ext: '.css' });
    expect(v && (v.rule === 'mean-gt-110' || v.rule === 'long-lines')).toBe(true);
  });
  it('webpack bundler banner', () => {
    expect(looksMinified('/******/ (() => {\nvar __webpack_require__ = {};\n', { ext: '.js' }))
      .toMatchObject({ rule: 'bundler-banner' });
  });
  it('source-map trailer in the tail', () => {
    expect(looksMinified('function ok(){}\n', { ext: '.js', tailText: '\n//# sourceMappingURL=app.js.map' }))
      .toMatchObject({ rule: 'source-map-trailer' });
  });
  it('multiple absurdly long lines are flagged', () => {
    const body = ['short', 'z'.repeat(5000), 'ok', 'z'.repeat(5000)].join('\n');
    expect(looksMinified(body, { ext: '.go' })).toBeTruthy();   // caught (median or long-lines)
  });
});

describe('looksMinified — keeps real source and data/doc', () => {
  it('ordinary hand-written source is not minified', () => {
    const src = ['import os', '', 'def feature(x):', '    # compose a property set', '    return x + 1', ''].join('\n');
    expect(looksMinified(src, { ext: '.py' })).toBe(false);
  });
  it('a Boost.Build jam rule is not minified', () => {
    const jam = ['rule install ( name : sources * )', '{', '    local r = [ new install-target ] ;', '    return $(r) ;', '}'].join('\n');
    expect(looksMinified(jam, { ext: '.jam' })).toBe(false);
  });
  it('long lines in JSON/markdown/svg are exempt (data/doc)', () => {
    const bigJson = '{"data":"' + 'a'.repeat(60000) + '"}';
    expect(looksMinified(bigJson, { ext: '.json' })).toBe(false);
    expect(looksMinified('x'.repeat(60000), { ext: '.svg' })).toBe(false);
  });
  it('empty / tiny input is never minified', () => {
    expect(looksMinified('', { ext: '.js' })).toBe(false);
    expect(looksMinified('a'.repeat(500), { ext: '.js', totalBytes: 500 })).toBe(false); // <1KB guard
  });
});
