export function hasAblation(ablations, name) {
  return ablations instanceof Set
    ? ablations.has(name)
    : Array.isArray(ablations) && ablations.includes(name);
}
