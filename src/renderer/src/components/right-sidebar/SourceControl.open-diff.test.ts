import { describe, expect, it, vi } from 'vitest'
import { openSourceControlEntryDiff } from './SourceControl'
import type { GitStatusEntry } from '../../../../shared/types'

function entry(overrides: Partial<GitStatusEntry> = {}): GitStatusEntry {
  return {
    path: 'docs/readme.md',
    status: 'modified',
    area: 'unstaged',
    ...overrides
  }
}

describe('openSourceControlEntryDiff', () => {
  it('opens unstaged markdown rows in Changes mode edit tabs', () => {
    const openDiff = vi.fn()
    const openConflictFile = vi.fn()
    const openFile = vi.fn()
    const setEditorViewMode = vi.fn()
    const startDiffContentFetch = vi.fn()

    openSourceControlEntryDiff({
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      entry: entry(),
      trackConflictPath: vi.fn(),
      openConflictFile,
      openDiff,
      openFile,
      setEditorViewMode,
      startDiffContentFetch
    })

    expect(openFile).toHaveBeenCalledWith(
      {
        filePath: '/repo/docs/readme.md',
        relativePath: 'docs/readme.md',
        worktreeId: 'wt-1',
        language: 'markdown',
        mode: 'edit'
      },
      undefined
    )
    expect(setEditorViewMode).toHaveBeenCalledWith('/repo/docs/readme.md', 'changes')
    expect(openDiff).not.toHaveBeenCalled()
    expect(openConflictFile).not.toHaveBeenCalled()
    expect(startDiffContentFetch).not.toHaveBeenCalled()
  })

  it('keeps unresolved conflicts on the conflict review path', () => {
    const openDiff = vi.fn()
    const openConflictFile = vi.fn()
    const trackConflictPath = vi.fn()
    const startDiffContentFetch = vi.fn()
    const conflict = entry({
      conflictKind: 'both_modified',
      conflictStatus: 'unresolved',
      conflictStatusSource: 'git'
    })

    openSourceControlEntryDiff({
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      entry: conflict,
      trackConflictPath,
      openConflictFile,
      openDiff,
      openFile: vi.fn(),
      setEditorViewMode: vi.fn(),
      startDiffContentFetch
    })

    expect(trackConflictPath).toHaveBeenCalledWith('wt-1', 'docs/readme.md', 'both_modified')
    expect(openConflictFile).toHaveBeenCalledWith('wt-1', '/repo', conflict, 'markdown', undefined)
    expect(openDiff).not.toHaveBeenCalled()
    expect(startDiffContentFetch).not.toHaveBeenCalled()
  })

  it('passes oldPath when opening renamed working-tree diff tabs', () => {
    const openDiff = vi.fn()
    const startDiffContentFetch = vi.fn()

    openSourceControlEntryDiff({
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      entry: entry({
        path: 'src/new-name.ts',
        oldPath: 'src/old-name.ts',
        status: 'renamed',
        area: 'staged'
      }),
      trackConflictPath: vi.fn(),
      openConflictFile: vi.fn(),
      openDiff,
      openFile: vi.fn(),
      setEditorViewMode: vi.fn(),
      startDiffContentFetch
    })

    expect(openDiff).toHaveBeenCalledWith(
      'wt-1',
      '/repo/src/new-name.ts',
      'src/new-name.ts',
      'typescript',
      true,
      { oldPath: 'src/old-name.ts', diffStatus: 'renamed' }
    )
  })

  it('does not pass oldPath for unstaged edit companions of staged renames', () => {
    const openDiff = vi.fn()

    openSourceControlEntryDiff({
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      entry: entry({
        path: 'src/new-name.ts',
        oldPath: 'src/old-name.ts',
        status: 'modified',
        area: 'unstaged'
      }),
      trackConflictPath: vi.fn(),
      openConflictFile: vi.fn(),
      openDiff,
      openFile: vi.fn(),
      setEditorViewMode: vi.fn(),
      startDiffContentFetch: vi.fn()
    })

    expect(openDiff).toHaveBeenCalledWith(
      'wt-1',
      '/repo/src/new-name.ts',
      'src/new-name.ts',
      'typescript',
      false,
      { oldPath: undefined, diffStatus: 'modified' }
    )
  })

  it('keeps oldPath for true unstaged rename rows', () => {
    const openDiff = vi.fn()

    openSourceControlEntryDiff({
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      entry: entry({
        path: 'src/new-name.ts',
        oldPath: 'src/old-name.ts',
        status: 'renamed',
        area: 'unstaged'
      }),
      trackConflictPath: vi.fn(),
      openConflictFile: vi.fn(),
      openDiff,
      openFile: vi.fn(),
      setEditorViewMode: vi.fn(),
      startDiffContentFetch: vi.fn()
    })

    expect(openDiff).toHaveBeenCalledWith(
      'wt-1',
      '/repo/src/new-name.ts',
      'src/new-name.ts',
      'typescript',
      false,
      { oldPath: 'src/old-name.ts', diffStatus: 'renamed' }
    )
  })

  it('starts the click-time diff fetch with the same inputs openDiff receives', () => {
    const openDiff = vi.fn()
    const startDiffContentFetch = vi.fn()

    openSourceControlEntryDiff({
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      entry: entry({
        path: 'src/new-name.ts',
        oldPath: 'src/old-name.ts',
        status: 'renamed',
        area: 'staged'
      }),
      trackConflictPath: vi.fn(),
      openConflictFile: vi.fn(),
      openDiff,
      openFile: vi.fn(),
      setEditorViewMode: vi.fn(),
      startDiffContentFetch
    })

    expect(startDiffContentFetch).toHaveBeenCalledTimes(1)
    const fetched = startDiffContentFetch.mock.calls[0][0]
    expect(fetched).toMatchObject({
      filePath: '/repo/src/new-name.ts',
      relativePath: 'src/new-name.ts',
      worktreeId: 'wt-1',
      mode: 'diff',
      diffSource: 'staged',
      diffStatus: 'renamed',
      branchOldPath: 'src/old-name.ts'
    })
    // The fetch starts before the tab opens so the RPC overlaps rendering.
    expect(startDiffContentFetch.mock.invocationCallOrder[0]).toBeLessThan(
      openDiff.mock.invocationCallOrder[0]
    )
    const [, filePath, relativePath, , staged, options] = openDiff.mock.calls[0]
    expect(fetched.filePath).toBe(filePath)
    expect(fetched.relativePath).toBe(relativePath)
    expect(fetched.diffSource).toBe(staged ? 'staged' : 'unstaged')
    expect(fetched.branchOldPath).toBe(options.oldPath)
    expect(fetched.diffStatus).toBe(options.diffStatus)
  })
})
