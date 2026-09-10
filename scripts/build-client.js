"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { buildPayload, resolvePayloadPassword, resolveSourceFile } = require("./build-payload");

const root = path.resolve(__dirname, "..");
const distRoot = path.join(root, "dist");
const packager = String(process.env.CLIENT_PACKAGER || "embedded").toLowerCase();
const protectedDirName = process.env.CLIENT_RUNTIME_DIR || ".weee-runtime";

const defaultTarget = process.platform === "darwin"
  ? (process.arch === "arm64" ? "node20-macos-arm64" : "node20-macos-x64")
  : process.platform === "win32"
    ? "node20-win-x64"
    : "node20-linux-x64";
const targets = String(process.env.CLIENT_TARGETS || defaultTarget)
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean);

function targetLabel(target) {
  return target.replace(/^node\d+-/, "").replace(/-/g, "-");
}

function copyIfExists(source, destination) {
  if (fs.existsSync(source)) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 32).toString("hex");
}

function readRunPassword() {
  if (process.env.CLIENT_RUN_PASSWORD) return process.env.CLIENT_RUN_PASSWORD;
  const file = path.join(root, "client-run-password.txt");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
}

function writeLicense(runtimeDir, password = readRunPassword()) {
  if (!password) return false;
  const salt = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(runtimeDir, "license.json"), JSON.stringify({
    version: 1,
    salt,
    hash: hashPassword(password, salt),
  }, null, 2), { mode: 0o600 });
  return true;
}

function writeEmbeddedExecutable(outputDir, executableName) {
  const wrapper = process.platform === "win32"
    ? `@echo off
cd /d "%~dp0"
set APP_SHELL=true
"%~dp0${protectedDirName}\\node\\node.exe" "%~dp0${protectedDirName}\\app\\runner.js" %*
`
    : `#!/bin/bash
set -e
cd "$(dirname "$0")"
export APP_SHELL=true
exec "./${protectedDirName}/node/node" "./${protectedDirName}/app/runner.js" "$@"
`;
  const wrapperPath = path.join(outputDir, executableName);
  const targetPath = process.platform === "win32"
    ? `${wrapperPath}.bat`
    : wrapperPath;
  fs.writeFileSync(targetPath, wrapper, { mode: 0o755 });
  return targetPath;
}

function writeLaunchers(outputDir, executableName, target) {
  if (!target.includes("win")) {
    const macLauncher = `#!/bin/bash
set -e
cd "$(dirname "$0")"
exec "./${executableName}" "$@"
`;
    fs.writeFileSync(path.join(outputDir, "启动.command"), macLauncher, { mode: 0o755 });
    return;
  }

  const windowsTarget = packager === "pkg" ? `${executableName}.exe` : `${executableName}.bat`;
  const winLauncher = `@echo off
cd /d "%~dp0"
"%~dp0${windowsTarget}" %*
`;
  fs.writeFileSync(path.join(outputDir, "启动.bat"), winLauncher);
}

