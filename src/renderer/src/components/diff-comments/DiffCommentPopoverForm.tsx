import { useCallback, useId, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'

type Props = {
  lineNumber: number
  startLine?: number
  title?: string
  labelId?: string
  placeholder?: string
  submitLabel?: string
  submittingLabel?: string
  cancelLabel?: string
  onCancel: () => void
  onSubmit: (body: string) => Promise<boolean | void>
}

export function DiffCommentPopoverForm({
  lineNumber,
  startLine,
  title,
  labelId: providedLabelId,
  placeholder,
  submitLabel,
  submittingLabel,
  cancelLabel,
  onCancel,
  onSubmit
}: Props): React.JSX.Element {
  const [body, setBody] = useState('')
  // Why: keep the async submit guard shared across Monaco and Pierre so the
  // double-submit IPC window cannot drift between the two diff surfaces.
  const [submitting, setSubmitting] = useState(false)
  const mountedRef = useMountedRef()
  const generatedLabelId = useId()
  const labelId = providedLabelId ?? generatedLabelId
  const resolvedPlaceholder =
    placeholder ??
    translate(
      'auto.components.diff.comments.DiffCommentPopoverForm.63eeebc1a3',
      'Add note for the AI'
    )
  const resolvedSubmitLabel =
    submitLabel ??
    translate('auto.components.diff.comments.DiffCommentPopoverForm.7939131b21', 'Add note')
  const resolvedSubmittingLabel =
    submittingLabel ??
    translate('auto.components.diff.comments.DiffCommentPopoverForm.c491aa3d3d', 'Saving...')

  const focusTextareaRef = useCallback((textarea: HTMLTextAreaElement | null): void => {
    textarea?.focus()
  }, [])

  const autoResize = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }

  const handleSubmit = async (): Promise<void> => {
    if (submitting) {
      return
    }
    const trimmed = body.trim()
    if (!trimmed) {
      return
    }
    setSubmitting(true)
    try {
      const ok = await onSubmit(trimmed)
      if (ok === true && mountedRef.current) {
        setBody('')
      }
    } finally {
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  return (
    <div className="orca-diff-comment-content-col" style={{ gap: '8px' }}>
      <div id={labelId} className="orca-diff-comment-popover-label">
        {title ??
          (startLine !== undefined && startLine !== lineNumber
            ? translate(
                'auto.components.diff.comments.DiffCommentPopover.c845170b3b',
                'Lines {{value0}}-{{value1}}',
                { value0: startLine, value1: lineNumber }
              )
            : translate(
                'auto.components.diff.comments.DiffCommentPopover.e05063cfc1',
                'Line {{value0}}',
                { value0: lineNumber }
              ))}
      </div>
      <textarea
        ref={focusTextareaRef}
        className="orca-diff-comment-popover-textarea"
        placeholder={resolvedPlaceholder}
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          autoResize(e.currentTarget)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
            return
          }
          // Why: plain Enter submits, Shift+Enter keeps multi-line notes, and
          // IME composition must not send a half-confirmed CJK candidate.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
            e.preventDefault()
            if (submitting) {
              return
            }
            void handleSubmit()
          }
        }}
        rows={3}
      />
      <div className="orca-diff-comment-popover-footer">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {cancelLabel ??
            translate('auto.components.diff.comments.DiffCommentPopoverForm.625fb26b4b', 'Cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={submitting || body.trim().length === 0}
          onClick={() => void handleSubmit()}
        >
          {submitting ? resolvedSubmittingLabel : resolvedSubmitLabel}
          {!submitting && <CornerDownLeft className="ml-1 size-3 opacity-70" />}
        </Button>
      </div>
    </div>
  )
}
