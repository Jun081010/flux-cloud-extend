/** 悬浮球（拖动 / 贴边吸附 / 位置记忆）+ 资源面板（ResourceList compact）。 */
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";
import type { CloudPageFile, TabView } from "@/background/protocol";
import type { PageConfig } from "@/page/bridge";
import { mediaElementKey } from "@/page/media-keys";
import { saveSiteProfile, DEFAULT_SITE_PROFILE } from "@/utils/site-profiles";
import { sendAction } from "@/utils/messaging";
import {
  cloudVendorForPage,
  isCloudSharePageUrl,
  supportsCloudShareAutoDownload,
} from "@/utils/cloud-sites";
import { Icon } from "@/ui/components/Icon";
import { IconButton } from "@/ui/components/IconButton";
import { showToast, ToastHost } from "@/ui/components/Toast";
import { formatBytes } from "@/ui/format";
import { ResourceList } from "@/ui/features/ResourceList";
import { useTabView } from "@/ui/hooks/useTabView";
import { useT } from "@/ui/i18n";
import { useThemeAttr } from "@/ui/theme";
import { cloudShareUrl, resolveDropTargetAt, selectDropCandidate, type DropTarget } from "./drop-target";

const DOT_POS_KEY = "fluxdown_dot_pos";
const DOT_SIZE = 36;
const CORE_SIZE = 14;
const CORE_DRAW_THRESHOLD = 4;
const CORE_RETURN_RADIUS = 28;
const PANEL_W = 380;
const PANEL_H = 460;

type Side = "left" | "right";
type DropFeedback = { x: number; y: number; width: number; height: number; kind: string };

/** 百度分享页：悬浮球直接和 MAIN world 的 baidu-page.js 通信，绕开后台 scripting.executeScript。 */
type BaiduPageResult = {
  ok: boolean;
  items?: CloudPageFile[];
  path?: string[];
  canUp?: boolean;
  url?: string;
  filename?: string;
  size?: number;
  headers?: Record<string, string>;
  error?: string;
};

