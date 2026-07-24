import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const releaseDir = path.resolve(process.argv[2] ?? "release");
const dmgs = readdirSync(releaseDir)
  .filter((name) => name.endsWith(".dmg"))
  .map((name) => path.join(releaseDir, name));
if (dmgs.length !== 1)
  throw new Error(
    `Expected exactly one DMG in ${releaseDir}; found ${dmgs.length}.`,
  );

const dmg = dmgs[0];
const run = (command, args) => {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
};

// Validate the actual download artifact, not merely the pre-DMG .app produced
// by electron-builder. These macOS tools also prove the notarization ticket was
// stapled, allowing installation without a network round-trip to Apple.
run("spctl", [
  "--assess",
  "--type",
  "open",
  "--context",
  "context:primary-signature",
  dmg,
]);
run("xcrun", ["stapler", "validate", dmg]);

const mount = execFileSync("hdiutil", ["attach", "-nobrowse", "-plist", dmg], {
  encoding: "utf8",
});
const volume = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/.exec(
  mount,
)?.[1];
if (!volume) throw new Error("Could not determine the mounted DMG volume.");
try {
  const app = readdirSync(volume).find((name) => name.endsWith(".app"));
  if (!app || !existsSync(path.join(volume, app)))
    throw new Error("The mounted DMG contains no application bundle.");
  run("codesign", ["--verify", "--deep", "--strict", path.join(volume, app)]);
} finally {
  run("hdiutil", ["detach", volume]);
}

console.log(`Release artifact verified: ${dmg}`);
