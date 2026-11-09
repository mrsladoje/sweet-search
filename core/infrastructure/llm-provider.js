/**
 * LLM Provider Fallback Chain for HCGS Summary Generation
 *
 * Tiered approach for generating code summaries:
 * 1. Groq (primary) - llama-3.2-3b-preview, ~2800 tok/s, $0.06/M (cheapest)
 *    └─ internal fallback: llama-3.1-8b-instant (~560 tok/s) if 3B model fails
 * 2. Cerebras (fallback) - llama3.1-8b, ~2200 tok/s, $0.10/M
 * 3. Ollama (local GPU) - qwen2.5-coder:7b-instruct at localhost:11434
 * 4. Transformers.js (local CPU) - phi-3-mini-4k-instruct via @xenova/transformers
 * 5. Static fallback (no LLM) - uses doc_comment, signature, or "{type} {name}"
 *
 * Override model for any provider: HCGS_MODEL=model-name
 */

import { CEREBRAS_CONFIG, HCGS_CONFIG, getCerebrasModel, isCerebrasAvailable } from './config/index.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

const GROQ_HCGS_CONFIG = {
  apiKey: GROQ_API_KEY,
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'llama-3.2-3b-preview',     // ~2800 tok/s, $0.06/M — fastest & cheapest
  fallbackModel: 'llama-3.1-8b-instant', // ~560 tok/s, $0.08/M — better quality fallback
  timeout: 15000,
};

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

export function isRetryable(error) {
  if (error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'EAI_AGAIN') {
    return true;
  }

  const status = error.status || error.statusCode || (error.response && error.response.status);
  if (status) {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    if (status >= 400 && status < 500) return false;
  }

  if (error.name === 'AbortError' || error.message?.includes('timeout')) {
    return true;
  }

  // Default: assume transient for unknown errors
  return true;
}

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

