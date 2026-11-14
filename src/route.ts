/**
 * 置顶列表的 HTTP 路由：`GET` 读，`POST` 切换一个工作区。
 *
 * 处理函数与 Cordis 无关：它只依赖 `PinStore` 和一个「列表变了」的回调，所以测试可以直接拿
 * `Request` 调它，不用起宿主。鉴权、Host/Origin 检查、请求体上限由宿主在把请求交给它之前做完。
 */
import { pinListBody, readPinCommand, type PinErrorBody, type PinListBody } from './protocol.ts'
import type { PinStore } from './pins.ts'

/** `createPinRoute()` 需要的外部动作。 */
export interface PinRouteOptions {
  /** 置顶列表的状态与落盘。 */
  readonly store: PinStore
  /** 列表真的变了之后要做的事（重排顺序）；抛错由调用方记日志。 */
  readonly changed: () => Promise<void>
  /** 插件是否正在卸载；卸载后拒绝写入。 */
  readonly closed: () => boolean
}

/**
 * 生成 HTTP 响应。
 * @param body - JSON 响应体。
 * @param status - HTTP 状态码。
 */
const json = (body: PinListBody | PinErrorBody, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/** 列表是否真的变了。 */
const changedIds = (before: readonly string[], after: readonly string[]): boolean =>
  before.length !== after.length || before.some((id, index) => id !== after[index])

/**
 * 生成路由处理函数。
 * @param options - 置顶列表、变化回调与卸载状态。
 * @returns 一个可以直接注册给连接服务的 Fetch 处理函数。
 */
export const createPinRoute = (options: PinRouteOptions) =>
  async (request: Request): Promise<Response> => {
    if (request.method === 'GET') {
      await options.store.load()
      return json(pinListBody(options.store.ids))
    }
    if (request.method !== 'POST') return json({ error: 'only GET and POST are served here' }, 405)
    if (options.closed()) return json({ error: 'the plugin is shutting down' }, 503)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ error: 'the body must be JSON' }, 400)
    }
    const command = readPinCommand(body)
    if (command === undefined) return json({ error: 'expected { workspaceId, pinned }' }, 400)

    await options.store.load()
    const before = options.store.ids
    const after = await options.store.toggle(command.workspaceId, command.pinned)
    if (changedIds(before, after)) await options.changed()
    return json(pinListBody(after))
  }
