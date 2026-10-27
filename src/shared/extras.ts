/**
 * dsh-pet-jt 的两个增强配置项（设置页 / 宠物页面共用，纯逻辑、不依赖 React/DOM）：
 *
 *   1. reminders —— 定时提醒：每天固定时刻让桌宠说一句自定义的话（喝水 / 休息 / 站起来走走…）。
 *      提示气泡**复用对话气泡**（写进 S 的 pets.<id>.say，与碎碎念/对话同一个叶子），
 *      所以外观、时长、动画联动与原有气泡完全一致，不新增第二套气泡。
 *   2. visibilityCycle —— 随机出现 / 隐藏：宠物"出现"后随机 [visibleMin, visibleMax] 分钟隐藏，
 *      隐藏后随机 [hiddenMin, hiddenMax] 分钟重新出现；四项各自 1~120 分钟。
 *
 * 为什么单独一个模块：设置页要编辑、宠物页面要执行、宿主配置层要校验（宿主持有一份自包含副本，
 * 见 src/host/reminders.ts），这三处必须共用同一套形状与默认值，否则读写口径会漂。
 */

/** 一条定时提醒 */
export interface ReminderTask {
  /** 稳定 id（设置页生成；只用于"这一拍有没有已经触发过"的去重，改名不影响） */
  id: string;
  /** 每天触发的时刻，24 小时制 `HH:MM` */
  time: string;
  /** 提示语句（会原样显示在对话气泡里） */
  text: string;
  /** 单条开关（总开关在 RemindersConfig.enabled） */
  enabled: boolean;
}

/** 定时提醒总配置 */
export interface RemindersConfig {
  enabled: boolean;
  tasks: ReminderTask[];
}

/** 随机出现/隐藏的频率配置（单位：分钟） */
export interface VisibilityCycleConfig {
  enabled: boolean;
  /** 出现后最少停留多久（分钟） */
  visibleMin: number;
  /** 出现后最多停留多久（分钟） */
  visibleMax: number;
  /** 隐藏后最少多久不出现（分钟） */
  hiddenMin: number;
  /** 隐藏后最多多久不出现（分钟） */
  hiddenMax: number;
}

/** 提示语句长度上限（字符数，与宿主校验同口径） */
export const REMINDER_TEXT_MAX = 120;
/** 提醒条数上限（防止配置无限膨胀） */
export const REMINDER_MAX_TASKS = 40;
/** 出现/隐藏时长的合法区间（分钟，含端点） */
export const CYCLE_MIN_MINUTES = 1;
export const CYCLE_MAX_MINUTES = 120;

export const DEFAULT_REMINDERS: RemindersConfig = { enabled: false, tasks: [] };

export const DEFAULT_VISIBILITY_CYCLE: VisibilityCycleConfig = {
  enabled: false,
  visibleMin: 30,
  visibleMax: 60,
  hiddenMin: 10,
  hiddenMax: 30,
};

/** `HH:MM`（24 小时制，00:00~23:59） */
export const REMINDER_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 时长是否落在 1~120 分钟（有限数字） */
export const cycleMinutesValid = (value: unknown): boolean => {
  const n = Number(value);
  return Number.isFinite(n) && n >= CYCLE_MIN_MINUTES && n <= CYCLE_MAX_MINUTES;
};

/** 区间是否合法：两个端点都在 1~120，且 min ≤ max */
export const cycleRangeValid = (min: unknown, max: unknown): boolean =>
  cycleMinutesValid(min) && cycleMinutesValid(max) && Number(min) <= Number(max);

/** 一条提醒是否合法（id 非空、时刻合法、语句非空且不超长） */
export function reminderTaskValid(raw: unknown): raw is ReminderTask {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || t.id.trim() === '') return false;
  if (typeof t.time !== 'string' || !REMINDER_TIME_RE.test(t.time)) return false;
  if (typeof t.text !== 'string') return false;
  const text = t.text.trim();
  return text !== '' && Array.from(text).length <= REMINDER_TEXT_MAX;
}

/**
 * 把成品配置里读到的 reminders 归一成可用形状（**宽容**：坏条目丢弃，绝不抛）。
 * 设置页与宠物页面都用它——宿主侧已按同一规则校验过，这里只是"读到什么就用什么"。
 */
export function normalizeReminders(raw: unknown): RemindersConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_REMINDERS };
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.tasks) ? o.tasks : [];
  const tasks: ReminderTask[] = [];
  for (const item of list) {
    if (!reminderTaskValid(item)) continue;
    const t = item as ReminderTask;
    tasks.push({ id: t.id, time: t.time, text: t.text.trim(), enabled: t.enabled === true });
    if (tasks.length >= REMINDER_MAX_TASKS) break;
  }
  return { enabled: o.enabled === true, tasks };
}

/** 把成品配置里读到的 visibilityCycle 归一（非法字段回落默认值，绝不抛） */
export function normalizeCycle(raw: unknown): VisibilityCycleConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_VISIBILITY_CYCLE };
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number => (cycleMinutesValid(v) ? Number(v) : fallback);
  const visibleMin = num(o.visibleMin, DEFAULT_VISIBILITY_CYCLE.visibleMin);
  const visibleMax = num(o.visibleMax, DEFAULT_VISIBILITY_CYCLE.visibleMax);
  const hiddenMin = num(o.hiddenMin, DEFAULT_VISIBILITY_CYCLE.hiddenMin);
  const hiddenMax = num(o.hiddenMax, DEFAULT_VISIBILITY_CYCLE.hiddenMax);
  return {
    enabled: o.enabled === true,
    // 端点写反了就地对调：宁可"按用户填的两个值随机"，也不要整段失效
    visibleMin: Math.min(visibleMin, visibleMax),
    visibleMax: Math.max(visibleMin, visibleMax),
    hiddenMin: Math.min(hiddenMin, hiddenMax),
    hiddenMax: Math.max(hiddenMin, hiddenMax),
  };
}

/**
 * 抽一个随机时长（毫秒）：在 [min, max] 分钟之间均匀取整到秒。
 * `min === max` 时退化成固定时长。随机源就是 Math.random（与动画随机链同一套口径）。
 */
export function pickCycleDelayMs(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const minutes = lo + Math.random() * (hi - lo);
  return Math.max(1000, Math.round(minutes * 60_000));
}
