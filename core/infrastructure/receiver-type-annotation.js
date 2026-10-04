/**
 * Declared receiver types of calls, shared by the graph extractor and
 * resolver (graph/receiver-types.js, graph/relationship-resolver.js) and the
 * structural repository and search readers — so the convention lives below
 * all of them.
 *
 * A call row whose receiver has a declared type carries it in
 * `relationships.full_import_path`: `recvtype:<Type>`, `recvtype:<Outer>.<Type>`
 * for a nested type, `recvtype:<Type>@<package dir>/` for Go, and
 * `recvtype:!<pkg.Type>` for a Go type from a package outside the repo, and
 * `recvtype:?<Type>` for a PHP receiver a static call made (`Type::create(…)`):
 * an origin hint, read only when the repo defines no `Type`.
 */

export const RECEIVER_TYPE_PREFIX = 'recvtype:';

/**
 * Parse a `recvtype:` annotation: { type, outer|null, dir|null, external } or
 * null. `outer` is the enclosing type of a nested type (`Span` in
 * `Span.Builder`); `dir` the Go package directory.
 */
export function parseReceiverType(fullImportPath) {
  const s = String(fullImportPath || '');
  if (!s.startsWith(RECEIVER_TYPE_PREFIX)) return null;
  const body = s.slice(RECEIVER_TYPE_PREFIX.length);
  if (body.startsWith('!')) return { type: body.slice(1), outer: null, dir: null, external: true };
  if (body.startsWith('?')) return { type: body.slice(1), outer: null, dir: null, external: false, factory: true };
  const at = body.indexOf('@');
  const name = at >= 0 ? body.slice(0, at) : body;
  const dot = name.lastIndexOf('.');
  return {
    type: dot >= 0 ? name.slice(dot + 1) : name,
    outer: dot >= 0 ? name.slice(0, dot) : null,
    dir: at >= 0 ? body.slice(at + 1) : null,
    external: false,
  };
}

// The receiver's declared type in a one-line signature: a parameter or a Go
// method receiver. `func (c *Context) Next()` / `func h(c *gin.Context)`,
// `fun f(client: OkHttpClient)`, `func f(_ db: Database)`, `void m(Context c)`.
// `x: Foo[]` / Go `x []Foo` are collections, not a Foo.
const PARAM_COLON_TYPE = /(?:^|[(,\s])(\w+)\s*:\s*(?:inout\s+|&\s*(?:mut\s+)?|\*\s*)?(?:[a-z_]\w*\.)*([A-Z]\w*)(?![\w[])/g;
const PARAM_GO_TYPE = /(?:^|[(,]\s*)([a-z_]\w*)\s+\*?(?:[a-z_]\w*\.)?([A-Z]\w*)\b/g;
const PARAM_TYPE_NAME = /(?:^|[(,]\s*)(?:final\s+|const\s+)?(?:[a-z_]\w*[.:]+)*([A-Z]\w*)(?:<[^<>()]*>)?\s*[*&]*\s+&?([a-z_]\w*)\s*(?=[,)=])/g;

/** Parameter name → declared type, read from a one-line signature. */
export function signatureParamTypes(signature) {
  const types = new Map();
  const sig = String(signature || '');
  if (!sig || sig.length >= 2000) return types;
  let m;
  PARAM_COLON_TYPE.lastIndex = 0;
  while ((m = PARAM_COLON_TYPE.exec(sig)) !== null) if (!types.has(m[1])) types.set(m[1], m[2]);
  PARAM_GO_TYPE.lastIndex = 0;
  while ((m = PARAM_GO_TYPE.exec(sig)) !== null) if (!types.has(m[1])) types.set(m[1], m[2]);
  PARAM_TYPE_NAME.lastIndex = 0;
  while ((m = PARAM_TYPE_NAME.exec(sig)) !== null) if (!types.has(m[2])) types.set(m[2], m[1]);
  return types;
}
