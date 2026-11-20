export type CloudVendorId =
  | "baidu"
  | "aliyun"
  | "mcloud"
  | "tcloud"
  | "xunlei"
  | "guangya"
  | "quark"
  | "uc"
  | "pan123";

export interface CloudVendorPolicy {
  id: CloudVendorId;
  /** 允许注入 LinkSwift 的顶层页面域名后缀。 */
  pageSuffixes: readonly string[];
  /** 该厂商页面允许代理的 API / 下载域名后缀。 */
  fetchSuffixes: readonly string[];
  /** 该厂商页面允许推送给 FluxDown 的直链域名后缀。 */
  downloadSuffixes: readonly string[];
}

export const CLOUD_VENDORS: readonly CloudVendorPolicy[] = [
  {
    id: "baidu",
    pageSuffixes: ["pan.baidu.com", "yun.baidu.com"],
    fetchSuffixes: [
      "baidu.com",
      "baidupcs.com",
      "baiducontent.com",
      "bdstatic.com",
      "openapi.baidu.com",
    ],
    downloadSuffixes: [
      "baidu.com",
      "baidupcs.com",
      "baiducontent.com",
      "bdstatic.com",
      "openapi.baidu.com",
    ],
  },
  {
    id: "aliyun",
    pageSuffixes: ["www.aliyundrive.com", "www.alipan.com"],
    fetchSuffixes: [
      "aliyundrive.com",
      "aliyundrive.net",
      "alipan.com",
      "alicloudccp.com",
      "aliyundrive.cloud",
      "aliyun.com",
    ],
    downloadSuffixes: [
      "aliyundrive.com",
      "aliyundrive.net",
      "alipan.com",
      "alicloudccp.com",
      "aliyundrive.cloud",
      "aliyun.com",
    ],
  },
  {
    id: "mcloud",
    pageSuffixes: ["yun.139.com", "caiyun.139.com"],
    fetchSuffixes: ["139.com", "cmecloud.cn"],
    downloadSuffixes: ["139.com", "cmecloud.cn"],
  },
  {
    id: "tcloud",
    pageSuffixes: ["cloud.189.cn"],
    fetchSuffixes: ["189.cn"],
    downloadSuffixes: ["189.cn"],
  },
  {
    id: "xunlei",
    pageSuffixes: ["pan.xunlei.com"],
    fetchSuffixes: ["xunlei.com"],
    downloadSuffixes: ["xunlei.com"],
  },
  {
    id: "guangya",
    pageSuffixes: ["www.guangyapan.com"],
    fetchSuffixes: ["guangyapan.com", "guangyacdn.com"],
    downloadSuffixes: ["guangyapan.com", "guangyacdn.com"],
  },
  {
    id: "quark",
    pageSuffixes: ["pan.quark.cn"],
    fetchSuffixes: ["quark.cn"],
    downloadSuffixes: ["quark.cn"],
  },
  {
    id: "uc",
    pageSuffixes: ["drive.uc.cn"],
    fetchSuffixes: ["uc.cn"],
    downloadSuffixes: ["uc.cn"],
  },
  {
    id: "pan123",
    pageSuffixes: [
      "123pan.com",
      "123pan.cn",
      "123684.com",
      "123865.com",
      "123952.com",
      "123912.com",
    ],
    fetchSuffixes: [
      "123pan.com",
      "123pan.cn",
      "123684.com",
      "123865.com",
      "123952.com",
      "123912.com",
      "cjjd19.com",
    ],
    downloadSuffixes: [
      "123pan.com",
      "123pan.cn",
      "123684.com",
      "123865.com",
      "123952.com",
      "123912.com",
      "cjjd19.com",
    ],
  },
];

/** openTab 只用于 LinkSwift 的帮助页 / 外部文档，不参与 cloudFetch 代理。 */
const CLOUD_OPEN_TAB_HELP_SUFFIXES = [
  "www.youxiaohou.com",
  "d.youxiaohou.com",
  "ariang.mayswind.net",
] as const;

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "::ffff:127.0.0.1",
  "169.254.169.254",
  "metadata.google.internal",
  "metadata",
]);

const PRIVATE_IPV4_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.1[89]\./,
  /^22[0-3]\./,
  /^24[0-9]\./,
  /^25[0-5]\./,
];

export const CLOUD_CONTENT_MATCHES = [
  "https://pan.baidu.com/*",
  "https://yun.baidu.com/*",
  "https://www.aliyundrive.com/*",
  "https://www.alipan.com/*",
  "https://yun.139.com/*",
  "https://caiyun.139.com/*",
  "https://cloud.189.cn/*",
  "https://pan.xunlei.com/*",
  "https://www.guangyapan.com/*",
  "https://pan.quark.cn/*",
  "https://drive.uc.cn/*",
  "https://*.123pan.com/*",
  "https://*.123pan.cn/*",
  "https://*.123684.com/*",
  "https://*.123865.com/*",
  "https://*.123952.com/*",
  "https://*.123912.com/*",
];

function parseHttpUrl(value: string): URL | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function hostMatches(host: string, suffixes: readonly string[]): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return suffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

export function isPrivateHostname(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (PRIVATE_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.startsWith("::ffff:")) host = host.slice(7);
  if (host.includes(":")) return /^(::1|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(host);
  if (PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host))) return true;
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    return parts.some((part) => Number(part) > 255) || Number(parts[0]) >= 224;
  }
  return false;
}

function parsePublicTarget(value: string): URL | null {
  const url = parseHttpUrl(value);
  if (url === null || url.username !== "" || url.password !== "") return null;
  if (isPrivateHostname(url.hostname)) return null;
  return url;
}

