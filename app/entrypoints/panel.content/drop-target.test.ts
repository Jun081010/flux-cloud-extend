import { describe, expect, test } from "bun:test";
import type { CandidateRow, TabView } from "@/background/protocol";
import { DEFAULT_SITE_PROFILE } from "@/utils/site-profiles";
import type { MediaCandidate } from "@/utils/media-candidates";
import {
  cloudShareUrl,
  normalizeHttpUrl,
  pickImageUrl,
  resolveDropTargetAt,
  selectDropCandidate,
  upgradeImageUrl,
} from "./drop-target";

function candidate(id: string, videoUrl: string, overrides: Partial<MediaCandidate> = {}): MediaCandidate {
  return {
    id,
    title: id,
    type: "video",
    source: "direct",
    pageUrl: "https://example.com/watch",
    variants: [{ id: `${id}-v`, label: "1080p", videoUrl }],
    rawResourceIds: [],
    fragmentCount: 0,
    downloadable: true,
    ...overrides,
  };
}

function row(
  id: string,
  videoUrl: string,
  options: { elementKey?: string | null; playingVariantId?: string | null; audioUrl?: string } = {},
): CandidateRow {
  const media = candidate(id, videoUrl, options.audioUrl ? {} : {});
  if (options.audioUrl) media.variants[0].audioUrl = options.audioUrl;
  return {
    candidate: media,
    elementKey: options.elementKey ?? null,
    playingVariantId: options.playingVariantId ?? null,
    binding: "exact",
    ruleIds: [],
  };
}

function view(rows: CandidateRow[], activeElementKey: string | null = null): TabView {
  return {
    tabId: 7,
    pageUrl: "https://example.com/watch",
    pageTitle: "Test",
    version: 1,
    activeElementKey,
    playing: [],
    otherElements: [],
    unbound: rows,
    files: [],
    hiddenLowConfidence: 0,
    counts: {},
    handoff: { kind: "no-match", installed: 0 },
    site: { host: "example.com", profileKey: null, profile: DEFAULT_SITE_PROFILE },
    probe: "live",
  };
}

describe("normalizeHttpUrl", () => {
  test("接受 http/https 绝对地址并按 base 解析相对地址", () => {
    expect(normalizeHttpUrl("https://cdn.example.com/a.mp4")).toBe("https://cdn.example.com/a.mp4");
    expect(normalizeHttpUrl("/video/b.mp4?x=1", "https://example.com/watch")).toBe("https://example.com/video/b.mp4?x=1");
  });

  test("拒绝危险协议、空值、纯同页锚点及同页 URL", () => {
    expect(normalizeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeHttpUrl("mailto:a@example.com")).toBeNull();
    expect(normalizeHttpUrl("data:video/mp4,AAAA")).toBeNull();
    expect(normalizeHttpUrl("blob:https://example.com/uuid")).toBeNull();
    expect(normalizeHttpUrl("")).toBeNull();
    expect(normalizeHttpUrl("#section")).toBeNull();
    expect(normalizeHttpUrl("https://example.com/watch#section", "https://example.com/watch")).toBeNull();
  });
});

