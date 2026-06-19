import type { CodeViewHandle } from '@pierre/diffs/react'
import type { ExpansionDirections } from '@pierre/diffs'
import type { DiffComment } from '../../../../shared/types'
import type { PierreDiffVirtualAnchor } from './PierreDiffCommentPopover'

// Why: a freshly (re)mounted CodeView — e.g. after navigating back to an
// inactive diff tab — renders no items for the first frames and tokenizes
// lazily, so the target line can take well over a handful of frames to lay out.
// Poll generously (~0.5s at 60fps) before giving up.
export const SCROLL_TO_COMMENT_MAX_ATTEMPTS = 30

function getRenderedDiffItem(
  codeViewRef: React.MutableRefObject<CodeViewHandle<DiffComment> | null>,
  itemId: string
) {
  const renderedItem = codeViewRef.current
    ?.getInstance()
    ?.getRenderedItems()
    .find((item) => item.id === itemId)
  return renderedItem?.type === 'diff' ? renderedItem : null
}

export function getPierreModifiedLinePosition(
  codeViewRef: React.MutableRefObject<CodeViewHandle<DiffComment> | null>,
  itemId: string,
  lineNumber: number
): { top: number; height: number } | undefined {
  return getRenderedDiffItem(codeViewRef, itemId)?.instance.getLinePosition(lineNumber, 'additions')
}

// Why: getLinePosition is relative to the diff item's content top, so offset it
// by the item element's viewport rect to get a viewport-space rect the popover
// anchor can use.
export function getPierreModifiedLineViewportRect(
  codeViewRef: React.MutableRefObject<CodeViewHandle<DiffComment> | null>,
  itemId: string,
  lineNumber: number
): { top: number; height: number } | null {
  const renderedItem = getRenderedDiffItem(codeViewRef, itemId)
  const linePosition = renderedItem?.instance.getLinePosition(lineNumber, 'additions')
  if (!renderedItem || !linePosition) {
    return null
  }
  const itemTop = renderedItem.element.getBoundingClientRect().top
  return { top: itemTop + linePosition.top, height: linePosition.height }
}

export function expandPierreDiffHunk(
  codeViewRef: React.MutableRefObject<CodeViewHandle<DiffComment> | null>,
  itemId: string,
  hunkIndex: number,
  direction: ExpansionDirections,
  expansionLineCount: number
): boolean {
  const renderedItem = getRenderedDiffItem(codeViewRef, itemId)
  if (!renderedItem) {
    return false
  }
  // Why: the CodeView handle does not expose hunk expansion; this is the
  // narrow, version-sensitive bridge to Pierre's rendered diff instance.
  renderedItem.instance.expandHunk(hunkIndex, direction, expansionLineCount)
  return true
}

function getPierreGutterUtilityButton(
  codeViewRef: React.MutableRefObject<CodeViewHandle<DiffComment> | null>,
  itemId: string
): Element | null {
  const renderedItem = getRenderedDiffItem(codeViewRef, itemId)
  // Why: Pierre 1.2.4 rejects renderGutterUtility together with
  // onGutterUtilityClick, so Orca must anchor to Pierre's built-in button to
  // keep committed multi-line selections.
  return renderedItem?.element.shadowRoot?.querySelector('[data-utility-button]') ?? null
}

export function createPierreDiffGutterVirtualAnchor(
  codeViewRef: React.MutableRefObject<CodeViewHandle<DiffComment> | null>,
  itemId: string,
  endLineNumber: number
): PierreDiffVirtualAnchor | null {
  const button = getPierreGutterUtilityButton(codeViewRef, itemId)
  if (!button) {
    console.warn('Pierre diff comment gutter button was unavailable; skipping add-note popover')
    return null
  }
  let lastButtonRect = button.getBoundingClientRect()
  return {
    getBoundingClientRect: () => {
      const buttonRect = button.getBoundingClientRect()
      // Why: Pierre removes the built-in gutter button when the hovered line is
      // virtualized away; a detached element reports a zero rect, which would
      // move Radix's virtual anchor to viewport (0,0).
      if (button.isConnected && (buttonRect.width > 0 || buttonRect.height > 0)) {
        lastButtonRect = buttonRect
      }
      // Why: anchor vertically to the selection's end line so the popover opens
      // below the commented line(s) instead of covering them; the gutter button
      // only fixes the horizontal (gutter-column) position.
      const lineRect = getPierreModifiedLineViewportRect(codeViewRef, itemId, endLineNumber)
      if (!lineRect) {
        return lastButtonRect
      }
      return new DOMRect(lastButtonRect.left, lineRect.top, lastButtonRect.width, lineRect.height)
    }
  }
}
