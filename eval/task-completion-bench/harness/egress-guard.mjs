#!/usr/bin/env node
/**
 * egress-guard — hostname-ALLOWLIST egress for the agent jail (P0 vector V4).
 *
 * WHY a proxy and not /etc/hosts: the 2026-07 held-out forensics proved the DNS-block
 * approach (bench-net-lockdown.sh) is not an egress control. Only github.com was
 * blocked; cdn.jsdelivr.net / unpkg / proxy.golang.org all worked, and api.github.com
 * was reachable by IP-pinning (`curl --resolve`), which bypasses /etc/hosts entirely.
 * 13 of native's 16 discordant wins were ground-truth-assisted, most of them through
 * this hole. A blocklist can never be complete; an allowlist can.
 *
 * MECHANISM (routing, not filtering — the jail has no path to the internet at all):
 *
 *   [agent jail] --- veth --- [host]
 *    netns ssbench            10.201.0.1
 *    10.201.0.2
 *      |
 *      +-- default route -> 10.201.0.1 ONLY. No NAT/masquerade exists for this
 *          subnet and FORWARD from it is REJECTed, so a packet addressed to any
 *          real internet IP dies at the host with icmp-admin-prohibited. This is
 *          what kills IP-pinning: there is no route, so there is nothing to pin.
 *      +-- resolv.conf -> 10.201.0.1. Our stub DNS answers EVERY name with
 *          10.201.0.1, so all name-based traffic is funnelled into this process.
 *      +-- 10.201.0.1:443 -> SNI-inspecting TCP proxy. We read the TLS
 *          ClientHello, take the real hostname, and connect out ONLY if it is on
 *          the allowlist. TLS stays end-to-end (we pipe bytes, never terminate),
 *          so certificate validation in the agent is untouched — no MITM CA.
 *      +-- 10.201.0.1:{80,9418} -> logging tarpits (plain HTTP / git protocol).
 *
 * Every refusal is appended to denials.ndjson. That file is the FIRST real escape
 * signal this bench has ever had on the network side: `escape=0` used to be a
 * hardcoded literal (see PLAN.md §1.2), it is now a measurement.
 *
 * Usage:
 *   node egress-guard.mjs up [--allow host,host]   create netns + start proxy
 *   node egress-guard.mjs down                     tear everything down
 *   node egress-guard.mjs status                   ACTIVE / inactive (+ counters)
 *   node egress-guard.mjs serve                    (internal) run the proxy in fg
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, rmSync, openSync } from 'node:fs';
import net from 'node:net';
import dgram from 'node:dgram';
import path from 'node:path';
import { lookup as dnsLookup } from 'node:dns';

export const NS = process.env.SS_JAIL_NETNS || 'ssbench';
export const HOST_IP = '10.201.0.1';
export const NS_IP = '10.201.0.2';
const SUBNET = '10.201.0.0/30';
const VETH_H = 'ssb-h';
const VETH_C = 'ssb-c';

const STATE_DIR = process.env.SS_JAIL_STATE || path.join(process.env.HOME || '/root', '.ss-eval', 'egress-guard');
export const DENY_LOG = path.join(STATE_DIR, 'denials.ndjson');
const ALLOW_FILE = path.join(STATE_DIR, 'allowlist.json');
const PID_FILE = path.join(STATE_DIR, 'proxy.pid');
const LOG_FILE = path.join(STATE_DIR, 'proxy.log');

// The ONLY hosts an agent rollout is allowed to reach. Model inference only.
// Anything that could carry repository content, upstream patches, package
// registries or dataset rows is deliberately absent — including npm/pypi, which
// were how several "upstream exposure" wins were assembled.
const DEFAULT_ALLOW = ['openrouter.ai'];

const sh = (bin, args, opts = {}) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const shq = (bin, args) => { try { return sh(bin, args); } catch { return null; } };

function loadAllow() {
  try { return JSON.parse(readFileSync(ALLOW_FILE, 'utf8')); } catch { return DEFAULT_ALLOW; }
}
// exact host or a dot-suffix subdomain match; never a bare substring
export function hostAllowed(host, allow = loadAllow()) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  return allow.some(a => h === a || h.endsWith('.' + a));
}

function denyLog(rec) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(DENY_LOG, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n');
  } catch { /* never let auditing break a run */ }
}

