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
    rowActions: 'More actions',
  },
  search: {
    placeholder: 'Search tables and columns…',
    noResults: 'No matching tables',
    inColumn: 'column: {{column}}',
  },
  schema: {
    loading: 'Reading the schema…',
    error: 'Could not read the schema.',
    retry: 'Try again',
    reload: 'Reload schema',
    columns: 'Columns',
    notNull: 'not null',
    references: 'References',
    referencedBy: 'Referenced by',
    badgeView: 'View',
    badgeMatView: 'Mat. view',
    showAll: 'Show all tables',
    focus: 'Focus on neighbourhood',
    hiddenReferenced_one: 'References {{count}} more table that is off the map',
    hiddenReferenced_other: 'References {{count}} more tables that are off the map',
    hiddenReferencing_one: '{{count}} more table references this, off the map',
    hiddenReferencing_other: '{{count}} more tables reference this, off the map',
    empty: 'No tables or views found in this database.',
    objectKind: {
      table: 'Table',
      view: 'View',
      materialized_view: 'Materialized view',
    },
  },
  panes: {
    detail: 'Table detail',
    detailEmpty: 'Select a table to see its columns and relationships.',
    map: 'ER map',
    chat: 'AI navigator',
    chatIntro: 'Ask about your tables, columns and how they connect.',
    collapse: 'Collapse',
    expand: 'Expand',
  },
  chat: {
    inputPlaceholder: 'Ask the navigator…',
    send: 'Send',
  },
  health: {
    connected: 'API {{version}}',
    checking: 'Checking API…',
    error: 'API unreachable',
  },
} as const

export default en
