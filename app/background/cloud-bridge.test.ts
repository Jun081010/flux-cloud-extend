import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

interface ExecuteScriptCall {
  target: { tabId: number; frameIds: number[] };
  world: string;
  injectImmediately?: boolean;
  func?: (data: unknown) => void;
  args?: unknown[];
  files?: string[];
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

interface DownloadCall {
  items: unknown;
  tabId: number;
  pageUrl: string;
  channel?: unknown;
}

const executeScripts: ExecuteScriptCall[] = [];
const fetchCalls: FetchCall[] = [];
const downloadCalls: DownloadCall[] = [];
const tabsCreated: string[] = [];
const redirectListeners = new Set<(details: { url?: string; method?: string; redirectUrl?: string }) => void>();
const storageValues: Record<string, unknown> = {
  "cloud.linkswift:baidu:setting_ui_theme": { color: "#123456" },
  "cloud.linkswift:quark:quark_only": { color: "#654321" },
  "unrelated": "ignored",
};
const tabUrls: Record<number, string> = {
  7: "https://pan.baidu.com/s/abc",
};
const cssResources: Record<string, string> = {
  "/cloud/vendor/sweetalert2.min.css": "/* light */",
  "/cloud/vendor/sweetalert2-dark.min.css": "/* dark */",
};
let fetchResponseFactory: (url: string, init: RequestInit) => Response = () => new Response("{}", {
  status: 200,
  headers: { "Content-Range": "bytes 0-0/10", "Content-Type": "application/json" },
});
let downloadResult: { success: boolean; sent: number; failed: number; message?: string } = { success: true, sent: 1, failed: 0 };

const browserMock = {
  runtime: {
    getURL(path: string): string {
      return `chrome-extension://test${path}`;
    },
  },
  storage: {
    local: {
      async get(key: string | null): Promise<Record<string, unknown>> {
        if (key === null) return { ...storageValues };
        return key in storageValues ? { [key]: storageValues[key] } : {};
      },
      async set(values: Record<string, unknown>): Promise<void> {
        Object.assign(storageValues, values);
      },
      async remove(key: string): Promise<void> {
        delete storageValues[key];
      },
    },
  },
  scripting: {
    async executeScript(call: ExecuteScriptCall): Promise<void> {
      executeScripts.push(call);
    },
  },
  tabs: {
    async get(tabId: number): Promise<{ id: number; url?: string }> {
      return { id: tabId, url: tabUrls[tabId] };
    },
    async create(options: { url: string }): Promise<void> {
      tabsCreated.push(options.url);
    },
  },
  webRequest: {
    onBeforeRedirect: {
      addListener(listener: (details: { url?: string; method?: string; redirectUrl?: string }) => void): void {
        redirectListeners.add(listener);
      },
      removeListener(listener: (details: { url?: string; method?: string; redirectUrl?: string }) => void): void {
        redirectListeners.delete(listener);
      },
    },
  },
};

const downloadsMock = {
  async downloadCloudItems(items: unknown, tabId: number, pageUrl: string, channel?: unknown) {
    downloadCalls.push({ items, tabId, pageUrl, channel });
    return downloadResult;
  },
};

const moduleUrl = new URL("./cloud-bridge.ts", import.meta.url).href;
const sitesUrl = new URL("../utils/cloud-sites.ts", import.meta.url).href;
const protocolUrl = new URL("./protocol.ts", import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "wxt/browser") return { url: "mock:wxt-browser", shortCircuit: true };
    if (specifier === "@/utils/cloud-sites") return { url: sitesUrl, shortCircuit: true };
    if (specifier === "./downloads") return { url: "mock:downloads", shortCircuit: true };
    if (specifier === "./protocol") return { url: protocolUrl, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "mock:wxt-browser") {
      return { format: "module", source: `export const browser = globalThis.__cloudBridgeBrowser;`, shortCircuit: true };
    }
    if (url === "mock:downloads") {
      return { format: "module", source: `export const downloadCloudItems = globalThis.__cloudBridgeDownloads.downloadCloudItems;`, shortCircuit: true };
    }
    return next(url, context);
  },
});

