/**
 * Query Domain Barrel
 *
 * Re-exports all query routing and intent detection modules.
 */

// Query Router (WASM CatBoost production router)
export { QueryRouter, routeQuery, extractFeatures } from './query-router.js';
export { default as QueryRouterDefault } from './query-router.js';

// ML Query Router (decision tree)
export {
  extractMLFeatures,
  routeQueryML as routeQueryMLTree,
  routeWithML,
  ML_CONFIDENCE_THRESHOLD as ML_CONFIDENCE_THRESHOLD_TREE,
} from './query-router-ml.js';
export { default as QueryRouterML } from './query-router-ml.js';

// CatBoost Query Router (with reject option)
export {
  routeQueryCatBoostWithReject,
  routeQueryML as routeQueryMLCatBoost,
  extractCatBoostFeatures,
  LABELS,
  ML_CONFIDENCE_THRESHOLD as ML_CONFIDENCE_THRESHOLD_CATBOOST,
} from './query-router-catboost.js';
export { default as QueryRouterCatBoost } from './query-router-catboost.js';

// Intent Detector
export { detectIntent, getIntentBoost, applyIntentBoosts } from './intent-detector.js';
export { default as IntentDetector } from './intent-detector.js';

// Intent Router
export { INTENTS, classifyIntent, getIntentPolicy } from './intent-router.js';
