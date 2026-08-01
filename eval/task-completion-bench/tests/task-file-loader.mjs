import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskFile } from '../harness/task-file-loader.mjs';

test('accepts JSON arrays and nonblank NDJSON without changing record order', () => {
  const expected = [{ instance_id: 'a', n: 1 }, { instance_id: 'b', n: 2 }];
  assert.deepEqual(parseTaskFile(JSON.stringify(expected)), expected);
  assert.deepEqual(parseTaskFile(`\n${JSON.stringify(expected[0])}\r\n\n${JSON.stringify(expected[1])}\n`), expected);
});

test('rejects empty, malformed, non-object, missing-id, and duplicate inputs', () => {
  assert.throws(() => parseTaskFile('  '), /empty/);
  assert.throws(() => parseTaskFile('[{"instance_id":"a"}'), /malformed JSON array/);
  assert.throws(() => parseTaskFile('{"instance_id":"a"}\nnope'), /line 2/);
  assert.throws(() => parseTaskFile('[1]'), /must be an object/);
  assert.throws(() => parseTaskFile('[{}]'), /non-empty instance_id/);
  assert.throws(() => parseTaskFile('[{"instance_id":"a"},{"instance_id":"a"}]'), /duplicate instance_id a/);
});

test('does not reinterpret a top-level object as an array', () => {
  assert.deepEqual(parseTaskFile('{"instance_id":"one"}'), [{ instance_id: 'one' }]);
  assert.throws(() => parseTaskFile('{"items":[]}'), /non-empty instance_id/);
});
