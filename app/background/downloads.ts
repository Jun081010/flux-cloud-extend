/**
 * UI / 右键菜单触发的下载：候选（含清晰度）、资源行、任意 URL 列表、整页转交桌面端解析。
 */
import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";
import { sendBatchDownloadRequest, warmupNativeHost } from "@/utils/download-dispatch";
import { extractCleanFilename } from "@/utils/filename";
import { parseP2PName } from "@/utils/link-protocols";
import { xMediaFilename } from "@/utils/x-media";
import { t } from "@/utils/i18n";
import { findAudioPair } from "@/utils/audio-pairing";
import type { AudioPairMatch } from "@/utils/audio-pairing";
import { candidateFilename, defaultCandidateVariant } from "@/utils/media-candidates";
import type { MediaCandidate, MediaCandidateVariant } from "@/utils/media-candidates";
import type { BatchDownloadItem } from "@/utils/native-messaging";
import { isAndroidPlatform } from "@/utils/platform";
import { getCachedSettings } from "./settings-cache";
import { notify, sleep } from "./notify";
import type { SendChannel, SendResult } from "./protocol";
import { extractAuthFromCache, requestHeaderCache, withBrowserUserAgent } from "./request-cache";
import {
  describeSendError,
  openProtocolUrl,
  resolveSaveDir,
  sendToFluxDown,
  shouldNotifyChannel,
  withRuleHeaders,
} from "./sender";
import { incrementStat } from "./stats";
import { maybeArmTaskPollForChannel } from "./tasks";
import {
  findStoredResource,
  getResources,
  getTabPageUrl,
  mergeStoredHeaders,
  sameOrigin,
} from "./tab-state";
import { buildTabView } from "./tab-view";
import { allRows } from "./view-model";
import type { CandidateRow, TabView } from "./protocol";
import { isAllowedDownloadUrlForPage, isPrivateHostname } from "@/utils/cloud-sites";
import { getSystemProxy } from "@/utils/system-proxy";
import { upgradeXImageUrl } from "@/utils/x-image";
import type { CloudDownloadItem, CloudDownloadTaskResult } from "./protocol";

/** 单次 batch_download 条数上限（与桌面端 MAX_BATCH_ITEMS 对齐）。 */
const BATCH_LIMIT = 1000;

const MAX_CLOUD_DOWNLOAD_ITEMS = 100;
const MAX_CLOUD_URL_LENGTH = 8192;
const MAX_CLOUD_TEXT_LENGTH = 1024;
const MAX_CLOUD_HEADER_COUNT = 64;

const FORBIDDEN_DOWNLOAD_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "cookie",
  "cookie2",
  "proxy-authorization",
  "origin",
  "referer",
]);

const MAX_CLOUD_FILENAME_UNITS = 200;
const MAX_CLOUD_FILENAME_EXTENSION_UNITS = 20;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function trimFilenameEdges(value: string): string {
  return value.replace(/^[ .]+|[ .]+$/g, "");
}

function truncateFilenameUnits(value: string, maxUnits: number): string {
  const dot = value.lastIndexOf(".");
  const extensionLength = value.length - dot - 1;
  const hasExtension = dot > 0 && extensionLength > 0 && extensionLength <= MAX_CLOUD_FILENAME_EXTENSION_UNITS;
  const extension = hasExtension ? value.slice(dot) : "";
  const stem = hasExtension ? value.slice(0, dot) : value;
  const limit = Math.max(1, maxUnits - extension.length);
  let truncated = "";
  for (const character of stem) {
    if (truncated.length + character.length > limit) break;
    truncated += character;
  }
  return `${trimFilenameEdges(truncated)}${extension}`;
}

function isWindowsReservedName(value: string): boolean {
  const stem = value.split(".")[0].replace(/[ .]+$/g, "");
  return WINDOWS_RESERVED_NAME.test(stem);
}

