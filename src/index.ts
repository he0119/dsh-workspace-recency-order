/**
 * 工作区按活跃度排序 —— Host 端。
 *
 * 侧边栏渲染的是宿主里那份持久的工作区顺序（注册表的 `workspaceIds`），本插件维护的就是那份顺序：
 * 置顶的工作区占开头一段，其余按最近活动排序。活动＝宿主事件 `api-session/activity`（只在你发出
 * 人类消息时触发）与会话的创建时间。
 *
 * 顺序只有一个写手，就是这个文件。Web Client 不碰顺序，只通过 `GET/POST /api/workspace-recency/pins`
 * 读写置顶列表；置顶项因此不会在活动之后被挤下去、再被页面弹回来。
 *
 * 写盘方式是最小步：每一轮排序都重新读注册表，只做一次「把某个工作区移到某处」的移动，于是并发改动
 * （用户拖动、别的工作区新建会话）不会让本地快照越走越偏。
 */
import { homedir } from 'node:os'

import { orderByActivity, nextMove } from './order.ts'
import { readOptions } from './options.ts'
import { PinStore, pinsPath } from './pins.ts'
import { PIN_ROUTE } from './protocol.ts'
import { createPinRoute } from './route.ts'
import type { HostContext, SessionSummary, WorkspaceRow } from './types.ts'

/** 只强依赖工作区注册表；会话控制器用于启动排序，连接服务用于置顶列表的路由。 */
export const inject: readonly string[] = ['workspaceRegistry']

/**
 * 插件入口。
 * @param ctx - 带 `workspaceRegistry` 的 Host 上下文。
 * @param config - 本插件那一行的 `config`（来自 bundle 补丁或用户补丁层）。
 */
