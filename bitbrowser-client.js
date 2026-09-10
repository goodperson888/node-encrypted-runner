"use strict";

class BitBrowserClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || "http://127.0.0.1:54345").replace(/\/+$/, "");
    this.timeoutMs = Number(options.timeoutMs || 15000);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("当前 Node.js 没有可用的 fetch，BitBrowser 接口需要 Node.js 20+。");
    }
  }

  async post(path, body = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`BitBrowser 接口超时：POST ${path}（${this.timeoutMs}ms）。请确认 BitBrowser Local Server 已启动。`);
      }
      throw new Error(`BitBrowser 接口连接失败：POST ${path}。请确认 Local Server 地址和端口正确。${error.message ? ` ${error.message}` : ""}`);
    } finally {
      clearTimeout(timer);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`BitBrowser 接口返回了非 JSON 响应：POST ${path}（HTTP ${response.status}）。`);
    }
    if (!response.ok || payload?.success !== true) {
      const message = String(payload?.msg || payload?.message || `HTTP ${response.status}`);
      throw new Error(`BitBrowser 接口失败：POST ${path}：${message}`);
    }
    return payload.data;
  }

  health() {
    return this.post("/health");
  }

  open(browserId, options = {}) {
    const id = String(browserId || "").trim();
    if (!id) throw new Error("BitBrowser 浏览器 ID 为空。");
    return this.post("/browser/open", {
      id,
      args: Array.isArray(options.args) ? options.args : [],
      queue: options.queue !== false,
      ...(options.ignoreDefaultUrls === undefined ? {} : { ignoreDefaultUrls: Boolean(options.ignoreDefaultUrls) }),
      ...(options.newPageUrl ? { newPageUrl: String(options.newPageUrl) } : {}),
    });
  }

  close(browserId) {
    const id = String(browserId || "").trim();
    if (!id) return Promise.resolve();
    return this.post("/browser/close", { id });
  }

  updateProxy(browserId, proxy) {
    const id = String(browserId || "").trim();
    if (!id) throw new Error("BitBrowser 浏览器 ID 为空。");
    return this.post("/browser/proxy/update", { ids: [id], ...proxy });
  }

  clearCache(browserId) {
    const id = String(browserId || "").trim();
    if (!id) return Promise.resolve();
    return this.post("/cache/clear", { ids: [id] });
  }
}

module.exports = { BitBrowserClient };
