/**
 * 系统代理检测。
 *
 * 背景：FluxDown 桌面端默认按自身配置下载；当桌面端未配置代理（或任务级
 * `proxy_url` 为空）时，`video.twimg.com`、`pbs.twimg.com` 等 CDN 在中国大陆
 * 直连会超时。扩展需要把代理地址透传给引擎，让任务走代理下载。
 *
 * 约束：本项目 manifest 未申请 `proxy` 权限，MV3 下 `chrome.proxy` 不存在，
 * 也读不到 Windows 注册表。因此采用「探测本机常见 HTTP 代理端口」：
 * 以 origin-form（`GET /`）访问 `127.0.0.1:<port>`，真正的 HTTP 代理无法按
 * 源站路径处理，会返回 400 Bad Request（Clash / mihomo / v2rayN / sing-box
 * 等均如此）；普通 Web 服务通常返回 2xx/3xx/404。以 400/407 作为代理特征。
 *
 * 探测结果缓存：命中 5 分钟，未命中的否定结果 60 秒，避免每次下载都探测。
 */
import { browser } from "wxt/browser";

export interface SystemProxy {
  enabled: boolean;
  /** `host:port`，如 `127.0.0.1:7897`；未配置时为空字符串。 */
  server: string;
  /** 完整代理 URL，如 `http://127.0.0.1:7897`；未配置时为空字符串。 */
  url: string;
}

const EMPTY: SystemProxy = { enabled: false, server: "", url: "" };

/** 常见本机 HTTP 代理端口（按流行度排序，命中即停）。 */
const CANDIDATE_PORTS = [7897, 7890, 10809, 2080, 1081, 8118];

const PROBE_TIMEOUT_MS = 700;
const HIT_TTL_MS = 5 * 60 * 1000;
const MISS_TTL_MS = 60 * 1000;

let cached: { value: SystemProxy; expiresAt: number } | null = null;
let inFlight: Promise<SystemProxy> | null = null;

/**
 * 读取当前可用代理。无代理时返回 `enabled: false`。
 * 结果按 TTL 缓存；并发调用共享同一次探测。
 */
export async function getSystemProxy(): Promise<SystemProxy> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inFlight) return inFlight;

  inFlight = detect().finally(() => {
    inFlight = null;
  });
  const value = await inFlight;
  cached = {
    value,
    expiresAt: Date.now() + (value.enabled ? HIT_TTL_MS : MISS_TTL_MS),
  };
  return value;
}

/** 测试/设置变更后清空缓存。 */
export function invalidateSystemProxyCache(): void {
  cached = null;
}

async function detect(): Promise<SystemProxy> {
  // Firefox 等实现了 proxy.settings 的环境优先读显式配置（无需端口猜测）。
  const explicit = await readExplicitProxy();
  if (explicit) return explicit;

  return (await probeCommonProxyPorts()) ?? EMPTY;
}

async function readExplicitProxy(): Promise<SystemProxy | null> {
  try {
    const settings = await browser.proxy?.settings?.get?.({});
    const value = settings?.value;
    if (!value || value.mode !== "fixed_servers") return null;
    const rules = String((value as { proxyRules?: string }).proxyRules || "");
    if (!rules) return null;
    const server = stripScheme(rules);
    if (!server) return null;
    return { enabled: true, server, url: addScheme(rules) };
  } catch {
    return null;
  }
}

async function probeCommonProxyPorts(): Promise<SystemProxy | null> {
  const results = await Promise.all(
    CANDIDATE_PORTS.map((port) => probePort(port)),
  );
  const hit = results.find((result) => result !== null);
  if (!hit) return null;
  return {
    enabled: true,
    server: `127.0.0.1:${hit}`,
    url: `http://127.0.0.1:${hit}`,
  };
}

/**
 * 返回命中的端口号；不是 HTTP 代理时返回 null。
 *
 * 400：代理收到 origin-form 请求（Clash/mihomo/v2rayN/sing-box 的统一行为）；
 * 407：代理要求认证。两者都只可能来自 HTTP 代理语义。
 */
async function probePort(port: number): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
    });
    return response.status === 400 || response.status === 407 ? port : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stripScheme(rules: string): string {
  // fixed_servers 代理规则如 "http=127.0.0.1:7897;https=127.0.0.1:7897" 或直接 "127.0.0.1:7897"
  const match = rules.match(/=[^;]+/);
  if (match) return match[0].slice(1).split(";")[0].trim();
  return rules.split(";")[0].trim();
}

function addScheme(server: string): string {
  if (/^https?:\/\//i.test(server)) return server;
  return `http://${server}`;
}
