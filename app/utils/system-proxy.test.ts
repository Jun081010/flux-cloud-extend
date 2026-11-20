import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("wxt/browser", () => ({ browser: {} }));

import { getSystemProxy, invalidateSystemProxyCache } from "./system-proxy";

const originalFetch = globalThis.fetch;

function fakeFetch(handler: (port: string) => { status: number } | Error) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const port = new URL(String(input)).port;
    const result = handler(port);
    if (result instanceof Error) throw result;
    return new Response("", { status: result.status });
  }) as typeof fetch;
}

describe("getSystemProxy", () => {
  beforeEach(() => invalidateSystemProxyCache());
  afterEach(() => {
    globalThis.fetch = originalFetch;
    invalidateSystemProxyCache();
  });

  test("识别返回 400 的本机 HTTP 代理端口", async () => {
    fakeFetch((port) => (port === "7897" ? { status: 400 } : new Error("refused")));
    const proxy = await getSystemProxy();
    expect(proxy).toEqual({
      enabled: true,
      server: "127.0.0.1:7897",
      url: "http://127.0.0.1:7897",
    });
  });

  test("普通 Web 服务（200）不算代理", async () => {
    fakeFetch(() => ({ status: 200 }));
    const proxy = await getSystemProxy();
    expect(proxy.enabled).toBe(false);
  });

  test("命中结果被缓存，不重复探测", async () => {
    let calls = 0;
    fakeFetch(() => {
      calls += 1;
      return { status: 407 };
    });
    await getSystemProxy();
    const firstRound = calls;
    await getSystemProxy();
    expect(calls).toBe(firstRound);
  });
});
