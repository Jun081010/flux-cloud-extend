import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { registerHooks } from "node:module";

interface SendCall {
  url: string;
  referrer: string;
  filename?: string;
  storedCookies?: string;
  storedHeaders?: Record<string, string>;
}

const sendCalls: SendCall[] = [];
const downloadsUrl = new URL("./downloads.ts", import.meta.url).href;
const sitesUrl = new URL("../utils/cloud-sites.ts", import.meta.url).href;
const protocolUrl = new URL("./protocol.ts", import.meta.url).href;

const emptyModule = "export const browser = {}; export const t = () => ''; export const isAndroidPlatform = () => false; export const notify = () => {}; export const sleep = async () => {}; export const extractCleanFilename = () => ''; export const candidateFilename = () => ''; export const defaultCandidateVariant = () => undefined; export const sendBatchDownloadRequest = async () => ({ success: true }); export const warmupNativeHost = async () => {}; export const getCachedSettings = async () => ({}); export const extractAuthFromCache = () => undefined; export const requestHeaderCache = () => undefined; export const withBrowserUserAgent = (h) => h; export const describeSendError = (e) => String(e); export const openProtocolUrl = async () => {}; export const resolveSaveDir = async () => undefined; export const shouldNotifyChannel = async () => false; export const withRuleHeaders = (_u, _r, h) => h; export const incrementStat = async () => {}; export const maybeArmTaskPollForChannel = () => {}; export const findStoredResource = () => undefined; export const getResources = () => []; export const getTabPageUrl = () => ''; export const mergeStoredHeaders = () => ({}); export const sameOrigin = () => false; export const buildTabView = async () => ({}); export const allRows = () => []; export const findAudioPair = () => null; export const xMediaFilename = () => ''; export const upgradeXImageUrl = (u) => u;";
const emptyModuleSource = emptyModule + " export const getSystemProxy = async () => null; export const parseP2PName = () => undefined;";
const senderMock = `export const sendToFluxDown = (input) => { globalThis.__cloudDownloadSends.push(input); return Promise.resolve({ success: true, sent: 1, failed: 0 }); }; export const describeSendError = (e) => String(e); export const openProtocolUrl = async () => {}; export const resolveSaveDir = async () => undefined; export const shouldNotifyChannel = async () => false; export const withRuleHeaders = (_u, _r, h) => h;`;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "wxt/browser") return { url: "mock:wxt-browser", shortCircuit: true };
    if (specifier === "@/utils/cloud-sites") return { url: sitesUrl, shortCircuit: true };
    if (specifier === "./protocol") return { url: protocolUrl, shortCircuit: true };
    if (specifier === "./sender") return { url: "mock:sender", shortCircuit: true };
    if (/^(?:\.\/|@\/)/.test(specifier) && specifier !== "./protocol" && specifier !== "./sender") return { url: "mock:empty-module", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "mock:wxt-browser") return { format: "module", source: "export const browser = {};", shortCircuit: true };
    if (url === "mock:empty-module") return { format: "module", source: emptyModuleSource, shortCircuit: true };
    if (url === "mock:sender") return { format: "module", source: senderMock, shortCircuit: true };
    return next(url, context);
  },
});

(globalThis as Record<string, unknown>).__cloudDownloadSends = sendCalls;

const downloads = await import(downloadsUrl);

function item(value: unknown) {
  return [value];
}

