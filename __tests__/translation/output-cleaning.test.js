/**
 * Unit Tests for Output Cleaning
 *
 * These tests validate the LLM output cleaning logic that removes
 * verbose prefixes like "The translation of X is:" from Cerebras responses.
 */
import { describe, it, expect } from 'vitest';

// Import the config to get cleaning rules
import { TRANSLATION_CONFIG } from '../../config.js';

// Test helper that mirrors the cleaning logic
function cleanOutput(text, original) {
  if (!text) return original;

  const config = TRANSLATION_CONFIG?.cleaning;
  if (!config?.enabled) return text;

  let cleaned = text;

  for (const prefix of config.stripPrefixes || []) {
    cleaned = cleaned.replace(prefix, '');
  }

  if (config.stripQuotes) {
    cleaned = cleaned.replace(/^["'""''`]+|["'""''`]+$/g, '');
  }

  if (config.firstLineOnly) {
    cleaned = cleaned.split('\n')[0].trim();
  }

  if (config.maxLength && cleaned.length > config.maxLength) {
    cleaned = cleaned.slice(0, config.maxLength);
  }

  return cleaned.length > 0 ? cleaned.trim() : original;
}

describe('Output Cleaning', () => {
  it('strips "The translation of X is:" prefix', () => {
    const input = 'The translation of "認証" is: authentication';
    expect(cleanOutput(input, '認証')).toBe('authentication');
  });

  it('strips "The translation of X to English is:" prefix', () => {
    const input = 'The translation of "zaposleni" to English is: employee';
    expect(cleanOutput(input, 'zaposleni')).toBe('employee');
  });

  it('strips "Here\'s the translation:" prefix', () => {
    const input = "Here's the translation: authentication service";
    expect(cleanOutput(input, '認証')).toBe('authentication service');
  });

  it('strips "Translation:" prefix', () => {
    const input = 'Translation: employee';
    expect(cleanOutput(input, 'zaposleni')).toBe('employee');
  });

  it('strips surrounding double quotes', () => {
    const input = '"authentication"';
    expect(cleanOutput(input, '認証')).toBe('authentication');
  });

  it('strips surrounding smart quotes', () => {
    const input = '"authentication"';
    expect(cleanOutput(input, '認証')).toBe('authentication');
  });

  it('strips surrounding single quotes', () => {
    const input = "'authentication'";
    expect(cleanOutput(input, '認証')).toBe('authentication');
  });

  it('takes only first line', () => {
    const input = 'authentication\nThis means the process of verifying identity.';
    expect(cleanOutput(input, '認証')).toBe('authentication');
  });

  it('returns original if cleaning empties result', () => {
    const input = '   ';
    expect(cleanOutput(input, '認証')).toBe('認証');
  });

  it('preserves code identifiers', () => {
    const input = 'AuthService';
    expect(cleanOutput(input, 'AuthService')).toBe('AuthService');
  });

  it('does not over-clean camelCase identifiers', () => {
    const input = 'getUserById';
    expect(cleanOutput(input, 'getUserById')).toBe('getUserById');
  });

  it('handles combined prefix and quotes', () => {
    const input = 'The translation of "запослени" is: "employee"';
    expect(cleanOutput(input, 'запослени')).toBe('employee');
  });

  it('handles empty input', () => {
    expect(cleanOutput('', 'original')).toBe('original');
    expect(cleanOutput(null, 'original')).toBe('original');
  });
});
