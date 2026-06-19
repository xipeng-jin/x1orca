import { describe, expect, it } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import { isWorktreeDiffTabActiveForFile } from './source-control-active-diff-tab'

function diffFile(overrides: Partial<OpenFile>): OpenFile {
  return {
    id: 'wt1::diff::staged::src/app.ts',
    filePath: '/repo/src/app.ts',
    relativePath: 'src/app.ts',
    worktreeId: 'wt1',
    language: 'typescript',
    isDirty: false,
    mode: 'diff',
    diffSource: 'staged',
    ...overrides
  }
}

function makeState(
  file: OpenFile,
  overrides?: Partial<Parameters<typeof isWorktreeDiffTabActiveForFile>[0]>
) {
  return {
    openFiles: [file],
    activeFileIdByWorktree: { wt1: file.id },
    activeTabTypeByWorktree: { wt1: 'editor' as const },
    ...overrides
  }
}

describe('isWorktreeDiffTabActiveForFile', () => {
  it('is true when the active editor tab is the matching diff', () => {
    const state = makeState(diffFile({}))
    expect(isWorktreeDiffTabActiveForFile(state, 'wt1', 'src/app.ts')).toBe(true)
  })

  it('matches regardless of diff source (branch/commit/unstaged are all valid surfaces)', () => {
    const state = makeState(diffFile({ id: 'wt1::diff::branch::src/app.ts', diffSource: 'branch' }))
    expect(isWorktreeDiffTabActiveForFile(state, 'wt1', 'src/app.ts')).toBe(true)
  })

  it('is false when a different file is active', () => {
    const state = makeState(diffFile({}))
    expect(isWorktreeDiffTabActiveForFile(state, 'wt1', 'src/other.ts')).toBe(false)
  })

  it('is false when the active tab is the terminal, not the editor', () => {
    const file = diffFile({})
    const state = makeState(file, { activeTabTypeByWorktree: { wt1: 'terminal' } })
    expect(isWorktreeDiffTabActiveForFile(state, 'wt1', 'src/app.ts')).toBe(false)
  })

  it('is false when the active editor tab is an editable file, not a diff', () => {
    const state = makeState(diffFile({ mode: 'edit', diffSource: undefined }))
    expect(isWorktreeDiffTabActiveForFile(state, 'wt1', 'src/app.ts')).toBe(false)
  })

  it('is false when there is no active file for the worktree', () => {
    const file = diffFile({})
    const state = makeState(file, { activeFileIdByWorktree: { wt1: null } })
    expect(isWorktreeDiffTabActiveForFile(state, 'wt1', 'src/app.ts')).toBe(false)
  })
})
