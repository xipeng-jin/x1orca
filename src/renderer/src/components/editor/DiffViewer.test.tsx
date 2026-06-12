// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CSSProperties } from 'react'
import type { CodeViewItem, CodeViewOptions, FileDiffMetadata } from '@pierre/diffs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollTopCache } from '@/lib/scroll-cache'

const mockState = vi.hoisted(() => ({
  codeViewProps: [] as unknown[],
  codeViewHandle: null as unknown,
  codeViewScrollTop: 0,
  store: {
    settings: {
      theme: 'dark'
    },
    editorFontZoomLevel: 0
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mockState.store) => unknown) => selector(mockState.store)
}))

vi.mock('@pierre/diffs/react', async () => {
  const ReactModule = await import('react')
  return {
    CodeView: ReactModule.forwardRef((props: unknown, ref) => {
      const codeViewProps = props as {
        containerRef?: (element: HTMLDivElement | null) => void
      }
      mockState.codeViewProps.push(props)
      ReactModule.useImperativeHandle(ref, () => mockState.codeViewHandle)
      ReactModule.useEffect(() => {
        const element = document.createElement('div')
        element.scrollTop = mockState.codeViewScrollTop
        codeViewProps.containerRef?.(element)
        return () => codeViewProps.containerRef?.(null)
      }, [codeViewProps])
      return ReactModule.createElement('div', { 'data-testid': 'pierre-code-view' })
    })
  }
})

import DiffViewer, {
  buildPierreDiffFile,
  getContentFingerprint,
  getInitialPierreCodeViewScrollTarget,
  getPierreCodeViewDiffIdentity
} from './DiffViewer'

type CapturedCodeViewProps = {
  items: CodeViewItem[]
  options: CodeViewOptions<undefined>
  className?: string
  style?: CSSProperties & {
    '--orca-pierre-diff-scroll-bg'?: string
    '--diffs-scrollbar-gutter-override'?: '0px'
    '--diffs-overflow-override'?: string
  }
  onScroll?: (scrollTop: number) => void
}

function getOnlyCodeViewProps(): CapturedCodeViewProps {
  expect(mockState.codeViewProps).toHaveLength(1)
  return mockState.codeViewProps[0] as CapturedCodeViewProps
}

function getOnlyFileDiff(): FileDiffMetadata {
  const item = getOnlyCodeViewProps().items[0]
  expect(item).toMatchObject({ id: 'orca-single-file-diff', type: 'diff' })
  if (item?.type !== 'diff') {
    throw new Error('Expected a CodeView diff item')
  }
  return item.fileDiff
}

