/**
 * 决策笔记的格式契约：`{lifecycle}/{class}/yyyy-mm-dd-title.md` 加固定的前三行。
 *
 * 这套结构只有被机械核过才站得住：状态编码在**目录**里，骨架编码在**头部三行**与章节名里，两件事
 * 都不需要读懂内容就能判定。所以这一份不测行为，只核声明——它盯的是「笔记被搬到了另一层目录却没改
 * Status」「implemented/ 里混进提案用语」「相对链接指向一个不存在的文件」这类靠 review 容易漏掉的
 * 漂移。
 *
 * runner（`test/run-all.mjs`）会把 test/ 下每个 `.test.ts` 在同一进程里 import 一遍，所以这份用例
 * 不需要单独接线。
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOTES_ROOT = join(HERE, '..', '.agents', 'notes')

/** 生命周期目录（顶层）与它们各自允许的 `Status:` 行。 */
const LIFECYCLES = ['proposed', 'implemented', 'rejected'] as const
type Lifecycle = (typeof LIFECYCLES)[number]

/** 类别目录（嵌套）。封闭集合：新增一类要同时改这里与 `.agents/notes/AGENTS.md`。 */
const CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'] as const

/** 每层必需的章节——`## Problem` 之外的部分。 */
const REQUIRED: Readonly<Record<Lifecycle, readonly string[]>> = {
  proposed: ['Proposal', 'Alternatives considered', 'Acceptance criteria', 'Risks'],
  implemented: ['Decision', 'Alternatives considered', 'Consequences'],
  rejected: ['Proposal', 'Alternatives considered'],
}

/** `implemented/` 里不许出现的提案用语：它们描述的是还没发生的事。 */
const PROPOSAL_SPEAK = ['Proposal', 'Plan', 'Migration plan', 'Acceptance criteria']

/** 一篇形状合法的笔记。 */
interface ShapedNote {
  readonly path: string
  readonly rel: string
  readonly lifecycle: Lifecycle
  readonly kind: string
}

/** 递归列出目录下所有文件。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.isFile()) out.push(path)
  }
  return out
}

/** 收集所有笔记，并顺手核路径形状（这样后面的用例不必再判 undefined）。 */
function collect(): ShapedNote[] {
  const notes: ShapedNote[] = []
  for (const path of walk(NOTES_ROOT)) {
    const rel = relative(NOTES_ROOT, path).split('\\').join('/')
    // 顶层与类别目录里的 AGENTS.md 是规则本身，不是笔记。
    if (basename(path) === 'AGENTS.md') continue
    assert.ok(path.endsWith('.md'), `笔记必须是 .md：${rel}`)
    const parts = rel.split('/')
    assert.equal(parts.length, 3, `笔记路径必须是 {lifecycle}/{class}/yyyy-mm-dd-title.md：${rel}`)
    const [lifecycle, kind] = parts as [string, string, string]
    assert.ok((LIFECYCLES as readonly string[]).includes(lifecycle), `未知生命周期目录：${lifecycle}`)
    assert.ok((CLASSES as readonly string[]).includes(kind), `未知类别目录：${kind}`)
    assert.match(
      parts[2]!,
      /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$/,
      `文件名必须是 yyyy-mm-dd-topic-title.md（小写、连字符分词）：${rel}`,
    )
    notes.push({ path, rel, lifecycle: lifecycle as Lifecycle, kind })
  }
  return notes
}

const NOTES = collect()

/** 读一篇笔记的正文（去掉头部三行）。 */
function body(path: string): string {
  return readFileSync(path, 'utf8')
}

/** 正文里的二级标题，按出现顺序。 */
function headings(text: string): string[] {
  return [...text.matchAll(/^## (.+)$/gm)].map(match => match[1]!.trim())
}

test('至少有一篇笔记，路径形状合法', () => {
  assert.ok(NOTES.length > 0, '一篇笔记都没有，说明这套结构还没被用起来')
})

test('前三行固定为标题、空行、Status，且 Status 与目录一致', () => {
  for (const note of NOTES) {
    const lines = body(note.path).split('\n')
    assert.match(lines[0] ?? '', /^# Agent Note: \S/, `${note.rel} 的第一行必须是「# Agent Note: 标题」`)
    assert.equal(lines[1], '', `${note.rel} 的第一行之后必须空一行`)
    const status = lines[2] ?? ''
    if (note.lifecycle === 'implemented') assert.equal(status, 'Status: implemented', `${note.rel} 的 Status 行`)
    else if (note.lifecycle === 'proposed') assert.equal(status, 'Status: proposed', `${note.rel} 的 Status 行`)
    else assert.match(status, /^Status: rejected — \S/, `${note.rel} 的 rejected 必须在 Status 行写原因`)
    assert.equal(lines[3], '', `${note.rel} 的 Status 行之后必须空一行`)
  }
})

test('正文以 ## Problem 开头，必备章节齐全', () => {
  for (const note of NOTES) {
    const found = headings(body(note.path))
    assert.equal(found[0], 'Problem', `${note.rel} 的第一个二级标题必须是 ## Problem`)
    for (const section of REQUIRED[note.lifecycle]) {
      assert.ok(found.includes(section), `${note.rel} 缺少 ## ${section}`)
    }
  }
})

test('implemented/ 里不出现提案用语', () => {
  for (const note of NOTES.filter(candidate => candidate.lifecycle === 'implemented')) {
    const found = headings(body(note.path))
    for (const forbidden of PROPOSAL_SPEAK) {
      assert.ok(!found.includes(forbidden), `${note.rel} 是已交付的现实，不该有 ## ${forbidden}`)
    }
  }
})

test('相对链接指向当下存在的文件', () => {
  for (const note of NOTES) {
    const text = body(note.path)
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1]!
      if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue
      const path = target.split('#')[0]!
      const resolved = resolve(dirname(note.path), path)
      assert.ok(existsSync(resolved), `${note.rel} 里的链接指不到东西：${target}`)
    }
  }
})
