/**
 * 置顶列表的宿主侧状态：内存里一份按 `pinnedAt` 升序的记录，落盘交给构造时给的状态接口。
 *
 * 置顶列表归宿主：谁置顶了哪些工作区是这份部署的状态，不是某个标签页的临时状态。真实的状态接口由
 * `src/index.ts` 用 `ctx.storageDomain` 打开 `src/spec.ts` 声明的领域后接上来；单元测试换成内存假
 * 实现。读不懂、读不出来一律当空列表——置顶不该因为一份坏数据把插件拖垮。
 *
 * 老版本把列表写在 `<DSH_HOME>/workspace-recency-order/pins.json`。那些文件由
 * {@link migrateLegacyPins} 一次性导入领域并改名成 `pins.json.migrated`，之后不再被读取。
 */
import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

import type { PinRecord } from './spec.ts'

/** 老版本留下的文件名；只用于迁移，不再是权威落盘位置。 */
export const PINS_FILE = 'pins.json'

/** 迁移完成后旧文件的新后缀名：留在原地给用户核对，不再被读取。 */
export const MIGRATED_SUFFIX = '.migrated'

/** 老文件的格式版本；形状变了就换它，读到不认识的值当没迁移过。 */
export const PINS_VERSION = 1

/**
 * 老文件的路径：`<DSH_HOME>/workspace-recency-order/pins.json`。现在只有迁移会用到它。
 * @param env - 进程环境；读 `DSH_HOME`，空白值当没设。
 * @param home - 操作系统主目录，只在没有 `DSH_HOME` 时用到。
 * @returns 绝对路径（目录不一定存在）。
 */
export function pinsPath(env: Record<string, string | undefined>, home: string): string {
  const configured = env.DSH_HOME?.trim()
  const base = configured !== undefined && configured !== '' ? configured : join(home, '.dsh')
  return join(base, 'workspace-recency-order', PINS_FILE)
}

/** 一条已存下来的置顶记录：哪个工作区，什么时候被置顶。 */
export interface StoredPin {
  readonly workspaceId: string
  /** epoch 毫秒；越大越晚置顶，读出时按它升序排。 */
  readonly pinnedAt: number
}

/**
 * 置顶记录的读写口子。
 *
 * 这是本插件唯一接触持久状态的地方：真实实现把 `pins` 领域表的 `put`/`delete` 包一层
 * （见 {@link pinStateFromTable}），测试里换成内存里的一个 `Map`。
 */
export interface PinStateStore {
  /** 读出全部记录，顺序不作要求。 */
  read(): Promise<readonly StoredPin[]>
  /** 写入或覆盖一条记录（同一个工作区只留一条）。 */
  put(workspaceId: string, pinnedAt: number): Promise<void>
  /** 删掉一个工作区的记录；本来就没有也算成功。 */
  remove(workspaceId: string): Promise<void>
}

/** 领域表句柄里本插件用到的成员（`KvTable` 的一个结构化子集）。 */
export interface PinTable {
  entries(): IterableIterator<[string, PinRecord]>
  put(key: string, value: PinRecord): Promise<void>
  delete(key: string): Promise<boolean>
}

/**
 * 把领域表的句柄包成 {@link PinStateStore}。
 * @param loading - 打开领域、拿到表的承诺；读取与写入都会等它。
 * @returns 直接交给 `PinStore` 的状态接口；打开失败时读写各自拒绝，由 `PinStore` 统一告警。
 */
export function pinStateFromTable(loading: Promise<PinTable>): PinStateStore {
  return {
    async read() {
      const pins: StoredPin[] = []
      for (const [workspaceId, record] of (await loading).entries()) {
        pins.push({ workspaceId, pinnedAt: record.pinnedAt })
      }
      return pins
    },
    async put(workspaceId, pinnedAt) {
      await (await loading).put(workspaceId, { pinnedAt })
    },
    async remove(workspaceId) {
      await (await loading).delete(workspaceId)
    },
  }
}

/** 按置顶时刻升序（数值相同时保持原顺序，`sort` 是稳定的）。 */
const byPinnedAt = (left: StoredPin, right: StoredPin): number => left.pinnedAt - right.pinnedAt

/** 两份记录是否完全一样（含顺序与时刻）。 */
const samePins = (left: readonly StoredPin[], right: readonly StoredPin[]): boolean =>
  left.length === right.length
  && left.every((pin, index) => pin.workspaceId === right[index]!.workspaceId
    && pin.pinnedAt === right[index]!.pinnedAt)