(globalThis as Record<string, unknown>).__cloudBridgeBrowser = browserMock;
(globalThis as Record<string, unknown>).__cloudBridgeDownloads = downloadsMock;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const effectiveInit = init ?? {};
  fetchCalls.push({ url, init: effectiveInit });
  if (url.startsWith("chrome-extension://test/cloud/vendor/")) {
    const path = new URL(url).pathname;
    const text = cssResources[path];
    return text === undefined
      ? new Response("missing", { status: 404 })
      : new Response(text, { status: 200, headers: { "Content-Type": "text/css" } });
  }
  return fetchResponseFactory(url, effectiveInit);
}) as typeof fetch;

const bridge = await import(moduleUrl);
const sites = await import(sitesUrl);

after(() => {
  globalThis.fetch = originalFetch;
});

function cloudSender(overrides: Record<string, unknown> = {}) {
  return {
    tab: { id: 7, url: "https://pan.baidu.com/s/abc" },
    frameId: 0,
    url: "https://pan.baidu.com/s/abc",
    ...overrides,
  } as never;
}

function resetState(): void {
  executeScripts.length = 0;
  fetchCalls.length = 0;
  downloadCalls.length = 0;
  tabsCreated.length = 0;
  redirectListeners.clear();
  downloadResult = { success: true, sent: 1, failed: 0 };
  fetchResponseFactory = () => new Response("{}", {
    status: 200,
    headers: { "Content-Range": "bytes 0-0/10", "Content-Type": "application/json" },
  });
  tabUrls[7] = "https://pan.baidu.com/s/abc";
}

describe("cloud-sites URL policy", () => {
  test("支持顶层网盘页，拒绝普通域与 iframe sender", () => {
    assert.equal(sites.isCloudPageUrl("https://pan.baidu.com/s/abc"), true);
    assert.equal(sites.isCloudPageUrl("https://evil.example.com/pan.baidu.com"), false);
    assert.equal(sites.isCloudPageUrl("https://evil-pan.baidu.com/s/abc"), false);
    assert.equal(sites.isAllowedFetchUrl("https://d.pcs.baidu.com/file/test"), true);
    assert.equal(sites.isAllowedFetchUrl("https://user:pass@pan.baidu.com/api"), false);
  });

  test("按页面厂商隔离 fetch、download 与帮助页跳转", () => {
    assert.equal(
      sites.isAllowedFetchUrlForPage("https://pan.baidu.com/s/abc", "https://d.pcs.baidu.com/file/test"),
      true,
    );
    assert.equal(
      sites.isAllowedFetchUrlForPage("https://pan.baidu.com/s/abc", "https://drive-pc.quark.cn/1/clouddrive/file/download"),
      false,
    );
    assert.equal(
      sites.isAllowedDownloadUrlForPage("https://pan.quark.cn/s/abc", "https://d.pcs.baidu.com/file/test"),
      false,
    );
    assert.equal(
      sites.isAllowedDownloadUrlForPage("https://pan.quark.cn/s/abc", "https://drive-pc.quark.cn/file/test"),
      true,
    );
    assert.equal(
      sites.isAllowedDownloadUrlForPage("https://www.123pan.com/s/abc", "https://d.pcs.baidu.com/file/test"),
      false,
    );
    assert.equal(
      sites.isAllowedDownloadUrlForPage("https://www.123pan.com/s/abc", "https://api.123pan.cn/api/v2/file/download_info"),
      true,
    );
    assert.equal(
      sites.isAllowedFetchUrlForPage("https://pan.baidu.com/s/abc", "https://www.youxiaohou.com/download.html"),
      false,
    );
    assert.equal(
      sites.isAllowedOpenTabUrlForPage("https://pan.baidu.com/s/abc", "https://www.youxiaohou.com/zh-cn/idm.html"),
      true,
    );
  });

  test("拒绝 localhost、私网、链路本地和 IPv6 私网", () => {
    for (const url of [
      "http://localhost/file",
      "http://127.0.0.1/file",
      "http://192.168.1.1/file",
      "http://169.254.169.254/latest/meta-data",
      "http://[fe80::1]/file",
      "http://[::ffff:127.0.0.1]/file",
    ]) {
      assert.equal(sites.isAllowedDownloadUrl(url), false, url);
      assert.equal(sites.isAllowedFetchUrl(url), false, url);
    }
    assert.equal(sites.isAllowedDownloadUrl("https://d.pcs.baidu.com/file/test"), true);
  });
});

