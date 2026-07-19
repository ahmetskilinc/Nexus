// Bundles the three Node-side artifacts with esbuild:
//
//   src/main/index.ts                            → dist/main/index.js
//   src/preload/index.ts                         → dist/preload/index.js
//   packages/runtime … utility-process entry     → dist/runtime/index.js
//
// Everything is CJS so `__dirname` keeps working in the main process and the
// sandboxed preload stays a single self-contained file (a sandboxed preload
// can only require("electron"), so its workspace imports must be inlined).
// Workspace packages are consumed as TypeScript source and compiled into the
// bundles here — there are no per-package build steps. `--watch` rebuilds on
// change across the whole workspace, replacing the old `tsc --watch`.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  logLevel: watch ? "info" : "warning",
  // Electron is provided by the host binary; node-pty is a native module that
  // must load from the real node_modules (shipped via asarUnpack).
  external: ["electron"],
};

const builds = [
  {
    entryPoints: [path.join(app, "src/main/index.ts")],
    outfile: path.join(app, "dist/main/index.js"),
    external: ["electron", "node-pty"],
  },
  {
    entryPoints: [path.join(app, "src/preload/index.ts")],
    outfile: path.join(app, "dist/preload/index.js"),
  },
];

// The TS runtime's utilityProcess entry — bundled once the package exists so
// this script works both before and after the runtime migration lands.
const runtimeEntry = path.resolve(
  app,
  "../../packages/runtime/src/entries/utility-process.ts",
);
if (existsSync(runtimeEntry)) {
  builds.push({
    entryPoints: [runtimeEntry],
    outfile: path.join(app, "dist/runtime/index.js"),
  });
}

if (watch) {
  const contexts = await Promise.all(
    builds.map((build) => esbuild.context({ ...common, ...build })),
  );
  await Promise.all(contexts.map((context) => context.watch()));
  console.log(`bundle: watching ${builds.length} entries…`);
} else {
  await Promise.all(
    builds.map((build) => esbuild.build({ ...common, ...build })),
  );
}
