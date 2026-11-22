(function fluxdownBaiduPage() {
  "use strict";

  const host = location.hostname.toLowerCase();
  const isBaiduCloud = host === "pan.baidu.com" || host === "yun.baidu.com";
  const isSharePage = /^\/(?:s|share)\//.test(location.pathname);
  if (!isBaiduCloud || !isSharePage) return;
  if (window.__FLUXDOWN_BAIDU_PAGE__) return;

  const fail = (error) => ({ ok: false, error });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const asNumber = (value) => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const asText = (value) => (typeof value === "string" ? value : "");
  const unwrap = (value) => {
    if (value && typeof value === "object" && "value" in value) return value.value;
    return value;
  };

  function vueRootVNode() {
    const root = document.querySelector("#app");
    const app = root && (root.__vue_app__ || (root.querySelector("[data-v-app]") || {}).__vue_app__);
    return app && (app._container?._vnode || app._vnode);
  }

  function collectComponents() {
    const rootVNode = vueRootVNode();
    const seen = new Set();
    const found = [];
    const walk = (vnode) => {
      if (!vnode || typeof vnode !== "object" || seen.has(vnode)) return;
      seen.add(vnode);
      if (vnode.component) {
        const component = vnode.component;
        const type = component.type || {};
        const name = type.name || type.__name || component.$options?.name || "";
        if (name) found.push({ name, props: component.props || {} });
        walk(component.subTree);
      }
      if (Array.isArray(vnode.children)) vnode.children.forEach(walk);
      if (vnode.suspense) walk(vnode.suspense);
      if (Array.isArray(vnode.dynamicChildren)) vnode.dynamicChildren.forEach(walk);
    };
    if (rootVNode) walk(rootVNode);
    return found;
  }

  function shareContext() {
    const header = collectComponents().find((entry) => entry.name === "ShareHeader");
    const context = header && header.props && header.props.context;
    return context && typeof context === "object" ? context : null;
  }

  function normalizeFile(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = asText(raw.server_filename) || asText(raw.filename) || asText(raw.name);
    const id = raw.fs_id ?? raw.fsId ?? raw.fileId ?? raw.id;
    const validId = typeof id === "number" ? Number.isSafeInteger(id) && id >= 0
      : typeof id === "string" && /^\d{1,20}$/.test(id);
    if (!name || !validId) return null;
    return {
      id: String(id),
      name,
      size: asNumber(raw.size),
      isDir: asNumber(raw.isdir) === 1 || raw.isDir === true || raw.isdir === true,
    };
  }

  function visibleFiles() {
    const context = shareContext();
    const components = collectComponents();
    let files = [];
    if (context) {
      const contextFiles = unwrap(context.files);
      if (Array.isArray(contextFiles) && contextFiles.length) files = contextFiles;
    }
    if (!files.length) {
      const listView = components.find((entry) => entry.name === "ListView");
      const listFiles = listView && unwrap(listView.props.files);
      if (Array.isArray(listFiles) && listFiles.length) files = listFiles;
    }
    if (!files.length) {
      const names = ["DocViewer", "FileInfoPreview", "PicturePreview", "AudioPreview", "VideoPreview"];
      for (const entry of components) {
        if (!names.includes(entry.name)) continue;
        const single = unwrap(entry.props.file);
        if (single && typeof single === "object") {
          files = [single];
          break;
        }
      }
    }
    const unique = new Map();
    for (const raw of files) {
      const item = normalizeFile(raw);
      if (item && !unique.has(item.id)) unique.set(item.id, item);
    }
    return Array.from(unique.values());
  }

  function breadcrumbPath() {
    const blocks = Array.from(document.querySelectorAll('[class*="breadcrumb"], [class*="Breadcrumb"]'))
      .filter((block) => block.getClientRects().length > 0);
    let best = [];
    for (const block of blocks) {
      const items = Array.from(block.querySelectorAll("a, span, li"))
        .map((node) => (node.textContent || "").trim())
        .filter((text) => text && text.length < 120);
      if (items.length > best.length) best = items;
    }
    if (best.length) return best;
    const context = shareContext();
    const title = asText(context && context.title);
    return title ? ["百度网盘分享", title] : ["百度网盘分享"];
  }

  function list() {
    try {
      const items = visibleFiles().map(({ id, name, size, isDir }) => ({ id, name, size, isDir }));
      if (!items.length) return Promise.resolve(fail("未读取到分享文件，请确认提取码已通过或刷新页面后重试"));
      const path = breadcrumbPath();
      return Promise.resolve({ ok: true, items, path, canUp: path.length > 2 });
    } catch (error) {
      return Promise.resolve(fail("读取分享文件失败：" + String(error?.message || error)));
    }
  }

  function clickByText(name, scope) {
    const nodes = Array.from((scope || document).querySelectorAll("a, span, div, li"));
    const target = nodes.find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (node.textContent || "").trim() === name;
    });
    if (!target) return false;
    try {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      return true;
    } catch {
      return false;
    }
  }

  async function waitForChange(before, timeout) {
    const deadline = Date.now() + (timeout || 3000);
    while (Date.now() < deadline) {
      const now = visibleFiles().map((item) => item.id).join(",");
      if (now !== before) return true;
      await sleep(150);
    }
    return false;
  }

  async function open(id) {
    const items = visibleFiles();
    const item = items.find((entry) => entry.id === id);
    if (!item) return fail("未找到该文件夹，请刷新目录后重试");
    if (!item.isDir) return fail("该项不是文件夹，请选择文件夹后重试");
    const before = items.map((entry) => entry.id).join(",");
    if (!clickByText(item.name)) return fail("当前百度分享页不支持在此打开文件夹，请在页面中打开后重试");
    if (!(await waitForChange(before))) return fail("打开文件夹超时，请在页面中打开后重试");
    return list();
  }

  async function up() {
    const path = breadcrumbPath();
    if (path.length <= 2) return fail("当前百度分享页不支持返回上级，请在页面面包屑中操作后重试");
    const before = visibleFiles().map((item) => item.id).join(",");
    const parent = path[path.length - 2];
    if (!clickByText(parent)) return fail("当前百度分享页不支持返回上级，请在页面面包屑中操作后重试");
    if (!(await waitForChange(before))) return fail("返回上级超时，请在页面面包屑中操作后重试");
    return list();
  }

  async function download(id) {
    const item = visibleFiles().find((entry) => entry.id === id);
    if (!item) return fail("未找到该文件，请刷新目录后重试");
    if (item.isDir) return fail("文件夹不能直接下载，请进入文件夹后选择文件");
    const resolve = window.__FLUXDOWN_BAIDU_RESOLVE__;
    if (typeof resolve !== "function") return fail("下载助手尚未就绪，请刷新百度分享页后重试");
    try {
      const result = await resolve(id);
      return { ok: true, url: result.url, headers: result.headers, filename: item.name, size: item.size };
    } catch (error) {
      return fail(String(error?.message || error).replace(/<[^>]+>/g, " "));
    }
  }

  const api = Object.freeze({ list, open, up, download });
  window.__FLUXDOWN_BAIDU_PAGE__ = api;

  const OPS = { list: api.list, open: api.open, up: api.up, download: api.download };
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object" || data.__fluxdownBaiduPageRequest !== 1) return;
    const requestId = data.requestId;
    if (typeof requestId !== "string" || requestId.length < 1 || requestId.length > 128) return;
    const op = data.op;
    if (op !== "list" && op !== "open" && op !== "up" && op !== "download") return;
    const id = data.id;
    if ((op === "open" || op === "download") && (typeof id !== "string" || !/^\d{1,20}$/.test(id))) return;
    if (op !== "open" && op !== "download") {
      if (id !== undefined && id !== "") return;
    }

    const respond = (result) => {
      try {
        window.postMessage({ __fluxdownBaiduPageResponse: 1, requestId, result }, location.origin);
      } catch { /* 页面已导航，忽略 */ }
    };
    Promise.resolve()
      .then(() => OPS[op](id))
      .then((result) => respond(result && typeof result === "object" ? result : fail("百度页面返回了无效数据")))
      .catch((error) => respond(fail("百度页面操作失败：" + String(error?.message || error || "未知错误"))));
  });
})();
