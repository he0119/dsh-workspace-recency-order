# 内部机制（决策地图）

一句话模型：**Host 端按宿主事件算出顺序、写进工作区注册表；置顶列表也存在 Host，页面只在菜单里
读写它。** 顺序只有一个写手，所以置顶项不会在活动之后被挤下去再弹回来。这一份文档按主题索引决策，
并写下没有笔记承载的那部分机制。

## 决策地图

| 主题 | 结论 | 依据 |
| --- | --- | --- |
| 顺序写在哪 | 宿主工作区注册表（`insertBefore`），不是浏览器渲染 | [笔记](../.agents/notes/implemented/architecture/2026-11-14-order-is-the-hosts-workspace-registry.md) |
| 什么算活动 | 人类消息 + 新会话；子智能体、已归档、未分组不算 | [笔记](../.agents/notes/implemented/feature/2026-11-14-only-human-messages-move-a-workspace.md) |
| 置顶列表存哪、谁来纠正 | 宿主（认证路由 + 幂等命令），页面只读写、不挪顺序 | [笔记](../.agents/notes/implemented/architecture/2026-11-14-pins-live-in-the-host.md) |
| 置顶状态落在哪个设施 | 宿主的存储领域 `workspace_recency_order`（`pins` 表），不再自己写 JSON 文件 | [笔记](../.agents/notes/implemented/architecture/2026-11-19-pins-live-in-a-storage-domain.md) |
| 客户端产物形状 | 经典脚本，只 require `react` 基线 | [笔记](../.agents/notes/implemented/architecture/2026-11-14-client-artifact-is-a-classic-script.md) |
| 测试怎么跑 | 进程内 runner，`.test.ts` 进类型检查 | [笔记](../.agents/notes/implemented/testing/2026-11-14-tests-run-in-one-process.md) |
| 怎么发出去 | npm 包，推 `v*` 标签触发 Publish；产物不进 git，发布时由 `prepare` 现场构建 | [笔记](../.agents/notes/implemented/process/2026-11-15-publish-from-tag.md) |

## 宿主的接口面

插件用到哪些服务成员，就在 `src/types.ts` 与 `src/client/types.ts` 里就地声明那几行结构类型；
唯一的例外是领域声明 `src/spec.ts`——`defineDomain()` 与 zod schema 只能真的 import 官方包
（`@deepseek-ai/dsh-storage-domain` 见 `peerDependencies`、`zod` 见 `dependencies`）。核对位置：

**Host 侧**（`src/index.ts`）：

- `workspaceRegistry.list()`：当前顺序里的工作区（`id` + `sessionIds`）。
- `workspaceRegistry.insertBefore(id, beforeId?)`：把 `id` 移到 `beforeId` 前面，返回新顺序；这是
  唯一的写入口。
- `workspaceRegistry.archivedSessionIds`：注册表全局的归档集合，可能不存在（当空集处理）。
- 事件 `api-session/activity`：只在人类消息时触发，参数是 `(sessionId, updatedAt)`。
- 事件 `api-session/added`：新会话，参数是会话摘要。
- `inject(['sessionController'])`：可选；`list()` 返回全部会话摘要，`signal` 用来中途放弃。
- `inject(['connection'])`：可选；`connection.fetch.register()` 注册置顶列表的 `GET`/`POST` 路由，
  宿主负责登录校验、Host/Origin 检查与请求体读取方式。
- `ctx.storageDomain.open(pinDomainSpec)`：置顶记录的持久化；返回的句柄取 `table('pins')`，
  `close()` 在插件卸载时调用。打开失败不拦插件，读的时候按空列表走。

**Client 侧**（`src/client/index.ts`）：

- `contextMenus.register()` / `notify()`：工作区行的「…」菜单与提示。
- `slots.inject('contextMenu.icon')` / `slots.register()`：菜单图标。
- `locale.bind()` / `register()`：界面文案。
- `get('remoteAccess')`：可选，查「这个连接允许改工作区顺序吗」。
- 浏览器的 `fetch()`：读写 `api/workspace-recency/pins`，同源请求自带登录 Cookie；请求与响应的形状
  来自 `src/protocol.ts`（Host 与页面共用一份）。

## 没有笔记承载的机制

**置顶项是排序的前缀。** `orderByActivity()` 的第三个参数是置顶 id 集合：这些工作区整体排在开头，
组内和其余工作区一样按活跃时间排，排名相同（含都是 0）时保持注册表里的当前顺序。于是「在置顶工作区
里发消息会把它顶到组内最前」不是额外规则，而是同一个排序键的副作用。

**单步移动。** `nextMove()` 只指出第一处错位，`sortNow()` 一次只发一个 `insertBefore`，然后重新读。
代价是 N 个工作区最坏要 N 次写，换来的是「每一步都基于刚读到的真实顺序」——并发的拖动、别的页面的
置顶都不会被本地快照覆盖。这条是
[顺序改的是宿主注册表](../.agents/notes/implemented/architecture/2026-11-14-order-is-the-hosts-workspace-registry.md)
的推论，没有单独的笔记。

**队列与去抖。** 所有写顺序的操作（活动触发的排序、切换置顶触发的排序）都走同一条 `serial()` 队列，
`schedule()` 再用 `debounceMs` 合并连续事件——前一轮没写完就不开下一轮。定时器 `unref()`，插件挂着
的待跑任务不会拖住宿主退出。

**置顶列表的读写时机。** 页面加载、切回窗口、网络恢复时读；点菜单时发一条幂等的切换命令
（`{ workspaceId, pinned }`），由宿主算新列表再回答。同一时刻只有一个读请求在飞，页面卸载时中止在途
请求；读失败不提示（菜单先按「没置顶」显示），写失败 30 秒内只提示一次并补读一次。这条的界面表现
写在 [design.md](design.md)，形状写在 [formats.md](formats.md)。

**自检的两个层次。** `scripts/check-package.mjs` 只读文件：导出路径存在、`cordis.patch.yml` 里有
本包名、`files` 带齐运行时文件、语言资源两份都在。`test/artifact.test.mjs` 真的执行产物：按宿主
方式加载 `lib/client.js`、在假上下文里 `apply()` 一次 `lib/index.js`。前者能在没有构建的机器上跑，
后者需要先 `pnpm run build`。
