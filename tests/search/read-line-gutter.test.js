/**
 * ss-read line gutter — the EXACT EDIT ANCHOR round-trip.
 *
 * The gutter is a validated agent-cost lever (−16%, solves held) and stays ON.
 * The defect it carried was the delimiter, not the gutter: `N| ` injects one
 * space between the delimiter and the content, so a model that strips the
 * visually salient `123|` (4 chars) instead of `123| ` (5) carries exactly one
 * extra leading space into an exact-match edit anchor, and the harness's edit
 * tool — which sweet does not own — rejects it.
 *
 * Measured on the 2026-08-11 claude-code run: sweet rendered 15,205 gutter
 * lines as `N| ` and produced 20 anchor failures, 14 of them reproducing the
 * off-by-one exactly (per-line delta +1 space, matching the read rebuilt with
 * `N|` stripped and NOT matching the true source). native rendered 19,499
 * lines as `N<TAB>` and produced zero whitespace-carry failures.
 *
 * These tests lock the property that makes the tab safe: the delimiter carries
 * no adjacent injected whitespace, so strip-the-delimiter and
 * strip-the-delimiter-and-one-more cannot both look right.
 */
import { describe, it, expect } from 'vitest';
import {
  numberCodeLines,
  stripCodeLineNumbers,
  lineGutterEnabled,
  formatReadResults,
  GUTTER_DELIMITER,
} from '../../core/search/search-read.js';

const DART = [
  'class StreamedResponse extends BaseResponse {',
  '  StreamedResponse(',
  '    this.stream,',
  '    super.statusCode, {',
  '      this.request,',
  '      this.headers = const {},',
  '      this.isRedirect = false,',
  '  });',
  '}',
].join('\n');

// TAB-indented source: the one case a tab delimiter could plausibly confuse.
const TABBED = [
  'export async function handlebars(sourcePath: string) {',
  '\tconst source = await getSource(sourcePath);',
  '\tif (!source) {',
  '\t\tthrow new Error("missing");',
  '\t}',
  '\treturn executeTemplatesRecursive(source);',
  '}',
].join('\n');

describe('gutter delimiter', () => {
  it('is a single tab with no adjacent whitespace', () => {
    expect(GUTTER_DELIMITER).toBe('\t');
    expect(GUTTER_DELIMITER).toHaveLength(1);
    expect(GUTTER_DELIMITER.trim()).toBe('');
  });

  it('renders an unpadded number — NOT cat -n\'s fixed-width field', () => {
    const many = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    const out = numberCodeLines(many, 995).split('\n');
    expect(out[0]).toBe('995\tline 0');
    expect(out[6]).toBe('1001\tline 6');
    // The prefix width varies with digit count, exactly as `N| ` did. cat -n
    // pads to a fixed column, which was tried and rejected for miscalibrating
    // edit wrapping (Claude Code #36654).
    expect(out.every(l => !/^ /.test(l))).toBe(true);
  });
});

