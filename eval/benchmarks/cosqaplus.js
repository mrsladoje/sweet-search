import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class CoSQAPlus extends BaseBenchmark {
  constructor() {
    super({
      name: 'cosqaplus',
      languages: ['python'],
      description: 'CoSQA+ - Multi-choice NL→Python code with test-driven labels (thinkerhui/CoSQA_Plus)',
      source: 'https://huggingface.co/datasets/thinkerhui/CoSQA_Plus',
      downloadCmd: 'cd eval && python3 download_data.py --dataset=cosqaplus',
    });
  }
}

BenchmarkRegistry.register(new CoSQAPlus());
export default CoSQAPlus;