describe("handleCloudInject", () => {
  test("按 boot → shim → baidu-page → bundle 顺序注入，并把 CSS 原文与存储值放进 boot", async () => {
    resetState();
    const result = await bridge.handleCloudInject("a".repeat(32), cloudSender());
    assert.deepEqual(result, { ok: true });
    assert.equal(executeScripts.length, 2);
    assert.equal(executeScripts[0].world, "MAIN");
    assert.ok(executeScripts[0].func);
    assert.ok(executeScripts[0].args);
    assert.deepEqual(executeScripts[0].target, { tabId: 7, frameIds: [0] });
    const boot = executeScripts[0].args![0] as {
      channelId: string;
      values: Record<string, unknown>;
      resources: { SwalLigt: string; SwalDark: string };
      expectedOrigin: string;
    };
    assert.equal(boot.channelId, "a".repeat(32));
    assert.deepEqual(boot.values, {
      setting_ui_theme: { color: "#123456" },
      setting_init: { code: "865746", license: "AGPL3", version: "1.1.4" },
    });
    assert.equal(boot.expectedOrigin, "https://pan.baidu.com");
    assert.equal(boot.resources.SwalLigt, "/* light */");
    assert.equal(boot.resources.SwalDark, "/* dark */");
    assert.deepEqual(executeScripts[1].files, [
      "/cloud/linkswift-gm-shim.js",
      "/cloud/baidu-page.js",
      "/cloud/linkswift.bundle.js",
    ]);
    assert.equal(executeScripts[1].world, "MAIN");
  });

  test("同路径的自动解析凭据会转成一次性 boot 标记", async () => {
    resetState();
    storageValues["cloud.linkswift:baidu:fluxdown_auto_share"] = {
      url: "https://pan.baidu.com/s/abc?fluxdown_auto=1",
      at: Date.now(),
    };
    try {
      const result = await bridge.handleCloudInject("d".repeat(32), cloudSender());
      assert.deepEqual(result, { ok: true });
      const boot = executeScripts[0].args![0] as { values: Record<string, unknown> };
      assert.equal(boot.values.fluxdown_auto_share, "1");
    } finally {
      delete storageValues["cloud.linkswift:baidu:fluxdown_auto_share"];
    }
  });

  test("CSS 资源读取失败返回明确 reason，且不注入脚本", async () => {
    resetState();
    const originalLight = cssResources["/cloud/vendor/sweetalert2.min.css"];
    delete cssResources["/cloud/vendor/sweetalert2.min.css"];
    try {
      const result = await bridge.handleCloudInject("b".repeat(32), cloudSender());
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.reason, /failed to load SwalLigt: HTTP 404/);
      assert.equal(executeScripts.length, 0);
    } finally {
      cssResources["/cloud/vendor/sweetalert2.min.css"] = originalLight;
    }
  });

  test("非顶层 frame 与不支持页面被拒绝", async () => {
    resetState();
    assert.equal((await bridge.handleCloudInject("c".repeat(32), cloudSender({ frameId: 1 }))).ok, false);
    assert.equal((await bridge.handleCloudInject("c".repeat(32), cloudSender({ url: "https://example.com/" }))).ok, false);
    assert.equal((await bridge.handleCloudInject("c".repeat(32), cloudSender({ tab: { id: 7, url: "https://pan.quark.cn/s/x" } }))).ok, false);
    assert.equal((await bridge.handleCloudInject("c".repeat(32), cloudSender({ url: undefined }))).ok, false);
    assert.equal((await bridge.handleCloudInject("c".repeat(32), cloudSender({ tab: { id: 7 } }))).ok, false);
    assert.equal((await bridge.handleCloudInject("c".repeat(32), cloudSender({
      url: "http://pan.baidu.com/s/abc",
      tab: { id: 7, url: "http://pan.baidu.com/s/abc" },
    }))).ok, false);
    assert.equal(executeScripts.length, 0);
  });

  test("异步读取资源后标签页导航到其他厂商则不注入", async () => {
    resetState();
    tabUrls[7] = "https://pan.quark.cn/s/navigated";
    const result = await bridge.handleCloudInject("d".repeat(32), cloudSender());
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /tab navigated/);
    assert.equal(executeScripts.length, 0);
  });
});

