import { describe, expect, test } from "bun:test";
import { upgradeXImageUrl } from "./x-image";

describe("upgradeXImageUrl", () => {
  test("X 媒体图片按 orig 取原图，保留 format", () => {
    expect(upgradeXImageUrl("https://pbs.twimg.com/media/HXVEogqbMAATWOY?format=jpg&name=900x900")).toBe(
      "https://pbs.twimg.com/media/HXVEogqbMAATWOY?format=jpg&name=orig",
    );
    expect(upgradeXImageUrl("https://pbs.twimg.com/media/AbC?name=small")).toBe(
      "https://pbs.twimg.com/media/AbC?format=jpg&name=orig",
    );
  });

  test("链接预览图与视频封面同样升级到 orig", () => {
    expect(upgradeXImageUrl("https://pbs.twimg.com/card_img/123/abc?format=jpg&name=small")).toBe(
      "https://pbs.twimg.com/card_img/123/abc?format=jpg&name=orig",
    );
    expect(upgradeXImageUrl("https://pbs.twimg.com/amplify_video_thumb/123/img/abc?name=small")).toBe(
      "https://pbs.twimg.com/amplify_video_thumb/123/img/abc?format=jpg&name=orig",
    );
  });

  test("无扩展名且缺 format 时补 jpg，否则 X 返回 404", () => {
    expect(upgradeXImageUrl("https://pbs.twimg.com/media/HXVEogqbMAATWOY")).toBe(
      "https://pbs.twimg.com/media/HXVEogqbMAATWOY?format=jpg&name=orig",
    );
  });

  test("非媒体路径、其它站点一律原样返回", () => {
    const avatar = "https://pbs.twimg.com/profile_images/1/AbC?name=large";
    expect(upgradeXImageUrl(avatar)).toBe(avatar);
    const other = "https://cdn.example.com/media/a.jpg?name=small";
    expect(upgradeXImageUrl(other)).toBe(other);
    expect(upgradeXImageUrl("not a url")).toBe("not a url");
  });
});
