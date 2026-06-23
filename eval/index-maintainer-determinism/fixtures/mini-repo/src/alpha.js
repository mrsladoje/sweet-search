// alpha.js — base fixture file. Imports from util.js so a util change
// flows into alpha's enriched embedding text (dependency-change edit).
import { trimAll } from './util.js';

export function alphaGreet(name) {
  return 'hello ' + trimAll(name);
}

export function alphaCount(items) {
  return items.length;
}
