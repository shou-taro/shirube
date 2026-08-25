/**
 * The demo's stand-in for the AI navigator.
 *
 * The real navigator needs a model, which the landing-page demo has no backend for. Rather
 * than show a dead "set up a provider" pane, this presents a few prepared questions with
 * canned answers — and, crucially, the object names in those answers are **real links**:
 * clicking one calls the map's own `onNavigate`, so the visitor sees the navigator's whole
 * point ("ask, then click the answer to fly there") on the genuine map. It is framed plainly
 * as a demo so no one mistakes the canned replies for a live model.
 *
 * Injected via Explorer's `renderNavigator` slot, so it needs no changes to the app itself.
 */
import { ArrowRight, RotateCcw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** A run of answer text, or a link that recentres the map on a schema object. */
type Segment = { text: string } | { objectId: string; label: string }

interface Script {
  q: string
  a: Segment[]
}

const t = (text: string): Segment => ({ text })
const link = (objectId: string, label: string): Segment => ({ objectId, label })

// Prepared questions and canned answers. Object ids match the Chinook fixture
// (`schema.name`), so the links travel the real map.
const SCRIPTS: Record<'en' | 'ja', Script[]> = {
  en: [
    {
      q: 'Which tables link a customer to the tracks they bought?',
      a: [
        t('Follow the keys: '),
        link('main.Customer', 'Customer'),
        t(' → '),
        link('main.Invoice', 'Invoice'),
        t(' → '),
        link('main.InvoiceLine', 'InvoiceLine'),
        t(' → '),
        link('main.Track', 'Track'),
        t('. Each invoice belongs to a customer, each line to an invoice, and every line names one track.'),
      ],
    },
    {
      q: 'How is an album related to its artist?',
      a: [
        link('main.Album', 'Album'),
        t('.ArtistId points to '),
        link('main.Artist', 'Artist'),
        t(' — one artist has many albums.'),
      ],
    },
    {
      q: "Where does a track's genre come from?",
      a: [
        link('main.Track', 'Track'),
        t('.GenreId references '),
        link('main.Genre', 'Genre'),
        t(' — that is where each track’s genre lives.'),
      ],
    },
  ],
  ja: [
    {
      q: '顧客が買った曲は、どのテーブルを辿ればわかる？',
      a: [
        t('キーを辿るだけです：'),
        link('main.Customer', 'Customer'),
        t(' → '),
        link('main.Invoice', 'Invoice'),
        t(' → '),
        link('main.InvoiceLine', 'InvoiceLine'),
        t(' → '),
        link('main.Track', 'Track'),
        t('。請求は顧客に、明細は請求に、そして各明細が1曲を指します。'),
      ],
    },
    {
      q: 'アルバムとアーティストは、どう繋がってる？',
      a: [
        link('main.Album', 'Album'),
        t('.ArtistId が '),
        link('main.Artist', 'Artist'),
        t(' を指します。1人のアーティストが複数のアルバムを持ちます。'),
      ],
    },
    {
      q: '曲のジャンルは、どこから来てる？',
      a: [
        link('main.Track', 'Track'),
        t('.GenreId が '),
        link('main.Genre', 'Genre'),
        t(' を参照します。各曲のジャンルはそこにあります。'),
      ],
    },
  ],
}

const COPY = {
  en: {
    badge: 'Navigator',
    reset: 'Reset',
    intro: 'Sample questions with prepared answers. Click a table name in an answer to jump to it on the map.',
    tryLabel: 'Try asking',
    hint: 'Tip: click a table name in an answer to travel there.',
  },
  ja: {
    badge: 'ナビゲーター',
    reset: 'リセット',
    intro: '用意した質問とサンプル回答です。回答のテーブル名を押すと、マップ上のその場所へ移動します。',
    tryLabel: 'こう聞ける',
    hint: 'ヒント：回答内のテーブル名を押すと、そこへ移動します。',
  },
}

/** A revealable answer token: one character of text, or a whole link. */
type Token = { text: string } | { objectId: string; label: string }

/** Flatten an answer into tokens — text char by char (so it streams in any language),
 *  links whole (a half-drawn link makes no sense). */
function tokenize(segments: Segment[]): Token[] {
  const tokens: Token[] = []
  for (const seg of segments) {
    if ('text' in seg) {
      for (const ch of seg.text) tokens.push({ text: ch })
    } else {
      tokens.push(seg)
    }
  }
  return tokens
}

type Phase = 'thinking' | 'streaming' | 'done'

interface Turn {
  id: number
  q: string
  tokens: Token[]
  revealed: number
  phase: Phase
}

const THINK_MS = 650
const STEP_MS = 20

export function DemoNavigator({ onNavigate }: { onNavigate: (objectId: string) => void }) {
  const { i18n } = useTranslation()
  const lang: 'en' | 'ja' = i18n.language.startsWith('ja') ? 'ja' : 'en'
  const scripts = SCRIPTS[lang]
  const copy = COPY[lang]

  const [turns, setTurns] = useState<Turn[]>([])
  const [asked, setAsked] = useState<Set<number>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const nextId = useRef(0)

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const update = useCallback((id: number, patch: Partial<Turn>) => {
    setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)))
  }, [])

  const ask = useCallback(
    (index: number) => {
      clearTimers()
      const script = scripts[index]
      const tokens = tokenize(script.a)
      const id = nextId.current++
      // Snap any turn still animating to complete, then add the new one in its "thinking" beat.
      setTurns((prev) => [
        ...prev.map((turn) => ({ ...turn, revealed: turn.tokens.length, phase: 'done' as Phase })),
        { id, q: script.q, tokens, revealed: 0, phase: 'thinking' as Phase },
      ])
      setAsked((prev) => new Set(prev).add(index))

      // Think for a beat, then stream the answer a character at a time. The map does not move
      // on its own — just like the real navigator, the visitor clicks a link to travel.
      timers.current.push(setTimeout(() => update(id, { phase: 'streaming' }), THINK_MS))
      for (let i = 1; i <= tokens.length; i++) {
        timers.current.push(setTimeout(() => update(id, { revealed: i }), THINK_MS + i * STEP_MS))
      }
      timers.current.push(
        setTimeout(() => update(id, { phase: 'done' }), THINK_MS + tokens.length * STEP_MS + 40),
      )
    },
    [scripts, clearTimers, update],
  )

  const reset = useCallback(() => {
    clearTimers()
    setTurns([])
    setAsked(new Set())
  }, [clearTimers])

  // Keep the newest content in view as it streams in.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  const remaining = scripts.map((_, i) => i).filter((i) => !asked.has(i))

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-brand" />
          <span className="text-xs font-semibold text-foreground">{copy.badge}</span>
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
            {copy.reset}
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Sparkles className="size-6 text-brand" />
            <p className="text-sm text-muted-foreground">{copy.intro}</p>
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className="space-y-2">
              <div className="demo-rise ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand/15 px-3 py-2 text-sm text-foreground">
                {turn.q}
              </div>
              <div className="demo-rise w-fit max-w-[92%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm leading-7 text-foreground">
                {turn.phase === 'thinking' ? (
                  <span className="flex items-center gap-1 py-0.5" aria-label="thinking">
                    <span className="demo-dot size-1.5 rounded-full bg-muted-foreground" />
                    <span className="demo-dot size-1.5 rounded-full bg-muted-foreground" />
                    <span className="demo-dot size-1.5 rounded-full bg-muted-foreground" />
                  </span>
                ) : (
                  <>
                    {turn.tokens.slice(0, turn.revealed).map((tk, i) =>
                      'text' in tk ? (
                        <span key={i}>{tk.text}</span>
                      ) : (
                        <button
                          key={i}
                          type="button"
                          onClick={() => onNavigate(tk.objectId)}
                          className="font-medium text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
                        >
                          {tk.label}
                        </button>
                      ),
                    )}
                    {turn.phase === 'streaming' && (
                      <span className="demo-caret ml-px inline-block h-4 w-px translate-y-0.5 bg-brand" />
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 border-t p-3">
        <p className="px-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {copy.tryLabel}
        </p>
        {remaining.length === 0 && turns.length > 0 ? (
          <p className="px-0.5 text-xs text-muted-foreground">{copy.hint}</p>
        ) : (
          remaining.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => ask(i)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-brand/45 hover:bg-brand/5"
            >
              <span>{scripts[i].q}</span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))
        )}
      </div>
    </div>
  )
}
