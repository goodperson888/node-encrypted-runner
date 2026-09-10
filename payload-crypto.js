"use strict";

const crypto = require("crypto");

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), Buffer.from(salt, "base64"), 32);
}

function encryptPayload(source, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(password, salt), iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(source)), cipher.final()]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptPayload(payload, password) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!parsed || parsed.version !== 1 || parsed.algorithm !== "aes-256-gcm") {
    throw new Error("流程载荷格式不受支持。");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(password, parsed.salt),
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = { encryptPayload, decryptPayload };
