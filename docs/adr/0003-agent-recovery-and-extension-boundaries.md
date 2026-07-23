# ADR 0003: Agent recovery and extension boundaries

- **Status:** Accepted
- **Date:** 2026-03-16

## Context

An agent run can invoke provider APIs, mutate workspace files, execute commands,
and call MCP tools. Current live run state is ephemeral, while sessions and the
latest mutation checkpoint persist. MCP servers are configured as local stdio
commands. Recovery and extension work must improve reliability without replaying
unsafe side effects after restart.

## Decision

### Recovery journal

Future run persistence records a bounded local journal of lifecycle transitions,
completed provider turns, completed tool calls, approval decisions, and
checkpoint references. The journal is an audit/recovery aid, not an instruction
to automatically replay work.

On restart, Nexus marks an interrupted run as recoverable only when its next
operation is known to be safe. It never automatically repeats a command, file
mutation, MCP tool call, web request, or provider request that might have
already executed. The user chooses whether to inspect, retry from a safe
boundary, or discard the interrupted run.

### Audit and undo

Mutation records retain enough local metadata to show the approved action and
verify whether a restore is safe. Granular restore is allowed only when the
current file still matches the mutation's recorded after-image. Conflicts remain
untouched and are surfaced for manual resolution.

### Extension boundary

MCP servers are treated as untrusted local extensions:

- Each server must be inspectable and testable before enabling it.
- Server commands, tools, and network behavior need clear disclosure.
- Calls remain approval-gated outside explicitly selected Auto mode.
- Server secrets use secure storage references, never plaintext `AppState`.
- Remote transports require a separate threat-model decision and are not part
  of the initial managed-MCP milestone.

## Consequences

- Run/journal schema changes require migration, size limits, and redaction
  tests.
- Provider retries must be cancellation-aware and report attempt status, but
  cannot obscure whether a side effect occurred.
- MCP configuration evolves from an app-global command form toward
  workspace-scoped managed configuration with explicit permission policy.
