import http from 'node:http';

/**
 * One HTTP request to a daemon over its unix socket.
 *
 * Resolves `{ status, body }` once the response ends (`body` is the raw text),
 * or `{ status, body: '' }` as soon as the response starts when
 * `resolveOnResponse` is set. Rejects with the request error (its `code` is
 * kept), or with an Error whose `timedOut` is true when the socket is idle for
 * `timeoutMs`. A non-200 status is not an error.
 *
 * @param {string} socketPath
 * @param {string} path
 * @param {{ method?: string, timeoutMs?: number, resolveOnResponse?: boolean }} [options]
 * @returns {Promise<{ status: number, body: string }>}
 */
export function daemonRequest(socketPath, path, { method = 'GET', timeoutMs, resolveOnResponse = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method }, (res) => {
      if (resolveOnResponse) {
        res.resume();
        resolve({ status: res.statusCode, body: '' });
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (timeoutMs !== undefined) {
      req.setTimeout(timeoutMs, () => {
        const err = new Error('timeout');
        err.timedOut = true;
        reject(err);
        req.destroy();
      });
    }
    req.end();
  });
}
