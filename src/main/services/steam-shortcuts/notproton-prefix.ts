import path from "node:path";

import { getHydraShortcutAppId } from "./steam-shortcuts-core.js";

const STEAM_APP_INSTALL_PATTERN =
  /^(.*?)[\\/]steamapps[\\/]common[\\/][^\\/]+/i;

export interface NotProtonPrefixInput {
  shop: string;
  objectId: string;
  executablePath?: string | null;
  steamPath?: string | null;
}

const compatdataPrefix = (libraryRoot: string, appId: string) =>
  path.join(libraryRoot, "steamapps", "compatdata", appId, "pfx");

/**
 * Where Steam Play (NotProton) keeps the Wine prefix for a game:
 * `<Steam library>/steamapps/compatdata/<appid>/pfx`.
 *
 * - Steam games use their real app id, in the library that holds their files.
 * - Everything else runs as a Hydra-managed non-Steam shortcut, whose app id is
 *   derived from the Hydra game (see getHydraShortcutAppId).
 */
export const getNotProtonPrefixPath = ({
  shop,
  objectId,
  executablePath,
  steamPath,
}: NotProtonPrefixInput): string | null => {
  if (shop === "steam") {
    const installMatch = executablePath
      ? STEAM_APP_INSTALL_PATTERN.exec(executablePath)
      : null;
    const libraryRoot = installMatch?.[1] || steamPath;

    return libraryRoot ? compatdataPrefix(libraryRoot, objectId) : null;
  }

  if (!steamPath) return null;

  return compatdataPrefix(
    steamPath,
    String(getHydraShortcutAppId(shop, objectId))
  );
};
