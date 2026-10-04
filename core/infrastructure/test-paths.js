/**
 * Test, spec, fixture or mock file — by path shape only.
 *
 * Shared by the search output (ss-grep weighting, ss-search packing) and the
 * code graph (ss-trace keeps library -> test edges out of production traces),
 * so it lives below both.
 */

const TEST_DIR_RE = /(^|\/)(__tests__|__mocks__|tests?|specs?|testdata|test_data|fixtures?|e2e|mocks?|testing|integration[-_]tests?)(\/|$)/i;
const TEST_FILE_RES = [
  /_test\.[a-z0-9]+$/i,                       // Go, Python style foo_test.py
  /(^|\/)test_[^/]+\.[a-z0-9]+$/i,            // Python test_foo.py
  /[-_.](test|spec)\.[cm]?[jt]sx?$/i,         // JS/TS foo.test.ts, foo.spec.js
  /_spec\.[a-z0-9]+$/i,                       // Ruby foo_spec.rb
  // FooTest.java, FooTests.swift: the basename ends so. Written without a leading
  // `(^|\/)[^/]*` (always satisfiable, as the suffix holds no slash): same answers, and the
  // engine does not retry `[^/]*` from every slash (~8x faster; ss-grep weighs every file).
  /Tests?\.(java|kt|kts|scala|cs|swift|m|mm|php)$/,
  /(^|\/)conftest\.py$/i,
];

// The rules above, folded once at load: every case-insensitive rule into one alternation
// (`test` of A|B is A or B), the one case-sensitive rule kept apart. Same answers in one or
// two regex passes instead of seven, no closure per call: ss-grep weighs every matching file.
const TEST_PATH_CI_RE = new RegExp(
  [TEST_DIR_RE, ...TEST_FILE_RES.filter((re) => re.flags.includes('i'))].map((re) => `(?:${re.source})`).join('|'),
  'i',
);
const TEST_PATH_CS_RES = TEST_FILE_RES.filter((re) => !re.flags.includes('i'));

/** Test, spec, fixture or mock file by path shape only. */
export function isTestLikePath(file) {
  let p = String(file || '');
  if (!p) return false;
  if (p.includes('\\')) p = p.replace(/\\/g, '/');
  if (TEST_PATH_CI_RE.test(p)) return true;
  for (let i = 0; i < TEST_PATH_CS_RES.length; i++) if (TEST_PATH_CS_RES[i].test(p)) return true;
  return false;
}
