---
description: Pre-warm Sweet Search vocabulary cache
command: /sweet-prewarm-vocab [terms-file]
---

# Sweet Search Vocabulary Prewarm

Pre-warm semantic vocabulary entries so common queries resolve faster on warm startup.

## Usage

```bash
# Use .sweet-search/vocab-terms.json if present, otherwise built-in defaults
/sweet-prewarm-vocab

# Use a custom terms file (JSON array of strings)
/sweet-prewarm-vocab .sweet-search/vocab-terms.json
```

## Command

```bash
node scripts/prewarm-vocab.js $ARGS
```

## Terms File Format

```json
[
  "authentication middleware",
  "where is database connection configured",
  "find API endpoint handlers"
]
```
