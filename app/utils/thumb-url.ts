const X_IMAGE_HOST = "pbs.twimg.com";

export function thumbnailableUrl(url: string): string | null {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname !== X_IMAGE_HOST) return url;
  parsed.searchParams.set("name", "small");
  return parsed.href;
}
