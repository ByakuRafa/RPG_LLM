/**
 * Zero-dependency unit test runner.
 * Supports both standalone assert/assertEqual/assertDeepEqual and describe/it/expect.
 * Renders in browser via run(rootEl) and returns summary results.
 */

const suites = [];
let defaultSuite = null;
let currentSuite = null;

function getDefaultSuite() {
  if (!defaultSuite) {
    defaultSuite = { name: 'Geral', tests: [] };
    suites.push(defaultSuite);
  }
  return defaultSuite;
}

export function describe(name, fn) {
  const suite = { name, tests: [] };
  suites.push(suite);
  currentSuite = suite;
  fn();
  currentSuite = null;
}

export function it(name, fn) {
  const suite = currentSuite || getDefaultSuite();
  suite.tests.push({ name, fn });
}

export function test(name, fn) {
  it(name, fn);
}

export function assert(cond, msg = 'Assertion failed') {
  if (!cond) {
    throw new Error(msg);
  }
}

export function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertDeepEqual(actual, expected, msg) {
  const aStr = JSON.stringify(actual);
  const eStr = JSON.stringify(expected);
  if (aStr !== eStr) {
    throw new Error(msg || `Deep equality mismatch:\nExpected: ${eStr}\nReceived: ${aStr}`);
  }
}

export function expect(actual) {
  const matchers = (isNot = false) => ({
    toBe(expected) {
      const match = actual === expected;
      if (isNot ? match : !match) {
        throw new Error(
          isNot
            ? `Expected value NOT to be ${JSON.stringify(expected)}`
            : `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
      }
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      const match = a === e;
      if (isNot ? match : !match) {
        throw new Error(
          isNot
            ? `Expected values NOT to deeply equal:\n${e}`
            : `Expected deep equality:\nExpected: ${e}\nReceived: ${a}`
        );
      }
    },
    toBeTruthy() {
      if (isNot ? !!actual : !actual) {
        throw new Error(`Expected ${isNot ? 'falsy' : 'truthy'} value, got ${actual}`);
      }
    },
    toBeFalsy() {
      if (isNot ? !actual : !!actual) {
        throw new Error(`Expected ${isNot ? 'truthy' : 'falsy'} value, got ${actual}`);
      }
    }
  });

  return {
    ...matchers(false),
    not: matchers(true)
  };
}

export async function runAllTests(onProgress = null) {
  let passed = 0;
  let failed = 0;
  const results = [];

  for (const suite of suites) {
    if (!suite.tests.length) continue;
    const suiteRes = { name: suite.name, tests: [] };

    for (const t of suite.tests) {
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      try {
        await t.fn();
        const duration = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
        suiteRes.tests.push({ name: t.name, pass: true, duration });
        passed++;
        onProgress?.({ suite: suite.name, test: t.name, pass: true, duration });
      } catch (err) {
        const duration = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
        suiteRes.tests.push({ name: t.name, pass: false, error: err.message, duration });
        failed++;
        onProgress?.({ suite: suite.name, test: t.name, pass: false, error: err.message, duration });
      }
    }
    results.push(suiteRes);
  }

  return { passed, failed, total: passed + failed, suites: results };
}

export async function run(rootEl = null) {
  const res = await runAllTests();

  if (rootEl && typeof document !== 'undefined') {
    rootEl.innerHTML = '';

    const summary = document.createElement('div');
    summary.className = 'summary-bar';
    summary.innerHTML = `
      <div class="pill ${res.failed === 0 ? 'pill-pass' : 'pill-fail'}">
        ${res.failed === 0 ? '✓ Todos os testes passaram' : `✗ ${res.failed} teste(s) falharam`}
      </div>
      <div class="pill pill-pass">Passou: ${res.passed}</div>
      <div class="pill pill-fail">Falhou: ${res.failed}</div>
      <div class="pill pill-total">Total: ${res.total}</div>
    `;
    rootEl.appendChild(summary);

    for (const suite of res.suites) {
      const suiteCard = document.createElement('div');
      suiteCard.className = 'suite-card';

      const suiteHeader = document.createElement('div');
      suiteHeader.className = 'suite-header';
      suiteHeader.textContent = suite.name;
      suiteCard.appendChild(suiteHeader);

      for (const t of suite.tests) {
        const row = document.createElement('div');
        row.className = 'test-row';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'test-name';

        const icon = document.createElement('span');
        icon.className = t.pass ? 'icon-pass' : 'icon-fail';
        icon.textContent = t.pass ? '✓' : '✗';

        const text = document.createElement('span');
        text.textContent = ` ${t.name}`;

        nameSpan.appendChild(icon);
        nameSpan.appendChild(text);

        const timeSpan = document.createElement('span');
        timeSpan.className = 'test-time';
        timeSpan.textContent = `${t.duration}ms`;

        row.appendChild(nameSpan);
        row.appendChild(timeSpan);
        suiteCard.appendChild(row);

        if (!t.pass && t.error) {
          const errDiv = document.createElement('div');
          errDiv.className = 'error-msg';
          errDiv.textContent = t.error;
          suiteCard.appendChild(errDiv);
        }
      }

      rootEl.appendChild(suiteCard);
    }
  }

  return res;
}
