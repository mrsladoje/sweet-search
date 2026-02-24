import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class M2CRB extends BaseBenchmark {
  constructor() {
    super({
      name: 'm2crb',
      languages: ['python', 'java', 'javascript'],
      description: 'M2CRB - Multilingual text-to-code retrieval (ES/PT/DE/FR → Python/Java/JS)',
      source: 'https://huggingface.co/datasets/blindsubmissions/M2CRB',
      downloadCmd: 'cd eval && uv run python download_data.py --dataset m2crb',
    });
  }
}

BenchmarkRegistry.register(new M2CRB());
export default M2CRB;
