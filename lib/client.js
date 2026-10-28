;(()=>{
//#region src/shared/pickers.ts
/** 从字符串池里等概率随机抽一个；exclude 排除某个名字（避免连续重复） */
const pick = (pool, exclude) => {
	const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
	const src = entries.length ? entries : pool;
	return src[Math.floor(Math.random() * src.length)];
};
/**
* 事件档位取值：字符串槽位原样返回（固定播放，原行为不变）；
* 数组槽位 = 档内候选，随机抽 1 并尽量避开 exclude（当前正在播的动画，避免连续重复）；
* 排除后池空（单候选 + 排除自己）退回原数组——宁可重复，也不要返回 undefined（与 pick 同一哲学）。
*/
const pickSlot = (slot, exclude) => {
	if (typeof slot === "string") return slot;
	const entries = exclude === void 0 ? slot : slot.filter((n) => n !== exclude);
	const src = entries.length ? entries : slot;
	return src[Math.floor(Math.random() * src.length)];
};
/** 槽位是否包含某动画名：字符串按名比；数组查成员（成员判断必须走这里——直接 includes 会漏掉数组槽位） */
const slotIncludes = (slot, anim) => typeof slot === "string" ? slot === anim : slot.includes(anim);
/** 事件池（档位槽位数组）是否包含某动画名 */
const poolIncludes = (pool, anim) => pool.some((slot) => slotIncludes(slot, anim));
/** 整个 events 段是否包含某动画名（事件动画播完回 idle / switchTo 诊断 / 循环护栏共用） */
const isEventAnim = (events, anim) => events ? Object.values(events).some((pool) => poolIncludes(pool, anim)) : false;
/**
* workStatus 播完（ended）续播决策：找到包含 current 动画的档位——
* 多候选档位（≥2）→ 返回档内下一候选（排除 current，避免连抽）：播完一段自动轮换，长时间状态不单段重复；
* 单候选/单动画档位或动画不属于 workStatus 池 → null（原样续播同一段/按原语义处理）。
* 浏览器与桌面共用同一份决策，双端轮换行为严格一致。
*/
const nextWorkStatusAnim = (pool, current) => {
	const idx = pool.findIndex((slot$1) => slotIncludes(slot$1, current));
	if (idx === -1) return null;
	const slot = pool[idx];
	if (!Array.isArray(slot) || slot.length <= 1) return null;
	return pickSlot(slot, current);
};
/** 生成 [min, max) 区间内的随机整数 */
const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
/**
* 按权重在分类池中选一个分类；noMirror 分类在镜像(facing=right)时被排除，
* 剩余权重自动归一化。分类池为空时返回 null。
*/
const pickWeightedCategory = (categories, facing) => {
	const cats = categories.filter((c) => c.actions.length > 0);
	if (!cats.length) return null;
	const filtered = cats.filter((c) => !(c.noMirror && facing === "right"));
	const eligible = filtered.length ? filtered : cats;
	const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
	let t = Math.random() * totalW;
	for (const c of eligible) {
		t -= c.weight;
		if (t <= 0) return c;
	}
	return eligible[eligible.length - 1];
};
/**
* 按权重掷骰：roll ∈ [0,1) → 下一个动画类别（纯函数，可单测）。
* topEnd = (idle+turn+move)/100：三档权重占比之和，剩余概率归入 'action'。
* opts.fixed（宠物固定）为真时 turn/move 两档权重按 0 算，只可能返回 'idle' 或 'action'。
*
* 浏览器（client/pet.ts 的 pickNext）与桌面（runtime/electron-helper/sprite.js 的 playIdle）
* 共用本函数，两端随机链行为严格一致。
*/
const rollKind = (roll, w, opts) => {
	const turn = opts?.fixed ? 0 : w.turn;
	const move = opts?.fixed ? 0 : w.move;
	const topEnd = (w.idle + turn + move) / 100;
	if (roll < w.idle / 100) return "idle";
	if (roll < (w.idle + turn) / 100) return "turn";
	if (roll < topEnd) return "move";
	return "action";
};
/** 从分类池选一个动作；无可用分类时回退 idle 池（返回 {id, name}，纯函数）。
* facing 用于 noMirror 镜像过滤；current 用于避免连续重复（pick 的 exclude）。 */
const pickCategoryAction = (categories, idlePool, facing, current) => {
	const cat = pickWeightedCategory(categories, facing);
	if (!cat) return {
		id: "FALLBACK",
		name: pick(idlePool, current)
	};
	return {
		id: cat.id,
		name: pick(cat.actions, current)
	};
};

//#endregion
//#region src/shared/displays.ts
/** 矩形右缘（不含） */
const rectRight = (r) => r.x + r.width;
/** 矩形下缘（不含） */
const rectBottom = (r) => r.y + r.height;
/** 点是否落在矩形内（右/下缘不含，与 workArea 拼接语义一致：相邻两屏缝隙为 0 时点归左/上那块） */
const pointInRect = (r, x, y) => x >= r.x && x < rectRight(r) && y >= r.y && y < rectBottom(r);
/** 点被哪块屏覆盖；无则 null。重叠时取列表中第一块（与 Chromium「先发现者优先」一致） */
const rectAtPoint = (rects, x, y) => {
	for (const r of rects) if (pointInRect(r, x, y)) return r;
	return null;
};

//#endregion
//#region src/shared/motion.ts
/** 计算一次移动的起点/终点比例坐标；目标越出视口边缘（含边距）时返回 null。
*  sideAllow = 左右透明边余量（视频画布内宠物身体居中、两侧透明）：边界按"身体"贴边而不是
*  按"整个视频盒"贴边——宠物能走到屏幕边缘，但身体永不越界（不会漫游到屏幕外丢失）。
*
*  areas 传入时（桌面多显示器）边界改判**工作区并集**而不是视口外接矩形：落点的身体两侧
*  各留 margin 后仍须落在某块屏上。缝隙两侧都有屏 ⇒ 可自由走过去（允许骑缝）；外接矩形里的
*  空洞没有屏 ⇒ 走不进去。不传时按 W/H 单矩形判定，浏览器 overlay 行为逐位不变。 */
const planMove = (o) => {
	const side = o.sideAllow ?? 0;
	const distance = randomBetween(o.minDist, o.maxDist);
	const target = o.cx + o.dir * distance;
	if (o.areas && o.areas.length > 0) {
		const bodyHalf = o.halfW - side;
		if (!rectAtPoint(o.areas, target - bodyHalf - o.margin, o.cy)) return null;
		if (!rectAtPoint(o.areas, target + bodyHalf + o.margin, o.cy)) return null;
	} else {
		const leftBound = o.margin + o.halfW - side;
		const rightBound = o.W - o.margin - o.halfW + side;
		if (target < leftBound || target > rightBound) return null;
	}
	return {
		startRatio: o.cx / o.W,
		startYRatio: o.cy / o.H,
		targetRatio: target / o.W,
		totalRatio: Math.abs(target - o.cx) / o.W
	};
};

//#endregion
//#region src/shared/config.ts
/** 显示位置白名单 */
const PET_DISPLAYS = [
	"web",
	"desktop",
	"both",
	"none"
];
/** 该宠物是否参与浏览器 overlay 渲染 */
const isWebVisible = (display) => display === "web" || display === "both";
/** 把 host 的成品聚合拍平成渲染用宠物列表：
*  条目级字段（animations / animationWeights / eventsRefreshSec / physics / font / confineToScreen /
*  workStatusTexts / whisperModel / chatModel——合并器已填好；其中 10 个「全局默认」字段的
*  条目值来自用户层，见 types.ts / host/config.ts）吹进每只实例；
*  assetRoot = 条目 key（= 素材根，多实例共享）；非 main 条目的实例打 extra 标记
*  （文件宠物：设置页不可编辑、保存时排除）。 */
function flattenConfigPets(merged) {
	const out = [];
	for (const [entry, conf] of Object.entries(merged)) {
		const list = Array.isArray(conf?.pets) ? conf.pets : [];
		for (const p of list) out.push({
			...p,
			animations: conf.animations,
			animationWeights: conf.animationWeights,
			eventsRefreshSec: conf.eventsRefreshSec,
			physics: conf.physics,
			font: conf.font,
			confineToScreen: conf.confineToScreen,
			workStatusTexts: conf.workStatusTexts,
			whisperModel: conf.whisperModel,
			chatModel: conf.chatModel,
			assetRoot: entry,
			extra: entry !== "main"
		});
	}
	return out;
}

//#endregion
//#region src/shared/extras.ts
/** 提示语句长度上限（字符数，与宿主校验同口径） */
const REMINDER_TEXT_MAX = 120;
/** 提醒条数上限（防止配置无限膨胀） */
const REMINDER_MAX_TASKS = 40;
/** 出现/隐藏时长的合法区间（分钟，含端点） */
const CYCLE_MIN_MINUTES = 1;
const CYCLE_MAX_MINUTES = 120;
const DEFAULT_REMINDERS = {
	enabled: false,
	tasks: []
};
const DEFAULT_VISIBILITY_CYCLE = {
	enabled: false,
	visibleMin: 30,
	visibleMax: 60,
	hiddenMin: 10,
	hiddenMax: 30
};
/** `HH:MM`（24 小时制，00:00~23:59） */
const REMINDER_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 时长是否落在 1~120 分钟（有限数字） */
const cycleMinutesValid = (value) => {
	const n = Number(value);
	return Number.isFinite(n) && n >= CYCLE_MIN_MINUTES && n <= CYCLE_MAX_MINUTES;
};
/** 区间是否合法：两个端点都在 1~120，且 min ≤ max */
const cycleRangeValid = (min, max) => cycleMinutesValid(min) && cycleMinutesValid(max) && Number(min) <= Number(max);
/** 一条提醒是否合法（id 非空、时刻合法、语句非空且不超长） */
function reminderTaskValid(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
	const t = raw;
	if (typeof t.id !== "string" || t.id.trim() === "") return false;
	if (typeof t.time !== "string" || !REMINDER_TIME_RE.test(t.time)) return false;
	if (typeof t.text !== "string") return false;
	const text = t.text.trim();
	return text !== "" && Array.from(text).length <= REMINDER_TEXT_MAX;
}
/**
* 把成品配置里读到的 reminders 归一成可用形状（**宽容**：坏条目丢弃，绝不抛）。
* 设置页与宠物页面都用它——宿主侧已按同一规则校验过，这里只是"读到什么就用什么"。
*/
function normalizeReminders(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_REMINDERS };
	const o = raw;
	const list = Array.isArray(o.tasks) ? o.tasks : [];
	const tasks = [];
	for (const item of list) {
		if (!reminderTaskValid(item)) continue;
		const t = item;
		tasks.push({
			id: t.id,
			time: t.time,
			text: t.text.trim(),
			enabled: t.enabled === true
		});
		if (tasks.length >= REMINDER_MAX_TASKS) break;
	}
	return {
		enabled: o.enabled === true,
		tasks
	};
}
/** 把成品配置里读到的 visibilityCycle 归一（非法字段回落默认值，绝不抛） */
function normalizeCycle(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_VISIBILITY_CYCLE };
	const o = raw;
	const num = (v, fallback) => cycleMinutesValid(v) ? Number(v) : fallback;
	const visibleMin = num(o.visibleMin, DEFAULT_VISIBILITY_CYCLE.visibleMin);
	const visibleMax = num(o.visibleMax, DEFAULT_VISIBILITY_CYCLE.visibleMax);
	const hiddenMin = num(o.hiddenMin, DEFAULT_VISIBILITY_CYCLE.hiddenMin);
	const hiddenMax = num(o.hiddenMax, DEFAULT_VISIBILITY_CYCLE.hiddenMax);
	return {
		enabled: o.enabled === true,
		visibleMin: Math.min(visibleMin, visibleMax),
		visibleMax: Math.max(visibleMin, visibleMax),
		hiddenMin: Math.min(hiddenMin, hiddenMax),
		hiddenMax: Math.max(hiddenMin, hiddenMax)
	};
}
/**
* 抽一个随机时长（毫秒）：在 [min, max] 分钟之间均匀取整到秒。
* `min === max` 时退化成固定时长。随机源就是 Math.random（与动画随机链同一套口径）。
*/
function pickCycleDelayMs(min, max) {
	const lo = Math.min(min, max);
	const hi = Math.max(min, max);
	const minutes = lo + Math.random() * (hi - lo);
	return Math.max(1e3, Math.round(minutes * 6e4));
}

//#endregion
//#region src/shared/balance/tone.ts
const QUOTA_WARN_PERCENT = 70;
const QUOTA_CRIT_PERCENT = 90;
function quotaTone(percent) {
	if (percent >= QUOTA_CRIT_PERCENT) return "crit";
	if (percent >= QUOTA_WARN_PERCENT) return "warn";
	return "ok";
}

//#endregion
//#region src/shared/balance/parse.ts
/**
* 可选数字：缺省 → undefined；出现但非法 → null（调用方据此整拍跳过——不把 NaN/字符串送进展示层）。
*/
function optNum(value) {
	if (value === void 0 || value === null) return void 0;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}
/**
* host 的余额原始响应（`BalanceResult`，经 `/state` 的 `sections.balance` 叶子送达）→ 客户端视图。
*
* 形状非法 / shape 不认识 → **null**（消费端跳过这一拍）——注意这里**不抛**：它跑在 1s 轮询里，
* 抛异常会把整拍打断（其余叶子也跟着不渲染）。取数失败（HTTP/网络）不在这里发生：取数在 host，
* 失败会以 `ok:false` 写进 S，由这里正常映射成"不可用"状态。
*/
function toBalanceState(raw) {
	if (!raw || typeof raw !== "object") return null;
	const r = raw;
	const provider = String(r.provider ?? "unknown");
	if (r.ok !== true) {
		const reason = r.reason === "unsupported" || r.reason === "credential-missing" || r.reason === "fetch-error" ? r.reason : "fetch-error";
		return {
			provider,
			ok: false,
			reason,
			message: typeof r.message === "string" ? r.message : void 0
		};
	}
	const d = r.data;
	if (!d || typeof d !== "object") return null;
	if (r.shape === "windows") {
		const monthly = optNum(d.monthly);
		const rolling = optNum(d.rolling);
		const weekly = optNum(d.weekly);
		const rollingCapUsd = optNum(d.rollingCapUsd);
		const weeklyCapUsd = optNum(d.weeklyCapUsd);
		const monthlyCapUsd = optNum(d.monthlyCapUsd);
		if (monthly === void 0 || monthly === null) return null;
		if (rolling === null || weekly === null || rollingCapUsd === null || weeklyCapUsd === null || monthlyCapUsd === null) return null;
		return {
			provider,
			shape: "windows",
			ok: true,
			rolling,
			weekly,
			monthly,
			rollingCapUsd,
			weeklyCapUsd,
			monthlyCapUsd,
			rollingLabel: typeof d.rollingLabel === "string" && d.rollingLabel.length > 0 ? d.rollingLabel : void 0,
			rollingResetsAt: typeof d.rollingResetsAt === "string" ? d.rollingResetsAt : void 0,
			weeklyResetsAt: typeof d.weeklyResetsAt === "string" ? d.weeklyResetsAt : void 0,
			monthlyResetsAt: typeof d.monthlyResetsAt === "string" ? d.monthlyResetsAt : void 0
		};
	}
	if (r.shape === "money") {
		const raw$1 = Array.isArray(d.wallets) ? d.wallets : [];
		const wallets = [];
		for (const item of raw$1) {
			if (!item || typeof item !== "object") continue;
			const w = item;
			if (typeof w.currency !== "string" || w.currency.length === 0) continue;
			if (typeof w.total !== "string" || w.total.length === 0) continue;
			wallets.push({
				currency: w.currency,
				total: w.total,
				granted: typeof w.granted === "string" && w.granted.length > 0 ? w.granted : "0.00",
				toppedUp: typeof w.toppedUp === "string" && w.toppedUp.length > 0 ? w.toppedUp : "0.00",
				fullBalance: typeof w.fullBalance === "string" && w.fullBalance.length > 0 ? w.fullBalance : void 0
			});
		}
		if (wallets.length === 0) return null;
		return {
			provider,
			shape: "money",
			ok: true,
			wallets,
			tier: d.tier === "peak" || d.tier === "idle" ? d.tier : void 0
		};
	}
	if (r.shape === "points") {
		if (typeof d.unit !== "string" || d.unit.length === 0) return null;
		if (typeof d.total !== "string" || d.total.length === 0) return null;
		return {
			provider,
			shape: "points",
			ok: true,
			points: {
				unit: d.unit,
				total: d.total,
				full: typeof d.full === "string" && d.full.length > 0 ? d.full : void 0
			}
		};
	}
	return null;
}

//#endregion
//#region src/shared/balance/handlers/money.ts
/**
* money：各币种按**自己的基准**（`fullBalance`）算「剩余比例」，再相加折算成已用百分比。
* 没有基准的币种跳过（不参与折算，不替它猜一个）；一个带基准的都没有 → undefined（不播档位）。
*/
function moneyPercent(v) {
	let remaining = 0;
	let based = 0;
	for (const w of v.wallets ?? []) {
		const total = Number(w.total);
		const full = Number(w.fullBalance);
		if (!Number.isFinite(total) || !Number.isFinite(full) || full <= 0) continue;
		remaining += total / full;
		based++;
	}
	if (based === 0) return void 0;
	return Math.max(0, Math.min(100, 100 - remaining * 100));
}
/**
* money：一行「余额（峰/谷）¥x.xx」。
*
* 只显示 `total !== 0` 的币种（**负数要显示**——透支是真的欠钱；正好 0 的不占地方），
* CNY 优先，用符号拼、`/` 分隔；全都为 0 时兜底显示主币种 ¥0.00（否则气泡会空一行）。
* 档位装饰（峰/谷）只有提供该计价规则的服务商才有；没有就不加括号那一段。
*/
function moneyRows(v) {
	const visible = (v.wallets ?? []).filter((w) => Number(w.total) !== 0).sort((a, b) => (a.currency === "CNY" ? 0 : 1) - (b.currency === "CNY" ? 0 : 1));
	const amount = visible.length > 0 ? visible.map((w) => (w.currency === "USD" ? "$" : "¥") + w.total).join("/") : "¥0.00";
	if (!v.tier) return [{
		role: "label",
		text: "余额 " + amount
	}];
	return [
		{
			role: "label",
			text: "余额（"
		},
		{
			role: "tier",
			tier: v.tier,
			text: v.tier === "peak" ? "峰" : "谷"
		},
		{
			role: "label",
			text: "）" + amount
		}
	];
}
const moneyHandler = {
	percent: moneyPercent,
	rows: moneyRows
};

//#endregion
//#region src/shared/balance/handlers/points.ts
/**
* points：与 money 同一套「按基准折算」的数学，数据来自 `points` 而非 `wallets`。
* 没有基准 / 基准非法 → undefined（不播档位，不替服务商猜一个）。
*/
function pointsPercent(v) {
	const total = Number(v.points?.total);
	const full = Number(v.points?.full);
	if (!Number.isFinite(total) || !Number.isFinite(full) || full <= 0) return void 0;
	return Math.max(0, Math.min(100, 100 - total / full * 100));
}
/**
* points：一行「余额 800 积分」。
* 单位是数据带出的后缀，**绝不套货币符号**（`currency` 那套 $/¥ 判断只属于 money）。
* 0 也照常显示：0 积分是真实读数。
*/
function pointsRows(v) {
	const p = v.points;
	if (!p) return [{
		role: "label",
		text: "积分数据不可用"
	}];
	return [{
		role: "label",
		text: "余额 " + p.total + " " + p.unit
	}];
}
const pointsHandler = {
	percent: pointsPercent,
	rows: pointsRows
};

//#endregion
//#region src/shared/balance/handlers/windows.ts
/**
* 窗口展示名（联想框文案用）：周、月。
* 滚动窗的时长是**服务商自己的业务事实**（如 5 小时），不走这张表，见 DEFAULT_ROLLING_LABEL。
*/
const WINDOW_LABELS = {
	weekly: "周",
	monthly: "月"
};
/**
* 滚动窗展示名的兜底：服务商应随数据带 `rollingLabel`，缺省时才用它。
* 之所以要有兜底：缺一个标签会让气泡出现空档，而 5h 是当前两个滚动窗口服务商的共同取值。
*/
const DEFAULT_ROLLING_LABEL = "5h";
/** 窗口展示名：滚动窗取服务商自报值（缺省 5h），周/月走固定表 */
function windowLabel(v, w) {
	if (w === "rolling") return v.rollingLabel ?? DEFAULT_ROLLING_LABEL;
	return WINDOW_LABELS[w];
}
/** 各窗口的满额度（USD）：全部来自数据（展示层不写死任何服务商的额度） */
function windowQuotas(v) {
	return {
		rolling: v.rollingCapUsd,
		weekly: v.weeklyCapUsd,
		monthly: v.monthlyCapUsd
	};
}
/**
* 取最先告急的一个窗口（所有 windows 形态的服务商共用同一套，无服务商判断）：
* - 满额度齐全 → 绝对口径：剩余额度（USD）最少者；
* - 有窗口给不出满额度 → 退化为相对口径：已用百分比最大者
*   （两窗额度量级不同，缺一个还硬比绝对剩余会反直觉）。
* 不存在的窗口直接跳过，不补 0。
*
* 绝对口径的副作用（刻意保留）：滚动窗额度最小，通常先报它；两端一致，完整读数见 tools/api-tester.html。
*/
function urgentWindow(v) {
	if (v.shape !== "windows") return void 0;
	const quotas = windowQuotas(v);
	const resets = {
		rolling: v.rollingResetsAt,
		weekly: v.weeklyResetsAt,
		monthly: v.monthlyResetsAt
	};
	const present = [
		"rolling",
		"weekly",
		"monthly"
	].filter((w) => v[w] !== void 0);
	if (present.length === 0) return void 0;
	const allQuotas = present.every((w) => {
		const quota = quotas[w];
		return quota !== void 0 && quota > 0;
	});
	let best;
	for (const w of present) {
		const percent = v[w] ?? 0;
		const quota = quotas[w];
		const cand = {
			label: windowLabel(v, w),
			percent,
			quotaUsd: quota,
			remainingUsd: allQuotas && quota !== void 0 ? quota * (100 - percent) / 100 : void 0,
			resetsAt: resets[w]
		};
		if (best === void 0) {
			best = cand;
			continue;
		}
		const moreUrgent = allQuotas ? (cand.remainingUsd ?? 0) < (best.remainingUsd ?? 0) : cand.percent > best.percent;
		if (moreUrgent) best = cand;
	}
	return best;
}
/**
* 重置时间 → 相对文案（保留 1 位小数）：
* - 距重置 ≥ 4 天 → 「N.x 天」
* - 距重置 < 4 天 → 「N.x 小时」
* - 已过重置点 → 「已重置」；未知时间 → 空串
*/
function resetInText(iso) {
	if (!iso) return "";
	const t = new Date(iso).getTime();
	if (!Number.isFinite(t)) return "";
	const delta = t - Date.now();
	if (delta <= 0) return "已重置";
	const hoursF = delta / 36e5;
	if (hoursF >= 96) return (Math.round(hoursF / 24 * 10) / 10).toFixed(1) + " 天";
	return Math.max(.1, Math.round(hoursF * 10) / 10).toFixed(1) + " 小时";
}
/** windows：三窗口取最大（只有月窗口时就是它自己） */
function windowsPercent(v) {
	return Math.max(v.rolling ?? 0, v.weekly ?? 0, v.monthly ?? 0);
}
/** windows：两行 —— 最紧迫窗口的「已用 N%」+ 重置倒计时 */
function windowsRows(v) {
	const w = urgentWindow(v);
	if (!w) return [{
		role: "label",
		text: "额度数据不可用"
	}];
	const reset = resetInText(w.resetsAt);
	return [{
		role: "label",
		text: w.label + "额度已用 " + Math.round(w.percent) + "%"
	}, {
		role: "sub",
		text: reset ? reset + "重置" : "已重置"
	}];
}
/**
* windows：展开态每个存在窗口一行 —— 窗口名 + 进度条 + 已用百分比 + 重置倒计时。
* 只列**存在**的窗口：`rolling` / `weekly` 缺省 = 该服务商没有这个窗口，不补 0、不画空条。
*/
function windowsDetail(v) {
	const resets = {
		rolling: v.rollingResetsAt,
		weekly: v.weeklyResetsAt,
		monthly: v.monthlyResetsAt
	};
	const rows = [];
	for (const w of [
		"rolling",
		"weekly",
		"monthly"
	]) {
		const percent = v[w];
		if (percent === void 0) continue;
		const reset = resetInText(resets[w]);
		const usedText = Math.round(percent) + "%";
		const resetText = reset === "" ? "已重置" : reset + "重置";
		rows.push({
			role: "quota",
			text: windowLabel(v, w) + " " + usedText + " " + resetText,
			label: windowLabel(v, w),
			percent,
			tone: quotaTone(percent),
			usedText,
			resetText
		});
	}
	return rows.length > 0 ? rows : windowsRows(v);
}
const windowsHandler = {
	percent: windowsPercent,
	rows: windowsRows,
	detail: windowsDetail
};

//#endregion
//#region src/shared/balance/handlers/index.ts
const HANDLERS = {
	windows: windowsHandler,
	money: moneyHandler,
	points: pointsHandler
};

//#endregion
//#region src/shared/balance/percent.ts
/**
* 事件档位百分比（已用百分比语义：0 = 未消耗，100 = 耗尽）。具体口径见各 handler：
* - windows：取三窗口最大（风险最高者为准）
* - money：按各币种自己的 `fullBalance` 折算后叠加（不需要汇率）
* - points：按 `points.full` 折算（同一单位内的比值）
* 给不出百分比语义的形态 → undefined（不播档位动画，不替服务商猜一个）。
*/
function balancePercent(v) {
	return HANDLERS[v.shape].percent(v);
}
/**
* 余额事件档位索引（与 assets/config.jsonc 注释一致）：
* index = p === 100 ? 5 : Math.floor(p / 20)
*/
function balanceEventIndex(p) {
	if (p === 100) return 5;
	const i = Math.floor(p / 20);
	return i < 5 ? i : 4;
}

//#endregion
//#region src/shared/balance/view.ts
/** 不可用状态的气泡行（显式说明原因，绝不伪造数字）：
*  - unsupported：服务商未登记查询接口（配置事实，不是故障）→ 报出 provider id，便于自查"当前到底是谁"
*  - credential-missing：缺凭证 → 次要行放 host 报的凭证名（不含 message 时不留空行）
*  - fetch-error：抓取失败 → 次要行放底层错误
* 次要行为空的会被剔除：空 div 在气泡里会白占一行高度。 */
function unavailableRows(state) {
	const rows = state.reason === "unsupported" ? [{
		role: "error",
		text: "当前服务商暂不支持余额查询"
	}, {
		role: "sub",
		text: "当前服务商：" + state.provider
	}] : state.reason === "credential-missing" ? [{
		role: "error",
		text: "缺少余额查询凭证"
	}, {
		role: "sub",
		text: state.message ?? ""
	}] : [{
		role: "error",
		text: "余额查询失败"
	}, {
		role: "sub",
		text: state.message ?? ""
	}];
	return rows.filter((r) => r.role !== "quota" && r.text !== "");
}
/**
* 把 BalanceState 渲染成气泡行数据（纯函数，不碰 DOM/React）：
* - windows：两行 —— 「X额度已用 N%」+ 重置倒计时
* - money：一行 —— 「余额（峰/谷）¥x.xx」（峰红/谷绿由 role:'tier' 表达）；
*   服务商没给档位装饰时退化成「余额 ¥x.xx」，不替它编一个峰谷
* - points：一行 —— 「余额 800 积分」（单位由数据带出，绝不套货币符号）
* - 无效：显式展示不可用原因（见 unavailableRows），绝不伪造数字
*/
function balanceBubbleView(state) {
	if (!state.ok) return unavailableRows(state);
	return HANDLERS[state.shape].rows(state);
}
/**
* 展开态行数据（点余额气泡后显示）：只有 windows 有三窗口读数可展开，每个存在窗口一行。
*
* money / points 形态没有"窗口"这个概念（只有账户余额 / 积分），也没有额外的 handler.detail，
* 于是回落到收起态视图 —— 展开前后内容一致，不会出现"点了一下却什么都没变"的空交互。
*/
function balanceDetailView(state) {
	if (!state.ok) return unavailableRows(state);
	const handler = HANDLERS[state.shape];
	return handler.detail ? handler.detail(state) : handler.rows(state);
}

//#endregion
//#region src/shared/balance/notice.ts
/**
* 余额不可用时是否弹气泡：
* - 显式请求（`/balance` 命令、桌面「查看余额」菜单）：一律弹——用户问了就该有答复，包括"不支持"这件事；
* - 自动轮询：只在原因（含服务商）**变化**时弹一次（首次检测到也算变化），避免每 30 分钟反复刷同一句话。
* 判定纯粹基于传入的 lastKey，不持有状态；调用方负责保存返回值里的 key。
*/
function decideBalanceNotice(state, lastKey, explicit) {
	if (state.ok) return {
		show: false,
		key: null
	};
	const key = state.reason + ":" + state.provider;
	return {
		show: explicit || key !== lastKey,
		key
	};
}

//#endregion
//#region src/shared/work-status.ts
/** 工作状态档位（对应 animations.events.workStatus 数组索引，顺序即档位，勿在中间插入新档） */
const WORK_STATUS_STATES = [
	"thinking",
	"working",
	"result",
	"waiting",
	"success",
	"error"
];
/** 档位 → workStatus 数组索引（与 events.workStatus 数组顺序严格一致） */
const WORK_STATUS_INDEX = {
	thinking: 0,
	working: 1,
	result: 2,
	waiting: 3,
	success: 4,
	error: 5
};
/** 快照解析：档位不认识 → 归一成 null（空闲）；形状非法 → null（消费端跳过这一拍，不抛） */
function toWorkStatus(raw) {
	if (!raw || typeof raw !== "object") return null;
	const r = raw;
	const state = r.state === null || typeof r.state === "string" && WORK_STATUS_STATES.includes(r.state) ? r.state : null;
	return {
		state,
		task: typeof r.task === "string" ? r.task : null
	};
}

//#endregion
//#region src/shared/state.ts
/** 叶子规范化：形状不对（非对象 / counter 非数字）→ null（丢弃，不让脏数据进渲染层） */
function normLeaf(value) {
	if (!value || typeof value !== "object") return null;
	const leaf$1 = value;
	if (typeof leaf$1.counter !== "number" || !Number.isFinite(leaf$1.counter)) return null;
	return {
		counter: leaf$1.counter,
		data: leaf$1.data ?? null
	};
}
/**
* 拉一次 /state。
* 失败 / HTTP 非 2xx / 形状不对 → null（轮询侧静默重试，与其余轮询同一容错口径）。
*
* `wait` 传了就带 `?since=&timeout=` 走**长轮询**：宿主在"版本没变"时挂起，直到任意叶子被写过
* （立刻返回）或超时。不传 = 立刻返回全量（改造前的语义）。
*/
async function fetchState(baseUrl = "/dsh-pet-jt-7340/state", wait) {
	try {
		const url = wait ? `${baseUrl}?since=${wait.since}&timeout=${wait.timeoutMs}` : baseUrl;
		const res = await fetch(url, { cache: "no-store" });
		if (!res.ok) return null;
		const raw = await res.json().catch(() => null);
		if (!raw || typeof raw !== "object") return null;
		const sections = {};
		const rawSections = raw.sections && typeof raw.sections === "object" ? raw.sections : {};
		for (const [name, value] of Object.entries(rawSections)) {
			const leaf$1 = normLeaf(value);
			if (leaf$1) sections[name] = leaf$1;
		}
		const pets = {};
		const rawPets = raw.pets && typeof raw.pets === "object" ? raw.pets : {};
		for (const [petId, entry] of Object.entries(rawPets)) {
			if (!entry || typeof entry !== "object") continue;
			const leaves = {};
			for (const [name, value] of Object.entries(entry)) {
				const leaf$1 = normLeaf(value);
				if (leaf$1) leaves[name] = leaf$1;
			}
			pets[petId] = leaves;
		}
		return {
			counter: typeof raw.counter === "number" && Number.isFinite(raw.counter) ? raw.counter : void 0,
			sections,
			pets
		};
	} catch {
		return null;
	}
}
/** 遍历 S 的所有叶子（顺序：sections 在前、pets 在后） */
function* walkLeaves(s) {
	for (const [name, leaf$1] of Object.entries(s.sections ?? {})) yield ["sections." + name, leaf$1];
	for (const [petId, leaves] of Object.entries(s.pets ?? {})) for (const [name, leaf$1] of Object.entries(leaves ?? {})) yield ["pets." + petId + "." + name, leaf$1];
}
/** S → { 叶子路径: counter }：首拉基线用（新增的 section/宠物自动纳入，不用改这里） */
function flattenCounters(s) {
	const out = {};
	for (const [path, leaf$1] of walkLeaves(s)) out[path] = leaf$1.counter;
	return out;
}
/**
* 与基线比对，**就地推进基线**，返回本次变化的叶子。
* 首拉不要调它（用 flattenCounters 记基线即可）——否则页面刷新会把旧数据重放一遍。
*/
function takeChanged(s, baseline) {
	const out = [];
	for (const [path, leaf$1] of walkLeaves(s)) {
		if (baseline[path] === leaf$1.counter) continue;
		baseline[path] = leaf$1.counter;
		out.push({
			path,
			leaf: leaf$1
		});
	}
	return out;
}
/**
* 类型收窄：余额叶子 → `{ state, manual }`。
* `manual` = 这次写入是**手动触发**的（`/balance` 命令、桌面「查看余额」菜单）——
* 由 host 在写入时标记（`{...result, manual: true}`），因为只有 host 知道这次刷新是谁要的。
* 消费端据此决定"余额不可用时要不要必弹文字说明"（decideBalanceNotice 的 explicit 参数）。
* 形状非法 → null（消费端跳过这一拍，不抛）。
*/
function readBalance(leaf$1) {
	const state = toBalanceState(leaf$1.data);
	if (!state) return null;
	const manual = leaf$1.data.manual === true;
	return {
		state,
		manual
	};
}
/**
* 类型收窄：宠物说话叶子 → SayCue（形状非法 / 空文本 → null，消费端跳过这一拍）。
* 碎碎念、命令气泡、对话回复共用这一个叶子——前端本来就是同一条展示链路
* （同一个 triggerWhisper、同一个气泡槽、同一批 events.whisper 动画）。
* `duration` / `anim` 缺省即**老行为**（10s + 联动），所以老 host 写的叶子照常能读。
*/
function readSay(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	if (d.clear === true) return { kind: "clear" };
	if (typeof d.text !== "string" || !d.text) return null;
	return {
		kind: "say",
		text: d.text,
		image: typeof d.image === "string" ? d.image : void 0,
		url: typeof d.url === "string" ? d.url : void 0,
		duration: typeof d.duration === "number" && Number.isFinite(d.duration) && d.duration >= 0 ? d.duration : void 0,
		anim: typeof d.anim === "boolean" ? d.anim : void 0
	};
}
/**
* 类型收窄：工作状态叶子 → 快照（形状非法 → null，消费端跳过这一拍）。
* 与余额不同，这里没有"手动"标记：工作状态永远由 DSH 事件驱动，没有用户主动要的那条路。
*/
function readWorkStatus(leaf$1) {
	return toWorkStatus(leaf$1.data);
}
/**
* 类型收窄：点播动画叶子 → 动画名**或**地址 + 回执编号（两者都空 → null，消费端跳过这一拍）。
* **两种形态并列、由字段名区分**（issue #122 第 1 条）：
*   - `name`：该宠物动画池内的名字，**名字即文件名**，消费端拼 `/thumb/<素材根>/<名>.webm` 换源，
*     并走菜单动作处理函数（镜像修正 / 移动类走真实位移等菜单语义）；
*   - `url`：第三方给的**完整地址**（scheme 已由宿主卡在 http/https），消费端直接换源播一次，
*     **不走菜单语义**——裸地址没有"是不是文字类 / 是不是移动类"这些属性。
* "这个动画是否存在于该宠物"由宿主在写入前保证（播放端对不存在的名字没有兜底）。
* `playbackId`：宿主受理时生成的回执编号（issue #122），渲染端拿它在播放的四个时机
* 上报真实状态（见 /playback 路由）。老 host 不写这个字段 → undefined，消费端按"无回执"处理。
* `facing`：调用方**显式指定**的朝向（可选）。`undefined` = 没指定 → 消费端**不动朝向**，
* 保持宠物当前朝向——**不是**"回落 left"（叶子写端只在显式给了时才写这个字段，所以"没要求"
* 与"要求 left"在形状上就是可区分的）。两种形态都适用。
*/
function readAnim(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	const name = typeof d.name === "string" && d.name ? d.name : void 0;
	const url = typeof d.url === "string" && d.url ? d.url : void 0;
	if (name === void 0 && url === void 0) return null;
	return {
		name,
		url,
		playbackId: typeof d.playbackId === "string" && d.playbackId ? d.playbackId : void 0,
		facing: d.facing === "left" || d.facing === "right" ? d.facing : void 0
	};
}
/**
* 类型收窄：占用锁叶子 → `LockState`（形状非法 → null，消费端跳过这一拍）。
*
* **这是状态，不是指令**（与 anim / position / throw 那三个不同）：宿主写、渲染端读来决定
* "要不要冻结自己"——随机链不掷骰、暂停自播动画、忽略**自动**来源的余额与工作状态表现。
* 宿主停不掉一段正在播的视频，所以"完全静止"最终是渲染端执行的。
*
* **宿主不会到点推一次"锁没了"**：`expiresAt` 是唯一真相，渲染端据此**自己**定时解除
* （宿主侧的过期是懒判的，见 src/host/lock.ts）。因此读到 `expiresAt` **已经过去**就等于没有锁
* ——页面刷新后才读到一份陈旧叶子时，必须按这个判，不能只看 `locked`。
*
* **不含 `lockId`**：那是持锁者的凭证，不能放进人人可读的 /state。
*/
function readLock(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	if (d.locked === false) return { locked: false };
	if (d.locked !== true) return null;
	if (typeof d.expiresAt !== "number" || !Number.isFinite(d.expiresAt)) return null;
	return {
		locked: true,
		expiresAt: d.expiresAt
	};
}
/**
* 类型收窄：位置指令叶子 → `{ x, y, mode, duration }`（形状非法 → null，消费端跳过这一拍）。
* **这是指令不是状态上报**：host 写、前端读来挪宠物，前端不往回写。
* `x`/`y` 是宠物**中心**的归一化坐标（0~1，host 写入前已夹取）；
* `mode` 决定走哪条路（instant 一帧到位 / spring 过阻尼弹簧 / line 按 duration 直线走到）；
* `duration` **只有 `line` 模式才在叶子里**，其余模式恒为 `0`（它们本来就不用时间）。
*/
function readPosition(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	if (typeof d.x !== "number" || !Number.isFinite(d.x)) return null;
	if (typeof d.y !== "number" || !Number.isFinite(d.y)) return null;
	if (d.mode !== "instant" && d.mode !== "spring" && d.mode !== "line") return null;
	if (d.mode === "line") {
		if (typeof d.duration !== "number" || !Number.isFinite(d.duration) || d.duration < 0) return null;
		return {
			x: d.x,
			y: d.y,
			mode: "line",
			duration: d.duration
		};
	}
	return {
		x: d.x,
		y: d.y,
		mode: d.mode,
		duration: 0
	};
}
/**
* 类型收窄：抛掷指令叶子 → `{ angle, power }`（形状非法 → null，消费端跳过这一拍）。
* `angle` 单位**度**（`0` = 正右，逆时针为正）；`power` 是力度倍率（`1.0` = 1200 px/s 软钳速前）。
* 同样是**指令**，前端不往回写。
*/
function readThrow(leaf$1) {
	if (!leaf$1.data || typeof leaf$1.data !== "object") return null;
	const d = leaf$1.data;
	if (typeof d.angle !== "number" || !Number.isFinite(d.angle)) return null;
	if (typeof d.power !== "number" || !Number.isFinite(d.power) || d.power <= 0) return null;
	return {
		angle: d.angle,
		power: d.power
	};
}
/**
* 动作端点：POST 一次，返回是否成功（`{ok:true}`）。
* 动作**不返回数据**——数据只有一个出口（/state）。调用方**不需要**在收到 ok 后再做什么：
* 这些动作都会写叶子 → 顶层 `counter` 变 → 挂着的长轮询那一拍立刻返回，结果 0 延迟到达。
* （改造前这里靠"前端主动叫醒一拍"，长轮询上线后那套已经删掉了。）
*/
async function postAction(baseUrl, body) {
	try {
		const res = await fetch(baseUrl, {
			method: "POST",
			...body === void 0 ? {} : {
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			}
		});
		if (!res.ok) return false;
		const data = await res.json().catch(() => null);
		return data?.ok === true;
	} catch {
		return false;
	}
}

