/**
 * Names of the files inside a project's state dir (`<root>/.sweet-search`).
 * Every name is an on-disk name: changing one orphans existing indexes and breaks the
 * research scripts that spell these names out. This module imports nothing.
 */

export const DIRTY_QUEUE = 'index-maintainer-queue.jsonl';
export const PROCESSING_QUEUE = 'index-maintainer-queue.processing.jsonl';
export const MERKLE_STATE = 'merkle-state.json';
export const PAUSE_FILE = 'reconcile-pause.json';
export const MAINTAINER_LOCK = 'index-maintainer.lock';
export const RECONCILE_MANIFEST = 'reconcile-manifest.json';

export const CODEBASE_DB = 'codebase.db';
export const CODE_GRAPH_DB = 'code-graph.db';
export const LI_STUB_DB = 'codebase-late-interaction.db';
export const BINARY_HNSW_INDEX = 'codebase-binary-hnsw.idx';
