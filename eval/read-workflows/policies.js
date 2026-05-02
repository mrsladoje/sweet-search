// System-prompt-style policies for each workflow mode. The bench runner
// stores these in the JSON artifact so results are auditable: a reviewer
// can see exactly which tools each mode was permitted to use.

export const POLICIES = {
  'native-rg-read': `You are solving a code-understanding task using only native repository inspection.
Allowed discovery: filesystem ripgrep-style search.
Allowed reading: plain filesystem reads of whole files or explicit line ranges.
Forbidden: Sweet Search index, Sweet Search search, Sweet Search read, Sweet Search read-semantic, vector search, late-interaction ranking, symbol index metadata.
Return the minimal code context needed to answer the task.
`,
  'sweet-grep-read': `You are solving a code-understanding task using Sweet Search indexed discovery plus exact reads.
Allowed discovery: Sweet Search indexed grep / colgrep / pattern search.
Allowed reading: sweet-search read.
Forbidden: native ripgrep discovery, native Read as a primary read path, sweet-search read-semantic, vector-only retrieval unless part of indexed grep/colgrep mode.
Return the minimal code context needed to answer the task.
`,
  'sweet-grep-read-semantic': `You are solving a code-understanding task using Sweet Search indexed discovery plus semantic span reads.
Allowed discovery: Sweet Search indexed grep / colgrep / pattern search.
Allowed reading: sweet-search read-semantic for query-specific spans, sweet-search read for exact known line ranges.
Forbidden: native ripgrep discovery, native Read as a primary read path.
Return the minimal code context needed to answer the task.
`,
};

export const MODE_ORDER = ['native-rg-read', 'sweet-grep-read', 'sweet-grep-read-semantic'];
