import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiProvider, ChatStreamEvent } from '@/lib/api'

// t returns the key, so tests query by stable keys rather than translated copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Replace the streaming call; keep the real types and other exports.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  streamChat: vi.fn(),
}))

import { NavigatorPane } from '@/components/navigator-pane'
import { streamChat } from '@/lib/api'

const mockStreamChat = vi.mocked(streamChat)

const LOCAL: AiProvider = {
  kind: 'openai_compatible',
  model: 'llama3.1',
  base_url: 'http://localhost:11434/v1',
  has_api_key: false,
}
const HOSTED: AiProvider = {
  kind: 'anthropic',
  model: 'claude-opus-4-8',
  base_url: null,
  has_api_key: true,
}

/** Make streamChat yield the given events. */
function streamsBack(events: ChatStreamEvent[]): void {
  mockStreamChat.mockImplementation(async function* () {
    for (const event of events) {
      yield event
    }
  })
}

function renderPane(provider: AiProvider | null, approved: string[] = []) {
  const onApprove = vi.fn()
  const onOpenSettings = vi.fn()
  render(
    <NavigatorPane
      profileId="p1"
      provider={provider}
      providerLoading={false}
      approved={approved}
      onApprove={onApprove}
      onOpenSettings={onOpenSettings}
    />,
  )
  return { onApprove, onOpenSettings }
}

function ask(question: string): void {
  const box = screen.getByLabelText('chat.inputPlaceholder')
  fireEvent.change(box, { target: { value: question } })
  fireEvent.click(screen.getByLabelText('chat.send'))
}

beforeEach(() => {
  mockStreamChat.mockReset()
  streamsBack([{ type: 'text', text: 'Hello.' }, { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } }])
})

afterEach(() => {
  localStorage.clear()
})

describe('NavigatorPane', () => {
  it('sends straight to a local provider without asking for consent', async () => {
    const { onApprove } = renderPane(LOCAL)
    expect(screen.getByText('chat.destinationLocal')).toBeInTheDocument()

    ask('Where do stores live?')

    expect(await screen.findByText('Hello.')).toBeInTheDocument()
    expect(mockStreamChat).toHaveBeenCalledWith(
      'p1',
      [{ role: 'user', content: 'Where do stores live?' }],
      expect.any(AbortSignal),
    )
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('asks for consent before a first send to a remote provider, then sends on confirm', async () => {
    const { onApprove } = renderPane(HOSTED)
    expect(screen.getByText('chat.destinationHosted')).toBeInTheDocument()

    ask('Hi')

    // The consent gate is shown and nothing has been sent yet.
    expect(screen.getByText('chat.consentTitle')).toBeInTheDocument()
    expect(mockStreamChat).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('chat.consentConfirm'))

    expect(onApprove).toHaveBeenCalledWith('anthropic')
    expect(await screen.findByText('Hello.')).toBeInTheDocument()
    expect(mockStreamChat).toHaveBeenCalledTimes(1)
  })

  it('does not ask again once the remote destination is approved', async () => {
    renderPane(HOSTED, ['anthropic'])

    ask('Hi')

    expect(screen.queryByText('chat.consentTitle')).not.toBeInTheDocument()
    expect(await screen.findByText('Hello.')).toBeInTheDocument()
  })

  it('surfaces a streamed error as an inline message', async () => {
    streamsBack([{ type: 'error', message: 'The AI provider could not be reached.' }])
    renderPane(LOCAL)

    ask('Hi')

    expect(await screen.findByText('The AI provider could not be reached.')).toBeInTheDocument()
  })

  it('disables the composer and offers to configure when no provider is set', () => {
    const { onOpenSettings } = renderPane(null)

    expect(screen.getByLabelText('chat.inputPlaceholder')).toBeDisabled()
    expect(screen.getByText('chat.noProvider')).toBeInTheDocument()
    fireEvent.click(screen.getByText('chat.configure'))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('cancels the consent gate without sending', async () => {
    renderPane(HOSTED)

    ask('Hi')
    fireEvent.click(screen.getByText('chat.consentCancel'))

    await waitFor(() => expect(screen.queryByText('chat.consentTitle')).not.toBeInTheDocument())
    expect(mockStreamChat).not.toHaveBeenCalled()
  })
})
