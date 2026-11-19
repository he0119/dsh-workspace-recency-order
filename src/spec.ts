/**
 * 置顶列表的存储领域声明 —— 走宿主的 `ctx.storageDomain`，不再自己拼路径写 JSON。
 *
 * 一个领域（domain）是一份有版本、有 schema 的宿主侧数据；后端（默认 `dsh-storage-json`）把它落到
 * `<DSH_HOME>/storages/` 下，位置与文件名由后端决定，插件不再关心。这张表一行一个工作区：
 *
 * - 键是工作区 id（宿主注册表里的那个 id，普通字符串）。
 * - 值至少含 `pinnedAt`（epoch 毫秒）：取消置顶就是删掉这一行，读出时按它升序还原先后。
 *
 * 两条硬约束直接来自宿主，写错了 `defineDomain()` 在模块加载时就抛：
 *
 * - 领域名与表名必须匹配 `UNIT_NAME_RE`（`@deepseek-ai/dsh-storage/src/backend.ts`），
 *   即 `^[a-z][a-z0-9_]*$`；
 * - 记录 schema 必须是 zod 的 `ZodType`（宿主 `dsh-storage-domain` 用 zod 4）。
 *
 * 本文件是本插件里唯一 import DSH 包的地方（`src/index.ts` 只把它整份交给宿主），所以单元测试不碰
 * 任何仓储实现：`PinStore` 只依赖 `src/pins.ts` 里那份结构化的状态接口。
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

/** 领域名。会成为后端里那一份存储单元的名字（`storages/workspace_recency_order.json`）。 */
export const PIN_DOMAIN_NAME = 'workspace_recency_order'

/** 表名：置顶记录。 */
export const PIN_TABLE_NAME = 'pins'

/** 领域格式版本。形状变了才加一；`single` 布局下版本不符会让宿主拒绝打开。 */
export const PIN_DOMAIN_VERSION = 1

/**
 * 一条置顶记录。`pinnedAt` 是置顶那一刻的 epoch 毫秒；同一批迁移进来的老数据用递增序号，
 * 只要保证「越大越晚置顶」。
 */
export const pinRecord = z.object({
  pinnedAt: z.number().int().nonnegative(),
})

/** 一条置顶记录的类型。 */
export type PinRecord = z.infer<typeof pinRecord>

/**
 * 领域声明：`single` 布局（整个领域一个文件），一张 `pins` 表。
 *
 * 键类型显式写 `string`（工作区 id 在别处是带 brand 的类型，但存储层只认普通字符串）。
 */
export const pinDomainSpec = defineDomain({
  name: PIN_DOMAIN_NAME,
  version: PIN_DOMAIN_VERSION,
  layout: 'single',
  tables: { [PIN_TABLE_NAME]: domainTable<string, PinRecord>(pinRecord) },
})
