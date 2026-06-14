import { describe, expect, it } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import {
  isReloadableSingleFileDiffTab,
  shouldForceReloadDiffOnNonceBump,
  shouldReloadDiffOnGitStatusChange
} from './editor-panel-diff-reload'

function makeDiffFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: 'wt-1::diff::unstaged::file.ts',
    filePath: '/repo/file.ts',
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    isDirty: false,
    mode: 'diff',
    diffSource: 'unstaged',
    ...overrides
  }
}

describe('editor-panel-diff-reload helpers', () => {
  it('treats single-file diff tabs as reloadable', () => {
    expect(isReloadableSingleFileDiffTab(makeDiffFile())).toBe(true)
    expect(isReloadableSingleFileDiffTab(makeDiffFile({ diffSource: 'staged' }))).toBe(true)
    expect(isReloadableSingleFileDiffTab(makeDiffFile({ diffSource: 'branch' }))).toBe(true)
    expect(
      isReloadableSingleFileDiffTab(makeDiffFile({ diffSource: 'combined-uncommitted' }))
    ).toBe(false)
  })

  it('reloads unstaged and staged diff tabs when git status changes', () => {
    expect(shouldReloadDiffOnGitStatusChange(makeDiffFile())).toBe(true)
    expect(shouldReloadDiffOnGitStatusChange(makeDiffFile({ diffSource: 'staged' }))).toBe(true)
    expect(shouldReloadDiffOnGitStatusChange(makeDiffFile({ diffSource: 'branch' }))).toBe(false)
    expect(shouldReloadDiffOnGitStatusChange(makeDiffFile({ mode: 'edit' }))).toBe(false)
  })

  it('does not force a nonce reload without a bumped nonce', () => {
    expect(shouldForceReloadDiffOnNonceBump(makeDiffFile(), undefined, true)).toBe(false)
    expect(shouldForceReloadDiffOnNonceBump(makeDiffFile(), 0, true)).toBe(false)
  })

  it('does not force a nonce reload for non-reloadable (combined) diff tabs', () => {
    expect(
      shouldForceReloadDiffOnNonceBump(
        makeDiffFile({ diffSource: 'combined-uncommitted' }),
        1,
        true
      )
    ).toBe(false)
  })

  it('skips the nonce reload while no content is loaded so it never duplicates the first-open fetch', () => {
    expect(shouldForceReloadDiffOnNonceBump(makeDiffFile(), 1, false)).toBe(false)
  })

  it('forces a nonce reload for a loaded reloadable diff tab', () => {
    expect(shouldForceReloadDiffOnNonceBump(makeDiffFile(), 1, true)).toBe(true)
    expect(shouldForceReloadDiffOnNonceBump(makeDiffFile({ diffSource: 'staged' }), 2, true)).toBe(
      true
    )
    expect(shouldForceReloadDiffOnNonceBump(makeDiffFile({ diffSource: 'branch' }), 1, true)).toBe(
      true
    )
  })
})
