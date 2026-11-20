/**
 * DOM 资源扫描（ISOLATED world，sensor 使用）：<video>/<audio>/<source>/<track>/<a>/<embed>/<object>
 * 的资源识别、声明式 dom 规则取值、链接收集。分类一律由调用方传入的规则引擎 `classify` 给出。
 */
import type { PageLink } from "@/background/protocol";
import type { DetectionMethod, ResourceMessagePayload, ResourceType } from "@/utils/resource-types";
import { isP2PLink, parseP2PName } from "@/utils/link-protocols";

export interface ScanContext {
  /** 规则引擎的 classify(url)。 */
  classify(url: string): ResourceType;
  /** sniffImages 开启时图片链接也算可下载。 */
  sniffImages: boolean;
  /** 媒体元素 key（<track> 归属用）。 */
  keyOf(el: Element): string | undefined;
}

/** 常见下载路径关键词（无扩展名的下载链接识别）。 */
const DOWNLOAD_PATH_KEYWORDS = [
  "/download",
  "/get/",
  "/fetch/",
  "/file/",
  "/files/",
  "/attachment",
  "/export",
  "/dl/",
  "/release/",
];

/** 属性值需要按文档基址解析的 URL 型属性。 */
const URL_ATTRS = new Set(["href", "src", "data", "poster", "action", "currentSrc"]);

export const SCAN_SELECTOR = [
  "video",
  "audio",
  "source",
  "track[src]",
  "a[href]",
  "area[href]",
  "embed",
  "object",
  "img",
  "link[rel]",
  "meta[property]",
  "meta[name]",
].join(", ");

function isInlineUrl(url: string): boolean {
  return url.startsWith("blob:") || url.startsWith("data:");
}

export function parseMagnetDisplayName(magnetUri: string): string | undefined {
  return parseP2PName(magnetUri);
}

/** 属性变化只对媒体类 / 可下载类元素有意义，缩小 MutationObserver 属性分支的处理面。 */
export function isMediaishElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (
    tag === "video" ||
    tag === "audio" ||
    tag === "source" ||
    tag === "track" ||
    tag === "embed" ||
    tag === "object" ||
    tag === "img" ||
    tag === "link" ||
    tag === "meta"
  ) {
    return true;
  }
  return (tag === "a" || tag === "area") && el.hasAttribute("href");
}

/** 解析 srcset，取面积 / 倍率最大的一张（相对地址按文档基址解析）。 */
export function largestSrcsetUrl(srcset: string | null | undefined): string | undefined {
  if (!srcset) return undefined;
  let best: { url: string; score: number } | undefined;
  for (const part of srcset.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [rawUrl, ...descriptors] = trimmed.split(/\s+/);
    if (!rawUrl) continue;
    let score = 0;
    for (const descriptor of descriptors) {
      const width = /^(\d+)w$/i.exec(descriptor);
      if (width) score = Math.max(score, Number(width[1]));
      const density = /^([\d.]+)x$/i.exec(descriptor);
      if (density) score = Math.max(score, Number(density[1]) * 1000);
    }
    if (!best || score > best.score) best = { url: rawUrl, score };
  }
  return best?.url;
}

/** 相对地址 → 绝对地址；非法返回 undefined。 */
function absoluteUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw, document.baseURI).href;
  } catch {
    return undefined;
  }
}

function isDownloadableLink(url: string, ctx: ScanContext): boolean {
  const type = ctx.classify(url);
  if (type !== "other" && (type !== "image" || ctx.sniffImages)) return true;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return DOWNLOAD_PATH_KEYWORDS.some((k) => pathname.includes(k));
  } catch {
    return false;
  }
}

function mediaTypeOfMime(mime: string | undefined): ResourceType {
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  return "other";
}

function qualityOf(video: HTMLVideoElement): string | undefined {
  return video.videoHeight > 0 ? `${video.videoHeight}p` : undefined;
}

function trackResource(track: HTMLTrackElement, by: DetectionMethod, ctx: ScanContext): ResourceMessagePayload {
  const parent = track.parentElement;
  return {
    url: track.src,
    type: "subtitle",
    filename: track.label ? `${track.label}${track.srclang ? `.${track.srclang}` : ""}.vtt` : undefined,
    detectedBy: by,
    lang: track.srclang || undefined,
    label: track.label || undefined,
    elementKey: parent ? ctx.keyOf(parent) : undefined,
  };
}

function anchorResource(a: HTMLAnchorElement, by: DetectionMethod, ctx: ScanContext): ResourceMessagePayload | null {
  // P2P 协议（ed2k/thunder/115）没有标准 URL 语义，`a.href` 可能被改写成别的形式，
  // 先看原始属性。
  const rawHref = (a.getAttribute("href") ?? "").trim();
  if (isP2PLink(rawHref)) {
    return { url: rawHref, type: "magnet", filename: parseP2PName(rawHref), detectedBy: by };
  }
  const href = a.href;
  if (!href || isInlineUrl(href) || href.startsWith("javascript:") || href.startsWith("#")) return null;
  if (!href.startsWith("http://") && !href.startsWith("https://") && !href.startsWith("ftp://")) return null;
  if (!a.download && !isDownloadableLink(href, ctx)) return null;
  return { url: href, type: ctx.classify(href), filename: a.download || undefined, detectedBy: by };
}

