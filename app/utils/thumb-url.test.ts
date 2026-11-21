import { describe, expect, test } from "bun:test";
import { thumbnailableUrl } from "./thumb-url";

describe("thumbnailableUrl", () => {
  test("普通 http(s) 图片地址原样返回", () => {
    expect(thumbnailableUrl("https://cdn.example.com/a.jpg?x=1")).toBe(
      "https://cdn.example.com/a.jpg?x=1",
    );
    expect(thumbnailableUrl("http://cdn.example.com/a.jpg")).toBe(
      "http://cdn.example.com/a.jpg",
    );
  });

  test("非 http(s) 协议与空值不用于缩略图", () => {
    expect(thumbnailableUrl("")).toBeNull();
    expect(thumbnailableUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(thumbnailableUrl("javascript:alert(1)")).toBeNull();
    expect(thumbnailableUrl("blob:https://example.com/123")).toBeNull();
    expect(thumbnailableUrl("file:///C:/a.jpg")).toBeNull();
    expect(thumbnailableUrl(123 as unknown as string)).toBeNull();
  });

  test("超长或非法 URL 不用于缩略图", () => {
    expect(thumbnailableUrl(`https://cdn.example.com/${"a".repeat(2048)}.jpg`)).toBeNull();
    expect(thumbnailableUrl("not a url")).toBeNull();
  });

  test("pbs.twimg.com 强制使用 name=small", () => {
    expect(thumbnailableUrl("https://pbs.twimg.com/media/AbC?format=jpg")).toBe(
      "https://pbs.twimg.com/media/AbC?format=jpg&name=small",
    );
    expect(
      thumbnailableUrl("https://pbs.twimg.com/media/AbC?format=jpg&name=900x900"),
    ).toBe("https://pbs.twimg.com/media/AbC?format=jpg&name=small");
  });
});