/** `PinStore` 需要的宿主事实。 */
export interface PinStoreOptions {
  /** 记录的读写口子。 */
  readonly state: PinStateStore
  /** 老版本那个 `pins.json` 的位置；给了才在第一次读时尝试一次性迁移。 */
  readonly legacyFile?: string
  /** 注册表里还有的工作区 id；读状态与每次写入时用它丢掉失效项。 */
  readonly knownIds: () => ReadonlySet<string>
  /** 读写状态、迁移的失败汇报。 */
  readonly warn: (message: string) => void
}

/**
 * 置顶列表的内存状态与落盘。
 *
 * 所有方法都可以并发调用：`load()` 只读一次状态，`toggle()` 串行地改内存再落盘（调用方还要保证
 * 顺序写操作串行，见 `src/index.ts` 的 `serial()`）。
 */
export class PinStore {
  /** 按 `pinnedAt` 升序；对外的 `ids` 就是它的投影。 */
  #pins: StoredPin[] = []
  #loading: Promise<void> | undefined
  /** 切换操作串行执行：两个页面同时发命令时，后一个基于前一个的结果算，写入不会互相覆盖。 */
  #mutating: Promise<void> = Promise.resolve()

  readonly #options: PinStoreOptions

  /**
   * @param options - 状态接口、老文件位置、注册表事实与告警回调。
   */
  constructor(options: PinStoreOptions) {
    this.#options = options
  }

  /** 当前置顶列表（先置顶的在前）；读完状态之前是空数组。 */
  get ids(): readonly string[] {
    return this.#pins.map(pin => pin.workspaceId)
  }

  /**
   * 读一次状态（顺带尝试一次老文件迁移）。重复调用共用同一次读取。
   * @returns 读完的承诺；读失败已经被处理成空列表，不会拒绝。
   */
  load(): Promise<void> {
    this.#loading ??= this.#read()
    return this.#loading
  }

  /**
   * 把某个工作区设成置顶或取消置顶。同一条命令重复发送没有副作用；没有变化时不写。
   * @param workspaceId - 目标工作区。
   * @param pinned - 目标状态。
   * @returns 变化后的置顶列表。
   */
  toggle(workspaceId: string, pinned: boolean): Promise<readonly string[]> {
    const result = this.#mutating.then(async () => {
      await this.load()
      const candidate = pinned
        ? this.#withPin(workspaceId)
        : this.#pins.filter(pin => pin.workspaceId !== workspaceId)
      const next = this.#sanitize(candidate)
      if (samePins(next, this.#pins)) return this.ids
      const previous = this.#pins
      this.#pins = next
      await this.#persist(previous, next)
      return this.ids
    })
    this.#mutating = result.then(() => undefined, () => undefined)
    return result
  }

  /** 置顶一个工作区：已经在列表里就原样返回，否则追加到末尾并给一个新时刻。 */
  #withPin(workspaceId: string): StoredPin[] {
    if (this.#pins.some(pin => pin.workspaceId === workspaceId)) return this.#pins
    return [...this.#pins, { workspaceId, pinnedAt: this.#nextStamp() }]
  }

  /** 新记录的置顶时刻：保证比现有最大的一条大（同一毫秒里连续置顶也不会并列）。 */
  #nextStamp(): number {
    const latest = this.#pins.at(-1)?.pinnedAt ?? 0
    return Math.max(Date.now(), latest + 1)
  }