/** 图片元素：优先取 srcset 里最大的一张，其次懒加载原图，最后 currentSrc/src。 */
function imageResource(img: HTMLImageElement, by: DetectionMethod): ResourceMessagePayload | null {
  const width = img.naturalWidth || Number(img.getAttribute("width")) || 0;
  const height = img.naturalHeight || Number(img.getAttribute("height")) || 0;
  // 已知道尺寸的小图直接跳过（头像、图标、表情）。
  if (width > 0 && height > 0 && Math.max(width, height) < 320) return null;

  const srcsets = [img.getAttribute("srcset"), img.getAttribute("data-srcset")];
  const picture = img.parentElement?.tagName.toLowerCase() === "picture" ? img.parentElement : null;
  if (picture) {
    for (const source of picture.querySelectorAll("source[srcset]")) {
      srcsets.push(source.getAttribute("srcset"));
    }
  }
  const candidates = [
    ...srcsets.map((set) => largestSrcsetUrl(set)),
    img.getAttribute("data-src"),
    img.getAttribute("data-original"),
    img.currentSrc,
    img.getAttribute("src"),
  ];
  for (const raw of candidates) {
    if (!raw || isInlineUrl(raw)) continue;
    const url = absoluteUrl(raw);
    if (!url || !/^https?:/i.test(url)) continue;
    return { url, type: "image", detectedBy: by };
  }
  return null;
}

function metaResource(meta: Element, by: DetectionMethod, ctx: ScanContext): ResourceMessagePayload | null {
  const key = (meta.getAttribute("property") || meta.getAttribute("name") || "").toLowerCase();
  if (
    !/^og:(?:image|video|audio)(?::(?:url|secure_url))?$/.test(key) &&
    key !== "twitter:image" &&
    key !== "twitter:image:src" &&
    key !== "twitter:player:stream"
  ) {
    return null;
  }
  const raw = meta.getAttribute("content")?.trim();
  if (!raw || isInlineUrl(raw)) return null;
  const url = absoluteUrl(raw);
  if (!url || !/^https?:/i.test(url)) return null;
  const isImage = key.includes("image");
  if (isImage && !ctx.sniffImages) return null;
  return { url, type: isImage ? "image" : ctx.classify(url), detectedBy: by };
}

function linkResource(link: Element, by: DetectionMethod, ctx: ScanContext): ResourceMessagePayload | null {
  const rel = (link.getAttribute("rel") || "").toLowerCase();
  const as = (link.getAttribute("as") || "").toLowerCase();
  const wanted = rel === "image_src" || (rel.includes("preload") && as === "image");
  if (!wanted || !ctx.sniffImages) return null;
  const url = absoluteUrl((link as HTMLLinkElement).href);
  if (!url || !/^https?:/i.test(url)) return null;
  return { url, type: "image", detectedBy: by };
}

/** 单个元素产出的资源（MutationObserver 路径与整页扫描共用）。 */
export function checkElement(el: Element, by: DetectionMethod, ctx: ScanContext): ResourceMessagePayload[] {
  const out: ResourceMessagePayload[] = [];
  switch (el.tagName.toLowerCase()) {
    case "video": {
      const video = el as HTMLVideoElement;
      for (const url of new Set([video.src, video.currentSrc])) {
        if (url && !isInlineUrl(url)) out.push({ url, type: "video", quality: qualityOf(video), detectedBy: by });
      }
      if (ctx.sniffImages && video.poster && !isInlineUrl(video.poster)) {
        out.push({ url: video.poster, type: "image", detectedBy: by });
      }
      break;
    }
    case "audio": {
      const { src } = el as HTMLAudioElement;
      if (src && !isInlineUrl(src)) out.push({ url: src, type: "audio", detectedBy: by });
      break;
    }
    case "source": {
      const source = el as HTMLSourceElement;
      if (source.src && !isInlineUrl(source.src)) {
        out.push({
          url: source.src,
          type: mediaTypeOfMime(source.type),
          mimeType: source.type || undefined,
          detectedBy: by,
        });
      }
      break;
    }
    case "track": {
      const track = el as HTMLTrackElement;
      if (track.src?.startsWith("http")) out.push(trackResource(track, by, ctx));
      break;
    }
    case "a": {
      const r = anchorResource(el as HTMLAnchorElement, by, ctx);
      if (r) out.push(r);
      break;
    }
    case "area": {
      const r = anchorResource(el as unknown as HTMLAnchorElement, by, ctx);
      if (r) out.push(r);
      break;
    }
    case "img": {
      const r = imageResource(el as HTMLImageElement, by);
      if (r && ctx.sniffImages) out.push(r);
      break;
    }
    case "meta": {
      const r = metaResource(el, by, ctx);
      if (r) out.push(r);
      break;
    }
    case "link": {
      const r = linkResource(el, by, ctx);
      if (r) out.push(r);
      break;
    }
    case "embed":
    case "object": {
      const url = (el as HTMLEmbedElement).src || (el as HTMLObjectElement).data;
      if (!url?.startsWith("http")) break;
      // 作者声明的 type（如 application/pdf）：服务端回 octet-stream 时浏览器按它渲染（HTML 规范），
      // 也是无扩展名地址唯一的类型线索；入库时由规则引擎按 MIME 归类。
      const mimeType = (el as HTMLEmbedElement | HTMLObjectElement).type.split(";")[0].trim().toLowerCase();
      out.push({ url, type: "other", ...(mimeType ? { mimeType } : {}), detectedBy: by });
      break;
    }
  }
  return out;
}

