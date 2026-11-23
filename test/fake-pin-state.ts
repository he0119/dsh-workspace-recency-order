/**
 * 内存里的置顶记录：单元测试用的 `PinStateStore` 假实现。
 *
 * `PinStore` 只认 `src/pins.ts` 里那份结构化接口，所以测试既不需要真实 `ctx.storageDomain`，也不需要
 * 真实宿主、真实文件或真实时钟。这里再顺手把假状态包成 `pins` 表的句柄与一个假 `storageDomain`，
 * 让接线层（`test/host.test.ts`）也能用同一份。
 */
import type { PinStateStore, PinTable, StoredPin } from '../src/pins.ts'
import type { PinDomain } from '../src/types.ts'

/** 内存里的置顶记录。 */
export interface FakePinState extends PinStateStore {
  /** 工作区 id → `pinnedAt`；`read()` 只读它。 */
  readonly records: Map<string, number>
  /** 设成错误后，下一次 `read()` 抛它（用完自己清掉）。 */
  failRead?: Error
  /** 设成错误后，`put()` 抛它。 */
  failWrite?: Error
  /** `read()` 被调用的次数。 */
  reads: number
}

/**
 * 建一份假状态。
 * @param initial - 初始记录（同一个 id 出现多次时后一条覆盖前一条）。
 */
export function fakePinState(initial: readonly StoredPin[] = []): FakePinState {
  const records = new Map(initial.map(pin => [pin.workspaceId, pin.pinnedAt]))
  const state: FakePinState = {
    records,
    reads: 0,
    async read() {
      state.reads += 1
      if (state.failRead !== undefined) throw state.failRead
      return [...records].map(([workspaceId, pinnedAt]) => ({ workspaceId, pinnedAt }))
    },
    async put(workspaceId, pinnedAt) {
      if (state.failWrite !== undefined) throw state.failWrite
      records.set(workspaceId, pinnedAt)
    },
    async remove(workspaceId) {
      records.delete(workspaceId)
    },
  }
  return state
}

/** 把假状态包成领域里 `pins` 表的句柄。 */
export function fakePinTable(state: FakePinState): PinTable {
  return {
    *entries() {
      for (const [workspaceId, pinnedAt] of state.records) yield [workspaceId, { pinnedAt }]
    },
    async put(key, value) {
      await state.put(key, value.pinnedAt)
    },
    async delete(key) {
      return state.records.delete(key)
    },
  }
}

/**
 * 假的 `ctx.storageDomain`：`open()` 立刻返回由 {@link fakePinTable} 支撑的领域句柄。
 * @param state - 这个领域背后的记录。
 */
export function fakeStorageDomain(state: FakePinState) {
  return {
    async open(): Promise<PinDomain> {
      return {
        name: 'workspace_recency_order',
        table: (name: string) => {
          if (name !== 'pins') throw new Error(`unexpected table: ${name}`)
          return fakePinTable(state)
        },
        close: async () => {},
      }
    },
  }
}