describe("downloadCloudItems", () => {
  test("公开白名单直链：保留 Cookie 与合法头，剥离 Origin/Referer/Cookie 危险请求头", async () => {
    sendCalls.length = 0;
    const result = await downloads.downloadCloudItems(item({
      url: "https://d.pcs.baidu.com/file/a.zip",
      filename: "../../evil.zip",
      size: 10,
      headers: {
        Cookie: "BDUSS=secret",
        Origin: "https://pan.baidu.com",
        Referer: "https://pan.baidu.com/",
        "User-Agent": "FluxDown-Test",
        "Sec-Fetch-Mode": "cors",
      },
      referrer: "https://pan.baidu.com/s/abc",
    }), 7, "https://pan.baidu.com/s/abc");
    assert.equal(result.success, true);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].filename, "evil.zip");
    assert.equal(sendCalls[0].storedCookies, "BDUSS=secret");
    assert.deepEqual(sendCalls[0].storedHeaders, { "User-Agent": "FluxDown-Test" });
    assert.equal(sendCalls[0].referrer, "https://pan.baidu.com/s/abc");
  });

  test("缺省 referrer 使用页面 URL", async () => {
    sendCalls.length = 0;
    const result = await downloads.downloadCloudItems(item({ url: "https://d.pcs.baidu.com/file/a.zip" }), 7, "https://pan.baidu.com/s/abc");
    assert.equal(result.success, true);
    assert.equal(sendCalls[0].referrer, "https://pan.baidu.com/s/abc");
  });

  test("拒绝私网、非 HTTP、带账号密码、非白名单与跨源 referrer", async () => {
    sendCalls.length = 0;
    const cases = [
      { url: "http://127.0.0.1/file" },
      { url: "http://169.254.169.254/latest/meta-data" },
      { url: "ftp://d.pcs.baidu.com/file" },
      { url: "https://user:pass@d.pcs.baidu.com/file" },
      { url: "https://evil.example.com/file" },
      { url: "https://drive-pc.quark.cn/1/clouddrive/file/download" },
      { url: "https://d.pcs.baidu.com/file", referrer: "https://evil.example.com/" },
    ];
    for (const value of cases) {
      const result = await downloads.downloadCloudItems(item(value), 7, "https://pan.baidu.com/s/abc");
      assert.equal(result.success, false, JSON.stringify(value));
    }
    assert.equal(sendCalls.length, 0);
  });

  test("其他厂商页面不能把百度直链推给 FluxDown", async () => {
    sendCalls.length = 0;
    const result = await downloads.downloadCloudItems(
      item({ url: "https://d.pcs.baidu.com/file/a.zip" }),
      7,
      "https://pan.quark.cn/s/abc",
    );
    assert.equal(result.success, false);
    assert.equal(sendCalls.length, 0);
  });

  test("拒绝空列表、超量列表与超长 URL", async () => {
    sendCalls.length = 0;
    assert.equal((await downloads.downloadCloudItems([], 7, "https://pan.baidu.com/s/abc")).success, false);
    assert.equal((await downloads.downloadCloudItems(new Array(101).fill({ url: "https://d.pcs.baidu.com/a" }), 7, "https://pan.baidu.com/s/abc")).success, false);
    assert.equal((await downloads.downloadCloudItems(item({ url: `https://d.pcs.baidu.com/${"a".repeat(8200)}` }), 7, "https://pan.baidu.com/s/abc")).success, false);
    assert.equal(sendCalls.length, 0);
  });
});

describe("sanitizeCloudFilename", () => {
  test("只保留 basename 并拒绝路径语义", () => {
    assert.equal(downloads.sanitizeCloudFilename("../../evil.zip"), "evil.zip");
    assert.equal(downloads.sanitizeCloudFilename("C:\\Windows\\evil.zip"), "evil.zip");
    assert.equal(downloads.sanitizeCloudFilename(".."), undefined);
    assert.equal(downloads.sanitizeCloudFilename("folder/"), undefined);
    assert.equal(downloads.sanitizeCloudFilename("   "), undefined);
  });

  test("清理 Windows 非法字符、控制字符与保留设备名", () => {
    assert.equal(downloads.sanitizeCloudFilename("a<b>c:\"|?*.zip"), "a_b_c_____.zip");
    assert.equal(downloads.sanitizeCloudFilename("evil\u0000\u202e.zip"), "evil.zip");
    assert.equal(downloads.sanitizeCloudFilename("name. . .  "), "name");
    assert.equal(downloads.sanitizeCloudFilename("CON.txt"), "_CON.txt");
    assert.equal(downloads.sanitizeCloudFilename("lpt9"), "_lpt9");
    assert.equal(downloads.sanitizeCloudFilename("COM1.tar.gz"), "_COM1.tar.gz");
  });

  test("保留正常中文名并限制超长文件名", () => {
    assert.equal(downloads.sanitizeCloudFilename("测试文件.zip"), "测试文件.zip");
    const longName = downloads.sanitizeCloudFilename(`${"中".repeat(300)}.zip`);
    assert.ok(longName);
    assert.ok(longName.length <= 200);
    assert.ok(longName.endsWith(".zip"));
  });
});
