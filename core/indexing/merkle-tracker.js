#!/usr/bin/env node

/**
 * Merkle Tree-Based File Tracking for Incremental Indexing
 *
 * Tracks file content hashes and chunk IDs to enable efficient change detection
 * and selective re-indexing. Supports atomic updates and persistent state.
 */

import { readFile, mkdir, open, rename, unlink } from 'fs/promises';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { contentHashSync, HASH_ALGORITHM } from '../incremental-indexing/infrastructure/hashing.mjs';

export class MerkleTracker {
  constructor(statePath = '.sweet-search/merkle/codebase-state.json') {
    this.statePath = resolve(statePath);
    this.state = {
      version: 2,
      hashAlgorithm: HASH_ALGORITHM,
      lastFullIndex: null,
      lastIncrementalIndex: null,
      stats: {
        totalFiles: 0,
        totalChunks: 0,
        lastDuration: 0
      },
      files: {}
    };
  }

  async load() {
    try {
      if (existsSync(this.statePath)) {
        const content = await readFile(this.statePath, 'utf8');
        const loaded = JSON.parse(content);

        if (loaded.version !== 2 || loaded.hashAlgorithm !== HASH_ALGORITHM) {
          console.warn(`Unknown state version ${loaded.version}, starting fresh`);
          return;
        }

        this.state = loaded;
        console.log(`Loaded tracking state: ${this.state.stats.totalFiles} files, ${this.state.stats.totalChunks} chunks`);
      } else {
        console.log('No existing state found, starting fresh');
      }
    } catch (error) {
      console.error('Failed to load tracking state:', error.message);
      console.log('Starting with fresh state');
    }
  }

  async save() {
    try {
      const dir = dirname(this.statePath);
      await mkdir(dir, { recursive: true });

      const tmpPath = `${this.statePath}.tmp`;
      const content = JSON.stringify(this.state, null, 2);
      let handle = await open(tmpPath, 'w');
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmpPath, this.statePath);
      try {
        handle = await open(dir, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
      } catch {
        // Some container/tmpfs filesystems reject directory fsync.
      }

      console.log(`Saved tracking state: ${this.state.stats.totalFiles} files, ${this.state.stats.totalChunks} chunks`);
    } catch (error) {
      try {
        await unlink(`${this.statePath}.tmp`);
      } catch {}
      console.error('Failed to save tracking state:', error.message);
      throw error;
    }
  }

  needsReindex(filePath, contentHash) {
    const tracked = this.state.files[filePath];
    if (!tracked) return true;
    if (tracked.contentHash !== contentHash) return true;
    return false;
  }

  async findChangedFiles(allFiles) {
    const changed = [];
    for (const filePath of allFiles) {
      try {
        const content = await readFile(filePath);
        const hash = MerkleTracker.computeHash(content);
        if (this.needsReindex(filePath, hash)) {
          changed.push(filePath);
        }
      } catch (err) {
        changed.push(filePath);
      }
    }
    return changed;
  }

  getChunkIds(filePath) {
    const tracked = this.state.files[filePath];
    return tracked ? tracked.chunkIds : [];
  }

  async updateFile(filePath, contentHash = null, chunkIds = [], size = 0) {
    const now = new Date().toISOString();

    if (!contentHash) {
      try {
        const content = await readFile(filePath);
        contentHash = MerkleTracker.computeHash(content);
        size = content.length;
      } catch (err) {
        contentHash = 'unknown';
      }
    }

    this.state.files[filePath] = {
      contentHash,
      lastIndexed: now,
      chunkIds,
      chunkCount: chunkIds.length,
      size
    };

    this.state.lastIncrementalIndex = now;
    this._recalculateStats();
  }

  removeFile(filePath) {
    const chunkIds = this.getChunkIds(filePath);
    delete this.state.files[filePath];
    this._recalculateStats();
    return chunkIds;
  }

  getTrackedFiles() {
    return Object.keys(this.state.files);
  }

  getStats() {
    return { ...this.state.stats };
  }

  getSummary() {
    const fileCount = Object.keys(this.state.files).length;
    const totalChunks = Object.values(this.state.files).reduce(
      (sum, file) => sum + file.chunkCount,
      0
    );
    const totalSize = Object.values(this.state.files).reduce(
      (sum, file) => sum + (file.size || 0),
      0
    );

    return {
      fileCount,
      totalChunks,
      totalSize,
      lastFullIndex: this.state.lastFullIndex,
      lastIncrementalIndex: this.state.lastIncrementalIndex,
      lastDuration: this.state.stats.lastDuration
    };
  }

  clear() {
    this.state = {
      version: 2,
      hashAlgorithm: HASH_ALGORITHM,
      lastFullIndex: null,
      lastIncrementalIndex: null,
      stats: {
        totalFiles: 0,
        totalChunks: 0,
        lastDuration: 0
      },
      files: {}
    };
  }

  _recalculateStats() {
    const files = Object.values(this.state.files);
    this.state.stats.totalFiles = files.length;
    this.state.stats.totalChunks = files.reduce(
      (sum, file) => sum + file.chunkCount,
      0
    );
  }

  static computeHash(content) {
    return contentHashSync(content);
  }

  static async computeFileHash(filePath) {
    const content = await readFile(filePath);
    return MerkleTracker.computeHash(content);
  }
}

// CLI Interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const tracker = new MerkleTracker();
  await tracker.load();

  const command = process.argv[2];

  switch (command) {
    case 'stats':
      console.log(JSON.stringify(tracker.getSummary(), null, 2));
      break;

    case 'list':
      console.log(tracker.getTrackedFiles().join('\n'));
      break;

    case 'clear':
      tracker.clear();
      await tracker.save();
      console.log('Tracking state cleared');
      break;

    case 'inspect':
      if (!process.argv[3]) {
        console.error('Usage: merkle-tracker.js inspect <file-path>');
        process.exit(1);
      }
      const metadata = tracker.state.files[process.argv[3]];
      console.log(JSON.stringify(metadata, null, 2));
      break;

    default:
      console.log(`
Merkle File Tracker CLI

Usage:
  merkle-tracker.js stats              Show tracking statistics
  merkle-tracker.js list               List all tracked files
  merkle-tracker.js inspect <file>     Show metadata for a file
  merkle-tracker.js clear              Clear all tracking state
`);
  }
}
