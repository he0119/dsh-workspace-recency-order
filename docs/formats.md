# 落盘与跨进程的格式

本插件只定义一份自己的文件（固定列表），其余写的是宿主的工作区注册表、走的是宿主的连接路由。这里
记清它们的形状，以及配置与语言键的键名——改名就是改契约。

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

## 固定列表文件

| 项 | 值 |
| --- | --- |
| 位置 | `<DSH_HOME>/workspace-recency-order/pins.json`，默认 `~/.dsh/workspace-recency-order/pins.json` |
| 内容 | `{ "version": 1, "workspaceIds": ["…"] }` |
| 顺序 | 固定项加入时的先后；排序只用「是哪些」这个集合，组内顺序取自注册表当前顺序 |
| 写入 | 每次切换固定都整份重写：先写同目录临时文件，再改名覆盖，避免留下半个文件 |
| 读取 | 文件不存在、JSON 坏掉、没有 `workspaceIds`，一律当空列表；非字符串元素丢掉 |
| 过滤 | 读出来与每次写入都按注册表过滤，被删掉的工作区不会一直留在文件里 |

- 写失败只留一条 `warn`，内存里那份照样生效；下次切换会再写一次。
- 文件跟着这台机器的 `DSH_HOME` 走：同一台机器上的所有浏览器看到同一份，换机器要重新固定。
- 删掉这个文件就回到「没有固定」，宿主下次启动时读到空列表。

## 固定列表的 HTTP 路由

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
| `pin` | 菜单项：固定这个工作区 |
| `unpin` | 菜单项：取消固定 |
| `pinnedToast` | 固定成功后的提示 |
| `unpinnedToast` | 取消固定后的提示 |
| `failed` | 读写固定列表失败（30 秒内只提示一次） |

包级文案（插件列表里的标题与说明）在 `locale/zh.json` 与 `locale/en.json` 的 `meta` 里，由
`scripts/check-package.mjs` 核「两份都在，且 `meta.title` / `meta.description` 都有」。

## 插件的 manifest 与补丁行

- `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，里面有一行 `- insert:`，插件的
  `id` 是 `workspace-recency-order`，`config` 就是上面那张表的初值。
- `package.json` 的 `dsh.client.inject` 列出客户端要用的官方服务包（`dsh-client-ui-context-menu`、
  `dsh-client-ui-workspace`）；这两个只是**加载顺序**声明，客户端产物本身仍然只 require 基线模块。
