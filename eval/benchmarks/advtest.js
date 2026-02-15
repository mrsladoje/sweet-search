import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class AdvTest extends BaseBenchmark {
  constructor() {
    super({
      name: 'advtest',
      languages: ['python'],
      description: 'AdvTest - Adversarial code search with obfuscated identifiers',
      source: 'https://huggingface.co/datasets/code_x_glue_ct_code_to_text',
      downloadCmd: 'cd eval && uv run python download_data.py --dataset advtest',
    });
  }

  cleanQuery(query) {
    return super.cleanQuery(query);
  }
}

BenchmarkRegistry.register(new AdvTest());
export default AdvTest;
