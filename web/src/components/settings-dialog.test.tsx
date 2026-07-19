import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// t returns the key; useSettings is stubbed so the dialog can be tested in isolation.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const update = vi.fn()
const settingsValue = {
  theme: 'system' as const,
  showViewDependencies: true,
  defaultView: 'neighbourhood' as const,
}
vi.mock('@/lib/settings', () => ({
  useSettings: () => ({ settings: settingsValue, update }),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchHealth: vi.fn(),
}))

import { SettingsDialog } from '@/components/settings-dialog'
import { fetchHealth } from '@/lib/api'

const mockHealth = vi.mocked(fetchHealth)

afterEach(() => {
  update.mockReset()
  mockHealth.mockReset()
})

function renderDialog(open = true) {
  mockHealth.mockResolvedValue({ status: 'ok', version: '9.9.9' })
  const onClose = vi.fn()
  render(<SettingsDialog open={open} onClose={onClose} />)
  return { onClose }
}

describe('SettingsDialog', () => {
  it('renders nothing when closed', () => {
    renderDialog(false)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('updates the theme when another option is picked', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'settings.themeDark' }))

    expect(update).toHaveBeenCalledWith({ theme: 'dark' })
  })

  it('toggles the view-dependencies switch', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('switch', { name: 'settings.showViewDependencies' }))

    // The switch is on, so toggling sends false.
    expect(update).toHaveBeenCalledWith({ showViewDependencies: false })
  })

  it('changes the default view', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'settings.viewAll' }))

    expect(update).toHaveBeenCalledWith({ defaultView: 'all' })
  })

  it('shows the running version from the health check', async () => {
    renderDialog()

    expect(await screen.findByText('9.9.9')).toBeInTheDocument()
  })

  it('closes on Escape and on the close button', () => {
    const { onClose } = renderDialog()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'settings.close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('moves focus into the dialog when opened and restores it on close', () => {
    mockHealth.mockResolvedValue({ status: 'ok', version: '9.9.9' })
    // A trigger outside the dialog holds focus before it opens.
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(trigger).toHaveFocus()

    const { rerender } = render(<SettingsDialog open onClose={vi.fn()} />)
    // Focus has moved inside the dialog.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    rerender(<SettingsDialog open={false} onClose={vi.fn()} />)
    // On close, focus returns to the trigger.
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('keeps Tab within the dialog (focus trap wraps at the ends)', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    // Tab off the last element wraps to the first.
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()

    // Shift+Tab off the first wraps to the last.
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
  })
})
