#!/usr/bin/env node
import net from 'node:net';
import path from 'node:path';

const MAX_RESPONSE_BYTES = 256 * 1024;
const TIMEOUT_MS = 15_000;
const COMMAND_RE = /^ss-(search|grep|find|read|batch)$/;

function refuse(message) {
  process.stderr.write(`phase2a synthetic tool refused: ${message}\n`);
  process.exitCode = 2;
}

const command = path.basename(process.argv[1] || '');
const socketPath = process.env.SS_PHASE2A_TOOL_SOCKET;
if (!COMMAND_RE.test(command)) refuse('unsupported command');
else if (!socketPath || !path.isAbsolute(socketPath) || socketPath.includes('\0')) refuse('invalid broker socket');
else {
  const request = `${JSON.stringify({
    protocol: 1,
    command,
    argv: process.argv.slice(2),
  })}\n`;
  if (Buffer.byteLength(request) > 64 * 1024) refuse('request too large');
  else {
    const client = net.createConnection(socketPath);
    let body = '';
    let settled = false;
    const finish = (code, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      if (message) process.stderr.write(`${message}\n`);
      process.exitCode = code;
    };
    const timer = setTimeout(() => finish(2, 'phase2a synthetic tool timed out'), TIMEOUT_MS);
    timer.unref?.();
    client.setEncoding('utf8');
    client.once('connect', () => client.end(request));
    client.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) finish(2, 'phase2a synthetic response too large');
    });
    client.once('error', () => finish(2, 'phase2a synthetic broker unavailable'));
    client.once('end', () => {
      if (settled) return;
      let response;
      try { response = JSON.parse(body); } catch { finish(2, 'phase2a synthetic broker returned invalid JSON'); return; }
      if (!response || typeof response.stdout !== 'string' || typeof response.stderr !== 'string'
          || !Number.isInteger(response.exitCode) || response.exitCode < 0 || response.exitCode > 255) {
        finish(2, 'phase2a synthetic broker returned an invalid response');
        return;
      }
      if (response.stdout) process.stdout.write(response.stdout);
      if (response.stderr) process.stderr.write(response.stderr);
      finish(response.exitCode);
    });
  }
}
