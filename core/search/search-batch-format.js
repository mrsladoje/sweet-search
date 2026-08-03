function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uri(value) {
  const text = String(value ?? '');
  try {
    return encodeURIComponent(text);
  } catch {
    return encodeURIComponent(Buffer.from(text).toString('utf8'));
  }
}

function token(value, fallback = 0) {
  if (typeof value === 'string') return uri(value);
  return Number.isFinite(value) ? String(value) : String(fallback);
}

function booleanToken(value) {
  return value === true ? 'true' : 'false';
}

function operationLine(operation) {
  const meta = record(operation.meta);
  return [
    '[ss-batch operation]',
    `id=${uri(operation.id)}`,
    `tool=${uri(operation.tool)}`,
    `status=${uri(operation.status)}`,
    `truncated=${booleanToken(operation.truncated)}`,
    `source_span_count=${token(meta.sourceSpanCount)}`,
    `emitted_span_count=${token(meta.emittedSpanCount)}`,
    `duplicate_span_count=${token(meta.duplicateSpanCount)}`,
    `budget_omitted_span_count=${token(meta.budgetOmittedSpanCount)}`,
    `floor_chars=${token(meta.floorChars)}`,
    `allocated_chars=${token(meta.allocatedChars)}`,
    `full_output_chars=${token(meta.fullOutputChars)}`,
    `output_chars=${token(meta.outputChars)}`,
  ].join(' ');
}

function omittedLine(operation, omission) {
  const duplicate = record(omission.duplicateOf);
  const fields = [
    '[ss-batch omitted]',
    `operation_id=${uri(operation.id)}`,
    `reason=${uri(omission.reason)}`,
    `file=${uri(omission.file)}`,
    `start=${token(omission.startLine ?? omission.start)}`,
    `end=${token(omission.endLine ?? omission.end)}`,
    `rank=${token(omission.rank)}`,
    `partial=${booleanToken(omission.partial)}`,
  ];
  if (Object.keys(duplicate).length) {
    fields.push(`duplicate_operation_id=${uri(duplicate.operationId)}`);
    fields.push(`duplicate_rank=${token(duplicate.rank)}`);
  }
  return fields.join(' ');
}

/**
 * Presentation boundary for native/CLI callers. Domain packaging remains JSON;
 * this adapter exposes its text without JSON-escaped source newlines.
 */
export function renderSearchBatchCliResult(packed) {
  const result = record(packed);
  const operations = Array.isArray(result.operations) ? result.operations.map(record) : [];
  const shared = record(result.sharedBudget);
  const dedup = record(result.dedup);
  const operationCount = Number.isFinite(result.operationCount)
    ? result.operationCount
    : operations.length;
  let output = [
    '[ss-batch]',
    `version=${token(result.version)}`,
    `operation_count=${token(operationCount)}`,
    `shared_max_chars=${token(shared.maxChars)}`,
    `shared_used_chars=${token(shared.usedChars)}`,
    `shared_truncated=${booleanToken(shared.truncated)}`,
    `dedup_count=${token(dedup.duplicateSpanCount)}`,
  ].join(' ');

  for (const operation of operations) {
    output += `\n${operationLine(operation)}\n`;
    const operationOutput = operation.output == null ? '' : String(operation.output);
    if (operationOutput) {
      output += operationOutput;
      if (!operationOutput.endsWith('\n')) output += '\n';
    }
    const omissions = Array.isArray(operation.meta?.omittedSpans)
      ? operation.meta.omittedSpans.map(record)
      : [];
    for (const omission of omissions) output += `${omittedLine(operation, omission)}\n`;
  }
  if (!output.endsWith('\n')) output += '\n';
  output += `[ss-batch end] operation_count=${token(operationCount)}`;
  return output;
}
