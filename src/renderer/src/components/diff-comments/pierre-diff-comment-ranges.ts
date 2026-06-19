import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD, type FileDiffMetadata } from '@pierre/diffs'
import type { CodeViewLineSelection, ExpansionDirections, SelectedLineRange } from '@pierre/diffs'

export const PIERRE_DIFF_COMMENT_UNSAFE_CSS = `
[data-utility-button] {
  width: 18px;
  height: 18px;
  min-width: 18px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--foreground) 22%, var(--border));
  border-radius: 4px;
  background: color-mix(in srgb, var(--foreground) 5%, var(--editor-surface));
  color: color-mix(in srgb, var(--foreground) 78%, var(--muted-foreground));
  box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 12%, transparent);
}
[data-utility-button]:hover {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 52%, var(--border));
  background: color-mix(in srgb, var(--primary) 12%, var(--background));
}
[data-utility-button]:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}
[data-utility-button] [data-icon] {
  width: 12px;
  height: 12px;
}
`

export type PierreDiffCommentRange = {
  startLine?: number
  lineNumber: number
}

export type PierreCollapsedCommentRegion = {
  hunkIndex: number
  direction: ExpansionDirections
  expansionLineCount: number
}

export function normalizePierreDiffCommentRange(
  range: SelectedLineRange
): PierreDiffCommentRange | null {
  const startSide = range.side ?? range.endSide ?? 'additions'
  const endSide = range.endSide ?? range.side ?? 'additions'
  if (startSide !== 'additions' || endSide !== 'additions') {
    return null
  }
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    return null
  }
  return start === end ? { lineNumber: end } : { startLine: start, lineNumber: end }
}

export function toPierreCodeViewSelection(
  id: string,
  selection: CodeViewLineSelection | null
): CodeViewLineSelection | null {
  if (!selection || selection.id !== id) {
    return null
  }
  // Why: deletion-side selections are still valid Pierre selections; only the
  // eventual add-comment action is additions-side-only.
  return selection
}

export function findCollapsedModifiedLineRegion(
  fileDiff: FileDiffMetadata,
  lineNumber: number
): PierreCollapsedCommentRegion | null {
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || fileDiff.hunks.length === 0) {
    return null
  }
  for (let index = 0; index < fileDiff.hunks.length; index += 1) {
    const hunk = fileDiff.hunks[index]
    if (
      !fileDiff.isPartial &&
      hunk.collapsedBefore > DEFAULT_COLLAPSED_CONTEXT_THRESHOLD &&
      lineNumber >= hunk.additionStart - hunk.collapsedBefore &&
      lineNumber < hunk.additionStart
    ) {
      const collapsedStart = hunk.additionStart - hunk.collapsedBefore
      const fromStartCount = lineNumber - collapsedStart + 1
      const fromEndCount = hunk.additionStart - lineNumber
      return fromStartCount <= fromEndCount
        ? { hunkIndex: index, direction: 'up', expansionLineCount: fromStartCount }
        : { hunkIndex: index, direction: 'down', expansionLineCount: fromEndCount }
    }
  }
  const lastHunk = fileDiff.hunks.at(-1)
  if (!lastHunk || fileDiff.isPartial || !Array.isArray(fileDiff.additionLines)) {
    return null
  }
  const trailingStart = lastHunk.additionLineIndex + lastHunk.additionCount + 1
  const trailingEnd = fileDiff.additionLines.length
  const trailingSize = trailingEnd - trailingStart + 1
  if (
    trailingSize > DEFAULT_COLLAPSED_CONTEXT_THRESHOLD &&
    lineNumber >= trailingStart &&
    lineNumber <= trailingEnd
  ) {
    return {
      hunkIndex: fileDiff.hunks.length,
      direction: 'up',
      expansionLineCount: lineNumber - trailingStart + 1
    }
  }
  return null
}
