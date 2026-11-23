# 流程

从一次活动或一次点击出发，谁读什么、写什么、失败怎么办。字段形状见 [formats.md](formats.md)，
为什么这么分工见[决策笔记](../.agents/notes/AGENTS.md)。

## 一次活动 → 重排（Host）

1. 宿主触发 `api-session/activity(sessionId, updatedAt)`（或 `api-session/added(summary)`，当
   `trackNewSessions` 为真时）。
2. `src/index.ts` 先过三道门：会话被某个工作区认领吗（`isGrouped`）？时间戳比记过的更新
   （`record`）？`enabled` 还在吗？任何一道不过就直接返回，没有写盘。
3. 通过后调 `schedule()`：重启 `debounceMs`（默认 600 毫秒）的定时器，定时器 `unref`，不会拖住
   宿主退出。
4. 定时器到点，把 `sortNow()` 接到队列尾部——前一轮没跑完就等它，不并发写。
5. `sortNow()` 先等置顶列表读完（`PinStore.load()` 只读一次），再循环：`list()` 读注册表 →
   每个工作区算「最近活动时刻」（跳过归档会话）→ `orderByActivity()` 出目标顺序
   （**置顶项整体在开头，组内也按活跃度**；其余同样按活跃度）→ `nextMove()` 找第一处错位。
6. 有错位就 `insertBefore(该工作区, 错位处那个工作区)`，回到第 5 步；没错位就结束。最多重试
   「工作区个数」次，防止一边写一边被改时死循环。
7. `insertBefore` 抛错：记一条 `warn`（`reorder stopped after N move(s): …`）并**停止**这一轮，
   不重试。下一轮活动会重新读注册表，不需要手上有旧状态。

一次活动通常只产生一次移动：活跃的工作区没置顶就移到置顶组下面，已经置顶就在组内往上走。**未置顶的
工作区越不过置顶组**——这是「不会下掉再弹回」的来源。

## 启动种子（Host）

1. 第一次排序或第一次路由请求时读一次置顶状态：先尝试把老文件
   `<DSH_HOME>/workspace-recency-order/pins.json` 导入存储领域（领域里已有记录就跳过，规则见
   [formats.md](formats.md#老数据迁移)），再从 `pins` 表读出全部记录。领域打不开、记录读不出来都当空
   列表，只在失败时留一条 `warn`；读出来的 id 按注册表过滤，被删掉的工作区会顺手从领域里清掉。之后
   再读都复用这一次的结果。
2. `sortOnStart` 为真时，`inject(['sessionController'])` 拿可选服务——没有这个服务时种子跳过，
   事件驱动那一半照常工作。`sessionController.list({}, signal)` 取全部会话摘要，把 `updatedAt`
   记进内存表；子智能体会话（`origin === 'subagent'`）跳过。`signal` 由 `effect` 的清理函数
   `abort`。
3. 调一次 `sortNow()`：与上面第 5–7 步同一段代码。
4. `sortOnStart` 为假时也调一次 `sortNow()`：这一轮所有工作区排名都是 0，所以只有置顶项会被挪到
   开头，其余顺序保持原样；没有置顶项时 `nextMove()` 返回 `null`，不写盘。
5. `list()` 失败：若已经 abort 就静默返回（插件正在被卸载）；否则 `warn`
   （`startup sort skipped: …`），不抛。

## 置顶 / 取消置顶（Client → Host）

1. 用户在「…」菜单里点那一项 → `togglePin(workspaceId)`：目标状态 = 当前列表里没有它 ? 置顶 : 取消。
2. `POST /api/workspace-recency/pins`，body 是 `{ "workspaceId": "…", "pinned": true | false }`。
3. 宿主：形状校验 → 幂等切换（已经是要的状态就什么都不做）→ 有变化才写记录 → 有变化才重排。
4. 宿主回答它当前那份列表；页面用这份回答替换自己的状态（菜单文字跟着变），再提示「已置顶」或
   「已取消置顶」。
5. 请求失败（路由不可用、断线、宿主拒绝）：不改状态，30 秒内只提示一次，并补读一次宿主列表——别让
   菜单一直显示旧状态。

页面不先改本地再回滚：宿主是唯一权威。置顶项的顺序完全由宿主那边排，页面只发命令、只显示回答。

## 置顶列表的路由（Host）

- 路由在 `apply()` 里通过 `ctx.inject(['connection'], …)` 注册，路径 `/api/workspace-recency/pins`，
  方法 `GET` / `POST`，请求体按缓冲处理；处理函数在 `src/route.ts`，不依赖 Cordis。
- 只有通过浏览器登录校验、身份是 owner 的会话能访问；其他身份由宿主直接回 403，Host/Origin 检查也
  由宿主先做。
- `GET`：等置顶列表读完，回答 `{ "pinned": [...] }`。
- `POST`：请求体不是 JSON、`workspaceId` 不是非空字符串、`pinned` 不是布尔 → 400；插件正在卸载时
  503；其它方法 405。
- 写入串行：内存更新 → 写领域记录（失败只 `warn`，内存照样生效）→ 走一遍 `sortNow()` → 回答。两次
  写入并发时按到达顺序排队，后一份基于前一份的结果算；同一条命令重复发送不会重复添加，也不会多写一次。

## 页面重新读（Client）

1. 页面加载时 `GET` 一次，菜单的「置顶/取消」状态以它为准。
2. 切回这个窗口（`focus`）、标签页重新可见（`visibilitychange` → `visible`）、网络恢复（`online`）
   时再 `GET` 一次，这样另一个页面改了置顶、或者宿主重启过，这个页面的菜单也会跟上。
3. 同一时刻只有一个读请求在飞：三个事件接连触发也只发一次。
4. `GET` 失败时保持现状，不提示——菜单先按「没置顶」显示，等下一次成功的读取或一次切换来纠正。
5. 页面卸载时中止在途请求；中止引起的失败不提示。

## 权限拒绝

`remoteAccess.source('workspace', id, 'workspace/insertBefore')` 明确返回 `false` 时，菜单项根本
不出现；用户看不到一个点了会失败的入口。拿不到权限服务时按允许处理（见
[design.md](design.md#菜单项)）。

## 卸载

- Host：`ctx.effect` 的清理函数把 `stopped` 置真、清掉待跑的定时器；路由随 `ctx.inject` 的子级
  一起摘掉；已经在跑的那一轮结束后不再排新的。关闭存储领域的清理函数返回 promise，宿主会等它关完
  再卸下插件——不等的话紧接着重新加载会撞上同一个领域名（`already-open`）。
- Client：`ctx.effect` 返回的清理函数摘掉菜单注册、事件监听、插槽，并中止在途请求。
- 存储领域里的置顶记录**留着**——重装插件后用户的置顶还在。
