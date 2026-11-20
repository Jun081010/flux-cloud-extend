import { browser } from "wxt/browser";
import type { Browser } from "wxt/browser";
import {
  CLOUD_AUTO_SHARE_STORAGE_KEY,
  cloudAutoShareMatches,
  cloudVendorForPage,
  isAllowedFetchUrlForPage,
  isAllowedDownloadUrlForPage,
  isAllowedOpenTabUrlForPage,
  isCloudPageUrl,
} from "@/utils/cloud-sites";
import type { CloudVendorId } from "@/utils/cloud-sites";
import { downloadCloudItems } from "./downloads";
import type {
  CloudDownloadRequestPayload,
  CloudDownloadResult,
  CloudFetchResponse,
  CloudInjectResult,
  CloudOpenTabResult,
  CloudPageRequest,
  CloudPageResult,
  CloudStorageResult,
} from "./protocol";

const CLOUD_STORAGE_PREFIX = "cloud.linkswift:";
const MAX_STORAGE_KEY_LENGTH = 128;
const MAX_STORAGE_VALUE_BYTES = 256 * 1024;
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 32 * 1024 * 1024;
const MAX_FETCH_TIMEOUT_MS = 120_000;
const BOOT_FILES = [
  "/cloud/linkswift-gm-shim.js",
  "/cloud/baidu-page.js",
  "/cloud/linkswift.bundle.js",
];
const BAIDU_OAUTH_PATH = "/oauth/2.0/authorize";
const LINKSWIFT_INIT = {
  code: "865746",
  license: "AGPL3",
  version: "1.1.4",
} as const;
const RESOURCE_FILES = {
  SwalLigt: "/cloud/vendor/sweetalert2.min.css",
  SwalDark: "/cloud/vendor/sweetalert2-dark.min.css",
} as const;

const FORBIDDEN_REQUEST_HEADERS = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "host",
  "origin",
  "proxy-authorization",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
]);

type Sender = Browser.runtime.MessageSender;

interface CloudFetchRequest {
  url?: unknown;
  method?: unknown;
  headers?: unknown;
  body?: unknown;
  timeout?: unknown;
  responseType?: unknown;
}

interface CloudStorageRequest {
  op?: unknown;
  key?: unknown;
  value?: unknown;
}

interface CloudOpenTabRequest {
  url?: unknown;
}

interface BootResources {
  SwalLigt: string;
  SwalDark: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBaiduOAuthAuthorizeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "openapi.baidu.com"
      && url.pathname === BAIDU_OAUTH_PATH;
  } catch {
    return false;
  }
}

/**
 * 百度的 OAuth 授权会把 access_token 放在最后一级 302 的 Location fragment 里，
 * 而且登录态缺失时中间还会经过 passport 等多级跳转。浏览器的 fetch 不会把
 * fragment 带进 `response.url`，所以这里用 webRequest 监听整条跳转链，
 * 捕获任意一级带 access_token 的 Location。
 *
 * 同时必须保留授权页（200 HTML）正文：未授权过的账号拿不到 token，
 * 页面脚本需要从这份 HTML 里读取 bdstoken/client_id 再自动提交授权。
 * 旧实现只等第一跳并且把正文置空，导致已登录用户也会被判成未登录。
 */
const BAIDU_AUTHORIZE_TIMEOUT_MS = 20_000;
const MAX_BAIDU_AUTHORIZE_BYTES = 2 * 1024 * 1024;
const BAIDU_TOKEN_PATTERN = /[#?&]access_token=([^&#]+)/;

export function baiduTokenFromUrl(value: string): string {
  const match = value.match(BAIDU_TOKEN_PATTERN);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** 只接受百度域返回的令牌跳转，避免任意重定向把伪造令牌交给页面。 */
export function isBaiduTokenUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "openapi.baidu.com" || host.endsWith(".baidu.com");
  } catch {
    return false;
  }
}

async function fetchBaiduAuthorize(
  url: string,
  init: RequestInit,
): Promise<
  | { ok: true; token: string; tokenUrl: string; finalUrl: string; text: string; status: number }
  | { ok: false; error: string }
