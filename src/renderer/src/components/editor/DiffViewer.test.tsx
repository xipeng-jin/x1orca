import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { FileDiffMetadata } from '@pierre/diffs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollTopCache } from '@/lib/scroll-cache'

const mockState = vi.hoisted(() => ({
  fileDiffProps: [] as unknown[],
  virtualizerProps: [] as unknown[],
  store: {
    settings: {
      theme: 'dark',
      terminalFontSize: 13,
      terminalFontFamily: 'Test Mono'
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
    FileDiff: (props: unknown) => {
      mockState.fileDiffProps.push(props)
      return ReactModule.createElement('div', { 'data-testid': 'pierre-diff' })
    },
    Virtualizer: ({ children, ...props }: { children: ReactNode }) => {
      mockState.virtualizerProps.push(props)
      return ReactModule.createElement('div', props, children)
    }
  }
})

import DiffViewer, {
  buildPierreDiffFile,
  getContentFingerprint,
  getFirstChangedRenderedLineIndex,
  getInitialPierreDiffScrollTop
} from './DiffViewer'

type CapturedFileDiffProps = {
  fileDiff: FileDiffMetadata
  options: Record<string, unknown>
  metrics: Record<string, unknown>
}

describe('DiffViewer', () => {
  beforeEach(() => {
    mockState.fileDiffProps = []
    mockState.virtualizerProps = []
    mockState.store.settings.theme = 'dark'
    scrollTopCache.clear()
  })

  it('passes Orca file contents to Pierre as a virtualized unified full-context diff', () => {
    renderToStaticMarkup(
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

    expect(mockState.fileDiffProps).toHaveLength(1)
    const props = mockState.fileDiffProps[0] as CapturedFileDiffProps
    expect(props.fileDiff).toMatchObject({
      name: 'src/app.ts',
      prevName: 'src/old-app.ts',
      type: 'rename-changed'
    })
    expect(props.fileDiff).not.toHaveProperty('lang')
    expect(props.fileDiff.cacheKey).toContain('src/old-app.ts:typescript')
    expect(props.fileDiff.cacheKey).toContain('src/app.ts:typescript')
    expect(props.fileDiff.cacheKey).not.toContain('diff:src/app.ts')
    expect(props.options).toMatchObject({
      diffStyle: 'unified',
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      themeType: 'dark'
    })
    expect(props.options.onPostRender).toEqual(expect.any(Function))
    expect(props.options).not.toHaveProperty('expandUnchanged')
    expect(props.options).not.toHaveProperty('hunkSeparators')
    expect(props.options).not.toHaveProperty('unsafeCSS')
    expect(props.metrics).toMatchObject({
      hunkLineCount: 50,
      lineHeight: 20,
      diffHeaderHeight: 44,
      spacing: 8
    })
    expect(mockState.virtualizerProps).toHaveLength(1)
    expect(mockState.virtualizerProps[0]).toMatchObject({
      className: expect.stringContaining('pierre-diff-scroll'),
      contentClassName: 'min-h-full',
      config: {
        overscrollSize: 1000,
        intersectionObserverMargin: 4000
      }
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

    const props = mockState.fileDiffProps[0] as CapturedFileDiffProps
    expect(props.options).toMatchObject({
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
    expect(mockState.fileDiffProps).toHaveLength(0)
    expect(mockState.virtualizerProps).toHaveLength(0)
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
    expect(mockState.fileDiffProps).toHaveLength(1)
    const props = mockState.fileDiffProps[0] as CapturedFileDiffProps
    expect(props.fileDiff).toMatchObject({
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

    const props = mockState.fileDiffProps[0] as CapturedFileDiffProps
    expect(props.fileDiff).not.toHaveProperty('lang')
    expect(props.fileDiff.cacheKey).toContain('docs/page.mdx:mdx')
    expect(props.fileDiff.cacheKey).toContain('src/App.tsx:tsx')
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

  it('finds the first changed rendered line in unified and split diffs', () => {
    renderToStaticMarkup(
      <DiffViewer
        modelKey="diff:src/app.ts"
        originalContent={'same 1\nsame 2\nold\nsame 4\nsame 5\n'}
        modifiedContent={'same 1\nsame 2\nnew\nsame 4\nsame 5\n'}
        language="typescript"
        relativePath="src/app.ts"
        sideBySide={false}
      />
    )

    const props = mockState.fileDiffProps[0] as CapturedFileDiffProps
    expect(getFirstChangedRenderedLineIndex(props.fileDiff, 'unified')).toBe(2)
    expect(getFirstChangedRenderedLineIndex(props.fileDiff, 'split')).toBe(2)
  })

  it('uses cached scroll before first-change scroll for Pierre post-render restore', () => {
    expect(
      getInitialPierreDiffScrollTop({
        cachedScrollTop: 320,
        firstChangedLineIndex: 100,
        diffHeaderHeight: 44,
        lineHeight: 20,
        clientHeight: 400
      })
    ).toBe(320)
    expect(
      getInitialPierreDiffScrollTop({
        firstChangedLineIndex: 100,
        diffHeaderHeight: 44,
        lineHeight: 20,
        clientHeight: 400
      })
    ).toBe(1844)
  })

  it('restores cached scroll from Pierre onPostRender instead of initial render', () => {
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

    const props = mockState.fileDiffProps[0] as CapturedFileDiffProps
    const container = {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 0
    }
    const root = {
      querySelector: vi.fn(() => container)
    }
    const node = {
      closest: vi.fn(() => root)
    }
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame
    const previousCancelAnimationFrame = globalThis.cancelAnimationFrame
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
      callback(0)
      return 1
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame
    scrollTopCache.set('diff:src/app.ts', 320)

    const onPostRender = props.options.onPostRender as (
      node: HTMLElement,
      instance: unknown,
      phase: string
    ) => void

    try {
      expect(container.scrollTop).toBe(0)
      onPostRender(node as unknown as HTMLElement, {}, 'mount')

      expect(root.querySelector).toHaveBeenCalledWith('.pierre-diff-scroll')
      expect(container.scrollTop).toBe(320)
    } finally {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame
      globalThis.cancelAnimationFrame = previousCancelAnimationFrame
    }
  })
})
