#!/usr/bin/env node
/**
 * Fake daemon for session-daemon-prewarm tests. Writes a marker file
 * so tests can verify the hook actually spawned something, then exits.
 * Never binds a socket — the hook's socket probe is separately exercised
 * via real unix sockets in the test file itself.
 */

import { writeFileSync, appendFileSync } from 'node:fs';

const marker = process.env.FAKE_DAEMON_MARKER;
if (marker) {
  appendFileSync(marker, `${process.pid}:${Date.now()}:${process.argv.slice(2).join(' ')}\n`);
}

// Exit quickly. The hook detaches and unrefs, so it doesn't care about our
// lifetime. Tests poll the marker file for evidence of spawn.
process.exit(0);
