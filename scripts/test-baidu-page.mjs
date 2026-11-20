import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptDirectory, "..");
const pageFile = join(projectRoot, "app", "public", "cloud", "baidu-page.js");
const panelFile = join(projectRoot, "app", "entrypoints", "panel.content", "PanelApp.tsx");

execFileSync(process.execPath, ["--check", pageFile], { stdio: "pipe" });

const ORIGIN = "https://pan.baidu.com";

function createHarness({ gmXhrBehavior = "error" } = {}) {
  const listeners = [];
  const posted = [];
  const gmValues = new Map();

  const fakeFile = {
    fs_id: 225769319988647,
    server_filename: "logisim_x64.zip",
    size: 235492201,
    isdir: 0,
  };
  const shareContext = {
    pageKind: "single",
    shareId: "40858708293",
    shareUk: "66483785",
    bdstoken: "token",
    title: "logisim_x64.zip",
    files: [fakeFile],
  };
  const shareHeaderComponent = {
    type: { name: "ShareHeader" },
    props: { context: shareContext },
    subTree: null,
  };
  const rootVNode = { component: shareHeaderComponent, children: [] };
  const appElement = {
    __vue_app__: { _container: { _vnode: rootVNode } },
  };

  const fakeWindow = {
    location: {
      hostname: "pan.baidu.com",
      pathname: "/s/1abcdefg",
      origin: ORIGIN,
      href: `${ORIGIN}/s/1abcdefg?pwd=test`,
    },
    document: {
      querySelector(selector) {
        return selector === "#app" ? appElement : null;
      },
      querySelectorAll() { return []; },
      cookie: "BAIDUID=testdata; other=x",
    },
    addEventListener(type, listener) {
      if (type === "message") listeners.push(listener);
    },
    removeEventListener() {},
    postMessage(message, origin) {
      posted.push({ message, origin, source: fakeWindow });
    },
    GM_getValue(key, fallback) {
      return gmValues.has(key) ? gmValues.get(key) : fallback;
    },
    GM_setValue(key, value) { gmValues.set(key, value); },
    GM_xmlhttpRequest(options) {
      if (gmXhrBehavior === "error") {
        queueMicrotask(() => options.onerror?.(new Error("network disabled in test")));
        return { abort() {} };
      }
      return { abort() {} };
    },
    console: { warn() {}, error() {} },
  };

  const context = vm.createContext({
    window: fakeWindow,
    document: fakeWindow.document,
    location: fakeWindow.location,
    URL,
    URLSearchParams,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    atob: (value) => Buffer.from(value || "", "base64").toString("binary"),
    unescape,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
    MouseEvent: class {},
    Promise,
    String,
    Number,
    Object,
    Array,
    Map,
    Set,
    JSON,
    Error,
    RegExp,
    Date,
    Math,
  });
  vm.runInContext(readFileSync(pageFile, "utf8"), context, { filename: "baidu-page.js" });

  const dispatch = (data, overrides = {}) => {
    const event = {
      source: fakeWindow,
      origin: ORIGIN,
      data,
      ...overrides,
    };
    for (const listener of [...listeners]) listener(event);
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const responses = () => posted.filter((entry) => entry.message?.__fluxdownBaiduPageResponse === 1);
  return { posted, responses, dispatch, tick, fakeWindow };
}

async function testList() {
  const harness = createHarness();
  harness.dispatch({ __fluxdownBaiduPageRequest: 1, requestId: "req-list", op: "list" });
  await harness.tick();
  await harness.tick();
  const replies = harness.responses();
  assert.equal(replies.length, 1, "list must produce exactly one response");
  assert.equal(replies[0].message.requestId, "req-list");
  assert.equal(replies[0].origin, ORIGIN);
  const result = replies[0].message.result;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "logisim_x64.zip");
  assert.equal(result.items[0].size, 235492201);
  assert.equal(result.items[0].isDir, false);
  assert.equal(typeof result.items[0].id, "string");
  assert.equal(result.canUp, false);
  console.log("  list: OK ->", JSON.stringify(result.items[0]));
}

async function testDownloadChineseError() {
  const harness = createHarness();
  harness.dispatch({ __fluxdownBaiduPageRequest: 1, requestId: "req-dl", op: "download", id: "225769319988647" });
  await harness.tick();
  await harness.tick();
  await harness.tick();
  const replies = harness.responses();
  assert.equal(replies.length, 1, "download must produce exactly one response");
  const result = replies[0].message.result;
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.match(result.error, /[\u4e00-\u9fa5]/, "download failure must be a Chinese error");
  console.log("  download error: OK ->", result.error);
}

async function testInvalidRequestsIgnored() {
  const harness = createHarness();
  harness.dispatch({ __fluxdownBaiduPageRequest: 1, requestId: "bad-op", op: "exec" });
  harness.dispatch({ __fluxdownBaiduPageRequest: 1, requestId: "x".repeat(129), op: "list" });
  harness.dispatch({ __fluxdownBaiduPageRequest: 1, requestId: "wrong-origin", op: "list" }, { origin: "https://evil.example.com" });
  harness.dispatch({ __fluxdownBaiduPageRequest: 1, requestId: "wrong-source", op: "list" }, { source: {} });
  harness.dispatch({ __fluxdownBaiduPageRequest: 1, requestId: "no-id", op: "download" });
  harness.dispatch({ __fluxdownBaiduPageRequest: 1, requestId: "bad-id", op: "download", id: "javascript:alert(1)" });
  harness.dispatch({ __fluxdownBaiduPageRequest: 0, requestId: "wrong-flag", op: "list" });
  await harness.tick();
  await harness.tick();
  assert.equal(harness.responses().length, 0, "invalid requests must be ignored");
  console.log("  invalid requests ignored: OK");
}

async function testApiStillExposed() {
  const harness = createHarness();
  assert.equal(typeof harness.fakeWindow.__FLUXDOWN_BAIDU_PAGE__, "object");
  for (const op of ["list", "open", "up", "download"]) {
    assert.equal(typeof harness.fakeWindow.__FLUXDOWN_BAIDU_PAGE__[op], "function");
  }
  console.log("  __FLUXDOWN_BAIDU_PAGE__ exposed: OK");
}

async function testHostGuard() {
  const source = readFileSync(pageFile, "utf8");
  assert.equal(source.includes('host === "pan.baidu.com" || host === "yun.baidu.com"'), true);
  assert.equal(source.includes("/^\\/(?:s|share)\\//"), true);
  assert.equal(source.includes("event.source !== window || event.origin !== location.origin"), true);
  assert.equal(source.includes("requestId.length > 128"), true);
  console.log("  host/guard static assertions: OK");
}

async function testPanelTimeoutSplit() {
  const source = readFileSync(panelFile, "utf8");
  assert.equal(source.includes('op === "download" ? 120_000 : 20_000'), true, "download must use 120s timeout, others 20s");
  assert.equal(source.includes("百度页面响应超时，请刷新页面后重试"), true, "timeout message must stay Chinese");
  assert.equal(source.includes('baiduPageRequest("download", file.id)'), true, "download must use baiduPageRequest");
  console.log("  panel timeout split (download 120s / others 20s): OK");
}

await testList();
await testDownloadChineseError();
await testInvalidRequestsIgnored();
await testApiStillExposed();
await testHostGuard();
await testPanelTimeoutSplit();
console.log("Baidu page postMessage bridge tests passed.");
