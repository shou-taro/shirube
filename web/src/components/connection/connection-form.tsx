import { Database, FileText, Lock, Server, Tag, User } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { IconInput } from '@/components/ui/icon-input'
import { useAnimatedHeight } from '@/lib/use-animated-height'
import { cn } from '@/lib/utils'
import {
  createProfile,
  pickSqliteFile,
  testConnection,
  testProfileEdit,
  updateProfile,
  type ConnectionTestParams,
  type DatabaseKind,
  type Profile,
  type ProfileInput,
  type SslMode,
} from '@/lib/api'

const SSL_MODES: SslMode[] = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']
const KINDS: DatabaseKind[] = ['postgresql', 'sqlite']

interface FormState {
  kind: DatabaseKind
  name: string
  host: string
  port: string
  database: string
  username: string
  password: string
  sslmode: SslMode
  path: string
  schemas: string
}

function initialState(initial: Profile | null): FormState {
  return {
    kind: initial?.kind ?? 'postgresql',
    name: initial?.name ?? '',
    host: initial?.kind === 'postgresql' ? initial.host : '',
    port: String(initial?.kind === 'postgresql' ? initial.port : 5432),
    database: initial?.kind === 'postgresql' ? initial.database : '',
    username: initial?.kind === 'postgresql' ? initial.username : '',
    password: '',
    sslmode: initial?.kind === 'postgresql' ? initial.sslmode : 'prefer',
    path: initial?.kind === 'sqlite' ? initial.path : '',
    schemas: initial?.schemas.join(', ') ?? '',
  }
}

function toInput(state: FormState): ProfileInput {
  if (state.kind === 'sqlite') {
    // SQLite has one namespace, so schemas do not apply.
    return { kind: 'sqlite', name: state.name, path: state.path, schemas: [] }
  }
  return {
    kind: 'postgresql',
    name: state.name,
    host: state.host,
    port: Number(state.port) || 5432,
    database: state.database,
    username: state.username,
    password: state.password ? state.password : undefined,
    sslmode: state.sslmode,
    schemas: state.schemas
      .split(',')
      .map((schema) => schema.trim())
      .filter(Boolean),
  }
}

function toTestParams(state: FormState): ConnectionTestParams {
  if (state.kind === 'sqlite') {
    return { kind: 'sqlite', path: state.path }
  }
  return {
    kind: 'postgresql',
    host: state.host,
    port: Number(state.port) || 5432,
    database: state.database,
    username: state.username,
    password: state.password,
    sslmode: state.sslmode,
  }
}

