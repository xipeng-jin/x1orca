import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  providerProps: [] as unknown[],
  store: {
    settings: {
      theme: 'dark'
    }
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mockState.store) => unknown) => selector(mockState.store)
}))

vi.mock('@pierre/diffs/worker/worker.js?worker', () => ({
  default: class MockDiffsWorker {}
}))

vi.mock('@pierre/diffs/react', async () => {
  const ReactModule = await import('react')
  return {
    WorkerPoolContextProvider: (props: { children: React.ReactNode }) => {
      mockState.providerProps.push(props)
      return ReactModule.createElement('section', null, props.children)
    },
    useWorkerPool: () => undefined
  }
})

import { PierreDiffWorkerPoolProvider } from './PierreDiffWorkerPoolProvider'

describe('PierreDiffWorkerPoolProvider', () => {
  beforeEach(() => {
    mockState.providerProps = []
    mockState.store.settings.theme = 'dark'
  })

  it('keeps Pierre workers configured without eager language preloads', () => {
    renderToStaticMarkup(
      <PierreDiffWorkerPoolProvider>
        <div>diff</div>
      </PierreDiffWorkerPoolProvider>
    )

    expect(mockState.providerProps).toHaveLength(1)
    const props = mockState.providerProps[0] as {
      poolOptions: { poolSize: number; totalASTLRUCacheSize: number }
      highlighterOptions: { theme: string; langs?: string[]; tokenizeMaxLineLength: number }
    }
    expect(props.poolOptions.poolSize).toBeGreaterThanOrEqual(2)
    expect(props.poolOptions.totalASTLRUCacheSize).toBe(240)
    expect(props.highlighterOptions).toMatchObject({
      theme: 'pierre-dark',
      tokenizeMaxLineLength: 1_000
    })
    expect(props.highlighterOptions).not.toHaveProperty('langs')
  })

  it('uses the light Pierre theme when Orca is in light mode', () => {
    mockState.store.settings.theme = 'light'

    renderToStaticMarkup(
      <PierreDiffWorkerPoolProvider>
        <div>diff</div>
      </PierreDiffWorkerPoolProvider>
    )

    const props = mockState.providerProps[0] as {
      highlighterOptions: { theme: string }
    }
    expect(props.highlighterOptions.theme).toBe('pierre-light')
  })
})
