import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { detectCommunities } from '../core/community-detector.js';
import { mineAll } from '../core/vocab-miner.js';
import { rankAll } from '../core/vocab-ranker.js';
import { warmLexical, warmFromCache, saveBinaryArtifact } from '../core/vocab-warmer.js';
import { ARTIFACT_PATHS } from '../core/vocab-constants.js';
import { DB_PATHS } from '../core/config.js';

describe('vocab prewarm integration (real SQLite)', () => {
  it('runs mine -> detect -> rank -> warm -> persist -> load with a real DB', async () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'vocab-prewarm-it-'));
    const srcDir = path.join(tmpRoot, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      path.join(srcDir, 'auth.js'),
      '// auth service handles token validation\nexport class AuthService {}\n'
    );
    writeFileSync(
      path.join(srcDir, 'user.js'),
      '// user service loads user profile\nexport class UserService {}\n'
    );

    const dbPath = path.join(tmpRoot, 'code-graph.db');
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY,
          name TEXT,
          type TEXT,
          file_path TEXT,
          start_line INTEGER,
          end_line INTEGER,
          stale_since TEXT,
          summary TEXT,
          signature TEXT
        );
        CREATE TABLE relationships (
          source_id INTEGER,
          target_id INTEGER,
          type TEXT
        );
        CREATE VIRTUAL TABLE entities_fts USING fts5(name);
      `);

      const insEnt = db.prepare(`
        INSERT INTO entities (id, name, type, file_path, start_line, end_line, stale_since, summary, signature)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `);
      insEnt.run(1, 'AuthService', 'class', 'src/auth.js', 1, 20, 'Auth entry point', 'class AuthService');
      insEnt.run(2, 'UserService', 'class', 'src/user.js', 1, 20, 'User entry point', 'class UserService');
      insEnt.run(3, 'validateToken', 'function', 'src/auth.js', 5, 10, 'Token validator', 'function validateToken');

      const insRel = db.prepare('INSERT INTO relationships (source_id, target_id, type) VALUES (?, ?, ?)');
      insRel.run(1, 2, 'imports');
      insRel.run(1, 3, 'calls');
      insRel.run(2, 3, 'uses');

      const insFts = db.prepare('INSERT INTO entities_fts (rowid, name) VALUES (?, ?)');
      insFts.run(1, 'AuthService');
      insFts.run(2, 'UserService');
      insFts.run(3, 'validateToken');
    } finally {
      db.close();
    }

    const oldCodeGraphPath = DB_PATHS.codeGraph;
    const oldArtifacts = { ...ARTIFACT_PATHS };
    const artifactDir = path.join(tmpRoot, '.sweet-search');

    try {
      DB_PATHS.codeGraph = dbPath;
      ARTIFACT_PATHS.identifiersBin = path.join(artifactDir, 'vocab-identifiers.bin');
      ARTIFACT_PATHS.identifiersMeta = path.join(artifactDir, 'vocab-identifiers.meta.json');
      ARTIFACT_PATHS.semanticSeedsBin = path.join(artifactDir, 'vocab-semantic-seeds.bin');
      ARTIFACT_PATHS.semanticSeedsMeta = path.join(artifactDir, 'vocab-semantic-seeds.meta.json');
      ARTIFACT_PATHS.communities = path.join(artifactDir, 'communities.json');
      ARTIFACT_PATHS.dynamicVocab = path.join(artifactDir, 'vocab-dynamic.json');

      const comm = detectCommunities(dbPath, { timeoutMs: 1200, maxIterations: 6 });
      expect(comm.communities.length).toBeGreaterThan(0);

      const mined = mineAll(tmpRoot, dbPath, comm.communities, { deep: false });
      expect(mined.terms.length).toBeGreaterThan(0);
      expect(mined.totalFiles).toBeGreaterThan(0);

      const ranked = rankAll(
        mined.terms,
        mined.communityPhrases,
        mined.pageRankScores,
        { depth: 'light', topN: 100, totalFiles: mined.totalFiles }
      );
      expect(ranked.identifiers.length).toBeGreaterThan(0);

      const lexical = await warmLexical(ranked.identifiers, dbPath);
      expect(lexical.queriesRun).toBeGreaterThan(0);

      await saveBinaryArtifact(
        ARTIFACT_PATHS.identifiersBin,
        ARTIFACT_PATHS.identifiersMeta,
        new Map([['AuthService', [0.1, 0.2, 0.3]]])
      );
      await saveBinaryArtifact(
        ARTIFACT_PATHS.semanticSeedsBin,
        ARTIFACT_PATHS.semanticSeedsMeta,
        new Map([
          ['user auth', [0.9, 0.8, 0.7]],
          ['token validation', [0.3, 0.2, 0.1]],
        ])
      );

      let traversals = 0;
      const loaded = await warmFromCache({
        maxFts5Queries: 10,
        maxHnswTraversals: 10,
        hnswIndex: {
          search: async () => { traversals++; return []; },
        },
      });

      expect(loaded.hnswTraversals).toBeGreaterThan(0);
      expect(traversals).toBe(loaded.hnswTraversals);
    } finally {
      DB_PATHS.codeGraph = oldCodeGraphPath;
      Object.assign(ARTIFACT_PATHS, oldArtifacts);
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

