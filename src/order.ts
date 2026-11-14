/**
 * 排序规则：纯函数，不碰任何服务，测试直接覆盖。
 */

/** 可参与排序的最小形状：只需要身份。 */
export interface RankedWorkspace {
  readonly id: string
}

/**
 * 按活跃时间排名，新的在前；排名相同保持传入顺序。置顶的工作区不参与排名，整体排在开头，
 * 它们之间保持传入顺序。
 * @param workspaces - 当前注册表顺序。
 * @param rankOf - 每个工作区的活跃时间（epoch 毫秒），没有活动给 0。
 * @param pinned - 置顶的工作区 id；不在注册表里或重复的忽略。
 * @returns 目标顺序里的工作区 id。
 */
export function orderByActivity<T extends RankedWorkspace>(
  workspaces: readonly T[],
  rankOf: (workspace: T) => number,
  pinned: Iterable<string> = [],
): string[] {
  const fixed = new Set(pinned)
  const head: string[] = []
  const tail: { id: string; index: number; latest: number }[] = []
  for (const [index, workspace] of workspaces.entries()) {
    if (fixed.has(workspace.id)) {
      head.push(workspace.id)
      continue
    }
    tail.push({ id: workspace.id, index, latest: rankOf(workspace) })
  }
  tail.sort((left, right) => (right.latest - left.latest) || (left.index - right.index))
  return [...head, ...tail.map(entry => entry.id)]
}

/**
 * 找出让 `order` 向 `desired` 靠近一步的那一次移动。
 * @param order - 当前注册表顺序。
 * @param desired - 目标顺序。
 * @returns `[要移动的 id, 插到谁前面]`；已经有序时是 null。
 */
export function nextMove(order: readonly string[], desired: readonly string[]): readonly [string, string] | null {
  for (let position = 0; position < desired.length; position += 1) {
    const target = desired[position]
    if (order[position] === target) continue
    if (!order.includes(target)) return null
    return [target, order[position]]
  }
  return null
}
