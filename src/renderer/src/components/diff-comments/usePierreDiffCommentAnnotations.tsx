import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CodeViewLineSelection,
  CodeViewItem,
  CodeViewOptions,
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange
} from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { MessageSquareText } from 'lucide-react'
import { DiffNotesSendMenu } from '@/components/editor/DiffNotesSendMenu'
import { useAppStore } from '@/store'
import { getDiffCommentLineLabel, isDiffComment } from '@/lib/diff-comment-compat'
import { EMPTY_STRING_SET, reuseSetIfEqual } from '@/lib/referential-collections'
import type { DiffComment } from '../../../../shared/types'
import { getRepoIdFromWorktreeId } from '@/store/slices/worktree-helpers'
import { DiffCommentCard } from './DiffCommentCard'
import {
  PierreDiffCommentPopover,
  type PierreDiffVirtualAnchor,
  type PierreDiffVirtualAnchorRef
} from './PierreDiffCommentPopover'
import {
  createPierreDiffGutterVirtualAnchor,
  expandPierreDiffHunk,
  getPierreModifiedLinePosition,
  SCROLL_TO_COMMENT_MAX_ATTEMPTS
} from './pierre-diff-comment-code-view'
import {
  findCollapsedModifiedLineRegion,
  normalizePierreDiffCommentRange,
  PIERRE_DIFF_COMMENT_UNSAFE_CSS,
  toPierreCodeViewSelection
} from './pierre-diff-comment-ranges'

type Args = {
  enabled: boolean
  worktreeId?: string
  relativePath: string
  fileDiff: FileDiffMetadata | null
  codeViewRef: React.MutableRefObject<CodeViewHandle<DiffComment> | null>
  itemId: string
}

type Result = {
  annotations: DiffLineAnnotation<DiffComment>[]
  options: Partial<CodeViewOptions<DiffComment>>
  selectedLines: CodeViewLineSelection | null
  onSelectedLinesChange: (selection: CodeViewLineSelection | null) => void
  renderAnnotation: (
    annotation: DiffLineAnnotation<DiffComment>,
    item: CodeViewItem<DiffComment>
  ) => React.ReactNode
  popover: React.ReactNode
  unsafeCSS?: string
  // Why: lets DiffViewer suppress cached-scroll restore on a fresh mount when a
  // scroll-to-note for this file is pending, so the note scroll owns the
  // initial position instead of racing (and losing to) the restore.
  pendingScrollToComment: boolean
}

type AddPopoverState = {
  range: {
    startLine?: number
    lineNumber: number
  }
}

