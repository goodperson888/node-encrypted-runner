"use strict";

const { randomBytes } = require("node:crypto");
const { setTimeout: sleep } = require("node:timers/promises");

const DEFAULT_API_URL = "https://mb-d.vfutai.com/y/";
const EMPTY_MAIL_PATTERN = /(?:暂无|没有|无|空)(?:新)?(?:邮件|邮件内容|消息)|(?:no|empty)\s+(?:new\s+)?(?:e?mails?|messages?)/i;

const positive = (value, fallback) => {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) throw new Error("邮箱等待时间和轮询间隔必须为正数。");
  return n;
};

function plainText(value) {
  return String(value ?? "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    })
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectStrings(value, output = [], depth = 0) {
  if (depth > 5 || value == null) return output;
  if (typeof value === "string" || typeof value === "number") {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return output;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output, depth + 1);
  }
  return output;
}

function messageText(mail) {
  return collectStrings(mail).map(plainText).filter(Boolean).join(" ");
}

function extractWeeeCode(mail) {
  const text = messageText(mail);
  if (!/\b(?:say)?weee\b/i.test(text)) return null;
  const candidates = new Set();
  // Require proximity to a code label; never take arbitrary numbers from a mail payload.
  for (const pattern of [
    /(?:verification\s+code|security\s+code|login\s+code|one[ -]time\s+(?:code|password)|passcode|\bcode\b|验证码)[^\d]{0,60}(?<!\d)(\d{4,8})(?!\d)/gi,
    /(?<!\d)(\d{4,8})(?!\d)[^\d]{0,160}(?:verification\s+code|security\s+code|login\s+code|验证码)/gi,
    /\b(?:say)?weee\b[\s!:：,，-]{0,12}(?<!\d)(\d{4,8})(?!\d)/gi,
  ]) {
    for (const match of text.matchAll(pattern)) candidates.add(match[1]);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

function messageTime(mail) {
  if (!mail || typeof mail !== "object") return 0;
  const raw = mail.timestamp ?? mail.time ?? mail.date ?? mail.created_at ?? mail.createdAt ??
    mail.mail_timestamp ?? mail.mail_date;
  if (raw == null || raw === "") return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  return Date.parse(raw) || 0;
}

function messageId(mail) {
  if (!mail || typeof mail !== "object") return "";
  return String(mail.id ?? mail.message_id ?? mail.messageId ?? mail.mail_id ?? "");
}

function normalizeMessages(payload) {
  if (payload == null || payload === "") return [];
  if (typeof payload === "string") {
    return EMPTY_MAIL_PATTERN.test(payload) ? [] : [{ content: payload }];
  }
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object") return [];
  if (Object.keys(payload).length === 0) return [];

  for (const key of ["data", "messages", "mails", "emails", "items", "result", "receivedata"]) {
    if (payload[key] !== undefined) {
      const nested = normalizeMessages(payload[key]);
      if (nested.length || Array.isArray(payload[key])) return nested;
    }
  }
  if (EMPTY_MAIL_PATTERN.test(JSON.stringify(payload))) return [];
  return [payload];
}

function randomLocalPart(seed) {
  return `${seed}${randomBytes(8).toString("hex")}`;
}

class TempMailApi {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, sleepImpl = sleep, now = Date.now } = {}) {
    this.token = (env.TEMP_MAIL_TOKEN || "").trim();
    if (!this.token || /^(your[_ -]|replace|填入|<)/i.test(this.token)) {
      throw new Error("请在项目 .env 中填写 TEMP_MAIL_TOKEN。不要把令牌发到聊天或写进脚本。");
    }
    this.fetch = fetchImpl;
    this.sleep = sleepImpl;
    this.now = now;
    this.apiUrl = (env.TEMP_MAIL_API_URL || DEFAULT_API_URL).trim();
    if (!/^https:\/\/[^/]+\/[^?]*\/?$/i.test(this.apiUrl)) {
      throw new Error("TEMP_MAIL_API_URL 必须是 HTTPS 的 vfutai API 地址。");
    }
    this.timeoutMs = positive(env.TEMP_MAIL_API_TIMEOUT_MS, 15000);
    this.codeTimeoutMs = positive(env.BROWSER_CODE_TIMEOUT_MS, 120000);
    this.pollMs = positive(env.BROWSER_MAIL_POLL_MS, 5000);
    this.seed = (env.TEMP_MAIL_SEED || "").trim().toLowerCase();
    this.domain = (env.TEMP_MAIL_DOMAIN || "").trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9]+$/.test(this.seed)) {
      throw new Error("TEMP_MAIL_SEED 只能包含小写字母和数字。");
    }
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(this.domain)) {
      throw new Error("TEMP_MAIL_DOMAIN 必须填写有效域名，例如 drime.space。");
    }
  }

  async request(params, { timeoutMs = this.timeoutMs } = {}) {
    const url = new URL(this.apiUrl);
    for (const [key, value] of Object.entries({ ...params, token: this.token })) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }

    let response;
    try {
      response = await this.fetch(url, {
        headers: { Accept: "application/json, text/plain, */*" },
        redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))),
      });
    } catch {
      throw new Error("虚拟邮箱 API 网络连接失败或请求超时，请检查网络后重试。");
    }
    if (!response.ok) {
      const hints = {
        401: "令牌无效或已失效，请检查 TEMP_MAIL_TOKEN。",
        403: "虚拟邮箱 API 拒绝了当前令牌，请检查账户状态和域名权限。",
        429: "虚拟邮箱 API 请求过于频繁，请增加 BROWSER_MAIL_POLL_MS 后重试。",
      };
      throw new Error(`虚拟邮箱 API HTTP ${response.status}：${hints[response.status] || "服务请求失败，请稍后重试。"}`);
    }

    let raw;
    try {
      raw = await response.text();
    } catch {
      throw new Error("虚拟邮箱 API 无法读取响应。");
    }
    try {
      return JSON.parse(raw);
    } catch {
      // `receive` is documented as JSON, but accepting text/HTML makes the
      // client tolerant of provider-side content wrappers.
      return raw;
    }
  }

  async createMailbox() {
    const email = `${randomLocalPart(this.seed)}@${this.domain}`;
    return { email, createdAt: this.now() };
  }

  async listMessages(mailbox, timeoutMs = this.timeoutMs) {
    if (!mailbox?.email) throw new Error("邮箱地址为空，无法读取邮件。");
    const payload = await this.request({ type: "receive", email: mailbox.email }, { timeoutMs });
    return normalizeMessages(payload);
  }

  async waitForCode(mailbox, { since = mailbox.createdAt, ignoreIds = [], ignoreFingerprints = [] } = {}) {
    const deadline = this.now() + this.codeTimeoutMs;
    const ignoredIds = new Set(ignoreIds.map(String));
    const ignoredFingerprints = new Set(ignoreFingerprints);
    const baseline = new Set();
    const remaining = () => Math.min(this.timeoutMs, Math.max(1, deadline - this.now()));

    while (this.now() < deadline) {
      const messages = await this.listMessages(mailbox, remaining());
      for (const message of messages) {
        if (this.now() >= deadline) break;
        const id = messageId(message);
        const fingerprint = JSON.stringify(message);
        if (id && ignoredIds.has(id)) continue;
        if (ignoredFingerprints.has(fingerprint) || baseline.has(fingerprint)) continue;
        const time = messageTime(message);
        if (time && time < since - 2000) continue;
        const code = extractWeeeCode(message);
        if (code) return code;
        baseline.add(fingerprint);
      }
      const delay = Math.min(this.pollMs, deadline - this.now());
      if (delay > 0) await this.sleep(delay);
    }
    throw new Error(`等待 Weee 验证码超时（${this.codeTimeoutMs / 1000} 秒）。请确认已发送验证码、邮箱域名被接受且 API 仍在有效期内。`);
  }
}

module.exports = { TempMailApi, extractWeeeCode, normalizeMessages };
