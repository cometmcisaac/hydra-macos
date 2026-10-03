import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamLocation } from "@main/services/steam";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import { logger } from "@main/services/logger";
import { getSteamStoreUserContext } from "@main/services/steam-login-users";
import { resolveMacWindowsRuntime } from "@main/services/mac-windows/mac-windows-runtime";
import { resolveSteamProtocolLaunch } from "@main/services/steam-integration/steam-protocol-launch";
import type { CloudSavePathContext, GameShop } from "@types";

import {
  resolveCloudSaveEnvironment,
  type CloudSavePrefixGenerationOverride,
} from "./cloud-save-environment";
import { resolveCloudSavePlatform } from "./cloud-save-platform";

export interface CloudSaveGameContextOverrides {
  executablePath?: string;
  winePrefixPath?: string | null;
  prefixGenerationOverride?: CloudSavePrefixGenerationOverride;
}

const getRequestedWinePrefixPath = (
  usesWindowsCompatibility: boolean,
  gameWinePrefixPath: string | null | undefined,
  objectId: string,
  overrides?: CloudSaveGameContextOverrides,
  macPrefixPath?: string | null
) => {
  if (!usesWindowsCompatibility) return null;
  if (overrides && "winePrefixPath" in overrides) {
    return overrides.winePrefixPath ?? null;
  }
  // On macOS the prefix depends on how the game runs: a CrossOver bottle, or
  // Steam Play's compatdata folder (see resolveMacWindowsRuntime).
  if (process.platform === "darwin") return macPrefixPath ?? null;
  return Wine.getEffectivePrefixPath(gameWinePrefixPath, objectId);
};

export const getCloudSaveGameContext = async (
  objectId: string,
  shop: GameShop,
  overrides?: CloudSaveGameContextOverrides
) => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  const steamPath = await getSteamLocation().catch(() => undefined);
  const storeUserContext =
    shop === "steam" && steamPath
      ? await getSteamStoreUserContext(steamPath)
      : { known: [] };
  const executablePath =
    overrides?.executablePath ?? game?.executablePath ?? undefined;
  const platform = resolveCloudSavePlatform(process.platform, executablePath);
  const usesWindowsCompatibility =
    platform === "linux" &&
    executablePath?.toLowerCase().endsWith(".exe") === true;
  const macWindowsRuntime =
    process.platform === "darwin" && usesWindowsCompatibility && executablePath
      ? await resolveMacWindowsRuntime({
          shop,
          objectId,
          executablePath,
          gameWinePrefixPath: game?.winePrefixPath,
          steamPath,
          steamLibraryPrefixPath:
            shop === "steam"
              ? ((
                  await resolveSteamProtocolLaunch(
                    objectId,
                    executablePath
                  ).catch(() => null)
                )?.compatibilityPrefixPath ?? null)
              : null,
        })
      : null;
  const requestedWinePrefixPath = getRequestedWinePrefixPath(
    usesWindowsCompatibility,
    game?.winePrefixPath,
    objectId,
    overrides,
    macWindowsRuntime?.prefixPath
  );
  const winePrefixPath = await Wine.resolvePrefixPath(requestedWinePrefixPath);
  const pathContext: CloudSavePathContext = {
    shop,
    objectId,
    platform,
    homeDir: SystemPath.getPath("home"),
    documentsDir: SystemPath.getPath("documents") || undefined,
    appDataDir: SystemPath.getPath("appData") || undefined,
    executablePath,
    winePrefixPath: winePrefixPath ?? undefined,
    steamPath,
    storeUserContext,
  };

  let winePrefixIsValid = false;
  if (pathContext.winePrefixPath) {
    try {
      winePrefixIsValid = Wine.validatePrefix(pathContext.winePrefixPath);
    } catch {
      winePrefixIsValid = false;
    }
  }
  const environment = await resolveCloudSaveEnvironment(pathContext, {
    winePrefixIsValid,
    prefixGenerationOverride: overrides?.prefixGenerationOverride,
  });
  if (winePrefixIsValid && environment.prefixIdentityMode !== "marker") {
    logger.warn(
      "[Cloud Save] Wine prefix marker unavailable; using degraded identity",
      { prefixIdentityMode: environment.prefixIdentityMode }
    );
  }

  return { game, ...environment };
};
