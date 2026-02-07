---
description: Interactive translation configuration wizard for Sweet Search
command: /sweet-config-translate
---

# Sweet Config Translate

Interactive wizard to configure translation settings for Sweet Search.

## Overview

This wizard helps you configure translation between three modes:
- **Local-only** - Offline translation using NLLB-200 (free, 78.9% accuracy)
- **Cloud** - API-based translation using Groq/Cerebras (94.7% accuracy)
- **Auto** - Cloud when available, falls back to local

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
const tc = config.TRANSLATION_CONFIG;

// Display current state
console.log(`
## Current Translation Configuration

| Setting | Value |
|---------|-------|
| Provider | ${tc.provider || 'none'} |
| Cloud Available | ${tc.isCloudAvailable ? 'Yes' : 'No'} |
| Offline Mode | ${tc.isOfflineMode ? 'Yes' : 'No'} |
| Local Model | ${tc.localModel || 'nllb-200'} |
| Fallback Order | ${tc.pipeline?.fallbackOrder?.join(' -> ') || 'cloud -> local -> passthrough'} |
| Cache Enabled | ${tc.cache?.enabled ? 'Yes' : 'No'} |
| Output Cleaning | ${tc.cleaning?.enabled ? 'Yes' : 'No'} |
`);
```

Then use AskUserQuestion:
```
Question: "Start translation configuration wizard?"
Options:
- "Yes, configure translation" (Recommended)
- "No, keep current settings"
```

If "No", exit with:
```
Configuration unchanged. Run /sweet-config-translate anytime to reconfigure.
```

### Step 1: Choose Mode

Use AskUserQuestion:
```
Question: "Which translation mode do you want?"
Header: "Mode"
Options:
- "Auto (Recommended)" - Cloud when API key available, falls back to local NLLB-200
- "Cloud (API-based)" - Requires API key (Groq or Cerebras)
- "Local-only (Offline)" - Free, uses NLLB-200, no internet required
```

### Step 2: Present Benchmark-Backed Options

Parse MODELS_BENCHMARK.md and present working options:

```markdown
## Working Cloud Options (from benchmark)

| Model | Accuracy | Latency | P95 | Cost/1K | Notes |
|-------|----------|---------|-----|---------|-------|
| **groq-llama3.1-8b-instant** | 94.7% | 332ms | 1049ms | $0.0030 | BEST VALUE |
| groq-llama3.3-70b-versatile | 94.7% | 266ms | 359ms | $0.0312 | FASTEST, 10x cost |
| cerebras-llama3.1-8b | 94.7% | 467ms | 1236ms | $0.0059 | Alt provider |

## Working Local Options

| Model | Accuracy | Latency | Init Time | Size | Notes |
|-------|----------|---------|-----------|------|-------|
| **nllb-200-distilled-600M** | 78.9% | 810ms | 5887ms | 600MB | BEST FREE LOCAL |

## Known Broken / Not Recommended

