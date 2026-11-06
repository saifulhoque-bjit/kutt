// SPEC: spec-2fdb4a
// Run with: node --test test/
const { test } = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET ??= "test-secret";

const { validationResult } = require("express-validator");
const validators = require("../server/handlers/validators.handler");

const PRESERVED_MESSAGE = "You can't use this custom URL.";

async function errorsFor(chain, field, value) {
  const req = {
    body: { target: "https://example.com", [field]: value },
    user: { id: 1 }
  };
  for (const validator of chain) await validator.run(req);
  return validationResult(req)
    .array()
    .filter(error => error.param === field)
    .map(error => error.msg);
}

for (const value of ["login", "Login", "SETTINGS", "Admin"]) {
  test(`createLink rejects reserved customurl "${value}"`, async () => {
    assert.deepStrictEqual(await errorsFor(validators.createLink, "customurl", value), [PRESERVED_MESSAGE]);
  });

  test(`editLink rejects reserved address "${value}"`, async () => {
    assert.deepStrictEqual(await errorsFor(validators.editLink, "address", value), [PRESERVED_MESSAGE]);
  });
}

test("a non-reserved custom URL is accepted with its letter case kept", async () => {
  const req = {
    body: { target: "https://example.com", customurl: "MyLink" },
    user: { id: 1 }
  };
  for (const validator of validators.createLink) await validator.run(req);
  assert.deepStrictEqual(validationResult(req).array(), []);
  assert.strictEqual(req.body.customurl, "MyLink");

  assert.deepStrictEqual(await errorsFor(validators.editLink, "address", "MyLink"), []);
});
