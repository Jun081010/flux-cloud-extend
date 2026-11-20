(function fluxdownBaiduPage() {
  "use strict";

  const host = location.hostname.toLowerCase();
  const isBaiduCloud = host === "pan.baidu.com" || host === "yun.baidu.com";
  const isSharePage = /^\/(?:s|share)\//.test(location.pathname);
  if (!isBaiduCloud || !isSharePage) return;
  if (window.__FLUXDOWN_BAIDU_PAGE__) return;

  const FOLDER = "/FluxDown";
  const TOKEN_KEY = "baidu_access_token";
  const AUTHORIZE_URL =
    "https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&scope=basic,netdisk&client_id=omiOnr2tYnN9vSyDErcVFWpPU2mZA7YO&redirect_uri=oob&confirm_login=0";
  const LIST_API = "https://pan.baidu.com/rest/2.0/xpan/file?method=list&showempty=1";
  const META_API = "https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&dlink=1";
  const CREATE_API = "https://pan.baidu.com/api/create?a=commit";
  const TRANSFER_API = "https://pan.baidu.com/share/transfer";
  const DOWNLOAD_HEADERS = { "User-Agent": "pan.baidu.com" };

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

  function gmGet(key, fallback) {
    return typeof window.GM_getValue === "function" ? window.GM_getValue(key, fallback) : fallback;
  }
  function gmSet(key, value) {
    if (typeof window.GM_setValue === "function") window.GM_setValue(key, value);
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof window.GM_xmlhttpRequest !== "function") {
        reject(new Error("扩展消息通道尚未就绪，请刷新页面后重试"));
        return;
      }
      let settled = false;
      const done = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      window.GM_xmlhttpRequest({
        url: options.url,
        method: options.method || "GET",
        headers: options.headers,
        data: options.data,
        responseType: options.responseType || "text",
        timeout: options.timeout || 30000,
        onload: (res) => done(resolve, res),
        onerror: (error) => done(reject, new Error("请求百度网盘接口失败：" + String(error?.message || error || "网络错误"))),
        ontimeout: () => done(reject, new Error("请求百度网盘接口超时")),
        onabort: () => done(reject, new Error("请求百度网盘接口被取消")),
      });
    });
  }

  function responseText(res) {
    return typeof res?.responseText === "string" ? res.responseText : "";
  }
  function finalUrl(res) {
    return typeof res?.finalUrl === "string" ? res.finalUrl : "";
  }
  function parseJson(res) {
    if (res?.response && typeof res.response === "object") return res.response;
    const text = responseText(res);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function apiGet(url, timeout) {
    const res = await gmRequest({ url: String(url), responseType: "text", timeout });
    return parseJson(res);
  }
  async function apiPost(url, body, timeout) {
    const res = await gmRequest({
      url: String(url),
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: typeof body === "string" ? body : String(body),
      responseType: "text",
      timeout,
    });
    return parseJson(res);
  }

  function tokenFrom(value) {
    const text = asText(value);
    if (!text) return "";
    const match = text.match(/access_token=([^&#\s]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  async function getAccessToken() {
    const cached = asText(gmGet(TOKEN_KEY, ""));
    if (cached) return cached;

    let first;
    try {
      first = await gmRequest({ url: AUTHORIZE_URL, responseType: "text", timeout: 30000 });
    } catch (error) {
      throw new Error("获取百度网盘授权状态失败：" + String(error?.message || error));
    }
    let token = tokenFrom(finalUrl(first)) || tokenFrom(responseText(first));
    if (token) {
      gmSet(TOKEN_KEY, token);
      return token;
    }

    const html = responseText(first);
    const bdstoken = (html.match(/name="bdstoken"\s+value="([^"]+)"/) || [])[1] || "";
    const clientId = (html.match(/name="client_id"\s+value="([^"]+)"/) || [])[1] || "";
    if (!bdstoken || !clientId) {
      const looksLikeLogin = /(?:passport\.baidu\.com|请登录|扫码登录|login)/i.test(html);
      throw new Error(
        looksLikeLogin
          ? "百度授权页未读取到登录状态：请确认浏览器未拦截百度登录信息，已在 pan.baidu.com 登录后点击重试"
          : "百度授权页结构异常（缺少 bdstoken/client_id），请稍后点击重试",
      );
    }
    const grant = new URLSearchParams({
      grant_permissions_arr: "netdisk",
      bdstoken,
      client_id: clientId,
      response_type: "token",
      display: "page",
      grant_permissions: "basic,netdisk",
    });
    try {
      await gmRequest({
        url: AUTHORIZE_URL,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: grant.toString(),
        responseType: "text",
        timeout: 30000,
      });
    } catch (error) {
      throw new Error("确认百度网盘授权失败：" + String(error?.message || error));
    }
    let second;
    try {
      second = await gmRequest({ url: AUTHORIZE_URL, responseType: "text", timeout: 30000 });
    } catch (error) {
      throw new Error("读取百度网盘授权结果失败：" + String(error?.message || error));
    }
    token = tokenFrom(finalUrl(second)) || tokenFrom(responseText(second));
    if (!token) throw new Error("请先登录百度网盘并允许授权，登录后重试");
    gmSet(TOKEN_KEY, token);
    return token;
  }

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
    if (!name || id === undefined || id === null || id === "") return null;
    return {
      id: String(id),
      name,
      size: asNumber(raw.size),
      isDir: asNumber(raw.isdir) === 1 || raw.isDir === true || raw.isdir === true,
      raw,
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

  function transferParams(context) {
    const baiduId = asText(document.cookie.split("BAIDUID=")[1]?.split(";")[0] || "");
    const params = {
      shareid: String(context.shareId ?? context.shareid ?? ""),
      from: String(context.shareUk ?? context.share_uk ?? context.uk ?? ""),
      bdstoken: asText(context.bdstoken) || asText(context.bds_token),
      sekey: asText(context.sekey) || asText(context.currentSekey),
      logid: (() => {
        try {
          const text = encodeURIComponent(baiduId || "fluxdown");
          return btoa(unescape(text));
        } catch {
          return "";
        }
      })(),
    };
    if (!params.shareid || !params.from || !params.bdstoken) return null;
    return params;
  }

  function listFolder(token) {
    const url = new URL(LIST_API);
    url.searchParams.set("dir", FOLDER);
    url.searchParams.set("access_token", token);
    return apiGet(url);
  }

  async function ensureFolder(params, token) {
    let listing = await listFolder(token);
    if (listing?.errno === 0) return listing;
    const createUrl = new URL(CREATE_API);
    createUrl.searchParams.set("bdstoken", params.bdstoken);
    const created = await apiPost(
      createUrl,
      new URLSearchParams({ path: FOLDER, isdir: "1", block_list: "[]" }),
    );
    if (created?.errno && created.errno !== -8) {
      throw new Error("创建 /FluxDown 目录失败：" + (created.errmsg || created.errno));
    }
    listing = await listFolder(token);
    if (listing?.errno !== 0) throw new Error("创建 /FluxDown 目录后仍无法读取：" + (listing?.errmsg || listing?.errno));
    return listing;
  }

  function matchSaved(folderFiles, item) {
    const size = asNumber(item.size);
    return folderFiles.find((file) => {
      const name = asText(file.server_filename) || asText(file.filename);
      if (name !== item.name) return false;
      if (size > 0 && asNumber(file.size) !== size) return false;
      return true;
    }) || null;
  }

  async function pollForFiles(folderFiles, item, token) {
    const deadline = Date.now() + 15000;
    let files = folderFiles;
    let match = matchSaved(files, item);
    while (!match && Date.now() < deadline) {
      await sleep(1000);
      const listing = await listFolder(token);
      files = Array.isArray(listing?.list) ? listing.list : [];
      match = matchSaved(files, item);
    }
    if (!match) throw new Error("文件转存后未出现在 /FluxDown 目录，请稍后重试");
    return match;
  }

  async function dlinkFor(fsId, token) {
    const url = new URL(META_API);
    url.searchParams.set("fsids", JSON.stringify([fsId]));
    url.searchParams.set("access_token", token);
    const meta = await apiGet(url);
    if (meta?.errno !== 0 || !Array.isArray(meta.list)) {
      throw new Error("读取网盘直链失败：" + (meta?.errmsg || meta?.errno || "未知错误"));
    }
    const detail = meta.list.find((file) => String(file.fs_id) === String(fsId));
    if (!asText(detail?.dlink)) throw new Error("网盘没有返回可用直链，请稍后重试");
    return detail;
  }

  async function download(id) {
    const item = visibleFiles().find((entry) => entry.id === id);
    if (!item) return fail("未找到该文件，请刷新目录后重试");
    if (item.isDir) return fail("文件夹不能直接下载，请进入文件夹后选择文件");
    const context = shareContext();
    if (!context) return fail("分享页数据尚未就绪，请刷新页面或确认提取码后重试");
    const params = transferParams(context);
    if (!params) return fail("分享页缺少转存参数，请刷新页面后重试");

    let token;
    try {
      token = await getAccessToken();
    } catch (error) {
      return fail(String(error?.message || error));
    }
    if (!token) return fail("请先登录百度网盘并允许授权，登录后重试");

    let listing;
    try {
      listing = await ensureFolder(params, token);
    } catch (error) {
      return fail(String(error?.message || error));
    }
    let folderFiles = Array.isArray(listing?.list) ? listing.list : [];
    let saved = matchSaved(folderFiles, item);

    if (!saved) {
      const transferUrl = new URL(TRANSFER_API);
      transferUrl.searchParams.set("shareid", params.shareid);
      transferUrl.searchParams.set("from", params.from);
      transferUrl.searchParams.set("bdstoken", params.bdstoken);
      if (params.sekey) transferUrl.searchParams.set("sekey", params.sekey);
      if (params.logid) transferUrl.searchParams.set("logid", params.logid);
      let transfer;
      try {
        transfer = await apiPost(
          transferUrl,
          new URLSearchParams({ fsidlist: JSON.stringify([item.id]), path: FOLDER }),
        );
      } catch (error) {
        return fail("保存分享文件到 /FluxDown 失败：" + String(error?.message || error));
      }
      if (transfer?.errno !== 0) {
        return fail("保存分享文件到 /FluxDown 失败：" + (transfer?.errmsg || transfer?.errno || "未知错误"));
      }
      try {
        saved = await pollForFiles(folderFiles, item, token);
      } catch (error) {
        return fail(String(error?.message || error));
      }
    }

    let detail;
    try {
      detail = await dlinkFor(saved.fs_id, token);
    } catch (error) {
      return fail(String(error?.message || error));
    }
    let url;
    try {
      url = new URL(detail.dlink);
      url.searchParams.set("access_token", token);
    } catch {
      return fail("网盘返回的直链格式异常，请稍后重试");
    }
    return {
      ok: true,
      url: url.href,
      filename: item.name,
      size: asNumber(detail.size) || item.size,
      headers: DOWNLOAD_HEADERS,
    };
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