| Model | Issue |
|-------|-------|
| cerebras-qwen3-32b | Outputs `<think>` reasoning tags (0% accuracy) |
| openrouter-llama4-scout-free | Model endpoint 404 errors |
| opus-mt-mul-en | Missing tokenizer files on HuggingFace |
| mt5-small | Missing ONNX files on HuggingFace |
| t5-small | Low accuracy (26.3%), English-centric only |
```

Use AskUserQuestion (if Cloud or Auto mode):
```
Question: "Which cloud provider/model do you want?"
Header: "Provider"
Options:
- "Groq llama-3.1-8b-instant (Recommended)" - BEST VALUE: 94.7% accuracy, $0.0030/1K queries, 332ms
- "Groq llama-3.3-70b-versatile" - FASTEST: 94.7% accuracy, $0.0312/1K queries, 266ms
- "Cerebras llama3.1-8b" - ALT PROVIDER: 94.7% accuracy, $0.0059/1K queries, 467ms
- "Manual / Custom" - I'll enter provider + model ID manually
```

### Step 3: Gather API Keys Safely

If the chosen option requires an API key, determine if key is already set:

```bash
# Check if key exists (mask output!)
node -e "
const key = process.env.GROQ_API_KEY || '';
if (key.length > 0) {
  console.log('Key found: ****' + key.slice(-4));
} else {
  console.log('Key not found');
}
"
```

If key is missing, use AskUserQuestion:
```
Question: "GROQ_API_KEY is not set. How would you like to provide it?"
Header: "Key Storage"
Options:
- "Store in .env file (Recommended)" - Saves to .env (gitignored, secure)
- "Manual export" - I'll set it in my shell myself (prints instructions)
```

If "Store in .env file":
```
Question: "Enter your Groq API key (starts with gsk_)"
Header: "API Key"
[User enters key via AskUserQuestion text input]
```

**CRITICAL**: After receiving the key:
1. Validate format (e.g., Groq keys start with `gsk_`, Cerebras keys are UUIDs)
2. Write/update `.env`:

```javascript
// Read existing .env (if any)
const envPath = '.env';
let envContent = '';
try {
  envContent = fs.readFileSync(envPath, 'utf-8');
} catch (e) {
  // File doesn't exist, will create
}

// Parse existing vars
const vars = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) vars[match[1]] = match[2];
}

// Update with new key
vars['GROQ_API_KEY'] = userProvidedKey;

// Write back
const newContent = Object.entries(vars)
  .map(([k, v]) => `${k}=${v}`)
  .join('\n') + '\n';
fs.writeFileSync(envPath, newContent, { mode: 0o600 });
console.log('Saved to .env (chmod 600 applied)');
```

3. **NEVER print the full key** - Only confirm: `Key saved: ****${key.slice(-4)}`

If "Manual export", print:
```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc) or run before Claude Code:
export GROQ_API_KEY='your-api-key-here'

# Or for Cerebras:
export CEREBRAS_API_KEY='your-api-key-here'
```

### Step 4: Apply Configuration

Write environment overrides to `.env`.

**For Cloud mode (e.g., Groq):**
```env
TRANSLATION_PROVIDER=groq
GROQ_TRANSLATE_MODEL=llama-3.1-8b-instant
TRANSLATION_OFFLINE=false
```

**For Local-only mode:**
```env
TRANSLATION_OFFLINE=true
TRANSLATION_LOCAL_MODEL=nllb-200
```

**For Auto mode:**
```env
# Auto mode: unset TRANSLATION_PROVIDER to use auto-selection
# Priority: Groq (if key) -> Cerebras (if key) -> Local NLLB
TRANSLATION_OFFLINE=false
TRANSLATION_LOCAL_MODEL=nllb-200
```

**IMPORTANT Auto Mode Note:**
> The current codebase does NOT support runtime failover between cloud providers.
> "Auto" means: at config load time, pick the first available cloud provider.
> If that provider fails at runtime, it falls back to local NLLB, not to another cloud.

If the user asks about "backup cloud provider on failure":
```
Note: Sweet Search currently selects ONE cloud provider at startup based on which
API keys are set (priority: Groq > Cerebras > OpenRouter > Custom).

Runtime failover to a different cloud provider is NOT implemented.
If the selected cloud fails, it falls back to local NLLB-200.
```

### Step 5: Validate & Show Results

After writing .env, validate the configuration:

```bash
# Validate config loads correctly
node -e "
import('./config.js').then(c => {
  const tc = c.TRANSLATION_CONFIG;
  console.log(JSON.stringify({
    provider: tc.provider,
    isCloudAvailable: tc.isCloudAvailable,
    isOfflineMode: tc.isOfflineMode,
    localModel: tc.localModel
  }, null, 2));
}).catch(e => console.error('Config error:', e.message));
"
```

Expected output:
```json
{
  "provider": "groq",
  "isCloudAvailable": true,
  "isOfflineMode": false,
  "localModel": "nllb-200"
}
```

Optionally run a quick translation test:
```bash
# Quick test (if cloud available)
node -e "
import('./translation/llm-translator.js').then(async m => {
  const result = await m.translateWithLLM('test');
  console.log('Test passed:', result.provider);
}).catch(e => console.error('Translation test failed:', e.message));
"
```

If keys are missing and cloud mode was selected:
```
Provider skipped: Missing GROQ_API_KEY

