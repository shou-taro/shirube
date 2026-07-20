import { ArrowUp, Globe, HardDrive, Loader2, Settings2, Sparkles, Square } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Button } from '@/components/ui/button'
import { AI_PRESETS, presetForConfig } from '@/lib/ai-presets'
import { type AiProvider, type ChatMessage, streamChat } from '@/lib/api'
import { describeDestination, isDestinationApproved } from '@/lib/destinations'
import type { ObjectResolver } from '@/lib/schema-refs'
import { cn } from '@/lib/utils'

/** One rendered turn of the conversation. Assistant turns grow as the answer streams in. */
interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Tools the assistant looked up this turn (assistant turns only). */
  tools: string[]
  /** A user-safe error that ended this turn, if any (assistant turns only). */
  error: string | null
  /** Whether this assistant turn is still streaming. */
  streaming: boolean
}

interface NavigatorPaneProps {
  /** The connected profile whose schema questions are about. */
  profileId: string
  /** The configured AI provider, or null when none is set. */
  provider: AiProvider | null
  /** Whether the provider configuration is still loading (avoids flashing the prompt). */
  providerLoading: boolean
  /** Destination identifiers the user has agreed to send the schema to. */
  approved: string[]
  /** Remember approval for a destination identifier (persisted by the owner). */
  onApprove: (id: string) => void
  /** Open the settings dialog, so the user can configure a provider. */
  onOpenSettings: () => void
  /** The pane's width in pixels; it is resizable, so this is set rather than fixed. */
  width: number
  /** Recognise a schema object the answer names, so it can be linked to the map. */
  resolveRef: ObjectResolver
  /** Recentre the ER map on an object the user clicked in an answer. */
  onNavigate: (objectId: string) => void
}

function newId(): string {
  return crypto.randomUUID()
}

// The look-up tools, said in the user's terms. The names the model calls are an internal
// detail — the pane only ever reports what was consulted, in plain English.
const TOOL_LABEL_KEYS: Record<string, string> = {
  search_objects: 'chat.toolSearch',
  get_object: 'chat.toolObject',
  find_path: 'chat.toolPath',
  list_schemas: 'chat.toolSchemas',
}

/** A table or view the answer named, as a link that recentres the map on it. */
function ObjectLink({
  objectId,
  label,
  onNavigate,
}: {
  objectId: string
  label: ReactNode
  onNavigate: (objectId: string) => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onNavigate(objectId)}
      title={t('chat.showOnMap', { name: objectId })}
      className="rounded bg-brand/15 px-1 py-0.5 font-mono text-[0.85em] text-brand underline decoration-dotted underline-offset-2 hover:bg-brand/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
    >
      {label}
    </button>
  )
}

/**
 * Render an answer's Markdown.
 *
 * The model replies in Markdown — headings, lists, tables and code — so it is rendered
 * rather than shown raw. The pane is narrow, so every element is styled tight and a table
 * scrolls sideways inside its own box instead of stretching the conversation.
 */