function Field({
  label,
  hint,
  optional = false,
  children,
}: {
  label: string
  hint?: string
  /** Tags the field as optional, so what is required reads at a glance rather than only on a
   *  failed submit. Required fields carry the native `required` attribute and stay unmarked. */
  optional?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {label}
        {optional ? (
          <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-normal leading-none text-muted-foreground">
            {t('connection.optional')}
          </span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

/**
 * The engine picker as an underlined tab row, so every supported engine is visible at a
 * glance — in particular SQLite, the no-server path a newcomer can try at once — instead of
 * hiding behind a closed menu. Built from native radios (one shared `name`) so keyboard
 * arrows move between tabs and the group reads correctly to a screen reader; the radio
 * itself is visually hidden and the styled label is the tab, its active state marked by a
 * brand underline.
 */
function EngineToggle({
  value,
  onChange,
  label,
}: {
  value: DatabaseKind
  onChange: (kind: DatabaseKind) => void
  label: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-6 border-b border-input">
        {KINDS.map((kind) => {
          const selected = value === kind
          return (
            <label
              key={kind}
              className={cn(
                '-mb-px cursor-pointer border-b-2 pb-2 text-sm transition-colors',
                selected
                  ? 'border-brand font-medium text-brand'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <input
                type="radio"
                name="engine"
                value={kind}
                checked={selected}
                onChange={() => onChange(kind)}
                className="peer sr-only"
              />
              <span className="rounded-sm px-0.5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                {t(`connection.kinds.${kind}`)}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

interface ConnectionFormProps {
  /** Values to prefill the form with (a profile to edit, a template to duplicate, or null). */
  initial: Profile | null
  /** When set, the form updates that profile; otherwise it creates a new one. */
  editingId: string | null
  onConnected: (profile: Profile) => void
  onCancel: () => void
}

/**
 * The connection form: choose the engine, enter or edit that engine's fields, optionally test
 * the connection, then save and connect. Errors from the backend (translated messages) are
 * shown inline.
 */
export function ConnectionForm({ initial, editingId, onConnected, onCancel }: ConnectionFormProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(() => initialState(initial))
  const [error, setError] = useState<string | null>(null)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok'>('idle')
  const [saving, setSaving] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  const isSqlite = form.kind === 'sqlite'

  // Switching engine swaps one set of fields for another of a different height. Rather than let
  // the form jump, ease the swapping region from its old height to its new one; everything below
  // (the buttons) and the card itself follow, since their heights are auto.
  const bodyRef = useAnimatedHeight<HTMLDivElement>(form.kind)

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }))
    setTestState('idle')
    setError(null)
  }

  async function handleBrowse(): Promise<void> {
    // The dialog is shown by the local server (a browser can't reveal a file's path), so the
    // request blocks until the user picks or cancels. On cancel the path is left as it was; if
    // no dialog can be shown the translated message is surfaced and the text field remains.
    setError(null)
    setBrowsing(true)
    try {
      const path = await pickSqliteFile()
      if (path) set('path', path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBrowsing(false)
    }
  }

  /** Field names that must be filled before a test can run, per engine. */
  function missingFields(): string[] {
    if (isSqlite) {
      return form.path.trim() ? [] : [t('connection.fields.path').toLowerCase()]
    }
    const missing: string[] = []
    if (!form.host.trim()) missing.push(t('connection.fields.host').toLowerCase())
    if (!form.database.trim()) missing.push(t('connection.fields.database').toLowerCase())
    if (!form.username.trim()) missing.push(t('connection.fields.username').toLowerCase())
    return missing
  }

  async function handleTest(): Promise<void> {
    setError(null)
    // The Test button sits outside the form's submit path, so the browser's ``required``
    // checks never run for it. Guard the essentials here — an empty PostgreSQL host in
    // particular makes the driver fall back to a local Unix socket and fail cryptically, so
    // catch it before it reaches the backend. Name only the fields that are actually blank.
    const missing = missingFields()
    if (missing.length > 0) {
      const fields = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(
        missing,
      )
      setError(t('connection.testMissingFields', { fields }))
      return
    }
    setTestState('testing')
    try {
      await testConnection(toTestParams(form))
      setTestState('ok')
    } catch (err) {
      setTestState('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const input = toInput(form)
      // Verify the connection before entering the explorer, so a bad host, password or file
      // path surfaces here — as it does for Test — rather than as an error on the ER screen.
      let saved: Profile
      if (editingId === null) {
        // Creating: everything needed to connect is in hand, so verify *before* saving. A
        // failed test then leaves no broken profile behind, and a retry can't duplicate.
        await testConnection(toTestParams(form))
        saved = await createProfile(input)
      } else {
        // Editing: verify the candidate edit *before* saving, so a bad host, password or path
        // can't overwrite the previous working profile. A blank PostgreSQL password means "keep
        // the stored one", so the backend resolves it from the keychain — which is why this
        // posts the edit to test rather than testing the already-saved profile.
        await testProfileEdit(editingId, input)
        saved = await updateProfile(editingId, input)
      }
      onConnected(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label={t('connection.fields.name')}>
        <IconInput
          icon={Tag}
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          required
        />
      </Field>
      <EngineToggle
        label={t('connection.fields.kind')}
        value={form.kind}
        onChange={(kind) => set('kind', kind)}
      />

      <div ref={bodyRef} className="flex flex-col gap-3">
        {isSqlite ? (
        <Field label={t('connection.fields.path')} hint={t('connection.pathHint')}>
          <div className="flex gap-2">
            <IconInput
              icon={FileText}
              wrapperClassName="flex-1"
              value={form.path}
              onChange={(event) => set('path', event.target.value)}
              placeholder="/path/to/database.sqlite"
              required
            />
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0"
              onClick={() => void handleBrowse()}
              disabled={browsing}
            >
              {browsing ? t('connection.browsing') : t('connection.browse')}
            </Button>
          </div>
        </Field>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_88px] gap-3">
            <Field label={t('connection.fields.host')}>
              <IconInput
                icon={Server}
                value={form.host}
                onChange={(event) => set('host', event.target.value)}
                required
              />
            </Field>
            <Field label={t('connection.fields.port')}>
              <IconInput
                value={form.port}
                inputMode="numeric"
                onChange={(event) => set('port', event.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('connection.fields.database')}>
              <IconInput
                icon={Database}
                value={form.database}
                onChange={(event) => set('database', event.target.value)}
                required
              />
            </Field>
            <Field label={t('connection.fields.username')}>
              <IconInput
                icon={User}
                value={form.username}
                onChange={(event) => set('username', event.target.value)}
                required
              />
            </Field>
          </div>
          <Field
            label={t('connection.fields.password')}
            // A reminder the password is kept safe: how it is stored when creating, and that
            // one is already stored (leave blank to keep it) when editing.
            hint={
              editingId ? t('connection.passwordKeepHint') : t('connection.passwordKeychainHint')
            }
          >
            <IconInput
              icon={Lock}
              type="password"
              value={form.password}
              onChange={(event) => set('password', event.target.value)}
              required={editingId === null}
              // Editing keeps the stored password unless a new one is typed, but it is never
              // fetched back — so show masked dots to signal one is stored (leave blank to
              // keep it). Not shown when creating or duplicating: those have no stored
              // password and must be given one. A fixed-length mask, not the real password.
              placeholder={editingId ? '••••••••' : undefined}
            />
          </Field>

          {/* Connection options grouped apart from the core credentials. */}
          <div className="border-t pt-3">
            <p className="mb-2 text-xs text-muted-foreground">{t('connection.optionsLabel')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('connection.fields.sslmode')}>
                {/* A lighter, underlined control (no box) — the dropdown reads as a quiet
                    option rather than a heavy field, matching the engine tabs above. */}
                <select
                  className="h-10 w-full border-0 border-b border-input bg-transparent px-1 text-sm focus-visible:border-brand focus-visible:outline-none"
                  value={form.sslmode}
                  onChange={(event) => set('sslmode', event.target.value as SslMode)}
                >
                  {SSL_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t('connection.fields.schemas')}
                hint={t('connection.schemasHint')}
                optional
              >
                <IconInput
                  value={form.schemas}
                  onChange={(event) => set('schemas', event.target.value)}
                  // An example of the comma-separated format, not a default — the hint says an
                  // empty field means every schema, so a lone "public" here would contradict it.
                  placeholder="public, sales"
                />
              </Field>
            </div>
          </div>
        </>
        )}
      </div>

      {/* A fixed slot for the connection status, so a Test result appearing or clearing does not
          nudge the buttons below it. Holds an error or the success line; empty otherwise. The
          live region announces the result to assistive tech. */}
      <div className="min-h-5 text-sm" aria-live="polite">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : testState === 'ok' ? (
          <p className="text-green-600">{t('connection.testOk')}</p>
        ) : null}
      </div>

      {/* Secondary actions on the left; the primary CTA anchored bottom-right. Wraps on
          very narrow widths rather than overflowing the card. */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleTest()}
          disabled={testState === 'testing'}
        >
          {testState === 'testing' ? t('connection.testing') : t('connection.test')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('connection.cancel')}
        </Button>
        <Button type="submit" variant="brand" className="ml-auto" disabled={saving}>
          {saving ? t('connection.saving') : t('connection.saveAndConnect')}
        </Button>
      </div>
    </form>
  )
}
