// SPEC: spec-190a35
// Run with: node --test test/expired-link-unit.test.js
// A unit test of the redirect handler: no http server, no database.
const { test } = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET ??= "test-secret";
process.env.DEFAULT_DOMAIN = "localhost";
process.env.REDIS_ENABLED = "false";

const links = require("../server/handlers/links.handler");
const query = require("../server/queries");
const utils = require("../server/utils");

test("an expired short link answers /404 and does not redirect to its target", async t => {
  const target = "https://example.com/expired-target";
  t.mock.method(query.link, "find", async () => ({
    id: 1, address: "exp1", target, banned: false,
    password: null, user_id: null, domain_id: null,
    expire_in: utils.dateToUTC(new Date(Date.now() - 5_000)),
  }));
  t.mock.method(query.domain, "find", async () => {
    throw new Error("the default domain must not look up a custom domain");
  });

  const req = { path: "/exp1", params: { id: "exp1" }, headers: { host: "localhost" } };
  const redirects = [];
  const res = { redirect: (...args) => { redirects.push(args); } };
  let nextCalled = false;

  await links.redirect(req, res, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false);
  assert.deepStrictEqual(redirects, [["/404"]]);
  assert.ok(!redirects.flat().includes(target));
});
