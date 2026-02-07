---
description: Interactive reranking configuration wizard for Sweet Search
command: /sweet-config-rerank
---

# Sweet Config Rerank

Interactive wizard to configure reranking settings for Sweet Search.

## Overview

This wizard helps you configure reranking between four modes:
- **Local ModernBERT INT8 (Recommended)** - Offline reranking using gte-reranker-modernbert-base INT8 (~50-100ms, free)
- **API (Voyage/Jina)** - Cloud-based reranking with highest quality (~80-700ms, requires API keys)
- **Auto** - Local if no API keys, API if available
- **Disabled** - FlashRank Stage 1 only (fastest but lower quality)

## IMPORTANT: Security Rules

1. **NEVER print full API keys** - Only show last 4 characters
2. **NEVER commit secrets** - Store in `.env` (gitignored)
3. **NEVER log secrets** - Use `****` masking in all output
4. **Offer manual export** - If user declines storage, print export commands

## Implementation

### Step 0: Show Current State

Read current configuration and display status:

```javascript
// Check current state by importing config
const config = await import('./config.js');
const lrc = config.LOCAL_RERANKER_CONFIG;
const rc = config.RERANK_CONFIG;

// Check model availability
const fs = await import('fs');
const path = await import('path');
const modelPath = path.join('models', 'gte-reranker-int8');
const modelExists = fs.existsSync(path.join(modelPath, 'model.onnx')) ||
                    fs.existsSync(path.join(modelPath, 'onnx', 'model.onnx'));

// Display current state
console.log(`
## Current Reranking Configuration

| Setting | Value |
|---------|-------|
| Use Local Reranker | ${config.shouldUseLocalReranker() ? 'Yes' : 'No'} |
| Local Model Bundled | ${modelExists ? 'Yes' : 'No'} |
| Local Model | ${lrc.model.name} |
| Voyage API Available | ${rc.voyage.enabled ? 'Yes' : 'No'} |
| Jina API Available | ${rc.jina.enabled ? 'Yes' : 'No'} |
| FlashRank Model | ${rc.flashrank.model} |
| Cascaded Mode | Enabled (FlashRank Stage 1 + Stage 2) |
`);
```

Then use AskUserQuestion:
```
Question: "Start reranking configuration wizard?"
Header: "Setup"
Options:
- "Yes, configure reranking (Recommended)"
- "No, keep current settings"
```

If "No", exit with:
```
Configuration unchanged. Run /sweet-config-rerank anytime to reconfigure.
```

### Step 1: Choose Mode

Use AskUserQuestion:
```
Question: "Which reranking mode do you want?"
Header: "Mode"
Options:
- "Local ModernBERT INT8 (Recommended)" - Free, offline, ~50-100ms, SOTA quality for code search
- "API (Voyage/Jina)" - Requires API keys, ~80-700ms, highest quality
- "Auto" - Local if no API keys, API if available
- "FlashRank Only (Fastest)" - Stage 1 only (~15ms), lower quality for ambiguous queries
```

### Step 2: Handle Mode-Specific Setup

#### If "Local ModernBERT INT8":

Check if model is bundled:

```bash
# Check if model exists (should be bundled with plugin)
ls -la models/gte-reranker-int8/model.onnx 2>/dev/null || \
ls -la models/gte-reranker-int8/onnx/model.onnx 2>/dev/null
```

**If model exists:** Proceed to Step 3.

**If model missing:** Display error message:
```markdown
## Model Not Found

The local reranker model should be bundled with the plugin but is missing.

**To fix:**
1. Re-install the Sweet Search plugin
2. Verify Git LFS pulled the model: `git lfs pull`
3. Contact the maintainer if issue persists

The model artifacts should be in:
`models/gte-reranker-int8/`

**Falling back to API mode for now.**
```

Then fall back to API mode or FlashRank-only.

#### If "API (Voyage/Jina)":

Use AskUserQuestion:
```
Question: "Which API provider do you prefer?"
Header: "Provider"
Options:
- "Voyage rerank-2.5 (Recommended)" - SOTA quality, ~700ms, $0.05/1K queries
- "Jina reranker-v3" - Good quality, ~80ms, $0.018/1K queries
- "Both (Voyage primary, Jina fallback)" - Uses Voyage first, Jina if Voyage fails
```

Then gather API keys if not already set:

```bash
# Check if Voyage key exists (mask output!)
node -e "
const key = process.env.VOYAGEAI_API_KEY || '';
if (key.length > 0) {
  console.log('Voyage key found: ****' + key.slice(-4));
} else {
  console.log('Voyage key not found');
}
"
```

If key is missing, use AskUserQuestion:
```
Question: "VOYAGEAI_API_KEY is not set. How would you like to provide it?"
Header: "API Key"
Options:
- "Store in .env file (Recommended)" - Saves to .env (gitignored, secure)
- "Manual export" - I'll set it in my shell myself (prints instructions)
- "Skip" - Skip this provider
```

