/**
 * Join a path onto the configured base URL, tolerant of whether `BASE_URL` carries a
 * trailing slash. `rel('')` yields the base itself (with a trailing slash); `rel('ja/')`
 * and `rel('logo.svg')` sit under it.
 */
const base = import.meta.env.BASE_URL

export function rel(path = ''): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  return p ? `${b}/${p}` : `${b}/`
}