export function apply(ctx: HostContext, config?: unknown): void {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('workspace-recency-order') : ctx.logger
  const warn = (message: string): void => logger.warn(`workspace-recency-order: ${message}`)
  const info = (message: string): void => logger.info(message)

  const options = readOptions(config, warn)
  if (!options.enabled) {
    info('disabled by config')
    return
  }

  const registry = ctx.workspaceRegistry
  /** 每个会话最近一次活动的时刻（epoch 毫秒）。 */
  const lastActivity = new Map<string, number>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  /** 所有写顺序的操作串行执行：活动触发的排序与切换置顶触发的排序不会互相覆盖。 */
  let queue: Promise<void> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  /** 置顶列表：内存里一份，落盘在 `<DSH_HOME>/workspace-recency-order/pins.json`。 */
  const pins = new PinStore({
    file: pinsPath(process.env, homedir()),
    knownIds: () => new Set(registry.list().map(workspace => workspace.id)),
    warn,
  })

  /**
   * 记住一个会话的活动时刻。
   * @returns 这个时刻是否推进了记录（推进才可能需要重排）。
   */
  const record = (sessionId: string, updatedAt: number): boolean => {
    if (typeof sessionId !== 'string' || !Number.isFinite(updatedAt) || updatedAt <= 0) return false
    const known = lastActivity.get(sessionId)
    if (known !== undefined && known >= updatedAt) return false
    lastActivity.set(sessionId, updatedAt)
    return true
  }

  /** 注册表全局的归档集合：已归档会话的历史时间不该把工作区抬到最前。 */
  const archivedSessions = (): Set<string> => {
    const ids = registry.archivedSessionIds
    return new Set(Array.isArray(ids) ? ids : [])
  }

  /** 一个工作区名下最近的活动时刻；没有活动给 0。 */
  const latestOf = (workspace: WorkspaceRow, archived: ReadonlySet<string>): number => {
    let latest = 0
    for (const sessionId of workspace.sessionIds) {
      if (archived.has(sessionId)) continue
      const seen = lastActivity.get(sessionId)
      if (seen !== undefined && seen > latest) latest = seen
    }
    return latest
  }

  /** 有工作区认领这个会话吗？未分组的会话不参与排序。 */
  const isGrouped = (workspaces: readonly WorkspaceRow[], sessionId: string): boolean =>
    workspaces.some(workspace => workspace.sessionIds.includes(sessionId))

  /** 这份会话摘要能不能抬升工作区（子智能体的会话不算）。 */
  const countsAsActivity = (summary: SessionSummary | undefined): summary is SessionSummary =>
    summary !== undefined && summary.origin !== 'subagent'

  /** 按活跃度重排注册表，一步一次持久化移动；置顶项始终是开头那一段。 */
  const sortNow = async (): Promise<void> => {
    if (stopped) return
    await pins.load()
    const attempts = Math.max(registry.list().length, 2)
    let moved = 0
    for (let step = 0; step < attempts; step += 1) {
      const workspaces = registry.list()
      if (workspaces.length < 2) return
      const archived = archivedSessions()
      const order = workspaces.map(workspace => workspace.id)
      const desired = orderByActivity(workspaces, workspace => latestOf(workspace, archived), pins.ids)
      const move = nextMove(order, desired)
      if (move === null) break
      try {
        await registry.insertBefore(move[0], move[1])
      } catch (error) {
        warn(`reorder stopped after ${moved} move(s): ${String(error)}`)
        return
      }
      moved += 1
    }
    if (moved > 0) info(`moved ${moved} workspace(s); pinned workspaces stay in front`)
  }

  /** 排一次顺序；所有调用都排在同一条队列上。 */
  const sort = (): Promise<void> => serial(sortNow)

  /** 把一次重排排在安静期之后，并与之前的重排串行。 */
  const schedule = (): void => {
    if (stopped) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void sort().catch((error: unknown) => warn(`reorder failed: ${String(error)}`))
    }, options.debounceMs)
    if (typeof timer?.unref === 'function') timer.unref()
  }

  const route = createPinRoute({
    store: pins,
    // 置顶已经落盘了；重排失败只记日志，不要把「置顶成功」变成一次 400。
    changed: async () => {
      try {
        await sort()
      } catch (error) {
        warn(`reorder after a pin change failed: ${String(error)}`)
      }
    },
    closed: () => stopped,
  })

  ctx.inject(['connection'], (connected) => {
    const connection = connected.connection
    if (connection === undefined) {
      info('no connection service: the pin menu cannot reach this host')
      return
    }
    connected.effect(
      () => connection.fetch.register({
        path: PIN_ROUTE,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: route,
      }),
      'workspace-recency-order: pin route',
    )
  })

  ctx.effect(() => () => {
    stopped = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  })

  ctx.on('api-session/activity', (sessionId: string, updatedAt: number) => {
    if (stopped) return
    if (!isGrouped(registry.list(), sessionId)) return
    if (record(sessionId, updatedAt)) schedule()
  })

  if (options.trackNewSessions) {
    ctx.on('api-session/added', (summary: SessionSummary) => {
      if (stopped || !countsAsActivity(summary)) return
      if (!isGrouped(registry.list(), summary.sessionId)) return
      if (record(summary.sessionId, summary.updatedAt)) schedule()
    })
  }

  if (options.sortOnStart) {
    ctx.inject(['sessionController'], (seedCtx) => {
      const sessions = seedCtx.sessionController
      if (sessions === undefined) return
      const abort = new AbortController()
      seedCtx.effect(() => () => abort.abort())
      void (async () => {
        try {
          const value = await sessions.list({}, abort.signal)
          for (const item of value.items) {
            if (!countsAsActivity(item)) continue
            record(item.sessionId, item.updatedAt)
          }
          await sort()
        } catch (error) {
          if (abort.signal.aborted) return
          warn(`startup sort skipped: ${String(error)}`)
        }
      })()
    })
  } else {
    // 不按活跃度整理启动顺序时，置顶项仍然要回到开头；没有活动记录时只有置顶项会动。
    void sort().catch((error: unknown) => warn(`startup pin sort skipped: ${String(error)}`))
  }

  info(`active (sortOnStart=${options.sortOnStart}, trackNewSessions=${options.trackNewSessions})`)
}