### Step 3: Apply Configuration

Edit the config setting in `config.js`.

**For Local ModernBERT mode (default, FREE):**
```javascript
// In LOCAL_RERANKER_CONFIG (around line 725):
useLocalReranker: true,  // Uses local GTE ModernBERT INT8
```

**For API mode (Voyage/Jina):**
```javascript
// In LOCAL_RERANKER_CONFIG (around line 725):
useLocalReranker: false,  // Falls back to Voyage > Jina APIs
```
Note: Ensure VOYAGEAI_API_KEY or JINA_API_KEY is set in `.env` file.

**For FlashRank Only mode:**
```javascript
// In LOCAL_RERANKER_CONFIG (around line 725):
useLocalReranker: false,  // No API keys = FlashRank only
```
Note: Remove or don't set any API keys in `.env` file.

### Step 4: Validate & Show Results

After updating config.js, validate the configuration:

```bash
# Validate config loads correctly
node -e "
import('./config.js').then(c => {
  const lrc = c.LOCAL_RERANKER_CONFIG;
  const rc = c.RERANK_CONFIG;
  console.log(JSON.stringify({
    useLocalReranker: c.shouldUseLocalReranker(),
    voyageAvailable: rc.voyage.enabled,
    jinaAvailable: rc.jina.enabled,
  }, null, 2));
}).catch(e => console.error('Config error:', e.message));
"
```

Optionally run a quick reranking test:

```bash
# Quick test
node -e "
import('./flashrank.js').then(async m => {
  const reranker = new m.Reranker();
  const result = await reranker.rerank('authentication', [
    'AuthService handles login',
    'Database connection pool',
  ], 2);
  console.log('Test passed:', result.model, result.latency_ms + 'ms');
}).catch(e => console.error('Test failed:', e.message));
"
```

### Step 5: Print Summary

```markdown
## Configuration Complete

### Changes Applied

| Setting | Old Value | New Value |
|---------|-----------|-----------|
| Mode | false | true |
| Use Local Reranker | No | Yes |
| Stage 2 Reranker | voyage | local-modernbert-int8 |

### Files Modified

- `.env` (updated, chmod 600)

### Expected Performance

| Mode | Stage 1 | Stage 2 | Total Latency |
|------|---------|---------|---------------|
| Before | FlashRank (~15ms) | Voyage (~700ms) | ~715ms |
| After | FlashRank (~15ms) | ModernBERT INT8 (~50ms) | ~65ms |

### Next Steps

1. Test reranking: `ss "test query" --verbose`
2. Reconfigure anytime: `/sweet-config-rerank`
```

## Configuration Reference

**Config setting (config.js):**
| Setting | Values | Effect |
|---------|--------|--------|
| `LOCAL_RERANKER_CONFIG.useLocalReranker` | true, false | Master switch for local ModernBERT INT8 reranker |

**Environment variables (.env):**
| Variable | Values | Effect |
|----------|--------|--------|
| VOYAGEAI_API_KEY | API key | Enables Voyage reranking (rerank-2.5) |
| JINA_API_KEY | API key | Enables Jina reranking (jina-reranker-v3) |

## Reranker Comparison

| Reranker | Latency | Cost | Quality | Offline |
|----------|---------|------|---------|---------|
| FlashRank TinyBERT | ~15ms | Free | Good (Stage 1) | Yes |
| ModernBERT INT8 | ~50-100ms | Free | Excellent | Yes |
| Voyage rerank-2.5 | ~700ms | $0.05/1K | Best | No |
| Jina reranker-v3 | ~80ms | $0.018/1K | Very Good | No |

## Provider API URLs

| Provider | Console / Get Key |
|----------|-------------------|
| Voyage | https://dash.voyageai.com |
| Jina | https://jina.ai/reranker |

## Files

| File | Purpose |
|------|---------|
| `.env` | Local secrets (gitignored) |
| `config.js` | Configuration loader |
| `flashrank.js` | Reranker implementation |
| `local-reranker.js` | Local ModernBERT INT8 reranker |
| `models/gte-reranker-int8/` | Bundled model artifacts |

## Idempotent Behavior

Running `/sweet-config-rerank` multiple times is safe:
- Existing .env keys are preserved unless explicitly changed
- Only modified settings are updated
- chmod 600 is reapplied on each write

## Troubleshooting

### "Model not found"
The model should be bundled with the plugin. If missing, re-install the plugin
or contact the maintainer - the model artifacts should be in `models/gte-reranker-int8/`.

### "Model loading slow"
First load takes 2-5s to parse ONNX model and warm up JIT. Subsequent calls are fast (~50-100ms).
Session preheat should hide this latency.

### "Out of memory"
INT8 model requires ~500MB RAM during inference. Close other applications.

### "Provider skipped: Missing key"
Set the required API key and run the wizard again, or switch to local mode.

### "Config error: Cannot find module"
Ensure you are running from the Sweet Search root directory.
