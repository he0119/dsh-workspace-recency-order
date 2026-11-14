/**
 * 工作区按活跃度排序 —— Host 端。
 *
 * 侧边栏渲染的是宿主里那份持久的工作区顺序（注册表的 `workspaceIds`），所以本插件维护的就是
 * 那份顺序：最近有活动的工作区排在前面，其余保持原来的相对顺序。活动＝宿主事件
 * `api-session/activity`（只在你发出人类消息时触发）与会话的创建时间。
 *
 * 写盘方式是最小步：每一轮排序都重新读注册表，只做一次「把某个工作区移到某处」的移动，
 * 于是并发改动（用户拖动、别的工作区新建会话）不会让本地快照越走越偏。
 */
import { orderByActivity, nextMove } from './order.ts'
import { readOptions } from './options.ts'
import type { HostContext, SessionSummary, WorkspaceRow } from './types.ts'

/** 只强依赖工作区注册表；会话控制器只用于启动排序，缺了也能按事件跑。 */
export const inject: readonly string[] = ['workspaceRegistry']

/**
 * 插件入口。
 * @param ctx - 带 `workspaceRegistry` 的 Host 上下文。
 * @param config - 本插件那一行的 `config`（来自 bundle 补丁或用户补丁层）。
 */
export function apply(ctx: HostContext, config?: unknown): void {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('workspace-recency-order') : ctx.logger
  const warn = (message: string) => logger.warn(`workspace-recency-order: ${message}`)
  const info = (message: string) => logger.info(message)

  const options = readOptions(config, warn)
  if (!options.enabled) {
    info('disabled by config')
    return
  }

  /** 每个会话最近一次活动的时刻（epoch 毫秒）。 */
  const lastActivity = new Map<string, number>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<void> = Promise.resolve()
  let stopped = false

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
    const ids = ctx.workspaceRegistry.archivedSessionIds
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

  /** 按活跃度重排注册表，一步一次持久化移动。 */
  const sortNow = async (): Promise<void> => {
    if (stopped) return
    const attempts = Math.max(ctx.workspaceRegistry.list().length, 2)
    let moved = 0
    for (let step = 0; step < attempts; step += 1) {
      const workspaces = ctx.workspaceRegistry.list()
      if (workspaces.length < 2) return
      const archived = archivedSessions()
      const order = workspaces.map(workspace => workspace.id)
      const desired = orderByActivity(workspaces, workspace => latestOf(workspace, archived))
      const move = nextMove(order, desired)
      if (move === null) break
      try {
        await ctx.workspaceRegistry.insertBefore(move[0], move[1])
      } catch (error) {
        warn(`reorder stopped after ${moved} move(s): ${String(error)}`)
        return
      }
      moved += 1
    }
    if (moved > 0) info(`moved ${moved} workspace(s); the most recent activity now leads`)
  }

  /** 把一次重排排在安静期之后，并与之前的重排串行。 */
  const schedule = (): void => {
    if (stopped) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      queue = queue
        .then(() => sortNow())
        .catch((error: unknown) => warn(`reorder failed: ${String(error)}`))
    }, options.debounceMs)
    if (typeof timer?.unref === 'function') timer.unref()
  }

  ctx.effect(() => () => {
    stopped = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  })

  ctx.on('api-session/activity', (sessionId: string, updatedAt: number) => {
    if (stopped) return
    if (!isGrouped(ctx.workspaceRegistry.list(), sessionId)) return
    if (record(sessionId, updatedAt)) schedule()
  })

  if (options.trackNewSessions) {
    ctx.on('api-session/added', (summary: SessionSummary) => {
      if (stopped || !countsAsActivity(summary)) return
      if (!isGrouped(ctx.workspaceRegistry.list(), summary.sessionId)) return
      if (record(summary.sessionId, summary.updatedAt)) schedule()
    })
  }

  if (options.sortOnStart) {
    ctx.inject(['sessionController'], (seedCtx) => {
      const abort = new AbortController()
      seedCtx.effect(() => () => abort.abort())
      void (async () => {
        try {
          const value = await seedCtx.sessionController.list({}, abort.signal)
          for (const item of value.items) {
            if (!countsAsActivity(item)) continue
            record(item.sessionId, item.updatedAt)
          }
          await sortNow()
        } catch (error) {
          if (abort.signal.aborted) return
          warn(`startup sort skipped: ${String(error)}`)
        }
      })()
    })
  }

  info(`active (sortOnStart=${options.sortOnStart}, trackNewSessions=${options.trackNewSessions})`)
}
