/**
 * LLM Provider Fallback Chain for HCGS Summary Generation
 *
 * Tiered approach for generating code summaries:
 * 1. Cerebras GLM-4.6 (primary) - ~1000 tok/s, excellent for code
 * 2. Ollama (local GPU) - qwen2.5-coder:7b-instruct at localhost:11434
 * 3. Transformers.js (local CPU) - phi-3-mini-4k-instruct via @xenova/transformers
 * 4. Static fallback (no LLM) - uses doc_comment, signature, or "{type} {name}"
 *
 * Features:
 * - Auto-detection of best available provider
 * - Exponential backoff retry with jitter
 * - Intelligent error classification (retryable vs permanent)
 * - Consistent interface across all providers
 */

import { CEREBRAS_CONFIG, HCGS_CONFIG, getCerebrasModel, isCerebrasAvailable } from './config.js';

// =============================================================================
// PROVIDER CONFIGURATION
// =============================================================================

const OLLAMA_CONFIG = {
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:7b-instruct',
  timeout: 30000, // 30s timeout for local inference
};

const TRANSFORMERS_CONFIG = {
  model: 'Xenova/Phi-3-mini-4k-instruct',
  maxNewTokens: 150,
  temperature: 0.3,
};

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 8000,  // 8 seconds max
  backoffMultiplier: 2,
  jitterFactor: 0.2, // 20% jitter
};

// =============================================================================
// ERROR CLASSIFICATION
// =============================================================================

/**
 * Determines if an error is retryable (transient) or permanent
 * @param {Error} error - The error to classify
 * @returns {boolean} - true if the error is retryable
 */
export function isRetryable(error) {
  // Network errors are typically retryable
  if (error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'EAI_AGAIN') {
    return true;
  }

  // HTTP status codes
  const status = error.status || error.statusCode || (error.response && error.response.status);
  if (status) {
    // Rate limits (429) and server errors (5xx) are retryable
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    // Client errors (4xx except 429) are permanent
    if (status >= 400 && status < 500) return false;
  }

  // Timeout errors are retryable
  if (error.name === 'AbortError' || error.message?.includes('timeout')) {
    return true;
  }

  // Default: assume transient for unknown errors
  return true;
}

// =============================================================================
// RETRY MECHANISM
// =============================================================================

/**
 * Calculates delay with exponential backoff and jitter
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} - Delay in milliseconds
 */
function calculateDelay(attempt) {
  const exponentialDelay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, RETRY_CONFIG.maxDelay);
  const jitter = cappedDelay * RETRY_CONFIG.jitterFactor * (Math.random() * 2 - 1);
  return Math.round(cappedDelay + jitter);
}

/**
 * Executes a function with exponential backoff retry
 * @param {Function} fn - Async function to execute
 * @param {object} options - Retry options
 * @returns {Promise<any>} - Result from the function
 * @throws {Error} - Last error if all retries fail
 */
