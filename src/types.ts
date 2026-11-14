/**
 * Host 侧用到的最小服务表面。
 *
 * 本插件不 import 任何 DSH 包：这些接口只描述真正用到的成员，既让类型检查有意义，
 * 也让产物里一个 require 都不多。字段的权威定义在各自的官方包里（见 README「实现」一节）。
 */

/** 注册表里的一个工作区。 */
export interface WorkspaceRow {
  readonly id: string
  /** 该工作区名下的会话（含已归档的）。 */
  readonly sessionIds: readonly string[]
}

/** `ctx.workspaceRegistry` 用到的部分。 */
export interface WorkspaceRegistry {
  /** 注册表全局的归档集合；取不到时按空集处理。 */
  readonly archivedSessionIds?: readonly string[]
  /** 当前注册表顺序里的工作区。 */
  list(): readonly WorkspaceRow[]
  /** 把 `id` 移到 `beforeId` 前面（省略则移到末尾），返回移动后的完整顺序。 */
  insertBefore(id: string, beforeId?: string): Promise<readonly string[]>
}

/** `sessionController.list()` 返回的会话摘要里本插件用到的字段。 */
export interface SessionSummary {
  readonly sessionId: string
  /** 最后一次人类消息时间；没有消息时是会话创建时间。 */
  readonly updatedAt: number
  readonly blank?: boolean
  readonly origin?: 'subagent'
}

/** `ctx.sessionController` 用到的部分。 */
export interface SessionController {
  list(request: Record<string, never>, signal: AbortSignal): Promise<{ readonly items: readonly SessionSummary[] }>
}

/** `ctx.connection.fetch` 用到的部分：注册一条要经过登录校验的 HTTP 路由。 */
export interface ConnectionService {
  readonly fetch: {
    register(route: {
      /** 完整路径（含 `/api` 前缀）。 */
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      /** 请求体怎么交给处理函数；固定列表很小，缓冲即可。 */
      readonly requestBody: 'buffered' | 'streaming'
      readonly fetch: (request: Request) => Promise<Response>
    }): (() => Promise<void>) | (() => void)
  }
}

/** Cordis 日志器面。 */
export interface Logger {
  info(message: string): void
  warn(message: string): void
}

/** `ctx.inject` 回调能拿到的可选服务。 */
export interface OptionalServices {
  readonly sessionController?: SessionController
  readonly connection?: ConnectionService
}

/** Cordis 插件上下文面（只列本插件用到的成员）。 */
export interface HostContext {
  readonly workspaceRegistry: WorkspaceRegistry
  readonly logger: Logger & ((name?: string) => Logger)
  effect(callback: () => () => void, label?: string): unknown
  on(event: string, listener: (...args: any[]) => void): unknown
  inject(deps: readonly string[], callback: (ctx: HostContext & OptionalServices) => void): unknown
}