function writeClientReadme(outputDir, executableName, target, runPasswordEnabled, payloadEnabled) {
  const checkCommand = target.includes("win")
    ? `${executableName}.bat --check-package`
    : `./${executableName} --check-package`;
  fs.writeFileSync(path.join(outputDir, "客户配置说明.txt"), `一键运行说明

1. 先安装并启动 BitBrowser，确认 Local Server 地址为 http://127.0.0.1:54345。
2. 编辑 bitbrowser.config.json，在 browserIds 中填写客户自己的指纹浏览器 ID。
3. 编辑 .env，填写 TEMP_MAIL_TOKEN；不要把令牌发给其他人。
4. 将卡片逐行写入同级目录的 cards.txt，格式为 cardNumber|MM|YYYY。
5. 如需代理，在 bitbrowser.config.json 的 proxyUrl 或 .env 的 BITBROWSER_PROXY_URL 填写 socks5h://用户名:密码@主机:端口。
6. 双击 启动.command（macOS）或 启动.bat（Windows）。

本目录的客户端已经带有 Node.js 运行时，客户不需要安装 Node.js。
程序文件放在隐藏目录 ${protectedDirName}，客户通常只需要改 .env、bitbrowser.config.json、cards.txt 和 workflow.js.enc。
${runPasswordEnabled ? "启动时会要求输入独立的运行授权密码。" : "当前壳未设置独立运行授权密码，启动时只会要求 workflow.js.enc 的流程解密密码。"}
流程解密密码由 workflow.js.enc 生成时的 CLIENT_PAYLOAD_PASSWORD 决定，与壳的运行授权密码相互独立。
${payloadEnabled ? "当前包已包含 workflow.js.enc。" : "当前包是壳包，尚未包含 workflow.js.enc；请把本地生成的文件放在本目录。"}
流程默认使用 BitBrowser，已登录的指纹窗口会直接进入 Checkout；未登录时才会使用邮箱验证码。
后续流程更新只需替换根目录的 workflow.js.enc，不需要替换整个运行器目录。
自检命令：${checkCommand}
如果 macOS 首次提示无法验证开发者，请在“启动.command”上右键选择“打开”，或在系统设置的“隐私与安全性”中允许。
`);
}

function prepareConfig(outputDir) {
  const envExample = path.join(root, ".env.example");
  if (fs.existsSync(envExample)) {
    const env = fs.readFileSync(envExample, "utf8")
      .replace(/^BROWSER_PROVIDER=.*/m, "BROWSER_PROVIDER=bitbrowser")
      .replace(/^BROWSER_CHECKOUT_MODE=.*/m, "BROWSER_CHECKOUT_MODE=payment");
    fs.writeFileSync(path.join(outputDir, ".env"), env, { mode: 0o600 });
  }
  copyIfExists(path.join(root, "bitbrowser.config.json"), path.join(outputDir, "bitbrowser.config.json"));
  if (!fs.existsSync(path.join(outputDir, "bitbrowser.config.json"))) {
    copyIfExists(path.join(root, "bitbrowser.config.example.json"), path.join(outputDir, "bitbrowser.config.json"));
  }
  copyIfExists(path.join(root, "cards.txt.example"), path.join(outputDir, "cards.txt.example"));
  if (!fs.existsSync(path.join(outputDir, "cards.txt"))) {
    fs.writeFileSync(path.join(outputDir, "cards.txt"), "# 每行一张卡：卡号|月份|四位年份\n", { mode: 0o600 });
  }
}

function preparePayload(outputDir, payloadPassword) {
  const destination = path.join(outputDir, "workflow.js.enc");
  const configuredPayload = process.env.CLIENT_PAYLOAD_FILE
    ? path.resolve(process.cwd(), process.env.CLIENT_PAYLOAD_FILE)
    : path.join(root, "workflow.js.enc");
  if (fs.existsSync(configuredPayload)) {
    fs.copyFileSync(configuredPayload, destination, fs.constants.COPYFILE_FICLONE);
    return true;
  }
  if (process.env.CLIENT_SKIP_PAYLOAD === "true") return false;
  const sourceFile = resolveSourceFile();
  if (!fs.existsSync(sourceFile)) {
    throw new Error(`找不到流程载荷或本地流程源文件。请先生成 workflow.js.enc，或设置 FLOW_SOURCE_FILE。当前源文件：${sourceFile}`);
  }
  buildPayload(destination, payloadPassword, sourceFile);
  return true;
}

