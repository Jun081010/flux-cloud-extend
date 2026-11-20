/**
 * X / Twitter 媒体地址解析。
 *
 * 页面标题在 X 上常常是「嵌入式视频」之类的占位文案，不能用作下载文件名。
 * 媒体 ID 在 pbs/video 两个 CDN 的路径里稳定存在，用它生成文件名既能避免
 * 同名覆盖，也不依赖页面语言或登录态。
 */

export interface XMediaInfo {
  kind: "video" | "image";
  id: string;
  extension: string;
}

const X_IMAGE_HOST = "pbs.twimg.com";
const X_VIDEO_HOST = "video.twimg.com";
const X_IMAGE_MEDIA_PATH = /^\/media\/([^/]+?)(?:\.([a-z0-9]+))?\/?$/i;
const X_CARD_IMAGE_PATH = /^\/card_img\/([^/]+)\/([^/]+?)(?:\.([a-z0-9]+))?\/?$/i;
const X_VIDEO_THUMB_PATH =
  /^\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\/([^/]+)\/img\/([^/]+?)(?:\.([a-z0-9]+))?\/?$/i;
const X_VIDEO_THUMB_ID_PATH = /^\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\/([^/]+)\//i;
const X_VIDEO_ID_PATH = /\/(?:amplify_video|ext_tw_video|tweet_video)\/([A-Za-z0-9_-]+)(?:\/|\.|$)/;

function normalizeImageExtension(format: string | null, pathExtension: string | undefined): string {
  const raw = (format || pathExtension || "jpg").toLowerCase();
  if (raw === "jpeg") return "jpg";
  return /^[a-z0-9]{2,5}$/.test(raw) ? raw : "jpg";
}

function safeId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value) && value.length <= 80;
}

export function parseXMediaUrl(raw: string): XMediaInfo | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  if (url.hostname === X_IMAGE_HOST) {
    const match = X_IMAGE_MEDIA_PATH.exec(url.pathname);
    if (match && safeId(match[1])) {
      return {
        kind: "image",
        id: match[1],
        extension: normalizeImageExtension(url.searchParams.get("format"), match[2]),
      };
    }
    const card = X_CARD_IMAGE_PATH.exec(url.pathname);
    if (card && safeId(card[2])) {
      return {
        kind: "image",
        id: card[2],
        extension: normalizeImageExtension(url.searchParams.get("format"), card[3]),
      };
    }
    const thumb = X_VIDEO_THUMB_PATH.exec(url.pathname);
    if (thumb && safeId(thumb[1])) {
      return {
        kind: "image",
        id: thumb[1],
        extension: normalizeImageExtension(url.searchParams.get("format"), thumb[3]),
      };
    }
    return null;
  }

  if (url.hostname === X_VIDEO_HOST) {
    const match = X_VIDEO_ID_PATH.exec(url.pathname);
    if (!match || !safeId(match[1])) return null;
    return { kind: "video", id: match[1], extension: "mp4" };
  }

  return null;
}

/**
 * 视频封面图（pbs.twimg.com/amplify_video_thumb/<mediaId>/img/...）里的媒体 ID。
 *
 * X 的时间线在视频开始播放前只渲染封面图，页面上没有 `<video>`，此时小球
 * 只能拿到封面。用封面里的 mediaId 去匹配已嗅探到的视频流，就能把「拖到视频
 * 封面上」还原成「下载这条视频」，而不是下载一张静帧。
 */
export function xVideoThumbMediaId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.hostname !== X_IMAGE_HOST) return null;
  const match = X_VIDEO_THUMB_ID_PATH.exec(url.pathname);
  return match && safeId(match[1]) ? match[1] : null;
}

/** 不含扩展名的稳定文件名；与 `candidateFilename` 的扩展名逻辑配合使用。 */
export function xMediaBaseName(raw: string): string | null {
  const info = parseXMediaUrl(raw);
  return info ? `x-${info.id}` : null;
}

/** 图片落盘名（含扩展名），供直接发送图片 URL 时使用。 */
export function xImageFilename(raw: string): string | null {
  const info = parseXMediaUrl(raw);
  if (!info || info.kind !== "image") return null;
  return `x-${info.id}.${info.extension}`;
}

/** 图片或视频的落盘名；视频清单（m3u8/mpd）也统一给 .mp4。 */
export function xMediaFilename(raw: string): string | null {
  const info = parseXMediaUrl(raw);
  return info ? `x-${info.id}.${info.extension}` : null;
}
