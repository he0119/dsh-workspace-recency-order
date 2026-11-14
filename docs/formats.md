# 落盘与跨进程的格式

本插件自己不定义文件格式：它写的是宿主的工作区注册表，存的是浏览器的一份偏好。这里记清两者的形状，
以及配置与语言键的键名——改名就是改契约。

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

## 浏览器里的固定列表

| 项 | 值 |
| --- | --- |
| 存储 | `window.localStorage` |
| 键 | `dsh.workspace-recency.pinned-workspaces.v1` |
| 值 | JSON 字符串数组，元素是工作区 id |
| 顺序 | 最近固定的在前；这个顺序就是固定项在侧边栏里的顺序 |

- 读取时去重（`new Set`），非字符串元素丢弃；解析失败、类型不对、存储不可用一律当空列表——不报错，
  也**不**把它当成「所有固定都取消了」写回去。
- 写入失败（隐私模式、站点数据被禁）由调用方提示「固定无法记住」，不回滚任何顺序。
- 只有快照完整（`phase === 'ready' && state === 'idle'`）时才清理「宿主里已经没有的 id」；加载中或
  断线时的快照不代表工作区被删了。
- 这份数据**不进**宿主存储，也不同步到别的设备。

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

命名空间 `workspace-recency`，中英各一份（`src/client/index.ts` 的 `DICT`），七条：

| 键 | 用在哪 |
| --- | --- |
| `pin` | 菜单项：固定这个工作区 |
| `unpin` | 菜单项：取消固定 |
| `pinnedToast` | 固定成功后的提示 |
| `unpinnedToast` | 取消固定后的提示 |
| `failed` | 调整顺序失败（30 秒内只提示一次） |
| `storageBlocked` | 浏览器不允许保存设置 |
| `yielding` | 检测到别的页面也在改顺序，暂停固定 30 秒 |

包级文案（插件列表里的标题与说明）在 `locale/zh.json` 与 `locale/en.json` 的 `meta` 里，由
`scripts/check-package.mjs` 核「两份都在，且 `meta.title` / `meta.description` 都有」。

## 插件的 manifest 与补丁行

- `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，里面有一行 `- insert:`，插件的
  `id` 是 `workspace-recency-order`，`config` 就是上面那张表的初值。
- `package.json` 的 `dsh.client.inject` 列出客户端要用的官方服务包（`dsh-client-ui-context-menu`、
  `dsh-client-ui-workspace`）；这两个只是**加载顺序**声明，客户端产物本身仍然只 require 基线模块。
