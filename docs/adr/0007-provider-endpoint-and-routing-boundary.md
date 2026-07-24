# ADR 0007: Provider endpoint and routing boundary

- **Status:** Accepted
- **Date:** 2026-03-16

## Context

Nexus currently supports direct connections to OpenAI, Anthropic, and Kimi using
their defined API or OAuth contracts. The next provider milestone considers
custom/local/OpenAI-compatible endpoints, enterprise deployments, model routing,
fallback, quota health, and aggregate cost operations.

An endpoint URL is not a cosmetic settings field. It changes authentication,
request shape, data residency, TLS/proxy policy, model capability truth,
streaming/retry semantics, and potentially the threat model for source content.

## Decision

The provider-operations phase delivers truthful controls for the existing direct
providers: explicit connection policy, secure credential status, model capability
metadata, model-aware effort selection, run cost/time/tool budgets, retry
visibility, and session cost accounting.

Custom/local/enterprise endpoints and automatic routing/fallback are deferred
until Nexus has all of the following:

1. A versioned endpoint profile contract (base URL, deployment/model mapping,
   provider dialect, TLS/proxy policy, and capability declaration).
2. A non-destructive connection test that verifies the selected endpoint without
   leaking a credential to an unintended origin.
3. Secure per-profile credential/reference storage and migration from current
   provider profiles.
4. A clear disclosure that source and prompts go to the configured endpoint.
5. Deterministic fallback policy that never switches providers/models across a
   privacy, tool, modality, or cost boundary without user permission.
6. Tests using OpenAI-compatible and enterprise mock servers for streaming,
   errors, retries, and capability disagreement.

## Consequences

- The Settings UI must not imply custom endpoint support before the request
  builders actually support it.
- Users can continue using local-first Nexus with direct provider traffic and
  encrypted credentials; fully offline/local-model operation is a separate
  delivery track.
- Automatic model fallback is not enabled merely to hide an outage: a failure
  remains visible unless a future user-approved routing policy applies.
