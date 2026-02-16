/**
 * embedding-batching.test.js (MANDATORY - blocks merge)
 *
 * Verifies that batch inference produces the same embeddings as sequential
 * single-text inference. Tests with mixed-length inputs to catch padding /
 * attention_mask / truncation drift.
 *
 * Dual tolerance gate per embedding pair:
 *   maxAbsDiff < 3e-4  AND  cosineSimilarity > 0.999985
 */

import { describe, it, expect, beforeAll } from 'vitest';
import embeddingService from '../core/embedding-service.js';

const { generateEmbedding, generateEmbeddings } = embeddingService;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function maxAbsDiff(a, b) {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    max = Math.max(max, Math.abs(a[i] - b[i]));
  }
  return max;
}

// ---------------------------------------------------------------------------
// Test texts — deliberately mixed-length to surface padding issues
// ---------------------------------------------------------------------------

const SHORT = 'function add(a, b) { return a + b; }'; // ~37 chars

const MEDIUM = [
  'class UserService {',
  '  constructor(db) {',
  '    this.db = db;',
  '    this.cache = new Map();',
  '  }',
  '',
  '  async getUser(id) {',
  '    if (this.cache.has(id)) return this.cache.get(id);',
  '    const user = await this.db.query(',
  "      'SELECT * FROM users WHERE id = ?',",
  '      [id]',
  '    );',
  '    if (user) this.cache.set(id, user);',
  '    return user;',
  '  }',
  '',
  '  async updateUser(id, data) {',
  "    await this.db.query('UPDATE users SET ? WHERE id = ?', [data, id]);",
  '    this.cache.delete(id);',
  '    return this.getUser(id);',
  '  }',
  '',
  '  async deleteUser(id) {',
  "    await this.db.query('DELETE FROM users WHERE id = ?', [id]);",
  '    this.cache.delete(id);',
  '  }',
  '}',
].join('\n'); // ~500 chars

const LONG = [
  '/**',
  ' * AuthenticationService handles JWT-based authentication with',
  ' * automatic token rotation and account lockout protection.',
  ' */',
  'class AuthenticationService {',
  '  constructor(userRepo, tokenStore, config) {',
  '    this.userRepo = userRepo;',
  '    this.tokenStore = tokenStore;',
  '    this.config = {',
  '      accessTokenTTL: config.accessTokenTTL || 900,',
  '      refreshTokenTTL: config.refreshTokenTTL || 604800,',
  "      issuer: config.issuer || 'sweet-search',",
  "      audience: config.audience || 'api',",
  '      ...config,',
  '    };',
  "    this.algorithm = 'RS256';",
  '  }',
  '',
  '  async authenticate(credentials) {',
  '    const { username, password } = credentials;',
  '    if (!username || !password) {',
  "      throw new AuthError('Missing credentials', 'INVALID_INPUT');",
  '    }',
  '    const user = await this.userRepo.findByUsername(username);',
  '    if (!user || !await this.verifyPassword(password, user.passwordHash)) {',
  "      throw new AuthError('Invalid credentials', 'AUTH_FAILED');",
  '    }',
  '    if (user.lockedUntil && user.lockedUntil > Date.now()) {',
  "      throw new AuthError('Account locked', 'ACCOUNT_LOCKED');",
  '    }',
  '    const accessToken = await this.generateAccessToken(user);',
  '    const refreshToken = await this.generateRefreshToken(user);',
  '    await this.tokenStore.save(refreshToken.jti, {',
  '      userId: user.id,',
  '      expiresAt: refreshToken.exp,',
  '      rotationCounter: 0,',
  '    });',
  '    await this.userRepo.updateLastLogin(user.id);',
  '    return {',
  '      accessToken: accessToken.token,',
  '      refreshToken: refreshToken.token,',
  '      expiresIn: this.config.accessTokenTTL,',
  '    };',
  '  }',
  '',
  '  async verifyPassword(plain, hash) {',
  "    const bcrypt = await import('bcryptjs');",
  '    return bcrypt.compare(plain, hash);',
  '  }',
  '',
  '  async generateAccessToken(user) {',
  '    const payload = {',
  '      sub: user.id,',
  '      role: user.role,',
  '      iss: this.config.issuer,',
  '      aud: this.config.audience,',
  '    };',
  '    const token = jwt.sign(payload, this.privateKey, {',
  '      algorithm: this.algorithm,',
  '      expiresIn: this.config.accessTokenTTL,',
  '    });',
  '    return {',
  '      token,',
  '      exp: Date.now() + this.config.accessTokenTTL * 1000,',
  '    };',
  '  }',
  '',
  '  async generateRefreshToken(user) {',
  '    const jti = crypto.randomUUID();',
  '    const payload = {',
  '      sub: user.id,',
  '      jti,',
  '      iss: this.config.issuer,',
  '    };',
  '    const token = jwt.sign(payload, this.privateKey, {',
  '      algorithm: this.algorithm,',
  '      expiresIn: this.config.refreshTokenTTL,',
  '    });',
  '    return {',
  '      token,',
  '      jti,',
  '      exp: Date.now() + this.config.refreshTokenTTL * 1000,',
  '    };',
  '  }',
  '',
  '  async refresh(refreshToken) {',
  '    const decoded = jwt.verify(refreshToken, this.publicKey);',
  '    const stored = await this.tokenStore.get(decoded.jti);',
  "    if (!stored) throw new AuthError('Revoked', 'TOKEN_REVOKED');",
  '    await this.tokenStore.delete(decoded.jti);',
  '    const user = await this.userRepo.findById(stored.userId);',
  '    return this.authenticate({',
  '      username: user.username,',
  '      password: null,',
  '      skipPassword: true,',
  '    });',
  '  }',
  '}',
].join('\n'); // ~1800 chars

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Embedding Batching Parity', () => {
  // Model download + warmup can take >60s on first run
  beforeAll(async () => {
    await generateEmbedding('warmup text', 'local');
  }, 120_000);

  it('batched inference matches sequential for mixed-length inputs', async () => {
    const texts = [SHORT, MEDIUM, LONG];

    // Sequential: embed one text at a time (batch-of-1, no cross-text padding)
    const sequential = [];
    for (const text of texts) {
      const emb = await generateEmbedding(text, 'local');
      sequential.push(emb);
    }

    // Batched: embed all together (padding applied across texts)
    const batched = await generateEmbeddings(texts, 'local');

    expect(batched).toHaveLength(texts.length);

    // Dual tolerance gate — both conditions must hold for every pair
    for (let i = 0; i < texts.length; i++) {
      const cos = cosineSimilarity(sequential[i], batched[i]);
      const mad = maxAbsDiff(sequential[i], batched[i]);
      expect(mad).toBeLessThan(3e-4);
      expect(cos).toBeGreaterThan(0.999985);
    }
  }, 120_000);

  it('output embeddings are Float32Array instances', async () => {
    const results = await generateEmbeddings([SHORT, MEDIUM], 'local');

    for (const emb of results) {
      expect(emb).toBeInstanceOf(Float32Array);
    }
  }, 120_000);

  it('batch of 1 matches single-text embedding', async () => {
    const single = await generateEmbedding(SHORT, 'local');
    const [batched] = await generateEmbeddings([SHORT], 'local');

    const cos = cosineSimilarity(single, batched);
    const mad = maxAbsDiff(single, batched);
    expect(mad).toBeLessThan(3e-4);
    expect(cos).toBeGreaterThan(0.999985);
  }, 120_000);

  it('empty batch returns empty array', async () => {
    const results = await generateEmbeddings([], 'local');
    expect(results).toEqual([]);
  }, 120_000);
});
