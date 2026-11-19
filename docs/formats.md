# 落盘与跨进程的格式

本插件自己不再写任何文件：置顶列表交给宿主的存储设施（`ctx.storageDomain`），文件放在哪、长什么样
由官方的 JSON 后端决定。其余写的是宿主的工作区注册表、走的是宿主的连接路由。这里记清这些形状、老
数据的迁移，以及配置与语言键的键名——改名就是改契约。

## 宿主工作区注册表

文件在 DSH 的数据目录里：`<DSH_HOME>/storages/workspace.json`（默认 `~/.dsh/storages/workspace.json`）。
本机这份约 67 KB。

```json
{
  "unit": { "name": "workspace", "version": 2 },
  "global": {
    "initialized": true,
    "workspaceIds": ["7a34ed08-…", "a9e897b8-…", "198291f6-…"]
  }
}
```

- **只有 `global.workspaceIds` 的顺序有意义**：它就是这个工作区列表的持久顺序，侧边栏按它渲染。
- 本插件**不读写这个文件**，只调注册表服务的 `insertBefore(id, beforeId)`：移动一个工作区到另一个
  工作区前面（`beforeId` 省略时移到末尾），宿主负责写盘。
- 工作区的其他字段（id、标题、路径、`sessionIds`）由宿主自己维护；插件只读 `id` 与 `sessionIds`。
- 工作区里没有任何会话、或会话全被归档时，它在排序里的活跃时间算 `0`——也就是排在所有有活动的工作区
  后面，彼此保持原相对顺序。

## 置顶列表（存储领域）

| 项 | 值 |
| --- | --- |
| 领域 | `workspace_recency_order`，版本 `1`，`single` 布局 |
| 表 | `pins`：键是工作区 id，值是 `{ "pinnedAt": <epoch 毫秒> }` |
| 位置 | `<DSH_HOME>/storages/workspace_recency_order.json`，默认 `~/.dsh/storages/workspace_recency_order.json` |
| 顺序 | 读出时按 `pinnedAt` 升序；越大越晚置顶，新的置顶项排在末尾 |
| 写入 | 只写变化：置顶 = 写一条记录（时刻取 `max(现在, 现有最大值 + 1)`），取消 = 删那条记录 |
| 读取 | 领域打不开、记录读不出来一律当空列表，只留一条 `warn`；重复 id 只留第一条 |
| 过滤 | 读出来与每次写入都按注册表过滤，被删掉的工作区不会一直占着开头 |

盘上的样子（`global` 恒为 `null`：这个领域没有全局槽）：

```json
{
  "unit": { "name": "workspace_recency_order", "version": 1 },
  "global": null,
  "tables": {
    "pins": {
      "0b707c35-…": { "pinnedAt": 1763512345678 },
      "a9e897b8-…": { "pinnedAt": 1763512401999 }
    }
  }
}
```

- 位置由官方 JSON 后端的 `root` 决定；`dsh-base` 里配的是 `!!js dshHomePath('storages')`，领域名就是
  文件名（`<name>.json`），插件不参与拼路径。
- 记录 schema 是 zod 的 `z.object({ pinnedAt: z.number().int().nonnegative() })`；宿主在打开领域时
  按它校验每条记录，不合规会让打开失败。领域名与表名必须匹配宿主的 `UNIT_NAME_RE`
  （`^[a-z][a-z0-9_]*$`）。
- 整个领域是一个文件，后端每次写入都原子重写它（同目录临时文件 + 改名），不会留下半个文件；插件这边
  一次切换只改一条记录。
- 写失败只留一条 `warn`，内存里那份照样生效；下次切换会再写一次。
- 领域跟着这台机器的 `DSH_HOME` 走：同一台机器上的所有浏览器看到同一份，换机器要重新置顶。
- 想清空置顶：删掉 `storages/workspace_recency_order.json`（宿主重启后生效），或在页面上逐个取
  消置顶。

## 老数据迁移

老版本把列表写在 `<DSH_HOME>/workspace-recency-order/pins.json`：

```json
{ "version": 1, "workspaceIds": ["…", "…"] }
```

插件第一次读取置顶列表时尝试一次迁移（`PinStore.load()` → `migrateLegacyPins()`），规则：

