# ADR 0004: Forge integrations follow the Git-native milestone

- **Status:** Accepted
- **Date:** 2026-03-16

## Context

Nexus now provides local Git workflows: validated repository opening/cloning,
branch lifecycle actions, fetch, fast-forward pull, publishing/push, working-tree
safeguards, and divergence/conflict guidance. Pull requests, issues, CI status,
and review comments require communication with a forge such as GitHub, GitLab,
or Bitbucket. They are not local Git operations.

## Decision

Forge integration is a follow-on milestone, beginning with one provider only
(after validating user demand). It must not reuse a user's model-provider
credential or run as an unauthenticated scrape.

Before implementation, the selected forge integration requires:

1. A dedicated encrypted credential type and OAuth/PAT scope model.
2. Explicit per-workspace account/repository binding and a disconnect flow.
3. A typed API client with pagination, rate-limit handling, cancellation, and
   provider error classification.
4. User-confirmed outbound mutations for PR creation, comment publication,
   label/assignee changes, and remote branch publication.
5. A privacy disclosure that issue/PR content and repository metadata are sent
   directly to the configured forge, never to Nexus services.
6. A UI that distinguishes local Git state from remote CI/review state and
   handles unavailable credentials or rate limits without blocking local work.

## Consequences

- Phase 2 is complete for Git-native workflows without claiming forge support.
- GitHub/GitLab/Bitbucket adapters will be feature-flagged and independently
  threat-modeled.
- Local operations remain usable without a forge account or network access.
