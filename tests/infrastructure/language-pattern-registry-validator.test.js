import { describe, it } from 'vitest';
import { LANGUAGES } from '../../core/infrastructure/language-patterns.js';
import {
  GENERIC_RELATIONSHIP_MAPPING,
  INTENTIONAL_DEFAULT_RELATIONSHIP_TYPES,
} from '../../core/graph/index.js';

function countCapturingGroups(regex) {
  const source = regex.source;
  let count = 0;
  let inClass = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (!inClass && ch === '(') {
      if (source[i + 1] !== '?') {
        count++;
      }
    }
  }

  return count;
}

function assertNoFailures(failures) {
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

describe('language pattern registry contracts', () => {
  it('all chunker patterns expose capture group 1', () => {
    const failures = [];

    for (const [language, config] of Object.entries(LANGUAGES)) {
      for (const [patternType, pattern] of Object.entries(config.chunker || {})) {
        if (countCapturingGroups(pattern) < 1) {
          failures.push(`chunker ${language}.${patternType} has no capture group 1: /${pattern.source}/${pattern.flags}`);
        }
      }
    }

    assertNoFailures(failures);
  });

  it('all graph entity patterns expose capture group 1', () => {
    const failures = [];

    for (const [language, config] of Object.entries(LANGUAGES)) {
      for (const [entityType, pattern] of Object.entries(config.graph?.entities || {})) {
        if (countCapturingGroups(pattern) < 1) {
          failures.push(`entity ${language}.${entityType} has no capture group 1: /${pattern.source}/${pattern.flags}`);
        }
      }
    }

    assertNoFailures(failures);
  });

  it('all graph relationship patterns are explicitly mapped or intentionally default-mapped', () => {
    const failures = [];
    const mapped = new Set(Object.keys(GENERIC_RELATIONSHIP_MAPPING));
    const intentionalDefaults = new Set(INTENTIONAL_DEFAULT_RELATIONSHIP_TYPES);

    for (const [language, config] of Object.entries(LANGUAGES)) {
      for (const [relType, pattern] of Object.entries(config.graph?.relationships || {})) {
        const captureCount = countCapturingGroups(pattern);

        if (relType === 'methodCall') {
          if (captureCount < 2) {
            failures.push(`relationship ${language}.${relType} must expose object+method captures: /${pattern.source}/${pattern.flags}`);
          }
          continue;
        }

        if (captureCount < 1) {
          failures.push(`relationship ${language}.${relType} has no capture group 1: /${pattern.source}/${pattern.flags}`);
        }

        if (!mapped.has(relType) && !intentionalDefaults.has(relType)) {
          failures.push(`relationship ${language}.${relType} is unmapped and not in intentional defaults`);
        }
      }
    }

    assertNoFailures(failures);
  });
});
