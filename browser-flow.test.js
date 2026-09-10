"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePaymentCardLine,
  parseProxyUrl,
  isPaymentAttachUrl,
  isFrequentBindAttempt,
} = require("./browser-flow");

test("卡片行转换为卡号和 MMYY", () => {
  assert.deepEqual(parsePaymentCardLine("5178058585981007|02|2030", 1), {
    raw: "5178058585981007|02|2030",
    cardNumber: "5178058585981007",
    expirationDate: "0230",
  });
});

test("卡片文件忽略空行和注释，拒绝错误格式", () => {
  assert.equal(parsePaymentCardLine("", 1), null);
  assert.equal(parsePaymentCardLine("  # example", 2), null);
  assert.throws(() => parsePaymentCardLine("5178|2|2030", 3), /第 3 行格式不正确/);
});

test("代理 URL 映射为 BitBrowser 代理字段", () => {
  assert.deepEqual(parseProxyUrl("socks5h://accountId:pa%40ss@proxy.example.com:10000"), {
    proxyMethod: 2,
    proxyType: "socks5",
    host: "proxy.example.com",
    port: 10000,
    proxyUserName: "accountId",
    proxyPassword: "pa@ss",
  });
});

test("识别 Weee Braintree 绑卡接口和 24 小时频繁限制", () => {
  assert.equal(isPaymentAttachUrl("https://api.sayweee.net/ec/payment/card/braintree/profile/attach/v3"), true);
  assert.equal(isPaymentAttachUrl("https://api.sayweee.net/ec/payment/card/braintree/profile/attach/v3?x=1"), true);
  assert.equal(isPaymentAttachUrl("https://api.sayweee.net/ec/payment/card/braintree/profile/tokenize/v3"), false);
  assert.equal(isFrequentBindAttempt({
    message_id: "PY10122",
    message: "The number of attempts to bind the card is too frequent. Please try again after 24 hours.",
  }), true);
  assert.equal(isFrequentBindAttempt({
    message: "The number of attempts to bind the card is too frequent. Please try again after 24 hours.",
  }), true);
  assert.equal(isFrequentBindAttempt({ message_id: "PY10114" }), false);
  assert.equal(isFrequentBindAttempt({ message_id: "OK", message: "saved" }), false);
});
