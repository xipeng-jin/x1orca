// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiffCommentPopoverForm } from './DiffCommentPopoverForm'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderForm(onSubmit: (body: string) => Promise<boolean | void>): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <DiffCommentPopoverForm lineNumber={3} onCancel={() => undefined} onSubmit={onSubmit} />
    )
  })
}

async function enterDraft(value: string): Promise<void> {
  const textarea = container?.querySelector('textarea')
  if (!textarea) {
    throw new Error('textarea not rendered')
  }
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    valueSetter?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function submitDraft(): Promise<void> {
  const buttons = [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  const button = buttons.at(-1)
  if (!button) {
    throw new Error('submit button not rendered')
  }
  await act(async () => {
    button.click()
  })
}

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  container = null
})

describe('DiffCommentPopoverForm', () => {
  it('keeps the draft when submit resolves without an explicit success', async () => {
    const onSubmit = vi.fn(async () => undefined)
    await renderForm(onSubmit)
    await enterDraft('retry me')

    await submitDraft()

    expect(onSubmit).toHaveBeenCalledWith('retry me')
    expect(container?.querySelector('textarea')?.value).toBe('retry me')
  })

  it('clears the draft only after an explicit success', async () => {
    const onSubmit = vi.fn(async () => true)
    await renderForm(onSubmit)
    await enterDraft('saved')

    await submitDraft()

    expect(onSubmit).toHaveBeenCalledWith('saved')
    expect(container?.querySelector('textarea')?.value).toBe('')
  })
})
