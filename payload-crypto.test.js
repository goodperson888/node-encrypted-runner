"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { encryptPayload, decryptPayload } = require("./payload-crypto");

test("流程载荷可加密并用密码解密", () => {
  const payload = encryptPayload("module.exports = { main: async () => 'ok' };", "test-password");
  assert.notEqual(payload.data, Buffer.from("module.exports = { main: async () => 'ok' };").toString("base64"));
  assert.equal(decryptPayload(payload, "test-password"), "module.exports = { main: async () => 'ok' };");
  assert.throws(() => decryptPayload(payload, "wrong-password"));
});