function prepareEmbeddedBundle(outputDir, executableName, target) {
  const targetIsMac = target.includes("macos");
  const targetIsWin = target.includes("win");
  const hostMatchesTarget =
    (targetIsMac && process.platform === "darwin" && target.includes(process.arch === "arm64" ? "arm64" : "x64")) ||
    (targetIsWin && process.platform === "win32" && target.includes(process.arch === "arm64" ? "arm64" : "x64")) ||
    (target.includes("linux") && process.platform === "linux" && target.includes(process.arch === "arm64" ? "arm64" : "x64"));
  if (!hostMatchesTarget) {
    throw new Error(`便携包必须在目标平台上构建：当前 ${process.platform}-${process.arch}，目标 ${target}。请在对应平台上执行打包。`);
  }

  const nodeBinary = process.env.CLIENT_NODE_BINARY || process.execPath;
  if (!fs.existsSync(nodeBinary)) throw new Error(`找不到要嵌入的 Node 可执行文件：${nodeBinary}`);
  const protectedDir = path.join(outputDir, protectedDirName);
  const runtimeDir = path.join(protectedDir, "node");
  const appDir = path.join(protectedDir, "app");
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  const runtimeName = targetIsWin ? "node.exe" : "node";
  fs.copyFileSync(nodeBinary, path.join(runtimeDir, runtimeName));
  if (!targetIsWin) fs.chmodSync(path.join(runtimeDir, runtimeName), 0o755);

  for (const file of ["runner.js"]) {
    copyIfExists(path.join(root, file), path.join(appDir, file));
  }
  copyIfExists(path.join(root, "payload-crypto.js"), path.join(appDir, "payload-crypto.js"));
  fs.cpSync(path.join(root, "node_modules"), path.join(appDir, "node_modules"), {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}@yao-pkg${path.sep}`),
  });
  const runPassword = readRunPassword();
  const payloadPassword = resolvePayloadPassword();
  const payloadEnabled = preparePayload(outputDir, payloadPassword);
  const runPasswordEnabled = writeLicense(protectedDir, runPassword);
  prepareConfig(outputDir);
  writeEmbeddedExecutable(outputDir, executableName);
  writeLaunchers(outputDir, executableName, target);
  writeClientReadme(outputDir, executableName, target, runPasswordEnabled, payloadEnabled);
}

function preparePkgBundle(outputDir, executableName, target) {
  const pkgBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "pkg.cmd" : "pkg");
  if (!fs.existsSync(pkgBin)) throw new Error("找不到 pkg，请先运行 npm install。");
  const executablePath = path.join(outputDir, executableName);
  execFileSync(pkgBin, [
    path.join(root, "runner.js"),
    "--targets", target,
    "--output", executablePath,
    "--compress", "GZip",
    "--no-signature",
  ], { cwd: root, stdio: "inherit" });
  const runPassword = readRunPassword();
  const payloadPassword = resolvePayloadPassword();
  const payloadEnabled = preparePayload(outputDir, payloadPassword);
  const runPasswordEnabled = writeLicense(outputDir, runPassword);
  prepareConfig(outputDir);
  writeLaunchers(outputDir, executableName, target);
  writeClientReadme(outputDir, executableName, target, runPasswordEnabled, payloadEnabled);
  if (target.includes("win")) fs.renameSync(executablePath, `${executablePath}.exe`);
}

function createArchive(outputDir, archive) {
  try {
    execFileSync("zip", ["-qr", archive, "."], { cwd: outputDir, stdio: "inherit" });
    return;
  } catch (zipError) {
    try {
      execFileSync("tar", ["-a", "-c", "-f", archive, "-C", outputDir, "."], { stdio: "inherit" });
      return;
    } catch {
      throw new Error(`无法创建客户压缩包。请安装 zip 或 tar。\n${zipError.message}`);
    }
  }
}

function main() {
  fs.mkdirSync(distRoot, { recursive: true });
  for (const target of targets) {
    const label = targetLabel(target);
    const outputDir = path.join(distRoot, label);
    const executableName = `weee-flow-${label}`;
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });
    if (packager === "pkg") {
      preparePkgBundle(outputDir, executableName, target);
    } else if (packager === "embedded") {
      prepareEmbeddedBundle(outputDir, executableName, target);
    } else {
      throw new Error(`未知 CLIENT_PACKAGER=${packager}，可用值：embedded 或 pkg`);
    }
    const archive = path.join(distRoot, `${executableName}.zip`);
    fs.rmSync(archive, { force: true });
    createArchive(outputDir, archive);
    console.log(`已生成：${archive}`);
  }
}

main();