describe("handleCloudFetch", () => {
  test("静默剥离 Origin/Referer/Cookie 等禁止头，保留 credentials include 并禁止跟随重定向", async () => {
    resetState();
    fetchResponseFactory = () => new Response("ok", { status: 200 });
    const result = await bridge.handleCloudFetch({
      url: "https://pan.baidu.com/api/test",
      method: "POST",
      headers: {
        Origin: "https://pan.baidu.com",
        Referer: "https://pan.baidu.com/",
        Cookie: "BDUSS=secret",
        Cookie2: "x=1",
        "X-Requested-With": "XMLHttpRequest",
        "Sec-Fetch-Mode": "cors",
      },
      body: "payload",
      responseType: "text",
    }, cloudSender());
    assert.equal(result.ok, true);
    const call = fetchCalls.at(-1)!;
    const headerNames = Object.keys(call.init.headers as Record<string, string>);
    assert.deepEqual(headerNames, ["X-Requested-With"]);
    assert.equal(call.init.credentials, "include");
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.body, "payload");
    assert.ok(!result.ok || result.responseText === "ok");
  });

  test("JSON 响应保留 responseText 原文，解析失败不导致整个响应失败", async () => {
    resetState();
    fetchResponseFactory = () => new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } });
    const result = await bridge.handleCloudFetch({
      url: "https://pan.baidu.com/api/json",
      responseType: "json",
    }, cloudSender());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.responseText, "not-json");
    assert.equal(result.response, null);
  });

  test("响应头保留 [name,value] 数组", async () => {
    resetState();
    fetchResponseFactory = () => new Response("ok", {
      status: 206,
      headers: { "Content-Range": "bytes 0-0/10", "Content-Length": "1" },
    });
    const result = await bridge.handleCloudFetch({
      url: "https://d.pcs.baidu.com/file",
      responseType: "text",
      headers: { Range: "bytes=0-0" },
    }, cloudSender());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 206);
    assert.ok(result.headers.some(([name, value]) => name === "content-range" && value === "bytes 0-0/10"));
    assert.ok(result.headers.some(([name, value]) => name === "content-length" && value === "1"));
  });

  test("拒绝不支持域、禁止方法和过大 body", async () => {
    resetState();
    const badUrl = await bridge.handleCloudFetch({ url: "https://example.com/a" }, cloudSender());
    assert.equal(badUrl.ok, false);
    const crossVendor = await bridge.handleCloudFetch({ url: "https://drive-pc.quark.cn/1/clouddrive/file/download" }, cloudSender());
    assert.equal(crossVendor.ok, false);
    const badMethod = await bridge.handleCloudFetch({ url: "https://pan.baidu.com/a", method: "TRACE" }, cloudSender());
    assert.equal(badMethod.ok, false);
    const badBody = await bridge.handleCloudFetch({ url: "https://pan.baidu.com/a", method: "POST", body: "x".repeat(2 * 1024 * 1024 + 1) }, cloudSender());
    assert.equal(badBody.ok, false);
    assert.equal(fetchCalls.length, 0);
  });

  test("响应最终 URL 落到其他厂商时拒绝", async () => {
    resetState();
    fetchResponseFactory = () => ({
      status: 200,
      statusText: "OK",
      url: "https://drive-pc.quark.cn/1/clouddrive/file/download",
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);
    const result = await bridge.handleCloudFetch({ url: "https://pan.baidu.com/api/test" }, cloudSender());
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /redirect not allowed/);
  });

  test("百度 OAuth 302 通过 webRequest 捕获 Location，并以 finalUrl 交给 LinkSwift", async () => {
    resetState();
    const authorizeUrl = "https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&client_id=test";
    const tokenUrl = "https://openapi.baidu.com/oauth/2.0/login_success#expires_in=2592000&access_token=test-token";
    fetchResponseFactory = () => {
      for (const listener of redirectListeners) {
        listener({ url: authorizeUrl, method: "GET", redirectUrl: tokenUrl });
      }
      return new Response(null, { status: 200 });
    };
    const result = await bridge.handleCloudFetch({ url: authorizeUrl }, cloudSender());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 200);
    assert.equal(result.finalUrl, tokenUrl);
    assert.equal(fetchCalls.at(-1)?.init.redirect, "follow");
    assert.equal(redirectListeners.size, 0);
  });

  test("百度 OAuth 多级跳转：捕获链尾 access_token，而不是第一跳", async () => {
    resetState();
    const authorizeUrl = "https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&client_id=test";
    const passportUrl = "https://passport.baidu.com/v2/?login&tpl=netdisk";
    const tokenUrl = "https://openapi.baidu.com/oauth/2.0/login_success#access_token=multiHopToken456";
    fetchResponseFactory = () => {
      for (const listener of redirectListeners) {
        listener({ url: authorizeUrl, method: "GET", redirectUrl: passportUrl });
        listener({ url: passportUrl, method: "GET", redirectUrl: tokenUrl });
      }
      return new Response("<html>login success</html>", { status: 200 });
    };
    const result = await bridge.handleCloudFetch({ url: authorizeUrl }, cloudSender());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.finalUrl, tokenUrl);
    assert.equal(result.responseText, "");
  });

  test("百度 OAuth 未授权时保留授权页 HTML 供页面读取 bdstoken", async () => {
    resetState();
    const authorizeUrl = "https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&client_id=test";
    const consent = '<html><input name="bdstoken" value="token-1"><input name="client_id" value="client-1"></html>';
    fetchResponseFactory = () => new Response(consent, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
    const result = await bridge.handleCloudFetch({ url: authorizeUrl }, cloudSender());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.finalUrl, authorizeUrl);
    assert.match(result.responseText, /name="bdstoken"/);
    assert.equal(redirectListeners.size, 0);
  });

  test("baiduTokenFromUrl 解码 URL 片段中的令牌", () => {
    assert.equal(
      bridge.baiduTokenFromUrl("https://x/login_success#access_token=simpleToken123"),
      "simpleToken123",
    );
    assert.equal(bridge.baiduTokenFromUrl("https://x/passport"), "");
  });

  test("仅接受百度域的令牌跳转，忽略其它域伪造的 access_token", async () => {
    assert.equal(bridge.isBaiduTokenUrl("https://openapi.baidu.com/oauth/2.0/login_success#access_token=x"), true);
    assert.equal(bridge.isBaiduTokenUrl("https://evil.example.com/#access_token=x"), false);
    resetState();
    const authorizeUrl = "https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&client_id=test";
    fetchResponseFactory = () => {
      for (const listener of redirectListeners) {
        listener({ url: authorizeUrl, method: "GET", redirectUrl: "https://evil.example.com/#access_token=fake" });
      }
      return new Response("<html><input name=\"bdstoken\" value=\"t\"></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };
    const result = await bridge.handleCloudFetch({ url: authorizeUrl }, cloudSender());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.finalUrl, authorizeUrl);
    assert.match(result.responseText, /bdstoken/);
  });

  test("百度授权服务返回 5xx 时给出明确错误", async () => {
    resetState();
    const authorizeUrl = "https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&client_id=test";
    fetchResponseFactory = () => new Response("bad gateway", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });
    const result = await bridge.handleCloudFetch({ url: authorizeUrl }, cloudSender());
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /HTTP 502/);
  });

  test("Content-Length 超限时在读取 body 前拒绝", async () => {
    resetState();
    fetchResponseFactory = () => new Response("", {
      status: 200,
      headers: { "Content-Length": String(32 * 1024 * 1024 + 1) },
    });
    const result = await bridge.handleCloudFetch({ url: "https://pan.baidu.com/api/test" }, cloudSender());
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /response too large/);
  });
});

