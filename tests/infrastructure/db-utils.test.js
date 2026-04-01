import { describe, it, expect, vi } from 'vitest';
import { applyReadPragmas } from '../../core/infrastructure/index.js';

describe('db-utils', () => {
  describe('applyReadPragmas', () => {
    it('should apply mmap_size and cache_size pragmas to a database handle', () => {
      // Arrange
      const db = { pragma: vi.fn() };

      // Act
      applyReadPragmas(db);

      // Assert
      expect(db.pragma).toHaveBeenCalledTimes(2);
      expect(db.pragma).toHaveBeenCalledWith('mmap_size = 268435456');
      expect(db.pragma).toHaveBeenCalledWith('cache_size = -20000');
    });

    it('should apply temp_store MEMORY pragma when tempStoreMemory option is true', () => {
      // Arrange
      const db = { pragma: vi.fn() };

      // Act
      applyReadPragmas(db, { tempStoreMemory: true });

      // Assert
      expect(db.pragma).toHaveBeenCalledTimes(3);
      expect(db.pragma).toHaveBeenCalledWith('mmap_size = 268435456');
      expect(db.pragma).toHaveBeenCalledWith('cache_size = -20000');
      expect(db.pragma).toHaveBeenCalledWith('temp_store = MEMORY');
    });

    it('should NOT apply temp_store pragma when tempStoreMemory option is false', () => {
      // Arrange
      const db = { pragma: vi.fn() };

      // Act
      applyReadPragmas(db, { tempStoreMemory: false });

      // Assert
      expect(db.pragma).toHaveBeenCalledTimes(2);
      expect(db.pragma).not.toHaveBeenCalledWith('temp_store = MEMORY');
    });

    it('should NOT apply temp_store pragma when options are omitted entirely', () => {
      // Arrange
      const db = { pragma: vi.fn() };

      // Act
      applyReadPragmas(db);

      // Assert
      expect(db.pragma).not.toHaveBeenCalledWith('temp_store = MEMORY');
    });

    describe('error resilience', () => {
      it('should swallow errors thrown by individual pragma calls', () => {
        // Arrange
        const db = {
          pragma: vi.fn().mockImplementation((stmt) => {
            if (stmt === 'mmap_size = 268435456') throw new Error('disk I/O error');
          }),
        };

        // Act & Assert — should not throw
        expect(() => applyReadPragmas(db)).not.toThrow();
        // cache_size should still be attempted after mmap_size failure
        expect(db.pragma).toHaveBeenCalledWith('cache_size = -20000');
      });

      it('should swallow error from temp_store pragma and not propagate', () => {
        // Arrange
        const db = {
          pragma: vi.fn().mockImplementation((stmt) => {
            if (stmt === 'temp_store = MEMORY') throw new Error('readonly db');
          }),
        };

        // Act & Assert
        expect(() => applyReadPragmas(db, { tempStoreMemory: true })).not.toThrow();
        expect(db.pragma).toHaveBeenCalledWith('temp_store = MEMORY');
      });

      it('should continue applying remaining pragmas when one throws', () => {
        // Arrange
        const db = {
          pragma: vi.fn()
            .mockImplementationOnce(() => { throw new Error('fail first'); })
            .mockImplementationOnce(() => {})
            .mockImplementationOnce(() => {}),
        };

        // Act
        applyReadPragmas(db, { tempStoreMemory: true });

        // Assert — all 3 pragmas attempted despite first failure
        expect(db.pragma).toHaveBeenCalledTimes(3);
      });
    });

    describe('edge cases: null/undefined db handle', () => {
      it('should not throw when db is null [RED: missing null guard]', () => {
        // Arrange / Act / Assert
        // Current impl throws TypeError — needs null guard for 7+ domain callers
        expect(() => applyReadPragmas(null)).not.toThrow();
      });

      it('should not throw when db is undefined [RED: missing undefined guard]', () => {
        // Arrange / Act / Assert
        // Current impl throws TypeError — needs undefined guard for 7+ domain callers
        expect(() => applyReadPragmas(undefined)).not.toThrow();
      });

      it('should not throw when db has no pragma method', () => {
        // Arrange
        const db = {};

        // Act / Assert
        expect(() => applyReadPragmas(db)).not.toThrow();
      });

      it('should not throw when db.pragma is not a function', () => {
        // Arrange
        const db = { pragma: 'not-a-function' };

        // Act / Assert
        expect(() => applyReadPragmas(db)).not.toThrow();
      });
    });

    describe('call ordering', () => {
      it('should apply mmap_size before cache_size', () => {
        // Arrange
        const calls = [];
        const db = {
          pragma: vi.fn().mockImplementation((stmt) => {
            calls.push(stmt);
          }),
        };

        // Act
        applyReadPragmas(db);

        // Assert
        expect(calls[0]).toBe('mmap_size = 268435456');
        expect(calls[1]).toBe('cache_size = -20000');
      });

      it('should apply temp_store after mmap_size and cache_size', () => {
        // Arrange
        const calls = [];
        const db = {
          pragma: vi.fn().mockImplementation((stmt) => {
            calls.push(stmt);
          }),
        };

        // Act
        applyReadPragmas(db, { tempStoreMemory: true });

        // Assert
        expect(calls).toEqual([
          'mmap_size = 268435456',
          'cache_size = -20000',
          'temp_store = MEMORY',
        ]);
      });
    });
  });
});