/** 整页扫描：每类元素的行为与 checkElement 一致，来源记为 dom-scan。 */
export function scanPageResources(ctx: ScanContext): ResourceMessagePayload[] {
  const out: ResourceMessagePayload[] = [];
  for (const el of document.querySelectorAll(SCAN_SELECTOR)) out.push(...checkElement(el, "dom-scan", ctx));
  return out;
}

export interface DomRuleHit {
  ruleId: string;
  value: string;
  text: string;
  /** 命中元素本身或其内首个已跟踪的媒体元素；产出的资源归属该元素。 */
  elementKey?: string;
}

/** 单条 dom 规则最多取的命中数。 */
export const MAX_DOM_HITS_PER_RULE = 200;

function mediaKeyOf(el: Element, keyOf: ScanContext["keyOf"]): string | undefined {
  const own = keyOf(el);
  if (own) return own;
  for (const media of el.querySelectorAll("video, audio")) {
    const key = keyOf(media);
    if (key) return key;
  }
  return undefined;
}

/** 执行一条 dom 规则（selector + attr）；非法 selector 返回空。 */
export function runDomRule(
  rule: { ruleId: string; selector: string; attr: string },
  keyOf: ScanContext["keyOf"],
): DomRuleHit[] {
  let nodes: NodeListOf<Element>;
  try {
    nodes = document.querySelectorAll(rule.selector);
  } catch {
    return [];
  }
  const hits: DomRuleHit[] = [];
  for (const el of nodes) {
    if (hits.length >= MAX_DOM_HITS_PER_RULE) break;
    let value = "";
    if (URL_ATTRS.has(rule.attr)) {
      const resolved = (el as unknown as Record<string, unknown>)[rule.attr];
      value = typeof resolved === "string" ? resolved : (el.getAttribute(rule.attr) ?? "");
    } else {
      value = el.getAttribute(rule.attr) ?? "";
    }
    if (!value) continue;
    const hit: DomRuleHit = { ruleId: rule.ruleId, value, text: (el.textContent ?? "").trim().slice(0, 200) };
    const elementKey = mediaKeyOf(el, keyOf);
    if (elementKey) hit.elementKey = elementKey;
    hits.push(hit);
  }
  return hits;
}

const LINK_SELECTOR =
  "a[href], area[href], img[src], img[data-src], video[src], video[poster], source[src], embed[src], object[data], link[href], meta[content]";
const LINK_PROTOCOLS = new Set(["http:", "https:", "ftp:", "magnet:", "ed2k:", "thunder:", "115:"]);
const MAX_LINKS = 5000;

/** 页面链接收集（链接抓取器）：只保留 http/https/ftp/magnet/ed2k/thunder/115，去重后最多 5000 条。 */
export function collectLinks(): PageLink[] {
  const seen = new Set<string>();
  const links: PageLink[] = [];
  for (const el of document.querySelectorAll(LINK_SELECTOR)) {
    if (links.length >= MAX_LINKS) break;
    const attr = el.hasAttribute("href")
      ? "href"
      : el.hasAttribute("src")
        ? "src"
        : el.hasAttribute("data-src")
          ? "data-src"
          : el.hasAttribute("poster")
            ? "poster"
            : el.hasAttribute("data")
              ? "data"
              : "content";
    const raw = el.getAttribute(attr);
    if (!raw) continue;
    let url: string;
    if (isP2PLink(raw.trim())) {
      // `115://` 不是合法 scheme，`new URL` 会抛错；P2P 链接原样保留。
      url = raw.trim();
    } else {
      try {
        const parsed = new URL(raw, document.baseURI);
        if (!LINK_PROTOCOLS.has(parsed.protocol)) continue;
        url = parsed.href;
      } catch {
        continue;
      }
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const tag = el.tagName.toLowerCase();
    const label = tag === "img" ? (el.getAttribute("alt") ?? "") : (el.textContent ?? "");
    links.push({ url, text: label.replace(/\s+/g, " ").trim().slice(0, 120), tag });
  }
  return links;
}
