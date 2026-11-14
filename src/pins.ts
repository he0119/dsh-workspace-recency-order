/**
 * 置顶列表的宿主侧状态：内存里一份有序 id，落盘到 `$DSH_HOME` 下的一个 JSON 文件。
 *
 * 置顶列表归宿主：谁置顶了哪些工作区是这份部署的状态，不是某个标签页的临时状态。写盘用「临时文件 +
 * 改名」，读不懂的文件一律当空列表——置顶不该因为一个坏文件把插件拖垮。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 文件格式的版本号；形状变了就换它，读到不认识的值当空列表。 */
export const PINS_VERSION = 1

/** 文件名。 */
export const PINS_FILE = 'pins.json'

/**
 * 置顶列表的路径：`<DSH_HOME>/workspace-recency-order/pins.json`。
 * @param env - 进程环境；读 `DSH_HOME`，空白值当没设。
 * @param home - 操作系统主目录，只在没有 `DSH_HOME` 时用到。
 * @returns 绝对路径（目录不一定存在）。
 */
export function pinsPath(env: Record<string, string | undefined>, home: string): string {
  const configured = env.DSH_HOME?.trim()
  const base = configured !== undefined && configured !== '' ? configured : join(home, '.dsh')
  return join(base, 'workspace-recency-order', PINS_FILE)
}

/** 两个 id 序列是否完全一样。 */
const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

/** `PinStore` 需要的宿主事实。 */
export interface PinStoreOptions {
  /** 置顶列表文件的位置。 */
  readonly file: string
  /** 注册表里还有的工作区 id；读盘与每次写入时用它丢掉失效项。 */
  readonly knownIds: () => ReadonlySet<string>
  /** 读盘、写盘的失败汇报。 */
  readonly warn: (message: string) => void
}

/**
 * 置顶列表的内存状态与落盘。
 *
 * 所有方法都可以并发调用：`load()` 只读一次盘，`toggle()` 串行地改内存再落盘（调用方还要保证
 * 顺序写操作串行，见 `src/index.ts` 的 `serial()`）。
 */
export class PinStore {
  #ids: string[] = []
  #loading: Promise<void> | undefined
  /** 切换操作串行执行：两个页面同时发命令时，后一个基于前一个的结果算，写入不会互相覆盖。 */
  #mutating: Promise<void> = Promise.resolve()

  readonly #options: PinStoreOptions

  /**
   * @param options - 文件位置、注册表事实与告警回调。
   */
  constructor(options: PinStoreOptions) {
    this.#options = options
  }

  /** 置顶列表文件的位置。 */
  get file(): string {
    return this.#options.file
  }

  /** 当前置顶列表；读完盘之前是空数组。 */
  get ids(): readonly string[] {
    return this.#ids
  }

  /**
   * 读一次盘。重复调用共用同一次读取。
   * @returns 读完的承诺；读失败已经被处理成空列表，不会拒绝。
   */
  load(): Promise<void> {
    this.#loading ??= this.#read()
    return this.#loading
  }

  /**
   * 把某个工作区设成置顶或取消置顶。同一条命令重复发送没有副作用；没有变化时不写盘。
   * @param workspaceId - 目标工作区。
   * @param pinned - 目标状态。
   * @returns 变化后的置顶列表。
   */
  toggle(workspaceId: string, pinned: boolean): Promise<readonly string[]> {
    const result = this.#mutating.then(async () => {
      await this.load()
      const candidate = pinned
        ? (this.#ids.includes(workspaceId) ? this.#ids : [...this.#ids, workspaceId])
        : this.#ids.filter(id => id !== workspaceId)
      const next = this.#sanitize(candidate)
      if (sameIds(next, this.#ids)) return this.#ids
      this.#ids = next
      await this.#save()
      return this.#ids
    })
    this.#mutating = result.then(() => undefined, () => undefined)
    return result
  }

  /** 去掉重复与注册表里已经没有的 id；注册表为空时只去重。 */
  #sanitize(ids: readonly string[]): string[] {
    const unique = [...new Set(ids)]
    const known = this.#options.knownIds()
    if (known.size === 0) return unique
    return unique.filter(id => known.has(id))
  }

  /** 读盘；文件不存在、读不懂、形状不认识都当空列表。 */
  async #read(): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.#options.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.#options.warn(`cannot read the pin list: ${String(error)}`)
      }
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      this.#options.warn(`the pin list is not valid JSON, ignoring it: ${String(error)}`)
      return
    }
    const record = parsed as { version?: unknown; workspaceIds?: unknown } | null
    if (record === null || typeof record !== 'object' || record.version !== PINS_VERSION
      || !Array.isArray(record.workspaceIds)) {
      this.#options.warn('the pin list has an unexpected shape, ignoring it')
      return
    }
    const ids = this.#sanitize(record.workspaceIds.filter((id): id is string => typeof id === 'string'))
    this.#ids = ids
    if (ids.length !== record.workspaceIds.length) await this.#save()
  }

  /** 整份写回：先写临时文件，再改名覆盖。 */
  async #save(): Promise<void> {
    const temporary = `${this.#options.file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    try {
      await mkdir(dirname(this.#options.file), { recursive: true })
      await writeFile(
        temporary,
        `${JSON.stringify({ version: PINS_VERSION, workspaceIds: this.#ids }, null, 2)}\n`,
        'utf8',
      )
      await rename(temporary, this.#options.file)
    } catch (error) {
      this.#options.warn(`cannot save the pin list: ${String(error)}`)
    }
  }
}
