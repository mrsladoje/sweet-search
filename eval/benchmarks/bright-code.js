import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class BrightCode extends BaseBenchmark {
  constructor() {
    super({
      name: 'bright-code',
      languages: ['python', 'pony', 'any'],
      description: 'BRIGHT code subsets - LeetCode + Pony + StackOverflow, reasoning-intensive NL→code/docs retrieval (xlangai/BRIGHT)',
      source: 'https://huggingface.co/datasets/xlangai/BRIGHT',
      downloadCmd: 'cd eval && python3 download_data.py --dataset=bright-code',
    });
  }
}

BenchmarkRegistry.register(new BrightCode());
export default BrightCode;
