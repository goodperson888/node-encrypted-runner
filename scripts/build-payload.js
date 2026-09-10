"use strict";

const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const { encryptPayload } = require("../payload-crypto");

const root = path.resolve(__dirname, "..");

function resolvePassword(value = "") {
  if (value) return String(value);
  if (process.env.CLIENT_PAYLOAD_PASSWORD) return process.env.CLIENT_PAYLOAD_PASSWORD;
  if (process.env.CLIENT_RUN_PASSWORD) return process.env.CLIENT_RUN_PASSWORD;
  const file = path.join(root, "client-password.txt");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
}

function buildPayload(outputFile, password = resolvePassword()) {
  if (!password) {
    throw new Error("构建加密流程需要密码，请设置 CLIENT_PAYLOAD_PASSWORD、CLIENT_RUN_PASSWORD 或 client-password.txt。");
  }
  const result = esbuild.buildSync({
    entryPoints: [path.join(root, "browser-flow.js")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    minify: true,
    packages: "external",
    legalComments: "none",
    write: false,
  });
  const encrypted = encryptPayload(result.outputFiles[0].contents, password);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(encrypted)}\n`, { mode: 0o600 });
  return outputFile;
}

if (require.main === module) {
  const output = path.resolve(process.cwd(), process.argv[2] || "workflow.js.enc");
  console.log(`已生成：${buildPayload(output)}`);
}

module.exports = { buildPayload, resolvePassword };
