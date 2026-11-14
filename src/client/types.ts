/**
 * Web Client 端用到的最小服务表面。
 *
 * 与 Host 端同理：只声明真正用到的成员，不 import 任何 DSH 包，产物里一个 require 都不多。
 */

/** 菜单里的一行动作。 */
export interface MenuAction {
  readonly id: string
  readonly label: string
  readonly icon?: { readonly key: string; readonly src?: string }
  readonly danger?: boolean
  readonly separatorBefore?: boolean
  run(): void | Promise<void>
}

/** 工作区族菜单拿到的目标。 */
export interface WorkspaceMenuTarget {
  readonly workspaceId: string
  readonly path?: string
  readonly displayTitle?: string
}

/** `ctx.contextMenus` 服务面。 */
export interface ContextMenusService {
  register(definition: {
    readonly id: string
    readonly target: 'workspace'
    readonly order?: number
    readonly observe?: () => readonly unknown[]
    readonly resolve: (target: WorkspaceMenuTarget) => readonly MenuAction[]
  }): () => void
  notify(text: string, success?: boolean, action?: {
    readonly label: string
    readonly run: () => void | Promise<void>
    readonly failureLabel: string
  }): void
}

/** `ctx.locale` 服务面。 */
export interface LocaleService {
  bind(namespace: string): (key: string) => string
  register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
}

/** `ctx.slots` 服务面。 */
export interface SlotsService {
  inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void
  register(options: { readonly name: string; readonly key?: string }, component: () => unknown): () => void
}

/** 远程访问权限面（可能没有这个服务）。 */
export interface RemoteAccessService {
  source(kind: 'workspace', id: string, action: string): { getSnapshot(): boolean }
}

/** Cordis 插件上下文面（只列本插件用到的成员）。 */
export interface ClientContext {
  readonly slots: SlotsService
  readonly contextMenus: ContextMenusService
  readonly locale: LocaleService
  effect(callback: () => () => void, label?: string): unknown
  /** 取一个可选服务；没有时返回 undefined。 */
  get?(name: string): unknown
}
