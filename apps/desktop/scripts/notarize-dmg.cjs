const { execFileSync } = require("node:child_process");

/// electron-builder notarizes the .app before the dmg exists, so the signed
/// dmg container itself assesses as "Unnotarized Developer ID". This
/// afterAllArtifactBuild hook submits the dmg to Apple and staples the ticket
/// so the container verifies standalone (spctl/stapler pass on the file a
/// user actually downloads). Opt-in like the rest of signing: silently
/// skipped when the notarization credentials are absent.
exports.default = async function notarizeDmg(context) {
  const dmg = (context.artifactPaths ?? []).find((artifact) =>
    artifact.endsWith(".dmg"),
  );
  if (!dmg) return [];
  const appleId = process.env.APPLE_ID;
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !password || !teamId) {
    console.warn(
      "notarize-dmg: APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID unset — dmg left unnotarized.",
    );
    return [];
  }
  console.log(`notarize-dmg: submitting ${dmg} to Apple…`);
  execFileSync(
    "xcrun",
    [
      "notarytool",
      "submit",
      dmg,
      "--apple-id",
      appleId,
      "--password",
      password,
      "--team-id",
      teamId,
      "--wait",
    ],
    { stdio: "inherit" },
  );
  // Stapling rewrites the dmg, so it must be the last thing that touches it.
  execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
  console.log("notarize-dmg: ticket stapled.");
  return [];
};