//#endregion
//#region src/shared/whisper.ts
/** 碎碎念文本 → 气泡行（两端共用同一份行数据；纯函数，不碰 DOM/React） */
function whisperBubbleView(state) {
	if (state.ok) return [{
		role: "label",
		text: state.text
	}];
	const msg = state.reason === "provider-missing" ? "当前对话未配置模型，碎碎念不可用" : "碎碎念生成失败" + (state.message ? "：" + state.message : "");
	return [{
		role: "label",
		text: msg
	}];
}
/**
* 表情包图片 URL —— 与视频（/thumb）**同一套拼法**：
* `<base>/pic/memes/<素材根>/<名称>.png`，素材根与名称都需编码（名称常含中文）。
*
* 为什么要带素材根：图片的归属与动画一致——`pet/<素材根>-memes/` 存在时该种类**只认自己**的
* 表情包目录，否则才走「用户目录 → 包内 assets/memes」。不带素材根就无法表达"这张图属于哪只宠物"，
* 宿主只能猜（同一张图名在两个种类的独占目录里都存在时更无从分辨）。
* assetRoot 缺省/空白 → 退回旧的两段形式 `<base>/pic/memes/<名称>.png`（= 素材根 main 的目录链），
* 未打标的宠物与老宿主仍能取到包内表情包，不至于图裂。
*
* base 语义 = 各端的「已含 /dsh-pet-jt-7340 前缀的宿主基址」（**与视频的 assetBase 一致**）：
*   - 浏览器：缺省 `/dsh-pet-jt-7340`（页面就在宿主 origin 上，相对路径即可）；
*   - 桌面：传 `BASE`（`http://127.0.0.1:<port>/dsh-pet-jt-7340` 或 bridge 的
*     `dsh-pet-jt-bridge://dsh-pet-jt/dsh-pet-jt-7340`）——桌面页面是 file:// 加载的，
*     相对路径会被解析成 file:///… 而必然失败；且 bridge 模式必须走自定义 scheme。
*
* 注意：base 已含 `/dsh-pet-jt-7340`，函数内**不得**再拼一次（否则出现
* `…/dsh-pet-jt-7340/dsh-pet-jt-7340/…` 而 404——桌面端图裂的成因）。
*/
function memeImageUrl(name, base = "/dsh-pet-jt-7340", assetRoot = "") {
	const root = String(assetRoot ?? "").trim();
	const prefix = root ? "/pic/memes/" + encodeURIComponent(root) : "/pic/memes";
	return base + prefix + "/" + encodeURIComponent(name) + ".png";
}
/** 气泡配图 class（两端共用，样式见 MEME_BUBBLE_CSS） */
const MEME_IMG_CLASS = "pet-bub-img";
/** 带图气泡 class：取消 min-width，让气泡贴合图片宽度（否则图旁留大片空白） */
const MEME_BUBBLE_CLASS = "has-img";
/** 气泡配图样式 —— 两端注入同一份（与 SCORE_POPUP_CSS / MENU_CSS 同理，避免两处各写一遍）。
* 尺寸锚在**字号**上：基准 `--m` = 气泡正文最终字号 `--f`（各壳注入，见 shared/fonts.ts 的 resolveFontPx），
* 于是字号调大图同步变大，图文比例不会一边涨一边不动；`--f` 未注入时回退到原表达式
* （宠物宽 × 0.0455），与改造前一致，调用方无需传尺寸。
* 系数 = 原系数 ÷ 0.0455，故默认 462px 宠物 / 21px 字号下与改造前逐像素一致（0.34 → 7.4725）。
* `max-width:100%` 是兜底：气泡宽度上限随字号收口，图再宽也只缩到泡内，绝不顶出白底
* （改造前图是固定 0.34×宠物宽且无上限：关掉 followPet 把字号调到 14 以下时，图会戳出气泡约 25px）。 */
const MEME_BUBBLE_CSS = [".pet-bub-img{--m:var(--f,calc(var(--dsh-pet-jt-size,var(--pet-size,462px))*0.0455));display:block;width:calc(var(--m)*7.4725);max-width:100%;height:auto;border-radius:calc(var(--m)*0.5714);margin:0 auto calc(var(--m)*0.3736);object-fit:cover;pointer-events:none;user-select:none}", ".pet-bubble.has-img,.dsh-pet-jt-bubble.has-img{min-width:0}"].join("");
/** 只注入一次（两端共用；页面已有同一标记则跳过） */
let memeCssInjected = false;
function injectMemeBubbleCss() {
	if (memeCssInjected || typeof document === "undefined") return;
	memeCssInjected = true;
	if (document.querySelector("style[data-plugin-css=\"dsh-pet-jt/meme-bubble\"]") !== null) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet-jt";
	tag.dataset.pluginCss = "dsh-pet-jt/meme-bubble";
	tag.textContent = MEME_BUBBLE_CSS;
	document.head.appendChild(tag);
}

//#endregion
//#region src/client/bubble.ts
/** 气泡内联样式：白色半透明圆润泡 + 底部小尾巴指向宠物；字体用上首软糖体（本地打包，稳定）。
* 尺寸分两类锚点：
*  - 气泡**盒子**（宽上下限/内边距/圆角/尾巴/阴影/行间距/角标）锚在字号 `--f` 上（em 语义）：
*    字号调大盒子同步变大，文字永远装得下——不再出现「字长大了、框没长」把文字顶出白底；
*  - 气泡**位置**（bottom 偏移）仍锚在 `--dsh-pet-jt-size`，保证气泡始终贴在宠物头顶同一点。
* 系数 = 原系数 ÷ 0.0455（原字号系数），故默认 462px 宠物 / 21px 字号下与改造前逐像素一致：
* ×0.0455 → 1em、最小宽 0.26 → 5.7143、最大宽 0.5 → 10.989 等。
* 字号：正文取 --dsh-pet-jt-font-bubble（两端按该宠物尺寸算好注入，见 shared/fonts.ts 的 resolveFontPx）；
* 气泡内其余层级按「相对正文的比例」派生——故统一先定义局部变量 --f = 正文最终字号，
* 子元素经自定义属性继承取用；变量未注入时 --f 回退到原表达式，行为与改造前逐像素一致。
* 换行：正文不锁 nowrap，折行只在内容真的超过宽度上限时才发生（见下一条）。
* 宽度为什么必须写 width:max-content：气泡是 left:50% 的绝对定位盒，它的「可用宽度」只有包含块的一半
* （= 宠物宽度的一半），shrink-to-fit 会先被这道墙卡死——max-width 调多大都不生效，字号一大就折行/顶出。
* 写 width:max-content 后盒子先按内容取宽，再由 max-width 收口（= min(字号口径上限, 包含块 100%)），
* 「字变大 → 框变宽」才真正生效，且永不超过宠物本身宽度（桌面窗口只比宠物大一圈，超了会被裁）。
* 断词用 break-word 而非 anywhere：只在整词放不下时才断，不会把 85% / ¥12.34 这类数字拆到两行。 */
const bubbleCss = [
	"@font-face{font-family:\"ShangshouSoftCandy\";src:url(\"/dsh-pet-jt-7340/font/上首软糖体.ttf\") format(\"truetype\");font-display:swap;font-weight:400}",
	".dsh-pet-jt-bubble{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(100% - var(--dsh-pet-jt-size)*0.108);width:max-content;min-width:calc(var(--f)*5.7143);max-width:min(calc(var(--f)*16),100%);box-sizing:content-box;padding:calc(var(--f)*0.4835) calc(var(--f)*0.6593);border-radius:calc(var(--f)*0.7692);background:rgba(255,255,255,.92);--f0:var(--dsh-pet-jt-font-bubble,calc(var(--dsh-pet-jt-size)*0.0455));--f:var(--f0);color:#2b2b2b;font-family:var(--dsh-pet-jt-font-family,\"ShangshouSoftCandy\",\"Yuanti SC\",\"YouYuan\",\"幼圆\",\"Comic Sans MS\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif);font-size:var(--f);line-height:1.6;z-index:3;pointer-events:none;box-shadow:0 calc(var(--f)*0.1978) calc(var(--f)*0.7692) rgba(0,0,0,.14),0 1px 3px rgba(0,0,0,.08);backdrop-filter:blur(6px);opacity:0;transition:opacity .25s ease;white-space:normal;overflow-wrap:break-word}",
	".dsh-pet-jt-bubble::after{content:\"\";position:absolute;left:50%;bottom:calc(var(--f)*-0.3736);transform:translateX(-50%);border:calc(var(--f)*0.3736) solid transparent;border-top-color:rgba(255,255,255,.92);border-bottom:none}",
	".dsh-pet-jt-bubble.is-on{opacity:1}",
	".dsh-pet-jt-bubble.dsh-pet-jt-whisper{font-size:calc(var(--f)*0.7473);min-width:calc(var(--f)*2.1978);max-width:min(calc(var(--f)*10.989),100%)}",
	".dsh-pet-jt-bubble .pet-bub-title{font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6);margin-bottom:calc(var(--f)*0.1978)}",
	".dsh-pet-jt-bubble .pet-bub-row{display:flex;justify-content:space-between;gap:calc(var(--f)*0.6593);flex-wrap:wrap}",
	".dsh-pet-jt-bubble .pet-bub-row>span{white-space:nowrap}",
	".dsh-pet-jt-bubble .pet-bub-sub{font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6)}",
	".dsh-pet-jt-bubble .pet-bub-val{font-variant-numeric:tabular-nums;font-weight:650;color:#1f1f1f}",
	".dsh-pet-jt-bubble .pet-bub-err{color:#d94f3d;font-size:calc(var(--f)*0.7692)}",
	".dsh-pet-jt-bubble .pet-bub-tag{margin-left:calc(var(--f)*0.2857);font-size:calc(var(--f)*0.4835);color:rgba(43,43,43,.55);border:1px solid rgba(43,43,43,.25);border-radius:calc(var(--f)*0.2857);padding:0 calc(var(--f)*0.1978);vertical-align:1px}",
	".dsh-pet-jt-bubble .pet-bub-tier{font-weight:700}",
	".dsh-pet-jt-bubble .pet-bub-tier-peak{color:#e53935}",
	".dsh-pet-jt-bubble .pet-bub-tier-idle{color:#2e9e4f}",
	".dsh-pet-jt-bubble.is-clickable{pointer-events:auto;cursor:pointer}",
	".dsh-pet-jt-bubble.is-expanded{--f:calc(var(--f0)*0.6);width:min(calc(var(--f)*21),100%);max-width:100%}",
	".dsh-pet-jt-bubble.is-on.is-fading{opacity:0}",
	".dsh-pet-jt-bubble .pet-bub-quota{display:flex;align-items:center;gap:calc(var(--f)*0.4);margin:calc(var(--f)*0.13) 0}",
	".dsh-pet-jt-bubble .pet-bub-quota-label{flex:none;min-width:calc(var(--f)*1.9);font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6)}",
	".dsh-pet-jt-bubble .pet-bub-quota-bar{flex:1 1 auto;height:calc(var(--f)*0.5);border-radius:calc(var(--f)*0.25);background:rgba(43,43,43,.12);overflow:hidden}",
	".dsh-pet-jt-bubble .pet-bub-quota-fill{display:block;height:100%;border-radius:inherit;background:#2e9e4f}",
	".dsh-pet-jt-bubble .pet-bub-quota-fill.pet-bub-quota-warn{background:#e8952f}",
	".dsh-pet-jt-bubble .pet-bub-quota-fill.pet-bub-quota-crit{background:#e53935}",
	".dsh-pet-jt-bubble .pet-bub-quota-used{flex:none;min-width:calc(var(--f)*2.2);text-align:right;font-variant-numeric:tabular-nums;font-weight:650;color:#1f1f1f}",
	".dsh-pet-jt-bubble .pet-bub-quota-reset{flex:none;min-width:calc(var(--f)*2.6);text-align:right;font-size:calc(var(--f)*0.7692);color:rgba(43,43,43,.6)}"
].join("\n");
/** 只注入一次 */
function injectBubbleCss() {
	if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"dsh-pet-jt/bubble\"]") === null) {
		const tag = document.createElement("style");
		tag.dataset.plugin = "dsh-pet-jt";
		tag.dataset.pluginCss = "dsh-pet-jt/bubble";
		tag.textContent = bubbleCss;
		document.head.appendChild(tag);
	}
}
/** 行数据 → React 节点（shared 视图的薄壳） */
function rowsToNodes(h, rows) {
	if (rows.some((r) => r.role === "tier")) return h("div", {
		className: "pet-bub-row",
		children: rows.map((r, i) => {
			if (r.role === "quota") return null;
			if (r.role === "tier") return h("span", {
				key: i,
				className: "pet-bub-tier pet-bub-tier-" + r.tier,
				children: r.text
			});
			return h("span", {
				key: i,
				children: r.text
			});
		})
	});
	return rows.map((r, i) => {
		if (r.role === "quota") return h("div", {
			key: i,
			className: "pet-bub-quota",
			children: [
				h("span", {
					key: "label",
					className: "pet-bub-quota-label",
					children: r.label
				}),
				h("span", {
					key: "bar",
					className: "pet-bub-quota-bar",
					children: h("i", {
						className: "pet-bub-quota-fill pet-bub-quota-" + r.tone,
						style: { width: Math.max(0, Math.min(100, r.percent)) + "%" }
					})
				}),
				h("span", {
					key: "used",
					className: "pet-bub-quota-used",
					children: r.usedText
				}),
				h("span", {
					key: "reset",
					className: "pet-bub-quota-reset",
					children: r.resetText
				})
			]
		});
		if (r.role === "error") return h("div", {
			key: i,
			className: "pet-bub-err",
			children: r.text
		});
		if (r.role === "sub") return h("div", {
			key: i,
			className: "pet-bub-row pet-bub-sub",
			children: r.text
		});
		return h("div", {
			key: i,
			className: "pet-bub-row",
			children: r.text
		});
	});
}
/** 展开/收起时换内容的等待时长（ms）：与 .dsh-pet-jt-bubble 的 opacity 过渡同为 .25s，
*  淡出走完后才换内容，否则内容会在半透明时被替换 = 看得见的硬切 */
const BALANCE_FADE_MS = 250;
/**
* 制造余额气泡（工厂）。
* 工厂内注入样式一次（与 pet.ts 的 injectCss 同模式）；组件为哑组件，props = { state, on, expanded, onToggle }。
* 内容来自 src/shared 的 balanceBubbleView / balanceDetailView（与桌面模式完全一致）。
*
* 两种形态：
*  - 收起（默认，/balance 与自动轮询出来的就是它）：两行 —— 最紧迫窗口的「已用 N%」+ 重置倒计时；
*  - 展开（点气泡）：三个窗口各一行 —— 窗口名 + 进度条 + 已用百分比 + 重置倒计时。
* 切换是淡出 → 换内容 → 淡入，不是硬切。显隐与 10s 计时仍归上层（pet.ts）管，本组件只管内容。
*/
function makeBalanceBubble(rt) {
	const { h, useState, useEffect } = rt;
	injectBubbleCss();
	return function BalanceBubble({ state, on, expanded, onToggle }) {
		const [full, setFull] = useState(false);
		const [fading, setFading] = useState(false);
		useEffect(() => {
			if (expanded === full) return;
			setFading(true);
			const timer = window.setTimeout(() => {
				setFull(expanded);
				setFading(false);
			}, BALANCE_FADE_MS);
			return () => window.clearTimeout(timer);
		}, [expanded, full]);
		const rows = full ? balanceDetailView(state) : balanceBubbleView(state);
		const clickable = state.ok && state.shape === "windows";
		const wrap = state.ok ? "" : " dsh-pet-jt-whisper";
		return h("div", {
			className: "dsh-pet-jt-bubble" + wrap + (on ? " is-on" : "") + (clickable ? " is-clickable" : "") + (full ? " is-expanded" : "") + (fading ? " is-fading" : ""),
			onClick: clickable ? (e) => {
				e.stopPropagation();
				onToggle();
			} : void 0,
			children: rowsToNodes(h, rows)
		});
	};
}
/**
* 制造碎碎念气泡（工厂）。
* 与余额气泡共用同一套样式（dsh-pet-jt-bubble）与行渲染（rowsToNodes）；
* 内容来自 src/shared 的 whisperBubbleView（与桌面模式完全一致）。
* image：配图名称（配置 memes 的键），有值则在文字上方渲染该表情包；
*        图片样式取自 shared 的 MEME_BUBBLE_CSS（两端同一份，这里只声明式建节点）。
* url：配图的另一种形态（第三方自带的完整地址），**与 image 二选一**（host 判定层保证），
*        有值就直接当 img.src 用、不再拼表情包路径（issue #122 第 1 条）。
* assetRoot：**只在 image 形态下有意义**——素材根（= 该宠物的条目 key），决定图片去哪个表情包
*        目录链取（种类独占 pet/<名>-memes/ → 用户目录 → 包内），与动画素材同一套归属语义。
*/
function makeWhisperBubble(rt) {
	const { h } = rt;
	injectBubbleCss();
	injectMemeBubbleCss();
	return function WhisperBubble({ text, image, url, assetRoot, on }) {
		const rows = whisperBubbleView({
			ok: true,
			text,
			ts: 0
		});
		const key = String(image ?? "").trim();
		const href = String(url ?? "").trim();
		const src = href || (key ? memeImageUrl(key, "/dsh-pet-jt-7340", assetRoot) : "");
		return h("div", {
			className: "dsh-pet-jt-bubble dsh-pet-jt-whisper" + (src ? " " + MEME_BUBBLE_CLASS : "") + (on ? " is-on" : ""),
			children: src ? [h("img", {
				key: "img",
				className: MEME_IMG_CLASS,
				src,
				alt: key || href
			}), rowsToNodes(h, rows)] : rowsToNodes(h, rows)
		});
	};
}

//#endregion
//#region src/shared/constants.ts
/** thumb 画布高度 */
const CANVAS_H = 360;
/** thumb 画布上「脚底」的 y 坐标（人物站在 y=330 线上） */
const FEET_Y = 330;
/** 点击/拖拽命中矩形（thumb 640×360 像素坐标） */
const HIT_BOX = {
	x0: 200,
	y0: 50,
	x1: 440,
	y1: 335
};
/** 拖拽判定阈值（px） */
const DRAG_THRESHOLD = 5;
/** 弹弓窗口（ms）：**两次按下**之间的间隔小于它就按弹弓算（不是「松手」到「下次按下」）。
*  按下即记、按下即比，所以这次拖了多久、什么时候松手都不影响判定。
*  只认左键；没有模式、没有待拉状态（见 physics.ts 的弹弓换算）。 */
const SLINGSHOT_DOUBLE_MS = 200;
/** 移动距离缩放基准（px）：config.jsonc 的 moves.minDist/maxDist 是「基准宠物宽 462px」下的绝对像素，
*  运行时乘以 实际size/基准 等比缩放 —— 任何缩放下，行进距离与人物自身大小成比例（小宠物挪小步、大宠物挪大步） */
const PET_REF_WIDTH = 462;
/** 播放动画扩展名（集中开关，浏览器与桌面共用同一常量）：
*  - 默认 '.webm'（VP9-alpha，发布格式）：Chrome/Edge/Firefox 与桌面模式（Electron=Chromium）直接透明播放；
*  - macOS 的 Safari/WKWebView 不认 webm alpha（渲染黑底），需改为 '.mov'（HEVC-with-Alpha）——
*    素材从仓库 GitHub Release（固定 tag assets-mov）下载放入 main-animation/mov/，
*    并把本常量改为 '.mov' 后重新构建（自构建用户改这里；npm 包用户改产物 lib/client.js 中同名常量）。 */
const ANIMATION_EXT = ".webm";

//#endregion
//#region src/shared/score.ts
/** 达标速度阈值（px/s）：飞行中被点击时低于它不给分（低速点击维持普通点击动画） */
const SCORE_MIN_SPEED = 400;
/** 每 100 px/s 记 1 分（基准尺寸 462px 下） */
const SCORE_SPEED_PER_POINT = 100;
/**
* 点击积分：score = round(speed/100 × 462/size)，至少 1 分。
* 小宠物（目标小、飞行中更难命中）反而分高；speed ≤ 0 / size ≤ 0 返回 0
* （调用方按 0 不触发）。达标判定用 SCORE_MIN_SPEED 由调用方做。
*/
const clickScore = (speed, size) => {
	if (speed <= 0 || size <= 0) return 0;
	return Math.max(1, Math.round(speed / SCORE_SPEED_PER_POINT * (PET_REF_WIDTH / size)));
};

//#endregion
//#region src/shared/score-popup.ts
/** 弹窗展示时长（ms）：积分反馈比气泡（10s）短，够读即可 */
const SCORE_POPUP_DURATION_MS = 2200;
/** 弹窗样式 —— 两端注入同一份（与 MENU_CSS / CHAT_CSS 同理） */
const SCORE_POPUP_CSS = [
	".dsh-pet-jt-score{position:fixed;z-index:2147483002;min-width:120px;text-align:center;",
	"background:rgba(255,255,255,.97);border:1px solid rgba(255,179,0,.35);border-radius:12px;",
	"box-shadow:0 10px 32px rgba(0,0,0,.22);padding:8px 16px 9px;user-select:none;pointer-events:auto;",
	"font-family:var(--dsh-pet-jt-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);}",
	".dsh-pet-jt-score.is-in{animation:dshPetScorePop .28s ease}",
	".dsh-pet-jt-score-val{font-size:22px;line-height:1.25;font-weight:700;color:#ff8f00;font-variant-numeric:tabular-nums}",
	".dsh-pet-jt-score-sub{font-size:11px;line-height:1.4;color:rgba(43,43,43,.6);margin-top:2px;white-space:nowrap}",
	".dsh-pet-jt-score-burst{position:fixed;inset:0;pointer-events:none;z-index:2147483002}",
	".dsh-pet-jt-score-particle{position:absolute;border-radius:50%;pointer-events:none}",
	"@keyframes dshPetScorePop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}"
].join("");
/** 粒子只注入一次（同 CHAT_CSS 的 injectChatCss 模式） */
let scoreCssInjected = false;
function injectScoreCss() {
	if (scoreCssInjected || typeof document === "undefined") return;
	scoreCssInjected = true;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet-jt";
	tag.dataset.pluginCss = "dsh-pet-jt/score";
	tag.textContent = SCORE_POPUP_CSS;
	document.head.appendChild(tag);
}
/** 粒子数量 */
const BURST_COUNT = 20;
/** 初速范围（px/s） */
const BURST_SPEED_MIN = 120;
const BURST_SPEED_MAX = 460;
/** 重力（px/s²）：粒子向上喷出后回落 */
const BURST_GRAVITY = 700;
/** 单粒子寿命范围（ms） */
const BURST_LIFE_MIN = 500;
const BURST_LIFE_MAX = 900;
/** 粒子半径范围（px） */
const BURST_RADIUS_MIN = 3;
const BURST_RADIUS_MAX = 7;
/** 暖色盘（积分/庆祝感） */
const BURST_COLORS = [
	"#ffb300",
	"#ff8f00",
	"#ff7043",
	"#f4511e",
	"#ffc400",
	"#ffd54f",
	"#ef5350"
];
/**
* 在 (x, y) 爆开一圈暖色粒子（视口坐标，两端一致）：随机方向初速 + 重力回落 + 淡出。
* rAF 驱动、寿命结束整体清理；prefers-reduced-motion 时跳过（与 Q 弹同语义）。
*/
function spawnScoreBurst(x, y) {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	injectScoreCss();
	const root = document.createElement("div");
	root.className = "dsh-pet-jt-score-burst";
	document.body.appendChild(root);
	const parts = [];
	for (let i = 0; i < BURST_COUNT; i++) {
		const angle = Math.random() * Math.PI * 2;
		const speed = BURST_SPEED_MIN + Math.random() * (BURST_SPEED_MAX - BURST_SPEED_MIN);
		const r = BURST_RADIUS_MIN + Math.random() * (BURST_RADIUS_MAX - BURST_RADIUS_MIN);
		const el = document.createElement("div");
		el.className = "dsh-pet-jt-score-particle";
		el.style.left = x + "px";
		el.style.top = y + "px";
		el.style.width = r * 2 + "px";
		el.style.height = r * 2 + "px";
		el.style.background = BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
		root.appendChild(el);
		parts.push({
			el,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed - 80,
			t0: performance.now(),
			life: BURST_LIFE_MIN + Math.random() * (BURST_LIFE_MAX - BURST_LIFE_MIN)
		});
	}
	const step = () => {
		const now = performance.now();
		let alive = false;
		for (const p of parts) {
			const tSec = (now - p.t0) / 1e3;
			const lifeRatio = (now - p.t0) / p.life;
			if (lifeRatio >= 1) continue;
			alive = true;
			p.el.style.transform = "translate(" + p.vx * tSec + "px," + (p.vy * tSec + .5 * BURST_GRAVITY * tSec * tSec) + "px)";
			p.el.style.opacity = String(Math.max(0, 1 - lifeRatio));
		}
		if (alive) requestAnimationFrame(step);
		else root.remove();
	};
	requestAnimationFrame(step);
}
/**
* 挂载点击积分弹窗（两端共用；位置为视口坐标，超出视口自动夹回）。
* 内容：+N 分（主） + 速度/大小明细（副）；SCORE_POPUP_DURATION_MS 后自动消失，
* 点外 / Esc 立即关闭。分数已由调用方用 clickScore 算好传入（本文件 import 仅为共用常量来源）。
*/
function mountScorePopup(opts) {
	injectScoreCss();
	const x = opts.x;
	const y = opts.y;
	const root = document.createElement("div");
	root.className = "dsh-pet-jt-score";
	const val = document.createElement("div");
	val.className = "dsh-pet-jt-score-val";
	val.textContent = "+" + opts.score;
	const sub = document.createElement("div");
	sub.className = "dsh-pet-jt-score-sub";
	sub.textContent = "速度 " + Math.round(opts.speed) + " · 大小 " + Math.round(opts.size);
	root.appendChild(val);
	root.appendChild(sub);
	document.body.appendChild(root);
	const rr = root.getBoundingClientRect();
	root.style.left = Math.max(4, Math.min(x - rr.width / 2, window.innerWidth - rr.width - 4)) + "px";
	root.style.top = Math.max(4, y - rr.height - 14) + "px";
	root.offsetWidth;
	root.classList.add("is-in");
	let closed = false;
	let timer = null;
	const close = () => {
		if (closed) return;
		closed = true;
		if (timer !== null) window.clearTimeout(timer);
		timer = null;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (opts.onClose) opts.onClose();
	};
	const mountedAt = performance.now();
	let graceConsumed = false;
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (!graceConsumed) {
			graceConsumed = true;
			if (e.timeStamp - mountedAt < 300) return;
		}
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	timer = window.setTimeout(close, SCORE_POPUP_DURATION_MS);
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/shared/menu.ts
/**
* 「显示位置」子菜单 —— 桌面端与浏览器端注入**同一份**（文案与设置页「显示位置」下拉框一致）。
*
* 为什么必须放 shared：两端各写一份必然漂移（改了一端的文案或取值，另一端没跟上），而这一项在
* 两端语义完全对称——桌面端用它把宠物"送走"（仅网页），浏览器端用它把宠物"送到桌面"（仅桌面）。
*
* 只有「都不」是单向门（两端都不显示，恢复入口是设置页的下拉框）；其余三个值都能从某一端改回来
* （仅网页→浏览器里还在，仅桌面→桌面上还在，两者→两端都在）。设置页那条路在本菜单出现之前就是
* 唯一入口，本菜单只是多加了一条更近的路，没有削弱任何既有能力。
*/
const displayMenuBranch = () => ({
	label: "显示位置",
	children: [
		{
			label: "仅网页",
			action: "set-display",
			display: "web"
		},
		{
			label: "仅桌面",
			action: "set-display",
			display: "desktop"
		},
		{
			label: "两者",
			action: "set-display",
			display: "both"
		},
		{
			label: "都不",
			action: "set-display",
			display: "none"
		}
	]
});
/** 第三方菜单项统一收在这个一级菜单下（宿主自己的菜单项不进这里）。 */
const MORE_MENU_LABEL = "更多";
/**
* 从 `/state` 的 `sections.menu.data` 里读出第三方菜单项。
*
* 两侧（浏览器 / 桌面）共用同一份解析：快照来自网络，字段一律按"可能不存在"处理——
* 非法条目静默丢弃，绝不让一条坏数据把整个右键菜单搞崩（菜单是高频交互入口）。
*/
function readMenuItems(data) {
	if (!data || typeof data !== "object") return [];
	const items = data.items;
	if (!Array.isArray(items)) return [];
	const out = [];
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const owner = item.owner;
		const label = item.label;
		if (typeof owner === "string" && owner !== "" && typeof label === "string" && label !== "") out.push({
			owner,
			label
		});
	}
	return out;
}
/**
* 「更多」一级菜单：把第三方菜单项拼成菜单树的一枝；没有第三方项时返回 null（调用方不注入，
* 菜单里就不会出现一个空的「更多」）。
*
* 层级规则就一条：**按项数决定要不要 owner 这一层**——
*   - 该 owner 只有 1 项 → 直接 `更多 / 弹弓`（跳过分组，少一次点击）；
*   - 2 项及以上      → `更多 / 小游戏 / 弹弓`、`钓鱼`。
* 于是某个 owner 从 1 项变成 2 项时，它原来那一项会"缩进"进分组里——这是这条规则必然的副作用，
* 换来的是只有一个项的插件不必多开一层。
*
* 同名不同 owner 的项允许共存（用户看到两个「弹弓」，点了各回各的 owner）：菜单文案由注册方负责，
* 这里不做任何去重、编号或来源标注。
*/
function buildMoreBranch(items) {
	const groups = new Map();
	for (const item of items) {
		const list = groups.get(item.owner);
		if (list) list.push(item.label);
		else groups.set(item.owner, [item.label]);
	}
	const children = [];
	for (const [owner, labels] of groups) if (labels.length === 1) children.push({
		label: labels[0],
		action: "third-party",
		owner
	});
	else children.push({
		label: owner,
		children: labels.map((label) => ({
			label,
			action: "third-party",
			owner
		}))
	});
	return children.length > 0 ? {
		label: MORE_MENU_LABEL,
		children
	} : null;
}
/** 事件名 → 分类标签（无映射时用事件名本身） */
const EVENT_LABELS = {
	balance: "余额档位",
	whisper: "碎碎念",
	workStatus: "工作状态"
};
const leaf = (anim) => ({
	label: anim,
	anim
});
/**
* 由合并后的 animations 配置推导菜单树 —— 输出 [{ 动作 → [ 分类 → [ 具体动画 ] ] }]：
* 一级只有一个「动作」分支；二级 = 分类（待机/转向/拖拽/点击回应/移动 + config 随机动作
* 分类 + 事件档位）；三级 = 具体动画名。空池/空分类自动省略。
*/
function buildMenuTree(animations) {
	const groups = [];
	const pools = [
		["待机", animations.idle],
		["转向", animations.turn],
		["拖拽", animations.drag],
		["点击回应", animations.clicks],
		["移动", animations.moves.actions.map((m) => m.name)]
	];
	for (const [label, pool] of pools) if (pool.length) groups.push({
		label,
		children: pool.map(leaf)
	});
	const cats = (animations.categories ?? []).filter((c) => c.actions.length > 0);
	for (const c of cats) groups.push({
		label: c.id,
		children: c.actions.map(leaf)
	});
	const events = animations.events ?? {};
	for (const key of Object.keys(events)) {
		const pool = events[key] ?? [];
		const names = [];
		for (const slot of pool) if (typeof slot === "string") names.push(slot);
		else names.push(...slot);
		if (names.length) groups.push({
			label: EVENT_LABELS[key] ?? key,
			children: names.map(leaf)
		});
	}
	if (!groups.length) return [];
	return [{
		label: "动作",
		children: groups
	}];
}
/** 该动画是否属于 noMirror 分类（文字类）：朝右（镜像）时点播前强制朝左，避免文字镜像 */
function isNoMirrorAnimation(categories, anim) {
	return (categories ?? []).some((c) => c.noMirror === true && c.actions.includes(anim));
}
/** 菜单样式 —— 两端注入同一份（浏览器并入 plugin css；桌面入窗口 head）。
*  每一级面板是独立的绝对定位盒子（.dsh-pet-jt-menu-column），位置由 JS 内联写入；
*  面板与面板之间互不嵌套，各自独立滚动。 */
const MENU_CSS = [
	".dsh-pet-jt-menu{position:fixed;left:0;top:0;z-index:2147483000;color:#2b2b2b;font-size:13px;line-height:1.5;",
	"font-family:'Microsoft YaHei UI','Segoe UI','PingFang SC',sans-serif;user-select:none;pointer-events:auto}",
	".dsh-pet-jt-menu,.dsh-pet-jt-menu *{box-sizing:border-box}",
	".dsh-pet-jt-menu-column{position:absolute;min-width:150px;max-width:300px;padding:4px;",
	"background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:8px;",
	"box-shadow:0 8px 28px rgba(0,0,0,.2);max-height:min(62vh,460px);overflow-y:auto;",
	"scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.22) transparent}",
	".dsh-pet-jt-menu-column::-webkit-scrollbar{width:8px;height:8px}",
	".dsh-pet-jt-menu-column::-webkit-scrollbar-track{background:transparent}",
	".dsh-pet-jt-menu-column::-webkit-scrollbar-thumb{background:rgba(0,0,0,.16);border-radius:4px;",
	"border:2px solid transparent;background-clip:content-box}",
	".dsh-pet-jt-menu-column::-webkit-scrollbar-thumb:hover{background:rgba(43,99,255,.4);",
	"border:2px solid transparent;background-clip:content-box}",
	".dsh-pet-jt-menu-column::-webkit-scrollbar-corner{background:transparent}",
	".dsh-pet-jt-menu-item{position:relative;display:flex;align-items:center;justify-content:space-between;",
	"gap:14px;padding:5px 12px;border-radius:6px;white-space:nowrap;cursor:default}",
	".dsh-pet-jt-menu-item:hover{background:rgba(43,99,255,.14)}",
	".dsh-pet-jt-menu-item>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}",
	".dsh-pet-jt-menu-hint{color:#9aa0a6;font-size:12px;flex:none;white-space:nowrap}",
	".dsh-pet-jt-menu-arrow{color:#9aa0a6;font-size:12px;flex:none}"
].join("");
function isBranchNode(n) {
	return "children" in n && Array.isArray(n.children);
}
/**
* 挂载一个系统风格右键菜单（级联子菜单）到 document.body。
* 位置为视口坐标（桌面=窗口视口，浏览器=页面视口）——两端一致。
*
* 结构：根容器（fixed，零尺寸）下平级挂**每一级独立面板**，绝无嵌套；
* 面板按触发项屏幕位置贴边定位（右/下边缘自动翻转夹取）。
* 级联：悬停分支切换/展开子面板；指针整体离开菜单树（root mouseleave）才关闭整棵菜单；
* 点击项回调后自动关闭、点击菜单外或按 Esc 关闭；超高列表面板内独立滚动。
*
* clamp（可选，#41）：菜单允许占用的矩形（视口局部坐标，默认整个视口）。
* 桌面模式传「窗口 ∩ 工作区」：宠物贴屏幕底/右时窗口外扩余量伸出屏幕，菜单走进
* 伸出的部分会被 OS 裁掉——约束到该矩形内即可完整显示，**窗口/宠物零移动零闪帧**。
*/
function mountContextMenu(opts) {
	const { tree, x, y, onAction, onClose, clamp } = opts;
	const c = clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h) ? clamp : {
		x: 0,
		y: 0,
		w: window.innerWidth,
		h: window.innerHeight
	};
	const root = document.createElement("div");
	root.className = "dsh-pet-jt-menu";
	root.style.left = "0px";
	root.style.top = "0px";
	root.addEventListener("contextmenu", (e) => e.preventDefault());
	let closed = false;
	/** 每个面板当前展开的子面板（无 = 未展开）；hideChain 会沿链清除 */
	const openChild = new Map();
	/** 指针整体离开菜单树的兜底关闭定时器（root mouseover 重新进入即取消） */
	let leaveTimer = null;
	/** 关闭某面板及其后代面板整条链（display:none + 清 openChild 链） */
	const hideChain = (panel) => {
		panel.style.display = "none";
		const child = openChild.get(panel);
		if (child) {
			openChild.delete(panel);
			hideChain(child);
		}
	};
	/** 把面板显示在触发项旁边：右缘展开，贴右/下边缘自动翻转夹取（在 clamp 矩形内） */
	const showPanel = (panel, item) => {
		const rect = item.getBoundingClientRect();
		panel.style.left = "";
		panel.style.top = "";
		panel.style.display = "block";
		let left = rect.right + 4;
		if (left + panel.offsetWidth > c.x + c.w - 4) left = rect.left - panel.offsetWidth - 4;
		left = Math.max(c.x + 4, left);
		let top = rect.top;
		if (top + panel.offsetHeight > c.y + c.h - 4) top = Math.max(c.y + 4, c.y + c.h - 4 - panel.offsetHeight);
		panel.style.left = left + "px";
		panel.style.top = top + "px";
	};
	/** 构建一层面板（nodes 列表）；分支项的子面板**平级**挂到 root 下，不嵌套。
	*  面板自身先入 DOM、子面板随后入 → 层级越深绘制越靠上（子菜单盖在父菜单上层）。 */
	const buildPanel = (nodes) => {
		const panel = document.createElement("div");
		panel.className = "dsh-pet-jt-menu-column";
		panel.style.display = "none";
		if (clamp) panel.style.maxHeight = Math.min(460, Math.max(120, c.h - 16)) + "px";
		root.appendChild(panel);
		for (const node of nodes) {
			const item = document.createElement("div");
			item.className = "dsh-pet-jt-menu-item";
			if (isBranchNode(node)) {
				item.classList.add("dsh-pet-jt-menu-branch");
				const label = document.createElement("span");
				label.textContent = node.label;
				const arrow = document.createElement("span");
				arrow.className = "dsh-pet-jt-menu-arrow";
				arrow.textContent = "▸";
				item.appendChild(label);
				item.appendChild(arrow);
				const childPanel = buildPanel(node.children);
				item.addEventListener("mouseenter", () => {
					const prev = openChild.get(panel);
					if (prev && prev !== childPanel) hideChain(prev);
					openChild.set(panel, childPanel);
					showPanel(childPanel, item);
				});
			} else {
				const label = document.createElement("span");
				label.textContent = node.label;
				item.appendChild(label);
				if (node.hint) {
					const hint = document.createElement("span");
					hint.className = "dsh-pet-jt-menu-hint";
					hint.textContent = node.hint;
					item.appendChild(hint);
				}
				item.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					close();
					onAction(node);
				});
			}
			panel.appendChild(item);
		}
		return panel;
	};
	const rootPanel = buildPanel(tree);
	rootPanel.style.display = "block";
	document.body.appendChild(root);
	rootPanel.style.left = "";
	rootPanel.style.top = "";
	const rw = rootPanel.offsetWidth;
	const rh = rootPanel.offsetHeight;
	rootPanel.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - rw - 4)) + "px";
	rootPanel.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - rh - 4)) + "px";
	root.addEventListener("mouseleave", () => {
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = window.setTimeout(() => {
			leaveTimer = null;
			close();
		}, 200);
	});
	root.addEventListener("mouseover", () => {
		if (leaveTimer !== null) {
			window.clearTimeout(leaveTimer);
			leaveTimer = null;
		}
	});
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	const close = () => {
		if (closed) return;
		closed = true;
		if (leaveTimer !== null) window.clearTimeout(leaveTimer);
		leaveTimer = null;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (onClose) onClose();
	};
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/shared/tooltip.ts
/** 提示框 class（两端共用） */
const TOOLTIP_CLASS = "pet-tooltip";
/** 光标与提示框之间的间隙（占宠物宽度比例）：462px 的宠物下约 10px，与原生提示的偏移观感接近 */
const TOOLTIP_GAP_RATIO = .022;
/**
* 光标位置 + 提示框实测尺寸 + 允许显示范围 → 提示框左上角坐标。
*
* 摆法与原生提示一致：优先放光标**右下**；右边装不下翻到光标左侧，下边装不下翻到光标上方；
* 翻完仍越界就夹回范围内（提示框比允许范围还宽时，至少保证左上角不越界）。两端共用同一份，
* 避免出现「网页翻左、桌面翻右」这种不一致。
*
* 为什么尺寸要调用方实测（offsetWidth/offsetHeight）而不是按宠物宽度估算：翻边判据依赖真实宽高，
* 估算偏大会贴着边就翻、偏小会越界被裁；提示框常驻 DOM（opacity:0 也有布局），实测不额外花代价。
*
* @param cursor 光标位置
* @param tip 提示框实测尺寸（px）——调用方传 offsetWidth/offsetHeight
* @param bounds 允许显示的范围：桌面端是「窗口 ∩ 光标所在屏的工作区」，浏览器端是整个视口
* @param gap 光标与提示框的间隙（px）
*/
function tooltipPlacement(cursor, tip, bounds, gap) {
	const clamp = (v, lo, hi) => hi < lo ? lo : Math.min(Math.max(v, lo), hi);
	const rightMax = bounds.x + bounds.w;
	const bottomMax = bounds.y + bounds.h;
	let x = cursor.x + gap;
	if (x + tip.w > rightMax) x = cursor.x - gap - tip.w;
	x = clamp(x, bounds.x, rightMax - tip.w);
	let y = cursor.y + gap;
	if (y + tip.h > bottomMax) y = cursor.y - gap - tip.h;
	y = clamp(y, bounds.y, bottomMax - tip.h);
	return {
		x,
		y
	};
}
/** 提示框样式 —— 两端注入同一份（客户端进 pet.ts 的 css 数组，桌面由 renderer.js 建 style 标签） */
const TOOLTIP_CSS = [
	".pet-tooltip{",
	"position:fixed;left:0;top:0;",
	"max-width:calc(var(--dsh-pet-jt-size,var(--pet-size,462px))*0.8);",
	"padding:calc(var(--dsh-pet-jt-size,var(--pet-size,462px))*0.010) calc(var(--dsh-pet-jt-size,var(--pet-size,462px))*0.021);",
	"border-radius:calc(var(--dsh-pet-jt-size,var(--pet-size,462px))*0.016);",
	"background:rgba(255,255,255,.96);color:#1f1f1f;",
	"border:1px solid rgba(0,0,0,.12);",
	"font-family:var(--dsh-pet-jt-font-family,\"ShangshouSoftCandy\",\"Yuanti SC\",\"YouYuan\",\"幼圆\",\"Comic Sans MS\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif);",
	"font-size:var(--dsh-pet-jt-font-tip,calc(var(--dsh-pet-jt-size,var(--pet-size,462px))*0.026));line-height:1.4;",
	"white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
	"box-shadow:0 calc(var(--dsh-pet-jt-size,var(--pet-size,462px))*0.004) calc(var(--dsh-pet-jt-size,var(--pet-size,462px))*0.013) rgba(0,0,0,.18);",
	"opacity:0;transition:opacity .12s ease;pointer-events:none;z-index:2}",
	".pet-tooltip.is-on{opacity:1}"
].join("");

