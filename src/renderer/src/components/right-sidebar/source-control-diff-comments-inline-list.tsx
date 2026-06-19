import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, LocateFixed, Trash, Trash2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { getDiffCommentLineLabel, getDiffCommentSource } from '@/lib/diff-comment-compat'
import { formatDiffComment } from '@/lib/diff-comments-format'
import type { DiffComment } from '../../../../shared/types'

function useCopyFeedbackState<T>(resetValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState(resetValue)
  const resetTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }, [])

  // Why: copy feedback timers are event-owned, but still need unmount cleanup
  // so delayed clipboard/timer work cannot update a destroyed component.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearResetTimer()
    }
  }, [clearResetTimer])

  const showFeedback = useCallback(
    (nextValue: T) => {
      clearResetTimer()
      setValue(nextValue)
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null
        if (mountedRef.current) {
          setValue(resetValue)
        }
      }, 1200)
    },
    [clearResetTimer, resetValue]
  )

  return [value, showFeedback]
}

function getLocalizedDiffCommentLineLabel(comment: DiffComment): string {
  if (comment.startLine !== undefined && comment.startLine !== comment.lineNumber) {
    return translate(
      'auto.components.right.sidebar.SourceControl.d97ef8f221',
      'lines {{value0}}-{{value1}}',
      {
        value0: comment.startLine,
        value1: comment.lineNumber
      }
    )
  }
  return translate('auto.components.right.sidebar.SourceControl.6f8bfa0eb9', 'line {{value0}}', {
    value0: comment.lineNumber
  })
}

