// P6 BEHAVIOURAL CERTIFICATE — what the public actor surface ACTUALLY is at runtime.
//
// Runs INSIDE a materialized CodeceptJS tree (see p6-surface-replay.mjs). Emits one JSON
// line on stdout. Static types cannot observe any of this: enumerability is a property
// descriptor, and "deferred into the recorder" is a temporal fact about a call.
//
// Reads NOTHING from gold: it stubs one helper, builds the actor through the tree's own
// lib/actor.js, and reports what came out.
'use strict';
const path = require('path');
const Module = require('module');

const REPO = process.env.REPO || process.cwd();
const L = (p) => path.join(REPO, 'lib', p);
const NAMES = (process.env.NAMES || 'say,comment,remark').split(',');

const out = { ok: false, error: null, enumerable: [], allOwn: [], perName: {}, helperMethods: [] };

try {
  const Helper = require(L('helper'));
  const container = require(L('container'));

  // One helper, exactly as a real config would install it: a subclass of Helper carrying a
  // couple of ordinary steps. Whether the patch put `comment` on THIS class or on Helper
  // itself is precisely what the certificate is here to observe.
  class ProbeHelper extends Helper {
    click(locator) { return `clicked ${locator}`; }
    see(text) { return `saw ${text}`; }
  }
  const helper = new ProbeHelper({});
  const methodsOfObject = require(L('utils')).methodsOfObject;
  out.helperMethods = methodsOfObject(helper, 'Helper');

  // Stub the container rather than booting a config: the actor factory only ever asks it for
  // helpers and a translation.
  container.helpers = () => ({ ProbeHelper: helper });
  // The real translation() returns null (or an object without actionAliasFor) until a config
  // is loaded, and actor.js calls actionAliasFor unconditionally. Always hand it a complete
  // no-op translation — the certificate is about the SURFACE, not about localisation.
  const realTranslation = container.translation;
  container.translation = () => {
    let t = null;
    try { t = realTranslation(); } catch (e) { t = null; }
    if (t && typeof t.actionAliasFor === 'function') return t;
    return { loaded: false, I: 'I', actionAliasFor: (a) => a };
  };

  const recorder = require(L('recorder'));
  const I = require(L('actor'))();

  out.enumerable = Object.keys(I);
  out.allOwn = Object.getOwnPropertyNames(I);

  for (const name of NAMES) {
    const present = out.allOwn.includes(name);
    const rec = {
      present,
      enumerable: present ? Object.prototype.propertyIsEnumerable.call(I, name) : null,
      onActor: present,
      deferred: null,
      immediateBytes: null,
      callError: null,
    };
    if (present && typeof I[name] === 'function') {
      // ORDERING + TIMING. A queued step adds work to the recorder and writes NOTHING at
      // call time; a step that prints immediately writes bytes here and queues nothing.
      let added = 0;
      const realAdd = recorder.add;
      recorder.add = function (...args) { added++; try { return realAdd.apply(this, args); } catch (e) { return undefined; } };
      let bytes = 0;
      const realWrite = process.stdout.write;
      process.stdout.write = function (chunk, ...rest) { bytes += Buffer.byteLength(String(chunk)); return true; };
      try { I[name]('probe message'); }
      catch (e) { rec.callError = String(e && e.message || e).slice(0, 200); }
      finally { process.stdout.write = realWrite; recorder.add = realAdd; }
      rec.deferred = added > 0;
      rec.immediateBytes = bytes;
    }
    out.perName[name] = rec;
  }
  out.ok = true;
} catch (e) {
  out.error = String(e && e.stack || e).slice(0, 600);
}
process.stdout.write('\n@@P6CERT@@' + JSON.stringify(out) + '\n');