Next steps:
1. Get a Groq API key from https://console.groq.com
2. Run /sweet-config-translate again
3. Or set manually: export GROQ_API_KEY='gsk_...'
```

### Step 6: Print "What Changed" Summary

```markdown
## Configuration Complete

### Changes Applied

| Setting | Old Value | New Value |
|---------|-----------|-----------|
| Provider | cerebras | groq |
| Model | llama3.1-8b | llama-3.1-8b-instant |
| Offline Mode | false | false |

### Files Modified

- `.env` (updated, chmod 600)

### Secrets (Redacted)

- GROQ_API_KEY: ****Ln5X (saved)

### Next Steps

1. Test translation: `ss "Mitarbeiter" --verbose`
2. View full benchmark: `cat MODELS_BENCHMARK.md`
3. Reconfigure anytime: `/sweet-config-translate`

### Recommended Configuration (Based on Benchmarks)

| Mode | Primary | Backup | Offline |
|------|---------|--------|---------|
| Auto | Groq llama-3.1-8b-instant | (none - no runtime failover) | NLLB-200 |
| Cost | $0.0030 per 1000 queries | N/A | FREE |
```

## Environment Variables Reference

### Cloud Provider Keys
| Variable | Provider | Format |
|----------|----------|--------|
| GROQ_API_KEY | Groq | Starts with `gsk_` |
| CEREBRAS_API_KEY | Cerebras | UUID format |
| OPENROUTER_API_KEY | OpenRouter | Starts with `sk-or-` |

### Configuration Overrides
| Variable | Values | Effect |
|----------|--------|--------|
| TRANSLATION_PROVIDER | groq, cerebras, openrouter, custom | Force specific cloud provider |
| TRANSLATION_OFFLINE | true, false | Skip cloud entirely when true |
| TRANSLATION_LOCAL_MODEL | nllb-200 | Force specific local model |
| GROQ_TRANSLATE_MODEL | llama-3.1-8b-instant, llama-3.3-70b-versatile | Override Groq model |
| CEREBRAS_TRANSLATE_MODEL | llama3.1-8b, qwen-3-32b | Override Cerebras model |

## Provider API URLs

| Provider | Console / Get Key |
|----------|-------------------|
| Groq | https://console.groq.com |
| Cerebras | https://cloud.cerebras.ai |
| OpenRouter | https://openrouter.ai/keys |

## Files

| File | Purpose |
|------|---------|
| `.env` | Local secrets (gitignored) |
| `config.js` | Configuration loader |
| `MODELS_BENCHMARK.md` | Full benchmark results |
| `translation/` | Translation system |

## Idempotent Behavior

Running `/sweet-config-translate` multiple times is safe:
- Existing .env keys are preserved unless explicitly changed
- Only modified settings are updated
- chmod 600 is reapplied on each write

## Troubleshooting

### "Provider skipped: Missing key"
Set the required API key and run the wizard again.

### "Config error: Cannot find module"
Ensure you are running from the Sweet Search root directory.

### Translation tests fail
Check `__tests__/translation/` for unit tests:
```bash
npm test -- __tests__/translation
```

## Sources

Best practices based on:
- [GitGuardian CLI Secrets Guide](https://blog.gitguardian.com/secrets-at-the-command-line/)
- [Cycode Secrets Management 2026](https://cycode.com/blog/best-secrets-management-tools/)
- [WorkOS CLI Authentication Guide](https://workos.com/blog/best-practices-for-cli-authentication-a-technical-guide)