//#endregion
//#region src/shared/chat.ts
const SEND_TIMEOUT_MS = 6e4;
/** 发送一句对话（携带记忆去 host 生成回复并写入记忆）。
*  网络/解析失败显式抛错（调用方决定报错方式，绝不静默伪造）。 */
async function sendChat(baseUrl, text) {
	const res = await fetch(baseUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text }),
		signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
	});
	const raw = await res.json().catch(() => null);
	if (!raw || typeof raw !== "object") throw new Error("dsh-pet-jt: 对话响应非法");
	const o = raw;
	if (o.ok !== true) return {
		ok: false,
		reason: o.reason === "provider-missing" || o.reason === "generate-error" || o.reason === "config-error" ? o.reason : "bad-request",
		message: typeof o.message === "string" ? o.message : void 0
	};
	return { ok: true };
}
/** 弹窗样式 —— 两端注入同一份（与菜单 MENU_CSS 同理；视觉对齐浏览器/桌面）。
*  最简形态：一条自适应输入框（无标题/无按钮）——初始小宽度（160px），
*  随输入自动增宽（封顶 340px），到上限后自动折行增高；回车发送，Esc 或点外关闭。
*  宽度由 JS 按文本测量覆盖根元素宽度。 */
const CHAT_CSS = [
	".dsh-pet-jt-chat{position:fixed;z-index:2147483001;width:160px;max-width:80vw;",
	"background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:10px;",
	"box-shadow:0 10px 32px rgba(0,0,0,.22);color:#2b2b2b;font-size:14px;line-height:1.5;",
	"font-family:var(--dsh-pet-jt-font-family,'ShangshouSoftCandy','Yuanti SC','YouYuan','幼圆','Comic Sans MS','PingFang SC','Microsoft YaHei',sans-serif);",
	"user-select:none}",
	".dsh-pet-jt-chat *{box-sizing:border-box}",
	".dsh-pet-jt-chat-input{display:block;width:100%;border:none;outline:none;background:transparent;",
	"padding:8px 11px 9px;font-size:14px;line-height:1.45;color:#2b2b2b;font-family:inherit;",
	"resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}",
	".dsh-pet-jt-chat-input::placeholder{color:rgba(43,43,43,.45)}",
	".dsh-pet-jt-chat-input:disabled{opacity:.55}",
	".dsh-pet-jt-chat-err{color:#d94f3d;font-size:12px;padding:0 12px 8px;white-space:pre-wrap;overflow-wrap:anywhere}"
].join("");
/** 输入框宽度自适应参数：初始小宽 → 随文本增宽 → 封顶后折行增高 */
const CHAT_MIN_W = 160;
const CHAT_MAX_W = 340;
const CHAT_H_PAD = 22;
let chatCssInjected = false;
function injectChatCss() {
	if (chatCssInjected || typeof document === "undefined") return;
	chatCssInjected = true;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet-jt";
	tag.dataset.pluginCss = "dsh-pet-jt/chat";
	tag.textContent = CHAT_CSS;
	document.head.appendChild(tag);
}
/** 挂载一个对话输入弹窗（两端共用；位置为视口坐标，超出 clamp 矩形自动夹回）。
*  最简形态：只有一条输入框（无标题/无按钮），回车即发送 → 弹窗关闭 →
*  onSent() 交给调用方叫醒一拍 /state（回复写进了 pets.<id>.say，气泡随下一拍出现）；
*  Esc / 点弹窗外关闭；生成失败则留在弹窗内显式提示，不伪造回复。
*
*  clamp（可选，#41）：弹窗允许占用的矩形（视口局部坐标，默认整个视口）。
*  桌面模式传「窗口 ∩ 工作区」——宠物贴屏幕底/右时窗口外扩余量伸出屏幕，
*  约束到该矩形内即可完整显示，**窗口/宠物零移动零闪帧**。 */
function mountChatDialog(opts) {
	injectChatCss();
	const { petId, surface, x, y, onSent, onClose, clamp } = opts;
	const baseUrl = opts.baseUrl ?? "/dsh-pet-jt-7340/chat";
	const withPet = baseUrl + "?pet=" + encodeURIComponent(petId) + "&surface=" + surface;
	const c = clamp && Number.isFinite(clamp.x + clamp.y + clamp.w + clamp.h) ? clamp : {
		x: 0,
		y: 0,
		w: window.innerWidth,
		h: window.innerHeight
	};
	const root = document.createElement("div");
	root.className = "dsh-pet-jt-chat";
	const input = document.createElement("textarea");
	input.className = "dsh-pet-jt-chat-input";
	input.placeholder = "说点什么…";
	input.maxLength = 2e3;
	input.rows = 1;
	let measureCtx = null;
	const measureText = (text) => {
		const ctx = measureCtx ?? (measureCtx = document.createElement("canvas").getContext("2d"));
		ctx.font = getComputedStyle(input).font;
		return ctx.measureText(text).width;
	};
	const resizeInput = () => {
		const textW = measureText(input.value || " ");
		const w = Math.max(CHAT_MIN_W, Math.min(Math.ceil(textW + CHAT_H_PAD), CHAT_MAX_W));
		root.style.width = w + "px";
		input.style.height = "auto";
		input.style.height = Math.max(input.scrollHeight, 22) + "px";
	};
	input.addEventListener("input", resizeInput);
	resizeInput();
	const err = document.createElement("div");
	err.className = "dsh-pet-jt-chat-err";
	err.style.display = "none";
	root.appendChild(input);
	root.appendChild(err);
	document.body.appendChild(root);
	resizeInput();
	const rr = root.getBoundingClientRect();
	root.style.left = Math.max(c.x + 4, Math.min(x, c.x + c.w - rr.width - 4)) + "px";
	root.style.top = Math.max(c.y + 4, Math.min(y, c.y + c.h - rr.height - 4)) + "px";
	let closed = false;
	let sending = false;
	const close = () => {
		if (closed) return;
		closed = true;
		document.removeEventListener("mousedown", onDocPointerDown, true);
		document.removeEventListener("keydown", onDocKeyDown, true);
		root.remove();
		if (onClose) onClose();
	};
	const onDocPointerDown = (e) => {
		if (closed) return;
		if (root.contains(e.target)) return;
		close();
	};
	const onDocKeyDown = (e) => {
		if (closed) return;
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocPointerDown, true);
	document.addEventListener("keydown", onDocKeyDown, true);
	const doSend = () => {
		if (closed || sending) return;
		const text = input.value.trim();
		if (!text) return;
		sending = true;
		input.disabled = true;
		sendChat(withPet, text).then((state) => {
			if (state.ok) {
				close();
				if (onSent) onSent();
			} else {
				err.textContent = "对话失败：" + (state.message ?? state.reason);
				err.style.display = "block";
			}
		}).catch((e) => {
			err.textContent = "对话异常：" + String(e && e.message ? e.message : e);
			err.style.display = "block";
		}).finally(() => {
			sending = false;
			input.disabled = false;
			if (!closed) input.focus();
		});
	};
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			doSend();
		}
	});
	input.focus();
	return {
		el: root,
		close
	};
}

//#endregion
//#region src/client/pose.ts
/** petId → 取当前实况的函数（PetCard 挂载时注册、卸载时摘除） */
const readers$1 = new Map();
/**
* 注册一只宠物**在这一页**的实况读法。
*
* @returns 摘除函数（PetCard 卸载时调；重复调用无害）
*/
function registerPose(petId, read) {
	readers$1.set(petId, read);
	return () => {
		if (readers$1.get(petId) === read) readers$1.delete(petId);
	};
}
/**
* 读某只宠物**在这一页**的实况。
*
* `null` = 这一页没有它：不存在该 id / 尚未挂载 / `display` 不含 `web`。这与桌面端
* `GET /pose` 的"明确不可用"是同一个语义（那边是 `ok:false` + `reason`）。
*
* **按需读**：每次调用都取当前值（不是快照），所以走位、抛掷、拖拽**中途**也能读到。
*/
function readPose(petId) {
	if (typeof petId !== "string" || petId === "") return null;
	const read = readers$1.get(petId);
	return read === void 0 ? null : read();
}

//#endregion
//#region src/client/progress.ts
/** petId → 取当前进度的函数（PetCard 挂载时注册、卸载时摘除） */
const readers = new Map();
/**
* 注册一只宠物**在这一页**的进度读法。
*
* @returns 摘除函数（PetCard 卸载时调；重复调用无害）
*/
function registerProgress(petId, read) {
	readers.set(petId, read);
	return () => {
		if (readers.get(petId) === read) readers.delete(petId);
	};
}
/**
* 读某只宠物**在这一页**的播放进度。
*
* `null` = 这一页没有它：不存在该 id / 尚未挂载 / `display` 不含 `web`。
*
* **按需读**：每次调用都取当前值（不是快照），所以播放**中途**读到的就是那一刻的位置。
*/
function readProgress(petId) {
	if (typeof petId !== "string" || petId === "") return null;
	const read = readers.get(petId);
	return read === void 0 ? null : read();
}

//#endregion
//#region src/shared/fonts.ts
/** 字体预设清单：顺序 = 设置页下拉框的显示顺序（第一项是默认）。
*  candy 是唯一随包发布的字体（assets/fonts/上首软糖体.ttf），两端各自注入 @font-face 后即可用；
*  它的 CSS 名 "ShangshouSoftCandy" 是**我们自己起的**（与字体文件内部名称无关），改名要同步
*  浏览器端 bubble.ts 与桌面端 renderer.js 的 @font-face 声明。
*  其余都是系统字体：机器上没装时由后面的兜底自然回退，不报错也不空白。 */
const FONT_PRESETS = [
	{
		id: "candy",
		stack: "\"ShangshouSoftCandy\",\"Yuanti SC\",\"YouYuan\",\"幼圆\",\"Comic Sans MS\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif"
	},
	{
		id: "yahei",
		stack: "\"Microsoft YaHei\",\"PingFang SC\",sans-serif"
	},
	{
		id: "youyuan",
		stack: "\"YouYuan\",\"Yuanti SC\",sans-serif"
	},
	{
		id: "kaiti",
		stack: "\"KaiTi\",\"STKaiti\",serif"
	},
	{
		id: "simsun",
		stack: "\"SimSun\",\"Songti SC\",serif"
	},
	{
		id: "comic",
		stack: "\"Comic Sans MS\",\"Comic Sans\",cursive"
	},
	{
		id: "system",
		stack: "system-ui,sans-serif"
	}
];
/** 字号合法区间（px，含端点）：与 host 侧 fontValid 的边界同一份口径
*  （设置页据此即时提示，host 据此事后拦截手改的配置文件） */
const FONT_SIZE_MIN = 4;
const FONT_SIZE_MAX = 200;
/** font 段默认值：与内置 assets/config.jsonc 的 font 段一致。
*  刻意等于「接入本配置之前的行为」——462 宽宠物气泡 21px、且随宠物大小缩放，
*  所以不含 font 字段的旧配置，渲染结果与改造前一致。 */
const DEFAULT_FONT = {
	family: "candy",
	size: 21,
	followPet: true
};
/** 按 id 取字体栈（id 非法/缺失 → 回退清单首项 = 软糖体）：渲染层零兜底逻辑，一律经此取 */
function fontStackOf(id) {
	return (FONT_PRESETS.find((p) => p.id === id) ?? FONT_PRESETS[0]).stack;
}
/** 基准宠物宽度（px）：字号换算的锚点——与内置 config.jsonc 的默认宠物 size 一致，
*  也是既有 CSS 系数（气泡 0.0455、提示 0.026）当初的设计基准。 */
const FONT_REF_SIZE = 462;
/** 基准宽度下的气泡正文字号（px）＝ 0.0455 × 462 ≈ 21.02（= 接入 font 配置前 462 宽宠物的气泡字号） */
const BUBBLE_FONT_BASE_PX = .0455 * FONT_REF_SIZE;
/** 基准宽度下的悬浮提示字号（px）＝ 0.026 × 462 ≈ 12.01（同上，改造前的取值） */
const TIP_FONT_BASE_PX = .026 * FONT_REF_SIZE;
/** 气泡与悬浮提示的**最终字号**（px）——两端共用同一份换算，避免浏览器与桌面各算一套后漂移。
*
*  口径（以 462 宽为锚；CSS 只读算好的像素值，不在 CSS 里做除法）：
*    字号 = 基准px × (font.size ÷ 默认字号) × (followPet ? 宠物宽度 ÷ 462 : 1)
*  - 默认值（size=21 / followPet=true）在 462 宽宠物上得到 21.02px 与 12.01px —— 与接入本配置前一致；
*  - followPet=false 退化为「固定在 462 宽时的字号」，与宠物大小解耦；
*  - 配置被手改坏（字号非正 / 宽度非法）时按默认口径处理，绝不产出 NaN 或 0 字号。
*
*  @param font 该宠物的 font 配置（拍平时已吹入；缺失按 DEFAULT_FONT）
*  @param size 该宠物的宽度 px */
function resolveFontPx(font, size) {
	const own = Number(font?.size);
	const ratio = Number.isFinite(own) && own > 0 ? own / DEFAULT_FONT.size : 1;
	const w = Number(size);
	const follow = font?.followPet !== false;
	const scale = follow && Number.isFinite(w) && w > 0 ? w / FONT_REF_SIZE : 1;
	return {
		bubble: BUBBLE_FONT_BASE_PX * ratio * scale,
		tip: TIP_FONT_BASE_PX * ratio * scale
	};
}

//#endregion
//#region src/shared/physics.ts
/** 拖拽弹簧刚度：越大跟手越紧 */
const SPRING_K = 200;
/** 拖拽弹簧阻尼：ζ = c/(2√k) ≈ 1.06，过阻尼，不 overshoot */
const SPRING_C = 30;
/** 拖拽轨迹保留窗口（ms）：只留最近这一段做初速估算 */
const TRAIL_KEEP_MS = 200;
/** 初速估算窗口（ms） */
const RELEASE_WINDOW_MS = 150;
/** 松手前停顿超过它 = 温柔放下（不带残余速度），即使之前甩过 */
const RELEASE_STALE_MS = 150;
/** 窗口太短视为不可估算（ms） */
const MIN_SPAN_MS = 20;
/** 分段速度的最小 dt（ms）：高回报率鼠标事件可低至 1ms，过小 dt 会把抖动放大成虚假峰值，短段向前合并 */
const SEG_MIN_DT_MS = 8;
/** 低于此速度 = 不抛（原地放下），px/s */
const DEAD_ZONE_SPEED = 500;
/** 甩出速度软上限（px/s）：cap*(1-e^(-s/cap))，任意力度下仍单调可区分，渐近不超过 cap */
const MAX_THROW_SPEED = 3600;
/** 初速大小 = 端点均值*(1-w) + 窗口峰值*w（弥补快甩时位移集中在窗口内一小段的低估） */
const PEAK_WEIGHT = .5;
/** 参考加速度（px/s²）：末段加速达到它即吃满增益 */
const ACCEL_REF = 8e3;
/** 加速度增益上限：仍在加速的甩动最多放大 60% */
const ACCEL_GAIN_MAX = .6;
/** 抛掷重力（px/s²） */
const GRAVITY = 1400;
/** 碰边恢复系数：每次反弹保留约 78% 速度 */
const RESTITUTION = .78;
/** 地面水平摩擦（/s） */
const GROUND_FRICTION = 2.5;
/** 抛掷物理的默认参数（与内置配置一致；仅作配置缺失时的兜底） */
const DEFAULT_PHYSICS = {
	gravity: GRAVITY,
	restitution: RESTITUTION,
	groundFriction: GROUND_FRICTION,
	ceilingBounce: true,
	throwPower: 1,
	petCollision: false
};
/** 总力度默认量（throwPower=1 即现状） */
const DEFAULT_THROW_POWER = 1;
/** 落地时 |vy| 小于它直接停竖直 */
const REST_VY = 40;
/** 地面上 |vx| 小于它认为已静止 */
const REST_VX = 15;
/** 单步最大 dt（s）：防后台标签页/卡顿后恢复的巨帧跳变 */
const MAX_STEP_DT = .05;
/** 下压幅度：高度压到 55%（3 倍力度：原压深 15% → 现压深 45%，可继续调） */
const SQ_SQUASH = .55;
/** 挤压时长（ms） */
const SQ_DURATION_MS = 220;
/** 落地冲击速度基准：低于此 = 轻落（按下限幅度） */
const SQ_SOFT_SPEED = 300;
/** 落地冲击速度上限：达到/超过此 = 重砸（吃满最大下压） */
const SQ_HARD_SPEED = 1500;
/** 落地最大下压幅度（与点击一致）；轻落下限 0.8——重力 1400px/s²、恢复 0.78 下典型落地速度
*  400~1500px/s，映射太保守会让常规甩抛的落地 Q 弹回到"不明显"，故底部留底限 */
const SQ_MAX_SQUASH = .55;
/**
* 落地冲击速度 → 下压幅度 scaleY 值（速度越大压得越狠）。
* 返回作为 startSquash 的 squash 参数，曲线仍走 squashScale（u 进度不变）。
*/
const landingSquash = (impactSpeed) => {
	const t = Math.min(Math.max((Math.abs(impactSpeed) - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED), 0), 1);
	return Math.min(.8, 1 - t * (1 - SQ_MAX_SQUASH));
};
/**
* Q 弹挤压曲线：u∈[0,1] 进度 → scaleY 值。
* 下压段（0~0.45）ease-in 压缩；回弹段（0.45~1）easeOutBack 带回弹过冲（~4%）。
* 两端共用同一曲线，手感严格一致。
*/
const squashScale = (u, squash = SQ_SQUASH) => {
	if (u < .45) {
		const p$1 = u / .45;
		return 1 - (1 - squash) * p$1 * p$1;
	}
	const p = (u - .45) / .55;
	const c1 = 1.70158;
	const c3 = c1 + 1;
	const f = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
	return Math.min(1.12, squash + (1 - squash) * Math.max(f, 0));
};
/** 由 W/H/size 计算抛掷碰撞边界：身体（盒内缩 sideAllow）贴屏幕边缘才反弹 */
const throwBounds = (o) => {
	const h = o.size * 9 / 16;
	return {
		minX: -o.sideAllow,
		minY: 0,
		maxX: o.W - o.size + o.sideAllow,
		maxY: o.H - h
	};
};
/** 剔除超过保留窗口的旧采样（顺带排序去重，调用前采样按时间追加即可） */
const trimTrail = (trail, now) => {
	const cutoff = now - TRAIL_KEEP_MS;
	let i = 0;
	while (i < trail.length && trail[i].t < cutoff) i++;
	return i === 0 ? trail : trail.slice(i);
};
/** 过阻尼弹簧单轴速度步进：调用方随后 x += v*dt。
*  power = 总力度（K/C 同乘：系统形态不变，收敛速度快 p 倍 = 跟手更贴/更松）。 */
const springStep = (v, x, target, dt, power = DEFAULT_THROW_POWER) => v + ((target - x) * SPRING_K - v * SPRING_C) * power * dt;
/** 软钳速：`cap*(1-e^(-s/cap))`，任意速度下单调可区分、渐近不超过 cap。
*  导出供抛掷指令（`POST /throw` 的 power）复用——接口抛掷与拖拽甩抛走同一条限速，手感一致。 */
const softClampSpeed = (speed) => {
	if (speed <= 0) return 0;
	return MAX_THROW_SPEED * (1 - Math.exp(-speed / MAX_THROW_SPEED));
};
/** 抛掷指令的力度锚点：`power = 1.0` 对应软钳速**前**的 1200 px/s
*  （实际初速会被软上限压到约 1021 px/s，见 softClampSpeed）。 */
const THROW_SPEED_ANCHOR = 1200;
/**
* 抛掷指令（`POST /dsh-pet-jt-7340/throw` 的 `angle` + `power`）→ 初速度 (vx, vy)，px/s。
*
* `angle` 单位度，`0` = 正右，**逆时针为正**——屏幕坐标 y 向下，所以 `vy` 取负号
* （"往上抛"写 90，而不是 270）。任意实数角度都成立（sin/cos 天然按 360 周期）。
* 初速 = `power × THROW_SPEED_ANCHOR`，再过**既有软上限**：与拖拽甩抛同一条限速，
* 所以任意 `power` 都单调可区分且恒不超过 `MAX_THROW_SPEED`。
*
* 两端（浏览器 overlay / 桌面 sprite）共用本函数，保证接口抛掷的初速换算严格一致。
*/
const throwVelocity = (angleDeg, power) => {
	const speed = softClampSpeed(power * THROW_SPEED_ANCHOR);
	const rad = angleDeg * Math.PI / 180;
	return {
		vx: Math.cos(rad) * speed,
		vy: -Math.sin(rad) * speed
	};
};
/**
* 弹弓的力度来源与拖拽甩抛是**两条独立的路**，物理侧完全共用：
* 这里只把「拉距」换成初速度，之后照样交给 startThrow → throwStep / throwStepRegion
*（重力 / 边缘反弹 / 地面摩擦 / 落地 Q 弹 / 宠物互撞 / 多屏空洞都不变）。
*
* 两条约定：
*   - 方向 = 拉的**反方向**（往左下拉 → 往右上弹），见 pullAngle；
*   - 力度**不设上限**：既不过 softClampSpeed，也不夹 power。软钳速是为手速抖动设的，
*     拉得远和拉得更远必须能区分开——那正是「按距离给力度」的意义。
* 刻度与 throwVelocity 同源：power = 1 对应 THROW_SPEED_ANCHOR，并乘同一个
* physics.throwPower（设置页「总力度」，与拖拽甩抛共用一份配置）。
*/
const SLINGSHOT_REF_RATIO = .6;
/** 「一倍力度」的拉距（px）：随宠物尺寸缩放——小宠物不必拖同样远才炸 */
const slingshotRefDist = (size) => size > 0 ? size * SLINGSHOT_REF_RATIO : 0;
/** 拉距 → 力度倍率（px / 参考拉距）：线性、单调、**不夹取**；0 拉距 = 0 力度 */
const slingshotPower = (dist, size) => {
	const ref = slingshotRefDist(size);
	if (!(ref > 0) || !(dist > 0) || !Number.isFinite(dist)) return 0;
	return dist / ref;
};
/**
* 拉向量（起点 → 松手点，屏幕坐标，y 向下）→ 弹射角度（度，0 = 正右、逆时针为正）。
* 弹的是拉的**反方向**：往左拉 → 正右飞出；往上拉 → 向下落。角度约定与 throwVelocity 同一套。
*/
const pullAngle = (pullX, pullY) => Math.atan2(pullY, -pullX) * 180 / Math.PI;
/** 弹弓初速：角度约定、力度锚点与 throwVelocity 相同，但**没有软上限**（任意 power 都单调可区分） */
const slingshotVelocity = (angleDeg, power, throwPower = DEFAULT_THROW_POWER) => {
	const speed = THROW_SPEED_ANCHOR * Math.max(0, power) * Math.max(0, throwPower);
	if (speed === 0) return {
		vx: 0,
		vy: 0
	};
	const rad = angleDeg * Math.PI / 180;
	return {
		vx: Math.cos(rad) * speed,
		vy: -Math.sin(rad) * speed
	};
};
/**
* 由拖拽轨迹估算松手初速 (vx, vy)，px/s。
* 方向：窗口首末端点位移方向（抗抖）。大小：端点平均与峰值按 PEAK_WEIGHT 加权，
* 末段仍在加速时按 ACCEL_REF 比例增益（最多 ACCEL_GAIN_MAX），软钳速封顶。
* 总力度：软钳速**之后**整体 ×physics.throwPower —— 初速、软上限（3600×p）、
* 死区判定（相对力度）三者一体线性缩放（p=1 即现状）。
* 返回 null = 温柔放下（轨迹为空 / 停留过久 / 窗口太短 / 峰值速度低于死区），调用方不抛。
*/
const estimateReleaseVelocity = (trail, now, physics = DEFAULT_PHYSICS) => {
	if (trail.length === 0) return null;
	const last = trail[trail.length - 1];
	if (now - last.t > RELEASE_STALE_MS) return null;
	const win = trail.filter((s) => now - s.t <= RELEASE_WINDOW_MS);
	if (win.length < 2) return null;
	const t0 = win[0].t;
	const x0 = win[0].x;
	const y0 = win[0].y;
	const t1 = win[win.length - 1].t;
	const x1 = win[win.length - 1].x;
	const y1 = win[win.length - 1].y;
	const spanMs = t1 - t0;
	if (spanMs < MIN_SPAN_MS) return null;
	const baseVx = (x1 - x0) / spanMs * 1e3;
	const baseVy = (y1 - y0) / spanMs * 1e3;
	const baseSpeed = Math.hypot(baseVx, baseVy);
	if (baseSpeed < 1e-6) return null;
	const segSpeeds = [];
	let px = x0;
	let py = y0;
	let pt = t0;
	for (const s of win.slice(1)) {
		const dt = s.t - pt;
		if (dt >= SEG_MIN_DT_MS) {
			segSpeeds.push({
				speed: Math.hypot(s.x - px, s.y - py) / dt * 1e3,
				tEnd: s.t
			});
			px = s.x;
			py = s.y;
			pt = s.t;
		}
	}
	const peakSpeed = segSpeeds.length ? Math.max(...segSpeeds.map((v) => v.speed)) : baseSpeed;
	let accel = 0;
	if (segSpeeds.length >= 2) {
		const lastSeg = segSpeeds[segSpeeds.length - 1];
		const firstSeg = segSpeeds[0];
		accel = (lastSeg.speed - firstSeg.speed) / Math.max((lastSeg.tEnd - firstSeg.tEnd) / 1e3, MIN_SPAN_MS / 1e3);
	}
	const speedBeforeClamp = ((1 - PEAK_WEIGHT) * baseSpeed + PEAK_WEIGHT * peakSpeed) * (1 + Math.min(Math.max(accel, 0) / ACCEL_REF, 1) * ACCEL_GAIN_MAX);
	const speed = softClampSpeed(speedBeforeClamp) * physics.throwPower;
	if (speed < DEAD_ZONE_SPEED) return null;
	return {
		vx: baseVx / baseSpeed * speed,
		vy: baseVy / baseSpeed * speed
	};
};
/**
* 抛体单步积分 + 边界反弹。返回更新后的状态与两个标志：
* bounced = 本步是否碰边/落地；atRest = 贴地且低速（或碰边后整体低速），调用方应停止循环。
* physics = 配置成品的抛掷物理参数（重力/弹性/地面摩擦/顶部反弹）；缺失时用默认值兜底。
*/
const throwStep = (s, dtRaw, b, physics = DEFAULT_PHYSICS) => {
	const dt = Math.min(Math.max(dtRaw, 0), MAX_STEP_DT);
	let { x, y, vx, vy } = s;
	vy += physics.gravity * dt;
	x += vx * dt;
	y += vy * dt;
	let bounced = false;
	if (x < b.minX) {
		x = b.minX;
		vx = Math.abs(vx) * physics.restitution;
		bounced = true;
	} else if (x > b.maxX) {
		x = b.maxX;
		vx = -Math.abs(vx) * physics.restitution;
		bounced = true;
	}
	if (y < b.minY) {
		if (physics.ceilingBounce) {
			y = b.minY;
			vy = Math.abs(vy) * physics.restitution;
			bounced = true;
		}
	} else if (y >= b.maxY) {
		y = b.maxY;
		vx *= Math.max(0, 1 - physics.groundFriction * dt);
		if (Math.abs(vy) < REST_VY) vy = 0;
		else vy = -Math.abs(vy) * physics.restitution;
		bounced = true;
	}
	const speed = Math.hypot(vx, vy);
	const atRest = y >= b.maxY - 1 && Math.abs(vy) < 1 && Math.abs(vx) < REST_VX || bounced && speed < REST_VY && Math.abs(vy) < 1;
	return {
		x,
		y,
		vx,
		vy,
		bounced,
		atRest
	};
};
/** 单步允许的最大位移（px）：一帧位移超过它就拆成多步积分 */
const SUBSTEP_PX = 8;
/** 单帧最多拆几步（兜底：极端速度下别把一帧拖成几百次积分） */
const SUBSTEP_MAX = 64;
/**
* 一帧该积几步（整数 ≥ 1）。**N = 1 是常态**：普通甩抛一帧位移远小于 8px，与旧的单步积分逐位相同；
* 只有弹弓拉得很远、初速到几千 px/s 时才会拆多步——否则一帧跨过上百 px 会跳过「落地」与「反弹」
* 那几帧，Q 弹、摩擦、atRest 判定都会漏。
*
* dt 先按 MAX_STEP_DT 夹取（与 throwStep 内部的夹取同源），保证步数算的就是实际要积的时间。
*/
const throwSubsteps = (vx, vy, dt) => {
	const travel = Math.hypot(vx, vy) * Math.min(Math.max(dt, 0), MAX_STEP_DT);
	if (!(travel > SUBSTEP_PX)) return 1;
	return Math.min(SUBSTEP_MAX, Math.ceil(travel / SUBSTEP_PX));
};
/** 多宠物碰撞恢复系数：能量损失约 0.5%（e = 0.995，接近完全弹性） */
const PET_BOUNCE_E = .995;
/** 身体包围盒（HIT_BOX 命中框比例换算到视口像素）：碰撞相交检测的几何。
*  box = 宠物包围盒左上角（浏览器 root 的 left/top、桌面窗口 pos）；
*  bottomPad = 舞台脚底垫高（stage 被 translateY 下移的量）。 */
const bodyPixelBox = (o) => {
	const h = o.size * 9 / 16;
	return {
		left: o.x + HIT_BOX.x0 / 640 * o.size,
		top: o.y + o.bottomPad + HIT_BOX.y0 / 360 * h,
		right: o.x + HIT_BOX.x1 / 640 * o.size,
		bottom: o.y + o.bottomPad + HIT_BOX.y1 / 360 * h
	};
};
/** 两矩形是否相交（碰撞检测） */
const rectsOverlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
/** 两只宠物碰撞（近乎弹性：动量守恒 + 恢复系数 PET_BOUNCE_E=0.995）。
* 质量 ∝ size²；碰撞法向 = 两包围盒中心连线方向；
* 法向速度分量按一维动量公式重分配，切向分量各自保留（无切向摩擦，切向能量无损）。
* 返回 null = 中心重合无法定法向 / 正在分离（vrel ≤ 0，避免重复弹跳抖动）。
*/
const collidePet = (fly, hit) => {
	const hf = fly.size * 9 / 16 / 2;
	const hh = hit.size * 9 / 16 / 2;
	const cx = hit.x + hit.size / 2 - (fly.x + fly.size / 2);
	const cy = hit.y + hh - (fly.y + hf);
	const dist = Math.hypot(cx, cy);
	if (dist < 1e-6) return null;
	const nx = cx / dist;
	const ny = cy / dist;
	const vrel = (fly.vx - hit.vx) * nx + (fly.vy - hit.vy) * ny;
	if (vrel <= 0) return null;
	const e = PET_BOUNCE_E;
	const m1 = fly.size * fly.size;
	const m2 = hit.size * hit.size;
	const v1n = fly.vx * nx + fly.vy * ny;
	const v2n = hit.vx * nx + hit.vy * ny;
	const v1n2 = ((m1 - e * m2) * v1n + (1 + e) * m2 * v2n) / (m1 + m2);
	const v2n2 = ((m2 - e * m1) * v2n + (1 + e) * m1 * v1n) / (m1 + m2);
	return {
		fvx: fly.vx - v1n * nx + v1n2 * nx,
		fvy: fly.vy - v1n * ny + v1n2 * ny,
		hvx: hit.vx - v2n * nx + v2n2 * nx,
		hvy: hit.vy - v2n * ny + v2n2 * ny
	};
};

//#endregion
//#region src/shared/notify.ts
/** 通知图标文件名（不含扩展名；浏览器半侧拼完整 URL：/dsh-pet-jt-7340/pic/<name>.png） */
const NOTIFY_ICONS$1 = {
	done: "notify-done",
	error: "notify-error",
	truncated: "notify-truncated",
	approval: "notify-approval",
	question: "notify-question",
	test: "notify-test"
};
const MAX_BODY = 80;
/** 文案截断（与弹窗一致：超长只留前 80 字符） */
function truncate(text) {
	return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "…" : text;
}
/** 帧 → toast 文案；不认识的类型 / turn/end 的非弹分支（aborted 等）返回 null */
function frameToToast(frame) {
	switch (frame.type) {
		case "session/event": {
			const ev = frame.event ?? {};
			if (ev.type !== "turn/end") return null;
			const kind = ev.data?.reason?.kind;
			if (kind === "completed") return {
				title: "对话完成",
				body: "",
				icon: NOTIFY_ICONS$1.done
			};
			if (kind === "error") return {
				title: "生成失败",
				body: ev.data?.reason?.error?.message ?? "",
				icon: NOTIFY_ICONS$1.error
			};
			if (kind === "max-tokens") return {
				title: "输出被截断",
				body: "已达到输出 token 上限",
				icon: NOTIFY_ICONS$1.truncated
			};
			return null;
		}
		case "approval/requested": {
			const toolName = typeof frame.toolName === "string" ? frame.toolName : "";
			const reason = typeof frame.reason === "string" && frame.reason ? frame.reason : "";
			return {
				title: "正在申请权限",
				body: (toolName ? "工具「" + toolName + "」" : "") + (reason ? "：" + reason : ""),
				icon: NOTIFY_ICONS$1.approval
			};
		}
		case "question/requested": {
			const q = Array.isArray(frame.questions) && frame.questions[0]?.question || "";
			return {
				title: "模型在等你回答",
				body: q,
				icon: NOTIFY_ICONS$1.question
			};
		}
		case "host/agent-error": return {
			title: "生成失败",
			body: typeof frame.message === "string" ? frame.message : "",
			icon: NOTIFY_ICONS$1.error
		};
		default: return null;
	}
}

