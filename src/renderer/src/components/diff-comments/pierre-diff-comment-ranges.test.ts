import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs'
import { describe, expect, it } from 'vitest'
import {
  findCollapsedModifiedLineRegion,
  normalizePierreDiffCommentRange,
  toPierreCodeViewSelection
} from './pierre-diff-comment-ranges'

describe('pierre diff comment ranges', () => {
  it('normalizes addition-side selections to modified-side comment ranges', () => {
    expect(
      normalizePierreDiffCommentRange({ start: 7, end: 3, side: 'additions', endSide: 'additions' })
    ).toEqual({ startLine: 3, lineNumber: 7 })
    expect(normalizePierreDiffCommentRange({ start: 4, end: 4, side: 'additions' })).toEqual({
      lineNumber: 4
    })
  })

  it('ignores deletion-side and invalid selections', () => {
    expect(normalizePierreDiffCommentRange({ start: 1, end: 1, side: 'deletions' })).toBeNull()
    expect(
      normalizePierreDiffCommentRange({ start: 1, end: 2, side: 'additions', endSide: 'deletions' })
    ).toBeNull()
    expect(normalizePierreDiffCommentRange({ start: 0, end: 1, side: 'additions' })).toBeNull()
  })

  it('keeps non-addition Pierre selections controlled without accepting them for comments', () => {
    const selection = {
      id: 'orca-single-file-diff',
      range: { start: 1, end: 2, side: 'deletions' as const }
    }

    expect(toPierreCodeViewSelection('orca-single-file-diff', selection)).toBe(selection)
    expect(normalizePierreDiffCommentRange(selection.range)).toBeNull()
  })

  it('finds comments hidden in collapsed modified-side context before a hunk', () => {
    const fileDiff = {
      hunks: [
        {
          collapsedBefore: 20,
          additionStart: 30
        },
        {
          collapsedBefore: 1,
          additionStart: 80
        }
      ]
    } as FileDiffMetadata

    expect(findCollapsedModifiedLineRegion(fileDiff, 20)).toEqual({
      hunkIndex: 0,
      direction: 'down',
      expansionLineCount: 10
    })
    expect(findCollapsedModifiedLineRegion(fileDiff, 30)).toBeNull()
    expect(findCollapsedModifiedLineRegion(fileDiff, 79)).toBeNull()
  })

  it('does not report collapsed context for partial diffs that Pierre cannot expand', () => {
    const fileDiff = {
      isPartial: true,
      hunks: [
        {
          collapsedBefore: 20,
          additionStart: 30
        }
      ]
    } as FileDiffMetadata

    expect(findCollapsedModifiedLineRegion(fileDiff, 20)).toBeNull()
  })

  it('finds comments hidden in final trailing collapsed modified-side context', () => {
    const fileDiff = {
      isPartial: false,
      additionLines: Array.from({ length: 100 }),
      deletionLines: Array.from({ length: 100 }),
      hunks: [
        {
          collapsedBefore: 0,
          additionLineIndex: 20,
          additionCount: 5,
          deletionLineIndex: 20,
          deletionCount: 5
        }
      ]
    } as FileDiffMetadata

    expect(findCollapsedModifiedLineRegion(fileDiff, 50)).toEqual({
      hunkIndex: 1,
      direction: 'up',
      expansionLineCount: 25
    })
    expect(findCollapsedModifiedLineRegion(fileDiff, 25)).toBeNull()
  })

  it('maps real Pierre parsed diff metadata to collapsed modified-side regions', () => {
    const original = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join('\n')
    const modifiedLines = original.split('\n')
    modifiedLines[9] = 'line 10 changed'
    const fileDiff = parseDiffFromFile(
      { name: 'a.txt', contents: `${original}\n` },
      { name: 'a.txt', contents: `${modifiedLines.join('\n')}\n` }
    )

    expect(findCollapsedModifiedLineRegion(fileDiff, 1)).toEqual({
      hunkIndex: 0,
      direction: 'up',
      expansionLineCount: 1
    })
    expect(findCollapsedModifiedLineRegion(fileDiff, 10)).toBeNull()
    expect(findCollapsedModifiedLineRegion(fileDiff, 50)).toEqual({
      hunkIndex: 1,
      direction: 'up',
      expansionLineCount: 36
    })
  })
})
