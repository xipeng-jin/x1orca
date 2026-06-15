import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react'
import {
  getFiletypeFromFileName,
  type CodeViewItem,
  type CodeViewOptions,
  type FileContents,
  type FileDiffMetadata,
  type SupportedLanguages,
  type VirtualFileMetrics
} from '@pierre/diffs'
import { useAppStore } from '@/store'
import { scrollTopCache, setWithLRU } from '@/lib/scroll-cache'
import { computeEditorFontSize } from '@/lib/editor-font-zoom'
import { getContentFingerprint, getDiffIdentityVersion } from './pierre-content-fingerprint'
import { getOrParseDiffFromFiles } from './parsed-diff-cache'
import { PIERRE_DIFF_THEMES, usePierreDiffThemeType } from './pierre-diff-theme'

type DiffViewerProps = {
  modelKey: string
  originalContent: string
  modifiedContent: string
  language: string
  relativePath: string
  sideBySide: boolean
  branchOldPath?: string
  // Why: fingerprints computed once when the diff resolved (P6). Present only
  // when the prop content matches the fetched blob, so DiffViewer can skip the
  // per-mount FNV pass; falls back to hashing when absent (e.g. live edits).
  originalContentFingerprint?: string
  modifiedContentFingerprint?: string
}

const PIERRE_DEFAULT_FONT_SIZE = 13
const PIERRE_DEFAULT_LINE_HEIGHT = 20
const PIERRE_CODE_VIEW_DIFF_ITEM_ID = 'orca-single-file-diff'
// Pierre defaults to 13px text and a 20px line box. Diff zoom keeps that
// proportion so virtual metrics and rendered rows continue to agree.
const PIERRE_DEFAULT_LINE_HEIGHT_RATIO = PIERRE_DEFAULT_LINE_HEIGHT / PIERRE_DEFAULT_FONT_SIZE
// Pierre's default themes define --diffs-dark-bg:#0a0a0a and
// --diffs-light-bg:#ffffff; the outer scrollbar lives outside its shadow DOM.
const PIERRE_DEFAULT_SCROLL_BACKGROUND = {
  dark: '#0a0a0a',
  light: '#ffffff'
} as const
type PierreDiffTypographyStyle = React.CSSProperties & {
  '--diffs-font-size'?: string
  '--diffs-line-height'?: string
}
type PierreDiffScrollStyle = React.CSSProperties & {
  '--orca-pierre-diff-scroll-bg': string
  '--diffs-scrollbar-gutter-override': '0px'
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
  contents,
  fingerprint
}: {
  name: string
  contents: string
  // Why: precomputed at diff arrival (P6) to avoid re-hashing full contents per
  // mount. Callers pass it only when it matches `contents`; absent → hash here.
  fingerprint?: string
}): FileContents {
  const languageOverride = getPierreDiffLanguageOverride(name)
  const cacheLanguage = languageOverride ?? getFiletypeFromFileName(name)
  const file: FileContents = {
    name,
    contents,
    cacheKey: `orca:pierre-file:v1:${name}:${cacheLanguage}:${fingerprint ?? getContentFingerprint(contents)}`
  }
  if (languageOverride) {
    // Why: Pierre's filename inference covers most source files; only override
    // extensions it does not map to the desired Shiki language.
    file.lang = languageOverride
  }
  return file
}

export function getInitialPierreCodeViewScrollTarget({
  cachedScrollTop
}: {
  cachedScrollTop?: number
}): { type: 'position'; position: number; behavior: 'instant' } | null {
  if (typeof cachedScrollTop === 'number') {
    return { type: 'position', position: cachedScrollTop, behavior: 'instant' }
  }
  return null
}

