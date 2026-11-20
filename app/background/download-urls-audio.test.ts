import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { registerHooks } from "node:module";

interface SendCall {
  url: string;
  audioUrl?: string;
  referrer?: string;
  filename?: string;
  storedCookies?: string;
  storedHeaders?: Record<string, string>;
}

const sends: SendCall[] = [];
const downloadsUrl = new URL("./downloads.ts", import.meta.url).href;
const pairingUrl = new URL("../utils/audio-pairing.ts", import.meta.url).href;

const stubExports = [
  "export const browser = { cookies: { getAll: async () => [] } };",
  "export const t = () => '';",
  "export const isAndroidPlatform = async () => false;",
  "export const notify = () => {};",
  "export const sleep = async () => {};",
  "export const extractCleanFilename = () => '';",
  "export const candidateFilename = () => 'video.mp4';",
  "export const defaultCandidateVariant = () => undefined;",
  "export const sendBatchDownloadRequest = async () => ({ success: true });",
  "export const warmupNativeHost = async () => {};",
  "export const getCachedSettings = async () => ({});",
  "export const extractAuthFromCache = () => undefined;",
  "export const requestHeaderCache = new Map();",
  "export const withBrowserUserAgent = (h) => h;",
  "export const describeSendError = (e) => String(e);",
  "export const openProtocolUrl = async () => false;",
  "export const resolveSaveDir = async () => undefined;",
  "export const shouldNotifyChannel = async () => false;",
  "export const withRuleHeaders = (_u, _r, h) => h;",
  "export const incrementStat = async () => {};",
  "export const maybeArmTaskPollForChannel = () => {};",
  "export const findStoredResource = () => undefined;",
  "export const getResources = () => [];",
  "export const getTabPageUrl = () => globalThis.__pairTestPageUrl;",
  "export const mergeStoredHeaders = () => ({});",
  "export const sameOrigin = (a, b) => { try { return new URL(a).origin === new URL(b).origin; } catch { return false; } };",
  "export const buildTabView = async () => globalThis.__pairTestView;",
  "export const allRows = (view) => [...view.playing, ...view.otherElements, ...view.unbound];",
  "export const xMediaFilename = () => undefined;",
  "export const upgradeXImageUrl = (u) => u;",
  "export const getSystemProxy = async () => ({ enabled: false, url: '' });",
  "export const parseP2PName = () => undefined;",
  "export const isAllowedDownloadUrlForPage = () => true;",
  "export const isPrivateHostname = () => false;",
].join("\n");

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "wxt/browser") return { url: "mock:wxt-browser", shortCircuit: true };
    if (specifier === "@/utils/audio-pairing") return { url: pairingUrl, shortCircuit: true };
    if (specifier === "./sender") return { url: "mock:sender", shortCircuit: true };
    if (/^(?:\.\/|@\/)/.test(specifier)) return { url: "mock:stub", shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "mock:wxt-browser") return { format: "module", source: "export const browser = { cookies: { getAll: async () => [] }, tabs: { query: async () => [] } };", shortCircuit: true };
    if (url === "mock:stub") return { format: "module", source: stubExports, shortCircuit: true };
    if (url === "mock:sender") {
      const source =
        "export const sendToFluxDown = (input) => { globalThis.__pairTestSends.push(input); return Promise.resolve({ success: true, sent: 1, failed: 0 }); };" +
        "export const describeSendError = (e) => String(e);" +
        "export const openProtocolUrl = async () => false;" +
        "export const resolveSaveDir = async () => undefined;" +
        "export const shouldNotifyChannel = async () => false;" +
        "export const withRuleHeaders = (_u, _r, h) => h;";
      return { format: "module", source, shortCircuit: true };
    }
    return next(url, context);
  },
});

const globals = globalThis as Record<string, unknown>;
globals.__pairTestSends = sends;
globals.__pairTestPageUrl = "https://www.bilibili.com/video/BV1test";
globals.__pairTestView = undefined;

const { downloadUrls } = await import(downloadsUrl);

const VIDEO = "https://cdn.example.com/video-1080.m4s";
const AUDIO = "https://cdn.example.com/audio-30280.m4s";

function makeView(audioUrl: string | undefined, flags: Partial<{ downloadable: boolean; protected: boolean; browserOnly: boolean }> = {}) {
  const variant = { id: "v1080", videoUrl: VIDEO, audioUrl, mimeType: "video/mp4" };
  const candidate = {
    id: "cand-1",
    downloadable: flags.downloadable ?? true,
    protected: flags.protected ?? false,
    browserOnly: flags.browserOnly ?? false,
    rawResourceIds: ["r1"],
    variants: [variant],
  };
  return {
    pageUrl: "https://www.bilibili.com/video/BV1test",
    site: { host: "www.bilibili.com" },
    playing: [{ id: "cand-1", candidate, playingVariantId: "v1080" }],
    otherElements: [],
    unbound: [],
  };
}

beforeEach(() => {
  sends.length = 0;
});

describe("downloadUrls 音视频配对", () => {
  test("视频轨地址命中候选时一并下发 audioUrl", async () => {
    globals.__pairTestView = makeView(AUDIO);
    const result = await downloadUrls([VIDEO], undefined, 7, undefined);
    assert.equal(result.success, true);
    assert.equal(sends.length, 1, "只应发送一条任务，不应重复发送纯 URL");
    assert.equal(sends[0].url, VIDEO);
    assert.equal(sends[0].audioUrl, AUDIO);
    assert.equal(sends[0].filename, "video.mp4");
  });

  test("带 #t= 片段的播放地址同样能配对", async () => {
    globals.__pairTestView = makeView(AUDIO);
    await downloadUrls([`${VIDEO}#t=12.5`], undefined, 7, undefined);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].audioUrl, AUDIO);
  });

  test("未命中的普通地址保持原样且不带 audioUrl", async () => {
    globals.__pairTestView = makeView(AUDIO);
    await downloadUrls(["https://example.com/file.zip"], undefined, 7, undefined);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].url, "https://example.com/file.zip");
    assert.equal(sends[0].audioUrl, undefined);
    // 普通下载不预填文件名，交给桌面端/发送层按响应头推断。
    assert.equal(sends[0].filename, undefined);
  });

  test("受保护候选不参与配对，避免把不可下载档推给桌面端", async () => {
    globals.__pairTestView = makeView(AUDIO, { protected: true });
    await downloadUrls([VIDEO], undefined, 7, undefined);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].audioUrl, undefined);
  });

  test("没有标签页上下文时不构建视图，退回普通下载", async () => {
    globals.__pairTestView = makeView(AUDIO);
    await downloadUrls([VIDEO], "https://www.bilibili.com/video/BV1test", undefined, undefined);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].audioUrl, undefined);
  });
});
