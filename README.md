# dsh-pet-jt

<p align="center"><img src="assets/logo-jt.png" width="128" alt="dsh-pet-jt：Q 版 DeepSeek 小鲸鱼" /></p>

> **dsh-pet 的个性化增强分支**（JT = 自己的增强版）：整套桌宠能力原样保留，另加两块设置——
> **定时提醒**（自定义提示语，气泡复用对话气泡）与**随机出现 / 隐藏频率**（各 1–120 分钟随机）。
> 可与原版 [`dsh-pet`](https://github.com/PC2005-cloud/dsh-pet) **同时安装**，两份设置互不影响。

- 上游：`PC2005-cloud/dsh-pet`（MIT），本仓库基于其 **0.3.8** 的源码与全部动画素材（`assets/webm`、字体、表情包、通知图标）。
- 本分支不改上游已有的行为语义，只做**加法**：新增两个配置段、两块设置卡片、一条宿主定时器与一段客户端显隐调度。
- 图标：`assets/logo-jt.png`（AI 生成的毛线帽小鲸鱼，512 → 256px）；设置页导航用同一张图抠出的
  alpha 剪影（`src/client/brand.ts`，CSS mask 只吃 alpha）。另有 5 张生图候选在
  [`assets/icon-candidates/`](assets/icon-candidates/)。

---

## 一、新增功能

### 1. 定时提醒

在设置页「桌宠配置 JT」→「定时提醒」里维护任务列表，每条任务：

| 字段 | 说明 |
| --- | --- |
| 时刻 | `HH:MM`（24 小时制），每天触发一次 |
| 提示语句 | 显示在气泡里的原话，上限 120 字 |
| 启用 | 单条开关（另有总开关） |

- 到点后由**宿主**写一次 `pets.<id>.say` 叶子——与碎碎念、对话回复、第三方 `/broadcast` **完全同一个出口**，
  所以气泡外观、显示时长（12 秒）、说话动画全部**复用对话气泡**，没有第二套气泡。
- 同一分钟同一条任务只触发一次；DSH 没在运行而错过的时刻**不补发**。
- 提醒会投给「当前交互桌宠」（与 `/chatjt` 的目标一致）；该宠物不存在时跳过。
- 提醒触发同时也是一次「说话」，因此会立刻把正在隐藏的宠物叫回桌面（见下一条）。

### 2. 随机出现 / 隐藏频率

| 字段 | 说明 |
| --- | --- |
| 出现后最短 / 最长停留 | 出现后在 `[最短, 最长]` 分钟内**随机**某一刻隐藏 |
| 隐藏后最短 / 最长 | 隐藏后在 `[最短, 最长]` 分钟内**随机**某一刻重新出现 |

- 四个值单位都是分钟，各自 **1–120**，且「最短」不得大于「最长」（设置页与宿主两侧同一套校验）。
- 例：出现后最短 5 / 最长 20 → 宠物出现后 5–20 分钟内的某个随机时刻隐藏；
  隐藏后最短 10 / 最长 30 → 10–30 分钟内的某个随机时刻回来。
- 隐藏是 `opacity: 0 + visibility: hidden + pointer-events: none`，**组件不卸载**：视频、动画、气泡、
  拖拽位置全部保留，回来时是「同一只宠物」而不是重开一只；带 0.45s 淡入淡出。
- 任何一次说话（碎碎念 / 对话 / 定时提醒）都会让它立刻现身，并**从现在重新随机**下一次隐藏时间——
  不会出现「正说着话突然消失」。
- 关闭开关 = 一直显示（等价原版行为）。
- 作用范围：**网页 overlay 与桌面模式的透明窗口都生效**。网页端是整只宠物淡出（组件不卸载，
  动画/气泡/拖拽位置全保留）；桌面端是主进程 `win.hide()`（整窗消失，隐藏期间连点击穿透都不用管，
  回来时 `showInactive()` 并重新钉一次置顶）。

### 3. 双击查看余额

- **双击宠物** = 查看余额，等价右键菜单里的「查看余额」：POST `/dsh-pet-jt-7340/balance`，
  余额气泡由 `/state` 推送，网页端与桌面端行为一致。
- 拖拽中、刚拖完、飞行中被按住的那一下不算双击（那是在玩宠物）。
- 与「余额功能」开关无关：手动查看不受开关限制（开关只关自动轮询与档位动画）。

---

## 二、和原版 dsh-pet 的隔离

两个插件可以同时开着，**任何一路都不重叠**：

| 维度 | 原版 dsh-pet | 本分支 dsh-pet-jt |
| --- | --- | --- |
| npm 包名 | `dsh-pet` | `dsh-pet-jt` |
| bundle entry id | `dsh-pet` | `dsh-pet-jt` |
| 浏览器模块 id | `dsh-pet` | `dsh-pet-jt` |
| HTTP 前缀 | `/dsh-pet-7340/...` | `/dsh-pet-jt-7340/...` |
| 用户数据目录 | `~/.dsh/dsh-pet/` | `~/.dsh/dsh-pet-jt/` |
| 配置文件 | 各自目录下的 `main-config.jsonc` | 同左（互不影响） |
| Cordis 服务 | `petApi7340` | `petApiJt7340` |
| 斜杠命令 | `/pet`、`/chat`、`/balance` | `/petjt`、`/chatjt`、`/balancejt` |
| overlay 插槽 id | `pet` | `pet-jt` |
| 设置页分区 id / 标题 | `pet-config` / 桌宠配置 | `pet-jt-config` / 桌宠配置 JT |
| CSS / CSS 变量前缀 | `dsh-pet-` / `--dsh-pet-` | `dsh-pet-jt-` / `--dsh-pet-jt-` |

> 命令名加 `jt` 后缀是必要的：DSH 的 `/` 命令表是全局的，两个插件都注册 `/pet` 会撞名。
> 设置页标题也不同（导航图标按分区标题匹配），所以两行会并排出现、各自独立。

---

## 三、安装

插件以 DSH bundle 形式安装（与 dsh-pet 相同的机制）：

```bash
# 方式一：命令行挂到某个 profile（<profile> 换成你的，如 desktop）
dsh plugin --profile <profile> add "D:/path/to/dsh-pet-jt"

# 方式二：在 DSH 的插件管理里选择「安装本地 bundle」，指向本仓库目录
```

装完刷新页面，设置面板里会多出一行 **「桌宠配置 JT」**（图标是那只 Q 版小鲸鱼）。

> 依赖说明：`react` / `react-dom` / `@deepseek-ai/*` 全部由 DSH 宿主提供（peerDependencies），
> 本包不重复安装；`dsh.bundle.patch` 会把 `dsh-pet-jt` 这一行插进配置树。

---

## 四、配置文件

设置页的「保存」写的是 `~/.dsh/dsh-pet-jt/main-config.jsonc`（可手改，JSONC 支持注释）。
两个新增段的形状：

```jsonc
{
  // 定时提醒：每天 HH:MM 触发一次，语句进对话气泡
  "reminders": {
    "enabled": true,
    "tasks": [
      { "id": "r1", "time": "10:30", "text": "该喝水啦，起来动一动～", "enabled": true },
      { "id": "r2", "time": "15:00", "text": "盯屏幕太久啦，看看窗外吧", "enabled": true }
    ]
  },

  // 随机出现 / 隐藏：四项都在 1~120 分钟，且 min ≤ max
  "visibilityCycle": {
    "enabled": true,
    "visibleMin": 5,
    "visibleMax": 20,
    "hiddenMin": 10,
    "hiddenMax": 30
  }
}
```

- 两个字段都是**整段替换**语义（与 `physics` / `font` 一致）：写了就用自己那份，缺键按内置默认。
- 非法值（时刻不是 `HH:MM`、语句为空、时长越界或 min > max）→ 宿主告警并回落内置默认，不会让插件起不来。
- 设置页只提交它管理的字段；手写在文件里的其它高级字段（`animations`、`memes`、`whisperPrompt` …）
  在保存时**原样透传保留**。

---

## 五、开发

```bash
npm install --ignore-scripts     # 只装构建期依赖（react 类型 / tsdown / typescript）
npm run build                    # tsdown → lib/client.js + lib/index.js + lib/standalone.js
npm run typecheck                # tsc --noEmit
```

新增/改动集中在这几个文件：

| 文件 | 作用 |
| --- | --- |
| `src/shared/extras.ts` | 两个新配置的**形状 / 默认值 / 校验 / 随机时长**（浏览器与设置页共用） |
| `src/host/reminders.ts` | 宿主侧自包含副本：校验 + 「这一拍该触发哪些提醒」的纯判定 |
| `src/host/index.ts` | `dsh-pet-jt: reminders` 定时器（启动对齐 15s，命中分钟写 `say` 叶子） |
| `src/host/config.ts` | 读写两侧的整段校验 + `saveUserConfig` 白名单/透传 |
| `src/client/settings.ts` | 两块新卡片（增删提醒、四个分钟输入）+ 保存时提交两段 |
| `src/client/pet.ts` | 容器级显隐调度（随机时长、说话即现身）+ `hidden` 淡出 + 双击查余额 |
| `src/client/brand.ts` | 设置页导航图标（从生图图标抠出的 alpha 剪影，内联 PNG data URI） |
| `runtime/electron-helper/sprite.js` | 桌面端显隐调度 + 双击查余额 |
| `runtime/electron-helper/{main,preload}.js` | `pet:set-visible` 通道（窗口级 hide/showInactive） |
| `scripts/dev/gen-icons.mjs` | 生图：调 pollinations（flux）出 5 张候选（免费层限速，串行 + 退避） |
| `scripts/dev/prepare-icons.mjs` | 后处理：去水印、512 圆角 PNG、64px alpha 剪影 |
| `assets/config.jsonc` | 内置默认值（带注释，设置页「同步」会整份写进用户层） |

端到端验证脚本（需要 DSH 正在运行）：

```bash
node scripts/dev/e2e-reminder.mjs
# 排一条"下一分钟"的提醒 → 轮询 /state 等 say 叶子出现 → 校验 duration/anim → 恢复配置
```

---

## 六、已知限制

- 提醒时间精度是「分钟」，对表间隔 15 秒；DSH 未运行期间错过的提醒不补发。
- 每条任务只有「每天一个时刻」，没有「工作日 / 每 N 小时」之类的重复规则；
  需要一天多次就建多条任务（上限 40 条）。
- 桌面端「显示/隐藏」是窗口级操作：隐藏期间若从托盘强制唤醒，下一次到点仍会按配置继续循环。

---

## 附：图标候选

### A. 极简线条版（矢量，推荐）—— 真正满足「单色等宽线条 + Q 版可爱鲸鱼」

文生图模型（pollinations 免费层的 sana）**出不了纯线条**：换了好几套提示词（line art / no fill /
coloring book / 单色描边），出来都是 3D 或渐变插画。所以这 10 张改用**代码画 SVG**：
线条等宽（stroke 13/256）、圆头圆角、品牌蓝 `#4D6BFE`，任意尺寸都清晰，改颜色/线宽直接编辑源文件。

![10 个线条 logo 一览](assets/icon-candidates/line/vector-sheet.png)

| | | | | |
|---|---|---|---|---|
| ![v1](assets/icon-candidates/line/vector-1.png) | ![v2](assets/icon-candidates/line/vector-2.png) | ![v3](assets/icon-candidates/line/vector-3.png) | ![v4](assets/icon-candidates/line/vector-4.png) | ![v5](assets/icon-candidates/line/vector-5.png) |
| v1 基础 | v2 喷水 | v3 徽章 | v4 泡泡 | v5 帽子围巾 |
| ![v6](assets/icon-candidates/line/vector-6.png) | ![v7](assets/icon-candidates/line/vector-7.png) | ![v8](assets/icon-candidates/line/vector-8.png) | ![v9](assets/icon-candidates/line/vector-9.png) | ![v10](assets/icon-candidates/line/vector-10.png) |
| v6 抱心 | v7 睡觉 | v8 小鱼朋友 | v9 眼镜 | v10 领结 |

生成方式：`node scripts/dev/gen-vector-logos.mjs`（参数化 SVG → sharp 渲染 PNG + 拼图）。
换图标：把选中的 `vector-N.svg` 导出 256px PNG 覆盖 `assets/logo-jt.png`，或直接改脚本里的 `INK` / `SW` 重新生成。

### B. AI 文生图版（插画风，10 张）

`l1..l10.jpg` 是同一批需求的**生图**结果（coloring-book 提示词 + 免费层限速）；
模型给的是填充插画而非线条，保留在仓库里作为对照。生成脚本：`scripts/dev/gen-line-icons.mjs`。

---

## 七、许可与致谢

- 本仓库沿用上游的 **MIT** 许可（见 `LICENSE`），动画素材、字体、表情包均来自上游仓库。
- 上游作者与项目：[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。
- 本分支只对「配置段 / 设置页 / 定时器 / 显隐调度」做增量改动，其余代码与素材保持上游原样。