describe("handleCloudDownload", () => {
  test("传递完整 request 给 downloadCloudItems，包含页面 URL 与 tabId", async () => {
    resetState();
    const items = [{ url: "https://d.pcs.baidu.com/file/test", filename: "a.zip" }];
    const result = await bridge.handleCloudDownload({ items }, cloudSender());
    assert.equal(result.ok, true);
    assert.deepEqual(downloadCalls, [{ items, tabId: 7, pageUrl: "https://pan.baidu.com/s/abc", channel: undefined }]);
  });

  test("sender 顶层校验与非法 items 被拒绝", async () => {
    resetState();
    assert.equal((await bridge.handleCloudDownload({ items: [] }, cloudSender())).ok, false);
    assert.equal((await bridge.handleCloudDownload({ items: [{}] }, cloudSender({ frameId: 1 }))).ok, false);
    assert.equal(downloadCalls.length, 0);
  });
});

describe("cloud download URL and header contract", () => {
  test("仅公开 HTTP/HTTPS 白名单 URL、同源 referrer、危险头过滤与 Cookie 保留", async () => {
    assert.equal(sites.isAllowedDownloadUrl("https://d.pcs.baidu.com/file/a"), true);
    assert.equal(sites.isAllowedDownloadUrl("https://evil.example.com/file"), false);
    assert.equal(sites.isAllowedDownloadUrl("ftp://d.pcs.baidu.com/file"), false);
    assert.equal(sites.isAllowedDownloadUrl("https://user:pass@d.pcs.baidu.com/file"), false);
    assert.equal(sites.isAllowedDownloadUrl("http://127.0.0.1/file"), false);
    assert.equal(new URL("https://evil.example.com/").origin === new URL("https://pan.baidu.com/s/abc").origin, false);
  });
});

