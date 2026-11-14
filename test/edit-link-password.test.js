// Run with: node --test test/
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "kutt-edit-pw-"));
process.env.JWT_SECRET ??= "test-secret";
process.env.DEFAULT_DOMAIN = "localhost";
process.env.DB_CLIENT = "better-sqlite3";
process.env.DB_FILENAME = path.join(dbDir, "data");
process.env.REDIS_ENABLED = "false";
process.env.ENABLE_RATE_LIMIT = "false";

const express = require("express");
const passport = require("passport");
const bcrypt = require("bcryptjs");

require("../server/passport");
const locals = require("../server/handlers/locals.handler");
const helpers = require("../server/handlers/helpers.handler");
const models = require("../server/models");
const routes = require("../server/routes");
const knex = require("../server/knex");

const APIKEY = "test-api-key-0123456789";
let server;
let baseURL;
let userId;

async function addLink(fields) {
  await knex("links").insert({ target: "https://example.com/t", user_id: userId, ...fields });
  return knex("links").where("address", fields.address).first();
}

function patch(uuid, body) {
  return fetch(`${baseURL}/api/v2/links/${uuid}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-api-key": APIKEY },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await models.createUserTable(knex);
  await models.createDomainTable(knex);
  await models.createLinkTable(knex);
  await knex("users").insert({ email: "u@example.com", password: "x", verified: true, apikey: APIKEY });
  userId = (await knex("users").where("apikey", APIKEY).first()).id;

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

test("an API edit without a password field keeps the link's password", async () => {
  const hash = await bcrypt.hash("secret-pass", 4);
  const link = await addLink({ address: "pw1", password: hash });
  const res = await patch(link.uuid, { description: "new description" });
  assert.strictEqual(res.status, 200);
  const stored = await knex("links").where("id", link.id).first();
  assert.strictEqual(stored.description, "new description");
  assert.strictEqual(stored.password, hash);
  assert.strictEqual((await res.json()).password, true);
});

test("an API edit with an empty password removes the link's password", async () => {
  const hash = await bcrypt.hash("secret-pass", 4);
  const link = await addLink({ address: "pw2", password: hash });
  const res = await patch(link.uuid, { password: "" });
  assert.strictEqual(res.status, 200);
  const stored = await knex("links").where("id", link.id).first();
  assert.strictEqual(stored.password, null);
});

test("an API edit with a new password replaces the link's password", async () => {
  const hash = await bcrypt.hash("secret-pass", 4);
  const link = await addLink({ address: "pw3", password: hash });
  const res = await patch(link.uuid, { password: "other-pass" });
  assert.strictEqual(res.status, 200);
  const stored = await knex("links").where("id", link.id).first();
  assert.ok(await bcrypt.compare("other-pass", stored.password));
});

test("an API edit without a password field on a link with no password changes nothing else", async () => {
  const link = await addLink({ address: "pw4" });
  const res = await patch(link.uuid, { description: "d4" });
  assert.strictEqual(res.status, 200);
  const stored = await knex("links").where("id", link.id).first();
  assert.strictEqual(stored.password, null);
  assert.strictEqual(stored.description, "d4");
});
