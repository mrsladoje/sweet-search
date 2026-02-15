import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class CoQuIR extends BaseBenchmark {
  constructor() {
    super({
      name: 'coquir',
      languages: [
        'python', 'javascript', 'go', 'ruby', 'java', 'php',
        'typescript', 'rust', 'cpp', 'kotlin', 'scala',
      ],
      description: 'CoQuIR - Quality-aware code retrieval (correctness, security, efficiency)',
      source: 'https://huggingface.co/datasets/CoQuIR/coquir',
      downloadCmd: 'cd eval && uv run python download_data.py --dataset coquir',
    });
  }
}

BenchmarkRegistry.register(new CoQuIR());
export default CoQuIR;