/** 将网盘文件名收窄为可安全落盘的 basename，不保留任何路径语义。 */
export function sanitizeCloudFilename(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  let name = value.split(/[/\\]/).pop() ?? "";
  name = name.normalize("NFC");
  name = name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "");
  name = name.replace(/[<>:"|?*]/g, "_");
  name = trimFilenameEdges(name);
  if (!name || name === "." || name === "..") return undefined;
  if (isWindowsReservedName(name)) name = `_${name}`;
  if (name.length > MAX_CLOUD_FILENAME_UNITS) name = truncateFilenameUnits(name, MAX_CLOUD_FILENAME_UNITS);
  name = trimFilenameEdges(name);
  if (!name || name === "." || name === "..") return undefined;
  return name;
}

function sanitizeCloudHeaders(value: unknown): { ok: true; headers: Record<string, string>; cookies: string } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, headers: {}, cookies: "" };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid headers" };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CLOUD_HEADER_COUNT) return { ok: false, error: "too many headers" };
  const headers: Record<string, string> = {};
  let cookies = "";
  for (const [rawName, rawValue] of entries) {
    if (typeof rawValue !== "string" || rawValue.length > 8192 || /[\u0000-\u001f\u007f]/.test(rawName) || /[\u0000-\u001f\u007f]/.test(rawValue)) {
      return { ok: false, error: "invalid header" };
    }
    const lower = rawName.toLowerCase();
    if (lower === "cookie" || lower === "cookie2") {
      cookies = rawValue;
      continue;
    }
    if (FORBIDDEN_DOWNLOAD_HEADERS.has(lower) || lower.startsWith("proxy-") || lower.startsWith("sec-")) continue;
    headers[rawName] = rawValue;
  }
  return { ok: true, headers, cookies };
}

function normalizedCloudItem(
  value: unknown,
  pageUrl: string,
): { ok: true; item: CloudDownloadItem; headers: Record<string, string>; cookies: string } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid item" };
  const input = value as Partial<CloudDownloadItem>;
  if (typeof input.url !== "string" || input.url.length === 0 || input.url.length > MAX_CLOUD_URL_LENGTH || !isAllowedDownloadUrlForPage(pageUrl, input.url)) {
    return { ok: false, error: "url not allowed" };
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { ok: false, error: "url not allowed" };
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || isPrivateHostname(url.hostname)) {
    return { ok: false, error: "url not allowed" };
  }
  for (const text of [input.filename, input.referrer]) {
    if (text !== undefined && (typeof text !== "string" || text.length > MAX_CLOUD_TEXT_LENGTH)) return { ok: false, error: "invalid text field" };
  }
  if (input.size !== undefined && (typeof input.size !== "number" || !Number.isFinite(input.size) || input.size < 0)) return { ok: false, error: "invalid size" };
  const referrer = normalizedReferrer(input.referrer, pageUrl);
  if (!referrer.ok) return { ok: false, error: referrer.error };
  const sanitized = sanitizeCloudHeaders(input.headers);
  if (!sanitized.ok) return { ok: false, error: sanitized.error };
  const filename = sanitizeCloudFilename(input.filename);
  return {
    ok: true,
    item: { url: input.url, filename, size: input.size, referrer: referrer.value },
    headers: sanitized.headers,
    cookies: sanitized.cookies,
  };
}

function normalizedReferrer(value: string | undefined, pageUrl: string): { ok: true; value: string } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: pageUrl };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "referrer not allowed" };
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || isPrivateHostname(url.hostname)) {
    return { ok: false, error: "referrer not allowed" };
  }
  try {
    if (url.origin === new URL(pageUrl).origin) return { ok: true, value: value };
  } catch {
    return { ok: false, error: "referrer not allowed" };
  }
  return { ok: false, error: "referrer not allowed" };
}