function Answer({
  text,
  resolveRef,
  onNavigate,
}: {
  text: string
  resolveRef: ObjectResolver
  onNavigate: (objectId: string) => void
}) {
  /**
   * Link the text to the map when it names a loaded object, else render it plainly.
   *
   * Applied to both the spans the navigator writes object names in — code and bold — since
   * it uses either. Only an exact schema match becomes a link, so ordinary emphasis is
   * untouched.
   */
  const renderMaybeRef = (children: ReactNode, plain: (content: ReactNode) => ReactNode) => {
    const objectId = typeof children === 'string' ? resolveRef(children) : null
    return objectId === null ? (
      plain(children)
    ) : (
      <ObjectLink objectId={objectId} label={children} onNavigate={onNavigate} />
    )
  }

  return (
    <div className="text-sm leading-relaxed [&>*+*]:mt-2">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings all render at one modest size — the pane is too narrow for a scale.
          h1: ({ children }) => <p className="font-semibold">{children}</p>,
          h2: ({ children }) => <p className="font-semibold">{children}</p>,
          h3: ({ children }) => <p className="font-semibold">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-4">{children}</ol>,
          code: ({ children, className }) =>
            // A fenced block carries a language class; an inline span does not. Only inline
            // spans are matched against the schema — a fenced block holds SQL or output,
            // not a bare object name.
            className === undefined ? (
              renderMaybeRef(children, (content) => (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                  {content}
                </code>
              ))
            ) : (
              <code className="font-mono text-xs">{children}</code>
            ),
          strong: ({ children }) =>
            renderMaybeRef(children, (content) => (
              <strong className="font-semibold">{content}</strong>
            )),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{children}</pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b bg-muted/50 px-2 py-1 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border-b px-2 py-1 align-top">{children}</td>,
          a: ({ children }) => <span>{children}</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

/**
 * The AI navigator pane: a conversation, a composer, an always-visible indicator of where
 * the schema is sent, and a one-time consent before it first reaches a remote provider.
 *
 * The answer streams in over Server-Sent Events (see {@link streamChat}); tool look-ups
 * surface only as a "looking things up…" marker, never their arguments or results. Nothing
 * is sent until a provider is configured, and — for a remote provider — not until the user
 * has agreed to that destination.
 */
export function NavigatorPane({
  profileId,
  provider,
  providerLoading,
  approved,
  onApprove,
  onOpenSettings,
  width,
  resolveRef,
  onNavigate,
}: NavigatorPaneProps) {
  const { t } = useTranslation()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  // The pending question held back while the consent gate is shown; null when not gating.
  const [consenting, setConsenting] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const destination = provider === null ? null : describeDestination(provider)
  // Name the provider as the user chose it ("Ollama"), not by its adapter kind or host.
  const providerLabel = useMemo(
    () => (provider === null ? '' : t(AI_PRESETS[presetForConfig(provider)].labelKey)),
    [provider, t],
  )

  // Keep the newest turn in view as the answer grows. (Guarded: jsdom has no scrollTo.)
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight })
  }, [turns])

  // Abort any in-flight stream on unmount (e.g. disconnecting).
  useEffect(() => () => abortRef.current?.abort(), [])

  // Grow the composer with what has been typed, so a long question stays fully visible
  // rather than scrolling inside a one-line box. Measuring needs the height released first;
  // past the max height the class-level cap takes over and the box scrolls instead.
  useLayoutEffect(() => {
    const field = inputRef.current
    if (field === null) {
      return
    }
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [input])

  /** Patch the fields of one turn by id. */
  const patchTurn = useCallback((id: string, patch: Partial<Turn>): void => {
    setTurns((current) =>
      current.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)),
    )
  }, [])

  const run = useCallback(
    async (history: ChatMessage[], assistantId: string): Promise<void> => {
      const controller = new AbortController()
      abortRef.current = controller
      setStreaming(true)
      let text = ''
      const tools: string[] = []
      try {
        for await (const event of streamChat(profileId, history, controller.signal)) {
          if (event.type === 'text') {
            text += event.text
            patchTurn(assistantId, { content: text })
          } else if (event.type === 'tool_call') {
            tools.push(event.name)
            patchTurn(assistantId, { tools: [...tools] })
          } else if (event.type === 'error') {
            patchTurn(assistantId, { error: event.message })
          }
        }
      } catch (error) {
        // An abort is a deliberate stop, not a failure — leave the partial answer as is.
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error)
          patchTurn(assistantId, { error: message })
        }
      } finally {
        patchTurn(assistantId, { streaming: false })
        setStreaming(false)
        abortRef.current = null
      }
    },
    [profileId, patchTurn],
  )

  /** Append the question and its (empty) answer turn, then start streaming. */
  const send = useCallback(
    (question: string): void => {
      const userTurn: Turn = {
        id: newId(),
        role: 'user',
        content: question,
        tools: [],
        error: null,
        streaming: false,
      }
      const assistantTurn: Turn = {
        id: newId(),
        role: 'assistant',
        content: '',
        tools: [],
        error: null,
        streaming: true,
      }
      // The history sent up is the prior user/assistant text plus this new question.
      const history: ChatMessage[] = [
        ...turns.map((turn) => ({ role: turn.role, content: turn.content })),
        { role: 'user', content: question },
      ]
      setTurns((current) => [...current, userTurn, assistantTurn])
      void run(history, assistantTurn.id)
    },
    [turns, run],
  )

  const submit = useCallback((): void => {
    const question = input.trim()
    if (question === '' || streaming || destination === null) {
      return
    }
    // A remote, not-yet-approved destination is confirmed once before anything is sent.
    if (!isDestinationApproved(destination, approved)) {
      setConsenting(question)
      return
    }
    setInput('')
    send(question)
  }, [input, streaming, destination, approved, send])

  const confirmConsent = useCallback((): void => {
    if (destination === null || consenting === null) {
      return
    }
    onApprove(destination.id)
    const question = consenting
    setConsenting(null)
    setInput('')
    send(question)
  }, [destination, consenting, onApprove, send])

  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      // Enter sends; Shift+Enter inserts a newline.
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        submit()
      }
    },
    [submit],
  )

  const composerDisabled = provider === null

  return (
    <aside
      style={{ width }}
      className="flex h-full shrink-0 flex-col border-l border-brand/20 bg-brand/10"
    >
      {/* Destination indicator — always visible, so where the schema goes is never hidden. */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-brand/20 px-3 text-xs">
        {providerLoading ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
          </span>
        ) : destination === null ? (
          <>
            <span className="truncate text-muted-foreground">{t('chat.noProvider')}</span>
            <button
              type="button"
              onClick={onOpenSettings}
              className="ml-auto flex shrink-0 items-center gap-1 font-medium text-brand hover:underline"
            >
              <Settings2 className="size-3.5" />
              {t('chat.configure')}
            </button>
          </>
        ) : (
          // Name the provider the way the user picked it, with the model — the endpoint host
          // (what actually matters for privacy) sits in the tooltip.
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={
              destination.isLocal
                ? t('chat.destinationLocal')
                : t('chat.destinationRemote', { host: destination.host ?? destination.label })
            }
          >
            {destination.isLocal ? (
              <HardDrive className="size-3.5 shrink-0 text-brand" />
            ) : (
              <Globe className="size-3.5 shrink-0 text-brand" />
            )}
            <span className="truncate font-medium">{providerLabel}</span>
            {provider !== null && provider.model !== '' && (
              <span className="truncate text-muted-foreground">{provider.model}</span>
            )}
          </span>
        )}
      </div>

      {/* Conversation, or the intro when empty. */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
            <Sparkles className="size-5 text-brand" />
            {t('panes.chatIntro')}
          </div>
        ) : (
          turns.map((turn) =>
            turn.role === 'user' ? (
              <div key={turn.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-brand-soft px-3 py-1.5 text-sm text-brand-foreground">
                  {turn.content}
                </div>
              </div>
            ) : (
              <div key={turn.id} className="space-y-1.5 text-sm">
                {turn.tools.length > 0 && (
                  // What it consulted, in the user's terms. The internal tool names mean
                  // nothing to them, so only a count shows, with the plain-English list of
                  // what was done in the tooltip.
                  <div
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    title={turn.tools.map((tool) => t(TOOL_LABEL_KEYS[tool] ?? '')).join('\n')}
                  >
                    {turn.streaming && <Loader2 className="size-3 animate-spin" />}
                    {turn.streaming && turn.content === ''
                      ? t('chat.lookingUp')
                      : t('chat.lookedUp', { count: turn.tools.length })}
                  </div>
                )}
                {turn.streaming && turn.content === '' && turn.tools.length === 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    {t('chat.thinking')}
                  </div>
                )}
                {turn.content !== '' && (
                  <div className="break-words text-foreground">
                    <Answer
                      text={turn.content}
                      resolveRef={resolveRef}
                      onNavigate={onNavigate}
                    />
                  </div>
                )}
                {turn.error !== null && (
                  <div className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                    {turn.error}
                  </div>
                )}
              </div>
            ),
          )
        )}
      </div>

      {/* Consent gate: shown in place of the composer before a remote first send. */}
      {consenting !== null && destination !== null ? (
        <div className="space-y-2.5 border-t border-brand/20 bg-background/60 p-3">
          <p className="text-sm font-medium">
            {t('chat.consentTitle', { label: destination.label })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('chat.consentBody', { label: destination.label })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConsenting(null)}>
              {t('chat.consentCancel')}
            </Button>
            <Button variant="brand" size="sm" onClick={confirmConsent}>
              {t('chat.consentConfirm')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-2.5">
          <div className="flex items-end gap-2 rounded-lg border bg-background px-2.5 py-2 focus-within:ring-1 focus-within:ring-brand">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onInputKeyDown}
              disabled={composerDisabled}
              rows={1}
              placeholder={t('chat.inputPlaceholder')}
              aria-label={t('chat.inputPlaceholder')}
              // Height is driven by the content (see the auto-grow effect); the padding is
              // zeroed so a single line sits centred against the send button rather than
              // riding on the textarea's default inset.
              className="block max-h-32 min-h-7 flex-1 resize-none overflow-y-auto bg-transparent p-0 text-sm leading-7 outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            {streaming ? (
              <Button
                variant="brand"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => abortRef.current?.abort()}
                aria-label={t('chat.stop')}
                title={t('chat.stop')}
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                variant="brand"
                size="icon"
                className="size-7 shrink-0"
                onClick={submit}
                disabled={composerDisabled || input.trim() === ''}
                aria-label={t('chat.send')}
                title={t('chat.send')}
              >
                <ArrowUp className={cn('size-4')} />
              </Button>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
