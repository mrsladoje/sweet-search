/**
 * Test helpers for the index state: merkle-state.json holds the header, file-state.db the
 * per-file rows (core/incremental-indexing/infrastructure/file-state-store.mjs).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readFileStateObject, writeFileStateObject, readGrepStateObject, writeGrepStateObject,
} from '../../core/incremental-indexing/infrastructure/file-state-store.mjs';

/** Write merkle-state.json (header) and the per-file rows from one merkle-shaped object. */
export function writeMerkleState(stateDir, { files = {}, ...header } = {}) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'merkle-state.json'), JSON.stringify(header));
  writeFileStateObject(stateDir, files);
}

/** Indexed files as the old merkle `files` map. */
export const readIndexedFiles = (stateDir) => readFileStateObject(stateDir);
export const writeIndexedFiles = (stateDir, files) => writeFileStateObject(stateDir, files);
export const readGrepFiles = (stateDir) => readGrepStateObject(stateDir);
export const writeGrepFiles = (stateDir, files) => writeGrepStateObject(stateDir, files);
