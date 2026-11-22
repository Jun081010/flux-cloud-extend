(function fluxdownLinkSwiftGmShim() {
  "use strict";

  const boot = window.__FLUXDOWN_LINKSWIFT_BOOT__;
  try {
    delete window.__FLUXDOWN_LINKSWIFT_BOOT__;
  } catch {
    window.__FLUXDOWN_LINKSWIFT_BOOT__ = undefined;
  }

  if (!boot || typeof boot.channelId !== "string" || !/^[a-f0-9]{32}$/.test(boot.channelId)) {
    console.error("[FluxDown Cloud] LinkSwift boot data is missing or invalid.");
    return;
  }

  const channelId = boot.channelId;
  const initialValues = boot.values && typeof boot.values === "object" ? boot.values : {};
  const resources = boot.resources && typeof boot.resources === "object" ? boot.resources : {};
  const values = new Map(Object.entries(initialValues));
  const pending = new Map();
  let nextRequestId = 1;

  function cloneValue(value) {
    if (value === null || typeof value !== "object") return value;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  function postResult(id, ok, payload) {
    const message = {
      __fluxdownResult: 1,
      channel: channelId,
      id,
      ok,
      ...(ok ? { result: payload } : { error: String(payload?.message ?? payload ?? "unknown error") }),
    };
    window.postMessage(message, window.location.origin);
  }

  function cancelPending(id) {
    const request = pending.get(id);
    if (!request) return false;
    pending.delete(id);
    clearTimeout(request.timer);
    return true;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data;
    if (!message || message.__fluxdownResult !== 1 || message.channel !== channelId) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error || "request failed"));
  });

  function callBackground(op, args = {}, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const id = `fluxdown-${nextRequestId++}`;
      const timer = setTimeout(() => {
        cancelPending(id);
        reject(new Error(`FluxDown ${op} timed out`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      window.postMessage(
        { __fluxdown: 1, channel: channelId, id, op, args },
        window.location.origin,
      );
    });
  }

  function persistValue(op, key, value) {
    callBackground("storage", { op, key, ...(op === "set" ? { value } : {}) }, 20_000)
      .catch(() => console.warn(`[FluxDown Cloud] Failed to persist LinkSwift storage key: ${key}`));
  }

  window.GM_info = Object.freeze({
    script: Object.freeze({
      name: "LinkSwift",
      version: "1.1.4",
      author: "油小猴 / hmjz100",
      icon: "",
    }),
    scriptHandler: "FluxDown Cloud Extension",
    version: "1.0.0",
  });

  window.GM_getValue = function GM_getValue(key, defaultValue) {
    return values.has(key) ? cloneValue(values.get(key)) : cloneValue(defaultValue);
  };
  window.GM_setValue = function GM_setValue(key, value) {
    values.set(key, cloneValue(value));
    persistValue("set", key, cloneValue(value));
  };
  window.GM_deleteValue = function GM_deleteValue(key) {
    values.delete(key);
    persistValue("delete", key);
  };

  window.GM_getResourceText = function GM_getResourceText(name) {
    const value = resources[name];
    if (typeof value === "string") return value;
    if (name === "SwalLigt" && typeof window.__FLUXDOWN_CSS_SWAL_LIGT__ === "string") return window.__FLUXDOWN_CSS_SWAL_LIGT__;
    if (name === "SwalDark" && typeof window.__FLUXDOWN_CSS_SWAL_DARK__ === "string") return window.__FLUXDOWN_CSS_SWAL_DARK__;
    return "";
  };

  window.GM_registerMenuCommand = function GM_registerMenuCommand() {};

  window.GM_openInTab = function GM_openInTab(url, options = {}) {
    callBackground("openTab", { url, active: options.active ?? true }, 20_000).catch(() => {});
    return { close() {}, closed: false };
  };

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {}
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }

  window.GM_setClipboard = function GM_setClipboard(text) {
    void writeClipboard(String(text ?? ""));
  };

  function decodeBase64(base64) {
    const binary = atob(base64 || "");
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return bytes;
  }

  function serializeBody(body) {
    if (body === undefined || body === null) return undefined;
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer) {
      throw new Error("Unsupported GM_xmlhttpRequest body type");
    }
    return JSON.stringify(body);
  }

  function serializeRequestUrl(value) {
    if (typeof value === "string") return value;
    if (typeof URL !== "undefined" && value instanceof URL) return value.href;
    if (value && typeof value.href === "string") return value.href;
    return String(value ?? "");
  }

  function serializeHeaders(headers) {
    if (!headers || typeof headers !== "object") return {};
    const result = {};
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined || value === null) continue;
      result[name] = typeof value === "string" ? value : String(value);
    }
    return result;
  }

  function buildXhrResponse(response, responseType) {
    const responseText = typeof response.responseText === "string" ? response.responseText : "";
    let responseValue = responseText;
    if (responseType === "json") {
      try {
        responseValue = JSON.parse(responseText);
      } catch {
        responseValue = null;
      }
    } else if (responseType === "blob") {
      responseValue = new Blob([decodeBase64(response.responseB64)], { type: response.mime || "application/octet-stream" });
    } else if (responseType === "arraybuffer") {
      responseValue = decodeBase64(response.responseB64).buffer;
    }
    const responseHeaders = (Array.isArray(response.headers) ? response.headers : [])
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");
    return {
      status: response.status ?? 0,
      statusText: response.statusText ?? "",
      readyState: 4,
      response: responseValue,
      responseText,
      responseHeaders,
      finalUrl: response.finalUrl || "",
      lengthComputable: false,
      loaded: 0,
      total: 0,
    };
  }

  window.GM_xmlhttpRequest = function GM_xmlhttpRequest(options = {}) {
    let requestId;
    const handle = {
      aborted: false,
      abort() {
        if (this.aborted || settled) return;
        this.aborted = true;
        if (requestId) cancelPending(requestId);
        settled = true;
        if (typeof options.onabort === "function") options.onabort();
        if (typeof options.onloadend === "function") options.onloadend();
      },
    };
    const responseType = options.responseType || "text";
    const timeout = Math.min(Math.max(Number(options.timeout) || 30_000, 1), 120_000);
    let settled = false;

    const finish = (callback, value, kind) => {
      if (settled || handle.aborted) return;
      settled = true;
      if (requestId) cancelPending(requestId);
      if (typeof callback === "function") callback(value);
      if (kind === "load" && typeof options.onloadend === "function") options.onloadend(value);
    };

    const request = {
      url: serializeRequestUrl(options.url),
      method: options.method || "GET",
      headers: serializeHeaders(options.headers),
      body: serializeBody(options.data),
      timeout,
      responseType,
    };

    const promise = callBackground("fetch", { request }, timeout + 5_000);
    requestId = Array.from(pending.keys()).at(-1);
    promise
      .then((response) => {
        if (response?.ok !== true) {
          const error = new Error(response?.error || "network request failed");
          finish(options.onerror, error, "error");
          return;
        }
        const result = buildXhrResponse(response, responseType);
        finish(options.onload, result, "load");
      })
      .catch((error) => {
        const isTimeout = /timed out/i.test(error?.message || "");
        finish(isTimeout && typeof options.ontimeout === "function" ? options.ontimeout : options.onerror, error, "error");
      });

    return handle;
  };

  window.GM = Object.freeze({
    info: window.GM_info,
    getValue: window.GM_getValue,
    setValue: window.GM_setValue,
    deleteValue: window.GM_deleteValue,
    getResourceText: window.GM_getResourceText,
    registerMenuCommand: window.GM_registerMenuCommand,
    openInTab: window.GM_openInTab,
    setClipboard: window.GM_setClipboard,
    xmlHttpRequest: window.GM_xmlhttpRequest,
  });

  window.GM_fluxdownDownload = async function GM_fluxdownDownload(items) {
    const result = await callBackground("download", { items }, 120_000);
    return result?.ok === true && result?.success === true && result?.failed === 0 ? "success" : "fail";
  };

  void postResult;
})();