export async function generateWithRetry(fn, options = {}) {
  const maxRetries = options.maxRetries ?? RETRY_CONFIG.maxRetries;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if this is the last attempt or error is not retryable
      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt);
      if (process.env.SEARCH_DEBUG) {
        console.log(`[LLM] Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// =============================================================================
// PROVIDER: CEREBRAS GLM-4.6
// =============================================================================

/**
 * Generates summary using Cerebras GLM-4.6
 * @param {string} prompt - The prompt to send
 * @param {object} options - Generation options
 * @returns {Promise<string>} - Generated summary
 */
async function generateWithCerebras(prompt, options = {}) {
  if (!isCerebrasAvailable()) {
    throw new Error('Cerebras API key not configured');
  }

  const model = getCerebrasModel('hcgs');
  const maxTokens = options.maxTokens ?? 150;

  const requestBody = {
    model,
    messages: [
      {
        role: 'system',
        content: 'You are a code documentation assistant. Generate concise, accurate summaries of code entities. Focus on what the code does, not how. Be brief and direct.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
    // Disable chain-of-thought for faster responses
    ...(CEREBRAS_CONFIG.reasoning?.fastMode && { disable_reasoning: true }),
  };

  const response = await fetch(`${CEREBRAS_CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CEREBRAS_CONFIG.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(15000), // 15s timeout
  });

  if (!response.ok) {
    const error = new Error(`Cerebras API error: ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// =============================================================================
// PROVIDER: OLLAMA (Local GPU)
// =============================================================================

/**
 * Checks if Ollama is available
 * @returns {Promise<boolean>}
 */
async function isOllamaAvailable() {
  try {
    const response = await fetch(`${OLLAMA_CONFIG.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;

    const data = await response.json();
    // Check if our desired model is available
    return data.models?.some(m =>
      m.name === OLLAMA_CONFIG.model ||
      m.name.startsWith(OLLAMA_CONFIG.model.split(':')[0])
    ) ?? false;
  } catch {
    return false;
  }
}

/**
 * Generates summary using Ollama
 * @param {string} prompt - The prompt to send
 * @param {object} options - Generation options
 * @returns {Promise<string>} - Generated summary
 */
async function generateWithOllama(prompt, options = {}) {
  const maxTokens = options.maxTokens ?? 150;

  const requestBody = {
    model: OLLAMA_CONFIG.model,
    prompt: `You are a code documentation assistant. Generate concise, accurate summaries of code entities. Focus on what the code does, not how. Be brief and direct.\n\n${prompt}`,
    stream: false,
    options: {
      num_predict: maxTokens,
      temperature: 0.3,
    },
  };

  const response = await fetch(`${OLLAMA_CONFIG.baseUrl}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(OLLAMA_CONFIG.timeout),
  });

  if (!response.ok) {
    const error = new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.response?.trim() || '';
}

// =============================================================================
// PROVIDER: TRANSFORMERS.JS (Local CPU)
// =============================================================================

// Lazy-loaded pipeline instance
let transformersPipeline = null;
let transformersAvailable = null;

/**
 * Checks if Transformers.js is available and initializes it
 * @returns {Promise<boolean>}
 */
async function isTransformersAvailable() {
  if (transformersAvailable !== null) {
    return transformersAvailable;
  }

  try {
    // Dynamic import to avoid errors if not installed
    const { pipeline, env } = await import('@xenova/transformers');

    // Configure for optimal performance
    env.allowLocalModels = true;
    env.useBrowserCache = false;

    // Initialize the pipeline (this downloads the model on first run)
    if (process.env.SEARCH_DEBUG) {
      console.log('[LLM] Initializing Transformers.js pipeline...');
    }

    transformersPipeline = await pipeline('text-generation', TRANSFORMERS_CONFIG.model, {
      quantized: true, // Use quantized model for speed
    });

    transformersAvailable = true;
    return true;
  } catch (error) {
    if (process.env.SEARCH_DEBUG) {
      console.log(`[LLM] Transformers.js not available: ${error.message}`);
    }
    transformersAvailable = false;
    return false;
  }
}

/**
 * Generates summary using Transformers.js
 * @param {string} prompt - The prompt to send
 * @param {object} options - Generation options
 * @returns {Promise<string>} - Generated summary
 */
async function generateWithTransformers(prompt, options = {}) {
  if (!transformersPipeline) {
    const available = await isTransformersAvailable();
    if (!available) {
      throw new Error('Transformers.js not available');
    }
  }

  const maxTokens = options.maxTokens ?? TRANSFORMERS_CONFIG.maxNewTokens;

  const systemPrompt = 'You are a code documentation assistant. Generate concise, accurate summaries.';
  const fullPrompt = `<|system|>\n${systemPrompt}<|end|>\n<|user|>\n${prompt}<|end|>\n<|assistant|>\n`;

  const result = await transformersPipeline(fullPrompt, {
    max_new_tokens: maxTokens,
    temperature: TRANSFORMERS_CONFIG.temperature,
    do_sample: true,
    return_full_text: false,
  });

  return result[0]?.generated_text?.trim() || '';
}

// =============================================================================
// PROVIDER: STATIC FALLBACK (No LLM)
// =============================================================================

/**
 * Generates a static summary without LLM
 * Uses available metadata: doc_comment > signature > type + name
 * @param {object} entity - Code entity with metadata
 * @returns {string} - Generated summary
 */
function generateStaticSummary(entity) {
  // Priority 1: Use existing doc comment
  if (entity.doc_comment) {
    // Extract first sentence or line
    const firstLine = entity.doc_comment
      .replace(/^\/\*\*\s*|\s*\*\/$/g, '') // Remove /** */
      .replace(/^\s*\*\s*/gm, '')          // Remove leading *
      .split(/[.\n]/)[0]                    // First sentence/line
      .trim();

    if (firstLine && firstLine.length > 10) {
      return firstLine.length > 200 ? firstLine.slice(0, 197) + '...' : firstLine;
    }
  }

  // Priority 2: Use signature if available
  if (entity.signature) {
    const cleanSig = entity.signature
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanSig.length > 10) {
      return cleanSig.length > 200 ? cleanSig.slice(0, 197) + '...' : cleanSig;
    }
  }

  // Priority 3: Construct from type and name
  const type = entity.type || 'entity';
  const name = entity.name || 'unknown';

  // Convert CamelCase/snake_case to words
  const humanName = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();

  return `${type.charAt(0).toUpperCase() + type.slice(1)}: ${humanName}`;
}

// =============================================================================
// PROVIDER DETECTION AND SELECTION
// =============================================================================

/**
 * Provider interface
 * @typedef {object} SummaryProvider
 * @property {string} name - Provider name
 * @property {boolean} isLocal - Whether provider runs locally
 * @property {Function} generate - Generation function
 */

// Provider registry
const providers = {
  cerebras: {
    name: 'cerebras',
    isLocal: false,
    priority: 1,
    checkAvailable: () => Promise.resolve(isCerebrasAvailable()),
    generate: generateWithCerebras,
  },
  ollama: {
    name: 'ollama',
    isLocal: true,
    priority: 2,
    checkAvailable: isOllamaAvailable,
    generate: generateWithOllama,
  },
  transformers: {
    name: 'transformers',
    isLocal: true,
    priority: 3,
    checkAvailable: isTransformersAvailable,
    generate: generateWithTransformers,
  },
  static: {
    name: 'static',
    isLocal: true,
    priority: 99,
    checkAvailable: () => Promise.resolve(true),
    generate: async (prompt, options) => {
      // Static provider expects entity metadata, not raw prompt
      if (options?.entity) {
        return generateStaticSummary(options.entity);
      }
      return 'Code entity';
    },
  },
};

// Cached provider selection
let selectedProvider = null;
let providerCheckPromise = null;

/**
 * Auto-detects and returns the best available summary provider
 * @param {object} options - Options
 * @param {boolean} options.preferLocal - Prefer local providers over remote
 * @param {boolean} options.forceCheck - Force re-check of provider availability
 * @returns {Promise<SummaryProvider>} - Best available provider
 */
export async function getSummaryProvider(options = {}) {
  const { preferLocal = false, forceCheck = false } = options;

  // Return cached provider if available and not forcing recheck
  if (selectedProvider && !forceCheck) {
    return selectedProvider;
  }

  // Prevent concurrent provider checks
  if (providerCheckPromise && !forceCheck) {
    return providerCheckPromise;
  }

  providerCheckPromise = (async () => {
    // Get providers sorted by priority (optionally preferring local)
    const providerList = Object.values(providers).sort((a, b) => {
      if (preferLocal) {
        // Local providers first
        if (a.isLocal !== b.isLocal) {
          return a.isLocal ? -1 : 1;
        }
      }
      return a.priority - b.priority;
    });

    // Find first available provider
    for (const provider of providerList) {
      try {
        const available = await provider.checkAvailable();
        if (available) {
          if (process.env.SEARCH_DEBUG) {
            console.log(`[LLM] Selected provider: ${provider.name}`);
          }
          selectedProvider = provider;
          return provider;
        }
      } catch (error) {
        if (process.env.SEARCH_DEBUG) {
          console.log(`[LLM] Provider ${provider.name} check failed: ${error.message}`);
        }
      }
    }

    // Fallback to static (always available)
    selectedProvider = providers.static;
    return providers.static;
  })();

  return providerCheckPromise;
}

// =============================================================================
// UNIFIED GENERATION INTERFACE
// =============================================================================

/**
 * Generates a summary for a code entity using the best available provider
 * Falls back through the provider chain on failures
 * @param {string} prompt - The prompt to send
 * @param {object} options - Generation options
 * @param {object} options.entity - Code entity metadata (for static fallback)
 * @param {number} options.maxTokens - Maximum tokens to generate
 * @param {boolean} options.preferLocal - Prefer local providers
 * @returns {Promise<{summary: string, provider: string}>}
 */
export async function generateSummary(prompt, options = {}) {
  const provider = await getSummaryProvider({ preferLocal: options.preferLocal });

  // Try primary provider with retry
  try {
    const summary = await generateWithRetry(
      () => provider.generate(prompt, options),
      { maxRetries: provider.isLocal ? 1 : RETRY_CONFIG.maxRetries }
    );

    return {
      summary,
      provider: provider.name,
    };
  } catch (primaryError) {
    if (process.env.SEARCH_DEBUG) {
      console.log(`[LLM] Primary provider ${provider.name} failed: ${primaryError.message}`);
    }

    // Try fallback providers
    const fallbackOrder = ['ollama', 'transformers', 'static'];
    for (const fallbackName of fallbackOrder) {
      if (fallbackName === provider.name) continue;

      const fallback = providers[fallbackName];
      try {
        const available = await fallback.checkAvailable();
        if (!available) continue;

        const summary = await fallback.generate(prompt, options);
        return {
          summary,
          provider: fallback.name,
        };
      } catch (fallbackError) {
        if (process.env.SEARCH_DEBUG) {
          console.log(`[LLM] Fallback ${fallbackName} failed: ${fallbackError.message}`);
        }
      }
    }

    // Ultimate fallback: static
    return {
      summary: generateStaticSummary(options.entity || {}),
      provider: 'static',
    };
  }
}

/**
 * Generates summaries for multiple entities in batch
 * @param {Array<{prompt: string, entity: object}>} items - Items to summarize
 * @param {object} options - Generation options
 * @returns {Promise<Array<{summary: string, provider: string}>>}
 */
export async function generateSummariesBatch(items, options = {}) {
  const provider = await getSummaryProvider({ preferLocal: options.preferLocal });
  const concurrency = provider.isLocal ? 1 : 5; // Limit concurrency for local providers

  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(item => generateSummary(item.prompt, { ...options, entity: item.entity }))
    );
    results.push(...batchResults);
  }

  return results;
}

// =============================================================================
// PROMPT TEMPLATES
// =============================================================================

/**
 * Creates a summary prompt for a code entity
 * @param {object} entity - Code entity
 * @returns {string} - Formatted prompt
 */
export function createSummaryPrompt(entity) {
  const tokenLimit = HCGS_CONFIG.summaryTokenLimits[entity.type] || HCGS_CONFIG.defaultTokenLimit;

  let prompt = `Summarize this ${entity.type} in ${tokenLimit} tokens or less:\n\n`;

  // Add entity header
  prompt += `Name: ${entity.name}\n`;
  if (entity.file) {
    prompt += `File: ${entity.file}\n`;
  }

  // Add code content
  if (entity.code) {
    const codeSnippet = entity.code.length > 2000
      ? entity.code.slice(0, 2000) + '\n// ... (truncated)'
      : entity.code;
    prompt += `\nCode:\n\`\`\`\n${codeSnippet}\n\`\`\`\n`;
  }

  // Add context from children if available
  if (entity.childSummaries && entity.childSummaries.length > 0) {
    prompt += '\nContains:\n';
    for (const child of entity.childSummaries.slice(0, 5)) {
      prompt += `- ${child.name}: ${child.summary}\n`;
    }
  }

  prompt += '\nProvide a concise summary focusing on purpose and functionality.';

  return prompt;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  generateWithCerebras,
  generateWithOllama,
  generateWithTransformers,
  generateStaticSummary,
  isOllamaAvailable,
  isTransformersAvailable,
  providers,
  OLLAMA_CONFIG,
  TRANSFORMERS_CONFIG,
  RETRY_CONFIG,
};

export default {
  getSummaryProvider,
  generateSummary,
  generateSummariesBatch,
  generateWithRetry,
  isRetryable,
  createSummaryPrompt,
  generateStaticSummary,
  providers,
};
