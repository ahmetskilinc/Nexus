# ADR 0005: Phase 3 attachment and workspace-intelligence boundary

- **Status:** Accepted
- **Date:** 2026-03-16

## Context

Phase 3 expands how a user gives Nexus local workspace context. Nexus now has
safe file-path attachments, inline preview/search/dropped-text context, context
budgeting and compaction, Quick Open, literal workspace search, a local project
map, and automatic refresh after agent/Git/external-editor changes.

Image/PDF ingestion and semantic indexing introduce materially different data
flows: binary content must be retained or encoded for a provider request, and a
semantic index may persist source-derived data. Neither should be slipped into a
text-file attachment feature.

## Decision

Phase 3 is complete with **text-first local context** and **ephemeral local
workspace intelligence**.

The following are explicitly deferred to a future multimodal/indexing milestone:

1. Image and PDF attachments, only after provider-specific vision/document
   payload contracts and selected-model capability gates exist.
2. Binary local attachment storage, including bounded lifetime, user-visible
   deletion, and renderer/process isolation design.
3. Persistent semantic embeddings, symbol/reference databases, or dependency
   graphs, only after disk budget, freshness, privacy, and clear-index controls
   are designed.
4. Multi-root workspace support. Git worktrees remain openable as individual
   repositories; a simultaneous multi-root model needs a new session/workspace
   contract.

## Consequences

- Dropped text is capped and inserted into an editable draft; unsupported binary
  drops are ignored rather than transmitted.
- Project maps are recomputed locally from the safe file index and are not
  persisted or sent to a Nexus service.
- Context supplied through previews and search remains visible/editable before a
  provider request, preserving user control over outbound source content.
