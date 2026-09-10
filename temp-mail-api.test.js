"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TempMailApi, extractWeeeCode, normalizeMessages } = require("./temp-mail-api");

const response = (body, status = 200, contentType = "application/json") => new Response(
  contentType === "application/json" ? JSON.stringify(body) : String(body),
  { status, headers: { "content-type": contentType } },
);
const env = {
  TEMP_MAIL_TOKEN: "local-test-token",
  TEMP_MAIL_SEED: "aahd",
  TEMP_MAIL_DOMAIN: "drime.space",
  TEMP_MAIL_API_TIMEOUT_MS: "1000",
  BROWSER_CODE_TIMEOUT_MS: "50",
  BROWSER_MAIL_POLL_MS: "10",
};

test("缺少令牌时提前失败", () => {
  assert.throws(() => new TempMailApi({ env: {} }), /TEMP_MAIL_TOKEN/);
});

test("使用种子和域名生成邮箱，并按 URL 参数读取收件箱", async () => {
  const requests = [];
  const api = new TempMailApi({
    env,
    fetchImpl: async url => {
      requests.push(new URL(url));
      return response({ data: [] });
    },
  });
  const box = await api.createMailbox();
  assert.match(box.email, /^aahd[a-f0-9]{16}@drime\.space$/);
  assert.deepEqual(await api.listMessages(box), []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get("type"), "receive");
  assert.equal(requests[0].searchParams.get("email"), box.email);
  assert.equal(requests[0].searchParams.get("token"), env.TEMP_MAIL_TOKEN);
  assert.equal(requests[0].searchParams.get("email").split("@").length, 2);
});

test("拒绝不安全的邮箱种子和域名", () => {
  assert.throws(() => new TempMailApi({ env: { ...env, TEMP_MAIL_SEED: "aahd_" } }), /TEMP_MAIL_SEED/);
  assert.throws(() => new TempMailApi({ env: { ...env, TEMP_MAIL_DOMAIN: "@drime space" } }), /TEMP_MAIL_DOMAIN/);
});

test("兼容供应商常见的收件箱响应包装", () => {
  assert.deepEqual(normalizeMessages({ data: [] }), []);
  assert.deepEqual(normalizeMessages({ data: { subject: "Weee" } }), [{ subject: "Weee" }]);
  assert.deepEqual(normalizeMessages({ messages: [{ subject: "Weee" }] }), [{ subject: "Weee" }]);
  assert.deepEqual(normalizeMessages("暂无邮件"), []);
  assert.deepEqual(normalizeMessages("<p>Weee verification code: 012345</p>"), [{ content: "<p>Weee verification code: 012345</p>" }]);
});

test("识别主题、正文、HTML、前置数字和中文，保留前导零", () => {
  for (const mail of [
    { subject: "Weee! verification code: 012345" },
    { from: "Weee <login@weee.com>", text: "012345 is your verification code" },
    { subject: "Weee 验证码：012345" },
    { subject: "Weee 012345" },
    { subject: "Weee login", html: "<b>Verification code</b><p>01&#50;345</p>" },
    { html: "<p style=\"font-size:48px\">012345</p><p>Please enter the verification code above to verify your Weee! login.</p>" },
  ]) assert.equal(extractWeeeCode(mail), "012345");
});

test("忽略非 Weee 邮件、无关联数字、长数字和多个不同验证码", () => {
  for (const mail of [
    { subject: "Other verification code: 123456" },
    { subject: "Weee order", text: "Order 123456, phone 18001234567" },
    { subject: "Weee code: 123456789" },
    { subject: "Weee code: 123456", text: "verification code: 654321" },
  ]) assert.equal(extractWeeeCode(mail), null);
});

test("HTTP 身份、权限和限流错误不泄漏令牌", async () => {
  for (const status of [401, 403, 429, 500]) {
    const api = new TempMailApi({
      env,
      fetchImpl: async () => response({ secret: env.TEMP_MAIL_TOKEN }, status),
    });
    await assert.rejects(api.listMessages({ email: "aahdtest@drime.space" }), error => (
      error.message.includes(String(status)) && !error.message.includes(env.TEMP_MAIL_TOKEN)
    ));
  }
});

test("只处理发送后的新邮件，并允许忽略已有邮件指纹", async () => {
  const since = 1800000000000;
  let now = since;
  const old = { subject: "Weee verification code: 999999", timestamp: since };
  const api = new TempMailApi({
    env,
    now: () => now,
    sleepImpl: async ms => { now += ms; },
    fetchImpl: async () => response({ data: [old, { subject: "Weee sign in" }] }),
  });
  const oldFingerprint = JSON.stringify(old);
  await assert.rejects(
    api.waitForCode({ email: "aahdtest@drime.space", createdAt: since }, {
      since,
      ignoreFingerprints: [oldFingerprint],
    }),
    /超时/,
  );
});

test("新邮件到达前继续轮询", async () => {
  let now = 0;
  let requests = 0;
  const api = new TempMailApi({
    env,
    now: () => now,
    sleepImpl: async ms => { now += ms; },
    fetchImpl: async () => {
      requests++;
      return response(requests === 1 ? { data: [] } : { data: [{ subject: "Weee verification code 123456" }] });
    },
  });
  assert.equal(await api.waitForCode({ email: "aahdtest@drime.space", createdAt: 0 }), "123456");
  assert.equal(requests, 2);
});

test("轮询严格按超时结束", async () => {
  let now = 0;
  const api = new TempMailApi({
    env,
    now: () => now,
    sleepImpl: async ms => { now += ms; },
    fetchImpl: async () => response({ data: [] }),
  });
  await assert.rejects(api.waitForCode({ email: "aahdtest@drime.space", createdAt: 0 }), /超时/);
  assert.equal(now, 50);
});

test("网络错误和 HTML 响应提供明确行为", async () => {
  const api = new TempMailApi({ env, fetchImpl: async () => { throw new Error("secret"); } });
  await assert.rejects(api.listMessages({ email: "aahdtest@drime.space" }), /网络连接失败/);

  const htmlApi = new TempMailApi({
    env,
    fetchImpl: async () => response("<p>Weee verification code: 012345</p>", 200, "text/html"),
  });
  assert.equal(await htmlApi.listMessages({ email: "aahdtest@drime.space" }).then(messages => extractWeeeCode(messages[0])), "012345");
});
