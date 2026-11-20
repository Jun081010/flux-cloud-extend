import { describe, expect, test } from "bun:test";
import type { MediaCandidate } from "./media-candidates";
import { findAudioPair } from "./audio-pairing";

function candidate(
  id: string,
  videoUrl: string,
  audioUrl?: string,
  extra: Partial<MediaCandidate> = {},
): MediaCandidate {
  return {
    id,
    title: id,
    type: "video",
    source: "dash",
    pageUrl: "https://example.com/watch",
    variants: [{ id: `${id}:0`, label: "1080p", videoUrl, ...(audioUrl ? { audioUrl } : {}) }],
    rawResourceIds: [],
    fragmentCount: 0,
    downloadable: true,
    ...extra,
  };
}

describe("findAudioPair", () => {
  test("命中带独立音轨的视频档", () => {
    const row = { candidate: candidate("dash", "https://cdn.example.com/v.m4s", "https://cdn.example.com/a.m4s") };
    const match = findAudioPair([row], "https://cdn.example.com/v.m4s");
    expect(match?.row).toBe(row);
    expect(match?.variant.audioUrl).toBe("https://cdn.example.com/a.m4s");
  });

  test("用户选的是音频轨时不配对，保持单独下载音频", () => {
    const row = { candidate: candidate("dash", "https://cdn.example.com/v.m4s", "https://cdn.example.com/a.m4s") };
    expect(findAudioPair([row], "https://cdn.example.com/a.m4s")).toBeNull();
  });

  test("没有独立音轨的直链不配对", () => {
    const row = { candidate: candidate("direct", "https://cdn.example.com/full.mp4") };
    expect(findAudioPair([row], "https://cdn.example.com/full.mp4")).toBeNull();
  });

  test("受保护 / 仅浏览器可取 / 不可下载的候选不配对", () => {
    const url = "https://cdn.example.com/v.m4s";
    const audio = "https://cdn.example.com/a.m4s";
    expect(findAudioPair([{ candidate: candidate("drm", url, audio, { protected: true }) }], url)).toBeNull();
    expect(findAudioPair([{ candidate: candidate("sw", url, audio, { browserOnly: true }) }], url)).toBeNull();
    expect(findAudioPair([{ candidate: candidate("frag", url, audio, { downloadable: false }) }], url)).toBeNull();
  });

  test("忽略片段，且跳过非 http(s) 音频地址", () => {
    const row = { candidate: candidate("dash", "https://cdn.example.com/v.m4s", "blob:https://example.com/x") };
    expect(findAudioPair([row], "https://cdn.example.com/v.m4s#t=10")).toBeNull();

    const plain = { candidate: candidate("dash2", "https://cdn.example.com/v.m4s", "https://cdn.example.com/a.m4s") };
    expect(findAudioPair([plain], "https://cdn.example.com/v.m4s#t=10")?.variant.id).toBe("dash2:0");
  });

  test("同一地址命中多个候选时取顺序靠前的一个（正在播放优先）", () => {
    const first = { candidate: candidate("playing", "https://cdn.example.com/v.m4s", "https://cdn.example.com/a1.m4s") };
    const second = { candidate: candidate("other", "https://cdn.example.com/v.m4s", "https://cdn.example.com/a2.m4s") };
    expect(findAudioPair([first, second], "https://cdn.example.com/v.m4s")?.row).toBe(first);
  });
});
