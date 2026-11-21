import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { TabView, TabViewPush } from "./protocol";

function event<Args extends unknown[]>() {
  const listeners: ((...args: Args) => void)[] = [];
  return {
    addListener: (listener: (...args: Args) => void) => listeners.push(listener),
    emit: (...args: Args) => listeners.forEach((listener) => listener(...args)),
  };
}

function fakePort(tabId: number, url: string) {
  return {
    name: "tab-view",
    sender: { tab: { id: tabId }, url },
    onMessage: event<[unknown]>(),
    onDisconnect: event<[]>(),
    postMessage: mock((_message: TabViewPush) => {}),
  };
}

const onConnect = event<[ReturnType<typeof fakePort>]>();
const onRemoved = event<[number]>();
const onReplaced = event<[number, number]>();
const pending: ReturnType<typeof Promise.withResolvers<TabView>>[] = [];
const updateBadgeForTab = mock(() => Promise.resolve());
const buildTabView = mock(() => {
  const next = Promise.withResolvers<TabView>();
  pending.push(next);
  return next.promise;
});

mock.module("wxt/browser", () => ({
  browser: {
    runtime: { onConnect, getURL: (path: string) => `chrome-extension://fluxdown${path}` },
    tabs: { onRemoved, onReplaced },
  },
}));
mock.module("./host", () => ({ onCapabilities: () => {} }));
mock.module("./rules-store", () => ({ onEngineChanged: () => {} }));
mock.module("./settings-cache", () => ({ onSettingsChanged: () => {} }));
mock.module("./probe", () => ({ scheduleProbeCheck: () => {} }));
mock.module("./tab-state", () => ({ onTabChanged: () => {} }));
mock.module("./tab-view", () => ({ buildTabView }));
mock.module("./toolbar", () => ({ updateBadgeForTab }));
mock.module("./view-model", () => ({ badgeCount: () => 0 }));
mock.module("@/utils/error-log", () => ({ logWarn: () => {} }));

const { installPorts } = await import("./ports");
installPorts();

function subscribe(tabId: number, value: unknown = "sender", url = "https://example.com") {
  const port = fakePort(tabId, url);
  onConnect.emit(port);
  port.onMessage.emit({ subscribe: value });
  return port;
}

async function finish(index: number, tabId: number, version: number) {
  const job = pending[index];
  job.resolve({ tabId, version } as TabView);
  await job.promise;
}

beforeEach(() => {
  pending.length = 0;
  buildTabView.mockClear();
  updateBadgeForTab.mockClear();
});

describe("TabView 端口", () => {
  test("先完成的新视图不会被迟到的旧视图覆盖", async () => {
    const first = subscribe(101);
    const second = subscribe(101);
    await finish(1, 101, 2);
    await finish(0, 101, 1);
    for (const port of [first, second]) {
      expect(port.postMessage.mock.calls.map(([push]) => push.view.version)).toEqual([2]);
      port.onDisconnect.emit();
    }
    expect(updateBadgeForTab).toHaveBeenCalledTimes(1);
  });

  test("标签页关闭或被替换后不发送已失效的视图", async () => {
    const first = subscribe(102);
    const second = subscribe(103);
    onRemoved.emit(102);
    onReplaced.emit(104, 103);
    await finish(0, 102, 1);
    await finish(1, 103, 1);
    expect(first.postMessage).not.toHaveBeenCalled();
    expect(second.postMessage).not.toHaveBeenCalled();
    expect(updateBadgeForTab).not.toHaveBeenCalled();
  });

  test("内容脚本端口只能订阅自己所在的标签页", async () => {
    const own = subscribe(105, 105);
    const other = subscribe(105, 106);
    const invalid = subscribe(105, Number.NaN);
    expect(buildTabView).toHaveBeenCalledTimes(1);
    await finish(0, 105, 1);
    expect(own.postMessage).toHaveBeenCalledTimes(1);
    expect(other.postMessage).not.toHaveBeenCalled();
    expect(invalid.postMessage).not.toHaveBeenCalled();
    own.onDisconnect.emit();
  });

  test("扩展侧边栏可订阅当前网页标签", async () => {
    const port = subscribe(107, 108, "chrome-extension://fluxdown/sidepanel.html");
    await finish(0, 108, 1);
    expect(port.postMessage).toHaveBeenCalledWith({
      type: "tabView",
      view: { tabId: 108, version: 1 },
    });
    port.onDisconnect.emit();
  });
});