//#endregion
//#region src/client/notify.ts
let pageVisible = typeof document !== "undefined" && !document.hidden;
let pageFocused = typeof document !== "undefined" && document.hasFocus();
function refreshVisible() {
	pageVisible = !document.hidden;
}
function refreshFocused() {
	pageFocused = document.hasFocus();
}
/** 注册聚焦/可见性监听，返回解绑函数 */
function initFocusTracking() {
	if (typeof document === "undefined") return () => {};
	document.addEventListener("visibilitychange", refreshVisible);
	window.addEventListener("focus", refreshFocused);
	window.addEventListener("blur", refreshFocused);
	return () => {
		document.removeEventListener("visibilitychange", refreshVisible);
		window.removeEventListener("focus", refreshFocused);
		window.removeEventListener("blur", refreshFocused);
	};
}
/** 用户是否在看本页（页面可见且持有焦点）——是则跳过通知 */
function isPageActive() {
	return pageVisible && pageFocused;
}
/** 图标 URL（pic 路由由宿主提供：assets/pic → /dsh-pet-jt-7340/pic/<file>） */
const PIC = (name) => "/dsh-pet-jt-7340/pic/" + name + ".png";
/** 图标 URL 表（设置页「获取权限」成功确认的测试通知也用）——文件名单一来源在 shared */
const NOTIFY_ICONS = {
	done: PIC(NOTIFY_ICONS$1.done),
	error: PIC(NOTIFY_ICONS$1.error),
	truncated: PIC(NOTIFY_ICONS$1.truncated),
	approval: PIC(NOTIFY_ICONS$1.approval),
	question: PIC(NOTIFY_ICONS$1.question),
	test: PIC(NOTIFY_ICONS$1.test)
};
/** 当前生效的总开关（运行中可被 reloadNotifications 更新——设置页保存后即时生效，无需刷新） */
let notifyEnabled = true;
/** 当前生效的会话跳转器（app.ts 注入；旧版 DSH 没有 uiWorkspace 时为 undefined） */
let sessionNavigator;
/**
* 点通知 → 切到那条会话 + 聚焦页面 + 请桌面壳把主窗口叫回前台。
*
* 1. `openSession(sessionId)`：**页内**切会话。只改前端状态，窗口还在后台也能切——先切再叫窗口，
*    用户看到窗口的那一刻就是目标会话，不会先闪一下旧对话；
* 2. `window.focus()`：浏览器宿主下由浏览器把页签带到前台；
* 3. 隐藏 iframe 导航 `dsh://open`：页面只能聚焦自己这一层，恢复不了**最小化**的宿主窗口
*    （那是 Electron 主进程的事）→ 协议 → 第二实例锁 → `focusPrimaryWindow()`。零子进程、零新接口。
*    只在 Electron 宿主里发：浏览器里导航 `dsh://` 会弹拦截框，而浏览器点通知本来就会带前页签。
*
* `sessionId` 缺失（旧版宿主 / 拿不到会话位置的事件）时跳过第 1 步，其余照旧。
*/
function wireNotificationClick(n, sessionId) {
	n.onclick = () => {
		n.close();
		if (sessionId !== void 0) try {
			sessionNavigator?.openSession(sessionId);
		} catch {}
		window.focus();
		if (!/electron/i.test(navigator.userAgent)) return;
		const frame = document.createElement("iframe");
		frame.style.display = "none";
		frame.src = "dsh://open";
		document.body.append(frame);
		setTimeout(() => frame.remove(), 1e3);
	};
}
/** 发一条系统通知；总开关关闭 / 环境不支持 / 未授权 / 聚焦本页 时静默跳过。
* 日志（【弹窗】类型：内容）在门之后记录——只有真正发出通知时才记，被门拦下的触发不产生日志。 */
function toast(title, body, icon, sessionId) {
	if (!notifyEnabled) return;
	if (isPageActive()) return;
	if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
	console.log("【弹窗】" + title + (body ? "：" + body : ""));
	try {
		const opts = {};
		if (body) opts.body = truncate(body);
		if (icon) opts.icon = icon;
		const n = new Notification(title, opts);
		wireNotificationClick(n, sessionId);
	} catch {}
}
/** 帧 → toast 并发出（映射来自 shared；未知帧静默跳过）。
* 帧里的 sessionId 一并透传：点击时据此跳到那条会话。 */
function toastFrame(frame) {
	const t = frameToToast(frame);
	if (!t) return;
	toast(t.title, t.body, PIC(t.icon), typeof frame.sessionId === "string" ? frame.sessionId : void 0);
}
/** 申请浏览器通知权限。务必在用户手势（点击）下调用——无手势的自动申请可能被浏览器静默压制；
* 失败时区分原因：unsupported=环境无 Notification、denied=浏览器已标记阻止、
* rejected=用户在询问弹窗里选了阻止、error=申请过程异常/弹窗被跳过。 */
async function requestNotificationPermission() {
	if (typeof Notification === "undefined") return {
		ok: false,
		reason: "unsupported"
	};
	if (Notification.permission === "granted") return { ok: true };
	if (Notification.permission === "denied") return {
		ok: false,
		reason: "denied"
	};
	try {
		const p = await Notification.requestPermission();
		if (p === "granted") return { ok: true };
		if (p === "denied") return {
			ok: false,
			reason: "rejected"
		};
		return {
			ok: false,
			reason: "error",
			message: "权限未授予（" + p + "）"
		};
	} catch (e) {
		return {
			ok: false,
			reason: "error",
			message: e instanceof Error ? e.message : String(e)
		};
	}
}
/** 读取系统通知总开关：读成品聚合 main 条目（用户层优先、缺省回落默认，host 已合并好）；
* 拉取/解析失败时不阻塞（默认开启）。 */
async function readNotificationsEnabled() {
	try {
		const r = await fetch("/dsh-pet-jt-7340/config");
		if (!r.ok) return true;
		const d = await r.json().catch(() => null);
		return typeof d?.main?.notificationsEnabled === "boolean" ? d.main.notificationsEnabled : true;
	} catch {
		return true;
	}
}
/** 重读总开关（设置页保存开关后调用）；之后新触发的通知按新值执行，无需刷新页面 */
async function reloadNotifications() {
	notifyEnabled = await readNotificationsEnabled();
}
/**
* 一帧通知 → toast（帧映射来自 shared；未知帧静默跳过）。
* 由容器统一轮询 /state 后、发现 sections.notify 的 counter 变化时调用——
* 通知不再有独立的 1s 轮询循环（改造前是 /notify?since=<seq> 拉增量帧数组）。
*/
function notifyFromFrame(frame) {
	toastFrame(frame);
}
/**
* 初始化系统通知引擎（**不做轮询**）：读总开关 + 兜底申请权限 + 跟踪页面聚焦 + 记住会话跳转器。
* 帧的消费改为容器统一轮询 /state 后调 notifyFromFrame（见 pet.ts 的分发）。
* 返回释放函数（摘掉聚焦监听），由 ctx.effect 在插件卸载时调用。
* @param navigator 会话跳转器（app.ts 包装 DSH 的 uiWorkspace）；不传 = 点击只叫窗口、不跳会话
*/
function initNotify(navigator$1) {
	sessionNavigator = navigator$1;
	readNotificationsEnabled().then((enabled) => {
		notifyEnabled = enabled;
		if (typeof Notification !== "undefined" && enabled && Notification.permission === "default") requestNotificationPermission();
	});
	return initFocusTracking();
}

