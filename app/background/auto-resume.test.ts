import assert from "node:assert/strict";
import { describe, test } from "node:test";

const moduleUrl = new URL("./auto-resume.ts", import.meta.url).href;
const {
  AUTO_RESUME_MAX_ATTEMPTS,
  AUTO_RESUME_MIN_INTERVAL_MS,
  isTransientTaskError,
  pruneAutoResumeState,
  shouldAutoResume,
} = await import(moduleUrl);

/** 构造一个最小任务对象；shouldAutoResume 只读取这三个字段。 */
function task(overrides: Partial<{
  taskId: string;
  status: number;
  errorMessage: string;
}> = {}) {
  return {
    taskId: "task-1",
    status: 4,
    errorMessage: "segment 3 stalled: no data received for 5s",
    ...overrides,
  };
}

describe("isTransientTaskError", () => {
  test("命中所有瞬时网络错误模式，且大小写不敏感", () => {
    const messages = [
      "segment 3 STALLED: no data received for 5s",
      "NO DATA RECEIVED",
      "net:stalled",
      "NET:STALLED",
      "error DECODING response body",
      "error sending request",
      "connection RESET by peer",
      "connection CLOSED",
      "broken PIPE",
      "unexpected EOF",
      "request TIMED OUT",
      "connect TIMEOUT",
    ];
    for (const message of messages) {
      assert.equal(isTransientTaskError(message), true, `应命中: ${message}`);
    }
  });

  test("不命中 403/404/登录失败/授权/磁盘空间/文件不存在等错误", () => {
    const messages = [
      "HTTP 403 Forbidden",
      "HTTP 404 Not Found",
      "登录失败，请重新登录",
      "login failed",
      "unauthorized / 授权已过期",
      "磁盘空间不足",
      "no space left on device",
      "文件不存在",
      "file not found",
      "任务被用户暂停",
    ];
    for (const message of messages) {
      assert.equal(isTransientTaskError(message), false, `不应命中: ${message}`);
    }
  });

  test("空值或非字符串不算瞬时错误", () => {
    assert.equal(isTransientTaskError(undefined), false);
    assert.equal(isTransientTaskError(""), false);
    assert.equal(isTransientTaskError(null as unknown as string), false);
  });
});

describe("shouldAutoResume", () => {
  const now = 1_700_000_000_000;

  test("status 非 4 不触发", () => {
    for (const status of [0, 1, 2, 3, 5]) {
      assert.equal(
        shouldAutoResume(task({ status }), 1, {}, now),
        false,
        `status=${status} 不应触发`,
      );
    }
  });

  test("prevStatus 为 undefined 或 4 不触发", () => {
    assert.equal(shouldAutoResume(task(), undefined, {}, now), false);
    assert.equal(shouldAutoResume(task(), 4, {}, now), false);
  });

  test("prevStatus 为 0/1/5 时触发", () => {
    for (const prevStatus of [0, 1, 5]) {
      assert.equal(
        shouldAutoResume(task(), prevStatus, {}, now),
        true,
        `prevStatus=${prevStatus} 应触发`,
      );
    }
  });

  test("errorMessage 非瞬时错误时不触发", () => {
    assert.equal(
      shouldAutoResume(task({ errorMessage: "HTTP 403 Forbidden" }), 1, {}, now),
      false,
    );
  });

  test("达到 6 次后不再触发", () => {
    const state = {
      "task-1": { attempts: AUTO_RESUME_MAX_ATTEMPTS, lastAttemptAt: now - AUTO_RESUME_MIN_INTERVAL_MS },
    };
    assert.equal(shouldAutoResume(task(), 1, state, now), false);
    assert.equal(shouldAutoResume(task(), 1, { "task-1": { attempts: 5, lastAttemptAt: 0 } }, now), true);
  });

  test("距离上次不足 15 秒不触发，达到或超过 15 秒后触发", () => {
    const withinInterval = {
      "task-1": { attempts: 1, lastAttemptAt: now - (AUTO_RESUME_MIN_INTERVAL_MS - 1) },
    };
    assert.equal(shouldAutoResume(task(), 1, withinInterval, now), false);

    const atInterval = {
      "task-1": { attempts: 1, lastAttemptAt: now - AUTO_RESUME_MIN_INTERVAL_MS },
    };
    assert.equal(shouldAutoResume(task(), 1, atInterval, now), true);

    const beyondInterval = {
      "task-1": { attempts: 1, lastAttemptAt: now - (AUTO_RESUME_MIN_INTERVAL_MS + 1000) },
    };
    assert.equal(shouldAutoResume(task(), 1, beyondInterval, now), true);
  });

  test("首次快照里就是 error 的历史任务不处理", () => {
    assert.equal(shouldAutoResume(task(), undefined, {}, now), false);
  });

  test("limit 参数可覆盖默认次数上限", () => {
    const state = { "task-1": { attempts: 2, lastAttemptAt: 0 } };
    assert.equal(shouldAutoResume(task(), 1, state, now, 2), false);
    assert.equal(shouldAutoResume(task(), 1, state, now, 3), true);
  });
});

describe("pruneAutoResumeState", () => {
  test("任务完成后清空该任务计数", () => {
    const state = {
      "task-1": { attempts: 2, lastAttemptAt: 1 },
      "task-2": { attempts: 1, lastAttemptAt: 1 },
    };
    assert.equal(pruneAutoResumeState(state, { "task-1": 3, "task-2": 1 }), true);
    assert.deepEqual(state, { "task-2": { attempts: 1, lastAttemptAt: 1 } });
  });

  test("任务从列表消失后清空计数", () => {
    const state = {
      "task-1": { attempts: 2, lastAttemptAt: 1 },
      "task-2": { attempts: 1, lastAttemptAt: 1 },
    };
    assert.equal(pruneAutoResumeState(state, { "task-2": 1 }), true);
    assert.deepEqual(state, { "task-2": { attempts: 1, lastAttemptAt: 1 } });
  });

  test("无记录需清理时返回 false 且不改状态", () => {
    const state = { "task-1": { attempts: 2, lastAttemptAt: 1 } };
    assert.equal(pruneAutoResumeState(state, { "task-1": 1 }), false);
    assert.deepEqual(state, { "task-1": { attempts: 2, lastAttemptAt: 1 } });
  });
});
