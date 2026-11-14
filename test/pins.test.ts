/**
 * 置顶列表的宿主状态：路径、读盘、过滤、切换与落盘。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { PINS_FILE, PinStore, pinsPath } from '../src/pins.ts'

/** 一个用完就删的临时目录。 */
function tempDir(): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pins-'))
  return { dir, done: () => { rmSync(dir, { recursive: true, force: true }) } }
}

/** 一件可以随时改「注册表里还有谁」的测试夹。 */
function store(dir: string, known: string[] = ['a', 'b', 'c']) {
  const warnings: string[] = []
  const knownIds = new Set(known)
  const instance = new PinStore({
    file: join(dir, 'pins.json'),
    knownIds: () => knownIds,
    warn: message => warnings.push(message),
  })
  return { instance, warnings, knownIds }
}

/** 直接看盘上的内容。 */
const fileOf = (dir: string): { version: number; workspaceIds: string[] } =>
  JSON.parse(readFileSync(join(dir, 'pins.json'), 'utf8'))

test('置顶列表的路径：$DSH_HOME 优先，空值当没设，否则 ~/.dsh 下', () => {
  const file = join('workspace-recency-order', PINS_FILE)
  assert.equal(pinsPath({}, '/home/me'), join('/home/me', '.dsh', file))
  assert.equal(pinsPath({ DSH_HOME: '/srv/dsh' }, '/home/me'), join('/srv/dsh', file))
  assert.equal(pinsPath({ DSH_HOME: '   ' }, '/home/me'), join('/home/me', '.dsh', file))
})

test('文件不存在当空列表，不告警', async () => {
  const { dir, done } = tempDir()
  try {
    const { instance, warnings } = store(dir)
    await instance.load()
    assert.deepEqual(instance.ids, [])
    assert.deepEqual(warnings, [])
  } finally {
    done()
  }
})

test('读盘时丢掉注册表里没有的 id，并把文件改回干净的那份', async () => {
  const { dir, done } = tempDir()
  try {
    writeFileSync(join(dir, 'pins.json'), JSON.stringify({ version: 1, workspaceIds: ['a', 'ghost', 'b'] }))
    const { instance, warnings } = store(dir)
    await instance.load()
    assert.deepEqual(instance.ids, ['a', 'b'])
    assert.deepEqual(fileOf(dir).workspaceIds, ['a', 'b'])
    assert.deepEqual(warnings, [])
  } finally {
    done()
  }
})

test('注册表还没有工作区时，置顶列表原样留着', async () => {
  const { dir, done } = tempDir()
  try {
    writeFileSync(join(dir, 'pins.json'), JSON.stringify({ version: 1, workspaceIds: ['later'] }))
    const { instance } = store(dir, [])
    await instance.load()
    assert.deepEqual(instance.ids, ['later'])
    assert.deepEqual(fileOf(dir).workspaceIds, ['later'])
  } finally {
    done()
  }
})

test('坏文件当空列表并告警：JSON 坏掉、版本不认识、形状不对', async () => {
  const { dir, done } = tempDir()
  try {
    writeFileSync(join(dir, 'pins.json'), '{not json')
    const broken = store(dir)
    await broken.instance.load()
    assert.deepEqual(broken.instance.ids, [])
    assert.ok(broken.warnings.some(message => message.includes('not valid JSON')))

    writeFileSync(join(dir, 'pins.json'), JSON.stringify({ version: 99, workspaceIds: ['a'] }))
    const future = store(dir)
    await future.instance.load()
    assert.deepEqual(future.instance.ids, [])
    assert.ok(future.warnings.some(message => message.includes('unexpected shape')))

    writeFileSync(join(dir, 'pins.json'), JSON.stringify({ version: 1, pinned: ['a'] }))
    const other = store(dir)
    await other.instance.load()
    assert.deepEqual(other.instance.ids, [])
    assert.equal(other.warnings.length, 1)
  } finally {
    done()
  }
})

test('load 只读一次盘：之后再改文件也不影响内存', async () => {
  const { dir, done } = tempDir()
  try {
    writeFileSync(join(dir, 'pins.json'), JSON.stringify({ version: 1, workspaceIds: ['a'] }))
    const { instance } = store(dir)
    await instance.load()
    writeFileSync(join(dir, 'pins.json'), JSON.stringify({ version: 1, workspaceIds: ['b'] }))
    await instance.load()
    assert.deepEqual(instance.ids, ['a'])
  } finally {
    done()
  }
})

test('置顶：追加到末尾并落盘；同一条命令重复发送不重复添加', async () => {
  const { dir, done } = tempDir()
  try {
    const { instance } = store(dir)
    await instance.load()
    assert.deepEqual(await instance.toggle('b', true), ['b'])
    assert.deepEqual(fileOf(dir).workspaceIds, ['b'])
    assert.deepEqual(await instance.toggle('b', true), ['b'])
    assert.deepEqual(fileOf(dir).workspaceIds, ['b'])
    assert.deepEqual(await instance.toggle('c', true), ['b', 'c'])
  } finally {
    done()
  }
})

test('取消置顶：从列表里去掉；没置顶过的工作区取消也是空操作', async () => {
  const { dir, done } = tempDir()
  try {
    writeFileSync(join(dir, 'pins.json'), JSON.stringify({ version: 1, workspaceIds: ['a', 'b'] }))
    const { instance } = store(dir)
    assert.deepEqual(await instance.toggle('a', false), ['b'])
    assert.deepEqual(await instance.toggle('c', false), ['b'])
    assert.deepEqual(fileOf(dir).workspaceIds, ['b'])
  } finally {
    done()
  }
})

test('置顶宿主里没有的 id 是空操作，不会写进文件', async () => {
  const { dir, done } = tempDir()
  try {
    const { instance } = store(dir)
    await instance.load()
    assert.deepEqual(await instance.toggle('ghost', true), [])
    assert.equal(existsSync(join(dir, 'pins.json')), false, '没有变化就不该写盘')
  } finally {
    done()
  }
})

test('写不进去只告警，内存里的状态照样生效', async () => {
  const { dir, done } = tempDir()
  try {
    // 目标路径的父级是个文件，mkdir 会失败。
    writeFileSync(join(dir, 'blocked'), '')
    const warnings: string[] = []
    const instance = new PinStore({
      file: join(dir, 'blocked', 'pins.json'),
      knownIds: () => new Set(['a']),
      warn: message => warnings.push(message),
    })
    await instance.load()
    assert.deepEqual(await instance.toggle('a', true), ['a'])
    assert.ok(warnings.some(message => message.includes('cannot save the pin list')))
  } finally {
    done()
  }
})

test('目录按需创建', async () => {
  const { dir, done } = tempDir()
  try {
    const nested = join(dir, 'nested', 'deeper')
    mkdirSync(nested, { recursive: true })
    const instance = new PinStore({
      file: join(nested, 'pins.json'),
      knownIds: () => new Set(['a']),
      warn: () => {},
    })
    await instance.load()
    await instance.toggle('a', true)
    assert.deepEqual(fileOf(nested).workspaceIds, ['a'])
  } finally {
    done()
  }
})

test('两个切换命令同时到达：串行执行，谁也不会覆盖谁', async () => {
  const { dir, done } = tempDir()
  try {
    const { instance } = store(dir)
    await instance.load()
    await Promise.all([instance.toggle('a', true), instance.toggle('b', true)])
    assert.deepEqual(instance.ids, ['a', 'b'])
    assert.deepEqual(fileOf(dir).workspaceIds, ['a', 'b'])
  } finally {
    done()
  }
})
