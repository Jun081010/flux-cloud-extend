import { describe, expect, test } from "bun:test";
import { parseXMediaUrl, xImageFilename, xMediaBaseName, xMediaFilename, xVideoThumbMediaId } from "./x-media";

describe("X 媒体地址", () => {
  test("pbs 图片按 format 查询补正确扩展名", () => {
    expect(
      parseXMediaUrl("https://pbs.twimg.com/media/HXVEogqbMAATWOY?format=jpg&name=orig"),
    ).toEqual({ kind: "image", id: "HXVEogqbMAATWOY", extension: "jpg" });
    expect(
      parseXMediaUrl("https://pbs.twimg.com/media/HXVEogqbMAATWOY?format=png&name=large"),
    ).toEqual({ kind: "image", id: "HXVEogqbMAATWOY", extension: "png" });
    expect(xImageFilename("https://pbs.twimg.com/media/HXVEogqbMAATWOY?format=jpeg")).toBe(
      "x-HXVEogqbMAATWOY.jpg",
    );
  });

  test("pbs 路径扩展名作为 format 缺失时的备选", () => {
    expect(parseXMediaUrl("https://pbs.twimg.com/media/AbC.jpeg")).toEqual({
      kind: "image",
      id: "AbC",
      extension: "jpg",
    });
  });

  test("链接预览图与视频封面也使用稳定媒体 ID，避免落到页面标题", () => {
    expect(parseXMediaUrl("https://pbs.twimg.com/card_img/123/AbCdEf?format=jpg&name=small")).toEqual({
      kind: "image",
      id: "AbCdEf",
      extension: "jpg",
    });
    expect(parseXMediaUrl("https://pbs.twimg.com/amplify_video_thumb/2123221745079668737/img/AbC.jpg")).toEqual({
      kind: "image",
      id: "2123221745079668737",
      extension: "jpg",
    });
  });

  test("amplify_video / ext_tw_video / tweet_video 统一取媒体 ID", () => {
    const expected = { kind: "video", id: "2123221745079668737", extension: "mp4" };
    expect(
      parseXMediaUrl(
        "https://video.twimg.com/amplify_video/2123221745079668737/pl/DM1piJWrb6oO556h.m3u8?tag=14",
      ),
    ).toEqual(expected);
    expect(
      parseXMediaUrl("https://video.twimg.com/ext_tw_video/2123221745079668737/pu/vid/720x978/a.mp4"),
    ).toEqual(expected);
    expect(
      parseXMediaUrl("https://video.twimg.com/tweet_video/2123221745079668737.mp4"),
    ).toEqual(expected);
    expect(xMediaBaseName("https://video.twimg.com/amplify_video/2123221745079668737/pl/a.m3u8")).toBe(
      "x-2123221745079668737",
    );
    expect(
      xMediaFilename("https://video.twimg.com/amplify_video/2123221745079668737/pl/a.m3u8"),
    ).toBe("x-2123221745079668737.mp4");
  });

  test("非 /media/ 图片与伪装域名不命中", () => {
    expect(parseXMediaUrl("https://pbs.twimg.com/profile_images/1/AbC?name=large")).toBeNull();
    expect(parseXMediaUrl("https://pbs.twimg.com.evil.test/media/AbC?format=jpg")).toBeNull();
    expect(parseXMediaUrl("https://video.twimg.com.evil.test/amplify_video/1/pl/a.m3u8")).toBeNull();
    expect(parseXMediaUrl("https://example.com/media/AbC?format=jpg")).toBeNull();
  });

  test("视频封面解析出媒体 ID，用于匹配已嗅探的视频流", () => {
    expect(
      xVideoThumbMediaId("https://pbs.twimg.com/amplify_video_thumb/2123221745079668737/img/AbC?name=small"),
    ).toBe("2123221745079668737");
    expect(
      xVideoThumbMediaId("https://pbs.twimg.com/ext_tw_video_thumb/12345/pu/img/AbC.jpg"),
    ).toBe("12345");
    expect(xVideoThumbMediaId("https://pbs.twimg.com/tweet_video_thumb/999/img/x.jpg")).toBe("999");
    expect(xVideoThumbMediaId("https://pbs.twimg.com/media/AbC?format=jpg&name=orig")).toBeNull();
    expect(xVideoThumbMediaId("https://pbs.twimg.com.evil.test/amplify_video_thumb/1/img/a.jpg")).toBeNull();
  });
});
