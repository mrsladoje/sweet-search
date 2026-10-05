import { isTestLikePath } from './test-paths.js';

function qualifierTerms(qualifier) {
  const raw = String(qualifier || '').toLowerCase();
  return [raw, ...raw.split(/[^a-z0-9]+/)].filter(t => t.length >= 3);
}

export function shouldTrustQualifiedResolution(targetName, entity) {
  // Rust `recv.name(` is method-call syntax: it reaches a method of an impl or trait, never a
  // free function (those are called by path, `a::f(`). jj `working_copy_path.clone()` was
  // bound to the free `fn clone` in lib/testutils/src/git.rs.
  if (rustMethodCallOnFreeFunction(targetName, entity)) return false;
  const normalized = String(targetName || '').replace(/::/g, '.');
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length < 2 || !entity?.name) return true;
  const leaf = parts[parts.length - 1].toLowerCase();
  if (leaf !== String(entity.name).toLowerCase()) return true;
  const qualifier = parts[parts.length - 2];
  const hay = `${entity.filePath || ''} ${entity.parentClass || ''} ${entity.package || ''} ${entity.signature || ''} ${entity.summary || ''}`.toLowerCase();
  return qualifierTerms(qualifier).some(term => hay.includes(term));
}

// Receivers that mean "the enclosing object", so a qualified edge like
// `this.fetch` can only belong to a target in the SAME class or file as the
// calling entity — never to an unrelated plain function that shares the name.
const SELF_QUALIFIERS = new Set(['this', 'self', 'super', 'cls', 'me', 'static']);

/**
 * Callee-side check of a stored call edge from `caller` to `resolved`. `self.x(` / `this.x(`
 * names no type, so the receiver-name test cannot apply: the build bound it to a method
 * (requests Session.request `self.merge_environment_settings(` was dropped).
 */
export function trustedCalleeEdge(targetName, resolved) {
  const parts = String(targetName || '').replace(/::/g, '.').split('.').filter(Boolean);
  if (parts.length === 2 && SELF_QUALIFIERS.has(parts[0]) && resolved?.parentClass) return true;
  return shouldTrustQualifiedResolution(targetName, resolved);
}

/**
 * Caller-side twin of shouldTrustQualifiedResolution: decide whether a stored
 * call edge (matched to `target` by name pattern) plausibly refers to that
 * target. `edge` carries the CALLING entity's fields (filePath, parentClass)
 * plus targetId/targetName from the relationship row.
 */
export function trustedCallerEdge(edge, target, namesakes = null) {
  const tn = String(edge?.targetName || '').trim();
  if (!tn || !target?.name) return true;
  if (edge.targetId && edge.targetId === target.id) return true;
  // Go: an unexported method is private to its package directory; a call from another package
  // cannot reach it (dgraph zero's `s.Node.proposeAndWait` listed as a caller of worker's
  // node.proposeAndWait).
  if (goPackagePrivateFrom(edge.filePath, target)) return false;
  // Resolution already bound this call to ANOTHER definition (a different
  // file or owning type): `database.statementDidFail` → Database's method is
  // not a caller of DatabaseObservationBroker.statementDidFail. Same file and
  // owner (an overload, or the same definition re-indexed) stays trusted.
  if (edge.targetId && edge.resolvedFile
    && (edge.resolvedFile !== target.filePath || (edge.resolvedParent || null) !== (target.parentClass || null))) {
    return false;
  }
  const parts = tn.replace(/::/g, '.').split('.').filter(Boolean);
  if (parts.length < 2) return true; // bare-name edge: exact match already
  const qualifier = parts[parts.length - 2].toLowerCase();
  if (SELF_QUALIFIERS.has(qualifier)) {
    if (edge.filePath && target.filePath && edge.filePath === target.filePath) return true;
    return !!(edge.parentClass && target.parentClass && edge.parentClass === target.parentClass);
  }
  const targetNames = [target.name, target.parentClass]
    .filter(Boolean)
    .map(s => String(s).toLowerCase());
  if (targetNames.includes(qualifier)) return true;
  if (!shouldTrustQualifiedResolution(tn, target)) return false;
  // A call the index bound to nothing, whose receiver fits another definition of the same
  // name as well (`$repository->findPackages(` and ArrayRepository, ComposerRepository,
  // RepositorySet, … all hold "repository"): the index refused to pick one, and the query
  // must not pick this one. Overloads in the target's own file and owner are no rivals.
  if (!edge.targetId && Array.isArray(namesakes)) {
    // Production code never calls into a test file's helper of the same name.
    const fromTest = isTestLikePath(edge.filePath || '');
    const rival = namesakes.some(n => n.id !== target.id
      && (fromTest || !isTestLikePath(n.filePath || ''))
      && (n.filePath !== target.filePath || (n.parentClass || null) !== (target.parentClass || null))
      && rivalFits(qualifier, n));
    if (rival) return false;
  }
  return true;
}

// A rival fits only when the receiver names its owner or file. The directory path does not
// count: in swift-argument-parser every file is under Sources/ArgumentParser/, so
// `RequiredArray_Argument_Transform.parse` "fit" CommandParser.parse through "argument".
function rivalFits(qualifier, n) {
  const owner = String(n.parentClass || '').toLowerCase();
  if (owner === qualifier) return true;
  const file = String(n.filePath || '').toLowerCase();
  const hay = `${file.slice(file.lastIndexOf('/') + 1)} ${owner}`;
  return qualifierTerms(qualifier).some(term => hay.includes(term));
}

function rustMethodCallOnFreeFunction(targetName, entity) {
  const raw = String(targetName || '');
  if (!/\.rs$/.test(String(entity?.filePath || '')) || entity?.parentClass) return false;
  if (!/(?:^|[^:])\.[A-Za-z_]\w*$/.test(raw) || raw.includes('::')) return false;
  return entity.type === 'function';
}

/** True when `target` is a Go method or function unexported from its package and `fromFile` is in another one. */
export function goPackagePrivateFrom(fromFile, target) {
  const file = String(target?.filePath || '');
  if (!/\.go$/.test(file) || !fromFile || !/\.go$/.test(String(fromFile))) return false;
  const dir = (f) => String(f).slice(0, String(f).lastIndexOf('/') + 1);
  if (dir(fromFile) === dir(file)) return false;
  // The method's own name decides: an exported method of an unexported type is reachable from
  // other packages through an interface or an exported constructor's return value.
  return /^[a-z_]/.test(String(target.name || ''));
}

/**
 * Python `pkg.name(` where `pkg` is a package directory of the definition's path (not its file,
 * not its owner): a package exposes module-level functions, never a method of a class (flask
 * tests' `flask.make_response()` bound to `Flask.make_response` in src/flask/app.py). Only a
 * candidate: the caller must also import `pkg` as a module (the repository checks) — `db` may
 * be a variable holding a Database from app/db/database.py.
 */
export function pythonPackageCallOnMethod(targetName, entity) {
  const file = String(entity?.filePath || '');
  if (!/\.py$/.test(file) || !entity?.parentClass) return false;
  const parts = String(targetName || '').split('.').filter(Boolean);
  if (parts.length < 2) return false;
  // Case-sensitive, as Python is: package `flask` is not class `Flask`.
  const q = parts[parts.length - 2];
  if (['self', 'cls', 'super'].includes(q) || String(entity.parentClass) === q) return false;
  const segs = file.split('/');
  const stem = segs.pop().replace(/\.py$/, '');
  return q !== stem && segs.includes(q);
}
