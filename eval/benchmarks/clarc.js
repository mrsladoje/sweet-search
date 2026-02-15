import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class CLARC extends BaseBenchmark {
  constructor() {
    super({
      name: 'clarc',
      languages: ['c', 'cpp'],
      description: 'CLARC - C/C++ code retrieval benchmark',
      source: 'https://huggingface.co/datasets/AkariAsai/CLARC',
      downloadCmd: 'cd eval && uv run python download_data.py --dataset clarc',
    });
  }
}

BenchmarkRegistry.register(new CLARC());
export default CLARC;