describe("pickImageUrl", () => {
  const BASE = "https://example.com/page";

  function fakeImg(
    attrs: Record<string, string>,
    options: { currentSrc?: string; closest?: (selector: string) => Element | null } = {},
  ): HTMLImageElement {
    const el = {
      getAttribute: (name: string) => attrs[name] ?? null,
      closest: options.closest ?? (() => null),
      ownerDocument: { baseURI: BASE },
      currentSrc: options.currentSrc ?? "",
    };
    return el as unknown as HTMLImageElement;
  }

  function fakeSource(attrs: Record<string, string>): Element {
    return { getAttribute: (name: string) => attrs[name] ?? null } as unknown as Element;
  }

  function fakePicture(source: Element | null): Element {
    return { querySelector: () => source } as unknown as Element;
  }

  test("currentSrc 优先，相对地址按页面解析", () => {
    expect(pickImageUrl(fakeImg({}, { currentSrc: "https://cdn.example.com/a.png" }))).toBe(
      "https://cdn.example.com/a.png",
    );
    expect(pickImageUrl(fakeImg({ src: "/x/y.jpg" }))).toBe("https://example.com/x/y.jpg");
  });

  test("srcset 无 currentSrc/src 时选最大宽度档", () => {
    expect(pickImageUrl(fakeImg({ srcset: "a.png 320w, b.png 640w, c.png 640w" }))).toBe(
      "https://example.com/b.png",
    );
    expect(pickImageUrl(fakeImg({ srcset: "only.png" }))).toBe("https://example.com/only.png");
  });

  test("blob: currentSrc 回退到 picture source 与懒加载属性", () => {
    const img = fakeImg(
      { "data-src": "/lazy.png" },
      {
        currentSrc: "blob:https://example.com/uuid",
        closest: (selector) => (selector === "picture" ? fakePicture(fakeSource({ srcset: "p1.png 480w, p2.png 960w" })) : null),
      },
    );
    expect(pickImageUrl(img)).toBe("https://example.com/p2.png");
    expect(pickImageUrl(fakeImg({ "data-src": "/lazy.png" }, { currentSrc: "blob:https://example.com/uuid" }))).toBe(
      "https://example.com/lazy.png",
    );
  });

  test("外层 a[href] 指向图片时兜底，非图片扩展名不误发", () => {
    const img = fakeImg(
      {},
      {
        closest: (selector) => (selector === "a[href]" ? fakeSource({ href: "/pic.png" }) : null),
      },
    );
    expect(pickImageUrl(img)).toBe("https://example.com/pic.png");
    const other = fakeImg(
      {},
      {
        closest: (selector) => (selector === "a[href]" ? fakeSource({ href: "/detail" }) : null),
      },
    );
    expect(pickImageUrl(other)).toBeNull();
  });

  test("X 图片取原图：name 尺寸参数统一替换为 orig", () => {
    expect(upgradeImageUrl("https://pbs.twimg.com/media/HXVEogqbMAATWOY?format=jpg&name=900x900")).toBe(
      "https://pbs.twimg.com/media/HXVEogqbMAATWOY?format=jpg&name=orig",
    );
    expect(upgradeImageUrl("https://pbs.twimg.com/media/AbC?name=small")).toBe(
      "https://pbs.twimg.com/media/AbC?format=jpg&name=orig",
    );
    expect(
      pickImageUrl(fakeImg({}, { currentSrc: "https://pbs.twimg.com/media/HXVEogqbMAATWOY?format=jpg&name=900x900" })),
    ).toBe("https://pbs.twimg.com/media/HXVEogqbMAATWOY?format=jpg&name=orig");
  });

  test("X 原图升级覆盖帖子预览图，其它地址不误改", () => {
    const other = "https://pbs.twimg.com/profile_images/123/AbC?name=large";
    expect(upgradeImageUrl(other)).toBe(other);
    const cdn = "https://cdn.example.com/media/a.jpg?name=small";
    expect(upgradeImageUrl(cdn)).toBe(cdn);
    expect(upgradeImageUrl("https://pbs.twimg.com/card_img/1/AbC?name=small")).toBe(
      "https://pbs.twimg.com/card_img/1/AbC?format=jpg&name=orig",
    );
    expect(upgradeImageUrl("https://pbs.twimg.com/media/AbC")).toBe(
      "https://pbs.twimg.com/media/AbC?format=jpg&name=orig",
    );
  });
});

