import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class CodeSearchNet extends BaseBenchmark {
  constructor() {
    super({
      name: 'codesearchnet',
      languages: ['python', 'javascript', 'go', 'ruby', 'java', 'php'],
      description: 'CodeSearchNet - NL docstring to code function retrieval',
      source: 'https://huggingface.co/datasets/code-search-net/code_search_net',
      downloadCmd: 'cd eval && uv run python download_data.py --dataset codesearchnet',
    });
  }
}

BenchmarkRegistry.register(new CodeSearchNet());
export default CodeSearchNet;
