import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { FileDiff, Virtualizer, type FileContents } from '@pierre/diffs/react'
import {
  getFiletypeFromFileName,
  parseDiffFromFile,
  type FileDiffOptions,
  type FileDiffMetadata,
  type SupportedLanguages,
  type VirtualFileMetrics
} from '@pierre/diffs'
import { useAppStore } from '@/store'
import { scrollTopCache, setWithLRU } from '@/lib/scroll-cache'
import { computeEditorFontSize } from '@/lib/editor-font-zoom'
import { PIERRE_DIFF_THEMES, usePierreDiffThemeType } from './pierre-diff-theme'

type DiffViewerProps = {
  modelKey: string
  originalContent: string
  modifiedContent: string
  language: string
  relativePath: string
  sideBySide: boolean
  branchOldPath?: string
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5
const FNV_PRIME_32 = 0x01000193
const SECONDARY_HASH_SEED = 0x9e3779b9
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b
const PIERRE_DEFAULT_FONT_SIZE = 13
const PIERRE_DEFAULT_LINE_HEIGHT = 20
// Pierre defaults to 13px text and a 20px line box. Diff zoom keeps that
// proportion so virtual metrics and rendered rows continue to agree.
const PIERRE_DEFAULT_LINE_HEIGHT_RATIO = PIERRE_DEFAULT_LINE_HEIGHT / PIERRE_DEFAULT_FONT_SIZE
const PIERRE_DEFAULT_VIRTUAL_FILE_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: PIERRE_DEFAULT_LINE_HEIGHT,
  diffHeaderHeight: 44,
  spacing: 8
}
type PierreDiffTypographyStyle = React.CSSProperties & {
  '--diffs-font-size'?: string
  '--diffs-line-height'?: string
}

function fnv1a32(input: string, seed: number, multiplier: number): number {
  let hash = seed >>> 0
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, multiplier) >>> 0
  }
  return hash >>> 0
}

export function getContentFingerprint(content: string): string {
  const primary = fnv1a32(content, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36)
  const secondary = fnv1a32(content, SECONDARY_HASH_SEED, SECONDARY_HASH_MULTIPLIER).toString(36)
  return `${content.length}:${primary}:${secondary}`
}

export function getPierreDiffLanguageOverride(name: string): SupportedLanguages | undefined {
  const lowerName = name.toLowerCase()
  if (lowerName.endsWith('.ipynb')) {
    return 'json'
  }
  if (lowerName.endsWith('.svg')) {
    return 'xml'
  }
  return undefined
}

export function buildPierreDiffFile({
  name,
  contents
}: {
  name: string
  contents: string
}): FileContents {
  const languageOverride = getPierreDiffLanguageOverride(name)
  const cacheLanguage = languageOverride ?? getFiletypeFromFileName(name)
  const file: FileContents = {
    name,
    contents,
    cacheKey: `orca:pierre-file:v1:${name}:${cacheLanguage}:${getContentFingerprint(contents)}`
  }
  if (languageOverride) {
    // Why: Pierre's filename inference covers most source files; only override
    // extensions it does not map to the desired Shiki language.
    file.lang = languageOverride
  }
  return file
}

export function getInitialPierreDiffScrollTop({
  cachedScrollTop,
  firstChangedLineIndex,
  diffHeaderHeight,
  lineHeight,
  clientHeight
}: {
  cachedScrollTop?: number
  firstChangedLineIndex: number | null
  diffHeaderHeight: number
  lineHeight: number
  clientHeight: number
}): number | null {
  if (typeof cachedScrollTop === 'number') {
    return cachedScrollTop
  }
  if (firstChangedLineIndex == null) {
    return null
  }
  return Math.max(0, diffHeaderHeight + firstChangedLineIndex * lineHeight - clientHeight / 2)
}

export function getFirstChangedRenderedLineIndex(
  fileDiff: FileDiffMetadata,
  diffStyle: 'split' | 'unified'
): number | null {
  for (const hunk of fileDiff.hunks) {
    let offset = 0
    for (const content of hunk.hunkContent) {
      if (content.type === 'change' && (content.additions > 0 || content.deletions > 0)) {
        return (diffStyle === 'split' ? hunk.splitLineStart : hunk.unifiedLineStart) + offset
      }
      offset +=
        content.type === 'context' ? content.lines : Math.max(content.additions, content.deletions)
    }
  }
  return null
}

function NoChangesView(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-editor-surface px-6 text-center">
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No changes</div>
        <div className="text-xs text-muted-foreground">
          The original and modified contents are identical.
        </div>
      </div>
    </div>
  )
}