export async function downloadCloudItems(
  rawItems: unknown,
  tabId: number,
  pageUrl: string,
  channel?: SendChannel,
): Promise<CloudDownloadTaskResult> {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_CLOUD_DOWNLOAD_ITEMS) {
    return { success: false, sent: 0, failed: 0, message: "invalid items" };
  }
  const items: Array<{ item: CloudDownloadItem; headers: Record<string, string>; cookies: string }> = [];
  for (const rawItem of rawItems) {
    const normalized = normalizedCloudItem(rawItem, pageUrl);
    if (!normalized.ok) return { success: false, sent: 0, failed: 0, message: normalized.error };
    items.push({ item: normalized.item, headers: normalized.headers, cookies: normalized.cookies });
  }
  let sent = 0;
  let failed = 0;
  let firstError: string | undefined;
  let lastChannel: SendChannel | undefined;
  for (const { item, headers, cookies } of items) {
    const result = await sendToFluxDown({
      url: item.url,
      filename: item.filename,
      fileSize: typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0,
      referrer: item.referrer || pageUrl,
      storedCookies: cookies || undefined,
      storedHeaders: Object.keys(headers).length > 0 ? headers : undefined,
      pageHost: hostOf(pageUrl),
      channel,
    });
    if (result.success) {
      sent += 1;
      lastChannel = result.channel ?? lastChannel;
    } else {
      failed += 1;
      firstError ??= result.message ?? "send failed";
    }
  }
  return {
    success: failed === 0 && sent > 0,
    sent,
    failed,
    ...(firstError ? { message: firstError } : {}),
    ...(lastChannel ? { channel: lastChannel } : {}),
  };
}

/** 候选下载（可指定清晰度）。 */
export async function downloadCandidate(
  tabId: number,
  candidateId: string,
  variantId: string | undefined,
  channel: SendChannel | undefined,
): Promise<SendResult> {
  const view = await buildTabView(tabId, { withHandoff: false });
  const row = allRows(view).find((r) => r.candidate.id === candidateId);
  if (!row) return { success: false, message: "candidate_not_found" };
  const candidate = row.candidate;
  // DRM 内容下载得到的是无法播放的密文，不发给下载器。
  if (candidate.protected) return { success: false, message: t("float.protectedHint") };
  // SW 合成的地址引擎重放只会拿到网页。
  if (candidate.browserOnly) return { success: false, message: t("float.browserOnlyHint") };
  const variant = variantId
    ? candidate.variants.find((v) => v.id === variantId)
    : defaultCandidateVariant(candidate);
  if (!variant) return { success: false, message: "variant_not_found" };
  return sendCandidateVariant(tabId, view, candidate, variant, channel);
}

/**
 * 发送候选的某一档。视频轨 + 独立音频轨一起下发，桌面端负责合并：
 * 只发视频轨会得到无声视频（B 站 DASH / 带 EXT-X-MEDIA 的 HLS）。
 */
async function sendCandidateVariant(
  tabId: number,
  view: TabView,
  candidate: MediaCandidate,
  variant: MediaCandidateVariant,
  channel: SendChannel | undefined,
): Promise<SendResult> {
  // 从嗅探到的资源取回当时的 cookies / headers（requestHeaderCache 可能已过期）。
  const stored = getResources(tabId);
  // 播放器没请求过的档（其它清晰度 / 主清单）没有自己的记录：退回同一候选里同域名的资源，
  // 同一 CDN 上的鉴权头（Referer / Origin / 自定义签名头）通常一致。Cookie 不跨域名借用。
  const sibling = (url: string) => {
    const host = hostOf(url);
    const ids = new Set(candidate.rawResourceIds);
    return stored.find((r) => ids.has(r.id) && hostOf(r.url) === host && (r.headers || r.cookies));
  };
  const video = findStoredResource(stored, variant.videoUrl) ?? sibling(variant.videoUrl);
  const audio =
    variant.audioUrl && sameOrigin(variant.videoUrl, variant.audioUrl)
      ? findStoredResource(stored, variant.audioUrl)
      : undefined;
  const result = await sendToFluxDown({
    url: upgradeXImageUrl(variant.videoUrl),
    audioUrl: variant.audioUrl,
    filename: candidateFilename(candidate, variant),
    fileSize: variant.fileSize && variant.fileSize > 0 ? variant.fileSize : -1,
    mimeType: variant.mimeType,
    referrer: view.pageUrl,
    storedCookies: video?.cookies || audio?.cookies,
    storedHeaders: mergeStoredHeaders(video?.headers, audio?.headers),
    channel,
    pageHost: view.site.host,
  });
  return {
    success: result.success,
    message: result.success ? undefined : result.message ?? t("notify.sendFailed"),
    channel: result.channel,
  };
}
/**
 * 快捷键「下载正在播放的媒体」：取活动标签页当前播放元素关联的候选（正在播放的档优先），
 * 结果用系统通知反馈（快捷键没有页面内 UI）。
 */
