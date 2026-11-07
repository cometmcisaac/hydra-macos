const path = require("node:path");
const { sign } = require("app-builder-lib/out/codeSign/macCodeSign");

// codesign's ad-hoc identity.
const ADHOC_IDENTITY = "-";

function createSigningOptions(options, projectDir) {
  const legendaryPath = path.join(
    options.app,
    "Contents",
    "Resources",
    "legendary",
    "legendary"
  );
  return {
    ...options,
    optionsForFile(filePath) {
      const inherited = options.optionsForFile
        ? options.optionsForFile(filePath)
        : {};
      if (filePath !== legendaryPath) return inherited;
      // Scope the PyInstaller library-validation entitlement to this helper.
      // Keep Hydra, Electron, and every other native binary's options intact.
      return {
        ...inherited,
        entitlements: path.join(
          projectDir,
          "build",
          "entitlements.legendary.mac.plist"
        ),
      };
    },
  };
}

async function signMac(options, packager) {
  if (!options.identity) {
    if (packager.forceCodeSigning || options.platform === "mas") {
      throw new Error(
        "Cannot sign macOS application: no signing identity available."
      );
    }
    // No Developer ID certificate: fall back to an ad-hoc signature.
    //
    // This is required, not cosmetic. electron-builder applies the
    // `electronFuses` config by patching bytes inside `Electron Framework`
    // *after* the bundle is assembled, which invalidates the linker signature
    // that ships with Electron. Without a re-sign the kernel kills the app at
    // launch with SIGKILL (Code Signature Invalid) / CODESIGNING Invalid Page.
    // Ad-hoc signing (`codesign --sign -`) rebinds the whole bundle so the
    // published DMGs run without a certificate.
    const base = createSigningOptions(options, packager.projectDir);
    await sign({
      ...base,
      // `-` is codesign's ad-hoc identity. osx-sign only passes it through
      // verbatim when identity validation is disabled, which electron-builder
      // already sets on the options it hands us.
      identity: ADHOC_IDENTITY,
      identityValidation: false,
      // Ad-hoc signatures carry no Team ID, so hardened runtime's library
      // validation rejects Electron Framework at launch ("mapping process and
      // mapped file (non-platform) have different Team IDs"). Drop the runtime
      // flag for ad-hoc builds; there is no notarization to protect anyway.
      optionsForFile: (filePath) => ({
        ...base.optionsForFile(filePath),
        hardenedRuntime: false,
      }),
    });
    return;
  }
  // Delegate to the same signer and retry policy electron-builder normally uses.
  await sign(createSigningOptions(options, packager.projectDir));
}

module.exports = signMac;
