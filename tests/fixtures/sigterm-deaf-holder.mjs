#!/usr/bin/env node
/**
 * A LOCK HOLDER THAT DOES NOT ANSWER SIGTERM.
 *
 * This models the one case the takeover protocol has to get right and cannot
 * observe directly: a maintainer blocked inside a long native call — a large
 * re-embed, a stalled network filesystem — for longer than the grace period. It
 * is alive, it is the rightful owner of the repository, and it will resume.
 *
 * A fixture that exits on SIGTERM (fake-maintainer-longlived.mjs) cannot
 * exercise this at all: it always dies inside the grace window, so the "the
 * incumbent is still there" branch is never taken. Here the signal handler is
 * installed and deliberately does nothing, which is what an uninterruptible
 * syscall looks like from outside.
 *
 * It exits on SIGKILL, and on its own hard TTL, so a missed cleanup costs
 * seconds rather than a permanent resident process.
 */

process.on('SIGTERM', () => { /* deliberately deaf */ });
process.on('SIGINT', () => { /* deliberately deaf */ });

const ttl = Number(process.env.DEAF_HOLDER_TTL_MS) > 0 ? Number(process.env.DEAF_HOLDER_TTL_MS) : 60_000;
setTimeout(() => process.exit(0), ttl);
setInterval(() => {}, 1 << 30);
process.stdout.write('ready\n');
