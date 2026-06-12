// @vitest-environment happy-dom
import React, { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  const workerPool = {
    getDiffRenderOptions: vi.fn(() => ({ theme: 'pierre-dark' })),
    setRenderOptions: vi.fn(() => Promise.resolve())
  }
  return {
    workerPool,
    getOrCreateWorkerPoolSingleton: vi.fn((_setup: unknown) => workerPool),
    terminateWorkerPoolSingleton: vi.fn(),
    store: {
      settings: { theme: 'dark' as 'dark' | 'light' },
      rightSidebarOpen: false,
      rightSidebarTab: 'search',
      openFiles: [] as { mode: string; diffSource?: string }[]
    }
  }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mockState.store) => unknown) => selector(mockState.store)
}))

vi.mock('@pierre/diffs/worker/worker.js?worker', () => ({
  default: class MockDiffsWorker {}
}))

vi.mock('@pierre/diffs/worker', () => ({
  getOrCreateWorkerPoolSingleton: mockState.getOrCreateWorkerPoolSingleton,
  terminateWorkerPoolSingleton: mockState.terminateWorkerPoolSingleton
}))

vi.mock('@pierre/diffs/react', async () => {
  const ReactModule = await import('react')
  const WorkerPoolContext = ReactModule.createContext<unknown>(undefined)
  return {
    WorkerPoolContext,
    useWorkerPool: () => ReactModule.useContext(WorkerPoolContext)
  }
})

type ProviderModule = {
  PierreDiffWorkerPoolProvider: (props: { children: React.ReactNode }) => React.JSX.Element
}

let root: Root | undefined
let container: HTMLDivElement | undefined

// Why: the provider holds the acquired pool in module state on purpose (it
// must survive any unmount). Tests get a fresh module per case via
// resetModules + dynamic import.
async function loadProviderModule(): Promise<ProviderModule & { useWorkerPool: () => unknown }> {
  vi.resetModules()
  const providerModule = await import('./PierreDiffWorkerPoolProvider')
  const { useWorkerPool } = await import('@pierre/diffs/react')
  return { ...providerModule, useWorkerPool }
}

function renderIntoRoot(element: React.ReactElement): void {
  if (!root) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  act(() => {
    root?.render(element)
  })
}

beforeEach(() => {
  mockState.getOrCreateWorkerPoolSingleton.mockClear()
  mockState.terminateWorkerPoolSingleton.mockClear()
  mockState.workerPool.getDiffRenderOptions.mockClear()
  mockState.workerPool.setRenderOptions.mockClear()
  mockState.store.settings.theme = 'dark'
  mockState.store.rightSidebarOpen = false
  mockState.store.rightSidebarTab = 'search'
  mockState.store.openFiles = []
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = undefined
  container = undefined
})