//#endregion
//#region src/client/settings.ts
/** 容器与设置页共享的桥（同一 bundle 单例）：
* current=最新完整宠物列表（**成品拍平**，含条目级字段与文件宠物，默认空；容器是唯一写入方）；
* reload=容器注册的重载回调（未注册时为无操作函数）：传 host 保存接口返回的成品聚合即直接拍平，
*   缺省则由容器自行 GET /config；template=main 条目的宠物[0]（「添加宠物」用它作为默认配置） */
const petBridge = {
	current: [],
	reload: () => {},
	template: void 0
};
/** 字典命名空间 */
const NS = "petJt.config";
/** 一处「服务商 + 模型」是否合法：**要么都留空（= 跟随当前对话）要么都非空**。
*  与宿主 config.ts 的 modelSelectionValid 同一套规则（非法宿主回 400，这里先就地给红字提示）。 */
const modelPairValid = (m) => m.provider.trim() === "" === (m.model.trim() === "");
/**
* 设置页内联 CSS（只服务「AI 模型」单下拉选择器）。
*
* 为什么要有 CSS 而不是全用行内 style：hover / focus-visible / 箭头旋转这些**伪类与过渡**
* 行内样式表达不了，而这个选择器是照 DSH 对话框右下角的模型选择器做的——触发器要有 hover、
* 浮层要有阴影与滚动，只能落到样式表。注入方式与宠物页面同一套（data-plugin-css 去重，
* 官方插件标准做法）。
*
* 类名统一 dsh-pet-jt-mp__ 前缀（mp = model picker），不会撞到 DSH 自己的类名。
*/
const SETTINGS_CSS = [
	".dsh-pet-jt-mp{position:relative;min-width:0;display:flex;flex-direction:column;gap:4px}",
	".dsh-pet-jt-mp__trigger{display:flex;align-items:center;gap:6px;width:100%;max-width:340px;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-align:left;cursor:pointer;outline:none}",
	".dsh-pet-jt-mp__trigger:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}",
	".dsh-pet-jt-mp__trigger:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}",
	".dsh-pet-jt-mp__trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
	".dsh-pet-jt-mp__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
	".dsh-pet-jt-mp__sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex-shrink:1000;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary))}",
	".dsh-pet-jt-mp__chevron{flex:none;margin-left:auto;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary));transition:transform .12s}",
	".dsh-pet-jt-mp__chevron.is-open{transform:rotate(180deg)}",
	".dsh-pet-jt-mp__panel{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:4px;padding:4px;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-elevation-prominent,0 8px 30px rgba(0,0,0,.35));color:var(--dsw-alias-label-primary)}",
	".dsh-pet-jt-mp__search{box-sizing:border-box;width:100%;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}",
	".dsh-pet-jt-mp__search:focus{border-color:var(--dsw-alias-state-business-primary)}",
	".dsh-pet-jt-mp__list{display:flex;flex-direction:column;min-height:0;overflow-y:auto;scrollbar-width:thin}",
	".dsh-pet-jt-mp__group{padding:6px 8px 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
	".dsh-pet-jt-mp__item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}",
	".dsh-pet-jt-mp__item:hover:not(:disabled),.dsh-pet-jt-mp__item.is-active{background:var(--dsw-alias-interactive-bg-hover)}",
	".dsh-pet-jt-mp__item[aria-checked=\"true\"]{color:var(--dsw-alias-state-business-primary)}",
	".dsh-pet-jt-mp__item:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}",
	".dsh-pet-jt-mp__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
	".dsh-pet-jt-mp__check{flex:none;margin-left:auto}",
	".dsh-pet-jt-mp__status{padding:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
	".dsh-pet-jt-cfg{container-type:inline-size;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}",
	".dsh-pet-jt-cfg__title{display:flex;align-items:center;gap:6px;margin:0;font-size:16px;font-weight:500;line-height:24px}",
	".dsh-pet-jt-cfg__card{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px}",
	".dsh-pet-jt-cfg__cardHead{display:flex;align-items:center;gap:6px;min-height:20px}",
	".dsh-pet-jt-cfg__cardTitle{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}",
	".dsh-pet-jt-cfg__grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 16px;align-items:end}",
	".dsh-pet-jt-cfg__grid4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 16px;align-items:end}",
	".dsh-pet-jt-cfg__grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;align-items:end}",
	"@container (max-width:600px){.dsh-pet-jt-cfg__grid4{grid-template-columns:repeat(2,minmax(0,1fr))}}",
	"@container (max-width:400px){.dsh-pet-jt-cfg__grid2,.dsh-pet-jt-cfg__grid3,.dsh-pet-jt-cfg__grid4{grid-template-columns:minmax(0,1fr)}}",
	".dsh-pet-jt-cfg__field{display:flex;flex-direction:column;gap:4px;min-width:0}",
	".dsh-pet-jt-cfg__flabel{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary)}",
	".dsh-pet-jt-cfg__inp{box-sizing:border-box;width:100%;min-height:28px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none}",
	".dsh-pet-jt-cfg__inp:focus{border-color:var(--dsw-alias-state-business-primary)}",
	".dsh-pet-jt-cfg__inp:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
	".dsh-pet-jt-cfg__persona{display:flex;flex-direction:column;gap:2px;min-width:0}",
	".dsh-pet-jt-cfg__area{min-height:66px;resize:vertical;line-height:18px}",
	".dsh-pet-jt-cfg__count{font-size:11px;color:var(--dsw-alias-label-tertiary);text-align:right}",
	".dsh-pet-jt-cfg__toggle{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;color:var(--dsw-alias-label-primary)}",
	".dsh-pet-jt-cfg__toggle>label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;min-width:0}",
	".dsh-pet-jt-cfg__toggle>label>span{overflow-wrap:anywhere}",
	".dsh-pet-jt-cfg__toggle input[type=checkbox]{flex:none;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}",
	".dsh-pet-jt-cfg [data-tip]{position:relative}",
	".dsh-pet-jt-cfg [data-tip]::after{display:none;content:attr(data-tip);position:absolute;left:-4px;bottom:calc(100% + 8px);width:max-content;max-width:260px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-tooltip-bg);color:#fff;font-size:12px;font-style:normal;font-weight:400;line-height:18px;text-align:left;white-space:normal;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s ease;box-shadow:0 6px 20px rgba(0,0,0,.22);z-index:2147483000}",
	".dsh-pet-jt-cfg [data-tip]:hover::after{display:block;opacity:1;visibility:visible}",
	".dsh-pet-jt-cfg [data-tip][data-tip-end]::after{left:auto;right:-4px}",
	".dsh-pet-jt-cfg__q{display:inline-flex;align-items:center;justify-content:center;flex:none;width:14px;height:14px;border:1px solid var(--dsw-alias-label-tertiary);border-radius:50%;color:var(--dsw-alias-label-tertiary);font-size:10px;font-style:normal;line-height:1;cursor:help;user-select:none}",
	".dsh-pet-jt-cfg__btn{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 14px;font:inherit;font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap}",
	".dsh-pet-jt-cfg__btn:hover:not(:disabled):not(.is-primary){background:var(--dsw-alias-interactive-bg-hover)}",
	".dsh-pet-jt-cfg__btn:disabled{opacity:.5;cursor:default}",
	".dsh-pet-jt-cfg__btn.is-primary{border-color:var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:#fff}",
	".dsh-pet-jt-cfg__btn.is-primary:hover:not(:disabled){border-color:var(--dsw-alias-button-info-hover);background:var(--dsw-alias-button-info-hover)}",
	".dsh-pet-jt-cfg__btn.is-danger{border-color:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-state-error-primary)}",
	".dsh-pet-jt-cfg__btn.is-sm{padding:2px 10px}",
	".dsh-pet-jt-cfg__btn.is-ghost{border-style:dashed;color:var(--dsw-alias-label-secondary)}",
	".dsh-pet-jt-cfg__tabs{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
	".dsh-pet-jt-cfg__tabsLabel{font-size:12px;color:var(--dsw-alias-label-secondary)}",
	".dsh-pet-jt-cfg__tab{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 12px;font:inherit;font-size:13px;cursor:pointer}",
	".dsh-pet-jt-cfg__tab:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
	".dsh-pet-jt-cfg__tab:disabled{opacity:.5;cursor:default}",
	".dsh-pet-jt-cfg__tab.is-active{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-active)}",
	".dsh-pet-jt-cfg__tab.is-ghost{border-style:dashed;color:var(--dsw-alias-label-secondary)}",
	".dsh-pet-jt-cfg__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}",
	".dsh-pet-jt-cfg__msg{margin-left:4px;font-size:12px;color:var(--dsw-alias-state-success-primary)}",
	".dsh-pet-jt-cfg__msg.is-err{color:var(--dsw-alias-state-error-primary)}",
	".dsh-pet-jt-cfg__note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
	".dsh-pet-jt-cfg__path{font-size:12px;line-height:18px;word-break:break-all;user-select:text;color:var(--dsw-alias-label-secondary)}",
	".dsh-pet-jt-cfg__path b{color:var(--dsw-alias-label-primary);font-weight:400}",
	".dsh-pet-jt-cfg__cmd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,\"Courier New\",monospace;font-size:12px;line-height:18px;word-break:break-all;user-select:text;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}"
].join("\n");
const settingsCssTag = "dsh-pet-jt/settings.css";
/** 注入设置页 CSS（只注入一次；与宠物页面 injectCss 同一套 data-plugin-css 去重） */
function injectSettingsCss() {
	if (typeof document === "undefined") return;
	if (document.querySelector("style[data-plugin-css=\"" + settingsCssTag + "\"]") !== null) return;
	const tag = document.createElement("style");
	tag.dataset.plugin = "dsh-pet-jt";
	tag.dataset.pluginCss = settingsCssTag;
	tag.textContent = SETTINGS_CSS;
	document.head.appendChild(tag);
}
const zh = {
	nav: "桌宠配置 JT",
	intro: "管理多个桌宠：每个宠物可独立设置大小与位置（保存后即时生效）。本页在原版 dsh-pet 之上新增「定时提醒」与「随机出现/隐藏频率」两块，两份配置互不影响。",
	petCardTitle: "宠物配置",
	petCardHint: "每只宠物独立配置：名字 / 大小 / 显示位置 / 位置 / 偏移 / 四个功能开关。改完点最下面的「保存」即时生效。桌面上双击宠物 = 查看余额（与右键菜单同一动作）。",
	globalTitle: "全局开关",
	globalHint: "所有宠物共用（pet pack 可在自己种类文件里单独覆盖）。这几个开关只改本地状态，随「保存」整包写入用户配置（不做即时写入）；系统通知在保存后即时重读，无需刷新页面。",
	cornerHint: "宠物贴着屏幕的哪个角（桌面端按各自显示器的工作区算）。",
	marginXHint: "距所选角落的水平距离（px），可为任意数字。",
	marginYHint: "距所选角落的垂直距离（px），可为任意数字。",
	"cmd.chat": "对话",
	"cmd.pet": "桌宠",
	"cmd.balance": "余额",
	petsLabel: "宠物列表",
	add: "添加宠物",
	remove: "删除",
	confirmRemove: "确定删除宠物「{id}」吗？",
	confirmTitle: "确认操作",
	cancel: "取消",
	ok: "知道了",
	atLeastOne: "至少保留一个宠物。",
	emptyPets: "暂无宠物，点击「添加宠物」创建。",
	sizeLabel: "大小（宽度 px）",
	sizeHint: "高度自动 = 宽度 × 9/16。",
	nameLabel: "名字",
	nameHint: "显示名：鼠标悬浮宠物时弹出，也会加进 AI 人设（你的名字是 X）。可重复，留空按宠物 id 处理。",
	personaLabel: "人设（可选）",
	personaHint: "只影响这只宠物。留空 = 跟随所属条目的人设——输入框里的灰色文字就是那份内容。实际发给模型的 system = 这段 + 自动追加的「你的名字是“<名字>”」+ 当前时间背景，所以别在这里再写名字和日期。",
	personaCount: "{n} 字",
	balanceEnabled: "余额功能",
	balanceEnabledHint: "启用后该宠物触发余额动画并显示余额气泡。",
	whisperEnabled: "碎碎念",
	whisperEnabledHint: "启用后该宠物按周期用 AI 生成一句话并播碎碎念动画（人设见下方「人设」框，留空跟随条目）。",
	workStatusEnabled: "工作状态联动",
	workStatusEnabledHint: "启用后该宠物跟随 DSH 工作状态：思考/工作中/等待确认/完成/出错时自动切对应动画并弹气泡（动画池在配置顶层，仅监听不调用模型）。",
	fixedEnabled: "宠物固定",
	fixedEnabledHint: "启用后随机动画不再让宠物自己转向或走开，只播原地待机与随机小动作；右键菜单点播、接口触发、余额/碎碎念/工作状态动画不受影响。",
	displayLabel: "显示位置",
	displayHint: "web=仅浏览器 / desktop=仅桌面 / both=两者都显示 / none=都不显示",
	"display.web": "仅浏览器",
	"display.desktop": "仅桌面",
	"display.both": "两者都显示",
	"display.none": "都不显示",
	cornerLabel: "位置",
	"corner.top-left": "左上角",
	"corner.top-right": "右上角",
	"corner.bottom-left": "左下角",
	"corner.bottom-right": "右下角",
	marginX: "水平偏移",
	marginY: "垂直偏移",
	save: "保存",
	saveHotkey: "Ctrl+S / Cmd+S",
	sync: "同步",
	confirmSync: "确定同步吗？将用项目内置的默认配置（完整字段 + 注释）覆盖用户配置，当前的自定义内容会丢失。",
	corruptTitle: "用户配置已损坏，未保存",
	corruptConfirm: "强行保存",
	corruptBody: "用户配置文件解析不了（内容已损坏，不是合法 JSON/JSONC）：{path}。继续保存会按白名单重建这个文件——它里面现有的内容（animations / physics / memes 等自定义字段）会全部丢失。取消 = 不动文件（先去把配置改回合法再保存）；确认 = 强行保存（丢弃文件里现有的内容）。",
	syncHint: "「同步」会把项目内置的默认配置（含注释与全部高级字段）写入用户配置文件，覆盖当前自定义内容；之后可直接编辑该文件。注意两点：① 文件一旦生成即为显式覆盖层——插件升级后内置默认的变化不会自动生效（除非再次同步或删除该文件）；② 在本页点「保存」会按白名单重写该文件（字段值保留，但注释会被去掉）。",
	configMeta: "高级配置（文件）",
	configMetaHint: "用户配置可覆盖宠物列表 / 动画池 / 播放权重，修改后刷新或重启生效：浏览器端刷新页面，桌面端右键宠物 →「重载配置」（重载全部桌面宠物窗口）；默认配置为完整参考。",
	defaultConfig: "默认配置（只读，完整参考）",
	userConfig: "用户配置（自定义覆盖）",
	animationDir: "动画素材目录（可自定义/扩充动画）",
	memesDir: "表情包目录（可自定义/扩充配图）",
	saved: "已保存，桌宠即时生效。",
	loadError: "加载配置失败",
	loading: "正在加载配置…",
	retry: "重试",
	invalid: "请检查输入：大小需为正数，边距可为任意数字。",
	busy: "保存中…",
	extraPetsHint: "另 {n} 只额外宠物由 pet/ 目录文件定义（<名>-config.json + <名>-animation/ + <名>-memes/），它们不在此列表——改文件后浏览器刷新页面、桌面端右键「重载配置」即可生效。",
	notifyToggle: "系统通知",
	notifyToggleHint: "对话完成 / 生成失败 / 权限申请 / 用户选择，在窗口失焦时弹出系统级通知（桌面右下角）。",
	whisperImageToggle: "碎碎念配图",
	whisperImageToggleHint: "碎碎念时从表情包池随机抽一张，连同那句话一起显示（图片映射在配置文件顶层 memes）。token：碎碎念本来就每次生成都要调一次模型，配图只是把抽中那张的名称+描述（约 100 字符 / ≈60 token）加进同一次请求，增量可忽略。",
	chatImageToggle: "对话配图",
	chatImageToggleHint: "对话时由 AI 按当前语境从表情包池挑一张配图（可不挑；图片映射在配置文件顶层 memes）。token：每条消息都要把整张清单附进请求，当前约 1.1k 字符（≈650 token，约碎碎念配图的 11 倍），并随图片数量线性增长；关掉则一个字符都不附。",
	confineToggle: "锁定在当前屏幕",
	confineToggleHint: "多屏用户：开了之后宠物只在当前所在那块屏幕内活动——甩出去的宠物只在松手时所在那块屏内弹（屏缝当墙，不飞到隔壁屏），自主漫游也只在当前所在那块屏内走（越出屏缝的那一步直接取消）。关掉则照常跨屏飞行 / 跨屏行走。只影响桌面模式——浏览器 overlay 本来就只在视口内活动。",
	physicsTitle: "物理（拖拽抛掷手感）",
	physicsHint: "全局默认，所有宠物共用（pet pack 可在自己种类文件里单独覆盖）；随「保存」写入用户配置（不做即时写入）。浏览器保存后即时生效，桌面端由保存重载宠物窗口后生效。",
	"physics.gravity": "重力 gravity",
	"physics.gravityHint": "px/s²，越大落得越快；0 = 无重力（抛出去匀速直线飞）",
	"physics.restitution": "弹性 restitution",
	"physics.restitutionHint": "0~1，碰壁 / 落地反弹保留的速度比例（1 = 完全弹性，0 = 撞上即停）",
	"physics.groundFriction": "地面摩擦 groundFriction",
	"physics.groundFrictionHint": "/s，落地后水平速度的衰减率；0 = 冰面不减速",
	"physics.throwPower": "总力度 throwPower",
	"physics.throwPowerHint": "> 0，弹簧跟手与甩出初速的整体倍率（1 = 默认；越大越跟手、甩得越猛）",
	physicsCeilingBounce: "顶部反弹 ceilingBounce",
	physicsCeilingBounceHint: "关掉后抛掷可飞出屏幕顶部（重力仍会把它拉回来）",
	physicsPetCollision: "宠物互撞 petCollision",
	physicsPetCollisionHint: "飞行中的宠物撞到别的宠物按动量守恒弹开（质量 ∝ 尺寸²）",
	invalidPhysics: "请检查物理参数：重力 / 地面摩擦 ≥ 0，弹性 0~1，总力度 > 0。",
	fontTitle: "外观与字体",
	fontHint: "字体种类作用于现在用软糖体的全部文字：宠物气泡、悬浮提示、对话窗、得分弹窗；字号只作用于宠物气泡与悬浮提示（对话窗与得分弹窗的字号不变）。全局默认，所有宠物共用（pet pack 可在自己种类文件里单独覆盖）；随「保存」写入用户配置，浏览器保存后即时生效，桌面端由保存重载宠物窗口后生效。",
	fontFamilyLabel: "字体",
	fontFamilyHint: "「软糖体（内置）」随插件提供；其余为系统字体，机器上没装时自动回退到字体栈里的下一个（不会空白或报错）。",
	fontSizeLabel: "字号（px）",
	fontSizeHint: "气泡正文字号；悬浮提示与气泡内的小字按既有比例派生。范围 4~200。",
	fontFollowToggle: "字号随宠物大小缩放",
	fontFollowToggleHint: "开启（默认）：宠物调大时字号等比放大，462 宽时正好是上面设定的字号；关闭：字号恒定，不随宠物大小变化。",
	invalidFont: "请检查字体设置：字体需在下拉列表内，字号需为 4~200 的数字。",
	"font.candy": "软糖体（内置）",
	"font.yahei": "微软雅黑 / 苹方",
	"font.youyuan": "幼圆",
	"font.kaiti": "楷体",
	"font.simsun": "宋体",
	"font.comic": "漫画体",
	"font.system": "系统默认",
	modelTitle: "AI 模型与对话上下文",
	modelHint: "碎碎念与对话各自用哪个模型，以及对话每次带多少历史进上下文。选「跟随当前对话」= 用你当前对话正在用的那个模型（默认）。全局默认：对所有宠物生效，pet pack 可在自己种类文件里单独覆盖。选项与 DSH 的模型选择器同源，由宿主实时提供。",
	modelFollow: "跟随当前对话",
	modelSearch: "搜索模型…",
	modelEmpty: "没有匹配的模型。",
	modelNoModels: "没有可用的模型。",
	modelLoading: "正在刷新模型列表…",
	modelTriggerAria: "选择模型，当前 {model}",
	modelUnknown: "（当前配置，不在列表中）",
	modelNone: "该服务商没有可用模型",
	whisperModelLabel: "碎碎念模型",
	chatModelLabel: "对话模型",
	modelFieldHint: "选「跟随当前对话」= 用当前对话的模型；指定了但调用失败会自动回落到当前对话的模型重试一次。",
	invalidModel: "请检查模型设置：服务商与模型要么都选，要么都留空（跟随当前对话）。",
	modelCatalogFailed: "模型列表加载失败（刷新页面可重试）；当前配置值仍会原样保留。",
	chatMemory: "对话历史条数",
	chatMemoryHint: "每次对话请求携带的最近历史轮数（1 轮 = 1 问 1 答；0 = 不带历史，每句都是全新对话）。对话记忆本身全存不删，此值只决定截多少进上下文——越大越记得住，也越费 token。全局默认，所有宠物共用（pet pack 可在自己种类文件里单独覆盖）。",
	invalidChatMemory: "请检查对话历史条数：需为 ≥ 0 的数字。",
	chatImageLimit: "对话配图张数上限",
	chatImageLimitHint: "对话时发给模型的表情包清单最多几张（「前 N 张」= 配置里写在前面的那 N 条，想让哪几张优先被发出去就把顺序往前挪）。整张清单是每条消息都要附的，token 随张数线性增长——张数一多就是纯烧钱，限制成前 N 张，模型只从这几张里挑。0 = 不限制（全部发）。内置默认 10。全局默认，所有宠物共用（pet pack 可在自己种类文件里覆盖）。只影响对话选图：碎碎念只带抽中的那一张。",
	invalidChatImageLimit: "请检查对话配图张数上限：需为 ≥ 0 的数字（0 = 不限制）。",
	notifyTest: "测试弹窗",
	notifyTestOk: "测试通知已发送，请查看桌面右下角。",
	notifyDenyUnsupported: "当前环境不支持系统通知（浏览器无 Notification API）。",
	notifyDenyBlocked: "通知权限已被浏览器标记为「阻止」。",
	notifyDenyRejected: "你在权限询问弹窗中选择了「阻止」。",
	notifyDenyError: "申请权限时出错",
	notifyGuide: "引导：点击地址栏左侧 🔒/ⓘ →「网站设置」→「通知」→ 改为「允许」，刷新页面后重试。",
	storageTitle: "卸载与存储",
	storageHint: "插件在本机落下的全部位置。删缓存不影响使用（会自动重下/重建）；删「插件用户数据」会丢配置与对话记忆。",
	"storage.userData": "插件用户数据：自定义配置 main-config.jsonc、对话记忆 memory.json、自定义动画素材 main-animation/、文件宠物 pet/",
	"storage.electron": "桌面宠物用的 Electron 运行时（体积较大；删除后下次启用桌面模式会自动重新下载）",
	"storage.desktopCache": "桌面宠物窗口的缓存与主屏缩放缓存（可删，会自动重建）",
	"storage.electronCache": "Electron 安装包下载缓存（可删，需要时会重新下载）",
	"storage.package": "插件本体（由 DSH 管理，用下面的卸载命令移除，不要手删）",
	storageMissing: "（尚未创建）",
	uninstallTitle: "卸载方法",
	uninstallStep1: "1. 先退出 DSH（桌面宠物随之退出）；不要在桌宠运行时删除上面的文件。",
	uninstallStep2: "2. 卸载插件本体（终端执行，会同时从 profile 的 bundle 层移除）：",
	uninstallStep3: "3. 按需删除上面的位置：缓存类删了无影响；「插件用户数据」删了会丢配置与对话记忆（想保留就先备份其中的 main-config.jsonc）。",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet-jt",
	reminderTitle: "定时提醒",
	reminderHint: "每天到点让桌宠说一句你写的话（喝水 / 休息 / 起来走走…）。提示气泡复用对话气泡：与碎碎念、对话回复走同一条通道，外观、时长、动画联动完全一致。同一分钟同一条只触发一次；DSH 没在运行而错过的时刻不补发。",
	reminderToggle: "启用定时提醒",
	reminderToggleHint: "总开关。关闭后所有定时任务都不触发（任务内容保留，随时可以再打开）。",
	reminderEmpty: "还没有定时任务，点下面的「添加任务」创建一条（例如 10:30 提醒喝水）。",
	reminderAdd: "添加任务",
	reminderTimeLabel: "时刻",
	reminderTextLabel: "提示语句",
	reminderTextPlaceholder: "例如：该喝水啦，起来动一动～",
	reminderRowEnabled: "启用",
	reminderFoot: "每条任务 = 每天一个固定时刻（24 小时制）。语句上限 120 字、最多 40 条；改完点「保存」写入本插件自己的配置文件（~/.dsh/dsh-pet-jt/main-config.jsonc），不影响原版 dsh-pet。",
	invalidReminder: "请检查定时提醒：时刻需为 HH:MM，提示语句不能为空且不超过 120 字。",
	cycleTitle: "随机出现 / 隐藏频率",
	cycleHint: "开启后桌宠会自己离开桌面再回来：出现后随机停留一段时间再隐藏，隐藏后随机一段时间再出现。四个数值单位都是分钟、各自 1~120，且最短不能大于最长。触发一次说话（碎碎念 / 对话 / 定时提醒）会让它立刻现身，并重新计算下一次隐藏时间。网页里的桌宠与桌面模式的透明窗口宠物都生效（桌面端是整窗隐藏，不占点击）。",
	cycleToggle: "启用随机出现 / 隐藏",
	cycleToggleHint: "关闭 = 一直显示（与原版行为一致）。只影响\"看不看得见\"，不动配置、动画与对话记忆。",
	cycleVisibleMin: "出现后最短停留（分钟）",
	cycleVisibleMax: "出现后最长停留（分钟）",
	cycleHiddenMin: "隐藏后最短多久出现（分钟）",
	cycleHiddenMax: "隐藏后最长多久出现（分钟）",
	cycleMinutesUnit: "分钟",
	cycleFoot: "例：出现后最短 5 / 最长 20 分钟 → 宠物出现在桌面后的 5~20 分钟之间某个随机时刻隐藏；隐藏后最短 10 / 最长 30 分钟 → 10~30 分钟内随机回来。",
	invalidCycle: "请检查出现/隐藏频率：四个值都需在 1~120 分钟之间，且「最短」不能大于「最长」。"
};
const en = {
	nav: "Pet Config JT",
	intro: "Manage multiple pets: each pet has its own size and position (applies instantly after saving). This page adds \"Scheduled reminders\" and \"Random show / hide\" on top of the original dsh-pet; the two plugins keep separate settings.",
	petCardTitle: "Pet",
	petCardHint: "Per-pet settings: name / size / display / corner / offsets / the four feature switches. Click \"Save\" at the bottom to apply instantly. Double-clicking the pet shows its balance (same action as the context menu).",
	globalTitle: "Global switches",
	globalHint: "Shared by every pet (a pet pack may override them in its own kind file). These switches only change local state and are written to the user config on \"Save\" (never written immediately); system notifications re-read right after saving, no page refresh needed.",
	cornerHint: "Which screen corner the pet sticks to (per-monitor work area in desktop mode).",
	marginXHint: "Horizontal distance from the chosen corner (px); any number.",
	marginYHint: "Vertical distance from the chosen corner (px); any number.",
	"cmd.chat": "Chat",
	"cmd.pet": "Pet",
	"cmd.balance": "Balance",
	petsLabel: "Pets",
	add: "Add pet",
	remove: "Remove",
	confirmRemove: "Delete pet \"{id}\"?",
	confirmTitle: "Confirm action",
	cancel: "Cancel",
	ok: "Got it",
	atLeastOne: "Keep at least one pet.",
	emptyPets: "No pets yet — click \"Add pet\" to create one.",
	sizeLabel: "Size (width px)",
	sizeHint: "Height is automatic = width × 9/16.",
	nameLabel: "Name",
	nameHint: "Shown on hover and added to AI personas (\"your name is X\"). Duplicates allowed; empty falls back to the pet id.",
	personaLabel: "Persona (optional)",
	personaHint: "Applies to this pet only. Leave empty to follow the entry persona — the grey text inside the box is exactly that. The system prompt actually sent = this text + an appended 「your name is \"<name>\"」 line + the current time context, so do not repeat the name or the date here.",
	personaCount: "{n} chars",
	balanceEnabled: "Balance",
	balanceEnabledHint: "When enabled, this pet plays balance animations and shows the balance bubble.",
	whisperEnabled: "Whisper",
	whisperEnabledHint: "When enabled, this pet periodically generates a line via AI and plays the whisper animation (persona = the field below; empty follows the entry).",
	workStatusEnabled: "Work status",
	workStatusEnabledHint: "When enabled, this pet follows DSH work state: thinking / working / waiting / done / error switch animations and show bubbles (pool in top-level config; listening only, no model calls).",
	fixedEnabled: "Pin in place",
	fixedEnabledHint: "When enabled, the random chain no longer turns this pet or walks it away — only idle and in-place actions play. Right-click picks, API triggers and balance / whisper / work-status animations are unaffected.",
	displayLabel: "Display",
	displayHint: "web = browser only / desktop = desktop only / both = both / none = neither",
	"display.web": "Browser only",
	"display.desktop": "Desktop only",
	"display.both": "Both",
	"display.none": "Neither",
	cornerLabel: "Position",
	"corner.top-left": "Top-left",
	"corner.top-right": "Top-right",
	"corner.bottom-left": "Bottom-left",
	"corner.bottom-right": "Bottom-right",
	marginX: "Horizontal offset",
	marginY: "Vertical offset",
	save: "Save",
	saveHotkey: "Ctrl+S / Cmd+S",
	sync: "Sync",
	confirmSync: "Sync? This overwrites the user config with the bundled default config (all fields + comments); current customizations are lost.",
	corruptTitle: "User config is corrupted — not saved",
	corruptConfirm: "Save anyway",
	corruptBody: "The user config file cannot be parsed (corrupted, not valid JSON/JSONC): {path}. Saving now rebuilds it from the whitelist — everything currently in that file (animations / physics / memes …) will be lost. Cancel = leave the file untouched (fix it and save again); Confirm = save anyway (discard what is in the file).",
	syncHint: "\"Sync\" writes the bundled default config (comments + every advanced field included) to the user config file, overwriting your current customizations; the file is then directly editable. Two caveats: (1) once created, that file is an explicit override layer — later changes to the bundled defaults will not take effect automatically (until you sync again or delete the file); (2) clicking \"Save\" on this page rewrites the file from a whitelist — field values are kept, comments are dropped.",
	configMeta: "Advanced (files)",
	configMetaHint: "User config may override pets / animation pools / weights — refresh or restart to apply: refresh the page in the browser, or right-click a desktop pet → \"Reload config\" (rebuilds every desktop pet window). The default config is the complete reference.",
	defaultConfig: "Default config (read-only, complete reference)",
	userConfig: "User config (custom overrides)",
	animationDir: "Animation assets dir (add/customize animations here)",
	memesDir: "Meme images dir (add/customize images here)",
	saved: "Saved — the pets updated instantly.",
	loadError: "Failed to load config",
	loading: "Loading config…",
	retry: "Retry",
	invalid: "Check your input: size must be positive; margins can be any number.",
	busy: "Saving…",
	extraPetsHint: "{n} extra pet(s) are file-defined in the pet/ directory (<name>-config.json + <name>-animation/ + <name>-memes/). They are not in this list — after editing the files, refresh the page (browser) or right-click a desktop pet → \"Reload config\".",
	notifyToggle: "System notifications",
	notifyToggleHint: "OS-level toasts (bottom-right of the desktop) for conversation completion, failures, permission requests, and questions — only while this window is unfocused.",
	whisperImageToggle: "Whisper images",
	whisperImageToggleHint: "Attach one random meme from the pool to each whisper line (image mapping lives in the top-level `memes` config field). Tokens: a whisper already calls the model every cycle, so the image only appends the name + description of that one meme (~100 chars / ~60 tokens) to the same request — negligible.",
	chatImageToggle: "Chat images",
	chatImageToggleHint: "Let the AI pick one meme from the pool that fits the current context (optional; mapping lives in the top-level `memes` config field). Tokens: every message carries the whole catalog — currently ~1.1k chars (~650 tokens, about 11x the whisper case) and growing with the number of images; turning this off appends nothing at all.",
	confineToggle: "Lock to the current screen",
	confineToggleHint: "Multi-monitor: when on, the pet stays inside the screen it is currently on — a thrown pet bounces only inside the screen it was released on (screen seams act as walls, so it never flies to the neighbouring monitor), and autonomous wandering only walks within the screen it is currently on (a step that would cross the seam is simply cancelled). Turn this off to let it cross screens as usual. Desktop only — the browser overlay always stays inside the viewport anyway.",
	physicsTitle: "Physics (drag & throw feel)",
	physicsHint: "Global default, shared by every pet (a pet pack may override it in its own kind file); written to the user config on \"Save\" (never written immediately). Applies instantly in the browser; on the desktop it applies once Save reloads the pet windows.",
	"physics.gravity": "Gravity",
	"physics.gravityHint": "px/s² — the higher, the faster it falls; 0 = weightless (flies straight forever)",
	"physics.restitution": "Bounciness",
	"physics.restitutionHint": "0–1, speed kept when bouncing off a wall or the floor (1 = perfectly elastic, 0 = stops dead)",
	"physics.groundFriction": "Ground friction",
	"physics.groundFrictionHint": "per second, horizontal damping while on the ground; 0 = frictionless ice",
	"physics.throwPower": "Throw power",
	"physics.throwPowerHint": "> 0, overall multiplier for spring tracking and release speed (1 = default; higher = tighter tracking, harder throws)",
	physicsCeilingBounce: "Ceiling bounce",
	physicsCeilingBounceHint: "Turn this off to let a throw fly out through the top of the screen (gravity still pulls it back)",
	physicsPetCollision: "Pet collisions",
	physicsPetCollisionHint: "A flying pet bounces off the others with momentum conservation (mass ∝ size²)",
	invalidPhysics: "Check the physics values: gravity / ground friction ≥ 0, bounciness 0–1, throw power > 0.",
	fontTitle: "Appearance & font",
	fontHint: "The family applies to every place that currently uses the candy font: pet bubble, hover tooltip, chat popup, score popup. The size applies only to the pet bubble and the hover tooltip (chat and score popups keep their own size). Global default, shared by every pet (a pet pack may override it in its own kind file); written to the user config on \"Save\" — instant in the browser, and on the desktop it applies once Save reloads the pet windows.",
	fontFamilyLabel: "Font",
	fontFamilyHint: "\"Candy (bundled)\" ships with the plugin; the others are system fonts. If a font is missing on this machine, it falls back to the next one in the stack (never blank, never an error).",
	fontSizeLabel: "Font size (px)",
	fontSizeHint: "Bubble body text size; the tooltip and the smaller lines inside the bubble scale proportionally. Range 4–200.",
	fontFollowToggle: "Scale font with pet size",
	fontFollowToggleHint: "On (default): the font grows with the pet — at 462 px width it is exactly the size above. Off: the size stays fixed regardless of pet size.",
	invalidFont: "Check the font settings: the family must be in the list and the size must be a number between 4 and 200.",
	"font.candy": "Candy (bundled)",
	"font.yahei": "Microsoft YaHei / PingFang",
	"font.youyuan": "YouYuan",
	"font.kaiti": "KaiTi",
	"font.simsun": "SimSun",
	"font.comic": "Comic Sans MS",
	"font.system": "System default",
	modelTitle: "AI models & chat context",
	modelHint: "Which model each of whisper and chat uses, and how much history every chat request carries. \"Follow current conversation\" uses the model your current conversation is on (default). Global default: applies to every pet, and a pet pack may override it in its own kind file. The options come from the same source as the DSH model picker, served live by the host.",
	modelFollow: "Follow current conversation",
	modelSearch: "Search models…",
	modelEmpty: "No matching models.",
	modelNoModels: "No models available.",
	modelLoading: "Refreshing model list…",
	modelTriggerAria: "Select model, current {model}",
	modelUnknown: " (current config, not in the list)",
	modelNone: "No models available for this provider",
	whisperModelLabel: "Whisper model",
	chatModelLabel: "Chat model",
	modelFieldHint: "\"Follow current conversation\" uses the conversation model; if a chosen model fails, the plugin falls back to the conversation model and retries once.",
	invalidModel: "Check the model settings: pick both a provider and a model, or leave both empty (follow the current conversation).",
	modelCatalogFailed: "Failed to load the model list (refresh the page to retry); your current values are kept as they are.",
	chatMemory: "Chat history rounds",
	chatMemoryHint: "How many recent rounds each chat request carries (1 round = 1 question + 1 answer; 0 = no history, every message starts fresh). The memory itself keeps everything — this only decides how much goes into the context: higher remembers more and costs more tokens. Global default, shared by every pet (a pet pack may override it in its own kind file).",
	invalidChatMemory: "Check the chat history rounds: it must be a number ≥ 0.",
	chatImageLimit: "Chat image limit",
	chatImageLimitHint: "How many memes at most are listed to the model during chat (\"first N\" = the first N you wrote in the config, so move the ones you want sent to the front). That whole list is attached to every message and tokens grow linearly with the count, so a long list is pure burn; capping it to the first N makes the model pick only among those. 0 = no limit (send everything). Built-in default 10. Global default, shared by every pet (a pet pack may override it in its own kind file). Chat only — a whisper carries just the one meme it drew.",
	invalidChatImageLimit: "Check the chat image limit: it must be a number ≥ 0 (0 = no limit).",
	notifyTest: "Test notification",
	notifyTestOk: "Test notification sent — check the bottom-right of your desktop.",
	notifyDenyUnsupported: "System notifications are not supported in this environment (no Notification API).",
	notifyDenyBlocked: "Notification permission is blocked by the browser.",
	notifyDenyRejected: "You chose \"Block\" in the permission prompt.",
	notifyDenyError: "Failed to request permission",
	notifyGuide: "Guide: click the 🔒/ⓘ icon next to the address bar → Site settings → Notifications → set to \"Allow\", then refresh and retry.",
	storageTitle: "Uninstall & storage",
	storageHint: "Every location this plugin writes to. Deleting cache folders is harmless (they re-download / rebuild); deleting \"plugin user data\" loses your config and chat memory.",
	"storage.userData": "Plugin user data: custom config main-config.jsonc, chat memory memory.json, custom animation assets main-animation/, file pets pet/",
	"storage.electron": "Electron runtime used by the desktop pet (large; re-downloaded automatically the next time desktop mode starts)",
	"storage.desktopCache": "Desktop pet window cache and primary-monitor scale cache (safe to delete, rebuilt automatically)",
	"storage.electronCache": "Electron installer download cache (safe to delete, re-downloaded when needed)",
	"storage.package": "The plugin itself (managed by DSH — remove it with the command below instead of deleting it)",
	storageMissing: " (not created yet)",
	uninstallTitle: "How to uninstall",
	uninstallStep1: "1. Quit DSH first (the desktop pet exits with it); do not delete these files while the pet is running.",
	uninstallStep2: "2. Remove the plugin itself (run in a terminal; this also drops it from the profile bundle layer):",
	uninstallStep3: "3. Delete the locations above as needed: cache folders are harmless; deleting \"plugin user data\" loses your config and chat memory (back up main-config.jsonc first if you want to keep it).",
	uninstallCmd: "dsh plugin --profile {profile} remove dsh-pet-jt",
	reminderTitle: "Scheduled reminders",
	reminderHint: "At a fixed time each day the pet says a line you wrote (drink water / take a break / stand up…). The bubble is the dialogue bubble: same channel, look, duration and animation as whispers and chat replies. Each task fires once per matching minute; times missed while DSH is not running are not replayed.",
	reminderToggle: "Enable reminders",
	reminderToggleHint: "Master switch. Turning it off keeps the tasks but stops all triggers.",
	reminderEmpty: "No reminders yet — click \"Add task\" to create one (e.g. 10:30 drink water).",
	reminderAdd: "Add task",
	reminderTimeLabel: "Time",
	reminderTextLabel: "Message",
	reminderTextPlaceholder: "e.g. Time for a glass of water!",
	reminderRowEnabled: "On",
	reminderFoot: "Each task = one fixed time per day (24h). Up to 120 characters and 40 tasks. Saving writes this plugin's own config (~/.dsh/dsh-pet-jt/main-config.jsonc) and never touches the original dsh-pet.",
	invalidReminder: "Check the reminders: time must be HH:MM, message non-empty and up to 120 characters.",
	cycleTitle: "Random show / hide",
	cycleHint: "When enabled the pet leaves the desktop and comes back on its own: it stays visible for a random while, then hides for a random while. All four values are minutes in 1–120 and the minimum must not exceed the maximum. Speaking (whisper / chat / reminder) brings it back immediately and restarts the hide timer. Works for both the in-page pet and the desktop-mode transparent window (which is simply hidden, so it never blocks clicks).",
	cycleToggle: "Enable random show / hide",
	cycleToggleHint: "Off = always visible (original behaviour). Only affects visibility, never config, animation or chat memory.",
	cycleVisibleMin: "Visible at least (min)",
	cycleVisibleMax: "Visible at most (min)",
	cycleHiddenMin: "Hidden at least (min)",
	cycleHiddenMax: "Hidden at most (min)",
	cycleMinutesUnit: "min",
	cycleFoot: "Example: visible 5–20 min → the pet hides at a random moment 5–20 minutes after appearing; hidden 10–30 min → it returns at a random moment 10–30 minutes later.",
	invalidCycle: "Check the values: all four must be 1–120 minutes and the minimum must not exceed the maximum."
};
/**
* 制造「桌宠配置」设置页组件（工厂函数）。
*
* 为什么是工厂而非直接定义组件：client 半侧是 __ModuleLoader__ 单文件形态，
* react 能力不能顶层 import，只能由 DSH 的 require('react') 在运行时注入，
* 因此把组件依赖作为参数传入，在工厂内制造出可用的组件后再注册进设置页插槽。
*
* @param rt        运行时注入的依赖集合
* @param rt.h      react/jsx-runtime 的 jsx 函数（即 factory 里的 `h`）——
*                  用于手写 React 元素，如 `h('button', { onClick, children: '保存' })`
* @param rt.useState react 的 useState hook——管理页面内可变状态
*                  （宠物列表 / 选中项 / 忙碌 / 保存消息），值变化时自动重渲染
* @param rt.useRef react 的 useRef hook——「AI 模型」单下拉选择器用它拿触发器/浮层节点
*                  （浮层定位与"点外面关闭"判定），与宠物页面同一份注入
* @param rt.t      locale 绑定到本插件的翻译函数（ctx.locale.bind(NS)）——
*                  取中英文文案，如 `t('nav')` → '桌宠配置' / 'Pet Config'
* @returns PetConfigSection 组件：即整个「桌宠配置」设置页
*          （props 仅有 close，由设置页外壳提供，本页当前未使用）
*/
function makePetConfigSection(rt) {
	const { h, useState, useEffect, useRef, useCallback, t } = rt;
	injectSettingsCss();
	const CORNERS = [
		"top-left",
		"top-right",
		"bottom-left",
		"bottom-right"
	];
	const cornerLabel = (c) => t("corner." + c);
	const inputClass = "dsh-pet-jt-cfg__inp";
	/** 等宽字体栈（路径与命令展示用；不引外部字体，走系统栈，避免多拉一份资源） */
	const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, \"Courier New\", monospace";
	/** 生成一个未占用的宠物 id（pet-2、pet-3…） */
	const nextId = (list) => {
		let n = 2;
		for (;; n++) {
			const id = "pet-" + n;
			if (!list.some((p) => p.id === id)) return id;
		}
	};
	/**
	* 悬浮说明（通用件，本页所有解释小字的唯一去处）：返回**展开到任意元素上**的属性，
	* 带了它就悬浮出气泡（CSS 的 `[data-tip]::after`）。问号与保存按钮共用这一套。
	*
	* 为什么返回属性、而不是包一层 DOM 的组件：宿主常常在 flex 容器里（底部操作区、
	* 卡片头），包一层会把 gap / 对齐 / 拉伸全打乱。展开属性则对布局零影响。
	* 为什么走 data-tip + CSS 而不是行内样式：hover 与过渡只有 CSS 能表达。
	*
	* @param text 说明正文（已翻译）
	* @param end 气泡右对齐（给栅格最右一列 / 贴右缘的元素用，免得气泡顶出设置页）
	*/
	const tip = (text, end = false) => end ? {
		"data-tip": text,
		"data-tip-end": ""
	} : { "data-tip": text };
	/**
	* 问号说明入口：只是气泡的一个宿主外观（圆形 `?`），说明文字走 `tip()` 的同一套机制。
	*
	* 为什么用 `<i>` 而不是 `<button>`：它只是说明入口，点了不该有任何行为，也不该被
	* Tab 当成操作项；真正的可交互入口是它旁边的输入框 / 开关。
	*/
	const q = (text, end = false) => h("i", {
		className: "dsh-pet-jt-cfg__q",
		...tip(text, end),
		"aria-label": text,
		role: "img",
		children: "?"
	});
	/** 卡片头：标题 + 问号说明（+ 可选右侧动作，由调用方自行 append） */
	const cardHead = (title, tip$1, end = false) => h("div", {
		className: "dsh-pet-jt-cfg__cardHead",
		children: [h("span", {
			key: "t",
			className: "dsh-pet-jt-cfg__cardTitle",
			children: title
		}), tip$1 ? q(tip$1, end) : null]
	});
	/** 一个字段：标签（+ 问号）在上、控件在下 */
	const field = (label, control, tip$1, end = false) => h("div", {
		className: "dsh-pet-jt-cfg__field",
		children: [h("span", {
			key: "l",
			className: "dsh-pet-jt-cfg__flabel",
			children: tip$1 ? [label, q(tip$1, end)] : label
		}), control]
	});
	/**
	* 开关的一格：勾选框 + 标题 + 问号。
	* label 为文案键：标题 = t(label)，说明 = t(label + 'Hint')（说明进问号，不再占一行小字）。
	* 说明挂在问号上而不是整格——点标题只切开关，看说明去点问号，两个动作不再抢同一次点击。
	*/
	const toggleCell = (label, value, disabled, onToggle, end = false) => h("div", {
		className: "dsh-pet-jt-cfg__toggle",
		children: [h("label", {
			key: "l",
			children: [h("input", {
				key: "i",
				type: "checkbox",
				checked: value,
				disabled,
				onChange: (e) => onToggle(e.target.checked)
			}), h("span", {
				key: "t",
				children: t(label)
			})]
		}), q(t(label + "Hint"), end)]
	});
	/**
	* 「模型」单下拉选择器（碎碎念 / 对话各一个实例）——照 DSH 对话框右下角的模型选择器写：
	* 一个触发器按钮（当前模型 + 服务商小字 + 箭头）→ 点开一个浮层：搜索框 + 按服务商分组的
	* 模型清单（选中项打勾），最上面一项是「跟随当前对话」。
	*
	* 与 DSH 那份的对应关系：
	*  - 触发器 aria-haspopup/aria-expanded、浮层 role=menu、分组头 + role=menuitemradio[aria-checked]、
	*    搜索 role=searchbox —— 无障碍语义一致；
	*  - 浮层 position:fixed（脱离设置页滚动容器，不被 overflow 裁掉）+ 外部点击 / Esc 关闭 + 滚动跟随；
	*  - 搜索是**大小写不敏感的有序子序列**匹配（DSH 同款：输入 dsc 能命中 DeepSeek Chat）；
	*  - 数据来自 GET /models（宿主 llm 服务），与 DSH 模型选择器同一份来源。
	*
	* 为什么不用两个 <select>：DSH 自己就是"一个按钮 → 一个浮层里的分组清单"，两个下拉框既占地方，
	* 又容易留下"选了服务商没选模型"的非法组合。这里也**不再提供**"手填模型 id"的退路：
	* 列不出模型的服务商本来也没法调用，列出来只会诱人踩坑。
	*
	* 定义在工厂作用域（而非 PetConfigSection 内）：组件类型必须跨渲染稳定，否则每次渲染都会
	* 重新挂载，浮层状态（打开/搜索词/高亮）会当场丢失。
	*/
	const ModelPicker = (props) => {
		const [open, setOpen] = useState(false);
		const [query, setQuery] = useState("");
		const [active, setActive] = useState(0);
		const [pos, setPos] = useState(null);
		const rootRef = useRef(null);
		const panelRef = useRef(null);
		const groups = props.catalog ?? [];
		const group = groups.find((g) => g.id === props.value.provider);
		const picked = group?.models.find((m) => m.id === props.value.model);
		const isFollow = props.value.provider === "";
		const triggerLabel = isFollow ? t("modelFollow") : picked?.name ?? props.value.model;
		const triggerSub = isFollow ? "" : group?.name ?? props.value.provider + t("modelUnknown");
		const q$1 = query.trim().toLowerCase();
		const hit = (text) => {
			if (q$1 === "") return true;
			let i = 0;
			for (const ch of text.toLowerCase()) {
				if (ch === q$1[i]) i += 1;
				if (i >= q$1.length) return true;
			}
			return false;
		};
		const rows = [];
		if (q$1 === "") rows.push({
			kind: "follow",
			key: "__follow"
		});
		for (const g of groups) {
			const models = g.models.filter((m) => hit(m.name + " " + m.id));
			if (models.length === 0 && !(q$1 === "" && g.models.length === 0)) continue;
			rows.push({
				kind: "group",
				key: g.id,
				name: g.name
			});
			if (models.length === 0) {
				rows.push({
					kind: "none",
					key: g.id + "/__none"
				});
				continue;
			}
			for (const m of models) rows.push({
				kind: "model",
				key: g.id + "/" + m.id,
				provider: g.id,
				model: m
			});
		}
		const selectable = rows.map((r, i) => r.kind === "group" || r.kind === "none" ? -1 : i).filter((i) => i >= 0);
		const commit = (v) => {
			props.onChange(v);
			setOpen(false);
			setQuery("");
		};
		const pick$1 = (row) => {
			if (!row) return;
			if (row.kind === "follow") commit({
				provider: "",
				model: ""
			});
			else if (row.kind === "model") commit({
				provider: row.provider,
				model: row.model.id
			});
		};
		const step = (dir) => {
			if (selectable.length === 0) return;
			const at = selectable.indexOf(active);
			const next = selectable[at < 0 ? 0 : (at + dir + selectable.length) % selectable.length];
			setActive(next);
			panelRef.current?.querySelector("[data-row=\"" + next + "\"]")?.scrollIntoView({ block: "nearest" });
		};
		useEffect(() => {
			if (!open) return;
			const el = rootRef.current;
			const place = () => {
				if (!el) return;
				const r = el.getBoundingClientRect();
				const below = window.innerHeight - r.bottom - 12;
				const above = r.top - 12;
				const width = Math.min(Math.max(r.width, 240), Math.max(200, Math.min(420, window.innerWidth - 16)));
				const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
				const up = below < 240 && above > below;
				setPos(up ? {
					left,
					bottom: window.innerHeight - r.top + 4,
					width,
					maxHeight: Math.min(360, above)
				} : {
					left,
					top: r.bottom + 4,
					width,
					maxHeight: Math.min(360, below)
				});
			};
			place();
			panelRef.current?.querySelector("input")?.focus();
			const onDown = (e) => {
				const target = e.target;
				if (target && (rootRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)) return;
				setOpen(false);
			};
			const onKey = (e) => {
				if (e.key === "Escape") setOpen(false);
			};
			document.addEventListener("mousedown", onDown, true);
			document.addEventListener("keydown", onKey, true);
			window.addEventListener("scroll", place, true);
			window.addEventListener("resize", place);
			return () => {
				document.removeEventListener("mousedown", onDown, true);
				document.removeEventListener("keydown", onKey, true);
				window.removeEventListener("scroll", place, true);
				window.removeEventListener("resize", place);
			};
		}, [open]);
		const toggle = () => {
			if (props.disabled) return;
			if (!open) {
				setQuery("");
				const at = rows.findIndex((r) => r.kind === "model" && r.provider === props.value.provider && r.model.id === props.value.model);
				setActive(at >= 0 ? at : 0);
			}
			setOpen(!open);
		};
		const searchRow = h("input", {
			key: "search",
			type: "text",
			className: "dsh-pet-jt-mp__search",
			role: "searchbox",
			placeholder: t("modelSearch"),
			"aria-label": t("modelSearch"),
			value: query,
			disabled: props.disabled,
			onChange: (e) => {
				setQuery(e.target.value);
				setActive(selectable.length > 0 ? selectable[0] : 0);
			},
			onKeyDown: (e) => {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					step(1);
				} else if (e.key === "ArrowUp") {
					e.preventDefault();
					step(-1);
				} else if (e.key === "Enter") {
					e.preventDefault();
					pick$1(rows[active]);
				}
			}
		});
		const rowNode = (row, index) => {
			if (row.kind === "group") return h("div", {
				key: row.key,
				className: "dsh-pet-jt-mp__group",
				children: row.name
			});
			if (row.kind === "none") return h("div", {
				key: row.key,
				className: "dsh-pet-jt-mp__status",
				children: t("modelNone")
			});
			const checked = row.kind === "follow" ? isFollow : props.value.provider === row.provider && props.value.model === row.model.id;
			return h("button", {
				key: row.key,
				type: "button",
				role: "menuitemradio",
				"aria-checked": checked,
				"data-row": index,
				className: "dsh-pet-jt-mp__item" + (index === active ? " is-active" : ""),
				disabled: props.disabled,
				onClick: () => pick$1(row),
				onMouseMove: () => setActive(index),
				children: [h("span", {
					key: "n",
					className: "dsh-pet-jt-mp__name",
					children: row.kind === "follow" ? t("modelFollow") : row.model.name
				}), h("span", {
					key: "c",
					className: "dsh-pet-jt-mp__check",
					children: checked ? "✓" : ""
				})]
			});
		};
		return h("div", {
			ref: rootRef,
			className: "dsh-pet-jt-mp",
			children: [h("button", {
				key: "trigger",
				type: "button",
				className: "dsh-pet-jt-mp__trigger",
				disabled: props.disabled,
				"aria-haspopup": "menu",
				"aria-expanded": open,
				"aria-label": t("modelTriggerAria").replace("{model}", triggerLabel),
				onClick: toggle,
				children: [
					h("span", {
						key: "l",
						className: "dsh-pet-jt-mp__label",
						children: triggerLabel
					}),
					triggerSub ? h("span", {
						key: "s",
						className: "dsh-pet-jt-mp__sub",
						children: triggerSub
					}) : null,
					h("span", {
						key: "c",
						className: "dsh-pet-jt-mp__chevron" + (open ? " is-open" : ""),
						children: "▾"
					})
				]
			}), open && pos ? h("div", {
				key: "panel",
				ref: panelRef,
				className: "dsh-pet-jt-mp__panel",
				role: "menu",
				"aria-label": props.label,
				style: {
					left: pos.left + "px",
					top: pos.top === void 0 ? void 0 : pos.top + "px",
					bottom: pos.bottom === void 0 ? void 0 : pos.bottom + "px",
					width: pos.width + "px",
					maxHeight: pos.maxHeight + "px"
				},
				children: [searchRow, props.catalog === null ? h("div", {
					key: "loading",
					className: "dsh-pet-jt-mp__status",
					children: props.failed ? t("modelCatalogFailed") : t("modelLoading")
				}) : rows.length === 0 ? h("div", {
					key: "empty",
					className: "dsh-pet-jt-mp__status",
					role: "status",
					children: groups.length === 0 ? t("modelNoModels") : t("modelEmpty")
				}) : h("div", {
					key: "list",
					className: "dsh-pet-jt-mp__list",
					role: "group",
					children: rows.map(rowNode)
				})]
			}) : null]
		});
	};
	return function PetConfigSection() {
		const initPets = petBridge.current.filter((p) => !p.extra);
		const extraCount = petBridge.current.filter((p) => p.extra).length;
		const [pets, setPets] = useState(initPets.map((p) => ({
			...p,
			position: { ...p.position }
		})));
		const [selId, setSelId] = useState(initPets[0]?.id ?? "");
		const [saving, setBusy] = useState(false);
		const [loadState, setLoadState] = useState("loading");
		const [loadAttempt, setLoadAttempt] = useState(0);
		const busy = saving || loadState !== "ready";
		const [msg, setMsg] = useState({
			kind: "",
			text: ""
		});
		const rootRef = useRef(null);
		const [dialog, setDialog] = useState(null);
		const [paths, setPaths] = useState(null);
		useEffect(() => {
			fetch("/dsh-pet-jt-7340/config/meta").then((r) => r.ok ? r.json() : null).then((p) => setPaths(p)).catch(() => console.warn("[dsh-pet-jt] 读取配置文件路径失败"));
		}, []);
		const [notifyEnabled$1, setNotifyEnabled] = useState(true);
		const [whisperImage, setWhisperImage] = useState(false);
		const [chatImage, setChatImage] = useState(false);
		const [confineScreen, setConfineScreen] = useState(false);
		const [physics, setPhysics] = useState({ ...DEFAULT_PHYSICS });
		const [font, setFont] = useState({ ...DEFAULT_FONT });
		const [whisperModel, setWhisperModel] = useState({
			provider: "",
			model: ""
		});
		const [chatModel, setChatModel] = useState({
			provider: "",
			model: ""
		});
		const [chatMemory, setChatMemory] = useState(5);
		const [chatImageLimit, setChatImageLimit] = useState(10);
		const [reminders, setReminders] = useState({
			...DEFAULT_REMINDERS,
			tasks: []
		});
		const [cycle, setCycle] = useState({ ...DEFAULT_VISIBILITY_CYCLE });
		const [entryPrompt, setEntryPrompt] = useState("");
		const [catalog, setCatalog] = useState(null);
		const [catalogErr, setCatalogErr] = useState(false);
		const [permMsg, setPermMsg] = useState({
			kind: "",
			text: ""
		});
		const applyConfig = useCallback((merged) => {
			const m = merged.main;
			if (!m || !Array.isArray(m.pets)) throw new Error("Invalid config response");
			const loadedPets = m.pets;
			setPets(loadedPets.map((p) => ({
				...p,
				position: { ...p.position }
			})));
			setEntryPrompt(typeof m.whisperPrompt === "string" ? m.whisperPrompt : "");
			setSelId((id) => loadedPets.some((p) => p.id === id) ? id : loadedPets[0]?.id ?? "");
			if (typeof m.notificationsEnabled === "boolean") setNotifyEnabled(m.notificationsEnabled);
			if (typeof m.whisperImageEnabled === "boolean") setWhisperImage(m.whisperImageEnabled);
			if (typeof m.chatImageEnabled === "boolean") setChatImage(m.chatImageEnabled);
			if (typeof m.confineToScreen === "boolean") setConfineScreen(m.confineToScreen);
			if (m.physics && typeof m.physics === "object") setPhysics({
				...DEFAULT_PHYSICS,
				...m.physics
			});
			if (m.font && typeof m.font === "object") setFont({
				...DEFAULT_FONT,
				...m.font
			});
			const wm = m.whisperModel;
			if (wm && typeof wm.provider === "string" && typeof wm.model === "string") setWhisperModel({
				provider: wm.provider,
				model: wm.model
			});
			const cm = m.chatModel;
			if (cm && typeof cm.provider === "string" && typeof cm.model === "string") setChatModel({
				provider: cm.provider,
				model: cm.model
			});
			const cmr = Number(m.chatMemoryRounds);
			if (Number.isFinite(cmr) && cmr >= 0) setChatMemory(cmr);
			const cil = Number(m.chatImageLimit);
			if (Number.isFinite(cil) && cil >= 0) setChatImageLimit(cil);
			setReminders(normalizeReminders(m.reminders));
			setCycle(normalizeCycle(m.visibilityCycle));
		}, []);
		useEffect(() => {
			let alive = true;
			const controller = new AbortController();
			fetch("/dsh-pet-jt-7340/config", { signal: controller.signal }).then((r) => {
				if (!r.ok) throw new Error("HTTP " + r.status);
				return r.json();
			}).then((merged) => {
				if (!alive) return;
				applyConfig(merged);
				setLoadState("ready");
			}).catch(() => {
				if (alive) setLoadState("error");
			});
			return () => {
				alive = false;
				controller.abort();
			};
		}, [applyConfig, loadAttempt]);
		useEffect(() => {
			let alive = true;
			fetch("/dsh-pet-jt-7340/models").then((r) => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))).then((d) => {
				if (!alive) return;
				if (d && Array.isArray(d.providers)) setCatalog(d.providers);
				else setCatalogErr(true);
			}).catch(() => {
				if (alive) setCatalogErr(true);
			});
			return () => {
				alive = false;
			};
		}, []);
		const toggleNotify = async (v) => {
			setNotifyEnabled(v);
			if (v) await requestNotificationPermission();
		};
		/**
		* 「测试弹窗」按钮：发一条测试系统通知，验证整条链路通不通。
		*
		* 顺带承担申请权限的职责——没授权时先申请（借这次用户手势，无手势的自动申请可能被浏览器
		* 静默压制），授权成功再发测试通知。所以这一个按钮同时是「拿权限」和「验链路」的入口，
		* 不需要再单独摆一个「获取权限」按钮。
		*/
		const testNotification = async () => {
			setPermMsg({
				kind: "",
				text: ""
			});
			const r = await requestNotificationPermission();
			if (!r.ok) {
				const reason = r.reason === "unsupported" ? t("notifyDenyUnsupported") : r.reason === "denied" ? t("notifyDenyBlocked") : r.reason === "rejected" ? t("notifyDenyRejected") : t("notifyDenyError") + (r.message ? "：" + r.message : "");
				setPermMsg({
					kind: "err",
					text: reason + (r.reason === "unsupported" ? "" : " " + t("notifyGuide"))
				});
				return;
			}
			try {
				wireNotificationClick(new Notification("测试通知", {
					body: "【dsh-pet】系统通知已就绪。",
					icon: NOTIFY_ICONS.test
				}));
			} catch {}
			setPermMsg({
				kind: "ok",
				text: t("notifyTestOk")
			});
		};
		const cur = pets.find((p) => p.id === selId) ?? null;
		const updateSel = (patch) => setPets((list) => list.map((p) => {
			if (p.id !== selId) return p;
			const { position: posPatch,...rest } = patch;
			return {
				...p,
				...rest,
				position: posPatch ? {
					...p.position,
					...posPatch
				} : p.position
			};
		}));
		const validated = () => {
			for (const p of pets) if (!Number.isFinite(p.size) || p.size <= 0 || !Number.isFinite(p.position.marginX) || !Number.isFinite(p.position.marginY)) {
				setMsg({
					kind: "err",
					text: t("invalid")
				});
				return false;
			}
			if (!Number.isFinite(physics.gravity) || physics.gravity < 0 || !Number.isFinite(physics.restitution) || physics.restitution < 0 || physics.restitution > 1 || !Number.isFinite(physics.groundFriction) || physics.groundFriction < 0 || !Number.isFinite(physics.throwPower) || physics.throwPower <= 0) {
				setMsg({
					kind: "err",
					text: t("invalidPhysics")
				});
				return false;
			}
			if (!modelPairValid(whisperModel) || !modelPairValid(chatModel)) {
				setMsg({
					kind: "err",
					text: t("invalidModel")
				});
				return false;
			}
			if (!Number.isFinite(chatMemory) || chatMemory < 0) {
				setMsg({
					kind: "err",
					text: t("invalidChatMemory")
				});
				return false;
			}
			if (!Number.isFinite(chatImageLimit) || chatImageLimit < 0) {
				setMsg({
					kind: "err",
					text: t("invalidChatImageLimit")
				});
				return false;
			}
			if (!FONT_PRESETS.some((p) => p.id === font.family) || !Number.isFinite(font.size) || font.size < FONT_SIZE_MIN || font.size > FONT_SIZE_MAX) {
				setMsg({
					kind: "err",
					text: t("invalidFont")
				});
				return false;
			}
			for (const task of reminders.tasks) {
				const text = task.text.trim();
				if (!REMINDER_TIME_RE.test(task.time) || text === "" || Array.from(text).length > REMINDER_TEXT_MAX) {
					setMsg({
						kind: "err",
						text: t("invalidReminder")
					});
					return false;
				}
			}
			if (!cycleRangeValid(cycle.visibleMin, cycle.visibleMax) || !cycleRangeValid(cycle.hiddenMin, cycle.hiddenMax)) {
				setMsg({
					kind: "err",
					text: t("invalidCycle")
				});
				return false;
			}
			return true;
		};
		const save = async (force = false) => {
			if (busy) return;
			const isOk = validated();
			if (!isOk) return;
			setBusy(true);
			setMsg({
				kind: "",
				text: ""
			});
			try {
				const body = {
					pets,
					notificationsEnabled: notifyEnabled$1,
					whisperImageEnabled: whisperImage,
					chatImageEnabled: chatImage,
					confineToScreen: confineScreen,
					physics,
					whisperModel,
					chatModel,
					chatMemoryRounds: chatMemory,
					chatImageLimit,
					font,
					reminders: {
						enabled: reminders.enabled,
						tasks: reminders.tasks.map((task) => ({
							id: task.id,
							time: task.time,
							text: task.text.trim(),
							enabled: task.enabled
						}))
					},
					visibilityCycle: {
						enabled: cycle.enabled,
						visibleMin: Number(cycle.visibleMin),
						visibleMax: Number(cycle.visibleMax),
						hiddenMin: Number(cycle.hiddenMin),
						hiddenMax: Number(cycle.hiddenMax)
					}
				};
				const res = await fetch("/dsh-pet-jt-7340/config" + (force === true ? "?force=1" : ""), {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				});
				if (res.status === 409) {
					const info = await res.json().catch(() => null);
					setDialog({
						kind: "corrupt",
						path: typeof info?.userFile === "string" ? info.userFile : paths?.user ?? ""
					});
					return;
				}
				if (!res.ok) throw new Error("HTTP " + res.status);
				petBridge.reload(await res.json());
				reloadNotifications();
				setMsg({
					kind: "ok",
					text: t("saved")
				});
			} catch {
				setMsg({
					kind: "err",
					text: t("loadError")
				});
			} finally {
				setBusy(false);
			}
		};
		const saveRef = useRef(() => {});
		useEffect(() => {
			saveRef.current = () => void save();
		});
		useEffect(() => {
			const onKey = (e) => {
				if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
				if (e.key.toLowerCase() !== "s") return;
				const root = rootRef.current;
				if (!root || !root.isConnected || root.getClientRects().length === 0) return;
				e.preventDefault();
				saveRef.current();
			};
			document.addEventListener("keydown", onKey);
			return () => document.removeEventListener("keydown", onKey);
		}, []);
		const sync = () => setDialog({ kind: "sync" });
		const doSync = async () => {
			setBusy(true);
			setMsg({
				kind: "",
				text: ""
			});
			try {
				const res = await fetch("/dsh-pet-jt-7340/config", { method: "POST" });
				if (!res.ok) throw new Error("HTTP " + res.status);
				const merged = await res.json();
				applyConfig(merged);
				petBridge.reload(merged);
				reloadNotifications();
				setMsg({
					kind: "ok",
					text: t("saved")
				});
			} catch {
				setMsg({
					kind: "err",
					text: t("loadError")
				});
			} finally {
				setBusy(false);
			}
		};
		const addPet = () => {
			const tpl = petBridge.template;
			if (!tpl) return;
			const id = nextId(pets);
			setPets((list) => [...list, {
				id,
				name: id,
				size: tpl.size,
				balanceEnabled: tpl.balanceEnabled,
				whisperEnabled: tpl.whisperEnabled,
				workStatusEnabled: tpl.workStatusEnabled,
				fixedEnabled: tpl.fixedEnabled,
				display: tpl.display,
				position: { ...tpl.position }
			}]);
			setSelId(id);
		};
		const removeSel = () => {
			setDialog({ kind: pets.length <= 1 ? "lastOne" : "remove" });
		};
		const doRemove = () => {
			const list = pets.filter((p) => p.id !== selId);
			setPets(list);
			setSelId(list[0].id);
		};
		/** 宠物数值输入（大小 / 水平偏移 / 垂直偏移）——宽度交给栅格，不再各自写死 */
		const numInput = (key, value, setter) => h("input", {
			type: "number",
			className: inputClass,
			step: key === "size" ? "10" : "1",
			min: key === "size" ? "120" : "",
			value: String(value),
			disabled: busy,
			onChange: (e) => setter(Number(e.target.value))
		});
		/** 物理参数的一格：标签 + 问号在上、数字输入在下（说明进问号） */
		const physField = (key, step, min, end = false) => field(t("physics." + key), h("input", {
			type: "number",
			className: inputClass,
			step,
			min,
			value: String(physics[key]),
			disabled: busy,
			onChange: (e) => setPhysics((p) => ({
				...p,
				[key]: Number(e.target.value)
			}))
		}), t("physics." + key + "Hint"), end);
		/** 「全局默认」的一个数字格：标签 + 问号在上、数字输入在下（说明 = t(label + 'Hint') 进问号） */
		const globalNumField = (label, value, setter) => field(t(label), h("input", {
			type: "number",
			className: inputClass,
			step: "1",
			min: "0",
			value: String(value),
			disabled: busy,
			onChange: (e) => setter(Number(e.target.value))
		}), t(label + "Hint"));
		/** 「AI 模型」的一格：标签 + 问号在上、单下拉选择器在下 */
		const modelCell = (key, value, setter, end = false) => {
			const label = t(key === "whisperModel" ? "whisperModelLabel" : "chatModelLabel");
			return field(label, h(ModelPicker, {
				label,
				value,
				disabled: busy,
				catalog,
				failed: catalogErr,
				onChange: setter
			}), t("modelFieldHint"), end);
		};
		/** 生成一个不与现有任务重名的 id（只做去重键与 React key，不参与展示） */
		const newReminderId = (list) => {
			let n = 1;
			while (list.some((task) => task.id === "r" + n)) n += 1;
			return "r" + n;
		};
		const addReminder = () => setReminders((cfg) => {
			if (cfg.tasks.length >= REMINDER_MAX_TASKS) return cfg;
			return {
				...cfg,
				tasks: [...cfg.tasks, {
					id: newReminderId(cfg.tasks),
					time: "10:00",
					text: "",
					enabled: true
				}]
			};
		});
		const updateReminder = (id, patch) => setReminders((cfg) => ({
			...cfg,
			tasks: cfg.tasks.map((task) => task.id === id ? {
				...task,
				...patch
			} : task)
		}));
		const removeReminder = (id) => setReminders((cfg) => ({
			...cfg,
			tasks: cfg.tasks.filter((task) => task.id !== id)
		}));
		/** 出现/隐藏频率的一格：标签在上、数字输入在下（1~120 分钟） */
		const cycleField = (label, value, setter) => field(t(label), h("input", {
			type: "number",
			className: inputClass,
			min: String(CYCLE_MIN_MINUTES),
			max: String(CYCLE_MAX_MINUTES),
			step: "1",
			value: String(value),
			disabled: busy,
			onChange: (e) => setter(Number(e.target.value))
		}));
		/** 两块新增卡片（插在物理卡之后、操作区之前） */
		const jtCards = () => [h("div", {
			key: "jt-reminders",
			className: "dsh-pet-jt-cfg__card",
			children: [
				cardHead(t("reminderTitle"), t("reminderHint")),
				toggleCell("reminderToggle", reminders.enabled, busy, (v) => setReminders((cfg) => ({
					...cfg,
					enabled: v
				}))),
				h("div", {
					style: {
						display: "flex",
						flexDirection: "column",
						gap: "8px",
						marginTop: "10px"
					},
					children: [
						...reminders.tasks.length === 0 ? [h("p", {
							key: "empty",
							className: "dsh-pet-jt-cfg__note",
							children: t("reminderEmpty")
						})] : reminders.tasks.map((task, index) => h("div", {
							key: task.id,
							style: {
								display: "flex",
								gap: "8px",
								alignItems: "center",
								flexWrap: "wrap"
							},
							children: [
								h("input", {
									key: "time",
									type: "time",
									className: inputClass,
									style: {
										width: "116px",
										flex: "0 0 auto"
									},
									value: task.time,
									disabled: busy,
									"aria-label": t("reminderTimeLabel") + " " + String(index + 1),
									onChange: (e) => updateReminder(task.id, { time: e.target.value })
								}),
								h("input", {
									key: "text",
									type: "text",
									className: inputClass,
									style: {
										flex: "1 1 220px",
										minWidth: "160px"
									},
									maxLength: REMINDER_TEXT_MAX,
									placeholder: t("reminderTextPlaceholder"),
									value: task.text,
									disabled: busy,
									"aria-label": t("reminderTextLabel") + " " + String(index + 1),
									onChange: (e) => updateReminder(task.id, { text: e.target.value })
								}),
								h("label", {
									key: "on",
									style: {
										display: "flex",
										alignItems: "center",
										gap: "4px",
										fontSize: "12px",
										flex: "0 0 auto"
									},
									children: [h("input", {
										key: "cb",
										type: "checkbox",
										checked: task.enabled,
										disabled: busy,
										onChange: (e) => updateReminder(task.id, { enabled: e.target.checked })
									}), h("span", {
										key: "l",
										children: t("reminderRowEnabled")
									})]
								}),
								h("button", {
									key: "rm",
									type: "button",
									disabled: busy,
									className: "dsh-pet-jt-cfg__btn is-danger is-sm",
									onClick: () => removeReminder(task.id),
									children: t("remove")
								})
							]
						})),
						h("div", {
							key: "add",
							children: [h("button", {
								type: "button",
								disabled: busy || reminders.tasks.length >= REMINDER_MAX_TASKS,
								className: "dsh-pet-jt-cfg__btn is-sm",
								onClick: addReminder,
								children: "+ " + t("reminderAdd")
							})]
						}),
						h("p", {
							key: "foot",
							className: "dsh-pet-jt-cfg__note",
							children: t("reminderFoot")
						})
					]
				})
			]
		}), h("div", {
			key: "jt-cycle",
			className: "dsh-pet-jt-cfg__card",
			children: [
				cardHead(t("cycleTitle"), t("cycleHint")),
				toggleCell("cycleToggle", cycle.enabled, busy, (v) => setCycle((cfg) => ({
					...cfg,
					enabled: v
				}))),
				h("div", {
					className: "dsh-pet-jt-cfg__grid4",
					style: { marginTop: "10px" },
					children: [
						cycleField("cycleVisibleMin", cycle.visibleMin, (v) => setCycle((cfg) => ({
							...cfg,
							visibleMin: v
						}))),
						cycleField("cycleVisibleMax", cycle.visibleMax, (v) => setCycle((cfg) => ({
							...cfg,
							visibleMax: v
						}))),
						cycleField("cycleHiddenMin", cycle.hiddenMin, (v) => setCycle((cfg) => ({
							...cfg,
							hiddenMin: v
						}))),
						cycleField("cycleHiddenMax", cycle.hiddenMax, (v) => setCycle((cfg) => ({
							...cfg,
							hiddenMax: v
						})))
					]
				}),
				h("p", {
					className: "dsh-pet-jt-cfg__note",
					children: t("cycleFoot")
				})
			]
		})];
		return h("section", {
			ref: rootRef,
			className: "dsh-pet-jt-cfg",
			style: { maxWidth: "720px" },
			children: [
				h("h2", {
					className: "dsh-pet-jt-cfg__title",
					children: [t("nav"), q(extraCount > 0 ? t("intro") + "\n" + t("extraPetsHint").replace("{n}", String(extraCount)) : t("intro"))]
				}),
				loadState !== "ready" ? h("div", {
					role: loadState === "error" ? "alert" : "status",
					className: "dsh-pet-jt-cfg__actions",
					children: [h("span", { children: t(loadState === "error" ? "loadError" : "loading") }), loadState === "error" ? h("button", {
						type: "button",
						className: "dsh-pet-jt-cfg__btn",
						onClick: () => {
							setLoadState("loading");
							setLoadAttempt((attempt) => attempt + 1);
						},
						children: t("retry")
					}) : null]
				}) : null,
				h("div", {
					className: "dsh-pet-jt-cfg__tabs",
					children: [
						h("span", {
							key: "label",
							className: "dsh-pet-jt-cfg__tabsLabel",
							children: t("petsLabel")
						}),
						...pets.map((p) => h("button", {
							key: p.id,
							type: "button",
							onClick: () => setSelId(p.id),
							className: "dsh-pet-jt-cfg__tab" + (p.id === selId ? " is-active" : ""),
							children: (p.name || p.id) + " (" + p.size + "px)"
						})),
						h("button", {
							key: "add",
							type: "button",
							onClick: addPet,
							disabled: busy,
							className: "dsh-pet-jt-cfg__tab is-ghost",
							children: "+ " + t("add")
						})
					]
				}),
				cur ? h("div", {
					className: "dsh-pet-jt-cfg__card",
					children: [
						h("div", {
							className: "dsh-pet-jt-cfg__cardHead",
							children: [
								h("span", {
									key: "t",
									className: "dsh-pet-jt-cfg__cardTitle",
									children: t("petCardTitle")
								}),
								q(t("petCardHint")),
								h("div", {
									key: "acts",
									style: {
										marginLeft: "auto",
										display: "flex",
										alignItems: "center",
										gap: "6px"
									},
									children: [
										msg.text ? h("span", {
											key: "msg",
											className: "dsh-pet-jt-cfg__msg" + (msg.kind === "err" ? " is-err" : ""),
											children: msg.text
										}) : null,
										h("button", {
											key: "sv",
											type: "button",
											onClick: () => void save(),
											disabled: busy,
											className: "dsh-pet-jt-cfg__btn is-primary is-sm",
											...tip(t("saveHotkey")),
											children: t("save")
										}),
										h("button", {
											key: "rm",
											type: "button",
											onClick: removeSel,
											disabled: busy,
											className: "dsh-pet-jt-cfg__btn is-danger is-sm",
											children: t("remove")
										})
									]
								})
							]
						}),
						h("div", {
							className: "dsh-pet-jt-cfg__grid3",
							children: [
								field(t("nameLabel"), h("input", {
									type: "text",
									className: inputClass,
									value: String(cur.name ?? ""),
									disabled: busy,
									maxLength: 50,
									onChange: (e) => updateSel({ name: e.target.value })
								}), t("nameHint")),
								field(t("sizeLabel"), numInput("size", cur.size, (v) => updateSel({ size: v })), t("sizeHint")),
								field(t("displayLabel"), h("select", {
									className: inputClass,
									value: cur.display,
									disabled: busy,
									onChange: (e) => updateSel({ display: e.target.value }),
									children: PET_DISPLAYS.map((d) => h("option", {
										key: d,
										value: d,
										children: t("display." + d)
									}))
								}), t("displayHint"), true)
							]
						}),
						h("div", {
							className: "dsh-pet-jt-cfg__grid3",
							children: [
								field(t("cornerLabel"), h("select", {
									className: inputClass,
									value: cur.position.corner,
									disabled: busy,
									onChange: (e) => updateSel({ position: { corner: e.target.value } }),
									children: CORNERS.map((c) => h("option", {
										key: c,
										value: c,
										children: cornerLabel(c)
									}))
								}), t("cornerHint")),
								field(t("marginX"), numInput("marginX", cur.position.marginX, (v) => updateSel({ position: { marginX: v } })), t("marginXHint")),
								field(t("marginY"), numInput("marginY", cur.position.marginY, (v) => updateSel({ position: { marginY: v } })), t("marginYHint"), true)
							]
						}),
						h("div", {
							className: "dsh-pet-jt-cfg__grid4",
							children: [
								toggleCell("balanceEnabled", !!cur.balanceEnabled, busy, (v) => updateSel({ balanceEnabled: v })),
								toggleCell("whisperEnabled", !!cur.whisperEnabled, busy, (v) => updateSel({ whisperEnabled: v })),
								toggleCell("workStatusEnabled", !!cur.workStatusEnabled, busy, (v) => updateSel({ workStatusEnabled: v })),
								toggleCell("fixedEnabled", !!cur.fixedEnabled, busy, (v) => updateSel({ fixedEnabled: v }), true)
							]
						}),
						field(t("personaLabel"), h("div", {
							className: "dsh-pet-jt-cfg__persona",
							children: [h("textarea", {
								className: inputClass + " dsh-pet-jt-cfg__area",
								rows: 3,
								value: String(cur.whisperPrompt ?? ""),
								disabled: busy,
								placeholder: entryPrompt,
								onChange: (e) => updateSel({ whisperPrompt: e.target.value })
							}), h("span", {
								className: "dsh-pet-jt-cfg__count",
								children: t("personaCount").replace("{n}", String(String(cur.whisperPrompt ?? "").length))
							})]
						}), t("personaHint"))
					]
				}) : h("p", {
					className: "dsh-pet-jt-cfg__note",
					children: t("emptyPets")
				}),
				h("div", {
					className: "dsh-pet-jt-cfg__card",
					children: [cardHead(t("globalTitle"), t("globalHint")), h("div", {
						className: "dsh-pet-jt-cfg__grid4",
						children: [
							toggleCell("notifyToggle", notifyEnabled$1, busy, (v) => void toggleNotify(v)),
							toggleCell("whisperImageToggle", whisperImage, busy, setWhisperImage),
							toggleCell("chatImageToggle", chatImage, busy, setChatImage),
							toggleCell("confineToggle", confineScreen, busy, setConfineScreen, true)
						]
					})]
				}),
				h("div", {
					className: "dsh-pet-jt-cfg__card",
					children: [
						cardHead(t("fontTitle"), t("fontHint")),
						h("div", {
							className: "dsh-pet-jt-cfg__grid2",
							children: [field(t("fontFamilyLabel"), h("select", {
								className: inputClass,
								value: font.family,
								disabled: busy,
								onChange: (e) => setFont((f) => ({
									...f,
									family: e.target.value
								})),
								children: FONT_PRESETS.map((p) => h("option", {
									key: p.id,
									value: p.id,
									children: t("font." + p.id)
								}))
							}), t("fontFamilyHint")), field(t("fontSizeLabel"), h("input", {
								type: "number",
								className: inputClass,
								step: "1",
								min: String(FONT_SIZE_MIN),
								max: String(FONT_SIZE_MAX),
								value: String(font.size),
								disabled: busy,
								onChange: (e) => setFont((f) => ({
									...f,
									size: Number(e.target.value)
								}))
							}), t("fontSizeHint"), true)]
						}),
						h("div", {
							className: "dsh-pet-jt-cfg__grid2",
							children: [toggleCell("fontFollowToggle", font.followPet, busy, (v) => setFont((f) => ({
								...f,
								followPet: v
							})))]
						})
					]
				}),
				h("div", {
					className: "dsh-pet-jt-cfg__card",
					children: [
						cardHead(t("modelTitle"), t("modelHint")),
						catalogErr ? h("p", {
							className: "dsh-pet-jt-cfg__note",
							style: { color: "var(--dsw-alias-state-error-primary)" },
							children: t("modelCatalogFailed")
						}) : null,
						h("div", {
							className: "dsh-pet-jt-cfg__grid2",
							children: [modelCell("whisperModel", whisperModel, setWhisperModel), modelCell("chatModel", chatModel, setChatModel, true)]
						}),
						h("div", {
							className: "dsh-pet-jt-cfg__grid4",
							children: [globalNumField("chatMemory", chatMemory, setChatMemory), globalNumField("chatImageLimit", chatImageLimit, setChatImageLimit)]
						})
					]
				}),
				h("div", {
					className: "dsh-pet-jt-cfg__card",
					children: [
						cardHead(t("physicsTitle"), t("physicsHint")),
						h("div", {
							className: "dsh-pet-jt-cfg__grid4",
							children: [
								physField("gravity", "50", "0"),
								physField("restitution", "0.01", "0"),
								physField("groundFriction", "0.1", "0"),
								physField("throwPower", "0.05", "0.05", true)
							]
						}),
						h("div", {
							className: "dsh-pet-jt-cfg__grid2",
							children: [toggleCell("physicsCeilingBounce", physics.ceilingBounce, busy, (v) => setPhysics((p) => ({
								...p,
								ceilingBounce: v
							}))), toggleCell("physicsPetCollision", physics.petCollision, busy, (v) => setPhysics((p) => ({
								...p,
								petCollision: v
							})), true)]
						})
					]
				}),
				...jtCards(),
				h("div", {
					className: "dsh-pet-jt-cfg__actions",
					children: [
						h("button", {
							type: "button",
							disabled: busy,
							onClick: () => void save(),
							className: "dsh-pet-jt-cfg__btn is-primary",
							...tip(t("saveHotkey")),
							children: t("save")
						}),
						h("button", {
							type: "button",
							disabled: busy,
							onClick: sync,
							className: "dsh-pet-jt-cfg__btn",
							children: t("sync")
						}),
						h("button", {
							type: "button",
							onClick: () => void testNotification(),
							className: "dsh-pet-jt-cfg__btn",
							children: t("notifyTest")
						}),
						q(t("syncHint")),
						msg.text ? h("span", {
							className: "dsh-pet-jt-cfg__msg" + (msg.kind === "err" ? " is-err" : ""),
							children: msg.text
						}) : null,
						permMsg.text ? h("span", {
							className: "dsh-pet-jt-cfg__msg" + (permMsg.kind === "err" ? " is-err" : ""),
							children: permMsg.text
						}) : null
					]
				}),
				paths ? h("div", {
					className: "dsh-pet-jt-cfg__card",
					children: [
						cardHead(t("configMeta"), t("configMetaHint")),
						h("div", {
							className: "dsh-pet-jt-cfg__path",
							children: t("defaultConfig") + "：" + paths.default
						}),
						h("div", {
							className: "dsh-pet-jt-cfg__path",
							children: t("userConfig") + "：" + paths.user
						}),
						h("div", {
							className: "dsh-pet-jt-cfg__path",
							children: t("animationDir") + "：" + paths.animations
						}),
						paths.memes ? h("div", {
							className: "dsh-pet-jt-cfg__path",
							children: t("memesDir") + "：" + paths.memes
						}) : null
					]
				}) : null,
				paths && paths.storage && paths.storage.length > 0 ? h("div", {
					className: "dsh-pet-jt-cfg__card",
					children: [
						cardHead(t("storageTitle"), t("storageHint")),
						...paths.storage.map((s) => h("div", {
							key: s.key,
							className: "dsh-pet-jt-cfg__path",
							children: [h("b", {
								key: "p",
								style: { fontFamily: MONO },
								children: s.path
							}), h("span", {
								key: "d",
								children: " — " + t("storage." + s.key) + (s.exists === false ? t("storageMissing") : "")
							})]
						})),
						h("div", {
							key: "ut",
							className: "dsh-pet-jt-cfg__cardTitle",
							style: { marginTop: "4px" },
							children: t("uninstallTitle")
						}),
						h("div", {
							key: "u1",
							className: "dsh-pet-jt-cfg__note",
							children: t("uninstallStep1")
						}),
						h("div", {
							key: "u2",
							className: "dsh-pet-jt-cfg__note",
							children: t("uninstallStep2")
						}),
						h("div", {
							key: "cmd",
							className: "dsh-pet-jt-cfg__cmd",
							children: t("uninstallCmd").replace("{profile}", paths.profile || "<profile>")
						}),
						h("div", {
							key: "u3",
							className: "dsh-pet-jt-cfg__note",
							children: t("uninstallStep3")
						})
					]
				}) : null,
				dialog ? h("div", {
					style: {
						position: "fixed",
						inset: 0,
						zIndex: 2147483647,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "rgba(0, 0, 0, 0.45)"
					},
					onClick: () => setDialog(null),
					children: h("div", {
						style: {
							width: "340px",
							maxWidth: "calc(100vw - 40px)",
							background: "var(--dsw-alias-bg-layer-1)",
							border: "1px solid var(--dsw-alias-border-l2)",
							borderRadius: "12px",
							padding: "16px 18px",
							boxShadow: "0 8px 30px rgba(0, 0, 0, 0.35)",
							display: "flex",
							flexDirection: "column",
							gap: "12px"
						},
						onClick: (e) => e.stopPropagation(),
						children: [
							h("div", {
								style: {
									fontSize: "14px",
									fontWeight: 500,
									color: "var(--dsw-alias-label-primary)"
								},
								children: dialog.kind === "corrupt" ? t("corruptTitle") : t("confirmTitle")
							}),
							h("div", {
								style: {
									fontSize: "13px",
									lineHeight: "20px",
									color: "var(--dsw-alias-label-secondary)"
								},
								children: dialog.kind === "remove" ? t("confirmRemove").replace("{id}", selId) : dialog.kind === "lastOne" ? t("atLeastOne") : dialog.kind === "corrupt" ? t("corruptBody").replace("{path}", dialog.path) : t("confirmSync")
							}),
							h("div", {
								style: {
									display: "flex",
									gap: "8px",
									justifyContent: "flex-end"
								},
								children: dialog.kind === "lastOne" ? [h("button", {
									key: "ok",
									type: "button",
									onClick: () => setDialog(null),
									className: "dsh-pet-jt-cfg__btn is-primary",
									children: t("ok")
								})] : [h("button", {
									key: "cancel",
									type: "button",
									onClick: () => setDialog(null),
									className: "dsh-pet-jt-cfg__btn",
									children: t("cancel")
								}), h("button", {
									key: "confirm",
									type: "button",
									onClick: () => {
										const d = dialog;
										setDialog(null);
										if (d.kind === "remove") doRemove();
										else if (d.kind === "corrupt") save(true);
										else doSync();
									},
									className: "dsh-pet-jt-cfg__btn " + (dialog.kind === "sync" ? "is-primary" : "is-danger"),
									children: dialog.kind === "remove" ? t("remove") : dialog.kind === "corrupt" ? t("corruptConfirm") : t("sync")
								})]
							})
						]
					})
				}) : null
			]
		});
	};
}