export async function downloadPlayingMedia(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const view = await buildTabView(tab.id, { withHandoff: false });
  const row = view.playing.find((r) => r.candidate.downloadable && !r.candidate.protected && !r.candidate.browserOnly);
  if (!row) {
    const blocked = view.playing.find((r) => r.candidate.protected || r.candidate.browserOnly)?.candidate;
    const hint = blocked?.protected ? t("float.protectedHint") : blocked ? t("float.browserOnlyHint") : t("shortcut.noPlayingMedia");
    notify(t("shortcut.downloadTitle"), hint);
    return;
  }
  const result = await downloadCandidate(tab.id, row.candidate.id, row.playingVariantId ?? undefined, undefined);
  if (!result.success) notify(t("shortcut.downloadTitle"), result.message ?? t("notify.sendFailed"));
}

interface BatchInput {
  url: string;
  audioUrl?: string;
  referrer?: string;
  filename?: string;
  fileSize?: number;
  mimeType?: string;
}

/**
 * 批量发送。本地通道单条 batch_download 携带全部条目（超大批量由 native-messaging 分块），
 * 旧桌面端自动回退逐条；远程通道单次 POST /download/batch。
 */
async function sendBatch(
  rawItems: BatchInput[],
  tabId: number | undefined,
  channel: SendChannel | undefined,
  pageHost: string | undefined,
): Promise<SendResult> {
  // 相同视频轨 + 音频轨只允许创建一个任务；不同清晰度/编码的 URL 保留。
  const seen = new Set<string>();
  const items = rawItems
    .filter((item) => {
      if (!item?.url) return false;
      const key = `${item.url}\u0000${item.audioUrl || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({
      ...item,
      filename: extractCleanFilename(item.filename, item.url, item.mimeType) || undefined,
    }));
  if (items.length === 0) return { success: false, message: "No valid items" };

  // === fluxdown:// 协议模式（仅桌面；Android 由 Intent 交接取代）：逐条唤起（认证信息无法携带；带音频轨的必须走 NMH/远程） ===
  const settings = await getCachedSettings();
  if (settings.enableFluxdownProtocol && !channel && !items.some((item) => item.audioUrl) && !(await isAndroidPlatform())) {
    let sent = 0;
    for (const item of items) {
      if (await openProtocolUrl(item.url, item.filename)) sent++;
      await sleep(800);
    }
    await incrementStat(sent > 0 ? "sent" : "failed");
    if (sent > 0 && (await shouldNotifyChannel("local"))) {
      notify(t("notify.downloadSent"), t("notify.batchSentDetail", { count: String(sent) }));
    }
    return { success: sent > 0, channel: "local" };
  }

  // 预热 NMH：App 冷启动与下方逐项 cookie 收集（各 500ms 上限）并行
  warmupNativeHost();
  const tabResources = tabId !== undefined && tabId >= 0 ? getResources(tabId) : [];
  // 批量条目必须显式携带代理：引擎按任务级 proxy_url 建任务，缺省会直连，
  // 而 X 等 CDN 在国内直连超时。检测不到时省略字段（沿用桌面端全局配置）。
  const detectedProxy = await getSystemProxy();
  const proxyUrl = detectedProxy.enabled ? detectedProxy.url : undefined;

  const batchItems: BatchDownloadItem[] = await Promise.all(
    items.map(async (item) => {
      const itemAuth = extractAuthFromCache(item.url);
      let cookieString = itemAuth.cookies || "";
      let extraHeaders: Record<string, string> = itemAuth.headers || {};
      if (itemAuth.cookies || itemAuth.headers) requestHeaderCache.delete(item.url);
      if (!cookieString) {
        try {
          const cookies = await Promise.race([
            browser.cookies.getAll({ url: item.url }),
            new Promise<Browser.cookies.Cookie[]>((_, reject) =>
              setTimeout(() => reject(new Error("cookies timeout")), 500),
            ),
          ]);
          cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        } catch {
          /* timeout 或权限不足，跳过 */
        }
      }
      // 兜底：从 tab 资源恢复认证信息
      if (!cookieString || Object.keys(extraHeaders).length === 0) {
        const matched = findStoredResource(tabResources, item.url);
        const audioMatched =
          item.audioUrl && sameOrigin(item.url, item.audioUrl)
            ? findStoredResource(tabResources, item.audioUrl)
            : undefined;
        if (!cookieString) cookieString = matched?.cookies || audioMatched?.cookies || "";
        if (Object.keys(extraHeaders).length === 0) {
          extraHeaders = mergeStoredHeaders(matched?.headers, audioMatched?.headers) || {};
        }
      }
      return {
        url: item.url,
        audioUrl: item.audioUrl,
        referrer: item.referrer || "",
        filename: item.filename,
        cookies: cookieString,
        headers: withBrowserUserAgent(withRuleHeaders(item.url, item.referrer || "", extraHeaders)),
        fileSize: item.fileSize,
        mimeType: item.mimeType,
        proxyUrl,
        saveDir: await resolveSaveDir({ url: item.url, referrer: item.referrer, pageHost }),
      };
    }),
  );

  const response = await sendBatchDownloadRequest(batchItems, channel);
  const notifyOk = await shouldNotifyChannel(response.channel);
  if (response.success) {
    await incrementStat("sent");
    maybeArmTaskPollForChannel(response.channel);
    if (notifyOk) {
      notify(t("notify.downloadSent"), t("notify.batchSentDetail", { count: String(items.length) }));
    }
    return { success: true, channel: response.channel };
  }
  await incrementStat("failed");
  if (notifyOk) notify(t("notify.sendFailed"), describeSendError(response.message));
  return { success: false, message: response.message, channel: response.channel };
}

/** 资源行下载：只有一条走 sendToFluxDown（可携带完整认证与请求事务），多条走批量。 */
export async function downloadResources(
  tabId: number,
  resourceIds: string[],
  channel: SendChannel | undefined,
): Promise<SendResult> {
  const wanted = new Set(resourceIds);
  const resources = getResources(tabId).filter((r) => wanted.has(r.id));
  if (resources.length === 0) return { success: false, message: "No items" };
  const pageUrl = getTabPageUrl(tabId);
  const pageHost = hostOf(pageUrl);

  if (resources.length === 1) {
    const r = resources[0];
    const result = await sendToFluxDown({
      url: upgradeXImageUrl(r.url),
      referrer: r.pageUrl || pageUrl,
      filename: xMediaFilename(r.url) ?? extractCleanFilename(r.filename, r.url, r.mimeType),
      // IDM/NDM 策略：嗅探来源跳过 probe（一次性 token URL 会被 probe 消耗）。
      fileSize: r.size > 0 ? r.size : -1,
      mimeType: r.mimeType,
      storedCookies: r.cookies,
      storedHeaders: r.headers,
      channel,
      pageHost,
    });
    return { success: result.success, message: result.message, channel: result.channel };
  }
  return sendBatch(
    resources.map((r) => ({
      url: upgradeXImageUrl(r.url),
      referrer: r.pageUrl || pageUrl,
      filename: xMediaFilename(r.url) ?? r.filename,
      fileSize: r.size > 0 ? r.size : -1,
      mimeType: r.mimeType,
    })),
    tabId,
    channel,
    pageHost,
  );
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** 任意 URL 列表下载（快速下载输入框、链接页、磁力点击接管）。 */
export async function downloadUrls(
  urls: string[],
  referrer: string | undefined,
  tabId: number | undefined,
  channel: SendChannel | undefined,
): Promise<SendResult> {
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  if (unique.length === 0) return { success: false, message: "No items" };
  const viewTabId = tabId !== undefined && tabId >= 0 ? tabId : null;
  const pageUrl = viewTabId !== null ? getTabPageUrl(viewTabId) : "";
  const effectiveReferrer = referrer || pageUrl || undefined;
  const pageHost = hostOf(effectiveReferrer ?? "");

  // 链接抓取 / 拖球落到链接只拿到一个地址：若它正好是「视频轨 + 独立音频轨」候选的
  // 视频地址，走候选下载才能把音频轨一并交给桌面端，否则得到无声视频。
  let view: TabView | null = null;
  if (viewTabId !== null) {
    try {
      view = await buildTabView(viewTabId, { withHandoff: false });
    } catch {
      view = null;
    }
  }
  const rows = view ? allRows(view) : [];
  const paired = new Map<string, AudioPairMatch<CandidateRow>>();
  const plain: string[] = [];
  for (const original of unique) {
    const upgraded = upgradeXImageUrl(original);
    const hit = view
      ? findAudioPair(rows, original) ?? (upgraded !== original ? findAudioPair(rows, upgraded) : null)
      : null;
    if (hit && view && viewTabId !== null) paired.set(original, hit);
    else plain.push(original);
  }

  let last: SendResult = { success: true };
  if (view && viewTabId !== null) {
    for (const hit of paired.values()) {
      last = await sendCandidateVariant(viewTabId, view, hit.row.candidate, hit.variant, channel);
      if (!last.success) return last;
    }
  }
  if (plain.length === 0) return last;

  const upgraded = [...new Set(plain.map((u) => upgradeXImageUrl(u)))];
  if (upgraded.length === 1) {
    const url = upgraded[0];
    const result = await sendToFluxDown({
      url,
      referrer: effectiveReferrer,
      filename: parseP2PName(url) ?? xMediaFilename(url) ?? undefined,
      fileSize: 0,
      channel,
      pageHost,
    });
    return { success: result.success, message: result.message, channel: result.channel };
  }

  for (let i = 0; i < upgraded.length; i += BATCH_LIMIT) {
    const chunk = upgraded.slice(i, i + BATCH_LIMIT);
    last = await sendBatch(
      chunk.map((url) => ({
        url,
        referrer: effectiveReferrer,
        filename: parseP2PName(url) ?? xMediaFilename(url) ?? undefined,
        fileSize: 0,
      })),
      tabId,
      channel,
      pageHost,
    );
    if (!last.success) return last;
  }
  return last;
}

/** 把页面 URL 交给桌面端；命中解析插件时由桌面端选择清晰度。 */
export async function handoffPage(tabId: number): Promise<SendResult> {
  let pageUrl = getTabPageUrl(tabId);
  if (!pageUrl) {
    try {
      pageUrl = (await browser.tabs.get(tabId)).url ?? "";
    } catch {
      /* tab 已关闭 */
    }
  }
  if (!pageUrl) return { success: false, message: "No page url" };
  const result = await sendToFluxDown({ url: pageUrl, referrer: pageUrl, fileSize: 0 });
  return { success: result.success, message: result.message, channel: result.channel, taskId: createdTaskId(result.data) };
}


/** 本机 `download` 应答的 `data`：直接建任务时为 `{ taskId }`，进确认框时为 `{ transactionIds }`。 */
function createdTaskId(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("taskId" in data)) return undefined;
  const taskId = data.taskId;
  return typeof taskId === "string" && taskId ? taskId : undefined;
}
