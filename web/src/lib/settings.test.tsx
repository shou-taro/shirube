import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SettingsProvider, useSettings } from '@/lib/settings'
import { SETTINGS_KEY } from '@/lib/storage'

/** A tiny consumer that renders the current settings so they can be asserted. */
function Probe() {
  const { settings } = useSettings()
  return (
    <>
      <span data-testid="theme">{settings.theme}</span>
      <span data-testid="viewDeps">{String(settings.showViewDependencies)}</span>
      <span data-testid="defaultView">{settings.defaultView}</span>
    </>
  )
}

function renderWithProvider() {
  return render(
    <SettingsProvider>
      <Probe />
    </SettingsProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('SettingsProvider', () => {
  it('uses the defaults when storage is empty', () => {
    renderWithProvider()

    expect(screen.getByTestId('theme')).toHaveTextContent('system')
    expect(screen.getByTestId('viewDeps')).toHaveTextContent('true')
    expect(screen.getByTestId('defaultView')).toHaveTextContent('neighbourhood')
  })

  it('falls back to the defaults when the stored JSON is invalid', () => {
    localStorage.setItem(SETTINGS_KEY, '{ not valid json')

    renderWithProvider()

    expect(screen.getByTestId('theme')).toHaveTextContent('system')
  })

  it('merges partial stored settings over the defaults', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }))

    renderWithProvider()

    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    // A key absent from storage still comes from the defaults.
    expect(screen.getByTestId('viewDeps')).toHaveTextContent('true')
  })

  it('adds the dark class to the root when the theme is dark', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'dark' }))

    renderWithProvider()

    expect(document.documentElement).toHaveClass('dark')
  })

  it('removes the dark class when the theme is light', () => {
    document.documentElement.classList.add('dark')
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }))

    renderWithProvider()

    expect(document.documentElement).not.toHaveClass('dark')
  })
})
