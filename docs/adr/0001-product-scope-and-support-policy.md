# ADR 0001: Product scope and platform support policy

- **Status:** Accepted
- **Date:** 2026-03-16

## Context

Nexus is a local-first desktop coding agent. It can inspect and modify a selected
repository, execute approved commands, connect directly to model providers, and
start configured MCP servers. The product needs a concrete first-production
scope before its recovery, provider, extension, and release architecture expands.

## Decision

### Audience

Nexus targets **individual developers first**. Team and organization features
(such as centralized policy, forge workflows, managed extensions, and fleet
configuration) remain future work and must not be assumed by local state or
network APIs.

### Local-first definition

Local-first means that the selected workspace, conversation state, application
preferences, and credentials are controlled on the user's machine. Provider
requests go directly to the configured provider; Nexus does not operate a
product backend that receives source code or credentials.

The first production scope also supports **user-configured local and
OpenAI-compatible model endpoints**. This is not a promise of fully offline
operation: features that use OAuth, web tools, remote MCP servers, or a remote
model naturally require network access and must disclose that at the point of
use.

### Platform support

- **macOS** is the primary supported platform and the only platform eligible for
  stable releases until its release checks remain green.
- **Windows and Linux** are experimental. They may be built locally, but are not
  advertised as stable until CI packaging, signing where applicable,
  installation smoke tests, and update support are implemented.

The release documentation and UI must communicate this distinction. A platform
must not be marked supported merely because `electron-builder` has a target for
it.

### Product delivery order

1. Recovery, auditability, retry behavior, and safe rollback.
2. Git collaboration and context/workspace workflows.
3. Managed MCP, broader provider operations, and multi-workspace work.
4. Team features only after individual workflows and policy boundaries are
   proven.

## Consequences

- New network, credential, command, filesystem, and extension capabilities
  require an explicit local disclosure and a threat-model review.
- Platform-specific code must degrade safely on experimental platforms.
- State and protocol additions should be forward-compatible with future team
  policy, but must not require a hosted account or telemetry service.
- Documentation may describe Windows/Linux packaging as experimental, not
  production support, until the release criteria above are met.