  /** 去掉重复与注册表里已经没有的 id，再按置顶时刻升序排。注册表为空时只去重。 */
  #sanitize(pins: readonly StoredPin[]): StoredPin[] {
    const seen = new Set<string>()
    const unique: StoredPin[] = []
    for (const pin of pins) {
      if (seen.has(pin.workspaceId)) continue
      seen.add(pin.workspaceId)
      unique.push(pin)
    }
    const known = this.#options.knownIds()
    const kept = known.size === 0 ? unique : unique.filter(pin => known.has(pin.workspaceId))
    return kept.sort(byPinnedAt)
  }

  /** 读状态；读不出来当空列表，形状不对的条目由 `#sanitize` 丢掉并顺手写回干净的那份。 */
  async #read(): Promise<void> {
    const legacyFile = this.#options.legacyFile
    if (legacyFile !== undefined) {
      await migrateLegacyPins({ file: legacyFile, state: this.#options.state, warn: this.#options.warn })
    }
    let stored: readonly StoredPin[]
    try {
      stored = await this.#options.state.read()
    } catch (error) {
      this.#options.warn(`cannot read the pin list: ${String(error)}`)
      return
    }
    const next = this.#sanitize(stored)
    this.#pins = next
    if (!samePins(stored, next)) await this.#persist(stored, next)
  }

  /** 只写变化：新增或改了时刻的记录 `put`，没了的记录删掉；失败只告警。 */
  async #persist(previous: readonly StoredPin[], next: readonly StoredPin[]): Promise<void> {
    const before = new Map(previous.map(pin => [pin.workspaceId, pin.pinnedAt]))
    const after = new Map(next.map(pin => [pin.workspaceId, pin.pinnedAt]))
    const writes: Promise<void>[] = []
    for (const [workspaceId, pinnedAt] of after) {
      if (before.get(workspaceId) !== pinnedAt) writes.push(this.#options.state.put(workspaceId, pinnedAt))
    }
    for (const workspaceId of before.keys()) {
      if (!after.has(workspaceId)) writes.push(this.#options.state.remove(workspaceId))
    }
    if (writes.length === 0) return
    try {
      await Promise.all(writes)
    } catch (error) {
      this.#options.warn(`cannot save the pin list: ${String(error)}`)
    }
  }
}

/** `migrateLegacyPins()` 需要的东西。 */
export interface PinMigrationOptions {
  /** 老文件的位置（`pinsPath()` 算出来的那个）。 */
  readonly file: string
  /** 记录导入到哪里。 */
  readonly state: PinStateStore
  /** 读不懂、写不进去的汇报。 */
  readonly warn: (message: string) => void
}

/**
 * 把老版本的 `pins.json` 导入置顶领域。
 *
 * 规则：文件还在、形状认识、领域里一条记录都没有，才按文件里的先后导入（`pinnedAt` 用 1、2、3……
 * 递增序号，够用来还原顺序）；导入成功后把文件改名成 `pins.json.migrated`。领域里已经有记录时什么
 * 都不做——迁移只发生一次，旧文件原地留着给用户核对。
 *
 * 整个函数不会抛：读不出来、JSON 坏掉、形状不认识、写不进去都只留一条 `warn`。写了一半失败时尽力
 * 撤回已写的记录，好让下次启动能从头再试。
 * @param options - 老文件位置、状态接口与告警回调。
 */
export async function migrateLegacyPins(options: PinMigrationOptions): Promise<void> {
  const { file, state, warn } = options
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    // 没有老文件是常态，不用吭声。
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn(`cannot read the old pin list: ${String(error)}`)
    }
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    warn(`the old pin list is not valid JSON, leaving it in place: ${String(error)}`)
    return
  }
  const ids = legacyIds(parsed)
  if (ids === undefined) {
    warn('the old pin list has an unexpected shape, leaving it in place')
    return
  }

  let existing: readonly StoredPin[]
  try {
    existing = await state.read()
  } catch (error) {
    warn(`cannot check the pin domain before migrating: ${String(error)}`)
    return
  }
  if (existing.length > 0) return

  const written: string[] = []
  try {
    for (const [index, workspaceId] of ids.entries()) {
      await state.put(workspaceId, index + 1)
      written.push(workspaceId)
    }
  } catch (error) {
    warn(`cannot migrate the old pin list: ${String(error)}`)
    for (const workspaceId of written) await state.remove(workspaceId).catch(() => {})
    return
  }

  try {
    await rename(file, `${file}${MIGRATED_SUFFIX}`)
  } catch (error) {
    // 数据已经导入过了：下次启动领域非空，不会再导入一遍，旧文件留着不影响正确性。
    warn(`cannot rename the old pin list after importing it: ${String(error)}`)
  }
}

/** 老文件的形状：`{ version: 1, workspaceIds: [...] }`；不认识的形状返回 `undefined`。 */
function legacyIds(parsed: unknown): string[] | undefined {
  const record = parsed as { version?: unknown; workspaceIds?: unknown } | null
  if (record === null || typeof record !== 'object' || record.version !== PINS_VERSION
    || !Array.isArray(record.workspaceIds)) {
    return undefined
  }
  return [...new Set(record.workspaceIds.filter((id): id is string => typeof id === 'string'))]
}
