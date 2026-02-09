#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

function devLocal(platform) {
  if (platform === 'claude') {
    return {
      mcpServers: {
        'sweet-search': {
          command: 'node',
          args: ['./mcp/server.js'],
        },
      },
    };
  }

  // codex
  return [
    '[mcp_servers.sweet-search]',
    'command = "node"',
    'args = ["./mcp/server.js"]',
  ].join('\n');
}

function externalProject(platform, targetPath) {
  const serverPath = path.resolve(PROJECT_ROOT, 'mcp', 'server.js');
  const target = targetPath ? path.resolve(targetPath) : '/absolute/path/to/target-project';

  if (platform === 'claude') {
    return {
      mcpServers: {
        'sweet-search': {
          command: 'node',
          args: [serverPath, '--project-root', target],
          env: {
            SWEET_SEARCH_PROJECT_ROOT: target,
          },
        },
      },
    };
  }

  // codex
  return [
    '[mcp_servers.sweet-search]',
    `command = "node"`,
    `args = ["${serverPath}"]`,
    `cwd = "${target}"`,
    `env = { "SWEET_SEARCH_PROJECT_ROOT" = "${target}" }`,
    '# enabled = true',
    '# startup_timeout_sec = 15',
    '# tool_timeout_sec = 120',
    '# enabled_tools = ["search", "health"]',
    '# disabled_tools = []',
  ].join('\n');
}

function published(platform) {
  if (platform === 'claude') {
    return {
      mcpServers: {
        'sweet-search': {
          command: 'npx',
          args: ['-y', 'sweet-search-mcp'],
        },
      },
    };
  }

  // codex
  return [
    '[mcp_servers.sweet-search]',
    'command = "npx"',
    'args = ["-y", "sweet-search-mcp"]',
    '# env = { "SWEET_SEARCH_PROJECT_ROOT" = "/path/to/project" }',
    '# enabled = true',
    '# startup_timeout_sec = 15',
    '# tool_timeout_sec = 120',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const platform = args[0] || 'claude';
const profileIdx = args.indexOf('--profile');
const profile = profileIdx !== -1 ? args[profileIdx + 1] : 'dev-local';
const targetIdx = args.indexOf('--target');
const targetPath = targetIdx !== -1 ? args[targetIdx + 1] : undefined;

if (!['claude', 'codex'].includes(platform)) {
  console.error(`Usage: node mcp/config-gen.js [claude|codex] [--profile dev-local|external-project|published] [--target <path>]`);
  process.exit(1);
}

const profiles = { 'dev-local': devLocal, 'external-project': externalProject, published };
const generator = profiles[profile];

if (!generator) {
  console.error(`Unknown profile: ${profile}. Available: ${Object.keys(profiles).join(', ')}`);
  process.exit(1);
}

const result = generator(platform, targetPath);

if (typeof result === 'string') {
  console.log(result);
} else {
  console.log(JSON.stringify(result, null, 2));
}