// ---------------------------------------------------------------- TLS SNI parse
// Minimal ClientHello SNI extractor. Returns null when the bytes are not a TLS
// handshake or the record is incomplete (caller waits for more data).
export function parseSNI(buf) {
  try {
    if (buf.length < 5 || buf[0] !== 0x16) return null;            // not a TLS handshake record
    const recLen = buf.readUInt16BE(3);
    if (buf.length < 5 + recLen) return undefined;                  // incomplete → wait
    let p = 5;
    if (buf[p] !== 0x01) return null;                               // not ClientHello
    p += 4;                                                          // handshake header
    p += 2 + 32;                                                     // version + random
    p += 1 + buf[p];                                                 // session id
    p += 2 + buf.readUInt16BE(p);                                    // cipher suites
    p += 1 + buf[p];                                                 // compression methods
    if (p + 2 > buf.length) return null;
    const extEnd = p + 2 + buf.readUInt16BE(p); p += 2;
    while (p + 4 <= extEnd && p + 4 <= buf.length) {
      const type = buf.readUInt16BE(p), len = buf.readUInt16BE(p + 2); p += 4;
      if (type === 0x0000) {                                         // server_name
        let q = p + 2;                                               // server_name_list length
        while (q + 3 <= p + len) {
          const nameType = buf[q], nameLen = buf.readUInt16BE(q + 1);
          if (nameType === 0) return buf.slice(q + 3, q + 3 + nameLen).toString('utf8');
          q += 3 + nameLen;
        }
        return null;
      }
      p += len;
    }
    return null;
  } catch { return null; }
}

// ---------------------------------------------------------------- stub resolver
// Answers every A query with HOST_IP so all name-based traffic is funnelled into
// the proxy, where the SNI (not the DNS answer) decides allow/deny. AAAA is
// answered empty so clients fall back to IPv4 instead of hanging.
function startDns() {
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => {
    try {
      if (msg.length < 12) return;
      const qdcount = msg.readUInt16BE(4);
      if (qdcount < 1) return;
      let p = 12; const labels = [];
      while (p < msg.length && msg[p] !== 0) { const l = msg[p]; labels.push(msg.slice(p + 1, p + 1 + l).toString('latin1')); p += 1 + l; }
      const qend = p + 1 + 4;
      if (qend > msg.length) return;
      const qtype = msg.readUInt16BE(p + 1);
      const name = labels.join('.');
      const header = Buffer.alloc(12);
      msg.copy(header, 0, 0, 12);
      header.writeUInt16BE(0x8180, 2);                    // QR + RD + RA, NOERROR
      header.writeUInt16BE(1, 4);                         // QDCOUNT
      header.writeUInt16BE(qtype === 1 ? 1 : 0, 6);       // ANCOUNT: A only
      header.writeUInt16BE(0, 8); header.writeUInt16BE(0, 10);
      const question = msg.slice(12, qend);
      let answer = Buffer.alloc(0);
      if (qtype === 1) {
        answer = Buffer.concat([
          Buffer.from([0xc0, 0x0c]),                      // name pointer → offset 12
          Buffer.from([0x00, 0x01, 0x00, 0x01]),          // A, IN
          Buffer.from([0x00, 0x00, 0x00, 0x1e]),          // TTL 30
          Buffer.from([0x00, 0x04]),                      // RDLENGTH
          Buffer.from(HOST_IP.split('.').map(Number)),
        ]);
      }
      sock.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address);
      if (!hostAllowed(name)) denyLog({ kind: 'dns', host: name, qtype });
    } catch { /* malformed query — ignore */ }
  });
  sock.bind(53, HOST_IP);
  return sock;
}

// ---------------------------------------------------------------- SNI proxy
function startTls() {
  const srv = net.createServer(sock => {
    let buf = Buffer.alloc(0); let decided = false;
    sock.on('error', () => {});
    sock.setTimeout(30000, () => sock.destroy());
    sock.on('data', chunk => {
      if (decided) return;
      buf = Buffer.concat([buf, chunk]);
      const sni = parseSNI(buf);
      if (sni === undefined && buf.length < 16384) return;            // need more bytes
      decided = true;
      if (!sni || !hostAllowed(sni)) {
        denyLog({ kind: 'tls', port: 443, host: sni || '(no-sni)', bytes: buf.length });
        sock.end();                                                   // fail fast, don't hang the agent
        return;
      }
      // Resolve through the HOST resolver (the jail's stub always says 10.201.0.1).
      dnsLookup(sni, { family: 4 }, (err, addr) => {
        if (err) { denyLog({ kind: 'tls-resolve-fail', host: sni, err: String(err.code || err) }); sock.destroy(); return; }
        const up = net.connect(443, addr, () => { up.write(buf); sock.pipe(up); up.pipe(sock); });
        up.on('error', () => sock.destroy());
        sock.on('close', () => up.destroy());
      });
    });
  });
  srv.on('error', e => console.error('[egress-guard] 443 listener error', e.message));
  srv.listen(443, HOST_IP);
  return srv;
}

// Plain-HTTP / git-protocol tarpits: nothing is ever allowed in clear text, but we
// want the ATTEMPT on the record rather than an opaque connection refused.
function startTarpit(port, kind) {
  const srv = net.createServer(sock => {
    let buf = '';
    sock.on('error', () => {});
    sock.setTimeout(5000, () => sock.destroy());
    sock.on('data', d => {
      buf += d.toString('latin1').slice(0, 512);
      const host = (buf.match(/^Host:\s*(\S+)/im) || [])[1] || (buf.match(/host=([^\0]+)\0/) || [])[1] || '(unknown)';
      denyLog({ kind, port, host, head: buf.slice(0, 120).replace(/\r?\n/g, ' ') });
      if (port === 80) sock.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 44\r\n\r\n[egress-guard] host not on bench allowlist\r\n');
      else sock.destroy();
    });
  });
  srv.on('error', () => {});
  srv.listen(port, HOST_IP);
  return srv;
}

