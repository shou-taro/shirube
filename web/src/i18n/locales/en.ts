/**
 * English UI strings, grouped by area of the interface.
 *
 * Referenced with `t('group.key')`; `{{name}}` placeholders are filled by i18next
 * interpolation. Adding a language means providing an object with the same shape.
 */
const en = {
  app: {
    name: 'Shirube',
  },
  connection: {
    placeholder: 'staging DB',
  },
  search: {
    placeholder: 'Search tables and columns…',
  },
  panes: {
    detail: 'Table detail',
    map: 'ER map',
    chat: 'AI navigator',
  },
  chat: {
    inputPlaceholder: 'Ask the navigator…',
  },
  health: {
    connected: 'API {{version}}',
    checking: 'Checking API…',
    error: 'API unreachable',
  },
} as const

export default en
