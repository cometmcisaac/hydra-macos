import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_GAME_CROSSOVER_SETTINGS,
  hasAnyCrossoverSetting,
  normalizeGameCrossoverSettings,
} from "./crossover-settings.js";

describe("normalizeGameCrossoverSettings", () => {
  it("returns defaults for garbage input", () => {
    assert.deepEqual(
      normalizeGameCrossoverSettings(null),
      DEFAULT_GAME_CROSSOVER_SETTINGS
    );
    assert.deepEqual(
      normalizeGameCrossoverSettings("nope"),
      DEFAULT_GAME_CROSSOVER_SETTINGS
    );
    assert.deepEqual(
      normalizeGameCrossoverSettings({ renderer: "vulkan", msync: "yes" }),
      { ...DEFAULT_GAME_CROSSOVER_SETTINGS }
    );
  });

  it("keeps valid values and drops unknown backends", () => {
    const normalized = normalizeGameCrossoverSettings({
      renderer: "d3dmetal",
      msync: true,
      dxvk: false,
      d3dmetal: null,
      metalFx: true,
      nvExtensions: false,
      dxr: null,
      mtl4: true,
    });

    assert.deepEqual(normalized, {
      renderer: "d3dmetal",
      msync: true,
      dxvk: false,
      d3dmetal: null,
      metalFx: true,
      nvExtensions: false,
      dxr: null,
      mtl4: true,
    });
  });
});

describe("hasAnyCrossoverSetting", () => {
  it("is false for empty/null defaults", () => {
    assert.equal(hasAnyCrossoverSetting(null), false);
    assert.equal(hasAnyCrossoverSetting(undefined), false);
    assert.equal(
      hasAnyCrossoverSetting(DEFAULT_GAME_CROSSOVER_SETTINGS),
      false
    );
  });

  it("is true when any value is set", () => {
    assert.equal(
      hasAnyCrossoverSetting({
        ...DEFAULT_GAME_CROSSOVER_SETTINGS,
        msync: true,
      }),
      true
    );
    assert.equal(
      hasAnyCrossoverSetting({
        ...DEFAULT_GAME_CROSSOVER_SETTINGS,
        renderer: "dxmt",
      }),
      true
    );
    // Explicit false is still a deliberate choice.
    assert.equal(
      hasAnyCrossoverSetting({
        ...DEFAULT_GAME_CROSSOVER_SETTINGS,
        dxvk: false,
      }),
      true
    );
  });
});
