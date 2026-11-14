/**
 * 插件行的可配置项（`cordis.patch.yml` 里本插件那一行的 `config`）。
 *
 * 这里不引 schemastery：本插件只有一个平面配置对象，手写校验比拖一个 schema 依赖更省事，
 * 而且写错的键名会留一条 warn，不会静默变形。
 */

/** 解析后的完整配置。 */
export interface Options {
  /** 总开关；false 时不注册任何监听。 */
  readonly enabled: boolean
  /** 启动时按已有会话记录整理一次顺序。 */
  readonly sortOnStart: boolean
  /** 新建会话（还没发言的空会话也算）时把所属工作区提到最前。 */
  readonly trackNewSessions: boolean
  /** 连续活动合并成一次写入的等待时间（毫秒）。 */
  readonly debounceMs: number
}

/** 各项默认值。 */
export const DEFAULT_OPTIONS: Options = {
  enabled: true,
  sortOnStart: true,
  trackNewSessions: true,
  debounceMs: 600,
}

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_OPTIONS))

/**
 * 校验一行配置。
 * @param raw - Loader 传进来的 `config`，可能为空或形状不对。
 * @param warn - 报告未知键与不可用取值的回调。
 * @returns 填好默认值的完整配置。
 */
export function readOptions(raw: unknown, warn: (message: string) => void): Options {
  const source = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (!KNOWN_KEYS.has(key)) warn(`ignoring unknown config key "${key}"`)
  }
  const flag = (key: 'enabled' | 'sortOnStart' | 'trackNewSessions'): boolean => {
    const value = source[key]
    if (value === undefined) return DEFAULT_OPTIONS[key]
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 'false') return value === 'true'
    warn(`"${key}" must be true or false; using ${DEFAULT_OPTIONS[key]}`)
    return DEFAULT_OPTIONS[key]
  }
  const delay = Number(source.debounceMs)
  return {
    enabled: flag('enabled'),
    sortOnStart: flag('sortOnStart'),
    trackNewSessions: flag('trackNewSessions'),
    debounceMs: Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_OPTIONS.debounceMs,
  }
}
