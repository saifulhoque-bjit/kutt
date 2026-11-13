// SPEC: spec-190a35
// Run with: node --test test/
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "kutt-expired-"));
process.env.JWT_SECRET ??= "test-secret";
process.env.DEFAULT_DOMAIN = "localhost";
process.env.DB_CLIENT = "better-sqlite3";
process.env.DB_FILENAME = path.join(dbDir, "data");
process.env.REDIS_ENABLED = "false";
process.env.ENABLE_RATE_LIMIT = "false";

const express = require("express");
const bcrypt = require("bcryptjs");

const asyncHandler = require("../server/utils/asyncHandler");
const links = require("../server/handlers/links.handler");
const helpers = require("../server/handlers/helpers.handler");
const locals = require("../server/handlers/locals.handler");
const models = require("../server/models");
const routes = require("../server/routes");
const query = require("../server/queries");
const utils = require("../server/utils");
const knex = require("../server/knex");

// the cleanup job in server/cron.js is never started here, as on an instance where it does not run

let server;
let baseURL;
let password;

const past = () => utils.dateToUTC(new Date(Date.now() - 5_000));
const future = () => utils.dateToUTC(new Date(Date.now() + 2 * 60_000));

async function addLink(fields) {
  await knex("links").insert({ target: "https://example.com/t", ...fields });
  return knex("links").where("address", fields.address).first();
}

// node:http, because fetch does not send a custom Host header
function get(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(baseURL + pathname, { headers: { host: "localhost", ...headers } }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: { get: name => res.headers[name] ?? null },
        text: async () => body,
      }));
    });
    req.on("error", reject);
  });
}

function basic(pass) {
  return { authorization: "Basic " + Buffer.from("user:" + pass).toString("base64") };
}

function unlock(uuid, pass) {
  return fetch(`${baseURL}/api/v2/links/${uuid}/protected`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: pass }),
  });
}

before(async () => {
  await models.createUserTable(knex);
  await models.createDomainTable(knex);
  await models.createLinkTable(knex);
  password = await bcrypt.hash("secret-pass", 4);
  await knex("domains").insert({ address: "custom.test", homepage: "https://custom.test/home" });

  // mount the handlers the same way server/server.js does
  const app = express();
  app.use(express.json());
  app.use(locals.isHTML);
  app.use("/api/v2", routes.api);
  app.get("/:id", asyncHandler(links.redirect));
  app.use(helpers.error);
  await new Promise(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await knex.destroy();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

test("an expired link redirects to /404, not to its target, without the cleanup job", async () => {
  await addLink({ address: "exp1", expire_in: past() });
  const res = await get("/exp1");
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get("location"), "/404");
});

test("an expired link on a custom domain redirects to the domain's homepage", async () => {
  const domain = await knex("domains").where("address", "custom.test").first();
  await addLink({ address: "exp2", domain_id: domain.id, expire_in: past() });
  const res = await get("/exp2", { host: "custom.test" });
  assert.strictEqual(res.headers.get("location"), "https://custom.test/home");
});

test("the + info view of an expired link does not show its target", async () => {
  await addLink({ address: "exp3", expire_in: past() });
  const res = await get("/exp3+");
  assert.strictEqual(res.headers.get("location"), "/404");
  assert.doesNotMatch(await res.text(), /example\.com\/t/);
});

test("an expired protected link does not redirect with the correct Basic auth password", async () => {
  await addLink({ address: "exp4", password, expire_in: past() });
  const res = await get("/exp4", basic("secret-pass"));
  assert.strictEqual(res.headers.get("location"), "/404");
});

test("unlocking an expired protected link answers 'Couldn't find the link.' (400)", async () => {
  const link = await addLink({ address: "exp5", password, expire_in: past() });
  const res = await unlock(link.uuid, "secret-pass");
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(await res.json(), { error: "Couldn't find the link." });
});

test("an expired link read from the Redis cache (ISO string) does not redirect", async () => {
  const original = query.link.find;
  query.link.find = async () => ({
    id: 99, address: "cached", target: "https://example.com/t", banned: false,
    password: null, user_id: null, domain_id: null,
    expire_in: new Date(Date.now() - 5_000).toISOString(),
  });
  try {
    const res = await get("/cached");
    assert.strictEqual(res.headers.get("location"), "/404");
  } finally {
    query.link.find = original;
  }
});

test("a link whose expire_in cannot be read counts as expired", async () => {
  const original = query.link.find;
  query.link.find = async () => ({
    id: 98, address: "bad", target: "https://example.com/t", banned: false,
    password: null, user_id: null, domain_id: null, expire_in: "not a date",
  });
  try {
    const res = await get("/bad");
    assert.strictEqual(res.headers.get("location"), "/404");
  } finally {
    query.link.find = original;
  }
});

test("a link that expires in the future still redirects to its target", async () => {
  await addLink({ address: "live1", expire_in: future() });
  const res = await get("/live1");
  assert.strictEqual(res.headers.get("location"), "https://example.com/t");
});

test("a link with a future expire_in from the Redis cache still redirects", async () => {
  const original = query.link.find;
  query.link.find = async () => ({
    id: 97, address: "cached2", target: "https://example.com/t", banned: false,
    password: null, user_id: null, domain_id: null,
    expire_in: new Date(Date.now() + 2 * 60_000).toISOString(),
  });
  try {
    const res = await get("/cached2");
    assert.strictEqual(res.headers.get("location"), "https://example.com/t");
  } finally {
    query.link.find = original;
  }
});

test("a link with no expire_in still redirects to its target", async () => {
  await addLink({ address: "live2" });
  const res = await get("/live2");
  assert.strictEqual(res.headers.get("location"), "https://example.com/t");
});

test("a protected link with a future expire_in still unlocks and redirects with Basic auth", async () => {
  const link = await addLink({ address: "live3", password, expire_in: future() });
  const res = await get("/live3", basic("secret-pass"));
  assert.strictEqual(res.headers.get("location"), "https://example.com/t");
  const unlocked = await unlock(link.uuid, "secret-pass");
  assert.strictEqual(unlocked.status, 200);
  assert.deepStrictEqual(await unlocked.json(), { target: "https://example.com/t" });
});

test("unknown addresses and banned links are handled as before", async () => {
  assert.strictEqual((await get("/nope")).headers.get("location"), "/404");
  assert.strictEqual((await get("/nope", { host: "custom.test" })).headers.get("location"), "https://custom.test/home");
  await addLink({ address: "ban1", banned: true });
  assert.strictEqual((await get("/ban1")).headers.get("location"), "/banned");
});
