import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parseHTML } from "../app/node_modules/linkedom/esm/index.js";
import { buildPatchedLinkSwift } from "./patch-linkswift.mjs";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptDirectory, "..");
const outputFile = join(projectRoot, "app", "public", "cloud", "linkswift.user.js");
const shimFile = join(projectRoot, "app", "public", "cloud", "linkswift-gm-shim.js");
const bundleFile = join(projectRoot, "app", "public", "cloud", "linkswift.bundle.js");
const baiduPageFile = join(projectRoot, "app", "public", "cloud", "baidu-page.js");

function count(text, needle) {
  return text.split(needle).length - 1;
}

function runNodeCheck(file) {
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}

async function respond(listeners, fakeWindow, id, result) {
  listeners.forEach((listener) =>
    listener({
      source: fakeWindow,
      origin: fakeWindow.location.origin,
      data: {
        __fluxdownResult: 1,
        channel: "a".repeat(32),
        id,
        ok: true,
        result,
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function testPatchIdempotency() {
  const first = buildPatchedLinkSwift();
  const second = buildPatchedLinkSwift();
  assert.equal(first.outputSha256, second.outputSha256, "patched output must be deterministic");
  const patched = readFileSync(outputFile, "utf8");
  assert.equal(patched.startsWith("// Patched for FluxDown Cloud Extension; upstream LinkSwift AGPL-3.0."), true);
  assert.equal(count(patched, `fluxdown: {`), 1, "missing fluxdown config");
  assert.equal(count(patched, `data-mode="fluxdown"`), 15, "incorrect fluxdown menu count");
  assert.equal(count(patched, `if (temp.mode === "fluxdown") {`), 2, "missing generateDOM fluxdown branches");
  assert.equal(count(patched, `case "fluxdown":`), 1, "missing sendto switch case");
  assert.equal(count(patched, `async fluxdown(link, filename, filesize, headers = {}) {`), 1, "missing sendTo.fluxdown");
  assert.equal(count(patched, `GM_fluxdownDownload(payload)`), 1, "missing GM_fluxdownDownload call");
  assert.equal(count(patched, `})($);`), 1, "jQuery invocation was not patched");
  assert.equal(count(patched, `const unsafeWindow = window;`), 1, "unsafeWindow must not assign a page global");
  assert.equal(count(patched, '${"${'), 0, "template placeholders must not be double-escaped");
  assert.equal(patched.includes("content.find(`.${mount}.extra`)"), true, "fluxdown extra mount selector is broken");
  assert.equal(patched.includes("content.find(`.${mount}.main`)"), true, "fluxdown row mount selector is broken");
  assert.equal(patched.includes(`@version           1.1.4`), true, "upstream version must be preserved");
  assert.equal(patched.includes(`new Function(base.decodeBase(`), false, "console hook must be removed");

  // 百度大文件回退：转存到 /FluxDown 再取 filemetas 直链，不再只提示“保存到网盘”。
  assert.equal(count(patched, "async fluxdownSaveShareFiles(items, sData, token) {"), 1, "fluxdownSaveShareFiles must be inserted into $baidu");
  assert.equal(count(patched, 'this.fluxdownSaveShareFiles([item], sData, base.getValue("baidu_access_token"))'), 1, "large-file fallback must call fluxdownSaveShareFiles via this");
  assert.equal(count(patched, "const pollDeadline = Date.now() + 15000;"), 1, "transfer must poll up to 15s for async save");
  assert.equal(count(patched, "return expected > 0 ? Number(file.size) === expected : true;"), 1, "same-name match must include file size");
  assert.equal(patched.includes("transfer?.errno !== 0 && transfer?.errno !== 4"), true, "errno 4 must not abort polling");
  assert.equal(count(patched, 'if (base.isType(res.list) === "array") temp.glinks.push({ "id": item.fs_id'), 1, "large-file fallback must not cache res.list string in temp.glinks");
  assert.equal(patched.includes('else item.dlink = `获取下载地址失败：此文件超过直链获取限制'), true, "large-file fallback must keep an explicit Chinese reason");
  assert.equal(patched.includes("保存到网盘</b>后于网盘中下载"), false, "large-file fallback must no longer only show the 'save to netdisk' hint");
  assert.equal(patched.includes("Failed to fetch"), false, "large-file fallback must not surface 'Failed to fetch'");
  assert.equal(count(patched, '${"${'), 0, "new fallback strings must not be double-escaped");
  return { sha256: second.outputSha256, bytes: second.outputBytes };
}

function testLocalDependencies() {
  const expected = [
    "jquery.min.js",
    "sweetalert2.min.js",
    "md5.min.js",
    "sweetalert2.min.css",
    "sweetalert2-dark.min.css",
  ];
  for (const name of expected) {
    const file = join(projectRoot, "app", "public", "cloud", "vendor", name);
    assert.equal(existsSync(file), true, `missing local dependency: ${name}`);
    assert.ok(readFileSync(file).length > 100, `local dependency is empty: ${name}`);
  }
}

function testBaiduPageScript() {
  const source = readFileSync(baiduPageFile, "utf8");
  assert.equal(/const api = Object\.freeze\(\{ list, open, up, download \}\)/.test(source), true, "baidu page API must expose list/open/up/download");
  assert.equal(source.includes("window.__FLUXDOWN_BAIDU_PAGE__ = api;"), true, "baidu page API must be assigned to window");
  assert.equal(source.includes("__fluxdownBaiduPageRequest"), true, "baidu page postMessage bridge must exist");
  assert.equal(source.includes("__fluxdownBaiduPageResponse"), true, "baidu page postMessage response must exist");
  assert.equal(source.includes('host === "pan.baidu.com" || host === "yun.baidu.com"'), true, "baidu page script must be limited to baidu cloud hosts");
  assert.equal(source.includes('const FOLDER = "/FluxDown";'), true, "baidu page script must save into /FluxDown");
  assert.equal(source.includes("const deadline = Date.now() + 15000;"), true, "baidu page script must poll for transferred files");
  assert.equal(source.includes("url.searchParams.set(\"access_token\", token)"), true, "baidu dlink must carry access_token");
  assert.equal(/BDUSS|密码|账号密码|Cookie/.test(source.replace(/document\.cookie/g, "")), false, "baidu page script must not read or return BDUSS/cookie/password values");
  assert.equal(source.includes("console.log"), false, "baidu page script must not log tokens");
}

async function testShimRuntime() {
  const listeners = [];
  const posted = [];
  const lightCss = readFileSync(join(projectRoot, "app", "public", "cloud", "vendor", "sweetalert2.min.css"), "utf8");
  const darkCss = readFileSync(join(projectRoot, "app", "public", "cloud", "vendor", "sweetalert2-dark.min.css"), "utf8");
  const fakeWindow = {
    location: { origin: "https://pan.baidu.com" },
    __FLUXDOWN_LINKSWIFT_BOOT__: {
      channelId: "a".repeat(32),
      values: { setting_ui_theme: { color: "#123456", custom: { $baidu: true } } },
      resources: { SwalLigt: lightCss, SwalDark: darkCss },
    },
    addEventListener(type, listener) {
      if (type === "message") listeners.push(listener);
    },
    postMessage(message, origin) {
      posted.push({ message, origin });
    },
    console: { error() {}, warn() {} },
    navigator: {},
    document: {
      createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }),
      body: { appendChild() {} },
      execCommand: () => true,
    },
  };
  const context = vm.createContext({
    window: fakeWindow,
    console: fakeWindow.console,
    navigator: fakeWindow.navigator,
    document: fakeWindow.document,
    location: fakeWindow.location,
    URLSearchParams,
    Blob: class {},
    URL,
    Uint8Array,
    atob: (value) => Buffer.from(value || "", "base64").toString("binary"),
    setTimeout: (callback, delay) => (delay > 1000 ? 0 : setTimeout(callback, 0)),
    clearTimeout,
    structuredClone,
  });
  const code = readFileSync(shimFile, "utf8");
  vm.runInContext(code, context);

  assert.equal(fakeWindow.GM_info.version, "1.0.0");
  assert.equal(fakeWindow.GM_info.script.version, "1.1.4");
  assert.equal(typeof fakeWindow.GM_getValue, "function");
  assert.equal(typeof fakeWindow.GM_setValue, "function");
  assert.equal(typeof fakeWindow.GM_xmlhttpRequest, "function");
  assert.equal(typeof fakeWindow.GM_fluxdownDownload, "function");
  assert.equal(fakeWindow.GM_getResourceText("SwalLigt"), lightCss);
  assert.equal(fakeWindow.GM_getResourceText("SwalDark"), darkCss);
  assert.ok(lightCss.length > 100 && darkCss.length > 100, "local SweetAlert2 CSS must not be empty");

  const theme = fakeWindow.GM_getValue("setting_ui_theme");
  theme.color = "#abcdef";
  assert.equal(fakeWindow.GM_getValue("setting_ui_theme").color, "#123456", "GM_getValue must return a copy");
  fakeWindow.GM_setValue("setting_init", { version: "1.1.4" });
  assert.equal(fakeWindow.GM_getValue("setting_init").version, "1.1.4");
  assert.equal(posted.some((entry) => entry.message?.op === "storage" && entry.message.args?.op === "set"), true);

  let loadedResponse;
  const requestHandle = fakeWindow.GM_xmlhttpRequest({
    url: "https://pan.baidu.com/api/test",
    method: "GET",
    responseType: "text",
    onload(response) {
      loadedResponse = response;
    },
  });
  assert.equal(typeof requestHandle.abort, "function");
  const fetchMessage = posted.find((entry) => entry.message?.op === "fetch");
  assert.ok(fetchMessage, "GM_xmlhttpRequest must post a fetch request");
  assert.equal(fetchMessage.origin, "https://pan.baidu.com");
  await respond(listeners, fakeWindow, fetchMessage.message.id, {
    ok: true,
    status: 200,
    statusText: "OK",
    responseText: "ok",
    response: "ok",
    responseB64: Buffer.from("ok").toString("base64"),
    mime: "text/plain",
    finalUrl: "https://pan.baidu.com/api/test",
    headers: [["Content-Length", "2"], ["Range", "bytes=0-1"]],
  });
  assert.equal(loadedResponse.status, 200);
  assert.equal(loadedResponse.responseText, "ok");
  assert.equal(loadedResponse.responseHeaders, "Content-Length: 2\r\nRange: bytes=0-1");

  fakeWindow.GM_xmlhttpRequest({
    url: new URL("https://pan.baidu.com/api/url-object"),
    method: "POST",
    headers: { "X-Test": 1 },
    data: "payload",
  });
  const urlObjectMessage = posted.find(
    (entry) => entry.message?.args?.request?.url === "https://pan.baidu.com/api/url-object",
  );
  assert.ok(urlObjectMessage, "URL objects must be serialized before postMessage");
  assert.equal(urlObjectMessage.message.args.request.headers["X-Test"], "1");

  let downloadResult;
  let aborted = false;
  fakeWindow.GM_fluxdownDownload([{ url: "https://pan.baidu.com/file", filename: "demo.bin" }]).then((value) => {
    downloadResult = value;
  });
  const downloadMessage = posted.find((entry) => entry.message?.op === "download");
  assert.ok(downloadMessage, "GM_fluxdownDownload must post a download request");
  await respond(listeners, fakeWindow, downloadMessage.message.id, {
    ok: true,
    success: true,
    sent: 1,
    failed: 0,
  });

  const abortHandle = fakeWindow.GM_xmlhttpRequest({
    url: "https://pan.baidu.com/api/abort",
    onabort() {
      aborted = true;
    },
    onload() {
      throw new Error("aborted request must not call onload");
    },
  });
  const abortMessage = posted.find((entry) => entry.message?.args?.request?.url === "https://pan.baidu.com/api/abort");
  assert.ok(abortMessage, "abort test must post a fetch request");
  abortHandle.abort();
  await respond(listeners, fakeWindow, abortMessage.message.id, {
    ok: true,
    status: 200,
    statusText: "OK",
    responseText: "late",
    response: "late",
    responseB64: "",
    mime: "text/plain",
    finalUrl: "https://pan.baidu.com/api/abort",
    headers: [],
  });
  assert.equal(aborted, true, "abort must trigger onabort");
  assert.equal(downloadResult, "success");
}


function testBundleIsolation() {
  const { window, document } = parseHTML("<!doctype html><html><head></head><body></body></html>");
  Object.defineProperty(window, "location", {
    value: { href: "https://pan.baidu.com/", origin: "https://pan.baidu.com", host: "pan.baidu.com", pathname: "/" },
    configurable: true,
  });
  document.implementation = {
    createHTMLDocument: () => parseHTML("<!doctype html><html><head></head><body></body></html>").document,
  };
  for (const [name, value] of Object.entries({
    top: window,
    self: window,
    close: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  })) Object.defineProperty(window, name, { value, configurable: true });

  const pageJQuery = () => "page-jquery";
  const pageSwal = () => "page-swal";
  const pageMd5 = () => "page-md5";
  const fakeModule = { exports: {} };
  const fakeSweetalert2 = () => "page-sweetalert2";
  const fakeSweetAlert = () => "page-sweetAlert";
  const pageSweetAlias = () => "page-swal";
  for (const [name, value] of Object.entries({ jQuery: pageJQuery, $: pageJQuery, Swal: pageSwal, Sweetalert2: fakeSweetalert2, sweetAlert: fakeSweetAlert, swal: pageSweetAlias, SweetAlert: fakeSweetAlert, md5: pageMd5 })) {
    Object.defineProperty(window, name, { value, configurable: true, writable: true, enumerable: true });
  }
  const fakeDefine = Object.assign(() => "page-amd", { amd: {} });
  const fakeRequire = () => "page-require";
  const fakeExports = { name: "page-exports" };
  const sandbox = Object.assign(Object.create(null), {
    window,
    document,
    console,
    navigator: window.navigator,
    setTimeout: (callback, delay) => (delay > 1000 ? 0 : setTimeout(callback, 0)),
    clearTimeout,
    crypto: window.crypto,
    self: window,
    location: window.location,
    URL,
    URLSearchParams,
    Blob: class {},
    Uint8Array,
    atob,
    btoa,
    FormData: class {},
    MutationObserver: class { observe() {} disconnect() {} },
    sessionStorage: {
      values: new Map(),
      getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
      setItem(key, value) { this.values.set(key, String(value)); },
      removeItem(key) { this.values.delete(key); },
    },
    module: fakeModule,
    exports: fakeExports,
    define: fakeDefine,
    require: fakeRequire,
    GM_info: { script: { name: "LinkSwift", version: "1.1.4", author: "test" }, scriptHandler: "test", version: "1.0.0" },
    GM_getValue: (key, fallback) => key === "setting_init" ? { version: "1.1.4" } : ({ color: "#4C84FF", custom: {} }),
    GM_setValue: () => {},
    GM_deleteValue: () => {},
    GM_getResourceText: () => ".x{}",
    GM_xmlhttpRequest: () => ({ abort() {} }),
    GM_registerMenuCommand: () => {},
    GM_setClipboard: () => {},
    GM_openInTab: () => {},
    GM_fluxdownDownload: async () => "success",
  });
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(bundleFile, "utf8"), sandbox, { timeout: 3000, filename: "linkswift.bundle.js" });

  assert.equal(window.jQuery, pageJQuery, "bundle must restore page jQuery");
  assert.equal(window.$, pageJQuery, "bundle must restore page $");
  assert.equal(window.Swal, pageSwal, "bundle must restore page Swal");
  assert.equal(window.md5, pageMd5, "bundle must restore page md5");
  assert.equal(window.Sweetalert2, fakeSweetalert2, "bundle must restore page Sweetalert2");
  assert.equal(window.swal, pageSweetAlias, "bundle must restore page swal");
  assert.equal(window.sweetAlert, fakeSweetAlert, "bundle must restore page sweetAlert");
  assert.equal(window.SweetAlert, fakeSweetAlert, "bundle must restore page SweetAlert");
  assert.equal(sandbox.module, fakeModule, "bundle must restore page module");
  assert.equal(sandbox.exports, fakeExports, "bundle must restore page exports");
  assert.equal(sandbox.define, fakeDefine, "bundle must restore page define");
  assert.equal(sandbox.require, fakeRequire, "bundle must restore page require");
  assert.equal(bundleFile && readFileSync(bundleFile, "utf8").includes("__fluxdownCapture"), false, "bundle must not expose a test capture hook");
  assert.equal(typeof window.__fluxdownCapture, "undefined", "bundle must not create extra page globals");
  assert.equal(typeof window.LinkSwift, "undefined", "bundle must not expose LinkSwift on window");
}


const summary = testPatchIdempotency();
testLocalDependencies();
runNodeCheck(outputFile);
runNodeCheck(shimFile);
runNodeCheck(bundleFile);
runNodeCheck(baiduPageFile);
testBaiduPageScript();
testBundleIsolation();
await testShimRuntime();
console.log(`LinkSwift patch tests passed: sha256=${summary.sha256}, bytes=${summary.bytes}`);