function baiduPageRequest(op: "list" | "open" | "up" | "download", id?: string): Promise<BaiduPageResult> {
  return new Promise((resolve) => {
    const requestId = `fd-baidu-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let settled = false;
    const finish = (result: BaiduPageResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { __fluxdownBaiduPageResponse?: number; requestId?: string; result?: BaiduPageResult } | null;
      if (!data || data.__fluxdownBaiduPageResponse !== 1 || data.requestId !== requestId) return;
      finish(data.result && typeof data.result === "object" ? data.result : { ok: false, error: "百度页面返回了无效数据" });
    };
    const timeoutMs = op === "download" ? 120_000 : 20_000;
    const timer = setTimeout(() => finish({ ok: false, error: "百度页面响应超时，请刷新页面后重试" }), timeoutMs);
    window.addEventListener("message", onMessage);
    try {
      window.postMessage({ __fluxdownBaiduPageRequest: 1, requestId, op, id }, window.location.origin);
    } catch {
      finish({ ok: false, error: "无法与百度页面通信，请刷新页面后重试" });
    }
  });
}

/** 徽标数 = 候选可见行（variants 数，至少 1）+ 文件数，与 background 的徽标口径一致。 */
function badgeCount(view: TabView | null): number {
  if (!view) return 0;
  let n = view.files.length;
  for (const r of [...view.playing, ...view.otherElements, ...view.unbound]) {
    n += Math.max(r.candidate.variants.length, 1);
  }
  return n;
}

export function PanelApp(props: { host: HTMLElement }): JSX.Element | null {
  const t = useT();
  useThemeAttr(props.host);
  const view = useTabView("sender").value;
  const cloudVendor = cloudVendorForPage(location.href);
  const cloudSharePage = isCloudSharePageUrl(location.href);
  const cloudShareAuto = cloudVendor ? supportsCloudShareAutoDownload(cloudVendor.id) : false;
  const currentShareUrl = cloudSharePage ? cloudShareUrl(location.href) : null;
  const cloudBrowsable = (cloudVendor?.id === "pan123" || cloudVendor?.id === "baidu") && cloudSharePage;

  const [config, setConfig] = useState<PageConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [cloudItems, setCloudItems] = useState<CloudPageFile[]>([]);
  const [cloudPath, setCloudPath] = useState<string[]>([]);
  const [cloudCanUp, setCloudCanUp] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  // 失败的是某个文件下载时，错误条上的“重试”必须重跑下载本身；
  // 只重新 list 会让用户以为“登录后仍然失败”（登录态已恢复但下载没重发）。
  const [cloudRetryFile, setCloudRetryFile] = useState<CloudPageFile | null>(null);
  const [cloudBusyId, setCloudBusyId] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("right");
  const [y, setY] = useState(() => Math.round(window.innerHeight * 0.4));
  const [dragLeft, setDragLeft] = useState<number | null>(null);
  const [core, setCore] = useState<{ x: number; y: number } | null>(null);
  const [dropFeedback, setDropFeedback] = useState<DropFeedback | null>(null);
  const dotRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, moved: 0, startX: 0, startY: 0, startLeft: 0, startTop: 0, didDrag: false });
  const coreDrag = useRef({
    active: false,
    shift: false,
    moved: 0,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    pinned: false,
    grabDx: CORE_SIZE / 2,
    grabDy: CORE_SIZE / 2,
    lastX: 0,
    lastY: 0,
  });
  const lastCoreRelease = useRef(0);
  const cloudHintShown = useRef(false);
  const cloudLoaded = useRef(false);

  const applyCloudResult = (res: { ok: boolean; items?: CloudPageFile[]; path?: string[]; canUp?: boolean; error?: string } | null) => {
    if (!res?.ok) {
      setCloudError(res?.error || t("panel.cloudLoadFailed"));
      return false;
    }
    setCloudItems(res.items ?? []);
    setCloudPath(res.path ?? []);
    setCloudCanUp(!!res.canUp);
    return true;
  };

  const loadCloudDir = async (op: "list" | "up"): Promise<void> => {
    if (!cloudBrowsable) return;
    setCloudLoading(true);
    setCloudError(null);
    setCloudRetryFile(null);
    const res = cloudVendor?.id === "baidu"
      ? await baiduPageRequest(op)
      : await sendAction<"cloudPage">({ action: "cloudPage", op }).catch(() => null);
    setCloudLoading(false);
    applyCloudResult(res);
  };

  const openCloudFolder = async (file: CloudPageFile): Promise<void> => {
    if (!cloudBrowsable) return;
    setCloudBusyId(file.id);
    setCloudError(null);
    const res = cloudVendor?.id === "baidu"
      ? await baiduPageRequest("open", file.id)
      : await sendAction<"cloudPage">({ action: "cloudPage", op: "open", id: file.id }).catch(() => null);
    setCloudBusyId(null);
    applyCloudResult(res);
  };

  const downloadCloudFile = async (file: CloudPageFile): Promise<void> => {
    if (!cloudBrowsable) return;
    setCloudBusyId(file.id);
    setCloudError(null);
    setCloudRetryFile(null);
    const baidu = cloudVendor?.id === "baidu";
    const pageRes = baidu
      ? await baiduPageRequest("download", file.id)
      : await sendAction<"cloudPage">({ action: "cloudPage", op: "download", id: file.id }).catch(() => null);
    setCloudBusyId(null);
    if (!baidu) {
      if (pageRes?.ok) showToast(t("list.sent"), "success");
      else {
        setCloudError(pageRes?.error || t("list.sendFailed"));
        setCloudRetryFile(file);
      }
      return;
    }
    if (!pageRes?.ok || typeof pageRes.url !== "string" || pageRes.url.length === 0) {
      setCloudError(pageRes?.error || t("list.sendFailed"));
      setCloudRetryFile(file);
      return;
    }
    const send = await sendAction<"cloudDownload">({
      action: "cloudDownload",
      items: [{
        url: pageRes.url,
        filename: typeof pageRes.filename === "string" ? pageRes.filename : undefined,
        size: typeof pageRes.size === "number" ? pageRes.size : undefined,
        headers: pageRes.headers && typeof pageRes.headers === "object" ? pageRes.headers : undefined,
        referrer: location.href,
      }],
    }).catch(() => null);
    if (send?.ok && send.success && send.failed === 0) showToast(t("list.sent"), "success");
    else if (send && !send.ok) {
      setCloudError(send.error || t("list.sendFailed"));
      setCloudRetryFile(file);
    } else if (send && !send.success) {
      setCloudError(send.message || t("list.sendFailed"));
      setCloudRetryFile(file);
    } else {
      setCloudError(t("list.sendFailed"));
      setCloudRetryFile(file);
    }
  };

  // PageConfig：自己拉取并跟随 pageConfigChanged（不在内容脚本里加载完整 settings）
  useEffect(() => {
    let alive = true;
    const load = () =>
      void sendAction({ action: "getPageConfig", pageUrl: location.href })
        .then((c) => {
          const next = c as PageConfig | undefined;
          if (alive && next && typeof next.pageDot === "boolean" && typeof next.sniff === "boolean") setConfig(next);
        })
        .catch(() => {});
    load();
    const onMessage = (msg: unknown) => {
      if ((msg as { action?: string } | null)?.action === "pageConfigChanged") load();
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      alive = false;
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  // 打开面板时读取当前网盘分享目录（同一页面只自动读一次）。
  useEffect(() => {
    if (!open || !cloudBrowsable || cloudLoaded.current) return;
    cloudLoaded.current = true;
    void loadCloudDir("list");
  }, [open, cloudBrowsable]);

  // 位置记忆
  useEffect(() => {
    browser.storage.local
      .get(DOT_POS_KEY)
      .then((r) => {
        const pos = r[DOT_POS_KEY] as { y?: unknown; side?: unknown } | undefined;
        if (!pos) return;
        if (typeof pos.y === "number" && pos.y > 0) setY(Math.min(pos.y, window.innerHeight - 56));
        if (pos.side === "left" || pos.side === "right") setSide(pos.side);
      })
      .catch(() => {});
  }, []);

  // background 转发的 openPanel
  useEffect(() => {
    const onMessage = (msg: unknown) => {
      if ((msg as { action?: string } | null)?.action === "openPanel") setOpen(true);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  // 视口变化（旋转 / 地址栏收放 / 软键盘）：重算面板与圆点位置
  const [, setViewportTick] = useState(0);
  useEffect(() => {
    const bump = () => setViewportTick((n) => n + 1);
    window.addEventListener("resize", bump);
    window.visualViewport?.addEventListener("resize", bump);
    return () => {
      window.removeEventListener("resize", bump);
      window.visualViewport?.removeEventListener("resize", bump);
    };
  }, []);

  // Esc / 点击外部（composedPath 穿透 Shadow DOM）关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const path = e.composedPath();
      if (path.includes(panelRef.current as EventTarget) || path.includes(dotRef.current as EventTarget)) return;
      // 预览弹层属于面板内部（fixed 渲染，不在 panelEl 的 DOM 子树外），composedPath 已覆盖
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  const profile = view?.site.profile ?? DEFAULT_SITE_PROFILE;
  // 悬浮球可见性：pageDot 已含 settings.showPageDot 与站点配置；嗅探开关只控制资源检测
  const visible = !!config && config.pageDot;

  // openPanel（浮钮菜单）不受球可见性约束：只要有视图就允许打开面板
  if (!view) return null;

  const count = badgeCount(view);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !dotRef.current) return;
    const rect = dotRef.current.getBoundingClientRect();
    if (e.shiftKey) {
      e.preventDefault();
      coreDrag.current = {
        active: true,
        shift: true,
        moved: 0,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX - CORE_SIZE / 2,
        y: e.clientY - CORE_SIZE / 2,
        pinned: false,
        grabDx: CORE_SIZE / 2,
        grabDy: CORE_SIZE / 2,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      try {
        dotRef.current.setPointerCapture(e.pointerId);
      } catch {
        /* 合成指针（自动化测试）可能没有可捕获的 pointerId */
      }
      setDropFeedback(null);
      return;
    }
    drag.current = {
      active: true,
      moved: 0,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      didDrag: false,
    };
    dotRef.current.setPointerCapture(e.pointerId);
  };

  const clampCore = (x: number, y: number) => ({
    x: Math.max(2, Math.min(window.innerWidth - CORE_SIZE - 2, x)),
    y: Math.max(2, Math.min(window.innerHeight - CORE_SIZE - 2, y)),
  });

  // 拖动中实时解析落点：可下载目标给出高亮框坐标，小球同步变色
  const updateDropFeedback = (pointer: { x: number; y: number }) => {
    const target = resolveDropTargetAt(pointer.x, pointer.y);
    if (target.kind === "none") {
      setDropFeedback(null);
      return;
    }
    const rect = target.element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setDropFeedback(null);
      return;
    }
    setDropFeedback({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, kind: target.kind });
  };

  const handleDrop = async (target: DropTarget): Promise<boolean> => {
    if (target.kind === "none") return false;
    const sendUrls = async (url: string) => {
      const res = await sendAction({ action: "downloadUrls", urls: [url], referrer: location.href }).catch(() => null);
      if (res?.success) showToast(t("list.sent"), "success");
      else showToast(res?.message || t("list.sendFailed"), "error");
      return !!res?.success;
    };
    if (target.kind === "share") {
      if (target.code) {
        try {
          await navigator.clipboard.writeText(target.code);
        } catch {
          /* 复制失败不阻断流程：页面内仍会自动带出 pwd 参数 */
        }
      }
      const res = await sendAction<"openShareUrl">({ action: "openShareUrl", url: target.url }).catch(() => null);
      if (res?.ok) {
        showToast(
          target.code ? t("float.shareOpened", { code: target.code }) : t("float.shareOpenedNoCode"),
          "success",
        );
      } else {
        const detail = res?.message && res.message !== "not a cloud share url" ? res.message : "";
        showToast(detail || t("float.shareOpenFailed"), "error");
      }
      return !!res?.ok;
    }
    if (target.kind === "image" || target.kind === "file") return sendUrls(target.url);

    const direct = target.url && target.url !== "blob:" ? target.url : null;
    const elementKey = target.kind === "media" ? mediaElementKey(target.element) : null;
    const mediaId = target.kind === "media" ? target.mediaId : null;
    // 拖到 video/audio 上：优先匹配嗅探候选，走 downloadCandidate 保留音频轨（桌面端负责 mux 合并）
    const mediaCandidate = direct ? selectDropCandidate(view, direct, elementKey, mediaId) : null;
    if (target.kind === "media" && mediaCandidate && mediaCandidate.reason === null) {
      const res = await sendAction({
        action: "downloadCandidate",
        tabId: view.tabId,
        candidateId: mediaCandidate.row.candidate.id,
        variantId: mediaCandidate.variantId ?? undefined,
      }).catch(() => null);
      if (res?.success) showToast(t("list.sent"), "success");
      else showToast(res?.message || t("list.sendFailed"), "error");
      return !!res?.success;
    }
    if (direct) {
      const ok = await sendUrls(direct);
      if (ok) return true;
    }
    const picked = selectDropCandidate(view, null, elementKey, mediaId);
    if (!picked) {
      if (mediaId) showToast(t("float.videoNeedPlayHint"), "error");
      else if (!direct) showToast(t("notify.videoSourceUnavailableTitle"), "error");
      return false;
    }
    if (picked.reason === "protected" || picked.reason === "browserOnly") {
      showToast(picked.reason === "protected" ? t("float.protectedHint") : t("float.browserOnlyHint"), "error");
      return false;
    }
    const res = await sendAction({
      action: "downloadCandidate",
      tabId: view.tabId,
      candidateId: picked.row.candidate.id,
      variantId: picked.variantId ?? undefined,
    }).catch(() => null);
    if (res?.success) showToast(t("list.sent"), "success");
    else showToast(res?.message || t("list.sendFailed"), "error");
    return !!res?.success;
  };

  const openCurrentShare = async () => {
    if (!currentShareUrl) return;
    const res = await sendAction<"openShareUrl">({ action: "openShareUrl", url: currentShareUrl }).catch(() => null);
    if (res?.ok) {
      showToast(cloudShareAuto ? t("float.shareOpenedNoCode") : t("panel.cloudShareOpenedManual"), "success");
    } else {
      showToast(res?.message || t("float.shareOpenFailed"), "error");
    }
  };

  const finishCore = (e: PointerEvent | null) => {
    const d = coreDrag.current;
    if (!d.active) return;
    setDropFeedback(null);
    lastCoreRelease.current = performance.now();
    const pointer = e ? { x: e.clientX, y: e.clientY } : { x: d.lastX, y: d.lastY };
    if ((d.shift && !d.pinned) || (!d.shift && d.moved <= 2)) {
      d.active = false;
      setCore(null);
      return;
    }
    d.active = false;
    const dotRect = dotRef.current?.getBoundingClientRect();
    if (
      dotRect &&
      Math.hypot(pointer.x - (dotRect.left + DOT_SIZE / 2), pointer.y - (dotRect.top + DOT_SIZE / 2)) < CORE_RETURN_RADIUS
    ) {
      setCore(null);
      return;
    }
    const target = resolveDropTargetAt(pointer.x, pointer.y);
    if (target.kind === "none") {
      if (target.reason !== "no-element") showToast(t("notify.videoSourceUnavailableTitle"), "error");
      return;
    }
    void handleDrop(target).then((ok) => {
      if (ok) setCore(null);
    });
  };

  const onCorePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !coreRef.current) return;
    e.preventDefault();
    setDropFeedback(null);
    const rect = coreRef.current.getBoundingClientRect();
    coreDrag.current = {
      active: true,
      shift: false,
      moved: 0,
      startX: e.clientX,
      startY: e.clientY,
      x: rect.left,
      y: rect.top,
      pinned: true,
      grabDx: e.clientX - rect.left,
      grabDy: e.clientY - rect.top,
      lastX: e.clientX,
      lastY: e.clientY,
    };
    try {
      coreRef.current.setPointerCapture(e.pointerId);
    } catch {
      /* 同上 */
    }
  };

  const onCorePointerUp = (e: PointerEvent) => {
    e.preventDefault();
    finishCore(e);
  };

  const onPointerMove = (e: PointerEvent) => {
    const cd = coreDrag.current;
    if (cd.active) {
      cd.moved++;
      cd.lastX = e.clientX;
      cd.lastY = e.clientY;
      if (cd.shift) {
        if (!cd.pinned && cd.moved > 2 && Math.hypot(e.clientX - cd.startX, e.clientY - cd.startY) > CORE_DRAW_THRESHOLD) {
          cd.pinned = true;
        }
        if (cd.pinned) {
          const next = clampCore(e.clientX - CORE_SIZE / 2, e.clientY - CORE_SIZE / 2);
          cd.x = next.x;
          cd.y = next.y;
          setCore(next);
          updateDropFeedback({ x: e.clientX, y: e.clientY });
        }
      } else if (cd.pinned) {
        const next = clampCore(e.clientX - cd.grabDx, e.clientY - cd.grabDy);
        cd.x = next.x;
        cd.y = next.y;
        setCore(next);
        updateDropFeedback({ x: e.clientX, y: e.clientY });
      }
      return;
    }
    const d = drag.current;
    if (!d.active) return;
    d.moved++;
    if (d.moved < 3) return;
    if (!d.didDrag) {
      d.didDrag = true;
      setOpen(false); // 拖动是重新定位，面板碍事
    }
    // 拖动后必须完整留在视口内，否则用户会点不到悬浮球
    setDragLeft(
      Math.max(2, Math.min(window.innerWidth - DOT_SIZE - 2, d.startLeft + (e.clientX - d.startX))),
    );
    setY(Math.max(20, Math.min(window.innerHeight - 56, d.startTop + (e.clientY - d.startY))));
  };

  const endDrag = () => {
    if (coreDrag.current.active) {
      finishCore(null);
      return;
    }
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    if (!d.didDrag) return;
    const rect = dotRef.current?.getBoundingClientRect();
    const nextSide: Side = (rect?.left ?? 0) + DOT_SIZE / 2 < window.innerWidth / 2 ? "left" : "right";
    const nextY = Math.round(rect?.top ?? y);
    setSide(nextSide);
    setY(nextY);
    setDragLeft(null);
    void browser.storage.local.set({ [DOT_POS_KEY]: { y: nextY, side: nextSide } });
  };

  const hideDot = () => {
    setOpen(false);
    // #862：只关当前站点的悬浮球，不动全局开关；写到命中的配置 key（无命中则新建当前 host）
    const key = view.site.profileKey ?? view.site.host;
    if (!key) return;
    void saveSiteProfile(key, { ...profile, pageDot: false, updatedAt: Date.now() });
  };

  // 面板高度不超过视口（矮视口 / 横屏）；窄屏的横向定位由 panel.css 的媒体查询覆盖
  const panelH = Math.min(PANEL_H, window.innerHeight - 20);
  let panelTop = y - 20;
  if (panelTop + panelH > window.innerHeight - 10) panelTop = window.innerHeight - panelH - 10;
  if (panelTop < 10) panelTop = 10;
  const panelStyle =
    side === "left"
      ? { top: `${panelTop}px`, left: "52px", maxHeight: `${panelH}px` }
      : { top: `${panelTop}px`, right: "52px", maxHeight: `${panelH}px` };
  // 旋转 / 缩放视口后圆点不能落到视口外
  const dotTop = Math.max(0, Math.min(y, window.innerHeight - 56));

  return (
    <>
      {visible ? <button
        ref={dotRef}
        type="button"
        class={`fluxdown-dot ${side}${open ? " active" : ""}${dragLeft !== null ? " dragging" : ""}${dropFeedback ? " can-drop" : ""}`}
        style={{ top: `${dotTop}px`, left: dragLeft !== null ? `${dragLeft}px` : undefined }}
        title="FluxDown"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => {
          if (performance.now() - lastCoreRelease.current < 300) return;
          if (!drag.current.didDrag) {
            const next = !open;
            setOpen(next);
            if (next && cloudVendor && !cloudHintShown.current) {
              cloudHintShown.current = true;
              showToast(
                cloudSharePage
                  ? (cloudShareAuto ? t("float.cloudShareDetected") : t("float.cloudShareDetectedManual"))
                  : t("float.cloudDetected"),
                "success",
              );
            }
          }
          drag.current.didDrag = false;
        }}
      >
        <span class="fluxdown-core" />
        <span class={`dot-badge${count > 0 ? " show" : ""}`}>{count > 99 ? "99+" : count}</span>
      </button> : null}

      {dropFeedback ? (
        <div
          class={`fd-drop-ring fd-drop-${dropFeedback.kind}`}
          style={{
            top: `${dropFeedback.y}px`,
            left: `${dropFeedback.x}px`,
            width: `${dropFeedback.width}px`,
            height: `${dropFeedback.height}px`,
          }}
        />
      ) : null}

      {core ? (() => {
        const pos = clampCore(core.x, core.y);
        return (
          <div
            ref={coreRef}
            class={`fluxdown-core-free${coreDrag.current.active ? " dragging" : ""}${dropFeedback ? " can-drop" : ""}`}
            style={{ top: `${pos.y}px`, left: `${pos.x}px` }}
            onPointerDown={onCorePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onCorePointerUp}
            onPointerCancel={onCorePointerUp}
          />
        );
      })() : null}

      <div ref={panelRef} class={`fluxdown-panel ${side}${open ? " visible" : ""}`} style={panelStyle} aria-hidden={!open}>
        <div class="panel-header">
          <Icon name="logo" size={16} class="logo" />
          <span class="title">FluxDown</span>
          <span class="resource-count">{count > 0 ? `${count} ${t("panel.resources")}` : ""}</span>
          <IconButton
            icon="trash"
            label={t("panel.clearResourcesTitle")}
            size={14}
            onClick={() => void sendAction<"clearResources">({ action: "clearResources" })}
          />
          <IconButton icon="eyeOff" label={t("panel.hideDot")} size={14} onClick={hideDot} />
          <IconButton icon="close" label={t("panel.collapse")} size={14} onClick={() => setOpen(false)} />
        </div>
        <div class="panel-body">
          {open && cloudBrowsable ? (
            <div class="fd-cloud-browser">
              <div class="fd-cloud-browser-head">
                <span class="fd-cloud-browser-title">{t("panel.cloudFilesTitle")}</span>
                <div class="fd-cloud-browser-actions">
                  {cloudCanUp ? (
                    <button type="button" disabled={cloudLoading} onClick={() => void loadCloudDir("up")}>
                      {t("panel.cloudBack")}
                    </button>
                  ) : null}
                  <button type="button" disabled={cloudLoading} onClick={() => void loadCloudDir("list")}>
                    {t("panel.cloudRefresh")}
                  </button>
                </div>
              </div>
              {cloudPath.length > 0 ? <div class="fd-cloud-path">{cloudPath.join(" / ")}</div> : null}
              {cloudLoading ? <div class="fd-cloud-status">{t("panel.cloudLoading")}</div> : null}
              {cloudError ? (
                <div class="fd-cloud-status fd-cloud-error">
                  <span>{cloudError}</span>
                  <button
                    type="button"
                    onClick={() => void (cloudRetryFile ? downloadCloudFile(cloudRetryFile) : loadCloudDir("list"))}
                  >
                    {t("panel.cloudRetry")}
                  </button>
                </div>
              ) : null}
              {!cloudLoading && cloudItems.length === 0 && !cloudError ? (
                <div class="fd-cloud-status">{t("panel.cloudEmpty")}</div>
              ) : null}
              {cloudItems.length > 0 ? (
                <div class="fd-cloud-list">
                  {cloudItems.map((item) => (
                    <div class="fd-cloud-row" key={item.id}>
                      <span class={`fd-cloud-kind ${item.isDir ? "dir" : "file"}`}>{item.isDir ? "DIR" : "FILE"}</span>
                      <span class="fd-cloud-name" title={item.name}>{item.name}</span>
                      <span class="fd-cloud-meta">{item.isDir ? t("panel.cloudFolder") : formatBytes(item.size)}</span>
                      <button
                        type="button"
                        class="fd-cloud-row-action"
                        disabled={cloudBusyId !== null}
                        onClick={() => void (item.isDir ? openCloudFolder(item) : downloadCloudFile(item))}
                      >
                        {cloudBusyId === item.id ? "…" : item.isDir ? t("panel.cloudOpen") : t("panel.cloudDownload")}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {open && cloudVendor && !cloudBrowsable ? (
            <div class="fd-cloud-hint">
              <div>{cloudSharePage ? t("panel.cloudUnsupported") : t("panel.cloudHint")}</div>
              {currentShareUrl ? (
                <div class="fd-cloud-share">
                  <div class="fd-cloud-share-url" title={currentShareUrl}>{currentShareUrl}</div>
                  <button class="fd-cloud-share-action" type="button" onClick={() => void openCurrentShare()}>
                    {cloudShareAuto ? t("panel.cloudShareParse") : t("panel.cloudShareOpenManual")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {open ? <ResourceList view={view} density="compact" showSearch={false} /> : null}
        </div>
      </div>
      <ToastHost />
    </>
  );
}
