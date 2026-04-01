// core/ranking – barrel export (Phase 2C DDD migration)

// cascaded-scorer.js (no default export)
export { isDecisive, computeAdaptiveK, cascadedScore } from './cascaded-scorer.js';

// flashrank.js
export { FlashRankReranker, VoyageReranker, JinaReranker, Reranker } from './flashrank.js';
export { default as Reranker_default } from './flashrank.js';

// local-reranker.js
export { LocalReranker, getGlobalLocalReranker } from './local-reranker.js';
export { default as LocalReranker_default } from './local-reranker.js';

// quality-scorer.js
export {
  QualityScorer,
  setRepoMapModule,
  scoreTestProximity,
  scoreCommentDensity,
  scoreComplexity,
  scoreSizePreference,
  scoreRecency,
  clearRecencyCache,
  clearTestProximityCache,
} from './quality-scorer.js';
export { default as QualityScorer_default } from './quality-scorer.js';

// mmr.js
export { MMR_CONFIG, computeSimilarity, applyMMR, shouldApplyMMR, getLambdaForIntent } from './mmr.js';
export { default as mmr_default } from './mmr.js';

// late-interaction-model.js (no default export)
export {
  getLateInteractionTimings,
  getLateInteractionPipeline,
  isLateInteractionModelLoaded,
  unloadLateInteractionModel,
  encodeQuery,
  encodeDocuments,
  poolTokens,
  buildExtendedSkiplist,
  _resetExtendedSkiplistCache,
} from './late-interaction-model.js';

// late-interaction-index.js
export { LateInteractionIndex } from './late-interaction-index.js';
export { default as LateInteractionIndex_default } from './late-interaction-index.js';
