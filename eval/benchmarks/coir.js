import { BaseBenchmark } from './base.js';
import { BenchmarkRegistry } from './registry.js';

class CoIR extends BaseBenchmark {
  constructor() {
    super({
      name: 'coir',
      languages: [
        'python', 'javascript', 'go', 'ruby', 'java', 'php',
        'c', 'cpp', 'csharp', 'typescript', 'sql', 'swift', 'kotlin', 'scala',
      ],
      description: 'COIR - Comprehensive code IR benchmark (14 languages, 10 datasets)',
      source: 'https://huggingface.co/collections/CoIR-Retrieval/coir-benchmark-data-6706b46e6b84e2a21f42c70f',
      downloadCmd: 'cd eval && uv run python download_data.py --dataset coir',
    });
  }
}

BenchmarkRegistry.register(new CoIR());
export default CoIR;