//#endregion
//#region src/client/pet.ts
/** 本次会话已定论的动画扩展名（null = 尚未判断）。模块级：一次判断，整页复用。 */
let resolvedExt = null;
/** 是否该先要 mov：只有 macOS 上的 WebKit（Safari / WKWebView）需要 HEVC-with-Alpha。
*  **不能用 canPlayType 判断**——Safari 能播 VP9 webm 却会丢弃 alpha（表现为黑底），
*  「能解码」与「透明还在」是两件事，后者没有任何 Web API 可查询。 */
const prefersMov = () => {
	const ua = navigator.userAgent;
	if (/Chrome|Chromium|Edg|OPR|Firefox|FxiOS/i.test(ua)) return false;
	return /Mac/i.test(navigator.platform || ua);
};
/** 解析本次要用的扩展名：显式常量（用户按 README 改成 .mov）优先，否则按渲染端判断。
*  宿主侧对缺失的 .mov 会退回同名 .webm（src/host/index.ts 的 thumb 分支），
*  所以这里只管「要哪一种」，无需探测素材是否真的存在。 */
const thumbExt = () => {
	if (resolvedExt === null) {
		const explicit = ANIMATION_EXT;
		resolvedExt = explicit === ".mov" || prefersMov() ? ".mov" : ".webm";
	}
	return resolvedExt;
};
/** 余额气泡展示时长（ms）：定时自动消失，与动画生命周期解耦 */
const BUBBLE_DURATION_MS = 10 * 1e3;
/** /state 长轮询的挂起时长（ms）：宿主在"版本没变"时最多挂这么久。
*  1s 是**前端自己定的下限**——空闲时请求率因此与改造前完全一致（1 req/s），
*  而叶子一变宿主立刻返回，前端不必再等满一拍。 */
const STATE_WAIT_MS = 1e3;
/** 老宿主 / 请求失败时的轮询间隔（ms）。老宿主不认识 since/timeout，会**立刻**返回全量，
*  不退避就是忙等；网络失败同理。 */
const STATE_FALLBACK_MS = 1e3;
/** 内联 CSS —— 注入一次（官方插件标准做法） */
const css = [
	".dsh-pet-jt-root{position:fixed;z-index:40;pointer-events:none;user-select:none}",
	".dsh-pet-jt-root[data-corner=\"bottom-right\"]{right:var(--dsh-pet-jt-mx,24px);bottom:var(--dsh-pet-jt-my,0)}",
	".dsh-pet-jt-root[data-corner=\"bottom-left\"]{left:var(--dsh-pet-jt-mx,24px);bottom:var(--dsh-pet-jt-my,0)}",
	".dsh-pet-jt-root[data-corner=\"top-right\"]{right:var(--dsh-pet-jt-mx,24px);top:var(--dsh-pet-jt-my,0)}",
	".dsh-pet-jt-root[data-corner=\"top-left\"]{left:var(--dsh-pet-jt-mx,24px);top:var(--dsh-pet-jt-my,0)}",
	".dsh-pet-jt-stage{position:relative;width:var(--dsh-pet-jt-size,462px);height:calc(var(--dsh-pet-jt-size,462px)*9/16);pointer-events:none}",
	".dsh-pet-jt-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity .18s ease;transform-origin:center}",
	".dsh-pet-jt-video.is-front{opacity:1}",
	".dsh-pet-jt-hit{position:absolute;pointer-events:auto;cursor:url(\"/dsh-pet-jt-7340/pic/cursor-grab.png\") 16 16, grab;z-index:1;touch-action:none;-webkit-user-select:none;-webkit-touch-callout:none}",
	".dsh-pet-jt-hit.dragging{cursor:url(\"/dsh-pet-jt-7340/pic/cursor-grabbing.png\") 16 16, grabbing}",
	"@media (prefers-reduced-motion: reduce){.dsh-pet-jt-video{transition:none}}",
	MENU_CSS,
	TOOLTIP_CSS
].join("\n");
const cssTag = "dsh-pet-jt/style.css";
function injectCss$1() {
	if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + cssTag + "\"]") === null) {
		const tag = document.createElement("style");
		tag.dataset.plugin = "dsh-pet-jt";
		tag.dataset.pluginCss = cssTag;
		tag.textContent = css;
		document.head.appendChild(tag);
	}
}
/**
* 制造宠物页面组件（工厂，与 makePetConfigSection 同理：react 由运行时注入）。
* @param rt 运行时注入的 react 能力（h=jsx / useState / useEffect / useRef）
* @returns PetMulti 多开容器组件（内部渲染多个 PetCard）
*/
function makePetUI(rt) {
	const { h, useState, useEffect, useRef } = rt;
	injectCss$1();
	/** 余额气泡（哑组件：数据与显隐由 PetCard 传入；展开态的两个 hook 由这里注入） */
	const BalanceBubble = makeBalanceBubble({
		h,
		useState,
		useEffect
	});
	/** 碎碎念气泡（哑组件：文本与显隐由 PetCard 传入） */
	const WhisperBubble = makeWhisperBubble({ h });
	/** 单个宠物实例（配置由容器 PetMulti 传入；碎碎念轮询/触发/气泡完全自理） */
	function PetCard({ cfg, balance, balanceTick, balanceNoticeTick, balanceManual, workStatus, workStatusTick, say, sayTick, animCue, animCueTick, posCue, posCueTick, throwCue, throwCueTick, lock, lockTick, menuItemsRef, arena, hidden }) {
		const [size, setSize] = useState(cfg.size);
		const fontPx = resolveFontPx(cfg.font, size);
		const halfW = size / 2;
		const halfH = size * 9 / 16 / 2;
		const bottomPad = size * (9 / 16) * (CANVAS_H - FEET_Y) / CANVAS_H;
		const petAnims = cfg.animations;
		const petWeights = cfg.animationWeights;
		const [anim, setAnim] = useState(petAnims.idle[0] ?? "");
		const [once, setOnce] = useState(true);
		const [facing, setFacing] = useState("left");
		const [dragging, setDragging] = useState(false);
		const [tipOn, setTipOn] = useState(false);
		const tipRef = useRef(null);
		const [customPos, setCustomPos] = useState(null);
		const [corner, setCorner] = useState(cfg.position.corner);
		const [margin, setMargin] = useState({
			x: cfg.position.marginX,
			y: cfg.position.marginY
		});
		const [bubbleOn, setBubbleOn] = useState(false);
		const [balanceExpanded, setBalanceExpanded] = useState(false);
		const bubbleTimerRef = useRef(null);
		const [whisperBubbleOn, setWhisperBubbleOn] = useState(false);
		const whisperBubbleTimerRef = useRef(null);
		const [whisperText, setWhisperText] = useState(null);
		const [whisperImage, setWhisperImage] = useState(void 0);
		/** 配图的 url 形态（第三方自带地址；与 whisperImage 二选一，见 triggerWhisper） */
		const [whisperUrl, setWhisperUrl] = useState(void 0);
		const [workBubbleOn, setWorkBubbleOn] = useState(false);
		const workBubbleTimerRef = useRef(null);
		const [workText, setWorkText] = useState(null);
		const menuRef = useRef(null);
		const chatRef = useRef(null);
		useEffect(() => {
			setSize(cfg.size);
			setCorner(cfg.position.corner);
			setMargin({
				x: cfg.position.marginX,
				y: cfg.position.marginY
			});
		}, [
			cfg.size,
			cfg.position.corner,
			cfg.position.marginX,
			cfg.position.marginY
		]);
		const [seq, setSeq] = useState(0);
		const rootRef = useRef(null);
		const stageRef = useRef(null);
		const videoARef = useRef(null);
		const videoBRef = useRef(null);
		const frontRef = useRef(0);
		const pendingRef = useRef(null);
		/** 「这一段直接播这个地址」的一次性交接位（POST /anim 的 url 形态，issue #122 第 1 条）。
		*  为什么用 ref 而不是 state：它只在**设置它的那一拍**有效——switchTo 一进来就取走并清空，
		*  之后任何一次普通换源都不会误用上一个地址（换成 state 的话，"清空"本身会再触发一次 effect）。 */
		const cueUrlRef = useRef(null);
		const [cuePlayback, setCuePlayback] = useState(null);
		/** 当前正在播的第三方点播编号（null = 自播动画，不上报）；播完 / 失败 / 被打断后清空 */
		const playingPlaybackRef = useRef(null);
		const genRef = useRef(0);
		const frozenRef = useRef(lock?.locked === true && lock.expiresAt > Date.now());
		/** 解冻定时器：宿主不会到点推送"锁没了"，这里按叶子里的 expiresAt 自己解除 */
		const lockTimerRef = useRef(null);
		const dragRef = useRef({
			active: false,
			dragging: false,
			sx: 0,
			sy: 0,
			offX: 0,
			offY: 0,
			lpTimer: null,
			sling: false,
			anchorX: 0,
			anchorY: 0
		});
		const justDraggedRef = useRef(false);
		const dragTrailRef = useRef([]);
		const boxPxRef = useRef(null);
		const dragTargetRef = useRef(null);
		const dragVelRef = useRef({
			vx: 0,
			vy: 0
		});
		const dragFollowRef = useRef(null);
		const dragFollowTokenRef = useRef(0);
		const throwRef = useRef(null);
		const throwTokenRef = useRef(0);
		const throwStateRef = useRef(null);
		const pressScoreFiredRef = useRef(false);
		const lastPressAtRef = useRef(0);
		const squashRef = useRef(null);
		const squashTokenRef = useRef(0);
		const pendingSquashRef = useRef(false);
		const animRef = useRef(anim);
		animRef.current = anim;
		const workStatusRef = useRef(workStatus);
		workStatusRef.current = workStatus;
		const blobUrlRef = useRef({
			a: null,
			b: null
		});
		const mountedRef = useRef(false);
		const inflightRef = useRef([]);
		/**
		* 播放回执上报（issue #122 第 3 项）：把这一段点播的**真实**状态告诉 host。
		*
		* 只对第三方点播（带 playbackId）上报；自播动画（随机链 / 点击 / 拖拽 / 碎碎念 / 余额…）不报。
		* 为什么必须有这一层：host 只知道"受理了"，不知道播没播完——动画在浏览器里播，只有这里知道真相。
		* 失败静默（postAction 从不抛）+ 一条 warn：回执是附加能力，绝不能因为它把播放本身搞挂。
		*/
		const reportPlayback = (playbackId, status, reason) => {
			postAction("/dsh-pet-jt-7340/playback/" + encodeURIComponent(playbackId) + "/report", reason === void 0 ? { status } : {
				status,
				reason
			}).then((ok) => {
				if (!ok) console.warn("[dsh-pet-jt] 播放回执未送达 pet=" + cfg.id + " id=" + playbackId + " status=" + status);
			});
		};
		const switchTo = (next, nextOnce, cuePlaybackId) => {
			if (cuePlaybackId !== null) setCuePlayback(null);
			const cueUrl = cueUrlRef.current;
			cueUrlRef.current = null;
			if (!next) return;
			const pending = pendingRef.current;
			if (pending && pending.anim === next && pending.once === nextOnce) {
				if (pendingSquashRef.current) {
					pendingSquashRef.current = false;
					const front = frontRef.current === 0 ? videoARef : videoBRef;
					if (front.current) startSquash(front.current);
				}
				if (cuePlaybackId !== null) {
					playingPlaybackRef.current = cuePlaybackId;
					reportPlayback(cuePlaybackId, "playing");
				}
				return;
			}
			const gen = ++genRef.current;
			pendingRef.current = {
				anim: next,
				once: nextOnce,
				gen
			};
			const target = frontRef.current === 0 ? videoBRef : videoARef;
			const el = target.current;
			if (!el) return;
			const inEvents = isEventAnim(petAnims.events, next);
			if (inEvents) console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " switch " + next + " once=" + nextOnce);
			const assetUrl = cueUrl ?? "/dsh-pet-jt-7340/thumb/" + encodeURIComponent(cfg.assetRoot ?? cfg.id) + "/" + encodeURIComponent(next) + thumbExt();
			el.loop = !nextOnce;
			el.muted = true;
			el.autoplay = true;
			el.playsInline = true;
			el.onended = nextOnce ? handleEnded : null;
			el.onerror = cuePlaybackId === null ? null : () => reportPlayback(cuePlaybackId, "failed", "decode-error");
			const targetIsB = frontRef.current === 0;
			const ac = new AbortController();
			inflightRef.current.push(ac);
			const fetchTimer = window.setTimeout(() => ac.abort(), 1e4);
			fetch(assetUrl, {
				cache: "default",
				signal: ac.signal
			}).then((r) => {
				if (!r.ok) throw new Error("asset HTTP " + r.status);
				return r.blob();
			}).then((blob) => {
				window.clearTimeout(fetchTimer);
				const ix = inflightRef.current.indexOf(ac);
				if (ix !== -1) inflightRef.current.splice(ix, 1);
				if (!mountedRef.current) return;
				if (pendingRef.current?.gen !== gen) return;
				const slot = targetIsB ? "b" : "a";
				const oldUrl = blobUrlRef.current[slot];
				if (oldUrl) URL.revokeObjectURL(oldUrl);
				const obj = URL.createObjectURL(blob);
				blobUrlRef.current[slot] = obj;
				el.src = obj;
				el.load();
			}).catch((err) => {
				window.clearTimeout(fetchTimer);
				const ix = inflightRef.current.indexOf(ac);
				if (ix !== -1) inflightRef.current.splice(ix, 1);
				if (!mountedRef.current) return;
				if (pendingRef.current?.gen !== gen) return;
				pendingRef.current = null;
				if (cuePlaybackId !== null) {
					if (playingPlaybackRef.current === cuePlaybackId) playingPlaybackRef.current = null;
					reportPlayback(cuePlaybackId, "failed", "asset-load");
				}
				console.warn("[dsh-pet-jt] 素材加载失败 pet=" + cfg.id + " anim=" + next + "：" + (err instanceof Error ? err.message : String(err)) + "（已释放本次切换）");
			});
			const onReady = () => {
				el.removeEventListener("loadeddata", onReady);
				if (pendingRef.current?.gen !== gen) return;
				const old = frontRef.current === 0 ? videoARef : videoBRef;
				el.classList.add("is-front");
				if (old.current && old.current !== el) {
					old.current.classList.remove("is-front");
					old.current.onended = null;
					old.current.onerror = null;
					old.current.pause();
					const outgoing = playingPlaybackRef.current;
					if (outgoing !== null && outgoing !== cuePlaybackId) reportPlayback(outgoing, "cancelled", "superseded");
				}
				frontRef.current = frontRef.current === 0 ? 1 : 0;
				pendingRef.current = null;
				playingPlaybackRef.current = cuePlaybackId;
				el.style.transform = facingRef.current === "right" ? "scaleX(-1)" : "";
				el.play().then(() => {
					if (cuePlaybackId !== null) reportPlayback(cuePlaybackId, "playing");
				}).catch(() => {
					if (cuePlaybackId === null) return;
					if (playingPlaybackRef.current === cuePlaybackId) playingPlaybackRef.current = null;
					reportPlayback(cuePlaybackId, "failed", "play-rejected");
				});
				if (pendingSquashRef.current) {
					pendingSquashRef.current = false;
					startSquash(el);
				}
				if (pendingMoveRef.current) startMoveDrive(el);
			};
			el.addEventListener("loadeddata", onReady);
		};
		useEffect(() => {
			switchTo(anim, once, cuePlayback);
		}, [
			anim,
			once,
			seq,
			cuePlayback
		]);
		useEffect(() => {
			mountedRef.current = true;
			const unregisterPose = registerPose(cfg.id, () => ({
				x: currentCenterX() / window.innerWidth,
				y: currentCenterY() / window.innerHeight,
				facing: facingRef.current
			}));
			const unregisterProgress = registerProgress(cfg.id, () => {
				const el = frontRef.current === 0 ? videoARef.current : videoBRef.current;
				const playbackId = playingPlaybackRef.current;
				const anim$1 = animRef.current;
				if (el === null) return {
					playbackId,
					anim: anim$1,
					currentTime: 0,
					duration: 0,
					paused: true,
					buffering: false
				};
				const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
				return {
					playbackId,
					anim: anim$1,
					currentTime: el.currentTime,
					duration,
					paused: el.paused,
					buffering: el.readyState < 3 || el.seeking
				};
			});
			const bu = blobUrlRef.current;
			const inflight = inflightRef.current;
			return () => {
				mountedRef.current = false;
				unregisterPose();
				unregisterProgress();
				for (const c of inflight) c.abort();
				inflight.length = 0;
				stopMove();
				stopDragFollow();
				stopThrow();
				stopSquash();
				if (bu.a) URL.revokeObjectURL(bu.a);
				if (bu.b) URL.revokeObjectURL(bu.b);
			};
		}, []);
		useEffect(() => () => {
			if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
			if (whisperBubbleTimerRef.current !== null) window.clearTimeout(whisperBubbleTimerRef.current);
		}, []);
		useEffect(() => () => {
			if (menuRef.current) {
				menuRef.current.close();
				menuRef.current = null;
			}
			if (chatRef.current) {
				chatRef.current.close();
				chatRef.current = null;
			}
		}, []);
		const prevTickRef = useRef(0);
		useEffect(() => {
			if (balanceTick === 0 || balanceTick === prevTickRef.current) return;
			prevTickRef.current = balanceTick;
			if (frozenRef.current && !balanceManual) return;
			if (!balance || !balance.ok) return;
			if (!cfg.balanceEnabled && !balanceManual) return;
			const p = balancePercent(balance);
			if (balanceManual || p !== void 0) {
				setBalanceExpanded(false);
				setBubbleOn(true);
				if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
				bubbleTimerRef.current = window.setTimeout(() => setBubbleOn(false), BUBBLE_DURATION_MS);
			}
			if (!cfg.balanceEnabled) return;
			if (p === void 0) return;
			const pool = petAnims.events?.balance;
			if (!pool || pool.length === 0) {
				console.error("[dsh-pet-jt] 配置缺少 animations.events.balance，无法播放余额事件动画");
				return;
			}
			const idx = balanceEventIndex(p);
			const slot = pool[idx];
			if (!slot) {
				console.error("[dsh-pet-jt] balance 档位索引越界：p=" + p + " idx=" + idx);
				return;
			}
			const name = pickSlot(slot, animRef.current);
			console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " balance pet=" + cfg.id + " p=" + p.toFixed(1) + "% -> [档" + idx + "] " + name);
			stopMove();
			setOnce(true);
			setAnim(name);
		}, [balanceTick]);
		const prevNoticeRef = useRef(0);
		useEffect(() => {
			if (!cfg.balanceEnabled && !balanceManual) return;
			if (balanceNoticeTick === 0 || balanceNoticeTick === prevNoticeRef.current) return;
			prevNoticeRef.current = balanceNoticeTick;
			if (frozenRef.current && !balanceManual) return;
			if (!balance || balance.ok) return;
			setBubbleOn(true);
			if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
			bubbleTimerRef.current = window.setTimeout(() => setBubbleOn(false), BUBBLE_DURATION_MS);
		}, [balanceNoticeTick]);
		const prevWorkTickRef = useRef(0);
		const prevWorkStateRef = useRef(void 0);
		useEffect(() => {
			if (!cfg.workStatusEnabled) return;
			if (workStatusTick === 0 || workStatusTick === prevWorkTickRef.current) return;
			prevWorkTickRef.current = workStatusTick;
			if (frozenRef.current) return;
			if (!workStatus || workStatus.state === null) {
				console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " " + (prevWorkStateRef.current ?? "null") + "->null    播完即停（回待机，收起气泡）");
				prevWorkStateRef.current = null;
				if (poolIncludes(petAnims.events?.workStatus ?? [], animRef.current)) {
					const front = frontRef.current === 0 ? videoARef.current : videoBRef.current;
					if (front) {
						front.loop = false;
						front.onended = handleEnded;
					}
				}
				if (workBubbleTimerRef.current !== null) window.clearTimeout(workBubbleTimerRef.current);
				workBubbleTimerRef.current = null;
				setWorkText(null);
				setWorkBubbleOn(false);
				return;
			}
			const pool = petAnims.events?.workStatus;
			if (!pool || pool.length === 0) {
				console.error("[dsh-pet-jt] 配置缺少 animations.events.workStatus，无法播放工作状态动画");
				return;
			}
			const idx = WORK_STATUS_INDEX[workStatus.state];
			const slot = pool[idx];
			if (slot === void 0) {
				console.error("[dsh-pet-jt] work-status 档位索引越界：state=" + workStatus.state + " idx=" + idx);
				return;
			}
			const name = pickSlot(slot, animRef.current);
			console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " " + (prevWorkStateRef.current ?? "null") + "->" + workStatus.state + "    " + name);
			const stateChanged = prevWorkStateRef.current !== workStatus.state;
			prevWorkStateRef.current = workStatus.state;
			stopMove();
			const textGroup = Array.isArray(cfg.workStatusTexts) ? cfg.workStatusTexts[idx] : void 0;
			const configuredText = Array.isArray(textGroup) && textGroup.length > 0 ? textGroup[Math.floor(Math.random() * textGroup.length)] : void 0;
			setWorkText(workStatus.task ?? configuredText ?? null);
			const terminal = workStatus.state === "success" || workStatus.state === "error";
			if (stateChanged) {
				setWorkBubbleOn(true);
				if (workBubbleTimerRef.current !== null) window.clearTimeout(workBubbleTimerRef.current);
				workBubbleTimerRef.current = terminal ? window.setTimeout(() => setWorkBubbleOn(false), BUBBLE_DURATION_MS) : null;
			}
			const rotating = !terminal && Array.isArray(slot) && slot.length > 1;
			setOnce(terminal || rotating);
			setAnim(name);
		}, [workStatusTick]);
		const prevSaySeqRef = useRef(0);
		useEffect(() => {
			if (!say || say.seq === prevSaySeqRef.current) return;
			prevSaySeqRef.current = say.seq;
			if (say.kind === "clear") {
				clearWhisperBubble();
				return;
			}
			triggerWhisper(say.text, say.image, say.url, say.duration, say.anim);
		}, [sayTick]);
		const prevAnimSeqRef = useRef(0);
		useEffect(() => {
			if (!animCue || animCue.seq === prevAnimSeqRef.current) return;
			prevAnimSeqRef.current = animCue.seq;
			const explicitFacing = animCue.facing !== void 0;
			if (animCue.facing !== void 0) {
				setFacing(animCue.facing);
				facingRef.current = animCue.facing;
			}
			if (animCue.url !== void 0) {
				stopMove();
				cueUrlRef.current = animCue.url;
				setOnce(true);
				setSeq((s) => s + 1);
				setAnim(animCue.url);
				setCuePlayback(animCue.playbackId ?? null);
				return;
			}
			if (animCue.name === void 0) return;
			handleMenuAction({
				label: animCue.name,
				anim: animCue.name
			}, animCue.playbackId, explicitFacing);
		}, [animCueTick]);
		const prevPosSeqRef = useRef(0);
		useEffect(() => {
			if (!posCue || posCue.seq === prevPosSeqRef.current) return;
			prevPosSeqRef.current = posCue.seq;
			applyPositionCue(posCue.x, posCue.y, posCue.mode, posCue.duration);
		}, [posCueTick]);
		const prevThrowSeqRef = useRef(0);
		useEffect(() => {
			if (!throwCue || throwCue.seq === prevThrowSeqRef.current) return;
			prevThrowSeqRef.current = throwCue.seq;
			applyThrowCue(throwCue.angle, throwCue.power);
		}, [throwCueTick]);
		/** 收起说话气泡（`POST /bubble/clear` 的落点）。
		*  **只动气泡**：正在播的动画、余额气泡、工作状态气泡都不碰——气泡与动作是两把锁、
		*  分别释放（issue #122 第 5 条）。顺带清掉文本/配图，免得残留内容在下次渲染时闪一下。 */
		const clearWhisperBubble = () => {
			if (whisperBubbleTimerRef.current !== null) window.clearTimeout(whisperBubbleTimerRef.current);
			whisperBubbleTimerRef.current = null;
			setWhisperBubbleOn(false);
			setWhisperText(null);
			setWhisperImage(void 0);
		};
		const triggerWhisper = (text, image, url, duration, anim$1) => {
			let name = null;
			if (anim$1 !== false) {
				const pool = petAnims.events?.whisper;
				if (!pool || pool.length === 0) {
					console.error("[dsh-pet-jt] 配置缺少 animations.events.whisper，无法播放碎碎念动画");
					return;
				}
				name = pickSlot(pick(pool, animRef.current), animRef.current);
			}
			console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " whisper pet=" + cfg.id + (name === null ? " （不联动动画）" : " -> [" + name + "]") + " 「" + text + "」");
			if (name !== null) {
				stopMove();
				setOnce(true);
				setAnim(name);
			}
			if (duration === 0) return;
			setWhisperText(text);
			setWhisperImage(image);
			setWhisperUrl(url);
			setWhisperBubbleOn(true);
			if (whisperBubbleTimerRef.current !== null) window.clearTimeout(whisperBubbleTimerRef.current);
			whisperBubbleTimerRef.current = window.setTimeout(() => setWhisperBubbleOn(false), duration ?? BUBBLE_DURATION_MS);
		};
		useEffect(() => {
			const onResize = () => setCustomPos((prev) => prev ? { ...prev } : prev);
			window.addEventListener("resize", onResize);
			return () => window.removeEventListener("resize", onResize);
		}, []);
		const pickNext = () => {
			if (frozenRef.current) return;
			const animations = petAnims;
			const animationWeights = petWeights;
			const roll = Math.random();
			const k = rollKind(roll, animationWeights, { fixed: cfg.fixedEnabled });
			let kind;
			let next;
			if (k === "idle") {
				kind = "IDLE";
				next = pick(animations.idle, animRef.current);
				setAnim(next);
			} else if (k === "turn") {
				kind = "TURN";
				next = pick(animations.turn, animRef.current);
				setAnim(next);
			} else if (k === "move") {
				const moved = tryMove();
				if (moved === false) {
					const act = pickCategoryAction(animations.categories, animations.idle, facingRef.current, animRef.current);
					kind = act.id;
					next = act.name;
					setAnim(next);
				} else {
					kind = "MOVES";
					next = typeof moved === "string" ? moved : "移动进行中(不重播)";
				}
			} else {
				const act = pickCategoryAction(animations.categories, animations.idle, facingRef.current, animRef.current);
				kind = act.id;
				next = act.name;
				setAnim(next);
			}
			console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " facing=" + facingRef.current + " roll=" + roll.toFixed(4) + " -> [" + kind + "] " + next);
			setOnce(true);
			setSeq((s) => s + 1);
		};
		const resumeWorkStatusAnim = () => {
			if (frozenRef.current) return false;
			const ws = workStatusRef.current;
			if (!ws || !ws.state || ws.state === "success" || ws.state === "error") return false;
			const pool = petAnims.events?.workStatus;
			if (!pool || pool.length === 0) return false;
			const idx = WORK_STATUS_INDEX[ws.state];
			const slot = pool[idx];
			if (slot === void 0) return false;
			const name = pickSlot(slot, animRef.current);
			console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " 互动结束恢复状态动画: " + name);
			setOnce(Array.isArray(slot) && slot.length > 1);
			setAnim(name);
			return true;
		};
		const handleEnded = (e) => {
			const evEl = e && e.currentTarget;
			if (evEl && !evEl.classList.contains("is-front")) return;
			const donePlayback = playingPlaybackRef.current;
			if (donePlayback !== null) {
				playingPlaybackRef.current = null;
				reportPlayback(donePlayback, "ended");
			}
			const animations = petAnims;
			if (dragRef.current.active) return;
			if (frozenRef.current) return;
			const isEvent = isEventAnim(animations.events, animRef.current);
			const wsNow = workStatusRef.current;
			if (isEvent && wsNow && wsNow.state && wsNow.state !== "success" && wsNow.state !== "error") {
				const nextWork = nextWorkStatusAnim(animations.events?.workStatus ?? [], animRef.current);
				if (nextWork !== null) {
					console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " workStatus 档内轮换: " + animRef.current + " -> " + nextWork);
					setOnce(true);
					setAnim(nextWork);
					setSeq((s) => s + 1);
					return;
				}
				if (poolIncludes(animations.events?.workStatus ?? [], animRef.current)) {
					console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " workStatus 循环续播: " + animRef.current);
					setOnce(false);
					setSeq((s) => s + 1);
					return;
				}
			}
			if (isEvent) {
				console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " 事件动画播完 ended anim=" + animRef.current + " ws=" + (workStatusRef.current && workStatusRef.current.state || "null"));
				if (resumeWorkStatusAnim()) return;
				if (animations.idle.length) setAnim(pick(animations.idle, animRef.current));
				setOnce(true);
				setSeq((s) => s + 1);
				return;
			}
			if (animations.turn.includes(animRef.current)) {
				const next = facing === "left" ? "right" : "left";
				setFacing(next);
				facingRef.current = next;
			}
			if (animations.drag.includes(animRef.current) || animations.clicks.includes(animRef.current)) {
				if (resumeWorkStatusAnim()) return;
				if (animations.idle.length) setAnim(pick(animations.idle, animRef.current));
				setOnce(true);
				setSeq((s) => s + 1);
				return;
			}
			pickNext();
		};
		const moveRef = useRef(null);
		const moveTokenRef = useRef(0);
		const pendingMoveRef = useRef(null);
		const customPosRef = useRef(customPos);
		customPosRef.current = customPos;
		const currentCenterX = () => {
			const cp = customPosRef.current;
			if (cp) return cp.rx * window.innerWidth;
			const rootEl = rootRef.current;
			if (rootEl) return rootEl.getBoundingClientRect().left + halfW;
			return window.innerWidth - 24 - halfW;
		};
		const currentCenterY = () => {
			const cp = customPosRef.current;
			if (cp) return cp.ry * window.innerHeight;
			const rootEl = rootRef.current;
			if (rootEl) return rootEl.getBoundingClientRect().top + halfH;
			return window.innerHeight - 20 - halfH;
		};
		const startMoveDrive = (el) => {
			const pm = pendingMoveRef.current;
			if (!pm || moveRef.current !== null) return;
			pendingMoveRef.current = null;
			const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
			const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
			const travelWindow = Math.max(.1, duration - leadSec - tailSec);
			const token = ++moveTokenRef.current;
			const step = () => {
				if (moveTokenRef.current !== token) return;
				const t = el.currentTime || 0;
				const rootEl = rootRef.current;
				if (rootEl) {
					const W = window.innerWidth;
					const H = window.innerHeight;
					let ratioX;
					if (t <= leadSec) ratioX = startRatio;
					else if (t >= duration - tailSec) ratioX = targetRatio;
					else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
					const px = ratioX * W;
					const py = startYRatio * H;
					rootEl.style.left = px - halfW + "px";
					rootEl.style.top = py - halfH + "px";
					rootEl.style.right = "auto";
					rootEl.style.bottom = "auto";
				}
				if (t < duration - tailSec) moveRef.current = requestAnimationFrame(step);
				else {
					moveRef.current = null;
					setCustomPos({
						rx: targetRatio,
						ry: startYRatio
					});
				}
			};
			moveRef.current = requestAnimationFrame(step);
		};
		/** 尝试发起一次移动：占用中返回 true（不重播），无法移动返回 false，成功返回动作名（供日志显示具体动作）。
		*  preferredName 传入时固定使用该动画（右键菜单点播移动动画），否则与随机链一致随机从 moves.actions 选。 */
		const tryMove = (preferredName) => {
			if (moveRef.current !== null || pendingMoveRef.current || throwRef.current !== null) return true;
			const moves = petAnims.moves;
			const actions = moves.actions;
			if (!actions.length) return false;
			const chosen = preferredName ? actions.find((a) => a.name === preferredName) ?? null : actions[Math.floor(Math.random() * actions.length)];
			if (!chosen) return false;
			const mp = Object.assign({}, moves.default, chosen.params || {});
			const dir = facingRef.current === "right" ? 1 : -1;
			const W = window.innerWidth;
			const distScale = size / PET_REF_WIDTH;
			const plan = planMove({
				cx: currentCenterX(),
				cy: currentCenterY(),
				W,
				H: window.innerHeight,
				dir,
				minDist: mp.minDist * distScale,
				maxDist: mp.maxDist * distScale,
				margin: mp.margin,
				halfW,
				sideAllow
			});
			if (!plan) return false;
			pendingMoveRef.current = {
				...plan,
				dir,
				leadSec: mp.leadSec,
				tailSec: mp.tailSec
			};
			setOnce(true);
			setAnim(chosen.name);
			return chosen.name;
		};
		const stopMove = () => {
			pendingMoveRef.current = null;
			moveTokenRef.current++;
			if (moveRef.current !== null) {
				cancelAnimationFrame(moveRef.current);
				moveRef.current = null;
			}
			stopPosFollow();
		};
		/** 停止弹簧跟随（不碰 dragState：指针捕获期间由 pointerdown/up 独立管理） */
		const stopDragFollow = () => {
			dragFollowTokenRef.current++;
			if (dragFollowRef.current !== null) {
				cancelAnimationFrame(dragFollowRef.current);
				dragFollowRef.current = null;
			}
			dragTargetRef.current = null;
			dragVelRef.current = {
				vx: 0,
				vy: 0
			};
		};
		/** 停止抛掷（宠物在空中被抓住/点菜单/回家时立即定格在当前落点）。
		*  同时清速度状态 throwStateRef——否则「抓住后温柔放下」会残留最后一次飞行速度，
		*  静止的宠物点一下就误判为飞行中。点击积分用的飞行动态由 pointerdown 提前记录。 */
		const stopThrow = () => {
			throwTokenRef.current++;
			if (throwRef.current !== null) {
				cancelAnimationFrame(throwRef.current);
				throwRef.current = null;
			}
			throwStateRef.current = null;
		};
		/** rAF 弹簧跟随：包围盒朝拖拽目标（指针-抓取偏移）过阻尼追赶，抹平高频抖动 */
		const startDragFollow = (rootEl) => {
			if (dragFollowRef.current !== null) return;
			const token = ++dragFollowTokenRef.current;
			let last = performance.now();
			const step = () => {
				if (dragFollowTokenRef.current !== token) return;
				const target = dragTargetRef.current;
				if (!target) {
					dragFollowRef.current = null;
					return;
				}
				const now = performance.now();
				const dt = Math.min((now - last) / 1e3, 1 / 30);
				last = now;
				const vel = dragVelRef.current;
				let x = boxPxRef.current?.x ?? 0;
				let y = boxPxRef.current?.y ?? 0;
				vel.vx = springStep(vel.vx, x, target.x, dt, cfg.physics.throwPower);
				vel.vy = springStep(vel.vy, y, target.y, dt, cfg.physics.throwPower);
				x += vel.vx * dt;
				y += vel.vy * dt;
				boxPxRef.current = {
					x,
					y
				};
				rootEl.style.left = x + "px";
				rootEl.style.top = y + "px";
				rootEl.style.right = "auto";
				rootEl.style.bottom = "auto";
				dragFollowRef.current = requestAnimationFrame(step);
			};
			dragFollowRef.current = requestAnimationFrame(step);
		};
		/** 抛掷驱动：重力 + 边缘反弹 + 落地摩擦，落定后提交 customPos（飞行中只改 DOM，避免逐帧 React 重渲染） */
		const startThrow = (px, py, vx, vy) => {
			stopDragFollow();
			stopMove();
			const bounds = throwBounds({
				W: window.innerWidth,
				H: window.innerHeight,
				size,
				sideAllow
			});
			const token = ++throwTokenRef.current;
			let state = {
				x: px,
				y: py,
				vx,
				vy
			};
			let last = performance.now();
			let prevGrounded = false;
			const rootEl = rootRef.current;
			const step = () => {
				if (throwTokenRef.current !== token) return;
				const now = performance.now();
				const dt = (now - last) / 1e3;
				last = now;
				const fallingVy = state.vy;
				const substeps = throwSubsteps(state.vx, state.vy, dt);
				let res = throwStep(state, dt / substeps, bounds, cfg.physics);
				for (let i = 1; i < substeps && !res.atRest; i++) res = throwStep(res, dt / substeps, bounds, cfg.physics);
				state = {
					x: res.x,
					y: res.y,
					vx: res.vx,
					vy: res.vy
				};
				throwStateRef.current = state;
				if (cfg.physics.petCollision) {
					const myBody = bodyPixelBox({
						x: state.x,
						y: state.y,
						size,
						bottomPad
					});
					for (const slotId of Object.keys(arena.current.slots)) {
						if (slotId === cfg.id) continue;
						const slot = arena.current.slots[slotId];
						const otherBox = slot.getBox();
						if (!otherBox) continue;
						const otherBody = bodyPixelBox({
							x: otherBox.x,
							y: otherBox.y,
							size: slot.size,
							bottomPad: slot.bottomPad
						});
						if (!rectsOverlap(myBody, otherBody)) continue;
						const vel = slot.getVel();
						const hit = collidePet({
							x: state.x,
							y: state.y,
							vx: state.vx,
							vy: state.vy,
							size
						}, {
							x: otherBox.x,
							y: otherBox.y,
							vx: vel.vx,
							vy: vel.vy,
							size: slot.size
						});
						if (hit) {
							state.vx = hit.fvx;
							state.vy = hit.fvy;
							throwStateRef.current = state;
							slot.onHit(hit.hvx, hit.hvy);
							break;
						}
					}
				}
				if (rootEl) {
					rootEl.style.left = res.x + "px";
					rootEl.style.top = res.y + "px";
					rootEl.style.right = "auto";
					rootEl.style.bottom = "auto";
				}
				boxPxRef.current = {
					x: res.x,
					y: res.y
				};
				customPosRef.current = {
					rx: (res.x + halfW) / window.innerWidth,
					ry: (res.y + halfH) / window.innerHeight
				};
				const grounded = res.y >= bounds.maxY - 1;
				if (res.bounced && grounded && !prevGrounded) {
					const frontEl = frontRef.current === 0 ? videoARef.current : videoBRef.current;
					if (frontEl) startSquash(frontEl, landingSquash(fallingVy));
				}
				prevGrounded = grounded;
				if (res.atRest) {
					throwRef.current = null;
					throwStateRef.current = null;
					setCustomPos(customPosRef.current);
					return;
				}
				throwRef.current = requestAnimationFrame(step);
			};
			throwRef.current = requestAnimationFrame(step);
		};
		/** 被撞回调（宠物间碰撞）：被其它飞行中宠物撞到 → 停当前动作，从落点以新初速抛出去（全复用现有物理） */
		const startThrowLatestRef = useRef(() => {});
		startThrowLatestRef.current = startThrow;
		/** 位置指令的跟随 rAF（spring 与 line 共用同一个句柄）。与拖拽跟手分开：拖拽没有终点
		*  （指针一直喂目标），这条有终点，收敛/到点后必须自己收掉，否则 rAF 永远转下去。 */
		const posFollowRef = useRef(null);
		const posFollowTokenRef = useRef(0);
		const stopPosFollow = () => {
			posFollowTokenRef.current++;
			if (posFollowRef.current !== null) {
				cancelAnimationFrame(posFollowRef.current);
				posFollowRef.current = null;
			}
		};
		/**
		* 执行一条位置指令：把宠物**中心**挪到归一化坐标 (rx, ry)。
		* `mode` 三选一——`instant` 一帧到位并提交 customPos；`spring` 走拖拽那套过阻尼弹簧；
		* `line` 在 `duration` 毫秒里**直线**走完（`duration <= 0` 等同 instant）。
		* 用户正按着宠物（`active` 含点击与拖拽）时**整拍丢弃**——手指底下的东西不该跑；
		* 这与动画链的守卫同一语义（见 handleEnded）。丢弃是静默的：接口早已回过 ok。
		*/
		const applyPositionCue = (rx, ry, mode, duration) => {
			if (dragRef.current.active) return;
			stopThrow();
			stopMove();
			const px = rx * window.innerWidth - halfW;
			const py = ry * window.innerHeight - halfH;
			const rootEl = rootRef.current;
			if (!rootEl || mode === "instant" || mode === "line" && duration <= 0) {
				boxPxRef.current = {
					x: px,
					y: py
				};
				setCustomPos({
					rx,
					ry
				});
				return;
			}
			const token = ++posFollowTokenRef.current;
			/** 落笔：写 ref + 四个 style（弹簧与直线两条路共用；原先是各写一遍） */
			const paint = (x, y) => {
				boxPxRef.current = {
					x,
					y
				};
				rootEl.style.left = x + "px";
				rootEl.style.top = y + "px";
				rootEl.style.right = "auto";
				rootEl.style.bottom = "auto";
			};
			if (mode === "line") {
				const from = boxPxRef.current ?? {
					x: px,
					y: py
				};
				const t0 = performance.now();
				const step$1 = () => {
					if (posFollowTokenRef.current !== token) return;
					const p = Math.min((performance.now() - t0) / duration, 1);
					if (p >= 1) {
						paint(px, py);
						posFollowRef.current = null;
						setCustomPos({
							rx,
							ry
						});
						return;
					}
					paint(from.x + (px - from.x) * p, from.y + (py - from.y) * p);
					posFollowRef.current = requestAnimationFrame(step$1);
				};
				posFollowRef.current = requestAnimationFrame(step$1);
				return;
			}
			let last = performance.now();
			const vel = {
				vx: 0,
				vy: 0
			};
			const step = () => {
				if (posFollowTokenRef.current !== token) return;
				const now = performance.now();
				const dt = Math.min((now - last) / 1e3, 1 / 30);
				last = now;
				let x = boxPxRef.current?.x ?? px;
				let y = boxPxRef.current?.y ?? py;
				vel.vx = springStep(vel.vx, x, px, dt, cfg.physics.throwPower);
				vel.vy = springStep(vel.vy, y, py, dt, cfg.physics.throwPower);
				x += vel.vx * dt;
				y += vel.vy * dt;
				paint(x, y);
				if (Math.abs(px - x) < .5 && Math.abs(py - y) < .5 && Math.abs(vel.vx) < 1 && Math.abs(vel.vy) < 1) {
					paint(px, py);
					posFollowRef.current = null;
					setCustomPos({
						rx,
						ry
					});
					return;
				}
				posFollowRef.current = requestAnimationFrame(step);
			};
			posFollowRef.current = requestAnimationFrame(step);
		};
		/**
		* 执行一条抛掷指令：角度（度，`0` = 正右，逆时针为正）+ 力度倍率 → 初速度，交给 startThrow。
		* 下游（重力 / 反弹 / 地面摩擦 / 落地 Q 弹 / 宠物间碰撞 / 落定提交位置）全是**既有行为**，
		* 本接口不引入任何新物理。不设死区：接口是明确命令，power 再小也照抛。
		*/
		const applyThrowCue = (angleDeg, power) => {
			if (dragRef.current.active) return;
			const { vx, vy } = throwVelocity(angleDeg, power);
			const box = boxPxRef.current ?? {
				x: currentCenterX() - halfW,
				y: currentCenterY() - halfH
			};
			startThrow(box.x, box.y, vx, vy);
		};
		const onPetHit = (vx, vy) => {
			stopMove();
			stopDragFollow();
			stopThrow();
			const bx = boxPxRef.current;
			let sx = 0;
			let sy = 0;
			if (bx) {
				sx = bx.x;
				sy = bx.y;
			} else {
				const r = rootRef.current?.getBoundingClientRect();
				if (r) {
					sx = r.left;
					sy = r.top;
				}
			}
			startThrowLatestRef.current(sx, sy, vx, vy);
		};
		useEffect(() => {
			const arenaSlots = arena.current.slots;
			arenaSlots[cfg.id] = {
				size,
				bottomPad,
				getBox: () => {
					if (boxPxRef.current) return boxPxRef.current;
					const r = rootRef.current?.getBoundingClientRect();
					return r ? {
						x: r.left,
						y: r.top
					} : null;
				},
				getVel: () => throwRef.current !== null && throwStateRef.current ? {
					vx: throwStateRef.current.vx,
					vy: throwStateRef.current.vy
				} : {
					vx: 0,
					vy: 0
				},
				onHit: onPetHit
			};
			return () => {
				delete arenaSlots[cfg.id];
			};
		}, [
			cfg.id,
			size,
			bottomPad,
			arena
		]);
		/** Q 弹挤压：前台视频垂直压扁（贴地锚定，transform-origin:bottom）再回弹；
		*  与桌面同构，曲线在 shared（squashScale）。depth = 下压幅度（点击固定 0.55；
		*  落地按冲击速度 landingSquash 动态取）。reduce-motion 时跳过。 */
		const startSquash = (el, depth = SQ_SQUASH) => {
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
			const token = ++squashTokenRef.current;
			if (squashRef.current !== null) cancelAnimationFrame(squashRef.current);
			const origin = el.style.transformOrigin;
			el.style.transformOrigin = "bottom";
			const t0 = performance.now();
			const step = () => {
				if (squashTokenRef.current !== token) return;
				const u = Math.min((performance.now() - t0) / SQ_DURATION_MS, 1);
				const scale = squashScale(u, depth);
				el.style.transform = (facingRef.current === "right" ? "scaleX(-1) " : "") + "scaleY(" + scale + ")";
				if (u < 1) squashRef.current = requestAnimationFrame(step);
				else {
					squashRef.current = null;
					el.style.transformOrigin = origin;
					el.style.transform = facingRef.current === "right" ? "scaleX(-1)" : "";
				}
			};
			squashRef.current = requestAnimationFrame(step);
		};
		const stopSquash = () => {
			squashTokenRef.current++;
			if (squashRef.current !== null) {
				cancelAnimationFrame(squashRef.current);
				squashRef.current = null;
			}
		};
		const facingRef = useRef(facing);
		facingRef.current = facing;
		/** 把提示框摆到光标右下（右边/下边装不下自动翻边并夹回视口内）。
		*  直接写 DOM style 而不走 React 状态：鼠标每动一下都更新状态会让整个 PetCard 重渲染，
		*  代价远大于这一次样式写入（root 的位置也是这么直接写的）。
		*  bounds 用视口——提示是 position:fixed，坐标就是 clientX/clientY 这一套。 */
		const placeTip = (clientX, clientY) => {
			const tipEl = tipRef.current;
			if (!tipEl) return;
			const viewport = document.documentElement;
			const p = tooltipPlacement({
				x: clientX,
				y: clientY
			}, {
				w: tipEl.offsetWidth,
				h: tipEl.offsetHeight
			}, {
				x: 0,
				y: 0,
				w: viewport.clientWidth,
				h: viewport.clientHeight
			}, size * TOOLTIP_GAP_RATIO);
			tipEl.style.left = p.x + "px";
			tipEl.style.top = p.y + "px";
		};
		/** 冻结 / 解冻的**实际动作**（只在真的翻转时做事：挂载那一次不动作，否则平白补播一段 idle） */
		const applyFreeze = (next) => {
			if (frozenRef.current === next) return;
			frozenRef.current = next;
			const el = frontRef.current === 0 ? videoARef.current : videoBRef.current;
			const stamp = "[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id;
			if (next) {
				stopMove();
				el?.pause();
				const interrupted = playingPlaybackRef.current;
				if (interrupted !== null) {
					playingPlaybackRef.current = null;
					reportPlayback(interrupted, "cancelled", "frozen");
				}
				console.log(stamp + " 占用锁生效：冻结（随机链停 + 当前动画暂停）");
				return;
			}
			console.log(stamp + " 占用锁解除：恢复");
			if (resumeWorkStatusAnim()) return;
			if (petAnims.idle.length) {
				setAnim(pick(petAnims.idle, animRef.current));
				setOnce(true);
				setSeq((s) => s + 1);
			}
		};
		useEffect(() => {
			if (lockTimerRef.current !== null) {
				window.clearTimeout(lockTimerRef.current);
				lockTimerRef.current = null;
			}
			const expiresAt = lock?.locked === true ? lock.expiresAt : 0;
			applyFreeze(expiresAt > Date.now());
			if (expiresAt <= Date.now()) return;
			lockTimerRef.current = window.setTimeout(() => {
				lockTimerRef.current = null;
				applyFreeze(false);
			}, Math.max(0, expiresAt - Date.now()));
			return () => {
				if (lockTimerRef.current !== null) {
					window.clearTimeout(lockTimerRef.current);
					lockTimerRef.current = null;
				}
			};
		}, [lockTick, lock]);
		const handlePointerDown = (e) => {
			if (e.button !== 0) return;
			if (frozenRef.current) {
				if (lockTimerRef.current !== null) {
					window.clearTimeout(lockTimerRef.current);
					lockTimerRef.current = null;
				}
				applyFreeze(false);
				postAction("/dsh-pet-jt-7340/lock/release?pet=" + encodeURIComponent(cfg.id), { force: true });
			}
			const grabState = throwStateRef.current;
			console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " grab vx=" + (grabState ? Math.round(grabState.vx) : 0) + " vy=" + (grabState ? Math.round(grabState.vy) : 0) + " |v|=" + (grabState ? Math.round(Math.hypot(grabState.vx, grabState.vy)) : 0));
			pressScoreFiredRef.current = false;
			if (grabState) {
				const grabSpeed = Math.hypot(grabState.vx, grabState.vy);
				if (grabSpeed >= SCORE_MIN_SPEED) {
					const sc = clickScore(grabSpeed, size);
					pressScoreFiredRef.current = true;
					console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " click-score speed=" + Math.round(grabSpeed) + " size=" + size + " -> +" + sc);
					spawnScoreBurst(e.clientX, e.clientY);
					mountScorePopup({
						x: e.clientX,
						y: e.clientY,
						score: sc,
						speed: grabSpeed,
						size
					});
				}
			}
			stopThrow();
			stopDragFollow();
			stopMove();
			dragTrailRef.current = [];
			e.currentTarget.classList.add("dragging");
			e.currentTarget.setPointerCapture(e.pointerId);
			setTipOn(false);
			const rootEl = rootRef.current;
			let offX = 0;
			let offY = 0;
			if (rootEl) {
				const rr = rootEl.getBoundingClientRect();
				offX = e.clientX - (rr.left + rr.width / 2);
				offY = e.clientY - (rr.top + rr.height / 2);
				boxPxRef.current = {
					x: rr.left,
					y: rr.top
				};
			}
			const pressNow = performance.now();
			const sling = pressNow - lastPressAtRef.current < SLINGSHOT_DOUBLE_MS;
			lastPressAtRef.current = sling ? 0 : pressNow;
			const anchor = boxPxRef.current;
			dragRef.current = {
				active: true,
				dragging: false,
				sx: e.clientX,
				sy: e.clientY,
				offX,
				offY,
				lpTimer: null,
				sling,
				anchorX: anchor ? anchor.x + halfW : e.clientX,
				anchorY: anchor ? anchor.y + halfH : e.clientY
			};
			if (e.pointerType !== "mouse" && e.pointerType !== "pen") {
				const lpEl = e.currentTarget;
				const lpId = e.pointerId;
				const lpX = e.clientX;
				const lpY = e.clientY;
				dragRef.current.lpTimer = setTimeout(() => {
					dragRef.current.lpTimer = null;
					const dl = dragRef.current;
					if (!dl.active || dl.dragging) return;
					dl.active = false;
					pressScoreFiredRef.current = true;
					if (lpEl.hasPointerCapture(lpId)) lpEl.releasePointerCapture(lpId);
					console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " -> [TOUCH-MENU]");
					lpEl.dispatchEvent(new MouseEvent("contextmenu", {
						bubbles: true,
						cancelable: true,
						view: window,
						clientX: lpX,
						clientY: lpY,
						button: 2
					}));
				}, 500);
			}
		};
		const handlePointerMove = (e) => {
			if (tipOn) placeTip(e.clientX, e.clientY);
			const d = dragRef.current;
			if (!d.active) return;
			const dx = e.clientX - d.sx;
			const dy = e.clientY - d.sy;
			if (d.lpTimer && Math.hypot(dx, dy) > 8) {
				clearTimeout(d.lpTimer);
				d.lpTimer = null;
			}
			if (!d.dragging) {
				if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
				d.dragging = true;
				setDragging(true);
				setOnce(true);
				if (petAnims.drag.length) {
					const name = pick(petAnims.drag);
					console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " -> [DRAG] " + name);
					setAnim(name);
				}
			}
			const now = performance.now();
			dragTrailRef.current = trimTrail([...dragTrailRef.current, {
				t: now,
				x: e.clientX,
				y: e.clientY
			}], now);
			dragTargetRef.current = {
				x: e.clientX - d.offX - halfW,
				y: e.clientY - d.offY - halfH
			};
			const rootEl = rootRef.current;
			if (rootEl) startDragFollow(rootEl);
			const stageEl = stageRef.current;
			if (stageEl) stageEl.style.transform = "none";
		};
		const handlePointerUp = (e) => {
			const d = dragRef.current;
			if (d.lpTimer) {
				clearTimeout(d.lpTimer);
				d.lpTimer = null;
			}
			const wasDragging = d.dragging;
			d.active = false;
			d.dragging = false;
			e.currentTarget.classList.remove("dragging");
			stopDragFollow();
			if (wasDragging) {
				justDraggedRef.current = true;
				setTimeout(() => {
					justDraggedRef.current = false;
				}, 100);
				setDragging(false);
				const stageEl = stageRef.current;
				if (stageEl) stageEl.style.transform = "translateY(" + bottomPad + "px)";
				if (!resumeWorkStatusAnim()) {
					if (petAnims.idle.length) setAnim(pick(petAnims.idle, animRef.current));
					setOnce(true);
				}
				const bx = boxPxRef.current;
				const px = bx ? bx.x : e.clientX - d.offX - halfW;
				const py = bx ? bx.y : e.clientY - d.offY - halfH;
				if (d.sling) {
					const pullX = px + halfW - d.anchorX;
					const pullY = py + halfH - d.anchorY;
					const dist = Math.hypot(pullX, pullY);
					const power = slingshotPower(dist, size);
					const v = slingshotVelocity(pullAngle(pullX, pullY), power, cfg.physics.throwPower);
					dragTrailRef.current = [];
					console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " sling dist=" + Math.round(dist) + " power=" + power.toFixed(2) + " vx=" + Math.round(v.vx) + " vy=" + Math.round(v.vy));
					startThrow(px, py, v.vx, v.vy);
				} else {
					const vel = estimateReleaseVelocity(dragTrailRef.current, performance.now(), cfg.physics);
					dragTrailRef.current = [];
					if (vel) {
						console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " release vx=" + Math.round(vel.vx) + " vy=" + Math.round(vel.vy) + " |v|=" + Math.round(Math.hypot(vel.vx, vel.vy)));
						startThrow(px, py, vel.vx, vel.vy);
					} else setCustomPos({
						rx: (px + halfW) / window.innerWidth,
						ry: (py + halfH) / window.innerHeight
					});
				}
			}
			const hitRect = e.currentTarget.getBoundingClientRect();
			if (e.clientX >= hitRect.left && e.clientX <= hitRect.right && e.clientY >= hitRect.top && e.clientY <= hitRect.bottom) {
				placeTip(e.clientX, e.clientY);
				setTipOn(true);
			}
		};
		/** 双击 = 查看余额（dsh-pet-jt 新增）。
		*  与右键菜单「查看余额」完全同一条契约：POST 动作端点让 host 立即刷新并写入 S，
		*  数据仍只有一个出口（/state 的 sections.balance）——这里不读响应、也不自己弹气泡。
		*  拖拽/刚拖完的双击不算（那是在玩宠物，不是在查余额）。 */
		const handleDoubleClick = (e) => {
			const d = dragRef.current;
			if (d.active || d.dragging || justDraggedRef.current) return;
			e.preventDefault();
			console.info("[dsh-pet-jt] 双击查看余额 pet=" + cfg.id);
			postAction("/dsh-pet-jt-7340/balance").then((ok) => {
				if (!ok) console.warn("[dsh-pet-jt] 双击余额刷新未成功 pet=" + cfg.id);
			}).catch((err) => console.warn("[dsh-pet-jt] 双击余额刷新异常", err));
		};
		const handleClick = () => {
			const d = dragRef.current;
			if (d.active || d.dragging || justDraggedRef.current) return;
			if (pressScoreFiredRef.current) {
				pressScoreFiredRef.current = false;
				stopThrow();
				stopMove();
				return;
			}
			stopThrow();
			stopMove();
			setOnce(true);
			if (!petAnims.clicks.length) return;
			const name = pick(petAnims.clicks);
			console.log("[dsh-pet-jt] " + new Date().toTimeString().slice(0, 8) + " pet=" + cfg.id + " -> [CLICK] " + name);
			pendingSquashRef.current = true;
			setSeq((s) => s + 1);
			setAnim(name);
		};
		/** `keepFacing` = 调用方已**显式指定**朝向（POST /anim 的 facing）：跳过下面"文字类动画
		*  点播前强制朝左"那条镜像修正——显式值优先。右键菜单点播不传（保持原语义）。 */
		const handleMenuAction = (leaf$1, playbackId, keepFacing = false) => {
			if (leaf$1.action === "third-party") {
				const owner = leaf$1.owner ?? "";
				if (owner !== "") postAction("/dsh-pet-jt-7340/menu/click", {
					owner,
					label: leaf$1.label,
					pet: cfg.id
				}).catch((e) => console.warn("[dsh-pet-jt] 第三方菜单点击上报失败", e));
				return;
			}
			if (leaf$1.action === "show-balance") {
				console.info("[dsh-pet-jt] 菜单查看余额 pet=" + cfg.id);
				postAction("/dsh-pet-jt-7340/balance").then((ok) => {
					if (!ok) console.warn("[dsh-pet-jt] 余额刷新动作未成功 pet=" + cfg.id);
				}).catch((e) => console.warn("[dsh-pet-jt] 余额刷新异常", e));
				return;
			}
			if (leaf$1.action === "whisper") {
				console.info("[dsh-pet-jt] 菜单触发碎碎念 pet=" + cfg.id);
				postAction("/dsh-pet-jt-7340/whisper?pet=" + encodeURIComponent(cfg.id) + "&surface=web").then((ok) => {
					if (!ok) console.warn("[dsh-pet-jt] 碎碎念手动触发失败 pet=" + cfg.id);
				}).catch((e) => console.warn("[dsh-pet-jt] 碎碎念手动触发异常", e));
				return;
			}
			if (leaf$1.action === "chat") {
				if (chatRef.current) chatRef.current.close();
				const hitRect = stageRef.current?.querySelector(".dsh-pet-jt-hit")?.getBoundingClientRect();
				chatRef.current = mountChatDialog({
					petId: cfg.id,
					baseUrl: "/dsh-pet-jt-7340/chat",
					surface: "web",
					x: hitRect ? hitRect.right + 6 : window.innerWidth - 256,
					y: hitRect ? hitRect.top + 6 : 8,
					onSent: () => {
						console.info("[dsh-pet-jt] 对话已发送 pet=" + cfg.id);
					},
					onClose: () => {
						chatRef.current = null;
					}
				});
				return;
			}
			if (leaf$1.action === "set-display") {
				const display = leaf$1.display;
				if (!display) return;
				console.info("[dsh-pet-jt] 菜单切换显示位置 pet=" + cfg.id + " display=" + display);
				fetch("/dsh-pet-jt-7340/pet-display", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						id: cfg.id,
						display
					})
				}).then(async (r) => {
					if (!r.ok) throw new Error("pet-display HTTP " + r.status);
					const body = await r.json();
					if (body.ok === false) throw new Error("pet-display 被拒：" + String(body.reason ?? ""));
					petBridge.reload(body);
				}).catch((e) => console.warn("[dsh-pet-jt] 显示位置切换失败", e));
				return;
			}
			if (leaf$1.action === "home") {
				stopThrow();
				stopMove();
				setCustomPos(null);
				return;
			}
			if (!leaf$1.anim) return;
			const cuePlaybackId = playbackId ?? null;
			if (!keepFacing && isNoMirrorAnimation(petAnims.categories, leaf$1.anim) && facingRef.current === "right") setFacing("left");
			if (petAnims.moves.actions.some((a) => a.name === leaf$1.anim)) {
				if (tryMove(leaf$1.anim) === false) {
					stopMove();
					setOnce(true);
					setAnim(leaf$1.anim);
					setCuePlayback(cuePlaybackId);
				} else if (cuePlaybackId !== null) reportPlayback(cuePlaybackId, "failed", "busy");
				return;
			}
			stopMove();
			setOnce(true);
			setAnim(leaf$1.anim);
			setCuePlayback(cuePlaybackId);
		};
		const handleContextMenu = (e) => {
			const more = buildMoreBranch(menuItemsRef.current);
			const tools = [
				{
					label: "查看余额",
					action: "show-balance"
				},
				{
					label: "碎碎念",
					action: "whisper"
				},
				{
					label: "对话",
					action: "chat"
				},
				{
					label: "回到初始位置",
					action: "home"
				},
				displayMenuBranch()
			];
			const tree = [
				...tools,
				...buildMenuTree(petAnims),
				...more ? [more] : []
			];
			if (!tree.length) return;
			e.preventDefault();
			e.stopPropagation();
			const d = dragRef.current;
			if (d.active || d.dragging || justDraggedRef.current) return;
			stopThrow();
			stopMove();
			if (menuRef.current) menuRef.current.close();
			menuRef.current = mountContextMenu({
				tree,
				x: e.clientX,
				y: e.clientY,
				onAction: handleMenuAction,
				onClose: () => {
					if (menuRef.current) menuRef.current = null;
				}
			});
		};
		const sideAllow = HIT_BOX.x0 / 640 * size;
		const stageStyle = dragging ? { transform: "none" } : { transform: "translateY(" + bottomPad + "px)" };
		const rootStyle = customPos ? (() => {
			const rx = customPos.rx;
			const ry = customPos.ry;
			return {
				left: rx * window.innerWidth - halfW + "px",
				top: ry * window.innerHeight - halfH + "px",
				right: "auto",
				bottom: "auto"
			};
		})() : {};
		/** 点余额气泡：切换展开/收起，并把 10s 计时器重置一次
		*  （不重置的话，第 8 秒才点开就只剩 2 秒，"看完整信息"这个目的就落空了） */
		const toggleBalanceDetail = () => {
			setBalanceExpanded((v) => !v);
			if (bubbleTimerRef.current !== null) window.clearTimeout(bubbleTimerRef.current);
			bubbleTimerRef.current = window.setTimeout(() => setBubbleOn(false), BUBBLE_DURATION_MS);
		};
		const workTerminal = workStatus?.state === "success" || workStatus?.state === "error";
		const bubbleNode = (() => {
			if (workTerminal && workBubbleOn && workText && cfg.workStatusEnabled) return h(WhisperBubble, {
				text: workText,
				on: workBubbleOn
			});
			if (whisperBubbleOn && whisperText) return h(WhisperBubble, {
				text: whisperText,
				image: whisperImage,
				url: whisperUrl,
				assetRoot: cfg.assetRoot,
				on: whisperBubbleOn
			});
			if (bubbleOn && balance && (cfg.balanceEnabled || balanceManual)) return h(BalanceBubble, {
				state: balance,
				on: bubbleOn,
				expanded: balanceExpanded,
				onToggle: toggleBalanceDetail
			});
			if (workBubbleOn && workText && cfg.workStatusEnabled) return h(WhisperBubble, {
				text: workText,
				on: workBubbleOn
			});
			return null;
		})();
		const commonVideoProps = {
			muted: true,
			playsInline: true,
			autoPlay: true
		};
		const hitProps = {
			className: "dsh-pet-jt-hit",
			style: {
				left: HIT_BOX.x0 / 640 * 100 + "%",
				top: HIT_BOX.y0 / 360 * 100 + "%",
				width: (HIT_BOX.x1 - HIT_BOX.x0) / 640 * 100 + "%",
				height: (HIT_BOX.y1 - HIT_BOX.y0) / 360 * 100 + "%"
			},
			onClick: handleClick,
			onDoubleClick: handleDoubleClick,
			onPointerDown: handlePointerDown,
			onPointerMove: handlePointerMove,
			onPointerUp: handlePointerUp,
			onPointerCancel: handlePointerUp,
			onPointerEnter: (e) => {
				placeTip(e.clientX, e.clientY);
				setTipOn(true);
			},
			onPointerLeave: () => setTipOn(false),
			onContextMenu: handleContextMenu,
			"aria-label": cfg.name
		};
		return h("div", {
			ref: rootRef,
			className: "dsh-pet-jt-root",
			"data-corner": corner,
			"data-facing": facing,
			style: Object.assign(
				{
					"--dsh-pet-jt-size": size + "px",
					"--dsh-pet-jt-mx": margin.x + "px",
					"--dsh-pet-jt-my": margin.y + "px",
					"--dsh-pet-jt-font-bubble": fontPx.bubble + "px",
					"--dsh-pet-jt-font-tip": fontPx.tip + "px",
					transition: "opacity .45s ease, visibility .45s ease"
				},
				rootStyle,
				// 隐藏：淡出 + 不接指针事件。**不卸载组件**——视频、动画、气泡、拖拽位置全部保留，
				// 再出现时是"同一只宠物回来了"，而不是重开一只。
				hidden ? {
					opacity: 0,
					visibility: "hidden",
					pointerEvents: "none"
				} : null
),
			children: [
				bubbleNode,
				h("div", {
					ref: stageRef,
					className: "dsh-pet-jt-stage",
					style: stageStyle,
					children: [
						h("video", Object.assign({}, commonVideoProps, {
							ref: videoARef,
							className: "dsh-pet-jt-video is-front"
						})),
						h("video", Object.assign({}, commonVideoProps, {
							ref: videoBRef,
							className: "dsh-pet-jt-video"
						})),
						h("div", hitProps)
					]
				}),
				h("div", {
					ref: tipRef,
					className: TOOLTIP_CLASS + (tipOn ? " is-on" : ""),
					"aria-hidden": "true",
					children: cfg.name
				})
			]
		});
	}
	/** 多开容器：一次拉取成品配置 → 拍平 → 渲染多个 PetCard */
	function PetMulti() {
		const [pets, setPets] = useState([]);
		const [ready, setReady] = useState(false);
		const [cycle, setCycle] = useState({ ...DEFAULT_VISIBILITY_CYCLE });
		const [hidden, setHidden] = useState(false);
		const [cycleRestart, setCycleRestart] = useState(0);
		const arenaRef = useRef({ slots: {} });
		const [balance, setBalance] = useState(null);
		const [balanceTick, setBalanceTick] = useState(0);
		const [balanceNoticeTick, setBalanceNoticeTick] = useState(0);
		const [balanceManual, setBalanceManual] = useState(false);
		const noticeKeyRef = useRef(null);
		const applyBalanceRef = useRef(() => {});
		applyBalanceRef.current = (state, explicit) => {
			setBalance(state);
			setBalanceManual(explicit);
			if (state.ok) {
				setBalanceTick((t) => t + 1);
				return;
			}
			const { show, key } = decideBalanceNotice(state, noticeKeyRef.current, explicit);
			noticeKeyRef.current = key;
			if (show) setBalanceNoticeTick((t) => t + 1);
			if (state.reason !== "unsupported") console.error("[dsh-pet-jt] 余额查询失败 reason=" + state.reason + (state.message ? " " + state.message : ""));
		};
		const [workStatus, setWorkStatus] = useState(null);
		const [workStatusTick, setWorkStatusTick] = useState(0);
		useEffect(() => {
			const family = pets[0]?.font?.family;
			if (family === void 0) return;
			document.documentElement.style.setProperty("--dsh-pet-jt-font-family", fontStackOf(family));
		}, [pets]);
		useEffect(() => {
			let alive = true;
			/** 唯一填充点：host 成品聚合 → 渲染列表。初始加载与设置页保存/同步后重载都走这里——
			*  条目级字段（动画池/权重/刷新周期/物理参数/工作状态文案）只由 flattenConfigPets 吹入，
			*  容器不再自己拼任何字段（曾经的第二份补吹实现漏过 physics，导致新增/同步后拖不动）。 */
			const applyMerged = (merged) => {
				const main = merged?.main;
				if (typeof main !== "object" || main === null) throw new Error("配置响应不是成品聚合（host 版本不匹配？）");
				const flattened = flattenConfigPets(merged);
				petBridge.current = flattened;
				petBridge.template = Array.isArray(main.pets) ? main.pets[0] ?? void 0 : void 0;
				setPets(flattened);
				setCycle(normalizeCycle(main.visibilityCycle));
			};
			/** 拉成品聚合：host readAllConfig 的输出（字段填满、绝对正确），客户端零校验零兜底 */
			const loadMerged = async () => {
				const r = await fetch("/dsh-pet-jt-7340/config", { cache: "no-store" });
				if (!r.ok) throw new Error("config HTTP " + r.status);
				return await r.json();
			};
			(async () => {
				try {
					const merged = await loadMerged();
					if (!alive) return;
					applyMerged(merged);
					setReady(true);
				} catch (e) {
					console.error("[dsh-pet-jt] 配置加载失败", e);
				}
			})();
			petBridge.reload = (merged) => {
				(async () => {
					try {
						const next = merged ?? await loadMerged();
						if (!alive) return;
						applyMerged(next);
					} catch (e) {
						console.error("[dsh-pet-jt] 配置重载失败，保留当前渲染列表", e);
					}
				})();
			};
			return () => {
				alive = false;
				petBridge.reload = () => {};
			};
		}, []);
		const visiblePets = pets.filter((p) => isWebVisible(p.display));
		useEffect(() => {
			if (!cycle.enabled) {
				setHidden(false);
				return;
			}
			let alive = true;
			let timer = null;
			let nowHidden = false;
			setHidden(false);
			const arm = () => {
				if (!alive) return;
				const delay = nowHidden ? pickCycleDelayMs(cycle.hiddenMin, cycle.hiddenMax) : pickCycleDelayMs(cycle.visibleMin, cycle.visibleMax);
				timer = window.setTimeout(() => {
					if (!alive) return;
					nowHidden = !nowHidden;
					setHidden(nowHidden);
					arm();
				}, delay);
			};
			arm();
			return () => {
				alive = false;
				if (timer !== null) window.clearTimeout(timer);
			};
		}, [
			cycle.enabled,
			cycle.visibleMin,
			cycle.visibleMax,
			cycle.hiddenMin,
			cycle.hiddenMax,
			cycleRestart
		]);
		const [sayTick, setSayTick] = useState(0);
		const sayRef = useRef({});
		const [animCueTick, setAnimCueTick] = useState(0);
		const animCueRef = useRef({});
		const [posCueTick, setPosCueTick] = useState(0);
		const posCueRef = useRef({});
		const [throwCueTick, setThrowCueTick] = useState(0);
		const throwCueRef = useRef({});
		const [lockTick, setLockTick] = useState(0);
		const lockRef = useRef({});
		const menuItemsRef = useRef([]);
		useEffect(() => {
			if (!ready) return;
			let alive = true;
			let baseline = null;
			let since;
			let longPoll = true;
			/** 应用一份 S：首拉只记基线，之后按 counter 变化逐个分发 */
			const applyState = (s) => {
				if (baseline === null) {
					baseline = flattenCounters(s);
					menuItemsRef.current = readMenuItems(s.sections.menu?.data);
					return;
				}
				for (const { path, leaf: leaf$1 } of takeChanged(s, baseline)) {
					if (leaf$1.data === null) continue;
					if (path === "sections.config") petBridge.reload();
					else if (path === "sections.balance") {
						const hit = readBalance(leaf$1);
						if (hit) applyBalanceRef.current(hit.state, hit.manual);
					} else if (path === "sections.workStatus") {
						const snap = readWorkStatus(leaf$1);
						if (snap) {
							setWorkStatus(snap);
							setWorkStatusTick((t) => t + 1);
						}
					} else if (path === "sections.notify") notifyFromFrame(leaf$1.data);
					else if (path === "sections.menu") menuItemsRef.current = readMenuItems(leaf$1.data);
					else if (path.startsWith("pets.") && path.endsWith(".say")) {
						const petId = path.slice(5, -4);
						const said = readSay(leaf$1);
						if (said) {
							sayRef.current[petId] = {
								...said,
								seq: (sayRef.current[petId]?.seq ?? 0) + 1
							};
							setSayTick((t) => t + 1);
							setCycleRestart((k) => k + 1);
						}
					} else if (path.startsWith("pets.") && path.endsWith(".anim")) {
						const petId = path.slice(5, -5);
						const hit = readAnim(leaf$1);
						if (hit) {
							animCueRef.current[petId] = {
								name: hit.name,
								url: hit.url,
								playbackId: hit.playbackId,
								facing: hit.facing,
								seq: (animCueRef.current[petId]?.seq ?? 0) + 1
							};
							setAnimCueTick((t) => t + 1);
						}
					} else if (path.startsWith("pets.") && path.endsWith(".position")) {
						const petId = path.slice(5, -9);
						const hit = readPosition(leaf$1);
						if (hit) {
							posCueRef.current[petId] = {
								...hit,
								seq: (posCueRef.current[petId]?.seq ?? 0) + 1
							};
							setPosCueTick((t) => t + 1);
						}
					} else if (path.startsWith("pets.") && path.endsWith(".throw")) {
						const petId = path.slice(5, -6);
						const hit = readThrow(leaf$1);
						if (hit) {
							throwCueRef.current[petId] = {
								...hit,
								seq: (throwCueRef.current[petId]?.seq ?? 0) + 1
							};
							setThrowCueTick((t) => t + 1);
						}
					} else if (path.startsWith("pets.") && path.endsWith(".lock")) {
						const petId = path.slice(5, -5);
						const hit = readLock(leaf$1);
						if (hit) {
							lockRef.current[petId] = hit;
							setLockTick((t) => t + 1);
						}
					}
				}
			};
			const loop = async () => {
				while (alive) {
					let s = null;
					try {
						s = await fetchState(void 0, longPoll && since !== void 0 ? {
							since,
							timeoutMs: STATE_WAIT_MS
						} : void 0);
					} catch {}
					if (!alive) return;
					if (s) {
						longPoll = typeof s.counter === "number";
						if (longPoll) since = s.counter;
						applyState(s);
					}
					if (!s || !longPoll) await new Promise((r) => setTimeout(r, STATE_FALLBACK_MS));
				}
			};
			loop();
			return () => {
				alive = false;
			};
		}, [ready]);
		return ready ? visiblePets.map((p) => h(PetCard, {
			key: p.id,
			cfg: p,
			balance,
			balanceTick,
			balanceNoticeTick,
			balanceManual,
			workStatus,
			workStatusTick,
			say: sayRef.current[p.id],
			sayTick,
			animCue: animCueRef.current[p.id],
			animCueTick,
			posCue: posCueRef.current[p.id],
			posCueTick,
			throwCue: throwCueRef.current[p.id],
			throwCueTick,
			lock: lockRef.current[p.id],
			lockTick,
			menuItemsRef,
			arena: arenaRef,
			hidden
		})) : null;
	}
	return PetMulti;
}

