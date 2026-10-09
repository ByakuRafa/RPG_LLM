/**
 * Zero-dependency unit test runner.
 * Works both in browser (tests/index.html) and Node.js.
 */
const suites = [];
let currentSuite = null;

export function describe(name, fn) {
  const suite = { name, tests: [] };
  suites.push(suite);
  currentSuite = suite;
  fn();
  currentSuite = null;
}

export function it(name, fn) {
  if (!currentSuite) throw new Error('it() must be inside describe()');
  currentSuite.tests.push({ name, fn });
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
    toBeGreaterThan(num) {
      if (isNot ? actual > num : !(actual > num)) throw new Error(`Expected ${actual} ${isNot ? 'NOT >' : '>'} ${num}`);
    },
    toBeLessThanOrEqual(num) {
      if (isNot ? actual <= num : !(actual <= num)) throw new Error(`Expected ${actual} ${isNot ? 'NOT <=' : '<='} ${num}`);
    },
    toBeTruthy() {
      if (isNot ? !!actual : !actual) throw new Error(`Expected ${isNot ? 'falsy' : 'truthy'} value, got ${actual}`);
    },
    toBeFalsy() {
      if (isNot ? !actual : !!actual) throw new Error(`Expected ${isNot ? 'truthy' : 'falsy'} value, got ${actual}`);
    },
    toContain(sub) {
      const contains = (typeof actual === 'string' && actual.includes(sub)) || (Array.isArray(actual) && actual.includes(sub));
      if (isNot ? contains : !contains) {
        throw new Error(`Expected ${JSON.stringify(actual)} ${isNot ? 'NOT to contain' : 'to contain'} ${JSON.stringify(sub)}`);
      }
    },
    toThrow(regexOrMsg) {
      let threw = false;
      let error = null;
      try {
        actual();
      } catch (err) {
        threw = true;
        error = err;
      }
      if (isNot ? threw : !threw) throw new Error(isNot ? 'Expected function NOT to throw, but it threw.' : 'Expected function to throw, but it did not.');
      if (!isNot && regexOrMsg && typeof regexOrMsg === 'string' && !error.message.includes(regexOrMsg)) {
        throw new Error(`Expected thrown message to contain "${regexOrMsg}", got "${error.message}"`);
      }
    },
  });

  return {
    ...matchers(false),
    not: matchers(true),
  };
}

export async function runAllTests(onProgress = null) {
  let passed = 0;
  let failed = 0;
  const results = [];

  for (const suite of suites) {
    const suiteRes = { name: suite.name, tests: [] };
    for (const test of suite.tests) {
      const t0 = performance.now();
      try {
        await test.fn();
        const duration = Math.round(performance.now() - t0);
        suiteRes.tests.push({ name: test.name, pass: true, duration });
        passed++;
        onProgress?.({ suite: suite.name, test: test.name, pass: true, duration });
      } catch (err) {
        const duration = Math.round(performance.now() - t0);
        suiteRes.tests.push({ name: test.name, pass: false, error: err.message, duration });
        failed++;
        onProgress?.({ suite: suite.name, test: test.name, pass: false, error: err.message, duration });
      }
    }
    results.push(suiteRes);
  }

  return { passed, failed, total: passed + failed, suites: results };
}
