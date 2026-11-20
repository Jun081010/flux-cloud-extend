/**
 * 下载协议识别与文件名解析：magnet / ed2k / thunder / 115。
 * 这些协议不走 URL 解析（`115://` 甚至不是合法 scheme），统一在这里处理。
 */

const P2P_PREFIX = /^(?:magnet|ed2k|thunder|115):/i;

/** 是否是 FluxDown 可直接接收的 P2P / 离线下载链接。 */
export function isP2PLink(url: string): boolean {
  return P2P_PREFIX.test(url.trim());
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function magnetName(url: string): string | undefined {
  const query = url.slice(url.indexOf("?") + 1);
  try {
    return new URLSearchParams(query).get("dn") || undefined;
  } catch {
    return undefined;
  }
}

/** ed2k://|file|<name>|<size>|<hash>|/ */
function ed2kName(text: string): string | undefined {
  const m = /^ed2k:\/\/\|file\|([^|]+)\|(\d+)\|([0-9a-f]{32})\|\/?$/i.exec(text);
  return m?.[1] ? decodeComponent(m[1]) : undefined;
}

/** thunder://<base64(AA<真实链接>ZZ)>，内层通常是 ed2k / ftp / http。 */
function thunderTarget(text: string): string | undefined {
  const payload = text.slice("thunder://".length).trim();
  if (!payload) return undefined;
  try {
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const inner = decoded.replace(/^AA/, "").replace(/ZZ$/, "");
    return inner || undefined;
  } catch {
    return undefined;
  }
}

function thunderName(text: string): string | undefined {
  const inner = thunderTarget(text);
  if (!inner) return undefined;
  if (/^ed2k:/i.test(inner)) return ed2kName(inner);
  try {
    const path = new URL(inner).pathname.split("/").filter(Boolean).pop();
    return path ? decodeComponent(path) : undefined;
  } catch {
    return undefined;
  }
}

/** 115://<name>|<size>|<sha1>|... */
function offline115Name(text: string): string | undefined {
  const body = text.slice("115://".length);
  const first = body.split("|")[0];
  return first ? decodeComponent(first) : undefined;
}

/** 从 P2P 链接中解析出可读文件名（解析不出返回 undefined）。 */
export function parseP2PName(url: string): string | undefined {
  const text = url.trim();
  const lower = text.toLowerCase();
  if (lower.startsWith("magnet:")) return magnetName(text);
  if (lower.startsWith("ed2k:")) return ed2kName(text);
  if (lower.startsWith("thunder://")) return thunderName(text);
  if (lower.startsWith("115://")) return offline115Name(text);
  return undefined;
}

/** P2P 链接的统一资源类型：都交给桌面端的离线 / 磁力下载通道。 */
export function p2pResourceType(url: string): "magnet" | null {
  return isP2PLink(url) ? "magnet" : null;
}
