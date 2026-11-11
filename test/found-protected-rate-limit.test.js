// SPEC: spec-a7920b
// Run with: node --test test/
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

process.env.JWT_SECRET ??= "test-secret";
process.env.ENABLE_RATE_LIMIT = "true";

const express = require("express");
const bcrypt = require("bcryptjs");

const helpers = require("../server/handlers/helpers.handler");
const locals = require("../server/handlers/locals.handler");
const query = require("../server/queries");
const routes = require("../server/routes");
const utils = require("../server/utils");

let server;
let baseURL;
let uuidCounter = 0;

function newLinkId() {
  uuidCounter++;
  return `00000000-0000-0000-0000-${String(uuidCounter).padStart(12, "0")}`;
}

function unlock(id, password, headers = { "content-type": "application/json" }) {
  return fetch(`${baseURL}/api/v2/links/${id}/protected`, {
    method: "POST",
    headers,
    body: JSON.stringify({ password }),
  });
}

before(async () => {
  const password = await bcrypt.hash("secret-pass", 4);
  query.link.find = async ({ uuid }) => ({ id: 1, uuid, target: "https://example.com", password, user_id: null });
  const app = express();
  app.use(express.json());
  app.use(locals.isHTML);
  app.set("view engine", "hbs");
  app.set("views", [path.join(__dirname, "../server/views")]);
  utils.registerHandlebarsHelpers();
  app.use("/api/v2", routes.api);
  app.use(helpers.error);
  await new Promise(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("guessing a protected link's password is rate-limited like login", async () => {
  const id = newLinkId();
  const statuses = [];
  for (let i = 0; i < 30; i++) {
    const res = await unlock(id, "wrong-" + i);
    statuses.push(res.status);
  }
  assert.ok(statuses.includes(429), `30 wrong guesses got: ${[...new Set(statuses)].join(",")}`);
});

test("the first five wrong guesses get 401 and the sixth gets 429 with an error message", async () => {
  const id = newLinkId();
  for (let i = 0; i < 5; i++) {
    const res = await unlock(id, "wrong-" + i);
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(await res.json(), { error: "Password is not correct." });
  }
  const res = await unlock(id, "wrong-6");
  assert.strictEqual(res.status, 429);
  const body = await res.json();
  assert.ok(typeof body.error === "string" && body.error.length > 0, `429 body: ${JSON.stringify(body)}`);
});

test("correct-password attempts count toward the limit", async () => {
  const id = newLinkId();
  for (let i = 0; i < 5; i++) {
    const res = await unlock(id, "secret-pass");
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), { target: "https://example.com" });
  }
  const res = await unlock(id, "secret-pass");
  assert.strictEqual(res.status, 429);
});

test("the limit is per link: another link still accepts attempts", async () => {
  const first = newLinkId();
  for (let i = 0; i < 6; i++) await unlock(first, "wrong-" + i);
  const res = await unlock(newLinkId(), "wrong");
  assert.strictEqual(res.status, 401);
});

test("the HTMX unlock form shows the rate-limit message inline", async () => {
  const id = newLinkId();
  const htmx = { "content-type": "application/json", accept: "text/html", "hx-request": "true" };
  for (let i = 0; i < 5; i++) await unlock(id, "wrong-" + i, htmx);
  const res = await unlock(id, "wrong-6", htmx);
  const html = await res.text();
  assert.match(html, /<form[^>]*id="report-form"/);
  assert.match(html, /<p class="error">[^<]+<\/p>/);
  assert.doesNotMatch(html, /Password is not correct/);
});
