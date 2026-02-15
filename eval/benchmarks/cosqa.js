import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class CosQA extends BaseBenchmark {
  constructor() {
    super({
      name: 'cosqa',
      languages: ['python'],
      description: 'CosQA - Real web queries to Python code retrieval',
      source: 'https://huggingface.co/datasets/code_x_glue_tc_nl_code_search_adv',
      downloadCmd: 'cd eval && uv run python download_data.py --dataset cosqa',
    });
  }
}

BenchmarkRegistry.register(new CosQA());
export default CosQA;
