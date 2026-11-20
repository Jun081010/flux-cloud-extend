/**
 * 任意 URL 下载（链接抓取 / 快速下载 / 拖球落到链接）与媒体候选的配对。
 *
 * 这类入口只拿到一个 URL，没有「清晰度」上下文。若该 URL 正好是某个
 * 「视频轨 + 独立音频轨」候选的视频地址，只发视频地址会得到无声视频
 * （B 站 DASH、带 EXT-X-MEDIA 的 HLS 都属此类），因此需要回落到候选下载，
 * 让桌面端同时拿到 audioUrl 并在本地合并。
 *
 * 只匹配视频轨：用户明确选音频轨时应保持「下载这个音频文件」的原行为。
 */
import type { MediaCandidate, MediaCandidateVariant } from "./media-candidates";

export interface AudioPairRow {
  candidate: MediaCandidate;
}

export interface AudioPairMatch<T extends AudioPairRow> {
  row: T;
  variant: MediaCandidateVariant;
}

function mediaKey(url: string): string {
  // 片段的 #t= 只影响播放器定位，不是资源身份的一部分。
  const hash = url.indexOf("#");
  return hash >= 0 ? url.slice(0, hash) : url;
}

function isAbsoluteHttpUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

/**
 * 在候选行里查找「该 URL 是视频轨且存在独立音频轨」的档位。
 *
 * 行顺序即优先级（调用方传 `allRows(view)`，正在播放的候选在前），
 * 因此同一地址命中多个候选时取第一个。
 */
export function findAudioPair<T extends AudioPairRow>(
  rows: readonly T[],
  url: string,
): AudioPairMatch<T> | null {
  if (!isAbsoluteHttpUrl(url)) return null;
  const wanted = mediaKey(url);
  for (const row of rows) {
    const candidate = row.candidate;
    if (!candidate.downloadable || candidate.protected || candidate.browserOnly) continue;
    for (const variant of candidate.variants) {
      if (!isAbsoluteHttpUrl(variant.audioUrl)) continue;
      if (mediaKey(variant.audioUrl) === wanted) continue;
      if (mediaKey(variant.videoUrl) !== wanted) continue;
      return { row, variant };
    }
  }
  return null;
}
