import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { DiffCommentPopoverForm } from './DiffCommentPopoverForm'
import { resolveDiffCommentPopoverTop } from './diff-comment-popover-position'

// Why: rendered as a DOM sibling overlay inside the editor container rather
// than as a Monaco content widget because it owns a React textarea with
// auto-resize behaviour. Positioning mirrors what useDiffCommentDecorator does
// for the "+" button so scroll updates from the parent keep the popover
// aligned with its anchor line.

type Props = {
  lineNumber: number
  startLine?: number
  top: number
  left?: number
  // Height of the anchor line, used to flip the popover above it when it would
  // overflow the bottom of the viewport. Defaults to 0 for callers that don't
  // anchor to a Monaco line (e.g. markdown annotations): the popover still
  // clamps inside the viewport, it just doesn't offset by the line's height.
  lineHeight?: number
  title?: string
  placeholder?: string
  submitLabel?: string
  submittingLabel?: string
  onCancel: () => void
  onSubmit: (body: string) => Promise<void>
}

export function DiffCommentPopover({
  lineNumber,
  startLine,
  top,
  left,
  lineHeight = 0,
  title,
  placeholder,
  submitLabel,
  submittingLabel,
  onCancel,
  onSubmit
}: Props): React.JSX.Element {
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const labelId = useId()
  // Why: stash onCancel in a ref so the document mousedown listener below can
  // read the freshest callback without listing `onCancel` in its dependency
  // array. Parents (DiffSectionItem, DiffViewer) pass a new arrow function on
  // every render and the popover re-renders frequently (scroll tracking updates
  // `top`, font zoom, etc.), which would otherwise tear down and re-attach the
  // document listener on every parent render. Mirrors the pattern in
  // useDiffCommentDecorator.tsx.
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  // Why: `top` anchors the popover just below the selected line. Near the
  // bottom of the editor viewport that downward box gets clipped by the pane's
  // overflow container, so the resolved top may flip the popover above the line
  // (see resolveDiffCommentPopoverTop). Start at `top` so the first paint is
  // correct when there is room below; the layout effect refines it otherwise.
  const [resolvedTop, setResolvedTop] = useState(top)

  // Why: read the freshest anchor inside `measure` (a stable callback) so the
  // ResizeObserver below can stay mounted once instead of tearing down on every
  // scroll frame, which updates `top` continuously while the popover is open.
  const topRef = useRef(top)
  topRef.current = top
  const lineHeightRef = useRef(lineHeight)
  lineHeightRef.current = lineHeight

  const measureResolvedTop = useCallback((): void => {
    const popover = popoverRef.current
    const container = popover?.parentElement
    if (!popover || !container) {
      setResolvedTop(topRef.current)
      return
    }
    setResolvedTop(
      resolveDiffCommentPopoverTop({
        belowTop: topRef.current,
        lineHeight: lineHeightRef.current,
        popoverHeight: popover.offsetHeight,
        viewportHeight: container.clientHeight
      })
    )
  }, [])

  // Why: re-resolve placement before paint whenever the anchor moves (scroll,
  // font zoom) so the flip/clamp tracks the selected line without flicker.
  useLayoutEffect(() => {
    measureResolvedTop()
  }, [top, lineHeight, measureResolvedTop])

  // Why: the textarea auto-grows as the user types and the editor pane can be
  // resized; observe both so a growing draft re-resolves and never ends up
  // clipped at the bottom edge.
  useEffect(() => {
    const popover = popoverRef.current
    const container = popover?.parentElement
    if (!popover || !container || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => measureResolvedTop())
    observer.observe(popover)
    observer.observe(container)
    return () => observer.disconnect()
  }, [measureResolvedTop])

  // Why: Monaco's editor area does not bubble a synthetic React click up to
  // the popover's onClick. Without a document-level mousedown listener, the
  // popover has no way to detect clicks outside its own bounds. We keep the
  // `onMouseDown={ev.stopPropagation()}` on the popover root so that this
  // listener sees outside-clicks only.
  useEffect(() => {
    const onDocumentMouseDown = (ev: MouseEvent): void => {
      if (!popoverRef.current) {
        return
      }
      if (popoverRef.current.contains(ev.target as Node)) {
        return
      }
      // Why: read the latest onCancel from the ref rather than closing over it
      // so the listener does not need to be re-registered on every parent
      // render (see onCancelRef comment above).
      onCancelRef.current()
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown)
    }
  }, [])

  return (
    <div
      ref={popoverRef}
      className="orca-diff-comment-popover"
      style={{ top: `${resolvedTop}px`, ...(left == null ? {} : { left: `${left}px` }) }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={(ev) => ev.stopPropagation()}
    >
      <DiffCommentPopoverForm
        lineNumber={lineNumber}
        startLine={startLine}
        title={title}
        labelId={labelId}
        placeholder={placeholder}
        submitLabel={submitLabel}
        submittingLabel={submittingLabel}
        cancelLabel={translate(
          'auto.components.diff.comments.DiffCommentPopover.2b3ce6d394',
          'Cancel'
        )}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </div>
  )
}
