/**
 * 浏览器侧的置顶列表：读宿主那份、发切换命令、把结果做成菜单可以订阅的快照。
 *
 * 这里不发「整份列表」，只发「把某个工作区设成置顶/取消置顶」——命令是幂等的，两个页面同时点也不会
 * 互相覆盖；每次回答都带着宿主当前那份列表，页面照着显示。
 */
import { PIN_ROUTE, readPinList, type PinCommand } from '../protocol.ts'

/** 置顶列表的地址；相对页面的 base，同源请求自带登录 Cookie。 */
const endpoint = (): string =>
  new URL(PIN_ROUTE.replace(/^\//, ''), typeof document === 'undefined' ? 'http://localhost/' : document.baseURI).href

/** 读响应体里的列表；形状不对抛错。 */
const parse = async (response: Response): Promise<string[]> => {
  if (!response.ok) throw new Error(`pin request failed: HTTP ${response.status}`)
  const ids = readPinList(await response.json())
  if (ids === undefined) throw new Error('the pin response carries no list')
  return ids
}

/** 置顶列表的只读快照；只关心「谁在里面」，顺序变化不触发重渲染。 */
export interface PinnedSetSource {
  getSnapshot(): ReadonlySet<string>
  subscribe(listener: () => void): () => void
}

/** 可写的置顶列表快照。 */
export interface PinnedSet extends PinnedSetSource {
  set(ids: readonly string[]): void
}

/**
 * 建一个置顶列表快照。快照在内容变化时才换新对象，符合 `useSyncExternalStore` 的要求。
 */
export const createPinnedSet = (): PinnedSet => {
  let value: ReadonlySet<string> = new Set()
  const listeners = new Set<() => void>()
  return {
    getSnapshot: (): ReadonlySet<string> => value,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(ids: readonly string[]): void {
      const next = new Set(ids)
      if (next.size === value.size && [...next].every(id => value.has(id))) return
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * 读宿主那份置顶列表。
 * @param signal - 页面卸载时中止请求。
 * @returns 置顶的工作区 id。
 */
export async function readPinned(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(endpoint(), {
    method: 'GET',
    credentials: 'same-origin',
    ...(signal === undefined ? {} : { signal }),
  })
  return parse(response)
}

/**
 * 切换一个工作区的置顶状态。
 * @param command - 目标工作区与目标状态。
 * @param signal - 页面卸载时中止请求。
 * @returns 宿主变化后的整份列表。
 */
export async function sendPinCommand(command: PinCommand, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(endpoint(), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
    ...(signal === undefined ? {} : { signal }),
  })
  return parse(response)
}