describe('exact edit-anchor round-trip', () => {
  it('stripping the delimiter reproduces the source byte-for-byte', () => {
    expect(stripCodeLineNumbers(numberCodeLines(DART, 51))).toBe(DART);
  });

  it('survives TAB-indented source: the gutter tab strips, content tabs stay', () => {
    const rendered = numberCodeLines(TABBED, 1);
    expect(rendered.split('\n')[1]).toBe('2\t\tconst source = await getSource(sourcePath);');
    expect(stripCodeLineNumbers(rendered)).toBe(TABBED);
  });

  it('THE DEFECT: no rendered line has whitespace adjacent to the delimiter', () => {
    // With `N| ` every line had a space at index (digits+1), and consuming
    // `N|` alone left it behind. There is no such character to leave behind.
    for (const line of numberCodeLines(DART, 51).split('\n')) {
      const at = line.indexOf(GUTTER_DELIMITER);
      expect(at).toBeGreaterThan(0);
      expect(/^\d+$/.test(line.slice(0, at))).toBe(true);
      // one char past the delimiter is the source's own first character
      expect(line.slice(at + 1)).toBe(DART.split('\n')[Number(line.slice(0, at)) - 51]);
    }
  });

  it('an off-by-one strip is now detectable, not silently plausible', () => {
    // The historical failure: take everything after the delimiter's index
    // WITHOUT consuming the delimiter itself. Under `N| ` that produced a
    // valid-looking line with one extra space. Under a tab it produces a line
    // that still starts with a tab — visibly not source indentation the model
    // copied, and it no longer differs from the truth by one SPACE.
    const rendered = numberCodeLines(DART, 51).split('\n')[4];
    const at = rendered.indexOf(GUTTER_DELIMITER);
    const offByOne = rendered.slice(at);            // keeps the delimiter
    expect(offByOne.startsWith('\t')).toBe(true);
    expect(offByOne).not.toBe('      this.request,');
    expect(rendered.slice(at + 1)).toBe('      this.request,');
  });

  it('preserves a trailing newline exactly, in both directions', () => {
    const withNL = 'a\nb\n';
    expect(numberCodeLines(withNL, 1)).toBe('1\ta\n2\tb\n');
    expect(stripCodeLineNumbers(numberCodeLines(withNL, 1))).toBe(withNL);
  });

  it('leaves empty and falsy text untouched', () => {
    expect(numberCodeLines('', 1)).toBe('');
    expect(numberCodeLines(null, 1)).toBe(null);
    expect(stripCodeLineNumbers('')).toBe('');
  });

  it('round-trips blank lines and lines that already contain tabs', () => {
    const src = 'a\n\n\tb\tc\n\nd';
    expect(stripCodeLineNumbers(numberCodeLines(src, 7))).toBe(src);
  });

  it('stripCodeLineNumbers leaves a non-gutter line alone', () => {
    // Defensive: only `<digits><TAB>` is a gutter. A source line that happens
    // to start with a tab, or with text-then-tab, must not be mangled.
    expect(stripCodeLineNumbers('\tindented')).toBe('\tindented');
    expect(stripCodeLineNumbers('name\tvalue')).toBe('name\tvalue');
  });
});

describe('shipped delimiter is fixed', () => {
  it('does not let the paid A/B environment switch restore the rejected pipe gutter', () => {
    const previous = process.env.SS_READ_GUTTER;
    try {
      process.env.SS_READ_GUTTER = 'pipe';
      expect(numberCodeLines('a\nb', 51)).toBe('51\ta\n52\tb');
    } finally {
      if (previous === undefined) delete process.env.SS_READ_GUTTER;
      else process.env.SS_READ_GUTTER = previous;
    }
  });
});

describe('format gate still holds (protects retrieval measurement)', () => {
  it('stays off for benchmark, raw and json formats', () => {
    expect(lineGutterEnabled({ format: 'benchmark' })).toBe(false);
    expect(lineGutterEnabled({ format: 'raw' })).toBe(false);
    expect(lineGutterEnabled({ format: 'json' })).toBe(false);
  });

  it('propagates the requested format through the full read renderer', () => {
    const text = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n');
    const results = {
      files: [{ ok: true, file: 'src/a.js', language: 'javascript', text, totalLines: 15, chunks: [] }],
      totalMs: 0,
    };
    expect(formatReadResults(results, 'benchmark')).toContain(`\n${text}\n`);
    expect(formatReadResults(results, 'benchmark')).not.toContain('1\tline 1');
    expect(formatReadResults(results, 'agent')).toContain('1\tline 1');
  });

  it('stays on by default and for agent formats', () => {
    expect(lineGutterEnabled({})).toBe(true);
    expect(lineGutterEnabled({ format: 'agent' })).toBe(true);
    expect(lineGutterEnabled({ format: 'agent_full' })).toBe(true);
  });

  it('explicit lineNumbers wins over the format default in both directions', () => {
    expect(lineGutterEnabled({ lineNumbers: false })).toBe(false);
    expect(lineGutterEnabled({ lineNumbers: true, format: 'benchmark' })).toBe(true);
  });

  it('SS_READ_LINENUMS=0 is still the A/B off-switch', () => {
    const prev = process.env.SS_READ_LINENUMS;
    try {
      process.env.SS_READ_LINENUMS = '0';
      expect(lineGutterEnabled({})).toBe(false);
      expect(lineGutterEnabled({ lineNumbers: true })).toBe(true);   // explicit still wins
    } finally {
      if (prev === undefined) delete process.env.SS_READ_LINENUMS;
      else process.env.SS_READ_LINENUMS = prev;
    }
  });
});