function parseCloudPage(value: string): URL | null {
  const url = parsePublicTarget(value);
  return url?.protocol === "https:" ? url : null;
}

export function cloudVendorForPage(value: string): CloudVendorPolicy | undefined {
  const url = parseCloudPage(value);
  if (url === null) return undefined;
  return CLOUD_VENDORS.find((vendor) => hostMatches(url.hostname, vendor.pageSuffixes));
}

export function isCloudPageUrl(value: string): boolean {
  return cloudVendorForPage(value) !== undefined;
}

const AUTO_SHARE_VENDORS = new Set<CloudVendorId>([
  "baidu",
  "quark",
  "uc",
  "guangya",
  "pan123",
]);

/** 分享页能否由页面内自动提取直链并直接推送下载器。 */
export function supportsCloudShareAutoDownload(vendorId: CloudVendorId): boolean {
  return AUTO_SHARE_VENDORS.has(vendorId);
}

export const CLOUD_AUTO_SHARE_STORAGE_KEY = "fluxdown_auto_share";

export interface CloudAutoShareRecord {
  url: string;
  at: number;
}

/** 网盘跳转常会丢掉 query，用 origin + pathname 做一次性匹配。 */
export function cloudAutoShareMatches(record: unknown, pageUrl: string): boolean {
  if (!record || typeof record !== "object") return false;
  const { url, at } = record as Partial<CloudAutoShareRecord>;
  if (typeof url !== "string" || typeof at !== "number") return false;
  const age = Date.now() - at;
  if (age < -60_000 || age > 10 * 60 * 1000) return false;
  try {
    const target = new URL(url);
    const page = new URL(pageUrl);
    return target.protocol === "https:"
      && page.protocol === "https:"
      && target.origin === page.origin
      && target.pathname === page.pathname;
  } catch {
    return false;
  }
}

/**
 * 各网盘分享页的真实路由并不统一：123 会跳到 /123pan/、天翼是 /web/share、
 * 移动云盘使用 /shareweb/#/...。这里只接受已确认的分享路径，避免把网盘首页
 * 或普通文件页误判成分享链接。
 */
export function isCloudSharePageUrl(value: string): boolean {
  const url = parseCloudPage(value);
  if (url === null) return false;
  const vendor = cloudVendorForPage(value);
  if (vendor === undefined) return false;

  const path = url.pathname.toLowerCase();
  const hash = url.hash.toLowerCase();
  switch (vendor.id) {
    case "baidu":
      // /s/<id> 与 /share/init?surl=…、/share/link?shareid=…
      return /^\/(?:s|share)\//.test(path);
    case "aliyun":
    case "xunlei":
    case "guangya":
    case "quark":
    case "uc":
      return /^\/(?:s|share)\//.test(path);
    case "mcloud":
      return /^\/(?:shareweb|link)(?:\/|$)/.test(path)
        || (/^\/w\//.test(path) && /(?:^|\/)share(?:\/|\?|$)/.test(hash));
    case "tcloud":
      return /^\/(?:web\/share|t\/|share\/)/.test(path);
    case "pan123":
      return /^\/(?:s|123pan)\//.test(path);
    default:
      return false;
  }
}

export function isAllowedFetchUrlForPage(pageUrl: string, targetUrl: string): boolean {
  const vendor = cloudVendorForPage(pageUrl);
  const target = parsePublicTarget(targetUrl);
  return vendor !== undefined && target !== null && hostMatches(target.hostname, vendor.fetchSuffixes);
}

export function isAllowedDownloadUrlForPage(pageUrl: string, targetUrl: string): boolean {
  const vendor = cloudVendorForPage(pageUrl);
  const target = parsePublicTarget(targetUrl);
  return vendor !== undefined && target !== null && hostMatches(target.hostname, vendor.downloadSuffixes);
}

export function isAllowedOpenTabUrlForPage(pageUrl: string, targetUrl: string): boolean {
  const vendor = cloudVendorForPage(pageUrl);
  const target = parsePublicTarget(targetUrl);
  if (vendor === undefined || target === null) return false;
  if (hostMatches(target.hostname, vendor.fetchSuffixes)) return true;
  return hostMatches(target.hostname, CLOUD_OPEN_TAB_HELP_SUFFIXES);
}

/**
 * 兼容旧调用方的“任一厂商可用”检查。新的后台安全边界必须使用
 * isAllowedFetchUrlForPage / isAllowedDownloadUrlForPage，不能退回到这里。
 */
export function isAllowedFetchUrl(value: string): boolean {
  const target = parsePublicTarget(value);
  return target !== null && CLOUD_VENDORS.some((vendor) => hostMatches(target.hostname, vendor.fetchSuffixes));
}

export function isAllowedDownloadUrl(value: string): boolean {
  const target = parsePublicTarget(value);
  return target !== null && CLOUD_VENDORS.some((vendor) => hostMatches(target.hostname, vendor.downloadSuffixes));
}

export function isAllowedOpenTabUrl(value: string): boolean {
  const target = parsePublicTarget(value);
  if (target === null) return false;
  return CLOUD_VENDORS.some((vendor) => hostMatches(target.hostname, vendor.fetchSuffixes))
    || hostMatches(target.hostname, CLOUD_OPEN_TAB_HELP_SUFFIXES);
}

export function cloudPageHost(value: string): string | undefined {
  const url = parsePublicTarget(value);
  if (url === null || cloudVendorForPage(value) === undefined) return undefined;
  return url.hostname.toLowerCase();
}
