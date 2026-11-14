/**
 * 固定列表的跨进程契约：路由路径、请求体、响应体，以及两端的解析。
 *
 * Host 与 Web Client 共用这一份：路径或形状只改这里，两端不会各写一份然后漂移。本文件不 import
 * 任何东西，所以它同时是 Host 工程与浏览器工程的合法输入。
 */

/** 固定列表的读写路由；挂在 `/api` 下，只对已登录的 owner 浏览器会话开放。 */
export const PIN_ROUTE = '/api/workspace-recency/pins'

/** 切换一个工作区的固定状态。`pinned` 是目标状态，同一条命令重复发送没有副作用。 */
export interface PinCommand {
  readonly workspaceId: string
  readonly pinned: boolean
}

/** 固定列表的响应体。 */
export interface PinListBody {
  readonly pinned: readonly string[]
}

/** 失败响应体。 */
export interface PinErrorBody {
  readonly error: string
}

/**
 * 从任意 JSON 里读一份固定列表。
 * @param value - 响应体。
 * @returns 工作区 id；不是 `{ pinned: string[] }` 时 `undefined`，非字符串元素丢掉。
 */
export function readPinList(value: unknown): string[] | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const ids = (value as { pinned?: unknown }).pinned
  if (!Array.isArray(ids)) return undefined
  return ids.filter((id): id is string => typeof id === 'string')
}

/**
 * 从任意 JSON 里读一条切换命令。
 * @param value - 请求体。
 * @returns 命令；形状不对时 `undefined`。
 */
export function readPinCommand(value: unknown): PinCommand | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const { workspaceId, pinned } = value as { workspaceId?: unknown; pinned?: unknown }
  if (typeof workspaceId !== 'string' || workspaceId === '') return undefined
  if (typeof pinned !== 'boolean') return undefined
  return { workspaceId, pinned }
}

/**
 * 生成固定列表响应体。
 * @param pinned - 当前固定列表。
 */
export function pinListBody(pinned: readonly string[]): PinListBody {
  return { pinned: [...pinned] }
}
