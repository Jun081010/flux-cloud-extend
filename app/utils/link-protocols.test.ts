import { describe, expect, test } from "bun:test";
import { isP2PLink, parseP2PName, p2pResourceType } from "./link-protocols";

describe("P2P 链接识别", () => {
  test("magnet / ed2k / thunder / 115 都算可下载协议", () => {
    expect(isP2PLink("magnet:?xt=urn:btih:abc&dn=test.iso")).toBe(true);
    expect(isP2PLink("ed2k://|file|test.iso|1024|0123456789abcdef0123456789abcdef|/")).toBe(true);
    expect(isP2PLink("thunder://QUFodHRwOi8vZXhhbXBsZS5jb20vYS56aXBaWg==")).toBe(true);
    expect(isP2PLink("115://test.zip|1024|ABCDEF")).toBe(true);
    expect(isP2PLink("https://example.com/a.zip")).toBe(false);
    expect(p2pResourceType("magnet:?xt=urn:btih:abc")).toBe("magnet");
    expect(p2pResourceType("https://example.com/a.zip")).toBeNull();
  });
});

describe("parseP2PName", () => {
  test("magnet 取 dn 参数", () => {
    expect(parseP2PName("magnet:?xt=urn:btih:abc&dn=Ubuntu%2024.04.iso")).toBe("Ubuntu 24.04.iso");
  });

  test("ed2k 取 file 段并解码", () => {
    expect(
      parseP2PName("ed2k://|file|%E7%94%B5%E5%BD%B1.mkv|1024|0123456789abcdef0123456789abcdef|/"),
    ).toBe("电影.mkv");
  });

  test("thunder 解码 base64 后再取内层 ed2k 文件名", () => {
    const inner = "ed2k://|file|movie.mp4|2048|0123456789abcdef0123456789abcdef|/";
    const thunder = `thunder://${btoa(`AA${inner}ZZ`)}`;
    expect(parseP2PName(thunder)).toBe("movie.mp4");
  });

  test("115 离线链接取第一段文件名", () => {
    expect(parseP2PName("115://movie.mkv|1024|ABCDEF|0123")).toBe("movie.mkv");
  });

  test("普通 http 链接不返回 P2P 名称", () => {
    expect(parseP2PName("https://example.com/a.zip")).toBeUndefined();
  });
});
