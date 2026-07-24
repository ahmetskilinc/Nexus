# Nexus

Local-first coding-agent prototype, written end-to-end in TypeScript as a Turborepo + Bun monorepo. The runtime (`packages/*`) owns the core logic — the agent loop, workspace tools, provider HTTP clients (OpenAI Responses API, Anthropic Messages API, Kimi), the model catalog, ChatGPT/Kimi OAuth, and encrypted credential storage — and runs as an Electron `utilityProcess`. The desktop app (`apps/desktop`) is an Electron + React shell that owns the selected workspace, sessions, and provider profiles, and talks to the runtime over typed structured-clone IPC.

The app can:

- Select one repository workspace.
- Connect providers with an OpenAI, Anthropic, or Kimi API key, or by signing in with a ChatGPT or Kimi account (OAuth); credentials are encrypted with Electron `safeStorage`, requests go directly to that provider, and run budgets/retry status remain visible.
- Run a real agent loop: the model explores the workspace with tools (`read_file`, `list_directory`, `grep`, `git_status`) until it can answer, with every tool call shown in the transcript.
- Edit files and run shell commands, each gated by an approval card in Ask/Plan mode.
- Hold a multi-turn conversation per task session, with cancel and "New task" to reset.
- Browse a safe recursive file index that excludes common generated and dependency directories, and attach a file for the agent to read.
- Open an integrated terminal, review changed files as diffs, and test/inspect local stdio MCP servers before enabling them.
- Navigate a workspace with Quick Open (`⌘/Ctrl+P`) and literal full-text search (`⌘/Ctrl+F`), then attach files, previews, search snippets, or dropped text/logs as editable agent context.

Provider requests are made directly from the runtime to the provider; no credentials are sent to Nexus services because Nexus has no backend.

## Product and privacy policy

Nexus is currently designed for individual developers. It is local-first: the selected workspace, application state, and encrypted credentials stay on the user's machine, while enabled provider, web, Git, and MCP features contact their configured external destinations directly. Nexus sends no analytics, crash reports, or diagnostic data to Nexus-operated services. Diagnostics will be manual local exports with secret redaction.

macOS is the primary supported platform. Windows and Linux packaging targets are experimental until their CI release, installation, and update paths are implemented. Details and the architectural decisions that guide the production roadmap live in [`docs/adr`](docs/adr).

## Layout

```
apps/desktop         Electron shell: main process, sandboxed preload, React renderer
packages/protocol    The wire contract: types, zod event schema, RPC envelopes
packages/providers   Anthropic/OpenAI/Kimi clients, SSE parsing, models.dev catalog
packages/tools       Workspace tools: read/search/mutate/command/web, schemas, path guards
packages/workspace   Git operations, file indexer, mutation checkpoints, memory store
packages/mcp         MCP stdio client
packages/auth        OAuth flows (ChatGPT PKCE, Kimi device) and the credential store
packages/agent       The agent loop: tool runner, approvals, compaction, subagents
packages/runtime     Composition root: method dispatch, run registry, utilityProcess entry
```

Packages are consumed as TypeScript source (`"exports": "./src/index.ts"`); there are no per-package builds. esbuild bundles the three Node-side artifacts (`dist/main`, `dist/preload`, `dist/runtime`) inside `apps/desktop`.

## Security posture

The agent can write files and execute commands, so the trust boundaries are worth stating:

