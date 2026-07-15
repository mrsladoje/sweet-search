import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

let tempSequence = 0;

function assertRecordArray(records, label) {
  if (!Array.isArray(records)) throw new TypeError(`${label} must be an array`);
}

function taskId(record, label) {
  const id = record?.instance_id;
  if (typeof id !== 'string' || !id) throw new TypeError(`${label} record missing instance_id`);
  return id;
}

function indexUnique(records, label) {
  const index = new Map();
  records.forEach((record, position) => {
    const id = taskId(record, label);
    if (index.has(id)) throw new Error(`${label} contains duplicate instance_id: ${id}`);
    index.set(id, position);
  });
  return index;
}

/** Merge evaluator records by task, preserving first-seen order and latest data. */
export function mergeTaskRecords(existing, incoming) {
  assertRecordArray(existing, 'existing');
  assertRecordArray(incoming, 'incoming');
  const merged = [...existing];
  const positions = indexUnique(merged, 'existing');
  indexUnique(incoming, 'incoming');
  for (const record of incoming) {
    const id = taskId(record, 'incoming');
    const position = positions.get(id);
    if (position === undefined) {
      positions.set(id, merged.length);
      merged.push(record);
    } else {
      merged[position] = record;
    }
  }
  return merged;
}

/** Merge SWE-rebench report payloads while recomputing aggregate metadata. */
export function mergeEvaluationReports(existing, incoming) {
  if (existing !== null && (typeof existing !== 'object' || Array.isArray(existing))) {
    throw new TypeError('existing report must be an object');
  }
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new TypeError('incoming report must be an object');
  }
  const items = mergeTaskRecords(existing?.items || [], incoming.items || []);
  const workers = Math.max(Number(existing?.max_workers) || 0, Number(incoming.max_workers) || 0);
  return {
    ...(existing || {}),
    ...incoming,
    max_workers: workers,
    total: items.length,
    all_ok: items.every(item => !item.error && item.passed_match === true),
    items,
  };
}

function readJson(pathname, fallback) {
  return existsSync(pathname) ? JSON.parse(readFileSync(pathname, 'utf8')) : fallback;
}

function writeJsonAtomic(pathname, value) {
  const temporary = `${pathname}.tmp-${process.pid}-${++tempSequence}`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    renameSync(temporary, pathname);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Atomically merge a JSON list of task-keyed records on disk. */
export function mergeTaskRecordFile(pathname, incoming) {
  const merged = mergeTaskRecords(readJson(pathname, []), incoming);
  writeJsonAtomic(pathname, merged);
  return merged;
}

/** Atomically merge a SWE-rebench report payload on disk. */
export function mergeEvaluationReportFile(pathname, incoming) {
  const merged = mergeEvaluationReports(readJson(pathname, null), incoming);
  writeJsonAtomic(pathname, merged);
  return merged;
}
