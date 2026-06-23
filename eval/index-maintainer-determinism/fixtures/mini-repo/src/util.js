// util.js — base fixture file. A dependency target: other files import from it.
export function trimAll(input) {
  return String(input).trim();
}

export function repeat(value, times) {
  let out = '';
  for (let i = 0; i < times; i += 1) out += value;
  return out;
}
