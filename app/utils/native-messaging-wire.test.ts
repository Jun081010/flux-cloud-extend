import { describe, expect, mock, test } from "bun:test";

mock.module("wxt/browser", () => ({
  browser: {
    runtime: {
      connectNative: () => {
        throw new Error("not used in this test");
      },
      getPlatformInfo: async () => ({ os: "windows" }),
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      sync: { get: async () => ({}), set: async () => {} },
    },
  },
}));

import { toBatchWireItem } from "./native-messaging";

describe("toBatchWireItem", () => {
  test("把任务级 proxyUrl 序列化进批量 wire 条目", () => {
    const wire = toBatchWireItem({
      url: "https://video.twimg.com/a.m3u8",
      filename: "clip.mp4",
      proxyUrl: "http://127.0.0.1:7897",
    });
    expect(wire.proxyUrl).toBe("http://127.0.0.1:7897");
  });

  test("没有代理时省略字段，交由引擎使用全局配置", () => {
    const wire = toBatchWireItem({
      url: "https://video.twimg.com/a.m3u8",
      proxyUrl: "",
    });
    expect("proxyUrl" in wire).toBe(false);
  });
});