| 情况 | 行为 |
| --- | --- |
| 文件不存在 | 什么都不做，不告警 |
| 领域里已经有记录 | 不再导入，旧文件原样留着（还在原处，但不再被读取） |
| 形状认识、领域是空的 | 按 `workspaceIds` 的先后导入，`pinnedAt` 用 1、2、3……递增；之后把文件改名成 `pins.json.migrated` |
| JSON 坏掉、`version` 不认识、没有 `workspaceIds` | 留一条 `warn`，文件原样留着 |
| 写领域失败 | 留一条 `warn`，尽力撤回写了一半的记录，文件原样留着给下次启动重试 |

- 迁移幂等：成功后旧文件已改名、领域也非空，不会再导入第二遍。
- 改名而不是删除：用户可能想核对两份数据。
- 迁移失败不影响插件启动：读不到就当空列表，这一轮排序只是没有置顶项。

## 置顶列表的 HTTP 路由

请求与响应形状在 `src/protocol.ts` 里，Host 与页面共用这一份。

| 项 | 值 |
| --- | --- |
| 路径 | `GET` / `POST /api/workspace-recency/pins` |
| 注册 | `ctx.connection.fetch.register()`，只对通过登录校验、身份是 owner 的浏览器会话开放 |
| 读 | `GET` → `{ "pinned": ["…"] }` |
| 写 | `POST { "workspaceId": "…", "pinned": true \| false }` → `{ "pinned": ["…"] }` |
| 幂等 | `pinned` 是目标状态：同一条命令重复发送不会重复添加；状态没变时不重排、不写盘 |
| 失败 | 请求体不是 JSON、或 `workspaceId` / `pinned` 类型不对 → 400；插件正在卸载 → 503；其它方法 → 405 |

页面用 `new URL('api/workspace-recency/pins', document.baseURI)` 拼地址，同源请求自带登录 Cookie；
不需要也不接受额外的令牌。写操作传的是「把谁设成什么」，不是整份列表——两个页面同时点不会互相覆盖，
页面也不需要先读一遍再算新列表。

## 配置对象

配置来自 `cordis.patch.yml` 里本插件那一行的 `config`（用户补丁层可以整段覆盖）。解析在
`src/options.ts` 的 `readOptions()`，顺序：未知键 → 告警并忽略；字符串 `"true"` / `"false"` 按布尔
收；其余不合法取值 → 告警并回落到默认值。

| 键 | 类型 | 默认 | 作用 |
| --- | --- | --- | --- |
| `enabled` | 布尔 | `true` | 总开关；`false` 时 `apply()` 直接返回，不注册任何监听 |
| `sortOnStart` | 布尔 | `true` | 启动时按 `sessionController.list()` 整理一次顺序 |
| `trackNewSessions` | 布尔 | `true` | 新建会话（含空会话）也把所属工作区提到最前 |
| `debounceMs` | 非负有限数 | `600` | 连续活动合并成一次重排的等待时间（毫秒）；`0` 表示下一轮事件循环就排 |

写错的键名不会静默变形：`readOptions()` 会留一条 `ignoring unknown config key "…"` 的 `warn`。

## 语言键

命名空间 `workspace-recency`，中英各一份（`src/client/index.ts` 的 `DICT`），五条：

| 键 | 用在哪 |
| --- | --- |
| `pin` | 菜单项：置顶这个工作区 |
| `unpin` | 菜单项：取消置顶 |
| `pinnedToast` | 置顶成功后的提示 |
| `unpinnedToast` | 取消置顶后的提示 |
| `failed` | 读写置顶列表失败（30 秒内只提示一次） |

包级文案（插件列表里的标题与说明）在 `locale/zh.json` 与 `locale/en.json` 的 `meta` 里，由
`scripts/check-package.mjs` 核「两份都在，且 `meta.title` / `meta.description` 都有」。

## 插件的 manifest 与补丁行

- `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，里面有一行 `- insert:`，插件的
  `id` 是 `workspace-recency-order`，`config` 就是上面那张表的初值。
- `package.json` 的 `dsh.client.inject` 列出客户端要用的官方服务包（`dsh-client-ui-context-menu`、
  `dsh-client-ui-workspace`）；这两个只是**加载顺序**声明，客户端产物本身仍然只 require 基线模块。
