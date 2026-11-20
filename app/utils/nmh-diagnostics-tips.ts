/**
 * 把浏览器给出的 Native Messaging 断开原因归类成可行动的故障码。
 *
 * 浏览器原文只有英文，而且不同版本措辞不同（"Access to the specified native
 * messaging host ... is forbidden" / "No such native application" / manifest
 * 解析失败）。侧边栏「诊断」页据此显示对应提示，避免用户只看到一句
 * 「未连接」。
 *
 * 只做纯文本匹配，不读取任何环境信息，方便单测与导出日志时复用。
 */
export type NmhFailureCode = "host_not_allowed" | "host_not_registered" | "manifest_invalid";

/** 顺序即优先级：白名单拒绝最常见，先匹配。 */
const RULES: readonly (readonly [NmhFailureCode, RegExp])[] = [
  [
    "host_not_allowed",
    /access to the (?:specified )?native messaging host|not allowed to (?:connect|use)|is forbidden/i,
  ],
  [
    "host_not_registered",
    /no such native application|native (?:messaging )?(?:host|application).{0,40}not (?:found|registered)|host not found/i,
  ],
  [
    "manifest_invalid",
    /manifest.{0,40}(?:invalid|not found|missing|failed|error)|error when parsing|failed to parse/i,
  ],
];

export function classifyNmhFailure(reason: string | null | undefined): NmhFailureCode | null {
  if (typeof reason !== "string" || reason.trim() === "") return null;
  for (const [code, pattern] of RULES) {
    if (pattern.test(reason)) return code;
  }
  return null;
}

/** 诊断事件里哪些能代表「连不上」的原始原因。 */
export function failureReasonOf(event: { event: string; detail?: string }): string | undefined {
  if (event.event !== "native.disconnected" && event.event !== "native.connect_failed") return undefined;
  return event.detail;
}

/**
 * 从最新到最旧找第一条可归类的失败原因。
 * 事件按时间升序存储，`count` 只表示重复次数，所以从尾部往前扫。
 */
export function latestNmhFailure<T extends { event: string; detail?: string }>(events: readonly T[]): NmhFailureCode | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const code = classifyNmhFailure(failureReasonOf(events[i]));
    if (code) return code;
  }
  return null;
}
