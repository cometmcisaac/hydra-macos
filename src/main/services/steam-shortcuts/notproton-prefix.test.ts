import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getNotProtonPrefixPath } from "./notproton-prefix.js";
import { getHydraShortcutAppId } from "./steam-shortcuts-core.js";

const STEAM = "/Users/me/Library/Application Support/Steam";

describe("getNotProtonPrefixPath", () => {
  it("uses the real app id in the library that holds a Steam game", () => {
    assert.equal(
      getNotProtonPrefixPath({
        shop: "steam",
        objectId: "1245620",
        executablePath:
          "/Volumes/Games/SteamLibrary/steamapps/common/ELDEN RING/Game/eldenring.exe",
        steamPath: STEAM,
      }),
      "/Volumes/Games/SteamLibrary/steamapps/compatdata/1245620/pfx"
    );
  });

  it("falls back to the main Steam folder for a Steam game outside a library", () => {
    assert.equal(
      getNotProtonPrefixPath({
        shop: "steam",
        objectId: "42",
        executablePath: "/Users/me/Downloads/game.exe",
        steamPath: STEAM,
      }),
      `${STEAM}/steamapps/compatdata/42/pfx`
    );
  });

  it("uses the Hydra shortcut app id for non-Steam games", () => {
    const appId = getHydraShortcutAppId("custom", "game-1");

    assert.equal(
      getNotProtonPrefixPath({
        shop: "custom",
        objectId: "game-1",
        executablePath: "/Users/me/Games/game.exe",
        steamPath: STEAM,
      }),
      `${STEAM}/steamapps/compatdata/${appId}/pfx`
    );
  });

  it("returns null when Steam cannot be located", () => {
    assert.equal(
      getNotProtonPrefixPath({
        shop: "custom",
        objectId: "x",
        steamPath: null,
      }),
      null
    );
    assert.equal(
      getNotProtonPrefixPath({
        shop: "steam",
        objectId: "1",
        executablePath: "/a/b.exe",
      }),
      null
    );
  });
});
