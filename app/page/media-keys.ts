/**
 * 媒体元素 key 的跨入口共享表。
 *
 * sensor.content 与 panel.content 是两个独立的 content script，但同一扩展在同一帧的
 * isolated world 是共用的。用 Symbol.for 在 globalThis 上共享 MediaTracker 的 WeakMap，
 * 面板拖动小球落到视频上时就能拿到该元素在后台视图里的精确 key，而不是退到
 * 「当前活动元素」去猜。
 */
const REGISTRY_KEY = Symbol.for("fluxdown.mediaElementKeys");

type KeyMap = WeakMap<Element, string>;

export function publishMediaKeys(keys: WeakMap<Element, string>): void {
  (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = keys;
}

export function mediaElementKey(element: Element | null | undefined): string | null {
  if (!element) return null;
  const keys = (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
  if (!(keys instanceof WeakMap)) return null;
  return (keys as KeyMap).get(element) ?? null;
}
