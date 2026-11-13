// Run with: node --test test/
const { test, mock } = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET ??= "test-secret";

const query = require("../server/queries");

test("a failed expired-link cleanup does not leave an unhandled rejection", async () => {
  const unhandled = [];
  const onUnhandled = err => unhandled.push(err.message);
  process.on("unhandledRejection", onUnhandled);

  const logged = [];
  const consoleError = mock.method(console, "error", (...args) => logged.push(args));

  query.link.batchRemove = () => Promise.reject(new Error("database is unavailable"));
  mock.timers.enable({ apis: ["setInterval"] });
  require("../server/cron");
  mock.timers.tick(30_000);
  await new Promise(resolve => setImmediate(resolve));
  mock.timers.reset();
  consoleError.mock.restore();
  process.off("unhandledRejection", onUnhandled);

  assert.deepStrictEqual(unhandled, []);
  const cleanupErrors = logged.filter(args =>
    args.some(arg => arg instanceof Error && arg.message === "database is unavailable")
  );
  assert.strictEqual(cleanupErrors.length, 1);
});
