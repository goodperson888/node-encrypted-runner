"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BitBrowserClient } = require("./bitbrowser-client");

function fakeFetch(expectedPath, expectedBody, payload, status = 200) {
  return async (url, options) => {
    assert.equal(url, `http://127.0.0.1:54345${expectedPath}`);
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), expectedBody);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
}

test("BitBrowser health 使用 POST JSON", async () => {
  const client = new BitBrowserClient({
    fetchImpl: fakeFetch("/health", {}, { success: true }),
  });
  assert.equal(await client.health(), undefined);
});

test("BitBrowser open 返回 CDP ws 地址并默认启用队列", async () => {
  const client = new BitBrowserClient({
    fetchImpl: fakeFetch(
      "/browser/open",
      { id: "browser-1", args: [], queue: true },
      { success: true, data: { ws: "ws://127.0.0.1:1234/devtools/browser/x" } },
    ),
  });
  const data = await client.open("browser-1");
  assert.equal(data.ws, "ws://127.0.0.1:1234/devtools/browser/x");
});

test("BitBrowser API 错误包含官方 msg", async () => {
  const client = new BitBrowserClient({
    fetchImpl: fakeFetch("/browser/close", { id: "browser-1" }, { success: false, msg: "窗口不存在" }, 200),
  });
  await assert.rejects(() => client.close("browser-1"), /窗口不存在/);
});

test("BitBrowser 代理更新和缓存清理使用官方接口", async () => {
  const requests = [];
  const client = new BitBrowserClient({
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
    },
  });
  await client.updateProxy("browser-1", {
    proxyMethod: 2,
    proxyType: "socks5",
    host: "proxy.example.com",
    port: 10000,
    proxyUserName: "user",
    proxyPassword: "pass",
  });
  await client.clearCache("browser-1");
  assert.deepEqual(requests, [
    {
      url: "http://127.0.0.1:54345/browser/proxy/update",
      body: {
        ids: ["browser-1"],
        proxyMethod: 2,
        proxyType: "socks5",
        host: "proxy.example.com",
        port: 10000,
        proxyUserName: "user",
        proxyPassword: "pass",
      },
    },
    {
      url: "http://127.0.0.1:54345/cache/clear",
      body: { ids: ["browser-1"] },
    },
  ]);
});
