import { describe, expect, test } from "bun:test";
import { BUNDLED_OFFICIAL_PACK, compileBundled, type ResponseInput } from "./engine";
import { validatePack } from "./validate";

const input = (url: string, extra: Partial<ResponseInput> = {}): ResponseInput => ({
  url,
  pageUrl: "https://x.com/home",
  size: 0,
  attachment: false,
  ...extra,
});

describe("X / Twitter 官方规则", () => {
  const engine = compileBundled({ sniffImages: true });

  test("无扩展名 /vid/ 分片 → video（official.x.video）", () => {
    expect(
      engine.classifyResponse(input("https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/abc")),
    ).toMatchObject({ decision: "resource", type: "video", rule: { id: "official.x.video" } });
  });

  test("无扩展名 /pl/ 播放列表 → stream（official.x.stream）", () => {
    expect(
      engine.classifyResponse(input("https://video.twimg.com/ext_tw_video/1/pu/pl/playlist")),
    ).toMatchObject({ decision: "resource", type: "stream", rule: { id: "official.x.stream" } });
  });

  test("带 m3u8 / mpd 扩展名 → stream", () => {
    expect(
      engine.classifyResponse(input("https://video.twimg.com/ext_tw_video/1/pu/pl/playlist.m3u8")),
    ).toMatchObject({ decision: "resource", type: "stream" });
    expect(
      engine.classifyResponse(input("https://video.twimg.com/ext_tw_video/1/pu/pl/manifest.mpd")),
    ).toMatchObject({ decision: "resource", type: "stream" });
  });

  test("pbs.twimg.com ?format=jpg：开启图片嗅探才命中 official.x.image", () => {
    const url = "https://pbs.twimg.com/media/Gabc?format=jpg&name=large";
    expect(engine.classifyResponse(input(url))).toMatchObject({
      decision: "resource",
      type: "image",
      rule: { id: "official.x.image" },
    });
    const withoutImages = compileBundled({ sniffImages: false });
    expect(withoutImages.classifyResponse(input(url)).decision).toBe("none");
  });

  test("负例：非 twimg 域名、非独立路径段、伪装域名不命中 X 规则", () => {
    const noXRule = (url: string) =>
      engine.explainResponse(input(url)).every((hit) => !hit.ref.id.startsWith("official.x."));
    expect(noXRule("https://example.com/foo/vid/bar")).toBe(true);
    expect(noXRule("https://pbs.twimg.com.evil.test/media/x?format=jpg")).toBe(true);
    expect(noXRule("https://video.twimg.com/ext_tw_video/1/pu/public/xyz")).toBe(true);
    expect(
      engine.classifyResponse(input("https://video.twimg.com/ext_tw_video/1/pu/public/xyz")).decision,
    ).toBe("none");
  });

  test("官方包健康：无剔除、全部 active、sequence 递增且包含 X 规则", () => {
    expect(validatePack(BUNDLED_OFFICIAL_PACK, "official").rejected).toEqual([]);
    expect(BUNDLED_OFFICIAL_PACK.sequence).toBeGreaterThan(1794788723);
    const list = compileBundled().listRules();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((entry) => entry.status === "active")).toBe(true);
    const ids = new Set(list.map((entry) => entry.rule.id));
    for (const id of ["official.x.image", "official.x.stream", "official.x.video"]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