export function getPierreCodeViewDiffIdentity({
  fileDiff,
  oldFile,
  newFile
}: {
  fileDiff: FileDiffMetadata
  oldFile: FileContents
  newFile: FileContents
}): string {
  return [
    fileDiff.cacheKey ?? '',
    oldFile.cacheKey ?? `${oldFile.name}:${getContentFingerprint(oldFile.contents)}`,
    newFile.cacheKey ?? `${newFile.name}:${getContentFingerprint(newFile.contents)}`,
    fileDiff.prevName ?? '',
    fileDiff.name
  ].join(':')
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
  branchOldPath,
  originalContentFingerprint,
  modifiedContentFingerprint
}: DiffViewerProps): React.JSX.Element {
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const codeViewRef = useRef<CodeViewHandle<undefined> | null>(null)
  const themeType = usePierreDiffThemeType()
  const codeViewScrollElementRef = useRef<HTMLDivElement | null>(null)
  const latestLogicalScrollTopRef = useRef<number | null>(null)
  const restoredScrollKeyRef = useRef<string | null>(null)
  const pendingScrollKeyRef = useRef<string | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const oldFile = useMemo(
    () =>
      buildPierreDiffFile({
        name: branchOldPath ?? relativePath,
        contents: originalContent,
        fingerprint: originalContentFingerprint
      }),
    [branchOldPath, originalContent, originalContentFingerprint, relativePath]
  )
  const newFile = useMemo(
    () =>
      buildPierreDiffFile({
        name: relativePath,
        contents: modifiedContent,
        fingerprint: modifiedContentFingerprint
      }),
    [modifiedContent, modifiedContentFingerprint, relativePath]
  )
  const hasRenderableDiff = originalContent !== modifiedContent || oldFile.name !== newFile.name
  const fileDiff = useMemo(
    () => (hasRenderableDiff ? getOrParseDiffFromFiles(oldFile, newFile) : null),
    [hasRenderableDiff, newFile, oldFile]
  )
  const zoomedFontSize = computeEditorFontSize(PIERRE_DEFAULT_FONT_SIZE, editorFontZoomLevel)
  const zoomedLineHeight = Math.round(zoomedFontSize * PIERRE_DEFAULT_LINE_HEIGHT_RATIO)
  const itemMetrics = useMemo<Partial<VirtualFileMetrics>>(
    () => ({ lineHeight: zoomedLineHeight }),
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
  const scrollStyle = useMemo<PierreDiffScrollStyle>(
    () => ({
      colorScheme: themeType,
      '--orca-pierre-diff-scroll-bg': PIERRE_DEFAULT_SCROLL_BACKGROUND[themeType],
      // Why: CodeView line-info separators expect Pierre's default scroll layout;
      // zeroing the gutter hides the bottom bar without changing overflow.
      '--diffs-scrollbar-gutter-override': '0px'
    }),
    [themeType]
  )
  const diffIdentity = useMemo(
    () => (fileDiff ? getPierreCodeViewDiffIdentity({ fileDiff, oldFile, newFile }) : null),
    [fileDiff, newFile, oldFile]
  )
  const diffItemVersion = useMemo(
    () => (diffIdentity ? getDiffIdentityVersion(diffIdentity) : 0),
    [diffIdentity]
  )
  const items = useMemo<CodeViewItem<undefined>[]>(
    () =>
      fileDiff
        ? [
            {
              id: PIERRE_CODE_VIEW_DIFF_ITEM_ID,
              type: 'diff',
              fileDiff,
              version: diffItemVersion
            }
          ]
        : [],
    [diffItemVersion, fileDiff]
  )
  const initialScrollKey = fileDiff
    ? `${modelKey}:${diffIdentity ?? ''}:${sideBySide ? 'split' : 'unified'}:${itemMetrics.lineHeight}`
    : null

  const setCodeViewHandle = useCallback((handle: CodeViewHandle<undefined> | null): void => {
    codeViewRef.current = handle
  }, [])

  const setCodeViewContainer = useCallback(
    (element: HTMLDivElement | null): void => {
      if (!element && codeViewScrollElementRef.current && initialScrollKey != null) {
        // Why: Pierre cleans its instance up before detaching this ref, which
        // collapses the root's DOM scrollTop to 0. Persist only a logical
        // position observed via onScroll or applied by the cached restore, or
        // a StrictMode/teardown detach would clobber the cache with 0.
        const logicalScrollTop = latestLogicalScrollTopRef.current
        if (logicalScrollTop != null) {
          setWithLRU(scrollTopCache, modelKey, logicalScrollTop)
        }
      }
      if (element) {
        latestLogicalScrollTopRef.current = null
        // Why: a new container element means a fresh Pierre CodeView instance
        // starting at scrollTop 0 (StrictMode remounts reattach refs), so the
        // cached position must be restored again for this instance.
        restoredScrollKeyRef.current = null
      }
      codeViewScrollElementRef.current = element
    },
    [initialScrollKey, modelKey]
  )

  const restoreInitialScroll = useCallback((): boolean => {
    if (initialScrollKey == null || restoredScrollKeyRef.current === initialScrollKey) {
      return true
    }
    const codeView = codeViewRef.current
    if (!codeView) {
      return false
    }
    const target = getInitialPierreCodeViewScrollTarget({
      cachedScrollTop: scrollTopCache.get(modelKey)
    })
    if (target == null) {
      restoredScrollKeyRef.current = initialScrollKey
      return true
    }
    codeView.scrollTo(target)
    // Why: Pierre applies scrollTo on its next render frame and the DOM scroll
    // event lands even later, so record the restored position now — a quick
    // unmount would otherwise cache 0 from the not-yet-scrolled container.
    latestLogicalScrollTopRef.current = target.position
    restoredScrollKeyRef.current = initialScrollKey
    return true
  }, [initialScrollKey, modelKey])

  useEffect(() => {
    if (initialScrollKey == null || restoredScrollKeyRef.current === initialScrollKey) {
      return
    }
    if (pendingScrollKeyRef.current === initialScrollKey) {
      return
    }
    let attempt = 0
    const applyScroll = (): void => {
      rafIdRef.current = null
      attempt += 1
      if (restoreInitialScroll()) {
        pendingScrollKeyRef.current = null
        return
      }
      if (attempt < 3) {
        rafIdRef.current = requestAnimationFrame(applyScroll)
        return
      }
      pendingScrollKeyRef.current = null
    }
    if (!restoreInitialScroll()) {
      pendingScrollKeyRef.current = initialScrollKey
      rafIdRef.current = requestAnimationFrame(applyScroll)
    }
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
      rafIdRef.current = null
      pendingScrollKeyRef.current = null
    }
  }, [initialScrollKey, restoreInitialScroll])

  const options = useMemo<CodeViewOptions<undefined>>(
    () => ({
      diffStyle: sideBySide ? 'split' : 'unified',
      hunkSeparators: 'line-info',
      theme: PIERRE_DIFF_THEMES,
      themeType,
      tokenizeMaxLineLength: 1_000,
      itemMetrics,
      layout: { paddingTop: 0, paddingBottom: 0, gap: 0 }
    }),
    [itemMetrics, sideBySide, themeType]
  )

  const handleCodeViewScroll = useCallback(
    (scrollTop: number): void => {
      latestLogicalScrollTopRef.current = scrollTop
      setWithLRU(scrollTopCache, modelKey, scrollTop)
    },
    [modelKey]
  )

  useEffect(() => {
    return () => {
      // Why: raw DOM scrollTop is unusable here — it is page-rebased for very
      // large diffs and already collapsed to 0 once Pierre cleans up — so only
      // a known logical position (onScroll or restore) is worth persisting.
      const logicalScrollTop = latestLogicalScrollTopRef.current
      if (
        codeViewScrollElementRef.current &&
        initialScrollKey != null &&
        logicalScrollTop != null
      ) {
        setWithLRU(scrollTopCache, modelKey, logicalScrollTop)
      }
    }
  }, [initialScrollKey, modelKey])

  if (!hasRenderableDiff || fileDiff == null) {
    return <NoChangesView />
  }

  return (
    <div className="diff-editor h-full min-h-0 min-w-0" style={typographyStyle}>
      <CodeView
        ref={setCodeViewHandle}
        containerRef={setCodeViewContainer}
        items={items}
        className="pierre-diff-scroll h-full min-h-0 overflow-y-auto overflow-x-hidden pierre-diff-scrollbar"
        style={scrollStyle}
        options={options}
        onScroll={handleCodeViewScroll}
      />
    </div>
  )
}
