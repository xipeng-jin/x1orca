import { describe, expect, it } from 'vitest'
import { getWorkingTreeDiffOldPath } from './git-diff-old-path-policy'

describe('getWorkingTreeDiffOldPath', () => {
  it('allows oldPath for staged rename diffs', () => {
    expect(
      getWorkingTreeDiffOldPath({
        oldPath: 'src/old.ts',
        diffSource: 'staged',
        diffStatus: 'renamed'
      })
    ).toBe('src/old.ts')
  })

  it('allows oldPath for compare-against-HEAD diffs', () => {
    expect(
      getWorkingTreeDiffOldPath({
        oldPath: 'src/old.ts',
        diffSource: 'unstaged',
        diffStatus: 'modified',
        compareAgainstHead: true
      })
    ).toBe('src/old.ts')
  })

  it('allows oldPath for true unstaged rename diffs', () => {
    expect(
      getWorkingTreeDiffOldPath({
        oldPath: 'src/old.ts',
        diffSource: 'unstaged',
        diffStatus: 'renamed'
      })
    ).toBe('src/old.ts')
  })

  it('ignores oldPath for unstaged edit companions of staged renames', () => {
    expect(
      getWorkingTreeDiffOldPath({
        oldPath: 'src/old.ts',
        diffSource: 'unstaged',
        diffStatus: 'modified'
      })
    ).toBeUndefined()
  })
})
