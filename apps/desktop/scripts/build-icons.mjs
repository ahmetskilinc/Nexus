#!/usr/bin/env node
/// Rasterizes build/icon.svg into the icon set electron-builder packages with.
///
/// Produces build/icon.png (1024, the source electron-builder derives Windows
/// .ico and Linux .png sizes from) and build/icon.icns (macOS, built through
/// iconutil so the Retina @2x variants are real entries rather than upscales).
///
/// Rendering goes through headless Chrome because it is the one SVG rasterizer
/// guaranteed to be present on a machine that already builds an Electron app —
/// this avoids adding a native image dependency (sharp/librsvg) to the tree.
/// Run manually after editing icon.svg; the output PNG/ICNS are committed, so
/// packaging never depends on Chrome being installed.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const buildDir = join(root, "build");
const svg = join(buildDir, "icon.svg");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  process.env.CHROME_PATH,
];

/// macOS .iconset entry names: every size iconutil expects, each at 1x and 2x.
const ICONSET = [16, 32, 128, 256, 512].flatMap((size) => [
  { name: `icon_${size}x${size}.png`, px: size },
  { name: `icon_${size}x${size}@2x.png`, px: size * 2 },
]);

const chrome = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!chrome) {
  console.error(
    "build-icons: no Chrome/Chromium found. Set CHROME_PATH to a binary that can render SVG.",
  );
  process.exit(1);
}

/// Renders the SVG once, at full size. Chrome is used ONLY for this 1024 master
/// and every smaller size is resampled from it with sips, because per-size
/// browser renders proved unreliable twice over: the SVG's intrinsic 1024
/// width/height makes Chrome crop rather than scale a smaller viewport, and
/// viewports at or below ~128px come back fully transparent.
function renderMaster(px, out, wrapper) {
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--default-background-color=00000000",
      `--screenshot=${out}`,
      `--window-size=${px},${px}`,
      `file://${wrapper}`,
    ],
    { stdio: "ignore" },
  );
}

const work = mkdtempSync(join(tmpdir(), "nexus-icons-"));
try {
  // Wrapper and SVG must sit in one directory so the relative <img src> loads
  // under Chrome's file:// origin rules.
  copyFileSync(svg, join(work, "icon.svg"));
  const wrapper = join(work, "icon.html");
  writeFileSync(
    wrapper,
    `<!doctype html><style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:100vw;height:100vh}</style><img src="icon.svg">`,
  );

  const master = join(buildDir, "icon.png");
  renderMaster(1024, master, wrapper);
  console.log("build-icons: wrote build/icon.png (1024x1024)");

  const iconset = join(work, "icon.iconset");
  execFileSync("mkdir", ["-p", iconset]);
  for (const { name, px } of ICONSET) {
    const out = join(iconset, name);
    copyFileSync(master, out);
    // sips resamples in place and preserves the alpha channel.
    execFileSync("sips", ["--resampleHeightWidth", `${px}`, `${px}`, out], {
      stdio: "ignore",
    });
  }
  execFileSync("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    join(buildDir, "icon.icns"),
  ]);
  console.log(`build-icons: wrote build/icon.icns (${ICONSET.length} entries)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