describe('PierreDiffWorkerPoolProvider', () => {
  it('spawns no pool while neither source control nor a diff tab demands one', async () => {
    const { PierreDiffWorkerPoolProvider, useWorkerPool } = await loadProviderModule()
    const probe: { pool: unknown } = { pool: 'unset' }
    function PoolProbe(): null {
      probe.pool = useWorkerPool()
      return null
    }

    renderIntoRoot(
      <PierreDiffWorkerPoolProvider>
        <PoolProbe />
      </PierreDiffWorkerPoolProvider>
    )

    expect(probe.pool).toBeUndefined()
    expect(mockState.getOrCreateWorkerPoolSingleton).not.toHaveBeenCalled()
  })

  it('acquires the pool with Pierre options when source control is visible', async () => {
    mockState.store.rightSidebarOpen = true
    mockState.store.rightSidebarTab = 'source-control'
    const { PierreDiffWorkerPoolProvider, useWorkerPool } = await loadProviderModule()
    const probe: { pool: unknown } = { pool: undefined }
    function PoolProbe(): null {
      probe.pool = useWorkerPool()
      return null
    }

    renderIntoRoot(
      <PierreDiffWorkerPoolProvider>
        <PoolProbe />
      </PierreDiffWorkerPoolProvider>
    )

    expect(probe.pool).toBe(mockState.workerPool)
    expect(mockState.getOrCreateWorkerPoolSingleton).toHaveBeenCalledTimes(1)
    const setup = mockState.getOrCreateWorkerPoolSingleton.mock.calls[0]?.[0] as unknown as {
      poolOptions: { poolSize: number; totalASTLRUCacheSize: number; workerFactory: () => unknown }
      highlighterOptions: { theme: string; langs?: string[]; tokenizeMaxLineLength: number }
    }
    expect(setup.poolOptions.poolSize).toBeGreaterThanOrEqual(2)
    expect(setup.poolOptions.poolSize).toBeLessThanOrEqual(6)
    expect(setup.poolOptions.totalASTLRUCacheSize).toBe(240)
    expect(setup.highlighterOptions).toMatchObject({
      theme: 'pierre-dark',
      tokenizeMaxLineLength: 1_000
    })
    expect(setup.highlighterOptions).not.toHaveProperty('langs')
  })

  it('acquires the pool when a single-file diff tab is open with the sidebar closed', async () => {
    mockState.store.openFiles = [{ mode: 'diff', diffSource: 'unstaged' }]
    const { PierreDiffWorkerPoolProvider, useWorkerPool } = await loadProviderModule()
    const probe: { pool: unknown } = { pool: undefined }
    function PoolProbe(): null {
      probe.pool = useWorkerPool()
      return null
    }

    renderIntoRoot(
      <PierreDiffWorkerPoolProvider>
        <PoolProbe />
      </PierreDiffWorkerPoolProvider>
    )

    expect(probe.pool).toBe(mockState.workerPool)
  })

  it('ignores combined diff tabs and plain editor tabs', async () => {
    mockState.store.openFiles = [
      { mode: 'diff', diffSource: 'combined-uncommitted' },
      { mode: 'diff', diffSource: 'combined-branch' },
      { mode: 'diff', diffSource: 'combined-commit' },
      { mode: 'edit' }
    ]
    const { PierreDiffWorkerPoolProvider, useWorkerPool } = await loadProviderModule()
    const probe: { pool: unknown } = { pool: 'unset' }
    function PoolProbe(): null {
      probe.pool = useWorkerPool()
      return null
    }

    renderIntoRoot(
      <PierreDiffWorkerPoolProvider>
        <PoolProbe />
      </PierreDiffWorkerPoolProvider>
    )

    expect(probe.pool).toBeUndefined()
    expect(mockState.getOrCreateWorkerPoolSingleton).not.toHaveBeenCalled()
  })

  it('latches: keeps providing the same pool after the demand signal clears', async () => {
    const { PierreDiffWorkerPoolProvider, useWorkerPool } = await loadProviderModule()
    const probe: { pool: unknown } = { pool: undefined }
    function PoolProbe(): null {
      probe.pool = useWorkerPool()
      return null
    }
    // Fresh element per render: an identical element reference would let React
    // bail out without re-reading the (non-subscribing) mocked store.
    const renderProvider = (): void =>
      renderIntoRoot(
        <PierreDiffWorkerPoolProvider>
          <PoolProbe />
        </PierreDiffWorkerPoolProvider>
      )

    renderProvider()
    expect(probe.pool).toBeUndefined()

    mockState.store.rightSidebarOpen = true
    mockState.store.rightSidebarTab = 'source-control'
    renderProvider()
    expect(probe.pool).toBe(mockState.workerPool)

    mockState.store.rightSidebarOpen = false
    mockState.store.rightSidebarTab = 'search'
    renderProvider()
    expect(probe.pool).toBe(mockState.workerPool)
    expect(mockState.getOrCreateWorkerPoolSingleton).toHaveBeenCalledTimes(1)
  })

  it('survives a StrictMode double mount without terminating or recreating the pool', async () => {
    mockState.store.rightSidebarOpen = true
    mockState.store.rightSidebarTab = 'source-control'
    const { PierreDiffWorkerPoolProvider, useWorkerPool } = await loadProviderModule()
    const seenPools: unknown[] = []
    function PoolProbe(): null {
      seenPools.push(useWorkerPool())
      return null
    }

    renderIntoRoot(
      <StrictMode>
        <PierreDiffWorkerPoolProvider>
          <PoolProbe />
        </PierreDiffWorkerPoolProvider>
      </StrictMode>
    )

    expect(seenPools.length).toBeGreaterThan(0)
    expect(new Set(seenPools)).toEqual(new Set([mockState.workerPool]))
    expect(mockState.getOrCreateWorkerPoolSingleton).toHaveBeenCalledTimes(1)
    expect(mockState.terminateWorkerPoolSingleton).not.toHaveBeenCalled()
  })

  it('creates the pool with the light theme and syncs later theme changes', async () => {
    mockState.store.settings.theme = 'light'
    mockState.store.rightSidebarOpen = true
    mockState.store.rightSidebarTab = 'source-control'
    const { PierreDiffWorkerPoolProvider } = await loadProviderModule()
    const element = (
      <PierreDiffWorkerPoolProvider>
        <div>diff</div>
      </PierreDiffWorkerPoolProvider>
    )

    renderIntoRoot(element)

    const setup = mockState.getOrCreateWorkerPoolSingleton.mock.calls[0]?.[0] as unknown as {
      highlighterOptions: { theme: string }
    }
    expect(setup.highlighterOptions.theme).toBe('pierre-light')
    // The pool reports pierre-dark, so the theme sync must push pierre-light.
    expect(mockState.workerPool.setRenderOptions).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'pierre-light' })
    )
  })

  it('does not touch render options when the pool already has the active theme', async () => {
    mockState.store.rightSidebarOpen = true
    mockState.store.rightSidebarTab = 'source-control'
    const { PierreDiffWorkerPoolProvider } = await loadProviderModule()

    renderIntoRoot(
      <PierreDiffWorkerPoolProvider>
        <div>diff</div>
      </PierreDiffWorkerPoolProvider>
    )

    expect(mockState.workerPool.setRenderOptions).not.toHaveBeenCalled()
  })
})
