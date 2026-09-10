#!/usr/bin/env node
// Protocol Workbench customer runner. Replace browser-flow.js when you publish a new workflow.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Module = require("module");
const readline = require("readline");
const { spawn } = require("child_process");
const { decryptPayload } = require("./payload-crypto");

const runtimeDir = process.env.APP_HOME || (process.pkg ? path.dirname(process.execPath) : process.cwd());
process.env.APP_HOME ||= runtimeDir;
const envFile = process.env.ENV_FILE
  ? path.resolve(runtimeDir, process.env.ENV_FILE)
  : path.join(runtimeDir, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 32).toString("hex");
}

function readJsonIfExists(file) {
  if (!file || !fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function askHidden(question) {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error("当前不是交互终端，无法输入运行密码。"));
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const onData = (char) => {
      char = String(char);
      if (char === "\n" || char === "\r" || char === "\u0004") {
        process.stdout.write("\n");
      } else {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question + "*".repeat(rl.line.length));
      }
    };
    process.stdin.on("data", onData);
    rl.question(question, (answer) => {
      process.stdin.off("data", onData);
      rl.close();
      resolve(answer);
    });
  });
}

async function enforceRunPassword() {
  const defaultLicenseFile = process.pkg
    ? path.join(path.dirname(process.execPath), "license.json")
    : path.resolve(__dirname, "..", "license.json");
  const internalLicense = readJsonIfExists(defaultLicenseFile);
  const externalLicense = internalLicense.hash ? {} : readJsonIfExists(
    process.env.APP_PASSWORD_FILE ? path.resolve(runtimeDir, process.env.APP_PASSWORD_FILE) : "",
  );
  const license = internalLicense.hash ? internalLicense : externalLicense;
  const salt = String(license.salt || process.env.APP_RUN_PASSWORD_SALT || "");
  const expectedHash = String(license.hash || process.env.APP_RUN_PASSWORD_HASH || "");
  if (!salt || !expectedHash) return process.env.APP_RUN_PASSWORD || "";
  const password = process.env.APP_RUN_PASSWORD || await askHidden("请输入运行密码：");
  if (hashPassword(password, salt) !== expectedHash) {
    throw new Error("运行密码错误。");
  }
  return password;
}

if (process.argv.includes("--hash-password")) {
  const index = process.argv.indexOf("--hash-password");
  const password = process.argv[index + 1] || process.env.APP_RUN_PASSWORD;
  if (!password) {
    console.error("请提供密码：node runner.js --hash-password your-password");
    process.exitCode = 1;
  } else {
    const salt = crypto.randomBytes(16).toString("hex");
    console.log(JSON.stringify({ salt, hash: hashPassword(password, salt) }, null, 2));
  }
  return;
}

const flowFile = process.env.FLOW_FILE || "browser-flow.js";
function resolvePayloadFile() {
  const configured = process.env.WORKFLOW_PAYLOAD_FILE || "workflow.js.enc";
  return path.isAbsolute(configured) ? configured : path.resolve(runtimeDir, configured);
}

async function askPayloadPassword() {
  if (process.env.APP_PAYLOAD_PASSWORD) return process.env.APP_PAYLOAD_PASSWORD;
  const configuredFile = process.env.APP_PAYLOAD_PASSWORD_FILE;
  if (configuredFile) {
    const file = path.isAbsolute(configuredFile)
      ? configuredFile
      : path.resolve(runtimeDir, configuredFile);
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  }
  return askHidden("请输入流程解密密码：");
}

async function loadPayloadModule(password) {
  const payloadFile = resolvePayloadFile();
  if (!fs.existsSync(payloadFile)) {
    throw new Error(`找不到加密流程文件：${payloadFile}`);
  }
  const encrypted = fs.readFileSync(payloadFile, "utf8");
  const source = decryptPayload(encrypted, password);
  const workflow = new Module(payloadFile, module);
  workflow.filename = payloadFile;
  workflow.paths = Module._nodeModulePaths(__dirname);
  workflow._compile(source, payloadFile);
  return workflow.exports;
}

(async () => {
const runPassword = await enforceRunPassword();
const payloadFile = resolvePayloadFile();
if (fs.existsSync(payloadFile)) {
  const payloadPassword = runPassword || await askPayloadPassword();
  const workflow = await loadPayloadModule(payloadPassword);
  if (!workflow || typeof workflow.main !== "function") {
    throw new Error("加密流程文件没有导出 main 函数。");
  }
  await workflow.main();
} else if (process.pkg) {
  throw new Error(`找不到加密流程文件：${payloadFile}`);
} else if (process.env.APP_SHELL === "true") {
  throw new Error(`找不到加密流程文件：${payloadFile}。请把 workflow.js.enc 放到客户端根目录。`);
} else {
  const runtimeFlowPath = path.resolve(runtimeDir, flowFile);
  const flowPath = fs.existsSync(runtimeFlowPath)
    ? runtimeFlowPath
    : path.resolve(__dirname, flowFile);
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [flowPath, ...process.argv.slice(2)], {
      cwd: runtimeDir,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
      resolve();
    });
    child.on("close", (code, signal) => {
      if (signal) {
        console.error(`流程被信号 ${signal} 终止`);
        process.exitCode = 1;
      } else {
        process.exitCode = code || 0;
      }
      resolve();
    });
  });
}
})().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
