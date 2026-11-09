// SPEC: spec-883f26
// Run with: node --test test/
const { test, before, after } = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET ??= "test-secret";
process.env.DEFAULT_DOMAIN = "localhost";

const express = require("express");
const http = require("node:http");

const asyncHandler = require("../server/utils/asyncHandler");
const links = require("../server/handlers/links.handler");
const query = require("../server/queries");
const routes = require("../server/routes");
const api = require("../docs/api/api");

let server;
let baseURL;

// mount the api router the same way server/server.js does
before(async () => {
  const app = express();
  app.use(asyncHandler(links.redirectCustomDomainHomepage));
  app.use("/api/v2", routes.api);
  app.use("/api", routes.api);
  await new Promise(resolve => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// send the request with an explicit host header, the way a browser on that host would
function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(baseURL + path, { headers: { host: "localhost", ...headers } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

async function expectJSONStatus(path) {
  const res = await get(path);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers["content-type"], /^application\/json/);
  assert.strictEqual(res.body, '{"status":"ok"}');
}

test("GET /api/v2/health returns 200 with JSON {\"status\":\"ok\"}", async () => {
  await expectJSONStatus("/api/v2/health");
});

test("GET /api/health returns the same JSON response", async () => {
  await expectJSONStatus("/api/health");
});

test("health needs no login or API key", async () => {
  // no cookie, no x-api-key header
  const res = await get("/api/v2/health");
  assert.strictEqual(res.status, 200);
});

test("API docs describe /health as JSON with a required status enum [\"ok\"]", () => {
  const response = api.paths["/health"].get.responses["200"];
  const json = response.content["application/json"];
  assert.ok(json, "application/json content is documented");
  assert.strictEqual(response.content["text/html"], undefined);
  assert.deepStrictEqual(json.schema, {
    type: "object",
    required: ["status"],
    properties: { status: { type: "string", enum: ["ok"] } },
  });
  assert.deepStrictEqual(json.example, { status: "ok" });
});

test("custom domain with a homepage still redirects before the health handler", async t => {
  t.mock.method(query.domain, "find", async match =>
    match.address === "custom.example" ? { address: "custom.example", homepage: "https://home.example" } : null
  );
  const res = await get("/api/v2/health", { host: "custom.example" });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.location, "https://home.example");
});
