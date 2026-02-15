import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class GenCodeSearchNet extends BaseBenchmark {
  constructor() {
    super({
      name: 'gencodesearchnet',
      languages: ['python', 'javascript', 'go', 'ruby', 'java', 'php'],
      description: 'GenCodeSearchNet - Generalization and cross-language robustness testing',
      source: 'https://huggingface.co/datasets/semeru/GenCodeSearchNet',
      downloadCmd: 'cd eval && uv run python download_data.py --dataset gencodesearchnet',
    });
  }
}

BenchmarkRegistry.register(new GenCodeSearchNet());
export default GenCodeSearchNet;
