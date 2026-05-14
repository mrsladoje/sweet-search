import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class CoREB extends BaseBenchmark {
  constructor() {
    super({
      name: 'coreb',
      languages: ['python', 'java', 'cpp', 'ruby', 'go'],
      description: 'CoREB - Contamination-limited multitask code retrieval (text-to-code subtask, hq-bench/coreb-t2c-retrieval)',
      source: 'https://huggingface.co/datasets/hq-bench/coreb-t2c-retrieval',
      downloadCmd: 'cd eval && python3 download_data.py --dataset=coreb',
    });
  }
}

BenchmarkRegistry.register(new CoREB());
export default CoREB;
