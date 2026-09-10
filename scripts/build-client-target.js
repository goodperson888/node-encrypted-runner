"use strict";

const target = String(process.argv[2] || "").trim();
if (!target) {
  throw new Error("请提供客户端目标，例如 node20-win-x64。");
}

process.env.CLIENT_TARGETS = target;
require("./build-client");
