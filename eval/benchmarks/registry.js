/**
 * Benchmark registry - central catalog of all available benchmarks.
 */

const benchmarks = new Map();

export const BenchmarkRegistry = {
  /**
   * Register a benchmark adapter.
   * @param {import('./base.js').BaseBenchmark} benchmark
   */
  register(benchmark) {
    benchmarks.set(benchmark.name, benchmark);
  },

  /**
   * Get a benchmark by name.
   * @param {string} name
   * @returns {import('./base.js').BaseBenchmark | undefined}
   */
  get(name) {
    return benchmarks.get(name);
  },

  /**
   * Get all registered benchmarks.
   * @returns {Array<import('./base.js').BaseBenchmark>}
   */
  getAll() {
    return [...benchmarks.values()];
  },

  /**
   * List benchmark names.
   * @returns {string[]}
   */
  list() {
    return [...benchmarks.keys()];
  },

  /**
   * Get benchmarks that have data downloaded.
   * @param {string} evalDir
   * @returns {Array<import('./base.js').BaseBenchmark>}
   */
  getAvailable(evalDir) {
    return [...benchmarks.values()].filter(b => b.hasData(evalDir));
  },
};
