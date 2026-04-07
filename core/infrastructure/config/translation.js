/**
 * Cerebras LLM Configuration — fast inference for HCGS and graph summary generation.
 * Split from core/config.js during DDD migration.
 */

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// =============================================================================
// CEREBRAS GLM CONFIGURATION (Fast Standalone LLM)
// Reference: https://inference-docs.cerebras.ai/models/zai-glm-46
// =============================================================================

export const CEREBRAS_CONFIG = {
  enabled: CEREBRAS_API_KEY.length > 0,
  apiKey: CEREBRAS_API_KEY,
  baseUrl: 'https://api.cerebras.ai/v1',

  // Available models (December 2025)
  // Run: node -e "fetch('https://api.cerebras.ai/v1/models', {headers:{'Authorization':'Bearer '+process.env.CEREBRAS_API_KEY}}).then(r=>r.json()).then(d=>d.data.forEach(m=>console.log(m.id)))"
  models: {
    // GLM-4.6: Best general purpose reasoning (~1000 tok/s)
    'glm-4.6': {
      id: 'zai-glm-4.6',
      contextLength: 131072,  // 131K
      features: ['reasoning', 'tool_use', 'json_mode'],
      speed: '1000+ tok/s',
      strengths: ['general', 'fast', 'reasoning'],
    },
    // Qwen 3 235B: Large MoE model for complex tasks
    'qwen3-235b': {
      id: 'qwen-3-235b-a22b-instruct-2507',
      contextLength: 32768,
      features: ['instruct'],
      speed: '500+ tok/s',
      strengths: ['complex', 'multilingual'],
    },
    // Llama 3.3 70B: Strong all-rounder
    'llama-70b': {
      id: 'llama-3.3-70b',
      contextLength: 128000,
      features: ['instruct', 'tool_use'],
      speed: '800+ tok/s',
      strengths: ['coding', 'general'],
    },
    // Llama 3.1 8B: Fast small model
    'llama-8b': {
      id: 'llama3.1-8b',
      contextLength: 128000,
      features: ['instruct'],
      speed: '2000+ tok/s',
      strengths: ['fast', 'simple'],
    },
    // Qwen 3 32B: Good balance of speed and quality
    'qwen3-32b': {
      id: 'qwen-3-32b',
      contextLength: 32768,
      features: ['instruct'],
      speed: '1000+ tok/s',
      strengths: ['balanced', 'multilingual'],
    },
  },

  // Default model for different use cases
  defaults: {
    fast: 'zai-glm-4.6',           // Speed + quality balance
    coding: 'llama-3.3-70b',       // Best for code
    simple: 'llama3.1-8b',         // Quick simple tasks
    hcgs: 'llama3.1-8b',           // Summary generation (fast, cheap — GLM-4.6 is overkill)
    complex: 'qwen-3-235b-a22b-instruct-2507',  // Complex reasoning
  },

  // Reasoning mode (disable for faster direct responses)
  reasoning: {
    // disable_reasoning: true skips chain-of-thought
    fastMode: true,  // Default: no CoT for speed
  },
};

export function isCerebrasAvailable() {
  return CEREBRAS_CONFIG.enabled;
}

export function getCerebrasModel(useCase = 'fast') {
  return CEREBRAS_CONFIG.defaults[useCase] || CEREBRAS_CONFIG.defaults.fast;
}

// HCGS_CONFIG lives in ./graph.js (graph-related, not Cerebras)
