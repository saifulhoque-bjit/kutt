// Run with: node --test test/
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "kutt-edit-pass-"));
process.env.JWT_SECRET ??= "test-secret";
process.env.DEFAULT_DOMAIN = "localhost";
process.env.DB_CLIENT = "better-sqlite3";
process.env.DB_FILENAME = path.join(dbDir, "data");
process.env.REDIS_ENABLED = "false";
process.env.ENABLE_RATE_LIMIT = "false";

const express = require("express");
const passport = require("passport");
const bcrypt = require("bcryptjs");

const helpers = require("../server/handlers/helpers.handler");
const locals = require("../server/handlers/locals.handler");
const models = require("../server/models");
const routes = require("../server/routes");
const knex = require("../server/knex");

require("../server/passport");

const APIKEY = "k".repeat(40);
let server;
let baseURL;
let password;
let admin;

async function addLink(fields) {
  await knex("links").insert({ target: "https://example.com/t", user_id: admin.id, ...fields });
  return knex("links").where("address", fields.address).first();
}

function patch(pathname, body) {
  return fetch(baseURL + "/api/v2/links/" + pathname, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-api-key": APIKEY },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await models.createUserTable(knex);
  await models.createDomainTable(knex);
  await models.createLinkTable(knex);
  password = await bcrypt.hash("secret-pass", 4);
  await knex("users").insert({
    email: "admin@test.local", password, apikey: APIKEY, verified: true, role: "ADMIN"
  });
  admin = await knex("users").where("email", "admin@test.local").first();

  // mount the handlers the same way server/server.js does
  const app = express();
  app.use(express.json());
  app.use(passport.initialize());
  app.use(locals.isHTML);
  app.use("/api/v2", routes.api);
  app.use(helpers.error);
  await new Promise(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await knex.destroy();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

test("API edit without a password field keeps the link's password", async () => {
  const link = await addLink({ address: "keep1", password });
  const res = await patch(link.uuid, { description: "new description" });
  assert.strictEqual(res.status, 200, await res.text());
  const stored = await knex("links").where("id", link.id).first();
  assert.strictEqual(stored.description, "new description");
  assert.strictEqual(stored.password, password);
});

test("admin API edit without a password field keeps the link's password", async () => {
  const link = await addLink({ address: "keep2", password });
  const res = await patch("admin/" + link.uuid, { target: "https://example.com/other" });
  assert.strictEqual(res.status, 200, await res.text());
  const stored = await knex("links").where("id", link.id).first();
  assert.strictEqual(stored.target, "https://example.com/other");
  assert.strictEqual(stored.password, password);
});

test("API edit with an empty password removes the link's password", async () => {
  const link = await addLink({ address: "clear1", password });
  const res = await patch(link.uuid, { password: "" });
  assert.strictEqual(res.status, 200, await res.text());
  const stored = await knex("links").where("id", link.id).first();
  assert.strictEqual(stored.password, null);
});

test("API edit with the masked password keeps the link's password", async () => {
  const link = await addLink({ address: "mask1", password });
  const res = await patch(link.uuid, { password: "••••••••", description: "d" });
  assert.strictEqual(res.status, 200, await res.text());
  const stored = await knex("links").where("id", link.id).first();
  assert.strictEqual(stored.password, password);
});

test("API edit with a new password replaces the link's password", async () => {
  const link = await addLink({ address: "new1", password });
  const res = await patch(link.uuid, { password: "other-pass" });
  assert.strictEqual(res.status, 200, await res.text());
  const stored = await knex("links").where("id", link.id).first();
  assert.ok(await bcrypt.compare("other-pass", stored.password));
});
