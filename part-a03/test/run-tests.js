const assert = require("assert");

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(
      () => {
        console.log(`ok - ${name}`);
      },
      (e) => {
        console.error(`FAIL - ${name}`);
        console.error(e.stack || e);
        process.exitCode = 1;
      }
    );
}

global.test = test;
global.expect = (received) => ({
  toBe(value) {
    assert.strictEqual(received, value);
  },
  toEqual(value) {
    assert.deepStrictEqual(received, value);
  },
  toBeTruthy() {
    assert.ok(received);
  },
  toBeFalsy() {
    assert.ok(!received);
  }
});

require("./worker.test");

