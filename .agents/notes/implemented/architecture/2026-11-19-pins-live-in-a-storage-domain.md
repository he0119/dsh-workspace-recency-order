# Agent Note: 置顶列表改用宿主的存储领域，不再自己写 JSON 文件

Status: implemented

## Problem

置顶列表是这个插件唯一的持久状态（它为什么归宿主而不归页面，见
[这篇](2026-11-14-pins-live-in-the-host.md)）。它原先自己拼路径，把 `{ version, workspaceIds }` 写到
`<DSH_HOME>/workspace-recency-order/pins.json`：在 `$DSH_HOME` 根目录下占一个以插件名命名的目录，
自己实现「临时文件 + 改名」的原子写、自己判断 JSON 形状、读不懂就当空列表。

宿主本来就有统一的宿主侧数据设施：工作区注册表（`workspace.json`）和会话投影缓存都放在
`<DSH_HOME>/storages/` 下，由官方的 JSON 后端按「一个领域一份文件」管理，打开时按 zod schema 校验每
条记录、写入按领域串行。插件在旁边另开一个目录，代价是：

- 备份、清理、迁移、按实例隔离这些事，插件得自己记得一份；`storages/` 里有的东西，插件这份没有。
- 路径用的是 `process.env.DSH_HOME` 加 `homedir()`，与宿主的 `dshHomePath()` 规则各写一遍。
- 原子写、损坏恢复、形状判断在每个插件里各实现一次，做法容易互不一致。
- 没有 schema：形状错了只能靠手写分支判断，写错一个字段要等运行时才发现。

## Decision

置顶列表存进宿主声明式存储：领域 `workspace_recency_order`（版本 1、`single` 布局），一张 `pins`
表，键是工作区 id，值是 `{ pinnedAt }`（epoch 毫秒）。落盘位置由官方 JSON 后端决定，现在是
`<DSH_HOME>/storages/workspace_recency_order.json`，与工作区注册表同一个目录。

- 置顶 = 追加一条记录，时刻取 `max(现在, 现有最大值 + 1)`，保证严格递增；取消置顶 = 删掉那条记录。
  读出时按 `pinnedAt` 升序，所以顺序是数据本身，不再依赖文件里的数组位置。
- `PinStore` 只依赖 `src/pins.ts` 里的 `PinStateStore` 接口（读全部、写一条、删一条）。真实实现把
  领域表的 `entries` / `put` / `delete` 包一层；单元测试换成内存假实现，因此没有一条用例需要真实
  `storageDomain` 或真实宿主。
- `inject` 加上 `storageDomain`：没有存储就记不住置顶，插件索性不激活，而不是装作能用。
- 领域是异步打开的，打开失败不拦插件：第一次读写时留一条 `warn`、按空列表走，排序照常（这一轮只是
  没有置顶项）。卸载时用 `ctx.effect` 的清理函数 `domain.close()`。
- 老数据迁移：第一次读取时，如果 `pins.json` 还在、形状认识、领域里一条记录都没有，就按
  `workspaceIds` 的先后导入（`pinnedAt` 用 1、2、3……递增），成功后把文件改名成
  `pins.json.migrated`。领域已有记录就跳过；JSON 坏掉或形状不认识只告警、文件原样留着；写领域失败
  尽力撤回写了一半的记录，下次启动能重试。规则表在
  [docs/formats.md](../../../../docs/formats.md#老数据迁移)。
- 依赖照 `dsh-context` 的写法分两类：`@deepseek-ai/dsh-storage-domain` 放 `peerDependencies`
  （`>=0.2.2-rc.3 <0.3.0`，另在 `devDependencies` 里放一份给类型检查与构建），`zod` 放
  `dependencies` 并锁精确 `4.6.6`。`@deepseek-ai/dsh-storage` 不声明——本插件没有 import 它。
  依据：宿主启动时用 `dsh-app-boot` 的 `createRuntimeResolution()` + `installRuntimeInterception()`
  把整个安装目录的依赖图装成包映射（这份安装 588 条，含 `dsh-storage-domain@0.2.2-rc.3`），所以 peer
  在 DSH 里解析到的是宿主那一份；`zod` 必须自己带且锁精确版本，因为 `domainTable()` 要的 `ZodType`
  得与 storage-domain 自带那份同版本（`^4.6.6` 装成 4.6.7 会即时类型不兼容）。

## Alternatives considered

**保持自有 JSON 文件，只把目录挪进 `storages/`。** 能消掉 `$DSH_HOME` 根目录那个目录，但
`storages/` 下的每份文件都该是后端管理的单元：占了名字却没有 schema 校验、没有写入串行，原子写还得
自己维护。落选。

**改用 `per-record` 布局（一条记录一个文件）。** 置顶记录很少、总是整份读，换来的是一堆小文件与目录
树；单条写入省下的那点开销对这个数据量没有意义。落选。

**把两个包都放 `dependencies`，让插件自带一份存储实现。** 最初这么做过：脱离 DSH 的纯 Node
也能 `import` 产物，看起来更「自足」。代价是 profile 里多一份 `dsh-storage-domain`、一份
`dsh-storage`，连带多一份 zod；实装时已经撞到两份 zod 让 `domainTable()` 的类型不兼容，只好把 zod
锁成精确版本。同一进程里出现两套领域实现也不值得。改成 peer 之后这些都没有了。落选。

**把置顶塞进宿主自己的 `workspace` 领域。** 那是宿主所有的领域，版本与 schema 归宿主；插件去写别人的
记录，会在宿主升级领域版本时被一起绑死，而且工作区记录按 id 建，「置顶的先后」还得另外表达。落选。

**不迁移，升级后从零开始。** 置顶是用户点出来的可见状态，升级一次全没了不可接受。落选。

**给领域加 `invalidRecords: 'backup-and-skip'`，让坏记录被挪开。** 这个策略需要后端能把单条记录的
文件挪走；`single` 布局整个领域只有一个文件，没有可挪的单条文档，宿主会退回「整份打开失败」。因此
没有声明它，而是把记录 schema 压到最小（只有一个非负整数），让坏记录几乎不可能出现。

## Consequences

- `$DSH_HOME` 根目录不再多一个 `workspace-recency-order/` 目录；置顶数据与工作区注册表放在同一个
  `storages/` 里，备份与清理口径一致。
- 产物因此有真的 `import`：`@deepseek-ai/dsh-storage-domain`（peer，宿主提供）与 `zod`
  （`dependencies`，随包安装）。脱离 DSH 进程直接 `import` 产物会找不到 peer，这是有意的边界。
- 一条记录不合 schema 会让整个领域打不开（宿主的打开策略），此时插件按空列表走、留一条 `warn`：置顶
  暂时失效，但排序与插件其余部分不受影响。
- 迁移只发生一次，成功后旧文件改名。想回退到老版本，把 `pins.json.migrated` 改回 `pins.json` 即可，
  老版本读得懂。
- 测试与宿主的存储实现彻底解耦：`PinStore` 的用例只依赖内存假实现，迁移用例只依赖临时目录里的一个
  文件。
- 领域名、表名、记录 schema 现在是跨版本契约（`^[a-z][a-z0-9_]*$`、`pinnedAt` 是非负整数），改名或
  改形状等于改存储格式，要升领域版本，见 [docs/formats.md](../../../../docs/formats.md)。