//#endregion
//#region src/client/command-faces.ts
/**
* 给宿主命令的「/」菜单行补上标题与图标。
*
* @param commandUi - DSH 的 commandUi 服务实例。
* @param faces - 命令名（不带前导斜杠）→ 补充面孔。
* @returns 还原原方法的 disposer。
*/
function installCommandFaces(commandUi, faces) {
	const original = commandUi.candidates;
	if (typeof original !== "function") {
		console.warn("[dsh-pet-jt] 命令图标不可用：commandUi.candidates 缺失（命令本身仍可用，只是没有图标）");
		return () => {};
	}
	const patched = async (session, req) => {
		const rows = await original.call(commandUi, session, req);
		try {
			if (!Array.isArray(rows)) return rows;
			return rows.map((raw) => {
				if (raw === null || typeof raw !== "object") return raw;
				const row = raw;
				const face = faces.get(typeof row.name === "string" ? row.name : "");
				if (face === void 0 || row.icon !== void 0) return row;
				return {
					...row,
					label: face.label(),
					icon: face.icon
				};
			});
		} catch (error) {
			console.warn("[dsh-pet-jt] 命令图标补丁异常，本次退回原始菜单行：" + (error instanceof Error ? error.message : String(error)));
			return rows;
		}
	};
	commandUi.candidates = patched;
	return () => {
		if (commandUi.candidates === patched) commandUi.candidates = original;
	};
}

