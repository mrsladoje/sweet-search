import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class CrossCodeEval extends BaseBenchmark {
  constructor() {
    super({
      name: 'crosscodeeval',
      languages: ['python', 'java', 'typescript', 'csharp'],
      description: 'CrossCodeEval - Cross-file code retrieval at repository level',
      source: 'https://github.com/amazon-science/cceval',
      downloadCmd: 'cd eval && uv run python download_data.py --dataset crosscodeeval',
    });
  }
}

BenchmarkRegistry.register(new CrossCodeEval());
export default CrossCodeEval;
