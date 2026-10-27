/**
 * host 侧「定时提醒」与「随机出现/隐藏频率」的配置读取 + 到点判定（**纯逻辑、可单测**）。
 *
 * 为什么不 import src/shared/extras.ts：host 半侧被 DSH 当单文件模块加载（见 ./config 的
 * 模块注释与 tsdown 配置），整个工程只有 shared → 浏览器这一个方向。所以这里放一份自包含副本，
 * **规则必须与 src/shared/extras.ts 逐字一致**（字段名 / 区间 / `HH:MM` 正则 / 条数上限）。
 *
 * 定时提醒的语义（刻意做得极简、可预期）：
 *   - 每条任务 = 「每天 HH:MM 触发一次」；宿主每 15 秒对一次表，命中分钟就写一次气泡；
 *   - 同一分钟只触发一次（`fired` 记录 `任务 id → 当天 'YYYY-MM-DD HH:MM'`）；
 *   - 停机错过的时刻不补发（补发一堆过期提醒只会打扰人）；
 *   - 气泡文本原样写进 S 的 `pets.<id>.say`，所以**外观完全复用对话气泡**。
 */

/** 一条定时提醒 */
export interface HostReminderTask {
  id: string;
  time: string;
  text: string;
  enabled: boolean;
}

/** 宿主侧归一后的提醒配置 */
export interface HostRemindersConfig {
  enabled: boolean;
  tasks: HostReminderTask[];
}

/** 提示语句长度上限（码点，与 shared 同口径） */
export const REMINDER_TEXT_MAX = 120;
/** 提醒条数上限 */
export const REMINDER_MAX_TASKS = 40;
/** 出现/隐藏时长区间（分钟） */
export const CYCLE_MIN_MINUTES = 1;
export const CYCLE_MAX_MINUTES = 120;

/** `HH:MM`（24 小时制） */
export const REMINDER_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const cycleMinutesValid = (value: unknown): boolean => {
  const n = Number(value);
  return Number.isFinite(n) && n >= CYCLE_MIN_MINUTES && n <= CYCLE_MAX_MINUTES;
};

/** 一条提醒的合法性（与 shared 的 reminderTaskValid 同口径） */
export function reminderTaskValid(raw: unknown): raw is HostReminderTask {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || t.id.trim() === '') return false;
  if (typeof t.time !== 'string' || !REMINDER_TIME_RE.test(t.time)) return false;
  if (typeof t.text !== 'string') return false;
  const text = t.text.trim();
  return text !== '' && Array.from(text).length <= REMINDER_TEXT_MAX;
}

/**
 * reminders 段校验（配置层用：显式写了但非法 → 告警 + 取内置默认）。
 * 整段校验，与 physics / font 同一套语义：结构错、任一条任务错都算整段非法。
 */
export function remindersValid(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.enabled !== 'boolean') return false;
  if (!Array.isArray(o.tasks)) return false;
  if (o.tasks.length > REMINDER_MAX_TASKS) return false;
  const seen = new Set<string>();
  for (const task of o.tasks) {
    if (!reminderTaskValid(task)) return false;
    const id = (task as HostReminderTask).id.trim();
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/** visibilityCycle 段校验（四项都在 1~120 分钟，且 min ≤ max） */
export function visibilityCycleValid(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.enabled !== 'boolean') return false;
  const min = o.visibleMin;
  const max = o.visibleMax;
  const hMin = o.hiddenMin;
  const hMax = o.hiddenMax;
  return (
    cycleMinutesValid(min) &&
    cycleMinutesValid(max) &&
    cycleMinutesValid(hMin) &&
    cycleMinutesValid(hMax) &&
    Number(min) <= Number(max) &&
    Number(hMin) <= Number(hMax)
  );
}

/**
 * 从成品配置的某个条目里取提醒配置（**宽容**：读不到/坏条目忽略，绝不抛）。
 * 默认条目与设置页同口径：条目不合法就当"没有提醒"。
 */
export function readRemindersConfig(entry: Record<string, unknown> | undefined): HostRemindersConfig {
  const raw = entry?.reminders;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { enabled: false, tasks: [] };
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.tasks) ? o.tasks : [];
  const tasks: HostReminderTask[] = [];
  for (const item of list) {
    if (!reminderTaskValid(item)) continue;
    const t = item as HostReminderTask;
    tasks.push({ id: t.id.trim(), time: t.time, text: t.text.trim(), enabled: t.enabled === true });
    if (tasks.length >= REMINDER_MAX_TASKS) break;
  }
  return { enabled: o.enabled === true, tasks };
}

/** 本地时间 → `YYYY-MM-DD`（用本地日期，不用 toISOString：那个是 UTC，跨时区会错一天） */
function localDateKey(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 本地时间 → `HH:MM` */
export function localTimeKey(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/**
 * 这一拍该触发哪些提醒。
 *
 * @param cfg    归一后的提醒配置
 * @param now    当前时刻
 * @param fired  去重表（任务 id → 上次触发的 `YYYY-MM-DD HH:MM`）；**会被就地更新**
 * @returns 需要触发的任务（同一分钟、同一条任务最多一次；停机错过的不补发）
 */
export function dueReminderTasks(
  cfg: HostRemindersConfig,
  now: Date,
  fired: Map<string, string>,
): HostReminderTask[] {
  if (!cfg.enabled) return [];
  const dateKey = localDateKey(now);
  const timeKey = localTimeKey(now);
  const stamp = dateKey + ' ' + timeKey;
  // 去重表清理：只留当天的（否则常驻进程里会慢慢攒下早已过期的条目）
  for (const [id, value] of fired) {
    if (!value.startsWith(dateKey + ' ')) fired.delete(id);
  }
  const due: HostReminderTask[] = [];
  for (const task of cfg.tasks) {
    if (!task.enabled) continue;
    if (task.time !== timeKey) continue;
    if (fired.get(task.id) === stamp) continue; // 这一分钟已经触发过
    fired.set(task.id, stamp);
    due.push(task);
  }
  return due;
}
