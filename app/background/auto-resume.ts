/** 断流自动续传：纯判定逻辑，不依赖浏览器扩展运行环境。 */
import type { TaskBrief } from "@/utils/native-messaging";

/** 每个任务最多自动恢复次数。 */
export const AUTO_RESUME_MAX_ATTEMPTS = 6;
/** 同一任务两次自动恢复的最小间隔（毫秒）。 */
export const AUTO_RESUME_MIN_INTERVAL_MS = 15000;

/** 任务状态：0=pending,1=downloading,2=paused,3=completed,4=error,5=preparing。 */
export const TASK_STATUS_ERROR = 4;
export const TASK_STATUS_COMPLETED = 3;
/** 仅当上一次快照属于这些活跃状态时才允许自动续传。 */
export const AUTO_RESUME_PREVIOUS_STATUSES = new Set([0, 1, 5]);

/** 单个任务的自动恢复计数与最近一次恢复时间。 */
export interface AutoResumeTaskState {
  attempts: number;
  lastAttemptAt: number;
}

/** taskId → 该任务的自动恢复状态。 */
export type AutoResumeState = Record<string, AutoResumeTaskState>;

/**
 * 按当前轮询快照更新自动恢复状态：删除已完成或已从任务列表消失的任务记录。
 * 返回是否发生了变更，供调用方决定是否持久化。
 */
export function pruneAutoResumeState(
  state: AutoResumeState,
  snapshot: Record<string, number>,
): boolean {
  let changed = false;
  for (const taskId of Object.keys(state)) {
    if (snapshot[taskId] === TASK_STATUS_COMPLETED || !(taskId in snapshot)) {
      delete state[taskId];
      changed = true;
    }
  }
  return changed;
}

/**
 * 保守的瞬时网络错误白名单：大小写不敏感、纯字符串包含即可命中。
 * 403/404、登录/授权、磁盘空间、文件不存在等错误不在名单内。
 */
const TRANSIENT_ERROR_PATTERNS = [
  "stalled",
  "no data received",
  "net:stalled",
  "error decoding response body",
  "error sending request",
  "connection reset",
  "connection closed",
  "broken pipe",
  "unexpected eof",
  "timed out",
  "timeout",
] as const;

/** 判断错误文案是否属于可自动恢复的瞬时网络错误。 */
export function isTransientTaskError(message?: string): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  const normalized = message.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/**
 * 判断某任务本次是否应自动续传。纯函数：只读取入参，不修改 state。
 * 调用方在返回 true 后负责递增次数、更新时间并持久化状态。
 */
export function shouldAutoResume(
  task: Pick<TaskBrief, "taskId" | "status" | "errorMessage">,
  prevStatus: number | undefined,
  state: AutoResumeState,
  now: number,
  limit: number = AUTO_RESUME_MAX_ATTEMPTS,
): boolean {
  if (task.status !== TASK_STATUS_ERROR) return false;
  if (prevStatus === undefined || !AUTO_RESUME_PREVIOUS_STATUSES.has(prevStatus)) return false;
  if (!isTransientTaskError(task.errorMessage)) return false;
  const taskState = state[task.taskId];
  if (!taskState) return true;
  if (taskState.attempts >= limit) return false;
  return now - taskState.lastAttemptAt >= AUTO_RESUME_MIN_INTERVAL_MS;
}
