import { getNotProtonPrefixPath } from "../steam-shortcuts/notproton-prefix.js";
import {
  isWinePrefixDirectory,
  resolveCrossOverBottleForExecutable,
  type BottleResolution,
} from "./crossover-bottles.js";

/**
 * How a Windows executable runs on macOS. The backend decides both how Hydra
 * launches the game and which Wine prefix its cloud saves are synced with, so
 * both must come from this one decision.
 *
 * - steam: installed in a Mac Steam library; Steam Play (NotProton) runs it.
 * - crossover: runs in a CrossOver bottle (chosen by the user or detected).
 * - steam-shortcut: Hydra registers it as a non-Steam shortcut for NotProton.
 * - default-handler: opened with whatever app handles .exe; no known prefix.
 */
export type MacWindowsBackend =
  | "steam"
  | "crossover"
  | "steam-shortcut"
  | "default-handler";

export interface MacWindowsRuntime {
  backend: MacWindowsBackend;
  prefixPath: string | null;
  ambiguousBottles?: string[];
}

export interface MacWindowsRuntimeInput {
  shop: string;
  objectId: string;
  executablePath: string;
  /** The prefix saved on the game record, if any. */
  gameWinePrefixPath?: string | null;
  steamPath?: string | null;
  /** Set only when the game is verified to be in a Mac Steam library. */
  steamLibraryPrefixPath?: string | null;
}

export interface MacWindowsRuntimeDependencies {
  resolveBottle: (executablePath: string) => Promise<BottleResolution>;
  isPrefix: (prefixPath: string) => Promise<boolean>;
}

const defaultDependencies: MacWindowsRuntimeDependencies = {
  resolveBottle: (executablePath) =>
    resolveCrossOverBottleForExecutable(executablePath),
  isPrefix: isWinePrefixDirectory,
};

// Prefixes Hydra derived itself for Steam Play are re-derived on every launch,
// so only a prefix outside Steam's compatdata counts as the user's own choice.
const isSteamCompatdataPath = (prefixPath: string) =>
  /[\\/]steamapps[\\/]compatdata[\\/]/i.test(prefixPath);

export const resolveMacWindowsRuntime = async (
  input: MacWindowsRuntimeInput,
  dependencies: MacWindowsRuntimeDependencies = defaultDependencies
): Promise<MacWindowsRuntime> => {
  if (input.steamLibraryPrefixPath) {
    return { backend: "steam", prefixPath: input.steamLibraryPrefixPath };
  }

  const chosenPrefix = input.gameWinePrefixPath;
  if (
    chosenPrefix &&
    !isSteamCompatdataPath(chosenPrefix) &&
    (await dependencies.isPrefix(chosenPrefix))
  ) {
    return { backend: "crossover", prefixPath: chosenPrefix };
  }

  const bottle = await dependencies.resolveBottle(input.executablePath);
  if (bottle.kind === "found") {
    return { backend: "crossover", prefixPath: bottle.bottlePath };
  }

  const ambiguousBottles =
    bottle.kind === "ambiguous" ? bottle.candidates : undefined;

  if (input.shop !== "steam") {
    return {
      backend: "steam-shortcut",
      prefixPath: getNotProtonPrefixPath({
        shop: input.shop,
        objectId: input.objectId,
        executablePath: input.executablePath,
        steamPath: input.steamPath,
      }),
      ambiguousBottles,
    };
  }

  return { backend: "default-handler", prefixPath: null, ambiguousBottles };
};
