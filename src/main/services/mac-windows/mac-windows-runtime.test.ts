import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BottleResolution } from "./crossover-bottles.js";
import {
  resolveMacWindowsRuntime,
  type MacWindowsRuntimeDependencies,
} from "./mac-windows-runtime.js";
import { getHydraShortcutAppId } from "../steam-shortcuts/steam-shortcuts-core.js";

const STEAM = "/Users/me/Library/Application Support/Steam";
const BOTTLE = "/Users/me/CXPBottles/Steam-2";

const deps = (
  bottle: BottleResolution = { kind: "none" },
  validPrefixes: string[] = []
): MacWindowsRuntimeDependencies => ({
  resolveBottle: async () => bottle,
  isPrefix: async (prefix) => validPrefixes.includes(prefix),
});

const base = {
  shop: "custom",
  objectId: "game-1",
  executablePath: "/Users/me/Games/game.exe",
  steamPath: STEAM,
};

describe("resolveMacWindowsRuntime", () => {
  it("runs games from a Mac Steam library through Steam", async () => {
    const runtime = await resolveMacWindowsRuntime(
      {
        ...base,
        shop: "steam",
        objectId: "42",
        steamLibraryPrefixPath: `${STEAM}/steamapps/compatdata/42/pfx`,
      },
      deps({ kind: "found", bottlePath: BOTTLE })
    );

    assert.deepEqual(runtime, {
      backend: "steam",
      prefixPath: `${STEAM}/steamapps/compatdata/42/pfx`,
    });
  });

  it("uses a detected bottle for Hydra-downloaded Steam-shop games", async () => {
    const runtime = await resolveMacWindowsRuntime(
      { ...base, shop: "steam", objectId: "42" },
      deps({ kind: "found", bottlePath: BOTTLE })
    );

    assert.deepEqual(runtime, { backend: "crossover", prefixPath: BOTTLE });
  });

  it("prefers the bottle the user chose over detection", async () => {
    const chosen = "/Users/me/CXPBottles/External Drive";
    const runtime = await resolveMacWindowsRuntime(
      { ...base, gameWinePrefixPath: chosen },
      deps({ kind: "found", bottlePath: BOTTLE }, [chosen])
    );

    assert.deepEqual(runtime, { backend: "crossover", prefixPath: chosen });
  });

  it("ignores a saved prefix that is gone or is Steam's own compatdata", async () => {
    const stale = "/Users/me/CXPBottles/Deleted";
    const compat = `${STEAM}/steamapps/compatdata/123/pfx`;

    for (const saved of [stale, compat]) {
      const runtime = await resolveMacWindowsRuntime(
        { ...base, gameWinePrefixPath: saved },
        deps({ kind: "none" }, [compat])
      );
      assert.equal(runtime.backend, "steam-shortcut");
    }
  });

  it("falls back to a NotProton shortcut for non-Steam games outside bottles", async () => {
    const runtime = await resolveMacWindowsRuntime(base, deps());
    const appId = getHydraShortcutAppId("custom", "game-1");

    assert.deepEqual(runtime, {
      backend: "steam-shortcut",
      prefixPath: `${STEAM}/steamapps/compatdata/${appId}/pfx`,
      ambiguousBottles: undefined,
    });
  });

  it("leaves Steam-shop games outside bottles on the default handler", async () => {
    const runtime = await resolveMacWindowsRuntime(
      { ...base, shop: "steam", objectId: "42" },
      deps()
    );

    assert.equal(runtime.backend, "default-handler");
    assert.equal(runtime.prefixPath, null);
  });

  it("surfaces an ambiguous bottle instead of guessing", async () => {
    const candidates = [BOTTLE, "/Users/me/CXPBottles/Other"];
    const runtime = await resolveMacWindowsRuntime(
      { ...base, shop: "steam", objectId: "42" },
      deps({ kind: "ambiguous", candidates })
    );

    assert.equal(runtime.backend, "default-handler");
    assert.equal(runtime.prefixPath, null);
    assert.deepEqual(runtime.ambiguousBottles, candidates);
  });
});
