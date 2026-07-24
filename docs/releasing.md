# Releasing Nexus

Nexus currently ships **macOS** as its stable platform. Windows and Linux build
outputs are experimental: they have no signed/public release pipeline or update
promise yet. Nexus does not include automatic updates on any platform.

## Release contract

A macOS release is a versioned, signed, notarized DMG published to GitHub
Releases. The release workflow refuses to publish unless all of these succeed:

1. `bun run check` (typecheck, tests, production build, lint, formatting, and
   dependency advisory check).
2. Developer ID signing and Apple notarization of the app and DMG.
3. Verification of the **downloadable DMG** with Gatekeeper assessment,
   stapler-ticket validation, and strict code-signature verification of the app
   mounted from it.
4. SHA-256 checksum generation and GitHub build provenance attestation.

GitHub releases contain the DMG and `SHA256SUMS.txt`. GitHub shows the linked
attestation for the DMG; consumers can verify it with GitHub CLI:

```sh
# From a downloaded release directory
shasum -a 256 -c SHA256SUMS.txt

gh attestation verify Nexus-*.dmg \
  --repo OWNER/REPOSITORY
```

## Publishing

1. Update `apps/desktop/package.json` to the intended semantic version.
2. Run `bun run check` locally.
3. Merge the version bump to `main`. The release workflow sees that `v<version>`
   does not exist, builds the signed/notarized DMG, verifies it, attests it, and
   creates the GitHub release. A later push with the same version does not
   republish it.
4. Download the published DMG on a clean macOS test machine (or account), check
   its checksum, install it, open it once, connect a provider, open a workspace,
   and confirm a basic agent run can be cancelled. Record the result in the
   release notes or issue tracker.

The repository needs these Actions secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, and
`HUGEICONS_TOKEN`. Release signing secrets must be scoped to a protected
release environment with required reviewers.

## Installation and upgrades

Users download the DMG from the GitHub release, drag **Nexus.app** to
Applications, then launch it. Gatekeeper should accept a released artifact;
users should not bypass macOS security prompts. To upgrade, quit Nexus and
replace the old app in Applications with the newer released app. Sessions and
encrypted credentials remain in the app user-data directory; uninstalling the
app bundle does not remove them.

There is no in-app update channel. Do not advertise one or add update metadata
until signed update manifests, integrity verification, restart UX, staged
channels, rollback support, and update-specific tests exist.

## Rollback and incident response

If a release must be withdrawn, unpublish it from the GitHub release page and
publish a replacement version. Never replace assets under an existing version:
checksums and provenance are version-specific. Tell users to quit Nexus, remove
the affected app bundle, install the replacement (or prior known-good) DMG, and
verify its checksum. Preserve release artifacts and CI logs needed for incident
analysis; do not collect workspace content, prompts, or credentials.
