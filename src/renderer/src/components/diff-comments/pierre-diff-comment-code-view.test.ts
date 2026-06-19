// @vitest-environment happy-dom
import type React from 'react'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../../shared/types'
import {
  createPierreDiffGutterVirtualAnchor,
  getPierreModifiedLineViewportRect
} from './pierre-diff-comment-code-view'

const ITEM_ID = 'orca-single-file-diff'

type LinePosition = { top: number; height: number } | undefined
type MockInstance = {
  getLinePosition?: (lineNumber: number, side?: string) => LinePosition
}

function makeCodeViewRef(
  element: HTMLElement,
  instance: MockInstance = {}
): React.MutableRefObject<CodeViewHandle<DiffComment>> {
  return {
    current: {
      getInstance: () => ({
        getRenderedItems: () => [
          {
            id: ITEM_ID,
            type: 'diff',
            instance,
            element
          }
        ]
      })
    } as unknown as CodeViewHandle<DiffComment>
  }
}

function makeGutterHost(): { host: HTMLElement; button: HTMLButtonElement } {
  const host = document.createElement('div')
  const shadow = host.attachShadow({ mode: 'open' })
  const button = document.createElement('button')
  button.setAttribute('data-utility-button', '')
  shadow.append(button)
  return { host, button }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createPierreDiffGutterVirtualAnchor', () => {
  it('anchors horizontally to the gutter button and vertically below the end line', () => {
    const { host, button } = makeGutterHost()
    host.getBoundingClientRect = vi.fn(() => new DOMRect(0, 200, 600, 400))
    button.getBoundingClientRect = vi.fn(() => new DOMRect(10, 220, 18, 18))

    const anchor = createPierreDiffGutterVirtualAnchor(
      makeCodeViewRef(host, { getLinePosition: () => ({ top: 100, height: 16 }) }),
      ITEM_ID,
      7
    )
    const rect = anchor?.getBoundingClientRect()

    // Horizontal stays in the gutter column; vertical sits at the end line so the
    // popover (side="bottom") opens just below it.
    expect(rect?.left).toBe(10)
    expect(rect?.width).toBe(18)
    expect(rect?.top).toBe(300)
    expect(rect?.height).toBe(16)
    expect(rect?.bottom).toBe(316)
  })

  it('anchors to the end line of a multi-line selection, not the start line', () => {
    const { host, button } = makeGutterHost()
    host.getBoundingClientRect = vi.fn(() => new DOMRect(0, 200, 600, 400))
    button.getBoundingClientRect = vi.fn(() => new DOMRect(10, 220, 18, 18))
    const linePositions: Record<number, LinePosition> = {
      3: { top: 40, height: 16 },
      7: { top: 120, height: 16 }
    }

    const anchor = createPierreDiffGutterVirtualAnchor(
      makeCodeViewRef(host, { getLinePosition: (lineNumber) => linePositions[lineNumber] }),
      ITEM_ID,
      7
    )

    // Top reflects line 7 (200 + 120), not line 3.
    expect(anchor?.getBoundingClientRect().top).toBe(320)
  })

  it('keeps the gutter-column x after Pierre virtualizes the button away', () => {
    const { host, button } = makeGutterHost()
    document.body.append(host)
    host.getBoundingClientRect = vi.fn(() => new DOMRect(0, 100, 600, 400))
    button.getBoundingClientRect = vi
      .fn()
      .mockReturnValueOnce(new DOMRect(10, 120, 18, 18))
      .mockReturnValue(new DOMRect(0, 0, 0, 0))

    const anchor = createPierreDiffGutterVirtualAnchor(
      makeCodeViewRef(host, { getLinePosition: () => ({ top: 50, height: 16 }) }),
      ITEM_ID,
      5
    )
    button.remove()
    const rect = anchor?.getBoundingClientRect()

    // Detached button reports a zero rect; the last good gutter x is reused while
    // the vertical position still tracks the end line.
    expect(rect?.left).toBe(10)
    expect(rect?.width).toBe(18)
    expect(rect?.top).toBe(150)
    expect(rect?.height).toBe(16)
    host.remove()
  })

  it('falls back to the gutter button rect when the end line has no position', () => {
    const { host, button } = makeGutterHost()
    const buttonRect = new DOMRect(10, 220, 18, 18)
    button.getBoundingClientRect = vi.fn(() => buttonRect)

    const anchor = createPierreDiffGutterVirtualAnchor(
      makeCodeViewRef(host, { getLinePosition: () => undefined }),
      ITEM_ID,
      7
    )

    expect(anchor?.getBoundingClientRect()).toBe(buttonRect)
  })

  it('does not fall back to the whole diff element when Pierre changes the button markup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const host = document.createElement('div')
    host.attachShadow({ mode: 'open' })
    host.getBoundingClientRect = vi.fn(() => new DOMRect(100, 200, 300, 400))

    expect(createPierreDiffGutterVirtualAnchor(makeCodeViewRef(host), ITEM_ID, 7)).toBe(null)
    expect(host.getBoundingClientRect).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'Pierre diff comment gutter button was unavailable; skipping add-note popover'
    )
  })
})

describe('getPierreModifiedLineViewportRect', () => {
  it('offsets the line position by the item element viewport top', () => {
    const host = document.createElement('div')
    host.getBoundingClientRect = vi.fn(() => new DOMRect(0, 250, 600, 400))

    expect(
      getPierreModifiedLineViewportRect(
        makeCodeViewRef(host, { getLinePosition: () => ({ top: 80, height: 18 }) }),
        ITEM_ID,
        12
      )
    ).toEqual({ top: 330, height: 18 })
  })

  it('requests the additions side for the modified-side line', () => {
    const host = document.createElement('div')
    host.getBoundingClientRect = vi.fn(() => new DOMRect(0, 0, 600, 400))
    const getLinePosition = vi.fn(() => ({ top: 0, height: 10 }))

    getPierreModifiedLineViewportRect(makeCodeViewRef(host, { getLinePosition }), ITEM_ID, 9)

    expect(getLinePosition).toHaveBeenCalledWith(9, 'additions')
  })

  it('returns null when the line has no rendered position', () => {
    const host = document.createElement('div')

    expect(
      getPierreModifiedLineViewportRect(
        makeCodeViewRef(host, { getLinePosition: () => undefined }),
        ITEM_ID,
        12
      )
    ).toBeNull()
  })
})