export default function DiffViewer({
  modelKey,
  originalContent,
  modifiedContent,
  relativePath,
  sideBySide,
  branchOldPath
}: DiffViewerProps): React.JSX.Element {
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const themeType = usePierreDiffThemeType()
  const restoredScrollKeyRef = useRef<string | null>(null)
  const pendingScrollKeyRef = useRef<string | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const oldFile = useMemo(
    () =>
      buildPierreDiffFile({
        name: branchOldPath ?? relativePath,
        contents: originalContent
      }),
    [branchOldPath, originalContent, relativePath]
  )
  const newFile = useMemo(
    () =>
      buildPierreDiffFile({
        name: relativePath,
        contents: modifiedContent
      }),
    [modifiedContent, relativePath]
  )
  const hasRenderableDiff = originalContent !== modifiedContent || oldFile.name !== newFile.name
  const fileDiff = useMemo(
    () => (hasRenderableDiff ? parseDiffFromFile(oldFile, newFile) : null),
    [hasRenderableDiff, newFile, oldFile]
  )
  const zoomedFontSize = computeEditorFontSize(PIERRE_DEFAULT_FONT_SIZE, editorFontZoomLevel)
  const zoomedLineHeight = Math.round(zoomedFontSize * PIERRE_DEFAULT_LINE_HEIGHT_RATIO)
  const metrics = useMemo<VirtualFileMetrics>(
    () => ({
      ...PIERRE_DEFAULT_VIRTUAL_FILE_METRICS,
      lineHeight: zoomedLineHeight
    }),
    [zoomedLineHeight]
  )
  const typographyStyle = useMemo<PierreDiffTypographyStyle | undefined>(() => {
    if (editorFontZoomLevel === 0) {
      return undefined
    }
    return {
      '--diffs-font-size': `${zoomedFontSize}px`,
      '--diffs-line-height': `${zoomedLineHeight}px`
    }
  }, [editorFontZoomLevel, zoomedFontSize, zoomedLineHeight])
  const firstChangedLineIndex = useMemo(
    () =>
      fileDiff
        ? getFirstChangedRenderedLineIndex(fileDiff, sideBySide ? 'split' : 'unified')
        : null,
    [fileDiff, sideBySide]
  )
  const initialScrollKey = fileDiff
    ? `${modelKey}:${fileDiff.cacheKey ?? `${fileDiff.prevName ?? ''}:${fileDiff.name}`}:${sideBySide ? 'split' : 'unified'}:${metrics.lineHeight}`
    : null

  const restoreInitialScroll = useCallback(
    (node: HTMLElement): void => {
      if (initialScrollKey == null || restoredScrollKeyRef.current === initialScrollKey) {
        return
      }
      const root = rootRef.current ?? node.closest<HTMLElement>('.diff-editor')
      const container = root?.querySelector<HTMLElement>('.pierre-diff-scroll')
      if (!container) {
        return
      }
      if (pendingScrollKeyRef.current === initialScrollKey) {
        return
      }
      const cachedScrollTop = scrollTopCache.get(modelKey)
      const targetScrollTop = getInitialPierreDiffScrollTop({
        cachedScrollTop,
        firstChangedLineIndex,
        diffHeaderHeight: metrics.diffHeaderHeight,
        lineHeight: metrics.lineHeight,
        clientHeight: container.clientHeight
      })
      if (targetScrollTop == null) {
        restoredScrollKeyRef.current = initialScrollKey
        return
      }

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      pendingScrollKeyRef.current = initialScrollKey
      let attempt = 0
      const applyScroll = (): void => {
        rafIdRef.current = null
        attempt += 1
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
        const nextScrollTop = Math.min(targetScrollTop, maxScrollTop)
        container.scrollTop = nextScrollTop
        const targetIsReachable = maxScrollTop >= targetScrollTop
        const restored = Math.abs(container.scrollTop - targetScrollTop) <= 1
        if (targetIsReachable || restored) {
          restoredScrollKeyRef.current = initialScrollKey
          pendingScrollKeyRef.current = null
          return
        }
        if (attempt < 6) {
          rafIdRef.current = requestAnimationFrame(applyScroll)
          return
        }
        pendingScrollKeyRef.current = null
      }
      rafIdRef.current = requestAnimationFrame(applyScroll)
    },
    [
      firstChangedLineIndex,
      initialScrollKey,
      metrics.diffHeaderHeight,
      metrics.lineHeight,
      modelKey
    ]
  )

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
      rafIdRef.current = null
      pendingScrollKeyRef.current = null
    }
  }, [])

  const options = useMemo<FileDiffOptions<undefined>>(
    () => ({
      diffStyle: sideBySide ? 'split' : 'unified',
      theme: PIERRE_DIFF_THEMES,
      themeType,
      tokenizeMaxLineLength: 1_000,
      onPostRender: (node, _instance, phase): void => {
        if (phase === 'unmount') {
          if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current)
            rafIdRef.current = null
          }
          pendingScrollKeyRef.current = null
          return
        }
        // Why: worker rendering can commit plain and highlighted DOM in stages;
        // Pierre's callback is the first point where scroll height is meaningful.
        restoreInitialScroll(node)
      }
    }),
    [restoreInitialScroll, sideBySide, themeType]
  )

  useEffect(() => {
    // Why: keep Orca's existing per-tab scroll cache while letting Pierre own
    // virtualization inside the scroll root.
    const container = rootRef.current?.querySelector<HTMLElement>('.pierre-diff-scroll')
    if (!container) {
      return
    }
    const handleScroll = (): void => {
      setWithLRU(scrollTopCache, modelKey, container.scrollTop)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      setWithLRU(scrollTopCache, modelKey, container.scrollTop)
    }
  }, [modelKey])

  if (!hasRenderableDiff || fileDiff == null) {
    return <NoChangesView />
  }

  return (
    <div
      ref={rootRef}
      className="diff-editor h-full min-h-0 bg-editor-surface"
      style={typographyStyle}
    >
      <Virtualizer
        className="pierre-diff-scroll h-full min-h-0 overflow-auto bg-editor-surface scrollbar-editor"
        contentClassName="min-h-full"
        config={{
          overscrollSize: 1_000,
          intersectionObserverMargin: 4_000
        }}
      >
        <FileDiff fileDiff={fileDiff} options={options} metrics={metrics} className="min-h-full" />
      </Virtualizer>
    </div>
  )
}
