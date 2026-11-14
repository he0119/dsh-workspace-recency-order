/**
 * 工作区按活跃度排序 —— Web Client 端。
 *
 * 宿主的工作区行只留了「…」菜单这一个扩展位（会话行才有悬停按钮的插槽），所以「固定工作区」
 * 做成菜单里的一项：点一下把这个工作区钉在最前，再点同一项松开。
 *
 * 固定列表存在**当前浏览器**里（`localStorage`），顺序的结果写在宿主那份持久顺序上：
 * 宿主按活跃度重排把固定项挤下去之后，这里收到新的快照就把它挪回去。因此固定是「页面在维持」，
 * 页面关掉期间不会有人纠正。多个页面同时固定不同工作区时会抢同一个顺序，所以这里做了节流与让位
 * （见 `CONFLICT_LIMIT` / `YIELD_MS`），不会无限对写。
 */
import { createElement, type ReactElement } from 'react'

import type {
  ClientContext,
  MenuAction,
  RemoteAccessService,
  WorkspaceMenuTarget,
  WorkspaceSnapshot,
} from './types.ts'

export const inject: readonly string[] = ['slots', 'contextMenus', 'workspaces', 'locale']

const NS = 'workspace-recency'
const STORAGE_KEY = 'dsh.workspace-recency.pinned-workspaces.v1'
/** 两次顺序纠正之间的最小间隔。 */
const MIN_GAP_MS = 600
/** 在这个时间窗内纠正这么多次，就认为有别人在同时改顺序。 */
const CONFLICT_WINDOW_MS = 10_000
const CONFLICT_LIMIT = 4
/** 让位多久。 */
const YIELD_MS = 30_000
/** 同一个失败最多多久提示一次。 */
const FAILURE_NOTICE_GAP_MS = 30_000

const DICT: Record<string, Record<string, string>> = {
  zh: {
    pin: '固定工作区到最前',
    unpin: '取消工作区固定',
    pinnedToast: '已固定：这个工作区会一直排在最前，再点同一项可取消',
    unpinnedToast: '已取消固定',
    failed: '调整工作区顺序失败',
    storageBlocked: '这个浏览器不允许保存设置，固定无法记住',
    yielding: '检测到另一个页面也在调整工作区顺序，暂时停止固定 30 秒',
  },
  en: {
    pin: 'Keep workspace at top',
    unpin: 'Stop keeping workspace at top',
    pinnedToast: 'Kept at the top; pick the same item again to release it',
    unpinnedToast: 'No longer kept at the top',
    failed: 'Could not reorder workspaces',
    storageBlocked: 'This browser refuses stored settings, so the pin cannot be remembered',
    yielding: 'Another page is reordering workspaces; pausing the pin for 30 seconds',
  },
}

/** 图钉字形；`filled` 表示已固定的状态。 */
const tack = (filled: boolean): ReactElement => createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
  createElement('path', {
    d: 'M6.4 2.6h3.2M7.6 2.6v3.1L5.7 8.3v1.3h4.6V8.3L8.4 5.7V2.6M8 9.6v3.8',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...(filled ? { fill: 'currentColor', fillOpacity: 0.22 } : {}),
  }),
)

const PinIcon = (): ReactElement => tack(false)
const UnpinIcon = (): ReactElement => tack(true)

/**
 * 读取本浏览器里的固定列表（最近固定的在前）。
 * @returns 固定的工作区 id；存储不可用时是空数组。
 */
const readPins = (): string[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string'))]
  } catch {
    return []
  }
}

/**
 * 保存固定列表。
 * @returns 浏览器是否接受这次写入。
 */
const writePins = (pins: readonly string[]): boolean => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins))
    return true
  } catch {
    return false
  }
}

