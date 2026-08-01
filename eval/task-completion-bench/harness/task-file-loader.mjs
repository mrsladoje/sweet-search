// Fail-closed task-list loader. Frozen cohorts are canonical NDJSON, while older
// task sets are JSON arrays; both formats receive the same structural validation.
import { readFileSync } from 'node:fs';

function validateRecords(records, source) {
  if (!Array.isArray(records)) throw new TypeError(`${source}: task payload must be a JSON array or NDJSON`);
  if (!records.length) throw new Error(`${source}: task payload is empty`);
  const seen = new Set();
  return records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError(`${source}: task record ${index + 1} must be an object`);
    }
    const id = record.instance_id;
    if (typeof id !== 'string' || !id.trim()) {
      throw new TypeError(`${source}: task record ${index + 1} has no non-empty instance_id`);
    }
    if (seen.has(id)) throw new Error(`${source}: duplicate instance_id ${id}`);
    seen.add(id);
    return record;
  });
}

export function parseTaskFile(text, { source = 'TASKS_FILE' } = {}) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  if (!input.trim()) throw new Error(`${source}: task payload is empty`);
  if (input.trimStart().startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(input); }
    catch (error) { throw new SyntaxError(`${source}: malformed JSON array: ${error.message}`); }
    return validateRecords(parsed, source);
  }
  const records = [];
  for (const [index, line] of input.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); }
    catch (error) { throw new SyntaxError(`${source}: malformed NDJSON at line ${index + 1}: ${error.message}`); }
  }
  return validateRecords(records, source);
}

export function loadTaskFile(filename) {
  return parseTaskFile(readFileSync(filename, 'utf8'), { source: filename });
}
