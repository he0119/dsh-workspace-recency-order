/**
 * 置顶列表的宿主状态：老文件路径、读状态、过滤、切换、落盘失败与老文件迁移。
 *
 * 状态接口换成 `test/fake-pin-state.ts` 里的内存假实现，所以这些用例不碰真实 `storageDomain`、
 * 不碰真实宿主；只有迁移用例会真的写一个临时目录里的 `pins.json`（被迁移的文件本来就是文件）。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { PINS_FILE, PinStore, pinsPath, type PinStateStore } from '../src/pins.ts'
import { fakePinState } from './fake-pin-state.ts'

/** 一件可以随时改「注册表里还有谁」的测试夹。 */
function store(
  state: PinStateStore,
  { known = ['a', 'b', 'c'], legacyFile }: { known?: string[]; legacyFile?: string } = {},
) {
  const warnings: string[] = []
  const knownIds = new Set(known)
  const instance = new PinStore({
    state,
    ...(legacyFile === undefined ? {} : { legacyFile }),
    knownIds: () => knownIds,
    warn: message => warnings.push(message),
  })
  return { instance, warnings, knownIds }
}

/** 一个用完就删的临时 DSH_HOME，里面放一个老版本的 `pins.json`。 */
function legacyHome(content: unknown): { dir: string; file: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pins-'))
  const folder = join(dir, 'workspace-recency-order')
  mkdirSync(folder, { recursive: true })
  const file = join(folder, PINS_FILE)
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
  return { dir, file, done: () => { rmSync(dir, { recursive: true, force: true }) } }
}

test('老文件的路径：$DSH_HOME 优先，空值当没设，否则 ~/.dsh 下', () => {
  const file = join('workspace-recency-order', PINS_FILE)
  assert.equal(pinsPath({}, '/home/me'), join('/home/me', '.dsh', file))
  assert.equal(pinsPath({ DSH_HOME: '/srv/dsh' }, '/home/me'), join('/srv/dsh', file))
  assert.equal(pinsPath({ DSH_HOME: '   ' }, '/home/me'), join('/home/me', '.dsh', file))
})

test('存储里没有记录时是空列表，不告警', async () => {
  const state = fakePinState()
  const { instance, warnings } = store(state)
  await instance.load()
  assert.deepEqual(instance.ids, [])
  assert.deepEqual(warnings, [])
})

test('读状态时按 pinnedAt 升序，丢掉注册表里没有的 id，并把存储改回干净的那份', async () => {
  const state = fakePinState([
    { workspaceId: 'b', pinnedAt: 20 },
    { workspaceId: 'a', pinnedAt: 10 },
    { workspaceId: 'ghost', pinnedAt: 15 },
  ])
  const { instance, warnings } = store(state)
  await instance.load()
  assert.deepEqual(instance.ids, ['a', 'b'])
  assert.deepEqual([...state.records.keys()].sort(), ['a', 'b'])
  assert.deepEqual(warnings, [])
})

test('注册表还没有工作区时，置顶记录原样留着，只去重', async () => {
  const backing = fakePinState()
  // 同一个 id 出现两次：旧文件导错、或两次写入撞在一起都可能留下这种痕迹。
  const duplicated: PinStateStore = {
    read: async () => [
      { workspaceId: 'later', pinnedAt: 2 },
      { workspaceId: 'later', pinnedAt: 1 },
    ],
    put: backing.put,
    remove: backing.remove,
  }
  const { instance, warnings } = store(duplicated, { known: [] })
  await instance.load()
  assert.deepEqual(instance.ids, ['later'])
  assert.deepEqual(warnings, [])
})

test('读不出来当空列表并告警', async () => {
  const state = fakePinState()
  state.failRead = new Error('storage is on fire')
  const { instance, warnings } = store(state)
  await instance.load()
  assert.deepEqual(instance.ids, [])
  assert.ok(warnings.some(message => message.includes('cannot read the pin list')))
})