- **Approval gating.** File mutations, shell commands, and MCP tool calls each require approval unless the session is explicitly in Auto mode. The runtime defaults to Ask when no mode is supplied, and re-checks tool availability at dispatch so a hallucinated tool name can't bypass the mode's capability set.
- **Workspace containment.** Read and write paths are canonicalized and re-checked against the workspace root; symlinked leaves and ancestors are rejected, and write targets (plus their before-images) are re-verified at apply time to close the plan/approve/write TOCTOU window.
- **Credentials.** API keys and OAuth tokens are encrypted via Electron `safeStorage` (an OS-keychain-backed key) and stored under the app's user-data directory, never in `state.json`. The runtime process holds only ciphertext; encryption round-trips through the main process.
- **Spawned commands.** Agent-run commands default to a compatibility environment so local SDKs, version managers, proxies, and package registries work as expected. Users can switch to a restricted allowlist in Settings to reduce passive environment-variable exposure. Neither mode is a sandbox — approved commands can still reach the filesystem and network.
- **Renderer.** Runs with `contextIsolation`, `sandbox`, and no node integration, behind a strict CSP and a navigation lock; external links open in the OS browser. Assistant markdown is sanitized by a chain pinned in `apps/desktop/src/renderer/components/Markdown.tsx` — raw HTML is never parsed, and only `http`/`https`/`mailto` URLs survive. `Markdown.test.tsx` guards that.
- **Web tools.** `web_fetch` resolves each host and refuses non-public addresses (loopback, link-local, private, CGNAT, cloud metadata), re-checking on every redirect hop.
- **Packaging.** The shipped Electron binary has the `RunAsNode`, node-CLI-inspect, and `NODE_OPTIONS` fuses disabled, with asar-only loading and embedded asar integrity validation enabled. The runtime bundle and node-pty are `asarUnpack`'d (forking a utilityProcess from an in-asar entry breaks the child's Mach-rendezvous handshake in signed builds), so they are covered by the app's code signature rather than the asar hash.

## Run the app

Requires [Bun](https://bun.sh). One dependency (`@hugeicons-pro/core-stroke-rounded`)
comes from the paid [Hugeicons Pro](https://hugeicons.com) registry — set
`HUGEICONS_TOKEN` in a `.env` file at the repo root (or in your environment)
before installing.

```sh
bun install
cd apps/desktop
bun run dev
```

To produce a quick local build (unsigned, `.app` only, ~10s):

```sh
bun run package:local
```

To produce a distributable build (Developer ID signing + notarization; takes
a few minutes, dominated by Apple's per-binary signing-timestamp and
notarization round-trips):

```sh
bun run package
```

Checks (typecheck, tests, build, lint, formatting, dependency advisories) from the repo root:

```sh
bun run check
```

### Signing and notarization (macOS)

All signing is opt-in via environment variables, so builds still work without a certificate:

- `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` (or `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`) — credentials for notarization, which runs after signing with the Developer ID electron-builder discovers in the keychain.

Without a Developer ID, signing and notarization are skipped and the package remains local-only.

### Releases (GitHub Actions)

`.github/workflows/release.yml` runs on every push to `main`: typecheck and
tests always; when `apps/desktop/package.json` holds a version with no
`v<version>` release yet, it also builds, signs, notarizes, and publishes the
dmg to GitHub Releases — so bumping the version is what ships. Required
repository secrets:

- `CSC_LINK` — the Developer ID Application certificate as base64
  (`base64 -i certificate.p12 | pbcopy` after exporting it from Keychain
  Access with a password)
- `CSC_KEY_PASSWORD` — the export password for that .p12
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — notarization
  credentials (same ones used locally)
- `HUGEICONS_TOKEN` — Hugeicons Pro registry token for `bun install`

## Runtime protocol

The main process forks `dist/runtime/index.js` as an Electron `utilityProcess` and exchanges typed messages over its port (see `packages/protocol/src/rpc.ts`): requests `{kind:"request", id, method, params}`, responses `{kind:"response", id, ok, result | error}`, and request-correlated events `{kind:"event", id, event}`. Long-running methods (`agent.run`, `oauth.signin`) stream events before their final response and can be aborted with the `cancel` method. The runtime calls back to the main process only for `safeStorage` encrypt/decrypt (`host-request`/`host-response`).

Methods: `health`, `agent.run`, `agent.approve`, `cancel`, `models.list`, `models.catalog`, `credentials.set`, `credentials.delete`, `oauth.signin`, `mcp.inspect`, `workspace.index`, `workspace.inspect`, `workspace.changes`, `workspace.diff`, `workspace.stage`, `workspace.unstage`, `workspace.commit`, `workspace.discard`, `checkpoint.restore`, `context.preview`, `memory.list`, `memory.delete`, `memory.clear`.

Sessions and provider metadata are persisted by the app in `state.json` under the user-data directory; encrypted credentials live in `credentials/credentials.json` next to it.
