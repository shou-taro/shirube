import { Lock } from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  createProfile,
  testConnection,
  updateProfile,
  type Profile,
  type ProfileInput,
  type SslMode,
} from '@/lib/api'

const SSL_MODES: SslMode[] = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']

interface FormState {
  name: string
  host: string
  port: string
  database: string
  username: string
  password: string
  sslmode: SslMode
  schemas: string
}

function initialState(initial: Profile | null): FormState {
  return {
    name: initial?.name ?? '',
    host: initial?.host ?? '',
    port: String(initial?.port ?? 5432),
    database: initial?.database ?? '',
    username: initial?.username ?? '',
    password: '',
    sslmode: initial?.sslmode ?? 'prefer',
    schemas: initial?.schemas.join(', ') ?? '',
  }
}

function toInput(state: FormState): ProfileInput {
  return {
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

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
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
 * The connection form: enter or edit a profile's fields, optionally test the connection,
 * then save and connect. Errors from the backend (translated messages) are shown inline.
 */
export function ConnectionForm({ initial, editingId, onConnected, onCancel }: ConnectionFormProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(() => initialState(initial))
  const [error, setError] = useState<string | null>(null)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok'>('idle')
  const [saving, setSaving] = useState(false)

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }))
    setTestState('idle')
    setError(null)
  }

  async function handleTest(): Promise<void> {
    setError(null)
    setTestState('testing')
    try {
      await testConnection({
        host: form.host,
        port: Number(form.port) || 5432,
        database: form.database,
        username: form.username,
        password: form.password,
        sslmode: form.sslmode,
      })
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
      const saved = editingId
        ? await updateProfile(editingId, input)
        : await createProfile(input)
      onConnected(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field label={t('connection.fields.name')}>
        <Input value={form.name} onChange={(event) => set('name', event.target.value)} required />
      </Field>
      <div className="grid grid-cols-[1fr_88px] gap-3">
        <Field label={t('connection.fields.host')}>
          <Input value={form.host} onChange={(event) => set('host', event.target.value)} required />
        </Field>
        <Field label={t('connection.fields.port')}>
          <Input
            value={form.port}
            inputMode="numeric"
            onChange={(event) => set('port', event.target.value)}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('connection.fields.database')}>
          <Input
            value={form.database}
            onChange={(event) => set('database', event.target.value)}
            required
          />
        </Field>
        <Field label={t('connection.fields.username')}>
          <Input
            value={form.username}
            onChange={(event) => set('username', event.target.value)}
            required
          />
        </Field>
      </div>
      <Field label={t('connection.fields.password')} hint={editingId ? t('connection.passwordKeepHint') : undefined}>
        {/* Lock glyph as a quiet reminder that the password goes to the OS keychain. */}
        <div className="relative">
          <Lock className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="password"
            className="pl-8"
            value={form.password}
            onChange={(event) => set('password', event.target.value)}
            required={editingId === null}
          />
        </div>
      </Field>

      {/* Connection options grouped apart from the core credentials. */}
      <div className="border-t pt-3">
        <p className="mb-2 text-xs text-muted-foreground">{t('connection.optionsLabel')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('connection.fields.sslmode')}>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
          <Field label={t('connection.fields.schemas')} hint={t('connection.schemasHint')}>
            <Input
              value={form.schemas}
              onChange={(event) => set('schemas', event.target.value)}
              placeholder="public"
            />
          </Field>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {testState === 'ok' ? (
        <p className="text-sm text-green-600">{t('connection.testOk')}</p>
      ) : null}

      {/* Secondary actions on the left; the primary CTA anchored bottom-right. */}
      <div className="flex items-center gap-2 pt-2">
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
