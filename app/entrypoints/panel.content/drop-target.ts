import type { CandidateRow, TabView } from "@/background/protocol";
import { isCloudSharePageUrl } from "@/utils/cloud-sites";
import { isP2PLink } from "@/utils/link-protocols";
import { bestCandidateVariant } from "@/utils/media-candidates";
import { upgradeXImageUrl } from "@/utils/x-image";
import { xVideoThumbMediaId } from "@/utils/x-media";

export type DropTarget =
  | { kind: "media"; url: string | null; tag: string; element: Element; mediaId: string | null }
  | { kind: "image"; url: string; tag: string; element: Element }
  | { kind: "file"; url: string; tag: string; element: Element }
  | { kind: "share"; url: string; code: string | null; tag: string; element: Element }
  | { kind: "none"; reason: string };

export interface DropCandidate {
  row: CandidateRow;
  variantId: string | null;
  reason: "protected" | "browserOnly" | null;
}

const FILE_PAGE_PATTERN = /\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|rtf|epub|mobi|azw3?|zip|rar|7z|gz|bz2|xz|tar|iso|dmg|apk|exe|msi|deb|rpm|mp3|m4a|aac|flac|wav|ogg|opus|mp4|m4v|mov|webm|mkv|avi|torrent)(?:$|[?#])/i;
const LINK_FILE_PATTERN = /\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|rtf|epub|mobi|azw3?|zip|rar|7z|gz|bz2|xz|tar|iso|dmg|apk|exe|msi|deb|rpm|mp3|m4a|aac|flac|wav|ogg|opus|mp4|m4v|mov|webm|mkv|avi|torrent|m3u8?|mpd)(?:$|[?#])/i;
const IMAGE_URL_PATTERN = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|ico)(?:$|[?#])/i;
const LAZY_IMAGE_ATTRS = ["data-src", "data-original", "data-lazy-src"] as const;
const CODE_QUERY_KEYS = ["pwd", "passcode", "codes"] as const;
const CODE_TEXT_PATTERN = /(?:提取码|提取碼|访问码|訪問碼|访问密码|密码|密碼)\s*[:：]?\s*([0-9a-zA-Z]{4,8})/;
const TEXT_SCAN_LIMIT = 4000;

/** 仅接受可交给下载引擎的 http(s) 绝对地址；相对地址按 base 解析。 */
export function normalizeHttpUrl(raw: string | null | undefined, base?: string): string | null {
  const value = raw?.trim();
  if (!value || value.startsWith("#")) return null;
  let parsed: URL;
  try {
    parsed = base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  if (base) {
    const page = new URL(base);
    if (page.protocol === "http:" || page.protocol === "https:") {
      if (parsed.href.split("#")[0] === page.href.split("#")[0]) return null;
    }
  }
  return parsed.href;
}

function allRows(view: TabView | null): CandidateRow[] {
  if (!view) return [];
  return [...view.playing, ...view.otherElements, ...view.unbound];
}

function isDownloadable(row: CandidateRow): boolean {
  const candidate = row.candidate;
  return candidate.downloadable === true && candidate.protected !== true && candidate.browserOnly !== true;
}

function blocker(row: CandidateRow): "protected" | "browserOnly" | null {
  if (row.candidate.protected === true) return "protected";
  if (row.candidate.browserOnly === true) return "browserOnly";
  return null;
}

function defaultVariantId(row: CandidateRow): string | null {
  return row.playingVariantId ?? bestCandidateVariant(row.candidate)?.id ?? null;
}

function urlsMatch(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname === right.pathname;
  } catch {
    return a === b;
  }
}

function rowMatchesMedia(row: CandidateRow, mediaUrl: string): boolean {
  return row.candidate.variants.some(
    (variant) =>
      urlsMatch(variant.videoUrl, mediaUrl) ||
      (variant.audioUrl ? urlsMatch(variant.audioUrl, mediaUrl) : false),
  );
}

const X_VIDEO_PATH_ID = /\/(?:amplify_video|ext_tw_video|tweet_video)\/([A-Za-z0-9_-]+)(?:\/|\.|$)/;

function variantMediaId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname !== "video.twimg.com") return null;
    return X_VIDEO_PATH_ID.exec(url.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 候选的任一视频/音频轨是否属于该 X 媒体 ID。 */
function rowMatchesMediaId(row: CandidateRow, mediaId: string): boolean {
  return row.candidate.variants.some(
    (variant) => variantMediaId(variant.videoUrl) === mediaId || variantMediaId(variant.audioUrl) === mediaId,
  );
}

function pickRow(view: TabView | null, filter: (row: CandidateRow) => boolean): CandidateRow | null {
  return allRows(view).find(filter) ?? null;
}

/**
 * 为媒体落点选择候选：先按 videoUrl / audioUrl 匹配，再按活动元素，最后退到第一个可下载候选。
 * 全部候选都不可下载时返回第一个受保护 / 仅限浏览器的候选，供 UI 显示对应提示。
 */
export function selectDropCandidate(
  view: TabView | null,
  mediaUrl: string | null,
  elementKey: string | null = null,
  mediaIdHint: string | null = null,
): DropCandidate | null {
  const rows = allRows(view);
  if (rows.length === 0) return null;
  const downloadable = rows.filter(isDownloadable);
  // 封面图落点：只接受 mediaId 精确匹配，宁可提示「先播放」，也不下错视频。
  const byMediaId = mediaIdHint ? downloadable.filter((row) => rowMatchesMediaId(row, mediaIdHint)) : [];
  if (mediaIdHint) {
    if (byMediaId[0]) return { row: byMediaId[0], variantId: defaultVariantId(byMediaId[0]), reason: null };
    const blocked = rows.find((item) => rowMatchesMediaId(item, mediaIdHint) && blocker(item) !== null);
    if (blocked) return { row: blocked, variantId: defaultVariantId(blocked), reason: blocker(blocked) };
    return null;
  }
  const byUrl = mediaUrl && mediaUrl !== "blob:" ? downloadable.filter((row) => rowMatchesMedia(row, mediaUrl)) : [];
  const exact = elementKey ? downloadable.filter((row) => row.elementKey === elementKey) : [];
  const activeKey = view?.activeElementKey;
  const active = activeKey ? downloadable.filter((row) => row.elementKey === activeKey) : [];
  const row = byMediaId[0] ?? byUrl[0] ?? exact[0] ?? active[0] ?? downloadable[0] ?? null;
  if (row) return { row, variantId: defaultVariantId(row), reason: null };
  const blocked = rows.find((item) => blocker(item) !== null);
  if (!blocked) return null;
  return { row: blocked, variantId: defaultVariantId(blocked), reason: blocker(blocked) };
}

function isFluxDownHost(element: Element | null): boolean {
  return element?.localName === "fluxdown-panel";
}

function deepElementAt(x: number, y: number, doc: Document): Element | null {
  let root: Document | ShadowRoot = doc;
  let element: Element | null = null;
  for (let depth = 0; depth < 32; depth += 1) {
    const next: Element | null = root.elementFromPoint(x, y);
    if (!next) return element;
    if (isFluxDownHost(next)) return null;
    element = next;
    if (!next.shadowRoot) return element;
    root = next.shadowRoot;
  }
  return element;
}

function closestTarget(element: Element | null): Element | null {
  return element?.closest("video, audio, img, a[href], iframe[src], embed[src], object[data]") ?? null;
}

function containsPoint(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * 指针下的媒体元素：按矩形命中，而不是只看 `elementFromPoint` 的祖先链。
 * X / 微博 / 多数视频站都会在 `<video>` 上盖一层透明的控制层或点击层，
 * `elementFromPoint` 返回的是覆盖层，`closest()` 又走不到兄弟节点里的 video，
 * 小球就会把「拖到视频上」判成无效落点。
 */
function mediaAtPoint(x: number, y: number, doc: Document): HTMLMediaElement | null {
  let best: { el: HTMLMediaElement; area: number } | null = null;
  for (const el of doc.querySelectorAll("video,audio")) {
    const media = el as HTMLMediaElement;
    const rect = media.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 30 || !containsPoint(rect, x, y)) continue;
    const area = rect.width * rect.height;
    if (!best || area < best.area) best = { el: media, area };
  }
  return best?.el ?? null;
}

/** 被覆盖层挡住的大图（帖内预览图、卡片图）。小图标不参与，避免抢走链接落点。 */
function imageAtPoint(x: number, y: number, doc: Document): HTMLImageElement | null {
  let best: { el: HTMLImageElement; area: number } | null = null;
  for (const el of doc.querySelectorAll("img")) {
    const img = el as HTMLImageElement;
    const rect = img.getBoundingClientRect();
    if (rect.width < 48 || rect.height < 48 || !containsPoint(rect, x, y)) continue;
    const area = rect.width * rect.height;
    if (!best || area < best.area) best = { el: img, area };
  }
  return best?.el ?? null;
}

function mediaUrl(element: HTMLMediaElement): string | null {
  const raw = element.currentSrc || element.getAttribute("src") || "";
  const normalized = normalizeHttpUrl(raw, element.ownerDocument.baseURI);
  return normalized ?? (raw.trim().startsWith("blob:") ? "blob:" : null);
}

/** 媒体元素及其封面里可用的 X 媒体 ID（未播放的 X 视频只有封面）。 */
function mediaDropTarget(element: HTMLMediaElement): DropTarget {
  const poster = element.getAttribute("poster");
  return {
    kind: "media",
    url: mediaUrl(element),
    tag: element.localName,
    element,
    mediaId: poster ? xVideoThumbMediaId(poster) : null,
  };
}

/** 图片落点：X 视频封面不当作图片，转成对应视频的落点。 */
function imageDropTarget(url: string, img: HTMLImageElement): DropTarget {
  const mediaId = xVideoThumbMediaId(url);
  if (mediaId) return { kind: "media", url: null, tag: "img", element: img, mediaId };
  return { kind: "image", url, tag: "img", element: img };
}

function attributeUrl(element: Element, name: string): string | null {
  return normalizeHttpUrl(element.getAttribute(name), element.ownerDocument.baseURI);
}

/** 从 srcset 候选里选最大宽度档；无 w 描述符按 0 宽参与比较。 */
function largestSrcsetUrl(raw: string | null | undefined, base?: string): string | null {
  if (!raw) return null;
  let best: { url: string; width: number } | null = null;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [url, ...descriptors] = trimmed.split(/\s+/);
    let width = 0;
    for (const descriptor of descriptors) {
      if (descriptor.endsWith("w")) {
        const parsed = Number.parseFloat(descriptor);
        if (Number.isFinite(parsed)) width = Math.max(width, parsed);
      }
    }
    if (!best || width > best.width) best = { url, width };
  }
  return best ? normalizeHttpUrl(best.url, base) : null;
}

export const upgradeImageUrl = upgradeXImageUrl;

/** 图片地址解析：currentSrc/src → srcset 最大档 → picture source → 懒加载属性 → 外层 a 的图片链接。 */
export function pickImageUrl(img: HTMLImageElement): string | null {
  const raw = pickRawImageUrl(img);
  return raw ? upgradeImageUrl(raw) : null;
}

function pickRawImageUrl(img: HTMLImageElement): string | null {
  const base = img.ownerDocument.baseURI;
  // srcset 描述符是页面声明的清晰度，优先取最大档（currentSrc 可能只是首屏小图）。
  const imgSrcset = largestSrcsetUrl(img.getAttribute("srcset"), base);
  if (imgSrcset) return imgSrcset;
  const source = img.closest("picture")?.querySelector("source[srcset]");
  const sourceSrcset = largestSrcsetUrl(source?.getAttribute("srcset"), base);
  if (sourceSrcset) return sourceSrcset;
  for (const attr of LAZY_IMAGE_ATTRS) {
    const lazy = normalizeHttpUrl(img.getAttribute(attr), base);
    if (lazy) return lazy;
  }
  const direct = normalizeHttpUrl(img.currentSrc || img.getAttribute("src"), base);
  if (direct) return direct;
  const lazySrcset = largestSrcsetUrl(img.getAttribute("data-srcset"), base);
  if (lazySrcset) return lazySrcset;
  const href = normalizeHttpUrl(img.closest("a[href]")?.getAttribute("href"), base);
  return href && IMAGE_URL_PATTERN.test(href) ? href : null;
}

function extractShareCode(url: string, text: string): string | null {
  try {
    const query = new URL(url).searchParams;
    for (const key of CODE_QUERY_KEYS) {
      const value = query.get(key);
      if (value && /^[0-9a-zA-Z]{4,8}$/.test(value)) return value;
    }
  } catch {
    return null;
  }
  return text.match(CODE_TEXT_PATTERN)?.[1] ?? null;
}

/** 网盘分享链接：厂商域名 + 该厂商真实分享路径。 */
export function cloudShareUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!isCloudSharePageUrl(url.href)) return null;
    return url.origin + url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** 文本里的链接可能没有协议头（网盘分享常见），这里补上再解析。 */
const TEXT_URL_PATTERN = /(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?\/[^\s"'<>）)】]+/gi;
const P2P_TEXT_PATTERNS = [
  /magnet:\?[^\s"'<>）)】]+/i,
  /ed2k:\/\/\|file\|[^|\s]+\|\d+\|[0-9a-f]{32}\|\/?/i,
  /thunder:\/\/[A-Za-z0-9+/=_-]+/i,
  /115:\/\/[^\s"'<>）)】]+/i,
] as const;

/** 从元素文本里找第一条网盘分享链接及其提取码。 */
function shareFromText(element: Element): { url: string; code: string | null } | null {
  const text = (element.textContent ?? "").slice(0, TEXT_SCAN_LIMIT);
  for (const match of text.matchAll(TEXT_URL_PATTERN)) {
    const candidate = match[0].replace(/[.,;:：，。；、)）\]】]+$/, "");
    const url = cloudShareUrl(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    if (url) return { url, code: extractShareCode(url, text) };
  }
  return null;
}

/** 从元素文本里找第一条 magnet / ed2k / thunder / 115 链接。 */
function p2pFromText(element: Element): string | null {
  const text = (element.textContent ?? "").slice(0, TEXT_SCAN_LIMIT);
  for (const pattern of P2P_TEXT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

function isSamePageFilePage(doc: Document): boolean {
  const href = normalizeHttpUrl(doc.location?.href);
  return href !== null && FILE_PAGE_PATTERN.test(href);
}

/** 按媒体 → 图片 → 文件链接 → 当前文件页的顺序识别落点；递归穿透开放 Shadow DOM。 */
export function resolveDropTargetAt(x: number, y: number, doc: Document = document): DropTarget {
  const element = deepElementAt(x, y, doc);
  if (!element) return { kind: "none", reason: "no-element" };
  const target = closestTarget(element);
  const tag = target?.localName ?? element.localName;

  if (target?.localName === "video" || target?.localName === "audio") {
    return mediaDropTarget(target as HTMLMediaElement);
  }

  // 覆盖层命中的情况：先找指针矩形内的视频，再找大图，最后才按普通链接处理。
  const coveredMedia = mediaAtPoint(x, y, doc);
  if (coveredMedia) return mediaDropTarget(coveredMedia);

  const coveredImage =
    target?.localName === "button" || target?.localName === "input" ? null : imageAtPoint(x, y, doc);
  if (coveredImage && target?.localName !== "img") {
    const url = pickImageUrl(coveredImage);
    if (url) return imageDropTarget(url, coveredImage);
  }

  if (target?.localName === "img") {
    const img = target as HTMLImageElement;
    const url = pickImageUrl(img);
    return url ? imageDropTarget(url, img) : { kind: "none", reason: "unsafe-image-url" };
  }

  if (target) {
    const rawHref = (target.getAttribute("href") ?? "").trim();
    if (target.localName === "a" && isP2PLink(rawHref)) {
      return { kind: "file", url: rawHref, tag: "a", element: target };
    }
    const rawName = target.localName === "a" ? "href" : target.localName === "object" ? "data" : "src";
    const url = attributeUrl(target, rawName);
    if (target.localName === "a" && url) {
      const shareUrl = cloudShareUrl(url);
      if (shareUrl) {
        const code = extractShareCode(shareUrl, target.textContent ?? "");
        return { kind: "share", url: shareUrl, code, tag: "a", element: target };
      }
    }
    if (url && (LINK_FILE_PATTERN.test(url) || target.hasAttribute("download"))) {
      return { kind: "file", url, tag: target.localName, element: target };
    }
    return { kind: "none", reason: "unsafe-link" };
  }

  const fromText = shareFromText(element);
  if (fromText) return { kind: "share", url: fromText.url, code: fromText.code, tag: "text", element };

  const p2p = p2pFromText(element);
  if (p2p) return { kind: "file", url: p2p, tag: "text", element };

  const page = normalizeHttpUrl(doc.location?.href);
  if (page && isSamePageFilePage(doc)) return { kind: "file", url: page, tag: "page", element };
  return { kind: "none", reason: "no-target" };
}
