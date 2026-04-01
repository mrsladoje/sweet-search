// =============================================================================
// Composed Language Registry
// =============================================================================
// Aggregates all themed registries into a single `LANGUAGES` object.
import { CORE_LANGUAGES } from './registry-core.js';
import { OBJECT_ORIENTED_LANGUAGES } from './registry-object-oriented.js';
import { WEB_STYLE_LANGUAGES } from './registry-web-style.js';
import { DATA_QUERY_LANGUAGES } from './registry-data-query.js';
import { TOOLING_LANGUAGES } from './registry-tooling.js';

export const LANGUAGES = {
  ...CORE_LANGUAGES,
  ...OBJECT_ORIENTED_LANGUAGES,
  ...WEB_STYLE_LANGUAGES,
  ...DATA_QUERY_LANGUAGES,
  ...TOOLING_LANGUAGES,
};

export default LANGUAGES;
