/**
 * English UI strings, grouped by area of the interface.
 *
 * Referenced with `t('group.key')`; `{{name}}` placeholders are filled by i18next
 * interpolation. Adding a language means providing an object with the same shape.
 */
const en = {
  app: {
    name: 'shirube',
    tagline: 'Navigate and understand your database with AI.',
  },
  connection: {
    savedConnections: 'Saved connections',
    newConnection: 'New connection',
    loading: 'Loading connections…',
    disconnect: 'Switch connection',
    copySuffix: 'copy',
    fields: {
      name: 'Name',
      host: 'Host',
      port: 'Port',
      database: 'Database',
      username: 'User',
      password: 'Password',
      sslmode: 'SSL mode',
      schemas: 'Schemas',
    },
    optionsLabel: 'Security and scope',
    schemasHint: 'Comma-separated; leave empty for all',
    passwordKeepHint: 'Leave blank to keep the saved password',
    test: 'Test connection',
    testing: 'Testing…',
    testOk: 'Connection successful',
    saveAndConnect: 'Save and connect',
    saving: 'Saving…',
    edit: 'Edit',
    duplicate: 'Duplicate',
    delete: 'Delete',
    cancel: 'Cancel',
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