function serve() {
  mkdirSync(STATE_DIR, { recursive: true });
  startDns(); startTls(); startTarpit(80, 'http'); startTarpit(9418, 'git');
  console.log(`[egress-guard] serving on ${HOST_IP} (allow: ${loadAllow().join(', ')})`);
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1 << 30);
}

// ---------------------------------------------------------------- up / down
function nsExists() { return existsSync(`/var/run/netns/${NS}`); }
function proxyAlive() {
  try { process.kill(Number(readFileSync(PID_FILE, 'utf8').trim()), 0); return true; } catch { return false; }
}

function up(allow) {
  if (process.platform !== 'linux') throw new Error('egress-guard requires Linux (netns)');
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(ALLOW_FILE, JSON.stringify(allow && allow.length ? allow : DEFAULT_ALLOW));
  if (!nsExists()) {
    sh('ip', ['netns', 'add', NS]);
    shq('ip', ['link', 'del', VETH_H]);                        // stale peer from a crashed run
    sh('ip', ['link', 'add', VETH_H, 'type', 'veth', 'peer', 'name', VETH_C]);
    sh('ip', ['link', 'set', VETH_C, 'netns', NS]);
    sh('ip', ['addr', 'add', `${HOST_IP}/30`, 'dev', VETH_H]);
    sh('ip', ['link', 'set', VETH_H, 'up']);
    sh('ip', ['-n', NS, 'addr', 'add', `${NS_IP}/30`, 'dev', VETH_C]);
    sh('ip', ['-n', NS, 'link', 'set', VETH_C, 'up']);
    sh('ip', ['-n', NS, 'link', 'set', 'lo', 'up']);
    sh('ip', ['-n', NS, 'route', 'add', 'default', 'via', HOST_IP]);
  }
  // Belt and braces: even if some other rule enables forwarding/masquerade for the
  // box, this REJECT is inserted first, so a jail packet aimed at a real internet
  // address is refused immediately instead of being silently dropped (fast failure
  // keeps a probing agent from burning its wall clock on a hang).
  shq('iptables', ['-D', 'FORWARD', '-s', SUBNET, '-j', 'REJECT', '--reject-with', 'icmp-admin-prohibited']);
  sh('iptables', ['-I', 'FORWARD', '1', '-s', SUBNET, '-j', 'REJECT', '--reject-with', 'icmp-admin-prohibited']);
  if (!proxyAlive()) {
    const out = openSync(LOG_FILE, 'a');
    const p = spawn(process.execPath, [new URL(import.meta.url).pathname, 'serve'], { detached: true, stdio: ['ignore', out, out] });
    p.unref();
    writeFileSync(PID_FILE, String(p.pid));
  }
  return { ns: NS, hostIp: HOST_IP, allow: loadAllow() };
}

function down() {
  try { process.kill(Number(readFileSync(PID_FILE, 'utf8').trim()), 'SIGTERM'); } catch { /* */ }
  rmSync(PID_FILE, { force: true });
  shq('iptables', ['-D', 'FORWARD', '-s', SUBNET, '-j', 'REJECT', '--reject-with', 'icmp-admin-prohibited']);
  shq('ip', ['netns', 'del', NS]);
  shq('ip', ['link', 'del', VETH_H]);
}

export function guardStatus() {
  return { ns: nsExists(), proxy: proxyAlive(), allow: loadAllow(), denyLog: DENY_LOG };
}
export function ensureGuard(allow) {
  const s = guardStatus();
  if (s.ns && s.proxy) return s;
  return up(allow);
}
// Denials recorded inside a wall-clock window — how a rollout gets attributed its
// own network-escape attempts (runs are CONCURRENCY=1 by standing policy).
export function denialsBetween(startMs, endMs) {
  try {
    return readFileSync(DENY_LOG, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(d => d && Date.parse(d.ts) >= startMs && Date.parse(d.ts) <= endMs);
  } catch { return []; }
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === path.resolve(process.argv[1]);
if (isMain) {
  const cmd = process.argv[2] || 'status';
  const allowArg = (process.argv.find(a => a.startsWith('--allow=')) || '').split('=')[1];
  const allow = allowArg ? allowArg.split(',').map(s => s.trim()).filter(Boolean) : null;
  if (cmd === 'up') console.log(JSON.stringify(up(allow), null, 2));
  else if (cmd === 'down') { down(); console.log('egress-guard down'); }
  else if (cmd === 'serve') serve();
  else console.log(JSON.stringify(guardStatus(), null, 2));
}
