/**
 * Node.js CLI test runner.
 */
import { runAllTests } from './runner.js';
import './schema.test.js';
import './rules.test.js';
import './gameState.test.js';
import './actionQueue.test.js';
import './responseParser.test.js';
import './session.test.js';
import './goldenFixtures.test.js';

async function main() {
  console.log('=== RPG_LLM TEST RUNNER ===\n');
  const res = await runAllTests((t) => {
    const symbol = t.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${symbol} [${t.suite}] ${t.test} (${t.duration}ms)`);
    if (!t.pass) {
      console.error(`    \x1b[31mError: ${t.error}\x1b[0m`);
    }
  });

  console.log('\n----------------------------------------');
  console.log(`Resultados: ${res.passed} passaram, ${res.failed} falharam de ${res.total} testes.`);
  console.log('----------------------------------------\n');

  if (res.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
