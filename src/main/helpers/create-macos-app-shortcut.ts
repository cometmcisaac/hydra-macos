import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_BUNDLE_EXTENSION = ".app";
const ICON_RESOURCE_NAME = "appicon";

const FALLBACK_APP_NAME = "Hydra Game";

/**
 * macOS bundles are plain directories named `<Something>.app`. Turn a game
 * title into a safe folder name by stripping path separators, control
 * characters and characters macOS dislikes in bundle names.
 */
export const sanitizeShortcutAppName = (name: string): string => {
  const cleaned = name
    .replace(/[/\\:]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 0 ? cleaned : FALLBACK_APP_NAME;
};

const quoteShellArgument = (value: string) =>
  `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * A tiny launcher executable that re-opens Hydra with the game's run deep
 * link. Hydra then resolves the macOS runtime (CrossOver/Bottles/Steam) and
 * launches the game exactly like pressing Play inside Hydra would.
 */
export const buildMacAppLauncherScript = (
  executablePath: string,
  args: string[]
): string => {
  const parts = [
    quoteShellArgument(executablePath),
    ...args.map(quoteShellArgument),
  ];

  return ["#!/bin/sh", `exec ${parts.join(" ")}`, ""].join("\n");
};

const escapePlistString = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const buildMacAppInfoPlist = (options: {
  bundleName: string;
  bundleIdentifier: string;
  executableName: string;
  hasIcon: boolean;
}): string => {
  const { bundleName, bundleIdentifier, executableName, hasIcon } = options;
  const iconEntry = hasIcon
    ? `  <key>CFBundleIconFile</key>\n  <string>${ICON_RESOURCE_NAME}</string>\n`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>${escapePlistString(executableName)}</string>
  <key>CFBundleIdentifier</key>
  <string>${escapePlistString(bundleIdentifier)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${escapePlistString(bundleName)}</string>
  <key>CFBundleDisplayName</key>
  <string>${escapePlistString(bundleName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>NSHighResolutionCapable</key>
  <true/>
${iconEntry}</dict>
</plist>
`;
};

export const buildMacAppBundleIdentifier = (
  bundleName: string,
  salt = ""
): string => {
  const hash = crypto
    .createHash("sha1")
    .update(`${bundleName}\u0000${salt}`)
    .digest("hex")
    .slice(0, 12);

  return `gg.hydralauncher.shortcut.${hash}`;
};

/**
 * Icon conversion is best-effort: `sips` ships with macOS and can read the
 * PNG/ICO assets Hydra already downloads and emit a `.icns` bundle resource.
 * If anything fails we simply create the shortcut without a custom icon.
 */
const writeBundleIcon = (
  sourceIconPath: string | null | undefined,
  destinationIcnsPath: string
): boolean => {
  if (!sourceIconPath || !fs.existsSync(sourceIconPath)) return false;

  try {
    if (sourceIconPath.toLowerCase().endsWith(".icns")) {
      fs.copyFileSync(sourceIconPath, destinationIcnsPath);
      return true;
    }

    const tempPngPath = `${destinationIcnsPath}.tmp.png`;
    const pngResult = spawnSync(
      "sips",
      ["-s", "format", "png", sourceIconPath, "--out", tempPngPath],
      { encoding: "utf8", shell: false, timeout: 10_000 }
    );

    if (pngResult.error || pngResult.status !== 0) {
      fs.rmSync(tempPngPath, { force: true });
      return false;
    }

    const icnsResult = spawnSync(
      "sips",
      ["-s", "format", "icns", tempPngPath, "--out", destinationIcnsPath],
      { encoding: "utf8", shell: false, timeout: 10_000 }
    );
    fs.rmSync(tempPngPath, { force: true });

    return (
      !icnsResult.error &&
      icnsResult.status === 0 &&
      fs.existsSync(destinationIcnsPath)
    );
  } catch {
    return false;
  }
};

/**
 * Resolve a directory the current user can actually write an application into.
 * `/Applications` is preferred (it shows up for every user and in Spotlight),
 * falling back to the per-user `~/Applications`.
 */
export const resolveMacApplicationDirectory = (): string => {
  const candidates = ["/Applications", path.join(os.homedir(), "Applications")];

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  return path.join(os.homedir(), "Applications");
};

export interface CreateMacAppShortcutOptions {
  appName: string;
  outputDirectory: string;
  executablePath: string;
  arguments: string[];
  iconPath?: string | null;
  bundleIdentifier?: string;
}

/**
 * Creates a macOS `.app` bundle that relaunches the given deep link through
 * Hydra. Returns the bundle path on success, or `null` if it could not be
 * created.
 */
export const createMacAppShortcut = (
  options: CreateMacAppShortcutOptions
): string | null => {
  const appName = sanitizeShortcutAppName(options.appName);
  const bundlePath = path.join(
    options.outputDirectory,
    `${appName}${APP_BUNDLE_EXTENSION}`
  );

  // Only ever remove the bundle we are about to recreate, and never a path
  // that is not an `.app` bundle.
  if (!bundlePath.endsWith(APP_BUNDLE_EXTENSION)) return null;

  const contentsPath = path.join(bundlePath, "Contents");
  const macOSPath = path.join(contentsPath, "MacOS");
  const resourcesPath = path.join(contentsPath, "Resources");

  try {
    fs.mkdirSync(options.outputDirectory, { recursive: true });
    fs.rmSync(bundlePath, { recursive: true, force: true });
    fs.mkdirSync(macOSPath, { recursive: true });
    fs.mkdirSync(resourcesPath, { recursive: true });

    const launcherPath = path.join(macOSPath, appName);
    fs.writeFileSync(
      launcherPath,
      buildMacAppLauncherScript(options.executablePath, options.arguments),
      { mode: 0o755 }
    );
    fs.chmodSync(launcherPath, 0o755);

    const icnsPath = path.join(resourcesPath, `${ICON_RESOURCE_NAME}.icns`);
    const hasIcon = writeBundleIcon(options.iconPath, icnsPath);
    if (!hasIcon) {
      fs.rmSync(icnsPath, { force: true });
    }

    const bundleIdentifier =
      options.bundleIdentifier ?? buildMacAppBundleIdentifier(appName);

    fs.writeFileSync(
      path.join(contentsPath, "Info.plist"),
      buildMacAppInfoPlist({
        bundleName: appName,
        bundleIdentifier,
        executableName: appName,
        hasIcon,
      })
    );

    return bundlePath;
  } catch {
    return null;
  }
};