> {
  let token = "";
  let tokenUrl = "";
  const controller = new AbortController();
  const listener = (details: {
    url?: string;
    method?: string;
    redirectUrl?: string;
  }): void => {
    const target = details.redirectUrl ?? "";
    if (!target || token) return;
    if (!isBaiduTokenUrl(target)) return;
    const found = baiduTokenFromUrl(target);
    if (!found) return;
    token = found;
    tokenUrl = target;
  };
  browser.webRequest.onBeforeRedirect.addListener(listener, {
    urls: ["<all_urls>"],
  });
  const timer = setTimeout(() => controller.abort(), BAIDU_AUTHORIZE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
    });
    if (token) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: true,
        token,
        tokenUrl,
        finalUrl: tokenUrl || response.url || url,
        text: "",
        status: response.status,
      };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, error: `百度授权服务异常（HTTP ${response.status}）` };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html/i.test(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, error: "百度授权服务返回了非 HTML 响应" };
    }
    const bytes = await readResponseBytes(response, MAX_BAIDU_AUTHORIZE_BYTES);
    if (bytes === null) return { ok: false, error: "百度授权页响应过大" };
    return {
      ok: true,
      token: "",
      tokenUrl: "",
      finalUrl: response.url || url,
      text: new TextDecoder().decode(bytes),
      status: response.status,
    };
  } catch (error) {
    if (token) {
      return { ok: true, token, tokenUrl, finalUrl: tokenUrl, text: "", status: 0 };
    }
    return { ok: false, error: `百度授权请求失败：${errorText(error)}` };
  } finally {
    clearTimeout(timer);
    browser.webRequest.onBeforeRedirect.removeListener(listener);
  }
}

function safeStorageKey(key: unknown, vendorId: CloudVendorId): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_STORAGE_KEY_LENGTH) return { ok: false, error: "invalid key" };
  if (/[\u0000-\u001f\u007f]/.test(key)) return { ok: false, error: "invalid key" };
  return { ok: true, value: `${CLOUD_STORAGE_PREFIX}${vendorId}:${key}` };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function headerEntries(value: unknown): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "invalid headers" };
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 64) return { ok: false, error: "too many headers" };
  const result: Record<string, string> = {};
  for (const [name, raw] of entries) {
    if (typeof raw !== "string" || raw.length > 8192 || /[\u0000-\u001f\u007f]/.test(name) || /[\u0000-\u001f\u007f]/.test(raw)) {
      return { ok: false, error: "invalid header" };
    }
    const lower = name.toLowerCase();
    if (FORBIDDEN_REQUEST_HEADERS.has(lower) || lower.startsWith("proxy-") || lower.startsWith("sec-")) continue;
    result[name] = raw;
  }
  return { ok: true, value: result };
}

function senderPage(sender: Sender): { ok: true; tabId: number; pageUrl: string; host: string; vendorId: CloudVendorId } | { ok: false; error: string } {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number" || tabId < 0) return { ok: false, error: "invalid sender tab" };
  if (sender.frameId !== 0) return { ok: false, error: "top frame required" };
  const pageUrl = sender.url;
  const tabUrl = sender.tab?.url;
  if (typeof pageUrl !== "string" || typeof tabUrl !== "string") return { ok: false, error: "invalid sender url" };
  if (!isCloudPageUrl(pageUrl) || !isCloudPageUrl(tabUrl)) return { ok: false, error: "unsupported page" };
  let pageOrigin: string;
  let tabOrigin: string;
  try {
    pageOrigin = new URL(pageUrl).origin;
    tabOrigin = new URL(tabUrl).origin;
  } catch {
    return { ok: false, error: "invalid sender url" };
  }
  if (pageOrigin !== tabOrigin) return { ok: false, error: "sender origin mismatch" };
  const pageVendor = cloudVendorForPage(pageUrl);
  const tabVendor = cloudVendorForPage(tabUrl);
  if (!pageVendor || !tabVendor || pageVendor.id !== tabVendor.id) return { ok: false, error: "sender vendor mismatch" };
  const host = new URL(pageUrl).hostname.toLowerCase();
  if (!host) return { ok: false, error: "unsupported page" };
  return { ok: true, tabId, pageUrl, host, vendorId: pageVendor.id };
}

