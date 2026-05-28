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
  it('opens unstaged markdown rows as read-only diff tabs', () => {
    const openDiff = vi.fn()
    const openConflictFile = vi.fn()

    openSourceControlEntryDiff({
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      entry: entry(),
      trackConflictPath: vi.fn(),
      openConflictFile,
      openDiff
    })

    expect(openDiff).toHaveBeenCalledWith(
      'wt-1',
      '/repo/docs/readme.md',
      'docs/readme.md',
      'markdown',
      false,
      undefined,
      'modified'
    )
    expect(openConflictFile).not.toHaveBeenCalled()
  })

  it('keeps unresolved conflicts on the conflict review path', () => {
    const openDiff = vi.fn()
    const openConflictFile = vi.fn()
    const trackConflictPath = vi.fn()
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
      openDiff
    })

    expect(trackConflictPath).toHaveBeenCalledWith('wt-1', 'docs/readme.md', 'both_modified')
    expect(openConflictFile).toHaveBeenCalledWith('wt-1', '/repo', conflict, 'markdown')
    expect(openDiff).not.toHaveBeenCalled()
  })

  it('passes oldPath when opening renamed working-tree diff tabs', () => {
    const openDiff = vi.fn()

    openSourceControlEntryDiff({
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      entry: entry({
        path: 'docs/new-name.md',
        oldPath: 'docs/old-name.md',
        status: 'renamed',
        area: 'staged'
      }),
      trackConflictPath: vi.fn(),
      openConflictFile: vi.fn(),
      openDiff
    })

    expect(openDiff).toHaveBeenCalledWith(
      'wt-1',
      '/repo/docs/new-name.md',
      'docs/new-name.md',
      'markdown',
      true,
      'docs/old-name.md',
      'renamed'
    )
  })

  it('does not pass oldPath for unstaged edit companions of staged renames', () => {
    const openDiff = vi.fn()

    openSourceControlEntryDiff({
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      entry: entry({
        path: 'docs/new-name.md',
        oldPath: 'docs/old-name.md',
        status: 'modified',
        area: 'unstaged'
      }),
      trackConflictPath: vi.fn(),
      openConflictFile: vi.fn(),
      openDiff
    })

    expect(openDiff).toHaveBeenCalledWith(
      'wt-1',
      '/repo/docs/new-name.md',
      'docs/new-name.md',
      'markdown',
      false,
      undefined,
      'modified'
    )
  })

  it('keeps oldPath for true unstaged rename rows', () => {
    const openDiff = vi.fn()

    openSourceControlEntryDiff({
      activeWorktreeId: 'wt-1',
      worktreePath: '/repo',
      entry: entry({
        path: 'docs/new-name.md',
        oldPath: 'docs/old-name.md',
        status: 'renamed',
        area: 'unstaged'
      }),
      trackConflictPath: vi.fn(),
      openConflictFile: vi.fn(),
      openDiff
    })

    expect(openDiff).toHaveBeenCalledWith(
      'wt-1',
      '/repo/docs/new-name.md',
      'docs/new-name.md',
      'markdown',
      false,
      'docs/old-name.md',
      'renamed'
    )
  })
})
