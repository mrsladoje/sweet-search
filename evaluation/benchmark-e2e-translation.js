#!/usr/bin/env node
/**
 * End-to-End Translation Search Benchmark
 * 
 * Tests full pipeline: Translation → Search → Results
 */

const queries = [
  { lang: 'sr', query: 'аутентификација', expect: ['Auth', 'Security', 'authentication'] },
  { lang: 'ru', query: 'пользователь', expect: ['User', 'user'] },
  { lang: 'zh', query: '认证服务', expect: ['AuthService', 'Authentication'] },
  { lang: 'ja', query: '認証サービス', expect: ['AuthService', 'Authentication'] },
  { lang: 'sr', query: 'КорисникСервис', expect: ['UserService'] },
  { lang: 'sr', query: 'запослени', expect: ['Employee', 'employee'] },
  { lang: 'en', query: 'AuthService', expect: ['AuthService'] },
];

async function benchmark() {
  console.log('\n' + '═'.repeat(70));
  console.log(' 🔍 END-TO-END TRANSLATION SEARCH BENCHMARK');
  console.log('═'.repeat(70) + '\n');

  const results = [];

  for (const { lang, query, expect } of queries) {
    const start = Date.now();
    
    try {
      const response = await fetch(`http://localhost:9876/search?q=${encodeURIComponent(query)}&k=5`);
      const data = await response.json();
      const latency = Date.now() - start;
      
      const hasMatch = data.results?.some(r => 
        expect.some(e => (r.name || r.file || '').toLowerCase().includes(e.toLowerCase()))
      );
      
      const translation = data.stats?.translation?.translated || query;
      const tier = data.stats?.translation?.tier || '-';
      const triggered = data.stats?.translation?.triggered;
      
      results.push({
        lang,
        query,
        translation: translation.slice(0, 20),
        tier,
        latency,
        results: data.results?.length || 0,
        match: hasMatch,
      });
      
      const status = hasMatch ? '✅' : (data.results?.length > 0 ? '⚠️' : '❌');
      console.log(`[${lang.toUpperCase()}] "${query.slice(0, 20).padEnd(20)}" → "${String(translation).slice(0, 15).padEnd(15)}" (${tier || '-'}) | ${String(latency).padStart(4)}ms | ${data.results?.length || 0} results | ${status}`);
    } catch (err) {
      console.log(`[${lang.toUpperCase()}] "${query}" → ERROR: ${err.message}`);
      results.push({ lang, query, error: err.message });
    }
  }

  console.log('\n' + '─'.repeat(70));
  const passed = results.filter(r => r.match).length;
  const avgLatency = results.filter(r => r.latency).reduce((a, b) => a + b.latency, 0) / results.filter(r => r.latency).length;
  console.log(`📊 Results: ${passed}/${results.length} queries found expected results`);
  console.log(`⏱️  Average latency: ${avgLatency.toFixed(0)}ms`);
  console.log('═'.repeat(70) + '\n');
}

benchmark().catch(console.error);