/** @throws {Error} the last error if all retries fail */
export async function generateWithRetry(fn, options = {}) {
  const maxRetries = options.maxRetries ?? RETRY_CONFIG.maxRetries;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }

      const delay = calculateDelay(attempt);
      if (process.env.SEARCH_DEBUG) {
        console.log(`[LLM] Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function callGroqCompletion(model, prompt, maxTokens) {
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
  };

  const response = await fetch(`${GROQ_HCGS_CONFIG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(GROQ_HCGS_CONFIG.timeout),
  });

  if (!response.ok) {
    const error = new Error(`Groq API error: ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function generateWithGroq(prompt, options = {}) {
  if (!GROQ_API_KEY) {
    throw new Error('Groq API key not configured');
  }

  const primaryModel = process.env.HCGS_MODEL || GROQ_HCGS_CONFIG.model;
  const maxTokens = options.maxTokens ?? 150;

  try {
    return await callGroqCompletion(primaryModel, prompt, maxTokens);
  } catch (primaryError) {
    // If user overrode model via HCGS_MODEL, respect their choice — don't fallback
    if (process.env.HCGS_MODEL || !GROQ_HCGS_CONFIG.fallbackModel) {
      throw primaryError;
    }

    if (process.env.SEARCH_DEBUG) {
      console.log(`[LLM] Groq ${primaryModel} failed, trying fallback ${GROQ_HCGS_CONFIG.fallbackModel}: ${primaryError.message}`);
    }

    return await callGroqCompletion(GROQ_HCGS_CONFIG.fallbackModel, prompt, maxTokens);
  }
}

async function generateWithCerebras(prompt, options = {}) {
  if (!isCerebrasAvailable()) {
    throw new Error('Cerebras API key not configured');
  }

  const model = process.env.HCGS_MODEL || getCerebrasModel('hcgs');
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

async function isOllamaAvailable() {
  try {
    const response = await fetch(`${OLLAMA_CONFIG.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;

    const data = await response.json();
    return data.models?.some(m =>
      m.name === OLLAMA_CONFIG.model ||
      m.name.startsWith(OLLAMA_CONFIG.model.split(':')[0])
    ) ?? false;
  } catch {
    return false;
  }
}

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

let transformersPipeline = null;
let transformersAvailable = null;

async function isTransformersAvailable() {
  if (transformersAvailable !== null) {
    return transformersAvailable;
  }

  try {
    // Dynamic import to avoid errors if not installed
    const { pipeline, env } = await import('@xenova/transformers');

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

function generateStaticSummary(entity) {
  if (entity.doc_comment) {
    const firstLine = entity.doc_comment
      .replace(/^\/\*\*\s*|\s*\*\/$/g, '') // Remove /** */
      .replace(/^\s*\*\s*/gm, '')          // Remove leading *
      .split(/[.\n]/)[0]                    // First sentence/line
      .trim();

    if (firstLine && firstLine.length > 10) {
      return firstLine.length > 200 ? firstLine.slice(0, 197) + '...' : firstLine;
    }
  }

  if (entity.signature) {
    const cleanSig = entity.signature
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanSig.length > 10) {
      return cleanSig.length > 200 ? cleanSig.slice(0, 197) + '...' : cleanSig;
    }
  }

  const type = entity.type || 'entity';
  const name = entity.name || 'unknown';

  // Convert CamelCase/snake_case to words
  const humanName = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();

  return `${type.charAt(0).toUpperCase() + type.slice(1)}: ${humanName}`;
}

/**
 * Provider interface
 * @typedef {object} SummaryProvider
 * @property {string} name - Provider name
 * @property {boolean} isLocal - Whether provider runs locally
 * @property {Function} generate - Generation function
 */

const providers = {
  groq: {
    name: 'groq',
    isLocal: false,
    priority: 1,
    checkAvailable: () => Promise.resolve(GROQ_API_KEY.length > 0),
    generate: generateWithGroq,
  },
  cerebras: {
    name: 'cerebras',
    isLocal: false,
    priority: 2,
    checkAvailable: () => Promise.resolve(isCerebrasAvailable()),
    generate: generateWithCerebras,
  },
  ollama: {
    name: 'ollama',
    isLocal: true,
    priority: 3,
    checkAvailable: isOllamaAvailable,
    generate: generateWithOllama,
  },
  transformers: {
    name: 'transformers',
    isLocal: true,
    priority: 4,
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

let selectedProvider = null;
let providerCheckPromise = null;

export async function getSummaryProvider(options = {}) {
  const { preferLocal = false, forceCheck = false } = options;

  if (selectedProvider && !forceCheck) {
    return selectedProvider;
  }

  // Prevent concurrent provider checks
  if (providerCheckPromise && !forceCheck) {
    return providerCheckPromise;
  }

  providerCheckPromise = (async () => {
    const providerList = Object.values(providers).sort((a, b) => {
      if (preferLocal) {
        if (a.isLocal !== b.isLocal) {
          return a.isLocal ? -1 : 1;
        }
      }
      return a.priority - b.priority;
    });

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

    selectedProvider = providers.static;
    return providers.static;
  })();

  return providerCheckPromise;
}

export async function generateSummary(prompt, options = {}) {
  const provider = await getSummaryProvider({ preferLocal: options.preferLocal });

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

    const fallbackOrder = ['groq', 'cerebras', 'ollama', 'transformers', 'static'];
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

    return {
      summary: generateStaticSummary(options.entity || {}),
      provider: 'static',
    };
  }
}

async function generateSummariesBatch(items, options = {}) {
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

export function createSummaryPrompt(entity) {
  const tokenLimit = HCGS_CONFIG.summaryTokenLimits[entity.type] || HCGS_CONFIG.defaultTokenLimit;

  let prompt = `Summarize this ${entity.type} in ${tokenLimit} tokens or less:\n\n`;

  prompt += `Name: ${entity.name}\n`;
  if (entity.file) {
    prompt += `File: ${entity.file}\n`;
  }

  if (entity.code) {
    const codeSnippet = entity.code.length > 2000
      ? entity.code.slice(0, 2000) + '\n// ... (truncated)'
      : entity.code;
    prompt += `\nCode:\n\`\`\`\n${codeSnippet}\n\`\`\`\n`;
  }

  if (entity.childSummaries && entity.childSummaries.length > 0) {
    prompt += '\nContains:\n';
    for (const child of entity.childSummaries.slice(0, 5)) {
      prompt += `- ${child.name}: ${child.summary}\n`;
    }
  }

  prompt += '\nProvide a concise summary focusing on purpose and functionality.';

  return prompt;
}

export { generateStaticSummary, providers, RETRY_CONFIG };

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
