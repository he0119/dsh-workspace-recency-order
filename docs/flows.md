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
5. `sortNow()` 循环：`list()` 读注册表 → 每个工作区算「最近活动时刻」（跳过归档会话）→
   `orderByActivity()` 出目标顺序 → `nextMove()` 找第一处错位。
6. 有错位就 `insertBefore(该工作区, 错位处那个工作区)`，回到第 5 步；没错位就结束。最多重试
   「工作区个数」次，防止一边写一边被改时死循环。
7. `insertBefore` 抛错：记一条 `warn`（`reorder stopped after N move(s): …`）并**停止**这一轮，
   不重试。下一轮活动会重新读注册表，不需要手上有旧状态。

## 启动种子（Host）

1. `apply()` 里若 `sortOnStart` 为真，`inject(['sessionController'])` 拿可选服务——没有这个服务
   时整个种子跳过，事件驱动那一半照常工作。
2. `sessionController.list({}, signal)` 取全部会话摘要，把 `updatedAt` 记进内存表；子智能体会话
   （`origin === 'subagent'`）跳过。`signal` 由 `effect` 的清理函数 `abort`。
3. 调一次 `sortNow()`：与上面第 5–7 步同一段代码。
4. `list()` 失败：若已经 abort 就静默返回（插件正在被卸载）；否则 `warn`
   （`startup sort skipped: …`），不抛。

## 固定 / 取消固定（Client）

1. 用户在「…」菜单里点那一项 → `resolve()` 给出的 `run()` 调 `togglePin(workspaceId)`。
2. 读 `localStorage` 里的固定列表（键与形状见 [formats.md](formats.md)）。
3. **已固定 → 取消**：先把去掉这一项的列表写回；写不进去就提示「这个浏览器不允许保存设置」并结束。
   写成功提示「已取消固定」，然后跑一次 `enforce()` 让它回到活跃度顺序。
4. **未固定 → 固定**：把 id 插到列表最前并写回；写不进去同上。写成功调 `movePinsToFront()` 把固定
   项按顺序挪到最前。
5. `movePinsToFront()` 逐项 `insertBefore(固定项, 当前第一行)`，从最后一项往前挪，这样一个循环就能
   排成「最近固定的在前」。任何一次写被拒：把固定列表写回原样（回滚），提示一次失败。

## 宿主重排之后：把固定项拉回来（Client）

1. `ctx.workspaces.list.subscribe()` 收到新快照 → `enforce()`。
2. 让位还没结束（`now < pausedUntil`）就直接返回。
3. 正在跑（`busy`）就记一个 `pending`，等这一轮结束再跑一次——合并，不排队。
4. 固定列表为空、快照不完整（`phase !== 'ready'` 或 `state !== 'idle'`）、顺序为空：都返回。
5. 固定列表里宿主已经没有的 id：**只在快照完整时**清理（加载中的快照不代表工作区被删了）。
6. 固定项已经在最前：返回，不写。
7. 距上次纠正不到 600 毫秒：设一个 `trailing` 定时器，窗口结束再跑。
8. 否则真正挪：`movePinsToFront()`。失败 → 提示一次（30 秒内不重复）。成功 → 记一次纠正时间；
   10 秒内纠正到 4 次就停手 30 秒并提示一次。

## 权限拒绝

`remoteAccess.source('workspace', id, 'workspace/insertBefore')` 明确返回 `false` 时，菜单项根本
不出现；用户看不到一个点了会失败的入口。拿不到权限服务时按允许处理（见
[design.md](design.md#菜单项)）。

## 卸载

- Host：`ctx.effect` 的清理函数把 `stopped` 置真、清掉待跑的定时器；已经在跑的那一轮结束后不再排
  新的。
- Client：`ctx.effect` 返回的清理函数摘掉菜单注册、订阅与插槽；`localStorage` 里的固定列表**留着**
  ——重装插件后用户的固定还在。
