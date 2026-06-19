import { useId } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { DiffCommentPopoverForm } from './DiffCommentPopoverForm'

export type PierreDiffVirtualAnchor = {
  getBoundingClientRect: () => DOMRect
}
export type PierreDiffVirtualAnchorRef = NonNullable<
  React.ComponentProps<typeof PopoverAnchor>['virtualRef']
>

type Props = {
  open: boolean
  anchorRef: PierreDiffVirtualAnchorRef
  lineNumber: number
  startLine?: number
  onCancel: () => void
  onSubmit: (body: string) => Promise<boolean>
}

export function PierreDiffCommentPopover({
  open,
  anchorRef,
  lineNumber,
  startLine,
  onCancel,
  onSubmit
}: Props): React.JSX.Element {
  const labelId = useId()
  return (
    <Popover open={open}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="orca-diff-comment-popover-static w-[420px] max-w-[min(420px,calc(100vw-32px))]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onEscapeKeyDown={(ev) => {
          ev.preventDefault()
          onCancel()
        }}
        onPointerDownOutside={onCancel}
      >
        <DiffCommentPopoverForm
          lineNumber={lineNumber}
          startLine={startLine}
          labelId={labelId}
          placeholder={translate(
            'auto.components.diff.comments.PierreDiffCommentPopover.62c8eab631',
            'Add note for the AI'
          )}
          submitLabel={translate(
            'auto.components.diff.comments.PierreDiffCommentPopover.49c3eb59a3',
            'Add note'
          )}
          submittingLabel={translate(
            'auto.components.diff.comments.PierreDiffCommentPopover.03423bd896',
            'Saving...'
          )}
          cancelLabel={translate(
            'auto.components.diff.comments.PierreDiffCommentPopover.20898bb7e1',
            'Cancel'
          )}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      </PopoverContent>
    </Popover>
  )
}
