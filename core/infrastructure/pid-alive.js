/**
 * Is a process with this pid alive right now? A `kill -0` probe: a pid that
 * another user owns (EPERM) counts as alive. Anything but a positive integer
 * is not alive. A zombie counts as alive: use a start-time check where that matters.
 */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}
