# 内部机制（决策地图）

一句话模型：**Host 端按宿主事件算出顺序、写进工作区注册表；剩下的一件宿主做不到的事——固定——由
页面存在浏览器里并持续纠正。** 这一份文档按主题索引决策，并写下没有笔记承载的那部分机制。

## 决策地图

| 主题 | 结论 | 依据 |
| --- | --- | --- |
| 顺序写在哪 | 宿主工作区注册表（`insertBefore`），不是浏览器渲染 | [笔记](../.agents/notes/implemented/architecture/2026-11-14-order-is-the-hosts-workspace-registry.md) |
| 什么算活动 | 人类消息 + 新会话；子智能体、已归档、未分组不算 | [笔记](../.agents/notes/implemented/feature/2026-11-14-only-human-messages-move-a-workspace.md) |
| 固定存哪 | 当前浏览器的 `localStorage`，页面维持 | [笔记](../.agents/notes/implemented/architecture/2026-11-14-pin-lives-in-the-browser.md) |
| 多页面抢顺序 | 节流 + 合并 + 30 秒让位 | [笔记](../.agents/notes/implemented/architecture/2026-11-14-yield-to-the-other-page.md) |
| 客户端产物形状 | 经典脚本，只 require `react` 基线 | [笔记](../.agents/notes/implemented/architecture/2026-11-14-client-artifact-is-a-classic-script.md) |
| 测试怎么跑 | 进程内 runner，`.test.ts` 进类型检查 | [笔记](../.agents/notes/implemented/testing/2026-11-14-tests-run-in-one-process.md) |

## 宿主的接口面

插件**不 import 任何 DSH 包**：用到哪些成员，就在 `src/types.ts` 与 `src/client/types.ts` 里就地
声明那几行结构类型，产物里因此一个 `require` 都不多。核对权威实现的位置：

**Host 侧**（`src/index.ts`）：

- `workspaceRegistry.list()`：当前顺序里的工作区（`id` + `sessionIds`）。
- `workspaceRegistry.insertBefore(id, beforeId?)`：把 `id` 移到 `beforeId` 前面，返回新顺序；这是
  唯一的写入口。
- `workspaceRegistry.archivedSessionIds`：注册表全局的归档集合，可能不存在（当空集处理）。
- 事件 `api-session/activity`：只在人类消息时触发，参数是 `(sessionId, updatedAt)`。
- 事件 `api-session/added`：新会话，参数是会话摘要。
- `inject(['sessionController'])`：可选；`list()` 返回全部会话摘要，`signal` 用来中途放弃。

**Client 侧**（`src/client/index.ts`）：

- `workspaces.list.getSnapshot()` / `.subscribe()`：快照带 `phase`（`pending` / `ready`）与
  `state`（`idle` / `loading` / `error`）。
- `workspaces.insertBefore(id, beforeId?)`：浏览器侧的同一个写入口。
- `contextMenus.register()` / `notify()`：工作区行的「…」菜单与提示。
- `slots.inject('contextMenu.icon')` / `slots.register()`：菜单图标。
- `locale.bind()` / `register()`：界面文案。
- `get('remoteAccess')`：可选，查「这个连接允许改工作区顺序吗」。

## 没有笔记承载的机制

**单步移动。** `nextMove()` 只指出第一处错位，`sortNow()` 一次只发一个 `insertBefore`，然后重新读。
代价是 N 个工作区最坏要 N 次写，换来的是「每一步都基于刚读到的真实顺序」——并发的拖动、别的页面
的固定都不会被本地快照覆盖。这条是
[顺序改的是宿主注册表](../.agents/notes/implemented/architecture/2026-11-14-order-is-the-hosts-workspace-registry.md)
的推论，没有单独的笔记。

**队列与去抖。** `schedule()` 用 `debounceMs` 合并连续事件，`queue` 把重排串成一条链——前一轮没
写完就不开下一轮。定时器 `unref()`，插件挂着的待跑任务不会拖住宿主退出。

**固定项的前缀顺序。** `movePinsToFront()` 从列表**末尾**往前逐个 `insertBefore(固定项, 当前第一
行)`：每挪一个，它就成了新的第一行，于是最后一次移动的是最靠前的固定项。这个循环是「最近固定的在
前」的实现细节，没有对外契约的含义。

**清理失效固定项的时机。** 只在快照完整时清理（`settled()`），否则断线一次就可能把用户的固定全删
了。这条在 [design.md](design.md) 与 [flows.md](flows.md) 里都提到了，因为它同时是界面预期。

**自检的两个层次。** `scripts/check-package.mjs` 只读文件：导出路径存在、`cordis.patch.yml` 里有
本包名、`files` 带齐运行时文件、语言资源两份都在。`test/artifact.test.mjs` 真的执行产物：按宿主
方式加载 `lib/client.js`、在假上下文里 `apply()` 一次 `lib/index.js`。前者能在没有构建的机器上跑，
后者需要先 `pnpm run build`。