test('读不出来时，有老文件也只告警一次', async () => {
  const home = legacyHome({ version: 1, workspaceIds: ['a'] })
  try {
    const state = fakePinState()
    state.failRead = new Error('domain is closed')
    const { instance, warnings } = store(state, { legacyFile: home.file })
    await instance.load()
    assert.deepEqual(instance.ids, [])
    assert.equal(warnings.length, 1, `只该有一条告警，实际：${warnings.join(' | ')}`)
    assert.ok(warnings[0]?.includes('cannot read the pin list'))
    assert.equal(existsSync(home.file), true, '读不出来就根本没迁移，旧文件不能动')
  } finally {
    home.done()
  }
})

test('load 只读一次状态：之后再改记录也不影响内存', async () => {
  const state = fakePinState([{ workspaceId: 'a', pinnedAt: 1 }])
  const { instance } = store(state)
  await instance.load()
  state.records.set('b', 2)
  await instance.load()
  assert.deepEqual(instance.ids, ['a'])
  assert.equal(state.reads, 1)
})

test('置顶：追加到末尾、时刻递增；同一条命令重复发送不重复添加', async () => {
  const state = fakePinState()
  const { instance } = store(state)
  await instance.load()
  assert.deepEqual(await instance.toggle('b', true), ['b'])
  const stamp = state.records.get('b')
  assert.equal(typeof stamp, 'number')

  assert.deepEqual(await instance.toggle('b', true), ['b'])
  assert.equal(state.records.get('b'), stamp, '重复置顶不该换一个时刻')

  assert.deepEqual(await instance.toggle('c', true), ['b', 'c'])
  assert.ok(state.records.get('c')! > stamp!, '后置顶的时刻必须更大')
  assert.deepEqual(await instance.toggle('a', true), ['b', 'c', 'a'])
  assert.equal(state.records.size, 3)
})

test('取消置顶：删掉那条记录；没置顶过的工作区取消也是空操作', async () => {
  const state = fakePinState([{ workspaceId: 'a', pinnedAt: 1 }, { workspaceId: 'b', pinnedAt: 2 }])
  const { instance } = store(state)
  assert.deepEqual(await instance.toggle('a', false), ['b'])
  assert.deepEqual([...state.records.keys()], ['b'])
  assert.deepEqual(await instance.toggle('c', false), ['b'])
  assert.equal(state.reads, 1, '取消一个没置顶的工作区不该再读一遍')
})

test('置顶宿主里没有的 id 是空操作，不会写进存储', async () => {
  const state = fakePinState()
  const { instance } = store(state)
  await instance.load()
  assert.deepEqual(await instance.toggle('ghost', true), [])
  assert.equal(state.records.size, 0, '没有变化就不该写任何记录')
})

test('写不进去只告警，内存里的状态照样生效', async () => {
  const state = fakePinState()
  state.failWrite = new Error('no space left on device')
  const { instance, warnings } = store(state)
  await instance.load()
  assert.deepEqual(await instance.toggle('a', true), ['a'])
  assert.ok(warnings.some(message => message.includes('cannot save the pin list')))
  assert.equal(state.records.size, 0, '写失败的记录不该出现在存储里')
})

test('两个切换命令同时到达：串行执行，谁也不会覆盖谁', async () => {
  const state = fakePinState()
  const { instance } = store(state)
  await instance.load()
  await Promise.all([instance.toggle('a', true), instance.toggle('b', true)])
  assert.deepEqual(instance.ids, ['a', 'b'])
  assert.deepEqual([...state.records.keys()], ['a', 'b'])
})

test('没给老文件位置时完全不看那个文件', async () => {
  const home = legacyHome({ version: 1, workspaceIds: ['a'] })
  try {
    const { instance, warnings } = store(fakePinState())
    await instance.load()
    assert.deepEqual(instance.ids, [])
    assert.equal(existsSync(home.file), true)
    assert.deepEqual(warnings, [])
  } finally {
    home.done()
  }
})

