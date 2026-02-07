/**
 * Test WSL UNC path handling in both event-queue-drainer.mjs and index-codebase-v21.js
 */

import { describe, it, expect } from 'vitest';

// WSL UNC path pattern - must match both files
const WSL_UNC_PATTERN = /^\/\/wsl(?:\.localhost|\$)\/[^/]+/;

/**
 * stripWslUncPrefix - copied from both files for testing
 */
function stripWslUncPrefix(filePath) {
  if (!filePath) return filePath;

  // First convert backslashes to forward slashes for consistent matching
  let normalized = filePath.replace(/\\/g, '/');

  // Match //wsl.localhost/<distro> or //wsl$/<distro>
  const match = normalized.match(WSL_UNC_PATTERN);
  if (match) {
    // Return everything after the //wsl.localhost/<distro> prefix
    return normalized.slice(match[0].length);
  }

  return filePath;
}

describe('WSL UNC Path Handling', () => {
  describe('stripWslUncPrefix', () => {
    it('should strip //wsl.localhost/<distro> prefix', () => {
      expect(stripWslUncPrefix('//wsl.localhost/Ubuntu-24.04/home/user/project/file.js'))
        .toBe('/home/user/project/file.js');
    });

    it('should strip //wsl$/<distro> prefix', () => {
      expect(stripWslUncPrefix('//wsl$/Ubuntu/home/user/project/file.js'))
        .toBe('/home/user/project/file.js');
    });

    it('should handle backslash-style UNC paths', () => {
      expect(stripWslUncPrefix('\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\file.js'))
        .toBe('/home/user/file.js');
    });

    it('should preserve regular Linux paths', () => {
      expect(stripWslUncPrefix('/home/panonit/projects/sloth/file.js'))
        .toBe('/home/panonit/projects/sloth/file.js');
    });

    it('should preserve relative paths', () => {
      expect(stripWslUncPrefix('Sloth Web/Sloth-Local/src/Main.java'))
        .toBe('Sloth Web/Sloth-Local/src/Main.java');
    });

    it('should preserve Windows drive paths', () => {
      expect(stripWslUncPrefix('C:/Users/test/file.js'))
        .toBe('C:/Users/test/file.js');
    });

    it('should handle null/undefined', () => {
      expect(stripWslUncPrefix(null)).toBe(null);
      expect(stripWslUncPrefix(undefined)).toBe(undefined);
      expect(stripWslUncPrefix('')).toBe('');
    });

    it('should handle various distro names', () => {
      expect(stripWslUncPrefix('//wsl.localhost/Debian/home/user/file.js'))
        .toBe('/home/user/file.js');
      expect(stripWslUncPrefix('//wsl.localhost/Ubuntu-22.04/home/user/file.js'))
        .toBe('/home/user/file.js');
      expect(stripWslUncPrefix('//wsl$/openSUSE-Leap-15.3/home/user/file.js'))
        .toBe('/home/user/file.js');
    });
  });

  describe('Path integration scenarios', () => {
    const PROJECT_ROOT = '/home/panonit/projects/sloth';

    it('should convert UNC path to project-relative after stripping', () => {
      const uncPath = '//wsl.localhost/Ubuntu-24.04/home/panonit/projects/sloth/Sloth Web/Main.java';
      const stripped = stripWslUncPrefix(uncPath);

      // After stripping, should start with PROJECT_ROOT
      expect(stripped.startsWith(PROJECT_ROOT)).toBe(true);

      // Can now convert to relative
      const relative = stripped.slice(PROJECT_ROOT.length + 1);
      expect(relative).toBe('Sloth Web/Main.java');
    });

    it('should handle event-drainer normalization flow', () => {
      // Simulates the full normalizePathSeparators flow from event-drainer
      function normalizePathSeparators(filePath) {
        if (!filePath) return filePath;
        let normalized = filePath.replace(/\\/g, '/');
        normalized = stripWslUncPrefix(normalized);
        const driveMatch = normalized.match(/^([A-Za-z]):\//);
        if (driveMatch) {
          normalized = '/' + driveMatch[1].toLowerCase() + normalized.slice(2);
        }
        return normalized;
      }

      // Test UNC paths
      expect(normalizePathSeparators('\\\\wsl.localhost\\Ubuntu-24.04\\home\\user\\file.js'))
        .toBe('/home/user/file.js');

      // Test Windows paths
      expect(normalizePathSeparators('C:\\Users\\test\\file.js'))
        .toBe('/c/Users/test/file.js');

      // Test already-normalized Linux paths
      expect(normalizePathSeparators('/home/user/file.js'))
        .toBe('/home/user/file.js');
    });
  });
});
