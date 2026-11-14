/**
 * 工作区按活跃度排序 —— Web Client 端。
 *
 * 宿主的工作区行只留了「…」菜单这一个扩展位（会话行才有悬停按钮的插槽），所以「固定工作区」
 * 做成菜单里的一项：点一下把这个工作区固定，再点同一项松开。
 *
 * 顺序只有一个写手：宿主。页面**不碰顺序**，只通过 `/api/workspace-recency/pins` 读写固定列表：
 * 加载时读一次、点菜单时发一条切换命令、切回窗口时再读一次。固定项因此不会在活动之后被挤下去再
 * 弹回来，页面关掉期间固定也照样生效。
 */
import { createElement, type ReactElement } from 'react'

import { createPinnedSet, readPinned, sendPinCommand } from './pins.ts'
import type {
  ClientContext,
  MenuAction,
  RemoteAccessService,
  WorkspaceMenuTarget,
} from './types.ts'

export const inject: readonly string[] = ['slots', 'contextMenus', 'locale']

const NS = 'workspace-recency'
/** 同一个失败最多多久提示一次。 */
const FAILURE_NOTICE_GAP_MS = 30_000

const DICT: Record<string, Record<string, string>> = {
  zh: {
    pin: '固定工作区到最前',
    unpin: '取消工作区固定',
    pinnedToast: '已置顶',
    unpinnedToast: '已取消置顶',
    failed: '调整工作区顺序失败',
  },
  en: {
    pin: 'Keep workspace at top',
    unpin: 'Stop keeping workspace at top',
    pinnedToast: 'Pinned',
    unpinnedToast: 'Unpinned',
    failed: 'Could not reorder workspaces',
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

/** 这个错误是不是「页面正在卸载、请求被中止」。 */
const isAbort = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'

/**
 * 插件入口。
 * @param ctx - 带插槽、菜单、语言三个服务的 Client 上下文。
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const remoteAccess = ctx.get?.('remoteAccess') as RemoteAccessService | undefined
  /** 这个连接允许移动工作区吗？拿不到权限面时按允许处理。 */
  const allowed = (workspaceId: string): boolean =>
    remoteAccess?.source?.('workspace', workspaceId, 'workspace/insertBefore')?.getSnapshot?.() !== false

  const pinned = createPinnedSet()
  /** 页面卸载时中止在途请求；中止的失败不再提示。 */
  const control = new AbortController()
  let refreshing: Promise<void> | undefined
  /** 成功切换一次固定就加一；在它之前发出的读取，回来时不能把新状态盖掉。 */
  let revision = 0
  let lastFailureAt = 0

  ctx.effect(() => ctx.locale.register(NS, DICT), 'workspace-recency: locale')

  ctx.slots.inject('contextMenu.icon', () => [
    ctx.slots.register({ name: 'contextMenu.icon', key: 'workspace-recency.pin' }, PinIcon),
    ctx.slots.register({ name: 'contextMenu.icon', key: 'workspace-recency.unpin' }, UnpinIcon),
  ])

  const notice = (key: string, success: boolean): void => {
    ctx.contextMenus.notify?.(t(key), success)
  }

  /** 失败最多每 30 秒提示一次，避免宿主一直拒绝时刷屏。 */
  const failOnce = (): void => {
    const now = Date.now()
    if (now - lastFailureAt < FAILURE_NOTICE_GAP_MS) return
    lastFailureAt = now
    notice('failed', false)
  }

  /**
   * 重新读宿主那份列表；读不到就保持现状，不打扰用户。同一时刻只有一个请求在飞。
   * @returns 这一轮读完的承诺。
   */
  const refresh = (): Promise<void> => {
    if (refreshing !== undefined) return refreshing
    const seen = revision
    refreshing = (async () => {
      try {
        const ids = await readPinned(control.signal)
        // 读取期间有一次切换成功了：那份回答比这次读取新，别拿旧列表盖掉它。
        if (revision === seen) pinned.set(ids)
      } catch {
        // 宿主没有这条路由（插件只装了页面这一半）或者暂时连不上：菜单先按「没固定」显示。
      }
    })().finally(() => { refreshing = undefined })
    return refreshing
  }

  /**
   * 切换一个工作区的固定状态：以宿主的回答为准。
   * @param workspaceId - 目标工作区。
   */
  const togglePin = async (workspaceId: string): Promise<void> => {
    const next = !pinned.getSnapshot().has(workspaceId)
    try {
      pinned.set(await sendPinCommand({ workspaceId, pinned: next }, control.signal))
      revision += 1
      notice(next ? 'pinnedToast' : 'unpinnedToast', true)
    } catch (error) {
      if (isAbort(error)) return
      failOnce()
      // 宿主可能已经变了（别处改过、连接刚恢复）：重新读一次，别让菜单一直显示旧状态。
      void refresh()
    }
  }

  ctx.effect(() => {
    void refresh()
    return () => {}
  }, 'workspace-recency: initial pins')

  // 另一个页面改了固定、或者连接刚恢复时，切回这个页面能看到最新状态。
  ctx.effect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
    const onFocus = (): void => { void refresh() }
    const onVisibility = (): void => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      void refresh()
    }
    const onOnline = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', onVisibility)
    }
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, 'workspace-recency: pin refresh')

  ctx.effect(() => () => control.abort(), 'workspace-recency: abort requests')

  ctx.effect(() => ctx.contextMenus.register({
    id: 'workspace-recency.pin',
    target: 'workspace',
    order: 50,
    observe: () => [pinned, ctx.locale],
    resolve: (target: WorkspaceMenuTarget): readonly MenuAction[] => {
      const id = String(target.workspaceId)
      if (!allowed(target.workspaceId)) return []
      const isPinned = pinned.getSnapshot().has(id)
      return [{
        id: 'pin',
        label: t(isPinned ? 'unpin' : 'pin'),
        icon: { key: isPinned ? 'workspace-recency.unpin' : 'workspace-recency.pin' },
        run: () => togglePin(id),
      }]
    },
  }), 'workspace-recency: pin action')
}
