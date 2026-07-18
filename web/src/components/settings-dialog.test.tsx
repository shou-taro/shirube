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

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'settings.close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
