/**
 * X / Twitter 图片 CDN 的尺寸参数（`?format=jpg&name=900x900`）只控制返回分辨率，
 * 换成 `name=orig` 即原图，且无需登录态。
 *
 * 帖内图片是 `/media/`，链接预览图是 `/card_img/`，视频封面是
 * `/amplify_video_thumb/`、`/ext_tw_video_thumb/`、`/tweet_video_thumb/`。
 * 后几类同样会把 `name=small` 之类的缩略档带进 `currentSrc`，不能只处理 /media/。
 * 无扩展名的路径如果不带 `format`，X 会直接返回 404，因此补默认 jpg。
 */
const X_IMAGE_HOST = "pbs.twimg.com";
const X_IMAGE_PATH =
  /^\/(?:media|card_img|amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\/[^/]+/;
const HAS_EXTENSION = /\.[a-z0-9]{2,5}$/i;

export function upgradeXImageUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.hostname !== X_IMAGE_HOST || !X_IMAGE_PATH.test(url.pathname)) return raw;
  url.searchParams.delete("name");
  if (!url.searchParams.has("format") && !HAS_EXTENSION.test(url.pathname)) {
    url.searchParams.set("format", "jpg");
  }
  url.searchParams.set("name", "orig");
  return url.href;
}
