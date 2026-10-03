export type CloudSavePlatform = "windows" | "linux" | "mac";

export const isWindowsExecutablePath = (executablePath?: string | null) =>
  executablePath?.toLowerCase().endsWith(".exe") === true;

/**
 * Platform the cloud save pipeline should resolve save paths for.
 *
 * A Windows executable on macOS runs through Steam Play (NotProton), which is
 * the same situation the pipeline already models for Linux: a Windows game
 * whose saves live inside a Wine prefix. Reporting it that way reuses the
 * existing Windows-to-prefix path translation instead of searching macOS
 * folders for Windows saves. Native macOS games keep the "mac" platform.
 */
export const resolveCloudSavePlatform = (
  processPlatform: NodeJS.Platform,
  executablePath?: string | null
): CloudSavePlatform => {
  if (processPlatform === "win32") return "windows";
  if (processPlatform === "darwin") {
    return isWindowsExecutablePath(executablePath) ? "linux" : "mac";
  }
  return "linux";
};