async function tabStillMatches(tabId: number, pageUrl: string): Promise<boolean> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url || !isCloudPageUrl(tab.url)) return false;
    return new URL(tab.url).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

async function readResponseBytes(
  response: Response,
  limit: number = MAX_RESPONSE_BODY_BYTES,
): Promise<Uint8Array | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) return null;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > limit ? null : bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function responseBodyToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function readBootResources(): Promise<BootResources> {
  const read = async (name: keyof BootResources, path: "/cloud/vendor/sweetalert2.min.css" | "/cloud/vendor/sweetalert2-dark.min.css"): Promise<string> => {
    const response = await fetch(browser.runtime.getURL(path));
    if (!response.ok) throw new Error(`failed to load ${name}: HTTP ${response.status}`);
    const text = await response.text();
    if (!text) throw new Error(`failed to load ${name}: empty resource`);
    return text;
  };
  const [SwalLigt, SwalDark] = await Promise.all([
    read("SwalLigt", RESOURCE_FILES.SwalLigt),
    read("SwalDark", RESOURCE_FILES.SwalDark),
  ]);
  return { SwalLigt, SwalDark };
}

export async function handleCloudInject(
  channelId: unknown,
  sender: Sender,
): Promise<CloudInjectResult> {
  const page = senderPage(sender);
  if (!page.ok) return { ok: false, reason: page.error };
  if (typeof channelId !== "string" || !/^[0-9a-f]{32}$/.test(channelId)) return { ok: false, reason: "invalid channel" };

  try {
    const storagePrefix = `${CLOUD_STORAGE_PREFIX}${page.vendorId}:`;
    const [all, resources] = await Promise.all([browser.storage.local.get(null), readBootResources()]);
    if (!(await tabStillMatches(page.tabId, page.pageUrl))) return { ok: false, reason: "tab navigated" };
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(storagePrefix)) values[key.slice(storagePrefix.length)] = value;
    }
    const autoShareRecord = values[CLOUD_AUTO_SHARE_STORAGE_KEY];
    if (cloudAutoShareMatches(autoShareRecord, page.pageUrl)) {
      values.fluxdown_auto_share = "1";
    }
    const existingInit = values.setting_init;
    values.setting_init = {
      ...(existingInit && typeof existingInit === "object" && !Array.isArray(existingInit)
        ? existingInit as Record<string, unknown>
        : {}),
      ...LINKSWIFT_INIT,
    };
    const boot = {
      channelId,
      values,
      resources,
      expectedOrigin: new URL(page.pageUrl).origin,
      injectedAt: Date.now(),
    } as const;
    await browser.scripting.executeScript({
      target: { tabId: page.tabId, frameIds: [0] },
      world: "MAIN",
      injectImmediately: true,
      func: (data: typeof boot) => {
        if (location.origin !== data.expectedOrigin) return;
        (globalThis as { __FLUXDOWN_LINKSWIFT_BOOT__?: typeof boot }).__FLUXDOWN_LINKSWIFT_BOOT__ = data;
      },
      args: [boot],
    });
    if (!(await tabStillMatches(page.tabId, page.pageUrl))) return { ok: false, reason: "tab navigated" };
    await browser.scripting.executeScript({
      target: { tabId: page.tabId, frameIds: [0] },
      world: "MAIN",
      injectImmediately: true,
      files: BOOT_FILES,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
}

export async function handleCloudFetch(
  request: unknown,
  sender: Sender,
): Promise<CloudFetchResponse> {
  const page = senderPage(sender);
  if (!page.ok) return { ok: false, error: page.error };
  if (!request || typeof request !== "object" || Array.isArray(request)) return { ok: false, error: "invalid request" };
  const input = request as CloudFetchRequest;
  if (typeof input.url !== "string" || !isAllowedFetchUrlForPage(page.pageUrl, input.url)) return { ok: false, error: "url not allowed" };
  const method = typeof input.method === "string" ? input.method.toUpperCase() : "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) return { ok: false, error: "method not allowed" };
  const headers = headerEntries(input.headers);
  if (!headers.ok) return { ok: false, error: headers.error };
  if (input.body !== undefined && typeof input.body !== "string") return { ok: false, error: "invalid body" };
  if (typeof input.body === "string" && byteLength(input.body) > MAX_REQUEST_BODY_BYTES) return { ok: false, error: "body too large" };
  const timeout = typeof input.timeout === "number" && Number.isFinite(input.timeout)
    ? Math.min(Math.max(input.timeout, 1), MAX_FETCH_TIMEOUT_MS)
    : 30_000;
  const responseType = input.responseType === "json" || input.responseType === "text" || input.responseType === "blob" || input.responseType === "arraybuffer"
    ? input.responseType
    : "text";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const init: RequestInit = {
      method,
      headers: headers.value,
      body: method === "GET" || method === "HEAD" ? undefined : input.body,
      credentials: "include",
      signal: controller.signal,
    };
    if (page.vendorId === "baidu" && isBaiduOAuthAuthorizeUrl(input.url)) {
      const captured = await fetchBaiduAuthorize(input.url, init);
      if (!captured.ok) return captured;
      return {
        ok: true,
        status: captured.status || 200,
        statusText: "OK",
        responseText: captured.token ? "" : captured.text,
        response: null,
        responseB64: "",
        mime: "text/html",
        finalUrl: captured.token ? captured.tokenUrl : input.url,
        headers: [],
      };
    }
    const response = await fetch(input.url, {
      ...init,
      redirect: "error",
    });
    if (response.url && !isAllowedFetchUrlForPage(page.pageUrl, response.url)) {
      return { ok: false, error: "redirect not allowed" };
    }
    const bytes = await readResponseBytes(response);
    if (bytes === null) return { ok: false, error: "response too large" };
    const text = new TextDecoder().decode(bytes);
    const responseHeaders: [string, string][] = [];
    response.headers.forEach((value, name) => responseHeaders.push([name, value]));
    let parsed: unknown = text;
    if (responseType === "json") {
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
    }
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      responseText: text,
      response: parsed,
      responseB64: responseType === "blob" || responseType === "arraybuffer" ? responseBodyToBase64(bytes) : "",
      mime: response.headers.get("content-type") ?? "",
      finalUrl: response.url,
      headers: responseHeaders,
    };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleCloudStorage(
  request: unknown,
  sender: Sender,
): Promise<CloudStorageResult> {
  const page = senderPage(sender);
  if (!page.ok) return { ok: false, error: page.error };
  if (!request || typeof request !== "object" || Array.isArray(request)) return { ok: false, error: "invalid request" };
  const input = request as CloudStorageRequest;
  if (input.op !== "get" && input.op !== "set" && input.op !== "delete") return { ok: false, error: "invalid op" };
  const key = safeStorageKey(input.key, page.vendorId);
  if (!key.ok) return { ok: false, error: key.error };
  try {
    if (input.op === "get") {
      const stored = await browser.storage.local.get(key.value);
      return { ok: true, value: stored[key.value] };
    }
    if (input.op === "delete") {
      await browser.storage.local.remove(key.value);
      return { ok: true };
    }
    if (byteLength(JSON.stringify(input.value ?? null)) > MAX_STORAGE_VALUE_BYTES) return { ok: false, error: "value too large" };
    await browser.storage.local.set({ [key.value]: input.value ?? null });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function handleCloudOpenTab(
  request: unknown,
  sender: Sender,
): Promise<CloudOpenTabResult> {
  const page = senderPage(sender);
  if (!page.ok) return { ok: false, error: page.error };
  if (!request || typeof request !== "object" || Array.isArray(request)) return { ok: false, error: "invalid request" };
  const url = (request as CloudOpenTabRequest).url;
  if (typeof url !== "string" || !isAllowedOpenTabUrlForPage(page.pageUrl, url)) return { ok: false, error: "url not allowed" };
  try {
    await browser.tabs.create({ url, active: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}

export async function handleCloudDownload(
  request: unknown,
  sender: Sender,
): Promise<CloudDownloadResult> {
  const page = senderPage(sender);
  if (!page.ok) return { ok: false, success: false, sent: 0, failed: 0, error: page.error };
  if (!request || typeof request !== "object" || Array.isArray(request)) return { ok: false, success: false, sent: 0, failed: 0, error: "invalid request" };
  const items = (request as Partial<CloudDownloadRequestPayload>).items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return { ok: false, success: false, sent: 0, failed: 0, error: "invalid items" };
  try {
    const result = await downloadCloudItems(items, page.tabId, page.pageUrl);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, success: false, sent: 0, failed: 0, error: errorText(error) };
  }
}

/**
 * 页面侧读取 123 云盘分享目录，并调用官方分享直链接口。
 *
 * 运行在 MAIN world：目录来自 React 表格的 dataSource；直链来自
 * `api.123pan.cn/api/v2/share/download/info`，凭据取自页面自身的
 * `authorToken` / `LoginUuid`。扩展不保存、不上传这些凭据。
 */
async function cloudPageScript(op: string, id: string) {
  type Row = Record<string, unknown>;
  type Props = Record<string, unknown> & {
    dataSource?: Row[];
    onClick?: (event: unknown) => void;
  };
  type Fiber = {
    return?: Fiber | null;
    pendingProps?: Props | null;
    memoizedProps?: Props | null;
  } | null;

  const fail = (error: string) => ({ ok: false, error });
  const asText = (value: unknown): string => (typeof value === "string" ? value : "");
  const asNumber = (value: unknown): number => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  if (location.hostname === "pan.baidu.com" || location.hostname === "yun.baidu.com") {
    type BaiduPageApi = {
      list?: () => Promise<CloudPageResult>;
      open?: (fileId: string) => Promise<CloudPageResult>;
      up?: () => Promise<CloudPageResult>;
      download?: (fileId: string) => Promise<CloudPageResult>;
    };
    let api: BaiduPageApi | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      api = (window as unknown as { __FLUXDOWN_BAIDU_PAGE__?: BaiduPageApi }).__FLUXDOWN_BAIDU_PAGE__;
      if (api) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!api) return fail("百度页面脚本尚未就绪，请刷新页面后重试");
    try {
      if (op === "list") return await api.list?.();
      if (op === "open") return await api.open?.(id);
      if (op === "up") return await api.up?.();
      if (op === "download") return await api.download?.(id);
      return fail("未知操作");
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  const fiberOf = (element: Element): Fiber => {
    const key = Object.keys(element).find((name) => name.startsWith("__reactFiber"));
    if (!key) return null;
    return (element as unknown as Record<string, Fiber | undefined>)[key] ?? null;
  };

  const tableProps = (): Props | null => {
    const root = document.querySelector<HTMLElement>('[class^="mfy_h-table-module__shell__"]');
    if (!root) return null;
    let fiber = fiberOf(root);
    for (let depth = 0; fiber && depth < 30; depth++) {
      const props = fiber.pendingProps ?? fiber.memoizedProps;
      if (props && Array.isArray(props.dataSource)) return props;
      fiber = fiber.return ?? null;
    }
    return null;
  };

  const rows = (): Row[] => {
    const props = tableProps();
    return props && Array.isArray(props.dataSource) ? props.dataSource : [];
  };

  const visibleBreadcrumb = (): Element[] => {
    const blocks = Array.from(document.querySelectorAll<HTMLElement>('[class*="breadcrumb"]'))
      .filter((block) => block.getClientRects().length > 0);
    let best: Element[] = [];
    for (const block of blocks) {
      // 只认直接子级 li：外层容器会同时包住桌面/移动两份面包屑，不能用后代查询。
      const items = Array.from(block.children).filter((child) => child.tagName === "LI");
      if (items.length > 0 && items.length >= best.length) best = items;
    }
    return best;
  };

  const listSnapshot = () => {
    const items = rows()
      .filter((row) => asNumber(row.FileId) > 0 && asText(row.FileName) !== "")
      .map((row) => ({
        id: String(row.FileId),
        name: asText(row.FileName),
        size: asNumber(row.Size),
        isDir: asNumber(row.Type) === 1,
      }));
    const path = visibleBreadcrumb()
      .map((item) => (item.textContent ?? "").trim())
      .filter(Boolean);
    return { ok: true as const, items, path, canUp: path.length > 1 };
  };

  const findRow = (rowId: string): Row | null =>
    rows().find((row) => String(row.FileId ?? "") === rowId) ?? null;

  const clickReact = (element: Element): boolean => {
    let fiber = fiberOf(element);
    for (let depth = 0; fiber && depth < 15; depth++) {
      const props = fiber.pendingProps ?? fiber.memoizedProps;
      if (props && typeof props.onClick === "function") {
        props.onClick(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
        return true;
      }
      fiber = fiber.return ?? null;
    }
    return false;
  };

  const fileNameElement = (name: string): Element | null => {
    const spans = Array.from(document.querySelectorAll("span"));
    return spans.find(
      (span) => span.classList.contains("table-file-name") && (span.textContent ?? "").trim() === name,
    ) ?? null;
  };

  const signature = (): string => rows().map((row) => String(row.FileId ?? "")).join(",");
  const breadcrumbLast = (): string => {
    const items = visibleBreadcrumb();
    return items.length > 0 ? (items[items.length - 1].textContent ?? "").trim() : "";
  };
  const waitFor = async (check: () => boolean, timeout = 3000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return check();
  };

  if (op === "list") return listSnapshot();

  if (op === "open") {
    const row = findRow(id);
    if (!row) return fail("未找到该文件夹");
    if (asNumber(row.Type) !== 1) return fail("该项不是文件夹");
    const name = asText(row.FileName);
    const element = fileNameElement(name);
    if (!element || !clickReact(element)) return fail("未找到文件夹入口");
    const beforeSignature = signature();
    const beforeDepth = visibleBreadcrumb().length;
    const changed = await waitFor(
      () => breadcrumbLast() === name || (signature() !== beforeSignature && visibleBreadcrumb().length > beforeDepth),
    );
    if (!changed) return fail("打开文件夹超时，请重试");
    return listSnapshot();
  }

  if (op === "up") {
    const items = visibleBreadcrumb();
    if (items.length < 2) return fail("已经是最顶层");
    const target = items[items.length - 2];
    const element = target.querySelector("a") ?? target.querySelector("span") ?? target;
    if (!clickReact(element)) return fail("未找到返回入口");
    const beforeDepth = items.length;
    const changed = await waitFor(() => visibleBreadcrumb().length < beforeDepth);
    if (!changed) return fail("返回上级超时，请重试");
    return listSnapshot();
  }

  return (async () => {
    if (op !== "download") return fail("未知操作");
    const row = findRow(id);
    if (!row) return fail("未找到该文件，请刷新目录后重试");
    if (asNumber(row.Type) !== 0) return fail("文件夹不能直接下载，请进入文件夹后选择文件");

    const unwrap = (raw: string | null): string => {
      if (!raw) return "";
      try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "string" ? parsed : raw;
      } catch {
        return raw;
      }
    };
    const token = unwrap(localStorage.getItem("authorToken"));
    if (!token) return fail("需要先登录 123 云盘，登录后返回本页重试");
    const uuid = unwrap(localStorage.getItem("LoginUuid"));
    const shareKey = location.pathname.split("/").filter(Boolean).pop() ?? "";
    if (!shareKey) return fail("未识别到分享标识");

    const body = {
      ShareKey: shareKey,
      FileID: asNumber(row.FileId),
      S3keyFlag: asText(row.S3KeyFlag),
      Size: asNumber(row.Size),
      Etag: asText(row.Etag),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch("https://api.123pan.cn/api/v2/share/download/info", {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json; charset=UTF-8",
          Authorization: `Bearer ${token}`,
          Platform: "web",
          Platform_os: "123pan/v323(Windows10.0.26200)",
          "App-Version": "323",
          LoginUuid: uuid,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      return fail("无法连接 123 云盘接口，请检查网络后重试");
    }
    clearTimeout(timer);

    if (response.status === 401 || response.status === 403) {
      return fail("登录已过期，请重新登录 123 云盘后重试");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return fail("网盘返回了无法解析的数据");
    }
    const result = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const data = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : null;
    const downloadPath = typeof data?.downloadPath === "string" ? data.downloadPath : "";
    if (result.code === 0 && data && downloadPath) {
      const dispatchList = Array.isArray(data.dispatchList) ? data.dispatchList : [];
      const first = dispatchList[0] && typeof dispatchList[0] === "object"
        ? (dispatchList[0] as Record<string, unknown>)
        : null;
      const prefix = typeof first?.prefix === "string" ? first.prefix : "";
      let url = `${prefix}${downloadPath}`;
      try {
        const params = new URL(url).searchParams.get("params");
        if (params) {
          let decoded = params;
          try { decoded = decodeURIComponent(decoded); } catch { /* 保持原值 */ }
          try { decoded = atob(decoded); } catch { /* 保持原值 */ }
          try { decoded = decodeURIComponent(escape(decoded)); } catch { /* 保持原值 */ }
          url = decoded;
        }
      } catch {
        /* 地址已经是可直接使用的形式 */
      }
      return { ok: true, url, filename: asText(row.FileName), size: asNumber(row.Size) };
    }

    const code = asNumber(result.code);
    const serverMessage = asText(result.message);
    if (code === 5112) return fail("需要先登录 123 云盘，登录后返回本页重试");
    if (code === 5113) return fail("本月免费流量不足，网盘要求开通会员");
    return fail(serverMessage || "获取下载地址失败，请稍后重试");
  })();
}

export async function handleCloudPage(
  request: unknown,
  sender: Sender,
): Promise<CloudPageResult> {
  const page = senderPage(sender);
  if (!page.ok) return { ok: false, error: page.error };
  if (page.vendorId !== "pan123" && page.vendorId !== "baidu") {
    return { ok: false, error: "该网盘暂不支持在悬浮窗浏览目录" };
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return { ok: false, error: "invalid request" };
  }
  const input = request as Partial<CloudPageRequest>;
  if (input.op !== "list" && input.op !== "open" && input.op !== "up" && input.op !== "download") {
    return { ok: false, error: "invalid op" };
  }
  const id = typeof input.id === "string" ? input.id : "";
  if ((input.op === "open" || input.op === "download") && !/^\d{1,20}$/.test(id)) {
    return { ok: false, error: "invalid file id" };
  }

  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: page.tabId, frameIds: [0] },
      world: "MAIN",
      injectImmediately: true,
      func: cloudPageScript,
      args: [input.op, id],
    });
    const result = results[0]?.result as CloudPageResult | undefined;
    if (!result || typeof result !== "object") return { ok: false, error: "页面未返回目录数据" };
    if (!result.ok) return result;
    if (input.op !== "download") return result;

    if (typeof result.url !== "string" || !isAllowedDownloadUrlForPage(page.pageUrl, result.url)) {
      return { ok: false, error: "网盘返回的下载地址不在允许的域名内" };
    }
    const download = await downloadCloudItems(
      [{
        url: result.url,
        filename: typeof result.filename === "string" ? result.filename : undefined,
        size: typeof result.size === "number" ? result.size : undefined,
        headers: result.headers && typeof result.headers === "object" ? result.headers : undefined,
        referrer: page.pageUrl,
      }],
      page.tabId,
      page.pageUrl,
    );
    if (!download.success) {
      return { ok: false, sent: download.sent, failed: download.failed, error: download.message ?? "发送到 FluxDown 失败" };
    }
    return { ok: true, sent: download.sent, failed: download.failed, message: download.message };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
}