export function SourceControlDiffCommentsInlineList({
  comments,
  onDelete,
  onClearFile,
  onOpen
}: {
  comments: DiffComment[]
  onDelete: (commentId: string) => void
  onClearFile: (filePath: string) => void
  // Why: clicking the note row navigates the user to that file's diff (or
  // editor as a fallback) and scrolls the diff to that specific note via the
  // scrollToDiffCommentId UI slice.
  onOpen: (comment: DiffComment) => void
}): React.JSX.Element {
  // Why: group by filePath so the inline list mirrors the structure in the
  // Notes tab — a compact section per file with line-number prefixes.
  const groups = useMemo(() => {
    const map = new Map<string, DiffComment[]>()
    for (const c of comments) {
      const list = map.get(c.filePath) ?? []
      list.push(c)
      map.set(c.filePath, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.lineNumber - b.lineNumber)
    }
    return Array.from(map.entries())
  }, [comments])

  const [copiedId, showCopiedId] = useCopyFeedbackState<string | null>(null)

  const handleCopyOne = useCallback(
    async (c: DiffComment): Promise<void> => {
      try {
        await window.api.ui.writeClipboardText(formatDiffComment(c))
        showCopiedId(c.id)
      } catch {
        // Why: swallow — clipboard write can fail when the window isn't focused.
      }
    },
    [showCopiedId]
  )

  if (comments.length === 0) {
    return (
      <div className="px-6 py-2 text-[11px] text-muted-foreground">
        {translate(
          'auto.components.right.sidebar.source.control.diff.comments.inline.list.170d7bc176',
          'Hover over a line in the diff view and click the + to add a note.'
        )}
      </div>
    )
  }

  return (
    <div className="bg-muted/20">
      {groups.map(([filePath, list]) => (
        <div key={filePath} className="px-3 py-1.5">
          <div className="group/file flex items-center gap-1">
            <button
              type="button"
              className="block min-w-0 flex-1 truncate text-left text-[10px] font-medium text-muted-foreground hover:text-foreground"
              onClick={() => {
                const first = list[0]
                if (first) {
                  onOpen(first)
                }
              }}
              title={translate(
                'auto.components.right.sidebar.source.control.diff.comments.inline.list.7be4ecd6b4',
                'Open {{value0}}',
                { value0: filePath }
              )}
            >
              {filePath}
            </button>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-muted-foreground can-hover:opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/file:opacity-100"
              onClick={() => onClearFile(filePath)}
              title={translate(
                'auto.components.right.sidebar.source.control.diff.comments.inline.list.297fceb9e0',
                'Clear notes for {{value0}}',
                { value0: filePath }
              )}
              aria-label={translate(
                'auto.components.right.sidebar.source.control.diff.comments.inline.list.297fceb9e0',
                'Clear notes for {{value0}}',
                { value0: filePath }
              )}
            >
              <Trash2 className="size-3" />
            </button>
          </div>
          <ul className="mt-1 space-y-1">
            {list.map((c) => (
              <li
                key={c.id}
                className="group flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/40"
              >
                <button
                  type="button"
                  // Why: a single inner button is the click/keyboard target so
                  // the row's action buttons can stay as siblings without
                  // nesting interactive elements.
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded text-left"
                  onClick={() => onOpen(c)}
                  title={translate(
                    'auto.components.right.sidebar.source.control.diff.comments.inline.list.772c893e98',
                    'Open {{value0}} ({{value1}})',
                    { value0: c.filePath, value1: getLocalizedDiffCommentLineLabel(c) }
                  )}
                  aria-label={translate(
                    'auto.components.right.sidebar.source.control.diff.comments.inline.list.a557be2ba7',
                    'Open note on {{value0}}',
                    { value0: getLocalizedDiffCommentLineLabel(c) }
                  )}
                >
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] leading-none tabular-nums text-muted-foreground">
                    {getDiffCommentLineLabel(c, true)}
                  </span>
                  <span className="shrink-0 rounded bg-muted/70 px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
                    {getDiffCommentSource(c) === 'markdown'
                      ? translate(
                          'auto.components.right.sidebar.source.control.diff.comments.inline.list.20bea69f5a',
                          'MD'
                        )
                      : translate(
                          'auto.components.right.sidebar.source.control.diff.comments.inline.list.7a637bf228',
                          'Diff'
                        )}
                  </span>
                  {c.sentAt ? (
                    <span className="shrink-0 rounded bg-muted/70 px-1 py-0.5 text-[10px] leading-none text-muted-foreground">
                      {translate(
                        'auto.components.right.sidebar.source.control.diff.comments.inline.list.9a6394db48',
                        'Sent'
                      )}
                    </span>
                  ) : null}
                  <span className="block min-w-0 flex-1 whitespace-pre-wrap break-words text-[11px] leading-snug text-foreground">
                    {c.body}
                  </span>
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-muted-foreground can-hover:opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => onOpen(c)}
                  title={translate(
                    'auto.components.right.sidebar.source.control.diff.comments.inline.list.8fd6340377',
                    'Scroll to note'
                  )}
                  aria-label={translate(
                    'auto.components.right.sidebar.source.control.diff.comments.inline.list.b7151ab168',
                    'Scroll to note on {{value0}}',
                    { value0: getLocalizedDiffCommentLineLabel(c) }
                  )}
                >
                  <LocateFixed className="size-3" />
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-muted-foreground can-hover:opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => void handleCopyOne(c)}
                  title={translate(
                    'auto.components.right.sidebar.source.control.diff.comments.inline.list.83cfadf32a',
                    'Copy note'
                  )}
                  aria-label={translate(
                    'auto.components.right.sidebar.source.control.diff.comments.inline.list.ccf1c56146',
                    'Copy note on line {{value0}}',
                    { value0: c.lineNumber }
                  )}
                >
                  {copiedId === c.id ? <Check className="size-3" /> : <Copy className="size-3" />}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-muted-foreground can-hover:opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => onDelete(c.id)}
                  title={translate(
                    'auto.components.right.sidebar.source.control.diff.comments.inline.list.6ecda219d8',
                    'Delete note'
                  )}
                  aria-label={translate(
                    'auto.components.right.sidebar.source.control.diff.comments.inline.list.1c1fe0f6da',
                    'Delete note on line {{value0}}',
                    { value0: c.lineNumber }
                  )}
                >
                  <Trash className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
