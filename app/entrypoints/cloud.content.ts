import { defineContentScript } from "wxt/utils/define-content-script";
import { sendAction } from "@/utils/messaging";
import { CLOUD_CONTENT_MATCHES } from "@/utils/cloud-sites";

type CloudOperation = "fetch" | "storage" | "download" | "openTab";

interface CloudRequest {
  __fluxdown?: unknown;
  channel?: unknown;
  id?: unknown;
  op?: unknown;
  args?: unknown;
}

function randomChannelId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function actionFor(op: CloudOperation): "cloudFetch" | "cloudStorage" | "cloudDownload" | "cloudOpenTab" {
  switch (op) {
    case "fetch": return "cloudFetch";
    case "storage": return "cloudStorage";
    case "download": return "cloudDownload";
    case "openTab": return "cloudOpenTab";
  }
}

function payloadFor(op: CloudOperation, args: Record<string, unknown>): Record<string, unknown> {
  if (op === "fetch") return { request: args.request };
  return args;
}

export default defineContentScript({
  matches: CLOUD_CONTENT_MATCHES,
  runAt: "document_start",
  allFrames: false,
  main() {
    const channelId = randomChannelId();
    const origin = location.origin;
    let disposed = false;

    void sendAction({ action: "cloudInject", channelId }).catch(() => undefined);

    const listener = (event: MessageEvent): void => {
      if (disposed || event.source !== window || event.origin !== origin) return;
      const data = event.data as CloudRequest | null;
      if (!data || typeof data !== "object" || data.__fluxdown !== 1) return;
      if (data.channel !== channelId || typeof data.id !== "string" || data.id.length > 128) return;
      if (data.op !== "fetch" && data.op !== "storage" && data.op !== "download" && data.op !== "openTab") return;
      const args = data.args && typeof data.args === "object" && !Array.isArray(data.args)
        ? data.args as Record<string, unknown>
        : {};
      const op = data.op;
      const action = actionFor(op);
      const message = { action, ...payloadFor(op, args) };
      const timeoutMs = op === "fetch" || op === "download" ? 125_000 : 20_000;
      const timer = setTimeout(() => {
        window.postMessage({
          __fluxdownResult: 1,
          channel: channelId,
          id: data.id,
          ok: false,
          error: "timeout",
        }, origin);
      }, timeoutMs);
      sendAction(message as never)
        .then((result) => {
          clearTimeout(timer);
          window.postMessage({ __fluxdownResult: 1, channel: channelId, id: data.id, ok: true, result }, origin);
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          window.postMessage({
            __fluxdownResult: 1,
            channel: channelId,
            id: data.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }, origin);
        });
    };

    window.addEventListener("message", listener);
    window.addEventListener("pagehide", () => {
      disposed = true;
      window.removeEventListener("message", listener);
    }, { once: true });
  },
});
