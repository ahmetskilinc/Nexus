# ADR 0008: Release support and update boundary

- **Status:** Accepted
- **Date:** 2026-03-16

## Context

Nexus declares Electron-builder targets for macOS, Windows, and Linux, while its
signed/notarized release automation presently ships macOS artifacts. A desktop
release claim must match reproducible CI, signing, installation testing, and an
update/rollback path.

## Decision

- macOS is the stable release platform. The release workflow signs, notarizes,
  and publishes its DMG only after the full root quality gate succeeds.
- Every pull request and main push runs the root `bun run check` quality gate in
  a dedicated CI workflow.
- Windows and Linux targets remain experimental until each has CI packaging,
  signing where applicable, artifact smoke tests, publication, and documented
  update behavior.
- In-app automatic updates are deferred. Nexus must not claim update support
  until it has signed update metadata/artifacts, channel selection, integrity
  verification, restart UX, and rollback guidance.

## Consequences

- Release documentation calls macOS the primary supported platform and labels
  Windows/Linux experimental.
- A failed quality gate prevents macOS release publication.
- Future cross-platform/update work is a release-engineering milestone, not a
  renderer-only feature.