describe("resolveDropTargetAt", () => {
  const rect = (left: number, top: number, width: number, height: number): DOMRect =>
    ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top }) as DOMRect;

  function fakeDoc(element: Element, media: Element[], images: Element[] = [], href = "https://x.com/a/status/1") {
    return {
      elementFromPoint: () => element,
      querySelectorAll: (selector: string) => {
        if (selector === "video,audio") return media;
        if (selector === "img") return images;
        return [];
      },
      location: { href },
      baseURI: href,
    } as unknown as Document;
  }

  test("视频被透明控制层覆盖时仍按矩形命中 video", () => {
    const overlay = {
      localName: "div",
      shadowRoot: null,
      closest: () => null,
      getBoundingClientRect: () => rect(0, 0, 640, 360),
    } as unknown as Element;
    const video = {
      localName: "video",
      currentSrc: "blob:https://x.com/123",
      getAttribute: () => null,
      ownerDocument: { baseURI: "https://x.com/a/status/1" },
      getBoundingClientRect: () => rect(0, 0, 640, 360),
    } as unknown as HTMLVideoElement;
    const target = resolveDropTargetAt(320, 180, fakeDoc(overlay, [video]));
    expect(target.kind).toBe("media");
    expect(target.element).toBe(video);
    expect(target.kind === "media" ? target.url : null).toBe("blob:");
  });

  test("大图被覆盖层挡住时仍返回升级后的原图地址", () => {
    const overlay = {
      localName: "div",
      shadowRoot: null,
      closest: () => null,
      getBoundingClientRect: () => rect(0, 0, 600, 400),
    } as unknown as Element;
    const img = {
      localName: "img",
      currentSrc: "https://pbs.twimg.com/card_img/123/abc?format=jpg&name=small",
      getAttribute: () => null,
      closest: () => null,
      ownerDocument: { baseURI: "https://x.com/a/status/1" },
      getBoundingClientRect: () => rect(0, 0, 600, 400),
    } as unknown as HTMLImageElement;
    const target = resolveDropTargetAt(300, 200, fakeDoc(overlay, [], [img]));
    expect(target.kind).toBe("image");
    expect(target.kind === "image" ? target.url : null).toBe(
      "https://pbs.twimg.com/card_img/123/abc?format=jpg&name=orig",
    );
  });

  test("X 视频未播放时拖到封面，按封面 mediaId 还原为视频落点", () => {
    const overlay = {
      localName: "div",
      shadowRoot: null,
      closest: () => null,
      getBoundingClientRect: () => rect(0, 0, 600, 400),
    } as unknown as Element;
    const img = {
      localName: "img",
      currentSrc: "https://pbs.twimg.com/amplify_video_thumb/2123221745079668737/img/AbC?format=jpg&name=small",
      getAttribute: () => null,
      closest: () => null,
      ownerDocument: { baseURI: "https://x.com/a/status/1" },
      getBoundingClientRect: () => rect(0, 0, 600, 400),
    } as unknown as HTMLImageElement;
    const target = resolveDropTargetAt(300, 200, fakeDoc(overlay, [], [img]));
    expect(target.kind).toBe("media");
    expect(target.kind === "media" ? target.mediaId : null).toBe("2123221745079668737");
    expect(target.kind === "media" ? target.url : "unexpected").toBeNull();
  });

  test("video 元素的 poster 也能提供媒体 ID", () => {
    const overlay = {
      localName: "div",
      shadowRoot: null,
      closest: () => null,
      getBoundingClientRect: () => rect(0, 0, 640, 360),
    } as unknown as Element;
    const video = {
      localName: "video",
      currentSrc: "",
      getAttribute: (name: string) =>
        name === "poster" ? "https://pbs.twimg.com/amplify_video_thumb/555/img/x.jpg" : null,
      ownerDocument: { baseURI: "https://x.com/a/status/1" },
      getBoundingClientRect: () => rect(0, 0, 640, 360),
    } as unknown as HTMLVideoElement;
    const target = resolveDropTargetAt(320, 180, fakeDoc(overlay, [video]));
    expect(target.kind).toBe("media");
    expect(target.kind === "media" ? target.mediaId : null).toBe("555");
  });
});

describe("cloudShareUrl", () => {
  test("识别网盘厂商域名 + /s/ 分享路径，保留提取码 query", () => {
    expect(cloudShareUrl("https://pan.baidu.com/s/19yEaTn2saNsXxEhqjFqSLw?pwd=ju56")).toBe(
      "https://pan.baidu.com/s/19yEaTn2saNsXxEhqjFqSLw?pwd=ju56",
    );
    expect(cloudShareUrl("https://pan.quark.cn/s/abc123")).toBe("https://pan.quark.cn/s/abc123");
  });

  test("识别 123 / 天翼 / 移动云盘的真实分享路径", () => {
    expect(cloudShareUrl("https://1814931019.share.123pan.cn/123pan/yPpeVv-WCTWh")).toBe(
      "https://1814931019.share.123pan.cn/123pan/yPpeVv-WCTWh",
    );
    expect(cloudShareUrl("https://cloud.189.cn/web/share?code=VbAnmuiq6Bfm")).toBe(
      "https://cloud.189.cn/web/share?code=VbAnmuiq6Bfm",
    );
    expect(cloudShareUrl("https://yun.139.com/shareweb/#/w/i/2yA8y7Ni6Kz7i")).toBe(
      "https://yun.139.com/shareweb/#/w/i/2yA8y7Ni6Kz7i",
    );
    expect(cloudShareUrl("https://yun.139.com/w/#/share?linkId=abc")).toBe(
      "https://yun.139.com/w/#/share?linkId=abc",
    );
  });

  test("非厂商域名、非分享路径、危险协议一律拒绝", () => {
    expect(cloudShareUrl("https://example.com/s/abc")).toBeNull();
    expect(cloudShareUrl("https://pan.baidu.com/watch/abc")).toBeNull();
    expect(cloudShareUrl("https://pan.baidu.com/")).toBeNull();
    expect(cloudShareUrl("https://cloud.189.cn/web/main")).toBeNull();
    expect(cloudShareUrl("https://1814931019.share.123pan.cn/")).toBeNull();
    expect(cloudShareUrl("javascript:alert(1)")).toBeNull();
    expect(cloudShareUrl("not a url")).toBeNull();
  });
});

