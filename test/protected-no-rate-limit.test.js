// SPEC: spec-a7920b
// Run with: node --test test/
const { test, before, after } = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET ??= "test-secret";
process.env.ENABLE_RATE_LIMIT = "false";

const express = require("express");
const bcrypt = require("bcryptjs");

const helpers = require("../server/handlers/helpers.handler");
const query = require("../server/queries");
const routes = require("../server/routes");

const id = "00000000-0000-0000-0000-000000000001";
let server;
let baseURL;

function unlock(password) {
  return fetch(`${baseURL}/api/v2/links/${id}/protected`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

before(async () => {
  const password = await bcrypt.hash("secret-pass", 4);
  query.link.find = async () => ({ id: 1, uuid: id, target: "https://example.com", password, user_id: null });
  const app = express();
  app.use(express.json());
  app.use("/api/v2", routes.api);
  app.use(helpers.error);
  await new Promise(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("with rate limiting off, wrong guesses keep getting 401 and the right password still unlocks", async () => {
  for (let i = 0; i < 10; i++) {
    const res = await unlock("wrong-" + i);
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(await res.json(), { error: "Password is not correct." });
  }
  const res = await unlock("secret-pass");
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { target: "https://example.com" });
});
