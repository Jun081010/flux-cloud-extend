import { describe, expect, it } from "bun:test";
import { classifyNmhFailure, failureReasonOf, latestNmhFailure } from "./nmh-diagnostics-tips";

describe("classifyNmhFailure", () => {
  it("识别白名单拒绝的常见措辞", () => {
    expect(classifyNmhFailure("Access to the specified native messaging host com.fluxdown.cloud.nmh is forbidden.")).toBe(
      "host_not_allowed",
    );
    expect(classifyNmhFailure("Access to the native messaging host is not allowed.")).toBe("host_not_allowed");
  });

  it("识别未注册 / 中继不存在", () => {
    expect(classifyNmhFailure("No such native application com.fluxdown.cloud.nmh")).toBe("host_not_registered");
    expect(classifyNmhFailure("Specified native messaging host not found.")).toBe("host_not_registered");
  });

  it("识别清单损坏", () => {
    expect(classifyNmhFailure("Error when parsing native messaging host manifest.")).toBe("manifest_invalid");
    expect(classifyNmhFailure("manifest.json not found")).toBe("manifest_invalid");
  });

  it("空值与无关原因不误判", () => {
    expect(classifyNmhFailure(undefined)).toBeNull();
    expect(classifyNmhFailure("   ")).toBeNull();
    expect(classifyNmhFailure("port disconnected (no error reason)")).toBeNull();
    expect(classifyNmhFailure("stalled: tasks timed out")).toBeNull();
  });
});

describe("latestNmhFailure", () => {
  it("只看断开与连接失败，忽略请求失败与已恢复的连接", () => {
    const events = [
      { event: "native.disconnected", detail: "Access to the specified native messaging host is forbidden." },
      { event: "native.connected" },
      { event: "native.request_failed", detail: "host_rejected_request" },
    ];
    expect(failureReasonOf(events[2])).toBeUndefined();
    expect(latestNmhFailure(events)).toBe("host_not_allowed");
  });

  it("优先返回最近一条可归类的失败", () => {
    const events = [
      { event: "native.connect_failed", detail: "No such native application" },
      { event: "native.disconnected", detail: "Access to the native messaging host is not allowed." },
    ];
    expect(latestNmhFailure(events)).toBe("host_not_allowed");
  });

  it("没有可归类原因时返回 null", () => {
    expect(latestNmhFailure([{ event: "background.started" }])).toBeNull();
  });
});