const EMPTY_DIFF_COMMENTS: readonly DiffComment[] = Object.freeze([])
export function usePierreDiffCommentAnnotations({
  enabled,
  worktreeId,
  relativePath,
  fileDiff,
  codeViewRef,
  itemId
}: Args): Result {
  const repoId = worktreeId ? getRepoIdFromWorktreeId(worktreeId) : null
  const hasCommentContext = Boolean(worktreeId && repoId && fileDiff)
  const commentScopeKey = worktreeId ? `${worktreeId}\u001f${relativePath}` : null
  const worktreeComments = useAppStore((s) => {
    if (!hasCommentContext || !worktreeId || !repoId) {
      return EMPTY_DIFF_COMMENTS
    }
    return (
      s.worktreesByRepo[repoId]?.find((worktree) => worktree.id === worktreeId)?.diffComments ??
      EMPTY_DIFF_COMMENTS
    )
  })
  const addDiffComment = useAppStore((s) => s.addDiffComment)
  const updateDiffComment = useAppStore((s) => s.updateDiffComment)
  const deleteDiffComment = useAppStore((s) => s.deleteDiffComment)
  const scrollToDiffCommentId = useAppStore((s) => s.scrollToDiffCommentId)
  const scrollToDiffCommentRequestSeq = useAppStore((s) => s.scrollToDiffCommentRequestSeq)
  const setScrollToDiffCommentId = useAppStore((s) => s.setScrollToDiffCommentId)
  const activeGroupId = useAppStore((s) =>
    worktreeId ? (s.activeGroupIdByWorktree[worktreeId] ?? worktreeId) : worktreeId
  )
  const expandedCommentIds = useAppStore((s) =>
    commentScopeKey
      ? (s.pierreDiffCommentExpandedIdsByScope[commentScopeKey] ?? EMPTY_STRING_SET)
      : EMPTY_STRING_SET
  )
  const updatePierreDiffCommentExpandedIds = useAppStore(
    (s) => s.updatePierreDiffCommentExpandedIds
  )
  const [selectedLines, setSelectedLines] = useState<CodeViewLineSelection | null>(null)
  const [addPopover, setAddPopover] = useState<AddPopoverState | null>(null)
  const anchorRef = useRef<PierreDiffVirtualAnchor | null>(null) as PierreDiffVirtualAnchorRef
  const scrollToDiffCommentIdRef = useRef(scrollToDiffCommentId)
  scrollToDiffCommentIdRef.current = scrollToDiffCommentId
  const scrollToDiffCommentRequestSeqRef = useRef(scrollToDiffCommentRequestSeq)
  scrollToDiffCommentRequestSeqRef.current = scrollToDiffCommentRequestSeq

  const fileComments = useMemo(() => {
    if (!worktreeId) {
      return EMPTY_DIFF_COMMENTS
    }
    return worktreeComments.filter(
      (comment) => comment.filePath === relativePath && isDiffComment(comment)
    )
  }, [relativePath, worktreeComments, worktreeId])

  const comments = enabled ? fileComments : EMPTY_DIFF_COMMENTS

  const pendingScrollToComment = useMemo(
    () =>
      Boolean(scrollToDiffCommentId) &&
      fileComments.some((comment) => comment.id === scrollToDiffCommentId),
    [fileComments, scrollToDiffCommentId]
  )

  const annotations = useMemo<DiffLineAnnotation<DiffComment>[]>(
    () =>
      comments.map((comment) => ({
        side: 'additions',
        lineNumber: comment.lineNumber,
        metadata: comment
      })),
    [comments]
  )

  const updateExpandedCommentIds = useCallback(
    (updater: (current: ReadonlySet<string>) => ReadonlySet<string>): void => {
      if (!commentScopeKey) {
        return
      }
      updatePierreDiffCommentExpandedIds(commentScopeKey, updater)
    },
    [commentScopeKey, updatePierreDiffCommentExpandedIds]
  )

  useEffect(() => {
    if (!commentScopeKey || !worktreeId) {
      return
    }
    const liveIds = new Set(fileComments.map((comment) => comment.id))
    updateExpandedCommentIds((current) => {
      const next = new Set([...current].filter((id) => liveIds.has(id)))
      return reuseSetIfEqual(current, next)
    })
  }, [commentScopeKey, fileComments, updateExpandedCommentIds, worktreeId])

  const onSelectedLinesChange = useCallback(
    (selection: CodeViewLineSelection | null): void => {
      setSelectedLines(toPierreCodeViewSelection(itemId, selection))
    },
    [itemId]
  )

  const closePopover = useCallback((): void => {
    setAddPopover(null)
    setSelectedLines(null)
    codeViewRef.current?.clearSelectedLines()
  }, [codeViewRef])

  const onGutterUtilityClick = useCallback(
    (range: SelectedLineRange): void => {
      const normalized = normalizePierreDiffCommentRange(range)
      if (!enabled || !normalized) {
        return
      }
      // Why: anchor to the selection's end line (modified-side max) so the
      // add-note popover opens below the last commented line, keeping it visible.
      const anchor = createPierreDiffGutterVirtualAnchor(codeViewRef, itemId, normalized.lineNumber)
      if (!anchor) {
        return
      }
      anchorRef.current = anchor
      setAddPopover({ range: normalized })
    },
    [anchorRef, codeViewRef, enabled, itemId]
  )

  const handleSubmitAdd = useCallback(
    async (body: string): Promise<boolean> => {
      if (!enabled || !worktreeId || !addPopover) {
        return false
      }
      const comment = await addDiffComment({
        worktreeId,
        filePath: relativePath,
        source: 'diff',
        startLine: addPopover.range.startLine,
        lineNumber: addPopover.range.lineNumber,
        body,
        side: 'modified'
      })
      if (!comment) {
        return false
      }
      updateExpandedCommentIds((current) => new Set(current).add(comment.id))
      closePopover()
      return true
    },
    [
      addDiffComment,
      addPopover,
      closePopover,
      enabled,
      relativePath,
      updateExpandedCommentIds,
      worktreeId
    ]
  )

  useEffect(() => {
    if (!worktreeId || !fileDiff || !scrollToDiffCommentId) {
      return
    }
    const target = worktreeComments
      .filter(isDiffComment)
      .find((comment) => comment.id === scrollToDiffCommentId)
    if (!target) {
      setScrollToDiffCommentId(null)
      return
    }
    if (target.filePath !== relativePath) {
      return
    }
    const collapsedRegion = findCollapsedModifiedLineRegion(fileDiff, target.lineNumber)
    let frameId: number | null = null
    let attempt = 0
    let acknowledged = false
    let hasExpandedCollapsedRegion = false
    const requestSeq = scrollToDiffCommentRequestSeq
    const isCurrentScrollTarget = (): boolean =>
      scrollToDiffCommentIdRef.current === target.id &&
      scrollToDiffCommentRequestSeqRef.current === requestSeq
    const acknowledgeScrollTarget = (): void => {
      acknowledged = true
      setScrollToDiffCommentId(null)
    }
    const acknowledgeAfterScrollFrame = (): void => {
      frameId = requestAnimationFrame(() => {
        frameId = null
        if (isCurrentScrollTarget()) {
          acknowledgeScrollTarget()
        }
      })
    }

    const pollForPosition = (): void => {
      frameId = null
      // Why: a freshly (re)mounted CodeView renders no items for the first
      // frames. Retry the hunk expansion until the item exists rather than
      // giving up on the first miss, then wait for the line to lay out.
      if (collapsedRegion && !hasExpandedCollapsedRegion) {
        hasExpandedCollapsedRegion = expandPierreDiffHunk(
          codeViewRef,
          itemId,
          collapsedRegion.hunkIndex,
          collapsedRegion.direction,
          collapsedRegion.expansionLineCount
        )
      }
      const readyToLocate = hasExpandedCollapsedRegion || !collapsedRegion
      const position = readyToLocate
        ? getPierreModifiedLinePosition(codeViewRef, itemId, target.lineNumber)
        : undefined
      if (position) {
        codeViewRef.current?.scrollTo({
          type: 'line',
          id: itemId,
          lineNumber: target.lineNumber,
          side: 'additions',
          align: 'center'
        })
        updateExpandedCommentIds((current) => new Set(current).add(target.id))
        acknowledgeAfterScrollFrame()
        return
      }
      if (attempt >= SCROLL_TO_COMMENT_MAX_ATTEMPTS) {
        acknowledgeScrollTarget()
        return
      }
      attempt += 1
      frameId = requestAnimationFrame(pollForPosition)
    }
    // Why: collapsed regions need the item before expanding, so wait a frame;
    // an already-rendered instance (active-tab case) resolves synchronously.
    if (collapsedRegion) {
      frameId = requestAnimationFrame(pollForPosition)
    } else {
      pollForPosition()
    }
    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
      // Why: if the matching viewer unmounts mid-rAF, nobody else may clear the
      // one-shot sidebar request. Guard against wiping a newer request.
      if (!acknowledged && isCurrentScrollTarget()) {
        setScrollToDiffCommentId(null)
      }
    }
  }, [
    codeViewRef,
    fileDiff,
    itemId,
    relativePath,
    scrollToDiffCommentId,
    scrollToDiffCommentRequestSeq,
    setScrollToDiffCommentId,
    updateExpandedCommentIds,
    worktreeComments,
    worktreeId
  ])

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<DiffComment>): React.ReactNode => {
      const comment = annotation.metadata
      const expanded = expandedCommentIds.has(comment.id)
      if (!expanded) {
        return (
          <button
            type="button"
            className="orca-diff-comment-chip"
            onClick={(ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              updateExpandedCommentIds((current) => new Set(current).add(comment.id))
            }}
          >
            <MessageSquareText className="size-3" />
            <span>{getDiffCommentLineLabel(comment, true)}</span>
          </button>
        )
      }
      return (
        <div className="orca-diff-comment-inline orca-diff-comment-inline-pierre">
          <DiffCommentCard
            lineNumber={comment.lineNumber}
            startLine={comment.startLine}
            body={comment.body}
            sentAt={comment.sentAt}
            onDelete={() => {
              if (worktreeId) {
                void deleteDiffComment(worktreeId, comment.id)
              }
            }}
            onSubmitEdit={
              worktreeId ? (body) => updateDiffComment(worktreeId, comment.id, body) : undefined
            }
            headerActions={
              worktreeId && activeGroupId ? (
                <DiffNotesSendMenu
                  worktreeId={worktreeId}
                  groupId={activeGroupId}
                  comments={[comment]}
                  filePath={relativePath}
                  triggerClassName="orca-diff-comment-edit"
                />
              ) : null
            }
          />
        </div>
      )
    },
    [
      activeGroupId,
      deleteDiffComment,
      expandedCommentIds,
      relativePath,
      updateExpandedCommentIds,
      updateDiffComment,
      worktreeId
    ]
  )

  const options = useMemo<Partial<CodeViewOptions<DiffComment>>>(
    () =>
      enabled
        ? {
            enableGutterUtility: true,
            enableLineSelection: true,
            controlledSelection: true,
            onGutterUtilityClick
          }
        : {},
    [enabled, onGutterUtilityClick]
  )

  return {
    annotations,
    options,
    selectedLines,
    onSelectedLinesChange,
    renderAnnotation,
    popover:
      enabled && addPopover && anchorRef.current ? (
        <PierreDiffCommentPopover
          open={true}
          anchorRef={anchorRef}
          lineNumber={addPopover.range.lineNumber}
          startLine={addPopover.range.startLine}
          onCancel={closePopover}
          onSubmit={handleSubmitAdd}
        />
      ) : null,
    unsafeCSS: enabled ? PIERRE_DIFF_COMMENT_UNSAFE_CSS : undefined,
    pendingScrollToComment
  }
}
