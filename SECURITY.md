# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**, not in a public issue.

Use GitHub's private vulnerability reporting on this repository — the **Security** tab →
**Report a vulnerability** — which opens a private advisory visible only to the
maintainers. Include what you found, how to reproduce it, and the impact you expect.

You'll get an acknowledgement, and we'll work with you on a fix and coordinated
disclosure. shirube is a small project in beta, so please allow a reasonable window
before any public disclosure.

## Supported versions

shirube is pre-1.0 (beta). Security fixes are made against the **latest release** only;
there are no long-term support branches yet.

## Security posture

shirube is built to be safe by default, which also shapes its threat model:

- **Read-only.** Every database connection is opened read-only with a statement timeout.
  shirube issues no writes or schema changes.
- **Local-first.** The server binds to `127.0.0.1` only and is single-user; it is not
  intended to be exposed on a network. Your database credentials and data never leave
  your machine.
- **Secrets in the OS keychain.** Database passwords are stored via the operating
  system's keychain, never in a config file or in shirube's own database.
- **Metadata-only logging.** The local diagnostic log records errors and request
  metadata, never filter values, row data or passwords.

Because shirube is meant to run locally against a database you already have access to,
exposing it on an untrusted network, or pointing it at a database with a privileged
(non-read-only) role, is outside its intended use. A dedicated read-only role with only
`CONNECT` and `SELECT` is the recommended way to run it.