describe("handleCloudStorage and handleCloudOpenTab", () => {
  test("存储键带命名空间，openTab 拒绝私网", async () => {
    resetState();
    const stored = await bridge.handleCloudStorage({ op: "set", key: "k", value: 1 }, cloudSender());
    assert.equal(stored.ok, true);
    assert.equal(storageValues["cloud.linkswift:baidu:k"], 1);
    const quarkRead = await bridge.handleCloudStorage({ op: "get", key: "k" }, cloudSender({
      url: "https://pan.quark.cn/s/abc",
      tab: { id: 7, url: "https://pan.quark.cn/s/abc" },
    }));
    assert.equal(quarkRead.ok, true);
    if (quarkRead.ok) assert.equal(quarkRead.value, undefined);
    const opened = await bridge.handleCloudOpenTab({ url: "https://pan.baidu.com/share/abc" }, cloudSender());
    assert.equal(opened.ok, true);
    assert.deepEqual(tabsCreated, ["https://pan.baidu.com/share/abc"]);
    const crossVendor = await bridge.handleCloudOpenTab({ url: "https://pan.quark.cn/s/abc" }, cloudSender());
    assert.equal(crossVendor.ok, false);
    const refused = await bridge.handleCloudOpenTab({ url: "http://127.0.0.1/" }, cloudSender());
    assert.equal(refused.ok, false);
  });
});
