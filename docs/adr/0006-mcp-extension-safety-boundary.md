# ADR 0006: Managed MCP extension safety boundary

- **Status:** Accepted
- **Date:** 2026-03-16

## Context

Nexus can start local stdio MCP servers and expose their discovered tools to an
agent. MCP servers are executable extensions and can have arbitrary filesystem,
network, and process side effects. Phase 4 must make this usable without
misrepresenting a local command form as a sandbox or silently persisting an
untested extension.

## Decision

Phase 4 provides a managed **local stdio MCP baseline**:

- A server must use a bare executable name or an absolute executable path.
  Shell snippets and relative paths are rejected; arguments remain a distinct
  argv array and no shell is spawned.
- A server is test-started, initialized, and inspected before it can be saved.
  Failed handshakes are not persisted.
- Tool names/descriptions are disclosed in Settings and inspection shuts the
  temporary server down afterward.
- Servers can be enabled/disabled or removed. Enabled servers are started only
  for an agent run, not as a persistent background service.
- MCP calls follow the agent approval mode. Deep Research does not start MCP
  servers and cannot call their tools.
- Per-request timeouts, process disposal, malformed-output tolerance, and
  namespaced tool identifiers remain enforced by `@nexus/mcp`.

The following are deferred because they require a distinct credential and
network-policy design:

1. Plaintext extension environment-variable editing. `McpServerConfig.env`
   remains runtime-capable for programmatic trusted configuration, but Settings
   will not persist secrets in `AppState`; a secure secret-reference model is
   required first.
2. Remote MCP transports, URLs, and OAuth/API-key authentication. These need
   SSRF/network allowlist policy, redirect handling, and credential scopes.
3. Curated registries/templates, signature/provenance verification, version
   pinning, revocation, and automatic update behavior.
4. A persistent server log viewer. Logs can contain secrets and source content;
   any diagnostics surface must obey ADR 0002 redaction and retention rules.
5. Organization-managed extension policy, which depends on the future team
   deployment model.

## Consequences

Nexus does not claim that stdio MCP processes are sandboxed. Users can inspect
what a server exposes before enabling it, and approvals remain the runtime
safety boundary. Future transports or secret configuration must be feature
flagged and threat-modeled rather than added to the current command form.