/**
 * 插件入口。
 * @param ctx - 带插槽、菜单、工作区、语言四个服务的 Client 上下文。
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const remoteAccess = ctx.get?.('remoteAccess') as RemoteAccessService | undefined
  /** 这个连接允许移动工作区吗？拿不到权限面时按允许处理。 */
  const allowed = (workspaceId: string): boolean =>
    remoteAccess?.source?.('workspace', workspaceId, 'workspace/insertBefore')?.getSnapshot?.() !== false

  ctx.effect(() => ctx.locale.register(NS, DICT), 'workspace-recency: locale')

  ctx.slots.inject('contextMenu.icon', () => [
    ctx.slots.register({ name: 'contextMenu.icon', key: 'workspace-recency.pin' }, PinIcon),
    ctx.slots.register({ name: 'contextMenu.icon', key: 'workspace-recency.unpin' }, UnpinIcon),
  ])

  /** 当前快照；服务拿不到时返回 undefined。 */
  const snapshot = (): WorkspaceSnapshot | undefined => {
    try {
      return ctx.workspaces.list.getSnapshot()
    } catch {
      return undefined
    }
  }
  /** 基线到齐、没有在加载时，`items` 才代表完整的工作区集合。 */
  const settled = (value: WorkspaceSnapshot | undefined): value is WorkspaceSnapshot =>
    value !== undefined && value.phase === 'ready' && value.state === 'idle'
  const orderOf = (value: WorkspaceSnapshot | undefined): string[] =>
    (value?.items ?? []).map(row => String(row.workspaceId))

  let busy = false
  let pending = false
  let lastRunAt = 0
  let trailing: ReturnType<typeof setTimeout> | undefined
  let corrections: number[] = []
  let pausedUntil = 0
  let lastFailureAt = 0

  const notice = (key: string, success: boolean): void => {
    ctx.contextMenus.notify?.(t(key), success)
  }

  /** 失败最多每 30 秒提示一次，避免一直被拒绝时刷屏。 */
  const failOnce = (): void => {
    const now = Date.now()
    if (now - lastFailureAt < FAILURE_NOTICE_GAP_MS) return
    lastFailureAt = now
    notice('failed', false)
  }

  /**
   * 把 `pins` 按固定顺序挪到最前面。
   * @returns 是否写成功（不需要移动也算成功）。
   */
  const movePinsToFront = async (pins: readonly string[]): Promise<boolean> => {
    const value = snapshot()
    if (!settled(value)) return true
    const order = orderOf(value)
    if (order.length === 0) return true
    const known = pins.filter(id => order.includes(id))
    if (known.length === 0) return true
    if (known.every((id, index) => order[index] === id)) return true
    try {
      for (let index = known.length - 1; index >= 0; index -= 1) {
        const live = orderOf(snapshot())
        if (live.length === 0 || live[0] === known[index]) continue
        await ctx.workspaces.insertBefore(known[index], live[0])
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * 宿主重排之后把固定项拉回来。带节流、合并与让位，避免多页面互相顶。
   */
  const enforce = async (): Promise<void> => {
    const now = Date.now()
    if (now < pausedUntil) return
    if (busy) {
      pending = true
      return
    }
    const pins = readPins()
    if (pins.length === 0) return
    const value = snapshot()
    if (!settled(value)) return
    const order = orderOf(value)
    if (order.length === 0) return
    const known = pins.filter(id => order.includes(id))
    // 只有基线完整时才允许清理：加载中或断线的快照不代表工作区被删了。
    if (known.length !== pins.length) writePins(known)
    if (known.length === 0) return
    if (known.every((id, index) => order[index] === id)) return
    if (now - lastRunAt < MIN_GAP_MS) {
      if (trailing !== undefined) clearTimeout(trailing)
      trailing = setTimeout(() => {
        trailing = undefined
        void enforce()
      }, MIN_GAP_MS)
      return
    }
    lastRunAt = now
    busy = true
    let ok = true
    try {
      ok = await movePinsToFront(known)
    } finally {
      busy = false
    }
    if (!ok) {
      failOnce()
      return
    }
    corrections = [...corrections.filter(at => now - at < CONFLICT_WINDOW_MS), now]
    if (corrections.length >= CONFLICT_LIMIT) {
      pausedUntil = now + YIELD_MS
      corrections = []
      notice('yielding', false)
      return
    }
    if (pending) {
      pending = false
      void enforce()
    }
  }

  /**
   * 切换一个工作区的固定状态：存储与顺序一起成功或一起不变。
   * @param workspaceId - 目标工作区。
   */
  const togglePin = async (workspaceId: string): Promise<void> => {
    const pins = readPins()
    const pinned = pins.includes(workspaceId)
    if (pinned) {
      if (!writePins(pins.filter(id => id !== workspaceId))) {
        notice('storageBlocked', false)
        return
      }
      notice('unpinnedToast', true)
      void enforce()
      return
    }
    const next = [workspaceId, ...pins]
    if (!writePins(next)) {
      notice('storageBlocked', false)
      return
    }
    if (await movePinsToFront(next)) {
      notice('pinnedToast', true)
      return
    }
    writePins(pins)
    failOnce()
  }

  ctx.effect(
    () => ctx.workspaces.list.subscribe(() => { void enforce() }),
    'workspace-recency: order watch',
  )
  void enforce()

  ctx.effect(() => ctx.contextMenus.register({
    id: 'workspace-recency.pin',
    target: 'workspace',
    order: 50,
    observe: () => [ctx.workspaces.list, ctx.locale],
    resolve: (target: WorkspaceMenuTarget): readonly MenuAction[] => {
      const id = String(target.workspaceId)
      if (!allowed(target.workspaceId)) return []
      const pinned = readPins().includes(id)
      return [{
        id: 'pin',
        label: t(pinned ? 'unpin' : 'pin'),
        icon: { key: pinned ? 'workspace-recency.unpin' : 'workspace-recency.pin' },
        run: () => togglePin(id),
      }]
    },
  }), 'workspace-recency: pin action')
}
