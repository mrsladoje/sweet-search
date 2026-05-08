/**
 * MCP Server contract tests (B6a/B6b from MCP_PLAN.md)
 *
 * Tests protocol compliance, tool annotations, outputSchema presence,
 * and structured output conformance — without requiring a live search index.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '../..', 'mcp', 'server.js');

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function jsonRpcRequest(method, params = {}, id = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

function jsonRpcNotification(method, params = {}) {
  return JSON.stringify({ jsonrpc: '2.0', method, params });
}

/**
 * Spawn the MCP server, send a sequence of JSON-RPC messages, collect responses.
 * Returns an array of parsed JSON-RPC response objects.
 */
async function mcpSession(messages, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SERVER_PATH], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: path.join(__dirname, '..', '..') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    const responses = [];
    let timer;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      // Parse complete JSON-RPC lines
      const lines = stdout.split('\n');
      stdout = lines.pop(); // keep incomplete tail
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          responses.push(JSON.parse(trimmed));
        } catch { /* ignore non-JSON lines */ }
      }
    });

    child.on('error', reject);

    child.on('close', () => {
      // Parse any remaining data
      if (stdout.trim()) {
        try { responses.push(JSON.parse(stdout.trim())); } catch { /* ignore */ }
      }
      clearTimeout(timer);
      resolve(responses);
    });

    // Send messages with small delays to ensure ordering
    (async () => {
      for (const msg of messages) {
        child.stdin.write(msg + '\n');
        await new Promise(r => setTimeout(r, 100));
      }
      // Give server time to respond, then close stdin
      timer = setTimeout(() => {
        child.stdin.end();
        setTimeout(() => child.kill(), 500);
      }, timeoutMs - 1000);
    })();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Server Protocol Compliance', () => {
  let initResponse;
  let toolsResponse;
  let resourcesResponse;
  let promptsResponse;

  beforeAll(async () => {
    const messages = [
      jsonRpcRequest('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      }, 1),
      jsonRpcNotification('notifications/initialized'),
      jsonRpcRequest('tools/list', {}, 2),
      jsonRpcRequest('resources/list', {}, 3),
      jsonRpcRequest('prompts/list', {}, 4),
    ];

    const responses = await mcpSession(messages, { timeoutMs: 8000 });

    initResponse = responses.find(r => r.id === 1);
    toolsResponse = responses.find(r => r.id === 2);
    resourcesResponse = responses.find(r => r.id === 3);
    promptsResponse = responses.find(r => r.id === 4);
  }, 15000);

  // B6a #1: Initialize handshake
  describe('Initialize handshake', () => {
    it('returns protocolVersion', () => {
      expect(initResponse).toBeDefined();
      expect(initResponse.result).toBeDefined();
      expect(initResponse.result.protocolVersion).toBeDefined();
    });

    it('returns capabilities with tools, resources, prompts', () => {
      const caps = initResponse.result.capabilities;
      expect(caps).toBeDefined();
      expect(caps.tools).toBeDefined();
      expect(caps.resources).toBeDefined();
      expect(caps.prompts).toBeDefined();
    });

    it('returns serverInfo', () => {
      expect(initResponse.result.serverInfo).toBeDefined();
      expect(initResponse.result.serverInfo.name).toBe('sweet-search');
    });
  });

  // B6a #2: Tool listing
  describe('Tool listing', () => {
    it('returns 8 tools: search, trace, index, health, repo-map, vocab-prewarm, read, read-semantic', () => {
      // `read` and `read-semantic` were added in commit e82ab61
      // (feat(search): add filesystem-grounded read tools). The
      // tool list is the externally-observable MCP surface; bumping
      // the expected count here when adding a new tool is part of
      // the tool-add change.
      expect(toolsResponse).toBeDefined();
      const tools = toolsResponse.result.tools;
      expect(tools).toHaveLength(8);

      const names = tools.map(t => t.name).sort();
      expect(names).toEqual([
        'health', 'index', 'read', 'read-semantic',
        'repo-map', 'search', 'trace', 'vocab-prewarm',
      ]);
    });

    it('each tool has inputSchema', () => {
      for (const tool of toolsResponse.result.tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    // B6a #2 + B6b: annotations
    it('each tool has annotations', () => {
      for (const tool of toolsResponse.result.tools) {
        expect(tool.annotations).toBeDefined();
        expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
        expect(typeof tool.annotations.destructiveHint).toBe('boolean');
        expect(typeof tool.annotations.idempotentHint).toBe('boolean');
        expect(typeof tool.annotations.openWorldHint).toBe('boolean');
      }
    });

    it('search tool is readOnly and idempotent', () => {
      const search = toolsResponse.result.tools.find(t => t.name === 'search');
      expect(search.annotations.readOnlyHint).toBe(true);
      expect(search.annotations.destructiveHint).toBe(false);
      expect(search.annotations.idempotentHint).toBe(true);
    });

    it('index tool is not readOnly and not idempotent', () => {
      const index = toolsResponse.result.tools.find(t => t.name === 'index');
      expect(index.annotations.readOnlyHint).toBe(false);
      expect(index.annotations.destructiveHint).toBe(false);
      expect(index.annotations.idempotentHint).toBe(false);
    });

    // B6b: outputSchema
    it('each tool has outputSchema', () => {
      for (const tool of toolsResponse.result.tools) {
        expect(tool.outputSchema).toBeDefined();
        expect(tool.outputSchema.type).toBe('object');
        expect(tool.outputSchema.properties).toBeDefined();
      }
    });

    it('search outputSchema has required fields', () => {
      const search = toolsResponse.result.tools.find(t => t.name === 'search');
      const props = search.outputSchema.properties;
      expect(props.results).toBeDefined();
      expect(props.totalFound).toBeDefined();
      expect(props.mode).toBeDefined();
      expect(props.queryTimeMs).toBeDefined();
    });

    it('health outputSchema has required fields', () => {
      const health = toolsResponse.result.tools.find(t => t.name === 'health');
      const props = health.outputSchema.properties;
      expect(props.healthy).toBeDefined();
      expect(props.projectRoot).toBeDefined();
      expect(props.subsystems).toBeDefined();
    });

    it('index outputSchema has required fields', () => {
      const index = toolsResponse.result.tools.find(t => t.name === 'index');
      const props = index.outputSchema.properties;
      expect(props.success).toBeDefined();
      expect(props.mode).toBeDefined();
    });

    // P4: tool descriptions follow the optimized "when to use" framing.
    // These are smoke checks — rewrites that drop the replacement / cross-
    // reference framing will fail here and force a deliberate re-think.
    describe('P4: optimized descriptions', () => {
      it('every tool has a non-trivial description (≥ 60 chars)', () => {
        for (const tool of toolsResponse.result.tools) {
          expect(tool.description, `${tool.name} description`).toBeDefined();
          expect(tool.description.length, `${tool.name} description length`).toBeGreaterThan(60);
        }
      });

      it('descriptions stay under 800 chars (MCP-friendly, agent-budget friendly)', () => {
        for (const tool of toolsResponse.result.tools) {
          expect(tool.description.length, `${tool.name} description bloat`).toBeLessThan(800);
        }
      });

      it('search description tells the agent to use it INSTEAD OF native Grep', () => {
        const search = toolsResponse.result.tools.find(t => t.name === 'search');
        expect(search.description).toMatch(/INSTEAD OF/i);
        expect(search.description).toMatch(/grep/i);
      });

      it('read description tells the agent to use it INSTEAD OF native Read', () => {
        const read = toolsResponse.result.tools.find(t => t.name === 'read');
        expect(read.description).toMatch(/INSTEAD OF/i);
        expect(read.description.toLowerCase()).toContain('native read');
      });

      it('trace description disambiguates from search', () => {
        const trace = toolsResponse.result.tools.find(t => t.name === 'trace');
        expect(trace.description).toMatch(/who calls|callers|callees|impact/i);
        expect(trace.description).toMatch(/`search`/);
      });

      it('repo-map description routes general lookups to search', () => {
        const repoMap = toolsResponse.result.tools.find(t => t.name === 'repo-map');
        expect(repoMap.description).toMatch(/`search`/);
      });

      it('read-semantic description routes multi-file flow to search', () => {
        const rs = toolsResponse.result.tools.find(t => t.name === 'read-semantic');
        expect(rs.description).toMatch(/multi-file/i);
        expect(rs.description).toMatch(/`search`/);
      });
    });
  });

  // B6a #3: Resource listing
  describe('Resource listing', () => {
    it('returns 2 resources', () => {
      expect(resourcesResponse).toBeDefined();
      const resources = resourcesResponse.result.resources;
      expect(resources).toHaveLength(2);
    });

    it('includes sweet-search://status and sweet-search://config', () => {
      const uris = resourcesResponse.result.resources.map(r => r.uri).sort();
      expect(uris).toEqual(['sweet-search://config', 'sweet-search://status']);
    });
  });

  // B6a #5: Prompt listing
  describe('Prompt listing', () => {
    it('returns 2 prompts', () => {
      expect(promptsResponse).toBeDefined();
      const prompts = promptsResponse.result.prompts;
      expect(prompts).toHaveLength(2);
    });

    it('includes search-codebase and explain-code', () => {
      const names = promptsResponse.result.prompts.map(p => p.name).sort();
      expect(names).toEqual(['explain-code', 'search-codebase']);
    });

    it('search-codebase has query argument', () => {
      const prompt = promptsResponse.result.prompts.find(p => p.name === 'search-codebase');
      expect(prompt.arguments).toBeDefined();
      const queryArg = prompt.arguments.find(a => a.name === 'query');
      expect(queryArg).toBeDefined();
      expect(queryArg.required).toBe(true);
    });
  });
});

// B6c #13: stdout hygiene
describe('MCP Server stdout hygiene', () => {
  it('stdout contains only valid JSON-RPC lines', async () => {
    const messages = [
      jsonRpcRequest('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      }, 1),
      jsonRpcNotification('notifications/initialized'),
    ];

    const child = spawn('node', [SERVER_PATH], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, SWEET_SEARCH_PROJECT_ROOT: path.join(__dirname, '..', '..') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rawStdout = await new Promise((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', (chunk) => { buf += chunk.toString(); });
      child.on('error', reject);

      // Send messages
      (async () => {
        for (const msg of messages) {
          child.stdin.write(msg + '\n');
          await new Promise(r => setTimeout(r, 100));
        }
        // Wait for response, then terminate
        await new Promise(r => setTimeout(r, 1500));
        child.stdin.end();
        child.kill('SIGTERM');
      })();

      child.on('close', () => resolve(buf));
      // Safety: force-kill after 5s
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
    });

    // Every non-empty line on stdout must be valid JSON-RPC
    const lines = rawStdout.split('\n').filter(l => l.trim());
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      const parsed = JSON.parse(line); // will throw if not valid JSON
      expect(parsed.jsonrpc).toBe('2.0');
    }
  }, 15000);
});
