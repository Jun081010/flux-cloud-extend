import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { patchLinkSwift } from "./patch-linkswift.mjs";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptDirectory, "..");
const pageFile = join(projectRoot, "app", "public", "cloud", "baidu-page.js");
const panelFile = join(projectRoot, "app", "entrypoints", "panel.content", "PanelApp.tsx");
const upstreamFile = join(projectRoot, "vendor", "LinkSwift", "linkswift.user.js");
const { patched } = patchLinkSwift(readFileSync(upstreamFile, "utf8"));

execFileSync(process.execPath, ["--check", pageFile], { stdio: "pipe" });

const ORIGIN = "https://pan.baidu.com";

function createHarness({ resolverError, signError, unavailable = false, linkError, directory = false } = {}) {
  const listeners = [];
  const posted = [];
  const calls = [];
  const fileId = 225769319988647;
  const files = [
    { fs_id: fileId, server_filename: "sample.pdf", size: 235492201, isdir: directory ? 1 : 0 },
    { fs_id: 123, server_filename: "another.pdf", size: 1234, isdir: 0 },
  ];
  const rootVNode = {
    component: {
      type: { name: "ShareHeader" },
      props: { context: { pageKind: "single", title: "sample.pdf", files } },
    },
    children: [],
  };
  const appElement = { __vue_app__: { _container: { _vnode: rootVNode } } };
  const location = new URL(ORIGIN + "/s/fixture");
  const fakeWindow = {
    location,
    document: {
      querySelector: selector => selector === "#app" ? appElement : null,
      querySelectorAll: () => [],
    },
    addEventListener(type, listener) {
      if (type === "message") listeners.push(listener);
    },
    postMessage(message, origin) {
      posted.push({ message, origin });
    },
  };
  const scope = vm.createContext({
    window: fakeWindow,
    document: fakeWindow.document,
    location,
    URL,
    URLSearchParams,
    setTimeout,
    base: {
      getValue: () => "fixture-token",
      get: async request => {
        const url = new URL(request);
        if (signError) throw new Error(signError);
        assert.equal(url.searchParams.get("surl"), "1fixture");
        assert.equal(url.searchParams.get("bdstoken"), "fixture");
        assert.equal(url.searchParams.get("logid"), "fixture-log-id");
        return { data: { sign: "fixture-sign", timestamp: 1 } };
      },
      encodeBase: () => "fixture-log-id",
      isType: value => Array.isArray(value) ? "array" : typeof value,
      clone: value => structuredClone(value),
      post: async (url, data) => {
        assert.equal(url.pathname, "/api/sharedownload");
        calls.push({ ids: JSON.parse(data.get("fid_list")), sign: url.searchParams.get("sign") });
        if (resolverError) throw new Error(resolverError);
        return { errno: 0, list: [{ dlink: linkError || "https://pan.baidu.com/fixture-pdf" }] };
      },
    },
    $doc: { find: () => ({ html: () => {} }) },
    temp: { glinks: [] },
    config: { $baidu: { api: {
      getShareSign: "https://pan.baidu.com/api/fixture",
      getShareLink: "https://pan.baidu.com/api/sharedownload",
      ua: { downloadLink: "fixture-UA" },
    } } },
    resolver: {
      getAutoShareFiles: () => files,
      getShareData: async () => ({ share: { url: "fixture", id: "1", uk: "2" }, baidu: { token: "fixture", id: "fixture" } }),
    },
  });

  if (!unavailable) {
    const start = patched.indexOf("		async resolveShareLinks(files, token) {");
    const end = patched.indexOf("		getAutoShareFiles() {", start);
    const directStart = patched.indexOf("\t\tasync getShareFilesUrl(items, sData) {");
    const directEnd = patched.indexOf("\t\tasync getFilesList(", directStart);
    assert.ok(start >= 0 && end > start && directStart >= 0 && directEnd > directStart, "missing LinkSwift resolver methods");
    vm.runInContext("Object.assign(resolver, {" + patched.slice(directStart, directEnd) + patched.slice(start, end) + "});", scope);
    fakeWindow.__FLUXDOWN_BAIDU_RESOLVE__ = id => scope.resolver.resolvePanelFile(id);
  }
  vm.runInContext(readFileSync(pageFile, "utf8"), scope, { filename: "baidu-page.js" });

  return {
    fakeWindow,
    calls,
    dispatch(data, overrides = {}) {
      const event = { source: fakeWindow, origin: ORIGIN, data, ...overrides };
      for (const listener of listeners) listener(event);
    },
    tick: () => new Promise(resolve => setTimeout(resolve, 0)),
    responses: () => posted.filter(entry => entry.message?.__fluxdownBaiduPageResponse === 1),
  };
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
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].name, "sample.pdf");
  assert.equal(result.items[0].size, 235492201);
  assert.equal(result.items[0].isDir, false);
  assert.equal(typeof result.items[0].id, "string");
  assert.equal(result.canUp, false);
  console.log("  list: OK ->", JSON.stringify(result.items[0]));
}

async function testDownloadChineseError() {
  const harness = createHarness({ resolverError: "签名获取失败" });
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
  const signFailure = createHarness({ signError: "请求失败: fixture" });
  assert.match((await signFailure.fakeWindow.__FLUXDOWN_BAIDU_PAGE__.download("225769319988647")).error, /获取百度分享签名失败.*fixture/);
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

async function testSelectedPdfUsesSharedResolver() {
  const harness = createHarness();
  harness.dispatch({ __fluxdownBaiduPageRequest: 1, requestId: "pdf", op: "download", id: "225769319988647" });
  await harness.tick();
  const replies = harness.responses();
  assert.equal(replies.length, 1);
  const result = replies[0].message.result;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.filename, "sample.pdf");
  const url = new URL(result.url);
  assert.equal(url.pathname, "/fixture-pdf");
  assert.equal(url.searchParams.get("access_token"), "fixture-token");
  assert.equal(result.headers["User-Agent"], "fixture-UA");
  assert.deepEqual(harness.calls, [{ ids: [225769319988647], sign: "fixture-sign" }]);
}

async function testUnavailableResolverAndInvalidTargets() {
  const id = "225769319988647";
  const unavailable = createHarness({ unavailable: true });
  assert.match((await unavailable.fakeWindow.__FLUXDOWN_BAIDU_PAGE__.download(id)).error, /下载助手尚未就绪/);
  const directory = createHarness({ directory: true });
  assert.equal((await directory.fakeWindow.__FLUXDOWN_BAIDU_PAGE__.download(id)).ok, false);
  assert.equal((await directory.fakeWindow.__FLUXDOWN_BAIDU_PAGE__.download("999")).ok, false);
  assert.deepEqual(directory.calls, []);
  const refused = createHarness({ linkError: "<b>百度拒绝</b>" });
  const result = await refused.fakeWindow.__FLUXDOWN_BAIDU_PAGE__.download(id);
  assert.equal(result.ok, false);
  assert.equal(result.error.trim(), "百度拒绝");
  assert.equal(result.url, undefined);
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
await testSelectedPdfUsesSharedResolver();
await testUnavailableResolverAndInvalidTargets();
await testInvalidRequestsIgnored();
await testApiStillExposed();
await testHostGuard();
await testPanelTimeoutSplit();
console.log("Baidu page postMessage bridge tests passed.");
