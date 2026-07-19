const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

exports.default = async function afterPack(context) {
  // Harden the packaged Electron binary on every platform before signing:
  // disable the escape hatches that let the shipped app be re-purposed as a
  // general Node interpreter or attached to with an inspector, and pin app code
  // to the asar. Runs before electron-builder's signing step, so a real Developer
  // ID signature (when configured) still applies on top on macOS.
  //
  // RunAsNode stays disabled: the TS runtime runs as a utilityProcess (forked
  // from dist/runtime inside the asar), which never uses ELECTRON_RUN_AS_NODE.
  const platform = context.electronPlatformName;
  const productFilename = context.packager.appInfo.productFilename;
  const binaryExt =
    { darwin: ".app", win32: ".exe", linux: "" }[platform] ?? "";
  const electronBinary = path.join(
    context.appOutDir,
    `${productFilename}${binaryExt}`,
  );
  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: platform === "darwin",
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // OnlyLoadAppFromAsar pins *where* app code loads from; this validates that
    // the asar's contents still match the hash in its signed header, so the
    // packaged app code cannot be swapped after signing. The runtime bundle
    // (dist/runtime) and node-pty are asarUnpack'd — utilityProcess.fork of an
    // in-asar entry breaks the child's Mach-rendezvous handshake in signed
    // builds — so they sit outside the asar hash, covered by the enclosing
    // app signature instead.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  });
  console.log("after-pack: flipped security fuses.");
};