test('老文件还在、存储是空的：按文件顺序导入，并把文件改名成 .migrated', async () => {
  const home = legacyHome({ version: 1, workspaceIds: ['c', 'a'] })
  try {
    const state = fakePinState()
    const { instance, warnings } = store(state, { legacyFile: home.file })
    await instance.load()
    assert.deepEqual(instance.ids, ['c', 'a'], '文件里的先后就是置顶先后')
    assert.equal(state.records.get('c'), 1)
    assert.equal(state.records.get('a'), 2)
    assert.equal(existsSync(home.file), false, '导入后旧文件必须改名')
    assert.equal(existsSync(`${home.file}.migrated`), true)
    assert.deepEqual(warnings, [])
  } finally {
    home.done()
  }
})

test('迁移是幂等的：第二次启动不再导入，也不再告警', async () => {
  const home = legacyHome({ version: 1, workspaceIds: ['c', 'a'] })
  try {
    const state = fakePinState()
    await store(state, { legacyFile: home.file }).instance.load()
    const second = store(state, { legacyFile: home.file })
    await second.instance.load()
    assert.deepEqual(second.instance.ids, ['c', 'a'])
    assert.deepEqual(second.warnings, [])
    assert.equal(state.records.size, 2)
  } finally {
    home.done()
  }
})

test('存储里已经有记录时不再导入，旧文件原样留着', async () => {
  const home = legacyHome({ version: 1, workspaceIds: ['a'] })
  try {
    const state = fakePinState([{ workspaceId: 'b', pinnedAt: 5 }])
    const { instance, warnings } = store(state, { legacyFile: home.file })
    await instance.load()
    assert.deepEqual(instance.ids, ['b'])
    assert.equal(state.records.size, 1)
    assert.equal(existsSync(home.file), true, '不导入就不要动旧文件')
    assert.deepEqual(warnings, [])
  } finally {
    home.done()
  }
})

test('老文件形状不认识：不崩、告警、文件原样留着', async () => {
  const cases = [
    { content: { version: 99, workspaceIds: ['a'] }, expected: 'unexpected shape' },
    { content: { version: 1, pinned: ['a'] }, expected: 'unexpected shape' },
    { content: '{not json', expected: 'not valid JSON' },
  ] as const
  for (const { content, expected } of cases) {
    const home = legacyHome(content)
    try {
      const state = fakePinState()
      const { instance, warnings } = store(state, { legacyFile: home.file })
      await instance.load()
      assert.deepEqual(instance.ids, [], `内容 ${JSON.stringify(content)} 不该被当成置顶列表`)
      assert.ok(
        warnings.some(message => message.includes(expected)),
        `应该告警 ${expected}，实际：${warnings.join(' | ')}`,
      )
      assert.equal(existsSync(home.file), true)
    } finally {
      home.done()
    }
  }
})

test('迁移写不进去：告警、撤回写了一半的记录，旧文件留着等下次再试', async () => {
  const home = legacyHome({ version: 1, workspaceIds: ['a', 'b'] })
  try {
    const state = fakePinState()
    state.failWrite = new Error('no space left on device')
    const { instance, warnings } = store(state, { legacyFile: home.file })
    await instance.load()
    assert.deepEqual(instance.ids, [])
    assert.ok(warnings.some(message => message.includes('cannot migrate the old pin list')))
    assert.equal(state.records.size, 0)
    assert.equal(existsSync(home.file), true)
  } finally {
    home.done()
  }
})

test('老文件里注册表已经没有的 id，导入后照样被清掉', async () => {
  const home = legacyHome({ version: 1, workspaceIds: ['a', 'ghost'] })
  try {
    const state = fakePinState()
    const { instance } = store(state, { legacyFile: home.file })
    await instance.load()
    assert.deepEqual(instance.ids, ['a'])
    assert.deepEqual([...state.records.keys()], ['a'])
  } finally {
    home.done()
  }
})

test('老文件里的重复 id 只导入一次', async () => {
  const home = legacyHome({ version: 1, workspaceIds: ['a', 'a', 'b'] })
  try {
    const state = fakePinState()
    const { instance } = store(state, { legacyFile: home.file })
    await instance.load()
    assert.deepEqual(instance.ids, ['a', 'b'])
    assert.equal(state.records.size, 2)
  } finally {
    home.done()
  }
})