describe("selectDropCandidate", () => {
  test("优先匹配 videoUrl 与 audioUrl，并使用播放中清晰度", () => {
    const matched = row("matched", "https://cdn.example.com/v.mp4", { playingVariantId: "matched-v" });
    const audioMatched = row("audio", "https://cdn.example.com/other.mp4", { audioUrl: "https://cdn.example.com/a.m4a" });
    const active = row("active", "https://cdn.example.com/active.mp4", { elementKey: "active" });
    const result = selectDropCandidate(view([active, matched, audioMatched], "active"), "https://cdn.example.com/a.m4a");
    expect(result?.row.candidate.id).toBe("audio");
    expect(result?.variantId).toBe("audio-v");
    expect(result?.reason).toBeNull();
  });

  test("URL 不匹配时回退到当前活动元素对应行", () => {
    const active = row("active", "https://cdn.example.com/active.mp4", { elementKey: "active" });
    const first = row("first", "https://cdn.example.com/first.mp4");
    const result = selectDropCandidate(view([first, active], "active"), "blob:");
    expect(result?.row.candidate.id).toBe("active");
    expect(result?.variantId).toBe("active-v");
  });

  test("活动元素无对应行时退到第一个可下载候选", () => {
    const first = row("first", "https://cdn.example.com/first.mp4");
    const second = row("second", "https://cdn.example.com/second.mp4");
    expect(selectDropCandidate(view([first, second], "missing"), null)?.row.candidate.id).toBe("first");
  });

  test("优先使用小球落到的元素 key，而不是当前活动元素", () => {
    const active = row("active", "https://cdn.example.com/active.mp4", { elementKey: "active" });
    const hovered = row("hovered", "https://cdn.example.com/hovered.mp4", { elementKey: "hovered" });
    const result = selectDropCandidate(view([active, hovered], "active"), "blob:", "hovered");
    expect(result?.row.candidate.id).toBe("hovered");
  });

  test("无候选返回 null", () => {
    expect(selectDropCandidate(view([]), "blob:")).toBeNull();
    expect(selectDropCandidate(null, "blob:")).toBeNull();
  });

  test("protected / browserOnly 候选不会被选中下载", () => {
    const protectedRow = row("protected", "https://cdn.example.com/protected.mp4");
    protectedRow.candidate.protected = true;
    const browserOnlyRow = row("browser", "https://cdn.example.com/browser.mp4");
    browserOnlyRow.candidate.browserOnly = true;
    const unusable = row("fragments", "https://cdn.example.com/fragments.mp4");
    unusable.candidate.downloadable = false;
    const result = selectDropCandidate(view([unusable, protectedRow, browserOnlyRow]), "blob:");
    expect(result?.row.candidate.id).toBe("protected");
    expect(result?.reason).toBe("protected");

    const resultWithoutProtected = selectDropCandidate(view([unusable, browserOnlyRow]), "blob:");
    expect(resultWithoutProtected?.row.candidate.id).toBe("browser");
    expect(resultWithoutProtected?.reason).toBe("browserOnly");
    expect(selectDropCandidate(view([unusable]), "blob:")).toBeNull();
  });

  test("封面 mediaId 精确匹配对应视频流，匹配不到不误下其它视频", () => {
    const first = row("first", "https://video.twimg.com/amplify_video/111/pl/a.m3u8");
    const second = row("second", "https://video.twimg.com/ext_tw_video/222/pu/vid/1.mp4");
    const result = selectDropCandidate(view([first, second], "first"), "blob:", null, "222");
    expect(result?.row.candidate.id).toBe("second");
    expect(selectDropCandidate(view([first, second], "first"), "blob:", null, "333")).toBeNull();
  });
});