describe('DiffViewer', () => {
  beforeEach(() => {
    mockState.codeViewProps = []
    mockState.codeViewHandle = {
      scrollTo: vi.fn(),
      getInstance: vi.fn(() => ({ getScrollTop: () => 0 }))
    }
    mockState.codeViewScrollTop = 0
    mockState.store.settings.theme = 'dark'
    mockState.store.editorFontZoomLevel = 0
    scrollTopCache.clear()
  })

  it('passes Orca file contents to Pierre as a single unified CodeView diff item', () => {
    const html = renderToStaticMarkup(
      <DiffViewer
        modelKey="diff:src/app.ts"
        originalContent={'old line\n'}
        modifiedContent={'new line\n'}
        language="typescript"
        relativePath="src/app.ts"
        sideBySide={false}
        branchOldPath="src/old-app.ts"
      />
    )

    const props = getOnlyCodeViewProps()
    expect(props.items).toHaveLength(1)
    const item = props.items[0]
    expect(item).toMatchObject({
      id: 'orca-single-file-diff',
      type: 'diff',
      version: expect.any(Number)
    })
    if (item.type !== 'diff') {
      throw new Error('Expected a CodeView diff item')
    }
    expect(item.fileDiff).toMatchObject({
      name: 'src/app.ts',
      prevName: 'src/old-app.ts',
      type: 'rename-changed'
    })
    expect(item.fileDiff).not.toHaveProperty('lang')
    expect(item.fileDiff.cacheKey).toContain('src/old-app.ts:typescript')
    expect(item.fileDiff.cacheKey).toContain('src/app.ts:typescript')
    expect(item.fileDiff.cacheKey).not.toContain('diff:src/app.ts')
    expect(props.options).toMatchObject({
      diffStyle: 'unified',
      hunkSeparators: 'line-info',
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      themeType: 'dark',
      tokenizeMaxLineLength: 1000,
      itemMetrics: {
        lineHeight: 20
      },
      layout: {
        paddingTop: 0,
        paddingBottom: 0,
        gap: 0
      }
    })
    expect(props.options).not.toHaveProperty('overflow')
    expect(props.options).not.toHaveProperty('expandUnchanged')
    expect(props.options).not.toHaveProperty('unsafeCSS')
    expect(props.options).not.toHaveProperty('onPostRender')
    expect(html).not.toContain('--diffs-font-size')
    expect(html).not.toContain('--diffs-line-height')
    expect(html).not.toContain('--diffs-font-family')
    expect(html).not.toContain('--diffs-header-font-family')
    expect(html).toContain('class="diff-editor h-full min-h-0 min-w-0"')
    expect(html).not.toContain('diff-editor h-full min-h-0 bg-editor-surface')
    expect(props.className).toContain('pierre-diff-scroll')
    expect(props.className).toContain('h-full')
    expect(props.className).toContain('min-h-0')
    expect(props.className).toContain('overflow-y-auto')
    expect(props.className).toContain('overflow-x-hidden')
    expect(props.className).toContain('pierre-diff-scrollbar')
    expect(props.className).not.toContain('overflow-x-clip')
    expect(props.className).not.toContain('overflow-auto')
    expect(props.className).not.toContain('scrollbar-sleek')
    expect(props.className).not.toContain('bg-editor-surface')
    expect(props.className).not.toContain('scrollbar-editor')
    expect(props.style).toMatchObject({
      colorScheme: 'dark',
      '--orca-pierre-diff-scroll-bg': '#0a0a0a',
      '--diffs-scrollbar-gutter-override': '0px'
    })
    expect(props.style).not.toHaveProperty('--diffs-overflow-override')
  })

  it('builds CodeView item identity from Orca file cache keys', () => {
    const oldFile = buildPierreDiffFile({
      name: 'src/app.ts',
      contents: 'old line\n'
    })
    const newFile = buildPierreDiffFile({
      name: 'src/app.ts',
      contents: 'new line\n'
    })

    renderToStaticMarkup(
      <DiffViewer
        modelKey="diff:src/app.ts"
        originalContent={oldFile.contents}
        modifiedContent={newFile.contents}
        language="typescript"
        relativePath="src/app.ts"
        sideBySide={false}
      />
    )

    const fileDiff = getOnlyFileDiff()
    const identity = getPierreCodeViewDiffIdentity({
      fileDiff: { ...fileDiff, cacheKey: undefined },
      oldFile,
      newFile
    })
    expect(identity).toContain(oldFile.cacheKey)
    expect(identity).toContain(newFile.cacheKey)
    expect(identity).toContain(fileDiff.name)
  })

  it('uses Pierre light theme background for the outer diff scrollbar gutter', () => {
    mockState.store.settings.theme = 'light'

    renderToStaticMarkup(
      <DiffViewer
        modelKey="diff:src/app.ts"
        originalContent={'old line\n'}
        modifiedContent={'new line\n'}
        language="typescript"
        relativePath="src/app.ts"
        sideBySide={false}
      />
    )

    expect(getOnlyCodeViewProps().style).toMatchObject({
      colorScheme: 'light',
      '--orca-pierre-diff-scroll-bg': '#ffffff',
      '--diffs-scrollbar-gutter-override': '0px'
    })
    expect(getOnlyCodeViewProps().style).not.toHaveProperty('--diffs-overflow-override')
  })

  it('keeps inherited scrollbar styling out of the Pierre shadow DOM', () => {
    // scrollbar-width/scrollbar-color inherit across the shadow boundary and
    // disable Pierre's [data-code]::-webkit-scrollbar sizing, which reopens an
    // internal scrollbar gutter and breaks line-info separator (100cqi) layout.
    const testDir = dirname(fileURLToPath(import.meta.url))
    const css = readFileSync(resolve(testDir, '../../assets/main.css'), 'utf8')
    const hostReset =
      css.match(/\.pierre-diff-scroll diffs-container\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? ''

    expect(hostReset).toMatch(/scrollbar-width:\s*auto/)
    expect(hostReset).toMatch(/scrollbar-color:\s*auto/)
  })

  it('applies editor zoom using Pierre default font proportions', () => {
    mockState.store.editorFontZoomLevel = 2
    const html = renderToStaticMarkup(
      <DiffViewer
        modelKey="diff:src/app.ts"
        originalContent={'old line\n'}
        modifiedContent={'new line\n'}
        language="typescript"
        relativePath="src/app.ts"
        sideBySide={false}
      />
    )

    expect(html).toContain('--diffs-font-size:15px')
    expect(html).toContain('--diffs-line-height:23px')
    expect(html).not.toContain('--diffs-font-family')
    expect(html).not.toContain('--diffs-header-font-family')
    expect(getOnlyCodeViewProps().options.itemMetrics).toMatchObject({
      lineHeight: 23
    })
  })

  it('maps Orca side-by-side state to Pierre split mode', () => {
    renderToStaticMarkup(
      <DiffViewer
        modelKey="diff:src/app.ts"
        originalContent={'old line\n'}
        modifiedContent={'new line\n'}
        language="typescript"
        relativePath="src/app.ts"
        sideBySide
      />
    )

    expect(getOnlyCodeViewProps().options).toMatchObject({
      diffStyle: 'split'
    })
  })

  it('renders an empty state instead of asking Pierre to parse identical contents', () => {
    const html = renderToStaticMarkup(
      <DiffViewer
        modelKey="diff:src/app.ts"
        originalContent={'same\n'}
        modifiedContent={'same\n'}
        language="typescript"
        relativePath="src/app.ts"
        sideBySide={false}
      />
    )

    expect(html).toContain('No changes')
    expect(mockState.codeViewProps).toHaveLength(0)
  })

  it('renders same-content renames through Pierre instead of the empty state', () => {
    const html = renderToStaticMarkup(
      <DiffViewer
        modelKey="diff:src/new-name.ts"
        originalContent={'same\n'}
        modifiedContent={'same\n'}
        language="typescript"
        relativePath="src/new-name.ts"
        sideBySide={false}
        branchOldPath="src/old-name.ts"
      />
    )

    expect(html).not.toContain('No changes')
    expect(getOnlyFileDiff()).toMatchObject({
      name: 'src/new-name.ts',
      prevName: 'src/old-name.ts',
      type: 'rename-pure'
    })
  })

  it('lets Pierre infer TSX and MDX languages from filenames', () => {
    renderToStaticMarkup(
      <DiffViewer
        modelKey="diff:src/App.tsx"
        originalContent={'export const App = () => <div />\n'}
        modifiedContent={'export const App = () => <main />\n'}
        language="typescript"
        relativePath="src/App.tsx"
        sideBySide={false}
        branchOldPath="docs/page.mdx"
      />
    )

    const fileDiff = getOnlyFileDiff()
    expect(fileDiff).not.toHaveProperty('lang')
    expect(fileDiff.cacheKey).toContain('docs/page.mdx:mdx')
    expect(fileDiff.cacheKey).toContain('src/App.tsx:tsx')
  })

  it('sets explicit Pierre language overrides only for known filename gaps', () => {
    const notebook = buildPierreDiffFile({
      name: 'analysis/notebook.ipynb',
      contents: '{}\n'
    })
    const svg = buildPierreDiffFile({
      name: 'assets/icon.svg',
      contents: '<svg />\n'
    })
    const unknown = buildPierreDiffFile({
      name: 'notes/readme.unknown-extension',
      contents: 'plain\n'
    })

    expect(notebook.lang).toBe('json')
    expect(notebook.cacheKey).toContain('analysis/notebook.ipynb:json')
    expect(svg.lang).toBe('xml')
    expect(svg.cacheKey).toContain('assets/icon.svg:xml')
    expect(unknown).not.toHaveProperty('lang')
    expect(unknown.cacheKey).toContain('notes/readme.unknown-extension:text')
  })

  it('uses content-addressed Pierre worker cache keys independent of tab identity', () => {
    const base = buildPierreDiffFile({
      name: 'src/app.ts',
      contents: 'const value = 1\n'
    })
    const same = buildPierreDiffFile({
      name: 'src/app.ts',
      contents: 'const value = 1\n'
    })
    const renamed = buildPierreDiffFile({
      name: 'src/app.tsx',
      contents: 'const value = 1\n'
    })
    const changed = buildPierreDiffFile({
      name: 'src/app.ts',
      contents: 'const value = 2\n'
    })
    const overridden = buildPierreDiffFile({
      name: 'src/app.ipynb',
      contents: 'const value = 1\n'
    })

    expect(base.cacheKey).toBe(same.cacheKey)
    expect(base.cacheKey).not.toBe(renamed.cacheKey)
    expect(base.cacheKey).not.toBe(changed.cacheKey)
    expect(base.cacheKey).not.toBe(overridden.cacheKey)
    expect(base.cacheKey).toContain(`:${getContentFingerprint('const value = 1\n')}`)
    expect(base.cacheKey).toContain('src/app.ts:typescript')
    expect(renamed.cacheKey).toContain('src/app.tsx:tsx')
    expect(overridden.cacheKey).toContain('src/app.ipynb:json')
    expect(base.cacheKey).not.toContain('diff:new')
  })

  it('uses only cached pixel scroll for initial CodeView scroll targets', () => {
    expect(
      getInitialPierreCodeViewScrollTarget({
        cachedScrollTop: 320
      })
    ).toEqual({ type: 'position', position: 320, behavior: 'instant' })
    expect(
      getInitialPierreCodeViewScrollTarget({
        cachedScrollTop: 0
      })
    ).toEqual({ type: 'position', position: 0, behavior: 'instant' })
    expect(getInitialPierreCodeViewScrollTarget({})).toBeNull()
  })

  it('restores cached CodeView scroll positions on mount', async () => {
    const container = document.createElement('div')
    let root: Root | null = createRoot(container)
    const codeViewHandle = mockState.codeViewHandle as { scrollTo: ReturnType<typeof vi.fn> }
    scrollTopCache.set('diff:src/app.ts', 320)

    await act(async () => {
      root?.render(
        <DiffViewer
          modelKey="diff:src/app.ts"
          originalContent={'old line\n'}
          modifiedContent={'new line\n'}
          language="typescript"
          relativePath="src/app.ts"
          sideBySide={false}
        />
      )
    })

    expect(codeViewHandle.scrollTo).toHaveBeenCalledWith({
      type: 'position',
      position: 320,
      behavior: 'instant'
    })

    await act(async () => {
      root?.unmount()
      root = null
    })
  })

  it('leaves uncached CodeView diffs at Pierre default top position on mount', async () => {
    const container = document.createElement('div')
    let root: Root | null = createRoot(container)
    const codeViewHandle = mockState.codeViewHandle as { scrollTo: ReturnType<typeof vi.fn> }

    await act(async () => {
      root?.render(
        <DiffViewer
          modelKey="diff:src/app.ts"
          originalContent={'old line\n'}
          modifiedContent={'new line\n'}
          language="typescript"
          relativePath="src/app.ts"
          sideBySide={false}
        />
      )
    })

    expect(codeViewHandle.scrollTo).not.toHaveBeenCalled()

    await act(async () => {
      root?.unmount()
      root = null
    })
  })

  it('caches CodeView scroll positions for the active diff tab', () => {
    renderToStaticMarkup(
      <DiffViewer
        modelKey="diff:src/app.ts"
        originalContent={'old line\n'}
        modifiedContent={'new line\n'}
        language="typescript"
        relativePath="src/app.ts"
        sideBySide={false}
      />
    )

    getOnlyCodeViewProps().onScroll?.(512)

    expect(scrollTopCache.get('diff:src/app.ts')).toBe(512)
  })

  it('does not cache a collapsed DOM scrollTop when no logical scroll was observed', async () => {
    const container = document.createElement('div')
    let root: Root | null = createRoot(container)
    mockState.codeViewHandle = {
      scrollTo: vi.fn(),
      getInstance: vi.fn(() => undefined)
    }
    // Why: Pierre cleans up before the container ref detaches, so any raw DOM
    // scrollTop read at unmount reflects the collapsed (0) container, not the
    // user's position. Nothing observed means nothing should be written.
    mockState.codeViewScrollTop = 777

    await act(async () => {
      root?.render(
        <DiffViewer
          modelKey="diff:src/app.ts"
          originalContent={'old line\n'}
          modifiedContent={'new line\n'}
          language="typescript"
          relativePath="src/app.ts"
          sideBySide={false}
        />
      )
    })
    await act(async () => {
      root?.unmount()
      root = null
    })

    expect(scrollTopCache.has('diff:src/app.ts')).toBe(false)
  })

  it('caches the last logical CodeView scroll position on unmount', async () => {
    const container = document.createElement('div')
    let root: Root | null = createRoot(container)
    mockState.codeViewHandle = {
      scrollTo: vi.fn(),
      getInstance: vi.fn(() => undefined)
    }
    mockState.codeViewScrollTop = 777

    await act(async () => {
      root?.render(
        <DiffViewer
          modelKey="diff:src/app.ts"
          originalContent={'old line\n'}
          modifiedContent={'new line\n'}
          language="typescript"
          relativePath="src/app.ts"
          sideBySide={false}
        />
      )
    })
    getOnlyCodeViewProps().onScroll?.(888)
    await act(async () => {
      root?.unmount()
      root = null
    })

    expect(scrollTopCache.get('diff:src/app.ts')).toBe(888)
  })

  it('keeps cached restores working across a StrictMode double-mount', async () => {
    const container = document.createElement('div')
    let root: Root | null = createRoot(container)
    const codeViewHandle = mockState.codeViewHandle as { scrollTo: ReturnType<typeof vi.fn> }
    scrollTopCache.set('diff:src/app.ts', 320)

    await act(async () => {
      root?.render(
        <StrictMode>
          <DiffViewer
            modelKey="diff:src/app.ts"
            originalContent={'old line\n'}
            modifiedContent={'new line\n'}
            language="typescript"
            relativePath="src/app.ts"
            sideBySide={false}
          />
        </StrictMode>
      )
    })

    // Why: StrictMode detaches and reattaches the container ref, recreating
    // Pierre's instance at scrollTop 0. The detach must not clobber the cache
    // with the collapsed DOM scrollTop, and the restore must run again for
    // the reattached instance.
    expect(scrollTopCache.get('diff:src/app.ts')).toBe(320)
    expect(codeViewHandle.scrollTo).toHaveBeenLastCalledWith({
      type: 'position',
      position: 320,
      behavior: 'instant'
    })
    expect(codeViewHandle.scrollTo.mock.calls.length).toBeGreaterThanOrEqual(2)

    await act(async () => {
      root?.unmount()
      root = null
    })
    expect(scrollTopCache.get('diff:src/app.ts')).toBe(320)
  })

  it('does not reuse a prior diff logical scroll for a new diff root', async () => {
    const container = document.createElement('div')
    let root: Root | null = createRoot(container)
    mockState.codeViewHandle = {
      scrollTo: vi.fn(),
      getInstance: vi.fn(() => undefined)
    }
    mockState.codeViewScrollTop = 100

    await act(async () => {
      root?.render(
        <DiffViewer
          modelKey="diff:src/app.ts"
          originalContent={'old line\n'}
          modifiedContent={'new line\n'}
          language="typescript"
          relativePath="src/app.ts"
          sideBySide={false}
        />
      )
    })
    getOnlyCodeViewProps().onScroll?.(888)
    mockState.codeViewProps = []
    mockState.codeViewScrollTop = 222
    await act(async () => {
      root?.render(
        <DiffViewer
          modelKey="diff:src/other.ts"
          originalContent={'before\n'}
          modifiedContent={'after\n'}
          language="typescript"
          relativePath="src/other.ts"
          sideBySide={false}
        />
      )
    })
    await act(async () => {
      root?.unmount()
      root = null
    })

    expect(scrollTopCache.get('diff:src/app.ts')).toBe(888)
    // Why: the other diff was never scrolled and had no cached restore, so no
    // logical position exists for it — caching the raw container scrollTop
    // here would persist a stale or collapsed value.
    expect(scrollTopCache.has('diff:src/other.ts')).toBe(false)
  })
})