//#endregion
//#region src/client/nav-icon.ts
/**
* 设置面板导航图标补丁 —— 把「桌宠配置」那一行的兜底齿轮换成指定图标。
*
* ## 为什么需要它
*
* DSH 设置面板的导航图标是**按分区 id 硬编码的白名单 + 兜底齿轮**，没有任何给第三方
* 分区配图标的入口：
*
*   · `dsh-client-ui-settings-general/lib/client.js` 的 `navIcon(id)`（:243-269）只认
*     account / models / agent-presets / plugins / archived-sessions 五个 id，其余
*     一律 `IconSettingsOutlineMedium` —— 源码注释原文就是 "unknown ids fall back
*     to the settings gear"；
*   · 导航行数据是 `ctx.slots.entries("settings.section")` 投影出来的
*     `{ id, order, label }`（同文件 :1023-1028），**没有图标位**；
*   · slot 契约里也没有：ui-slots 的 `KindOptions`（list 分支，:564-569）与
*     `StoredEntry.options`（:621-627）都只有 id / order / label / priority，
*     `settings.section` 的 owner props 只有 `{ close }`。
*
* `navIcon` 是 settings-general 模块内部的私有函数，外部拿不到引用，所以只能在
* **DOM 层**做：盯住设置面板（shell 用 `createPortal(..., document.body)` 直接挂在
* body 上）→ 按行标题认出我们那一行 → 打标记 → 用 CSS 盖住齿轮、画上我们的字形。
*
* ## 为什么是「打标记 + CSS」而不是「换掉那个 svg」
*
* 那个 `<svg>` 是 shell 的 React 节点。`replaceWith` 成自己的节点后，React 手里仍
* 攥着已脱离文档的旧 svg，那一行卸载时 React 会对它 `removeChild` →
* `NotFoundError` 直接崩。本模块**不动 DOM 结构**：只加一个 React 从不 diff 的
* `data-*` 属性，字形交给 `::before` + `mask` 画，React 全程无感。
*
* ## 认行只能靠标题文本
*
* 行里只有 id / order / label 三个字段，而投影到 DOM 的只有 label —— `<button>` 上
* 只有 class / aria-current / data-modal-autofocus，既没有 id 也没有 order。所以按标题
* 文本认。不能用 `:nth-child`：`account` 行是**条件出现**的（凭据存储后才注册），
* 位置会漂。
*
* ## 降级策略（保证绝不会把设置面板弄坏）
*
* 1. 环境缺 document / MutationObserver → 完全不装，只告警；
* 2. 图标渲不成 SVG（react-dom 不可用等）→ 完全不装，只告警（齿轮照旧）；
* 3. 认不出那一行 → 什么都不做（齿轮照旧），不报错；
* 4. 面板反复开关 → 观察者重新打标记，幂等。
*
* 将来 DSH 给 `settings.section` 加上 icon 选项后，删掉本模块与调用点即可。
*/
/** 注入的样式表去重标记（与宠物页面 / 设置页同一套 `data-plugin-css` 约定）。 */
const STYLE_TAG = "dsh-pet-jt/nav-icon.css";
/** 打在目标行 `<button>` 上的标记属性：React 从不 diff 它，重渲染 / 切语言都不会掉。 */
const MARK = "data-dsh-pet-jt-nav";
/** 设置面板根节点：shell 用 `createPortal(..., document.body)`（settings-general lib/client.js:341）。 */
const PANEL_SELECTOR = "[data-shortcut-modal=\"settings\"]";
/**
* 面板内部的类名来自 CSS Modules，**哈希前缀会随 DSH 构建变**（当前是 `VOzbGW_navList`），
* 但 `navList` / `navCell` / `navLabel` / `navIcon` 这些名字是源码里写死的
* （`"navIcon": "VOzbGW_navIcon"`），所以只匹配名字部分，不硬编码全名。
*/
const LIST_SELECTOR = "[class*=\"navList\"]";
const CELL_SELECTOR = "[class*=\"navCell\"]";
const LABEL_SELECTOR = "[class*=\"navLabel\"]";
/**
* 把内联 SVG 源码转成可作 CSS mask 的 data URI。
*
* 两处必须处理：
*   · `xmlns` —— React 渲染出的 DOM `<svg>` 不带命名空间声明，而 data URI 里的 SVG 是
*     按「独立图像文档」解析的，缺了它整张图不渲染（已有则不动）；
*   · `currentColor` —— mask 只看 alpha，但 data URI 里 `currentColor` 会退化成 UA
*     默认色，显式定成不透明黑最稳。
*
* @param svg - 内联 SVG 源码。
* @returns `url("data:image/svg+xml,...")`；源码为空时返回空串。
*/
function svgMaskUri(svg) {
	const source = svg.trim();
	if (source === "") return "";
	const namespaced = /<svg[^>]*\sxmlns=/i.test(source) ? source : source.replace(/<svg\b/i, "<svg xmlns=\"http://www.w3.org/2000/svg\"");
	return "url(\"data:image/svg+xml," + encodeURIComponent(namespaced.split("currentColor").join("#000")) + "\")";
}
/** 换字形用的 CSS：盖住齿轮，用 `::before` + mask 画上我们的图标。 */
function cssFor(glyph) {
	return [
		"/* 「桌宠配置」行的导航图标：见 dsh-pet-jt/src/client/nav-icon.ts 的模块注释 */",
		"[" + MARK + "] [class*=\"navIcon\"]{display:none}",
		"[" + MARK + "]::before{content:\"\";flex:none;width:16px;height:16px;background-color:currentColor;-webkit-mask:" + glyph + " center/16px 16px no-repeat;mask:" + glyph + " center/16px 16px no-repeat}"
	].join("\n");
}
/** 注入样式表（只注入一次）。 */
function injectCss(doc, glyph) {
	if (doc.querySelector("style[data-plugin-css=\"" + STYLE_TAG + "\"]") !== null) return;
	const tag = doc.createElement("style");
	tag.dataset.plugin = "dsh-pet-jt";
	tag.dataset.pluginCss = STYLE_TAG;
	tag.textContent = cssFor(glyph);
	doc.head.appendChild(tag);
}
/** 异常 → 单行文案（告警用）。 */
function describe(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* 把设置面板导航里目标分区的兜底齿轮换成指定图标。
*
* @param target - 目标行标题 + 字形渲染器。
* @returns disposer：断开观察者（已注入的样式与已打的标记留在原地，不影响正确性）。
*/
function installSectionNavIcon(target) {
	const doc = typeof document === "undefined" ? void 0 : document;
	const Observer = typeof MutationObserver === "undefined" ? void 0 : MutationObserver;
	if (doc === void 0 || Observer === void 0 || doc.body === null) {
		console.warn("[dsh-pet-jt] 设置页导航图标不可用：缺少 document / body / MutationObserver（齿轮照旧）");
		return () => {};
	}
	let glyph;
	if (typeof target.maskUri === "string" && target.maskUri !== "") glyph = target.maskUri;
	else try {
		glyph = svgMaskUri(target.renderSvg === void 0 ? "" : target.renderSvg());
	} catch (error) {
		console.warn("[dsh-pet-jt] 设置页导航图标不可用：图标渲染失败（齿轮照旧）：" + describe(error));
		return () => {};
	}
	if (glyph === "") {
		console.warn("[dsh-pet-jt] 设置页导航图标不可用：图标渲成了空 SVG（齿轮照旧）");
		return () => {};
	}
	injectCss(doc, glyph);
	let warned = false;
	/** 给面板里标题匹配的那一行打标记（幂等；已打过的不再读标题）。 */
	const markPanel = (panel) => {
		try {
			const wanted = target.label();
			if (wanted === "") return;
			const list = panel.querySelector(LIST_SELECTOR);
			if (list === null) return;
			for (const cell of list.querySelectorAll(CELL_SELECTOR)) {
				if (cell.getAttribute(MARK) !== null) continue;
				if (cell.querySelector(LABEL_SELECTOR)?.textContent === wanted) cell.setAttribute(MARK, "");
			}
		} catch (error) {
			if (!warned) {
				warned = true;
				console.warn("[dsh-pet-jt] 设置页导航图标补丁异常，本次跳过（齿轮照旧）：" + describe(error));
			}
		}
	};
	let watched;
	let panelObserver;
	const sync = () => {
		const panel = doc.querySelector(PANEL_SELECTOR);
		if (panel === null) {
			panelObserver?.disconnect();
			panelObserver = void 0;
			watched = void 0;
			return;
		}
		markPanel(panel);
		if (panel === watched) return;
		panelObserver?.disconnect();
		watched = panel;
		panelObserver = new Observer(() => {
			markPanel(panel);
		});
		panelObserver.observe(panel, {
			childList: true,
			subtree: true
		});
	};
	sync();
	const bodyObserver = new Observer(sync);
	bodyObserver.observe(doc.body, { childList: true });
	return () => {
		bodyObserver.disconnect();
		panelObserver?.disconnect();
	};
}

//#endregion
//#region src/client/brand.ts
/**
* 品牌资源：dsh-pet-jt 的设置页导航图标（从生图图标抠出的 alpha 剪影）。
*
* 为什么是「PNG 剪影 + CSS mask」而不是彩图：
*   DSH 的 settings.section 插槽没有图标位（导航图标按分区 id 硬编码 + 兜底齿轮），
*   上游 dsh-pet 的做法是在 DOM 层给那一行补一个 CSS mask（见 ./nav-icon.ts）。
*   mask 只吃 **alpha 通道**，所以这里准备的是透明底、白色主体的 64×64 剪影：
*   它由 assets/icon-candidates/c5.jpg（AI 生成的毛线帽小鲸鱼）按「与背景色的距离」抠图，
*   再用 scripts/dev/prepare-icons.mjs 缩到 64px（16px 显示时依然平滑）。
*
* 插件管理页 / 市场里显示的是彩色版 assets/logo-jt.png（package.json 的 icon）。
*/
const NAV_MASK_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAMCklEQVR42u2bC5SVVRXHh7kzIw8RBjREcjIiQLAUCRImkZRJHpkUUJpOYmTJm4gUcUxMxRRRQhJRM1B5WQiG8RAEUdLQNWoDomDIQwFhpJhhYJjXve49/I5rc7pzH8OdGXD5rfVf57vf/b57z9lnP/57n/MlJX1xfHGcEEcoFKoXDZ/HQScLUgWBGO/Xe1NOamEwm6n+IORzfUFjwamKYDB4mn7WlvMU7/6Af+2kGjiz30Zwm2CmDHKXtGWCI3J+WNqDoEBQJPiX4Pfy3a+lTfe0KHCiDz5gBn6WDOJWwb8ZbHno6HFA8I5gA8KoEARD/3/otULBXLnvR04L+I/kE3HWA5yfLpgsnd7PjK4XPCmYLpgvWM21fMFmwSY+5wk+5DkrsAradXLtkhNOG+hMpfeWDt7AwF4TTBDcIbhLMIeZXCp4S87fl3YnA/sQjdgj2Mesq0kcYvBlCMNpySL1FU4b6lzljWNbzuBGC64WjBX8UnCnYIrgT4IH0AI9f0PuXyPYi1mU0Ia888qBI4QyzlVL+riIUWczT9sVO39A2ouk/YHgOsFAwY0IYSz4i3OGgocU8szrDPSQUfcKYwJBN3AjCNf2qxMhGIfUA5UfKx06V9rLBD0FfRHEtYJegqsEIwXjBfchFP1ukWChPPu0HZx3FCOckCeECk8Igdqe+WbM3hDBOQigu+A7gvMY9CDVAnzDLYIcMFHwB7TkbsFzgvc8p+dUf7s0b3KtzPiCCoOsWhOC8/iClYLbBV8TZCCAngy+s+BiQSfBlZjJNdL2FoyT8zE4yBEIabFgwdHxHqP6btDFXFfnWOqbA8I71fWvRgdPuwp7biA4mzYDwnO+cgBBQ8EZgm8JLqBVDfmJxnW0IgctmKgRgrBYlSmUEDFKvOtOIJOtedakx1cPv146+WVpWwm+iUovEzwjWEI7GTsfx0zfTjRQB5mltgvBuQ5/ca9gFupeAku0JlFqnaFHmPQ4on2xZprwmZdOnSLna5WqEsruIN4/L/ijYDiD0WvDBA8y6CX4iwPM7kjMYAjCuJrf1funKkcwAgjHEkNhnKIeK2rEDMzs38gsaUgbIPi+oIOgbRSfka5OU9BOB8hAVUO64DQHgifBoVB8hxOSMs8WCReCsX2ls5MEXydz60Hs7+ilsWmQI0UT/EFDNEiZ4xVEARc1NFR2ku+fMkzSqn8shyNJtybUF5jBt8BRXc5AG1UlZfOMRov6DNylwK3QhvY4zI6CC3GSnfmP3YYJxno4YW3V/0yYFpi43wsScyYDS4tWxUEbKoHGqCmcA85DCGcTQdQc2hMuCxFCTD7Au+9gQs3AsD710vdx3khnNcb0OJlE6RQTNr8Cb+gIj2hD6wTyPPT64zi1wEWJcQkzAyOAUYJM7LmJS0nDsS9fKzCZBuZZnfGvMuhv87ttEIB+dzGRYGecWuAEcG8iBeBMQLO6b6D6zZ2deYNODpMqB5h95xSbKodAAzSCZGqeD59oi4l1gN0tizMiOD+wxWnocZmBcWY6e+uw3VSY3gWkt9d796ZSFGnkOcMAwjgNEpWBE+yOY81ECOfz/ULBX7V2EIcWuHsKTM0gIQJoBg1tQTg7F06gYecpFyUwk1e03AUWwQabGo1oyuBba45ASPyx5veE1MtxiI9RX9hXDT6QcAGkyw9ug9urCXwJIZwBQ1QVftuLx4ehp3q8pHHeaEM6tt9PkC24CeY4AFbYl7KaMrzcODhBjQmgCap4ehh1H21idgFxvJga33LTcaXBN5jw2Baa7Hi8srhpalKCXwkeQesWRkiQqhKA9qdxwgRADN+E82uOM/wh/N39cUWYnN2lsRVmEDMRaBqz/om5f7Xc8zuuL4DUzKiGABKjAV4UUId3Keo+hzp+KEJZ279uhfSyOlF+dxB5gabXDwt+SwY5l7L5/DgE4H7/FX8SE8EDlLs/SoFjn+lUME4n5TqZT32wNU4vC7apZbaBVJB3kXzFKgBXG5iYsFqh0YAeZHLZ8aSqUWYqhPOcSp1wADUCjQRvUCqfXg0N+EUiiZBzeA1ZthprPHNJBBOIpbOuw2pOLwjuh3LfhW9YCRmKJQq4Pmge0SyhKbHRAvXcs+ns5jBFCecALWwHj4FxkIp3qQVokeVZnplA+I1F25yj3ZbQbNCLBtewiqNh7gmyw40kLdU1hxARRh3gUA2B8j//RQiPeA41GEEYLg+4pabqAS3p0GzY3nMwvftxkI8TsnJJYnYgmEP4jAOkqntwbpsppeUQWbpIezPsrzKhcefeOmEwgvpr3tAqrtk3Ze7kSOoP83uQ2p7OzmJd2tI6HOrrFjieZdVnJNDy12OC37DkPYHQNxjv34uwupg1QxXWPqrGGVDi/2HbJWjfgTClcz3+fFxFUZfReamsLYj+zcVZQs6rzOjreO2NmsfrDDPLq8kJliOUXJ5dgoZMgvi8KO0/WTn6B8JoR1LVnLJZHxhiV753Yc8toKiQzop59o1qa4mqv2Zh/oqv/2PMdggbDZkafTFUtojZUQaX7/J5VPlds4iRjzorvX6HxU79vIOBHIQsZTLgGTw7nMlYwz0VJve4OS7bNwOcSPVFZ2uert74mx2MdrzshaRIITAY47VozwbNLD/NZCkNv14HzfWlcds9rVZh1qJ+KxCEsrzpfnGT9iokf8TzyiXMRKknlGieOxJTzCU52uCRpqHUJYbhfPV/p1Z39gdBbtaiAW+7CoxKOwwd7q9OCjUtMs6nmI4XGAdVZKipdValrPyUm71C5V4cz4EmW/V3vz+NdLkliZUej8fl/IwAtCY3V50QEj/GrnTZytOAWaYzdvBb0QINex/R0TKEuVttHDtfReh7k+0w2yhf7UKrCsg3fgbPyGaZzc87lHtcCG3W57rE7f2NEEYw+I0MJtyCoytpvWAGXohD+8DU7YrUQTJYt7GhwKzrbSRSlKMF+xGYK5xsYslMvf1NDHCGJwBrSroMd0UsFepI9FYLkHl0/DAddd59vAuB3KthqpDODENNpxPn1R6fwONvQSv28JvFEeirHdR7JEZDKYxoIXa4iTqlmF9lKFZuclz7AowQelN9sazrJcOpnQlkUuTYTsJibXMrA1hIQjMF1rgY05mEkKZw38EwDlIF93dWmwfDEUZhMlsQxD2C75q+JSeK6rbTdTWknmU9qrknhRnejTlYc4kUzoqx9zy0pR8RqD95gLt3HQK8Bw0YAQHqjTB1gtZUVYY/biFEWdxwkWAms/qfKrI85yDLwqSwLp7vhCI3JaaHTD1/KZPQlyrRAErwnxjG16QmVoDdhubUKlZ7nABGQ3tfi7Na61AC11jG6lBXo0UlhOSH2GIzHrNZ7pnn92p9n6AxgzOx4XlxVGp8x5dLra8ldm6Lqbp/8C2SoW7wFPc/iS95VWejBJQ0D/4Q8tQ/3Lm99j6xfhwrQHlh6PUeSNlAb33QheBH62SnqIkabYjh60lMYiP4R5+Zx1aadMpr4czIscJL8BV+3pFfK7vComyXGUlnllDKXoIT2wlX2MZiyF5mdAP2fCUz39ysJoXzIwtYO+zsVaGrV/ioIU2YbPj7aBY6u7EeOIRNkHfC7rQA0t74kflVJEnu8yqzEvVzIyRH0nJqdFtcpMqRA/5gjJnF9VR8OlBFdlElmRXmxmyGWhUtZUaTxptdKLdBmcvq1BF6AklDKLM92y2HWc6H+Ci9nYO/KIghfDrBfKwCNpQ3AyGHSJZSa8UMWMxsDTkZxR7BFdh1vpdFlkTJ/YNRipufRQyzPfZVuEEn9hZlUxNoUBtxvwVrdWvj3b9ncv4y78WHoLfZuSKSJsD+PmAbXftadX7MfmMc3LUQl4fJ01cyO7mkstvV61M0Ka/GWkEZaXYhtYVn2JU6GMeZZvpUr86iQBXO0W2Ecnt8tM5/EbH8MhKgPrTqCH/KQks2laks1Dud5fiGURxxqgnJKcbZBsz2vEDC3j80RZFkv3ReGy9cRtiLmFxnWhDh9ddkg0AUpHjCrRcmE7XvIM5iIWUcXONFTHI0NYppvKQxhkUX5SLdk5JO8veNzctZO4gQe6Hi+3GSH3HtEAWbEH5Eo1S3pKTPwfvHtD3N+4Op7D+u7861fMcq1mcbtPUHPgWh5UcXRjBAMQAAAABJRU5ErkJggg==";
/** 可直接塞进 CSS mask 的值（nav-icon.ts 的 maskUri 参数就吃这个） */
const JT_NAV_MASK_URI = "url(\"" + NAV_MASK_PNG + "\")";

//#endregion
//#region src/client/app.ts
/**
* 返回 DSH 插件 factory：`(require) => module`。
* 插件三件套（name / inject / apply）都在其返回的 module 上。
*/
function makeFactory() {
	return (require) => {
		const module = { exports: {} };
		const react = require("react");
		const { useEffect, useRef, useState, useCallback } = react;
		const { jsx: h } = require("react/jsx-runtime");
		let primitives;
		try {
			primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch (error) {
			console.warn("[dsh-pet-jt] 图标模块不可用：" + (error instanceof Error ? error.message : String(error)));
		}
		const PetMulti = makePetUI({
			h,
			useState,
			useEffect,
			useRef
		});
		const name = "pet-jt";
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"remote.commands",
			"commandUi"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-pet-jt: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.provide("petApiJt7340", {
				pose: readPose,
				progress: readProgress
			});
			ctx.effect(() => initNotify({ openSession: (sessionId) => ctx.get?.("uiWorkspace")?.openSession?.(sessionId) }), "dsh-pet-jt: notifications");
			ctx.effect(() => {
				const commandUi = ctx.get?.("commandUi");
				if (!commandUi || typeof commandUi.decorate !== "function") {
					console.warn("[dsh-pet-jt] 命令选择框不可用：commandUi 服务缺失（/pet 仍可手输 id 或名字）");
					return () => {};
				}
				return commandUi.decorate({
					name: "petjt",
					available: () => true,
					ui: {
						kind: "popupSelect",
						options: async () => petBridge.current.map((p) => ({
							id: p.id,
							label: p.name || p.id,
							detail: (p.assetRoot && p.assetRoot !== p.id ? p.assetRoot + " / " : "") + p.id
						})),
						onSelect: async (option, session) => {
							await ctx.remote?.commands?.execute(session.sessionId, "/petjt " + option.id, []);
						}
					}
				});
			}, "dsh-pet-jt: /pet picker");
			ctx.effect(() => {
				const commandUi = ctx.get?.("commandUi");
				const icons = primitives;
				if (commandUi === void 0 || icons === void 0) {
					console.warn("[dsh-pet-jt] 命令图标不可用（命令本身仍可用，只是没有图标）");
					return () => {};
				}
				return installCommandFaces(commandUi, new Map([
					["chat", {
						label: () => t("cmd.chat"),
						icon: icons.IconQueueOutlineRegular
					}],
					["pet", {
						label: () => t("cmd.pet"),
						icon: icons.IconUsersOutlineRegular
					}],
					["balance", {
						label: () => t("cmd.balance"),
						icon: icons.IconGaugeOutlineRegular
					}]
				]));
			}, "dsh-pet-jt: command faces");
			ctx.effect(() => installSectionNavIcon({
				label: () => t("nav"),
				maskUri: JT_NAV_MASK_URI
			}), "dsh-pet-jt: settings nav icon");
			ctx.slots.inject("shell.overlay", function* () {
				yield ctx.slots.register({
					name: "shell.overlay",
					id: "pet-jt",
					order: 1e3
				}, () => h(PetMulti, {}));
			});
			const PetConfigSection = makePetConfigSection({
				h,
				useState,
				useEffect,
				useRef,
				useCallback,
				t
			});
			ctx.slots.inject("settings.section", function* () {
				yield ctx.slots.register({
					name: "settings.section",
					id: "pet-jt-config",
					order: 30,
					label: () => t("nav"),
					inject: () => ({ t })
				}, PetConfigSection);
			});
		}
		module.exports = {
			apply,
			inject,
			name
		};
		return module.exports;
	};
}

//#endregion
//#region src/client/index.ts
window.__ModuleLoader__.load({
	id: "dsh-pet-jt",
	factory: makeFactory()
});

//#endregion
})();