# ADR 0002: Data, diagnostics, and privacy policy

- **Status:** Accepted
- **Date:** 2026-03-16

## Context

Nexus handles repository contents, model-provider credentials, conversation
history, terminal output, tool results, and extension configuration. These can
contain source code, secrets, personal data, or operational details. The app
needs an explicit data and diagnostics policy before persistence, recovery, and
support features are expanded.

## Decision

### No telemetry

Nexus sends **no analytics, usage telemetry, crash reports, source code,
conversation content, credential metadata, or extension logs** to Nexus-operated
services. Nexus has no product backend.

Direct requests to a model provider, an enabled web tool, Git remote, or an MCP
server are user-initiated feature traffic and are governed by that destination's
policy. Such network access must remain visible and controllable in the app.

### Local storage

- Application state, sessions, transcripts, plans, research, and local audit
  records are stored on the device under the Electron user-data directory.
- Provider credentials and future extension secrets are encrypted with
  Electron `safeStorage` and are never stored in plaintext app state.
- Recovery and audit data must be bounded by retention limits and provide clear
  delete/export controls before stable release.

### Diagnostics

Nexus provides **manual diagnostic export only**. It does not upload diagnostic
bundles.

Diagnostic exporters must:

1. require a deliberate user action and show the destination;
2. include app/runtime/platform versions and explicitly selected operational
   logs only;
3. redact provider keys, OAuth access/refresh tokens, authorization headers,
   cookies, environment values, and configured extension secrets;
4. exclude repository file content, terminal input/output, conversation text,
   tool arguments/results, and full filesystem paths by default;
5. let the user preview the bundle manifest before it is written.

### Retention and deletion

The stable product must expose per-workspace/session deletion and a configurable
retention policy for run journals, audit records, checkpoints, and diagnostic
logs. Deletion must remove local data; it cannot revoke content already sent to
an external provider, web origin, Git remote, or MCP server.

## Consequences

- Any future remote support, account, synchronization, or crash-reporting
  feature requires a new ADR and explicit opt-in UX.
- New persisted types need a data-classification and retention decision.
- Tests must cover secret redaction and prevent plaintext credentials from
  entering state, journals, exports, or logs.
